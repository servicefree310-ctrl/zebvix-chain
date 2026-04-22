//! Phase A — P2P networking foundation.
//!
//! Uses libp2p with:
//!   - TCP + Noise + Yamux transport
//!   - Gossipsub for block + tx propagation
//!   - mDNS for LAN auto-discovery
//!   - Bootstrap peers via CLI multiaddrs
//!
//! Topics are chain-id-namespaced so two different chains never cross-pollinate:
//!   zebvix/<chain_id>/blocks/v1
//!   zebvix/<chain_id>/txs/v1

use anyhow::{anyhow, Result};
use futures::StreamExt;
use libp2p::{
    gossipsub, mdns, noise,
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, yamux, Multiaddr, PeerId, Swarm,
};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::Duration;
use tokio::sync::mpsc;

/// Outbound or inbound P2P message.
#[derive(Debug, Clone)]
pub enum P2PMsg {
    /// Bincode-serialized `Block`.
    Block(Vec<u8>),
    /// Bincode-serialized `SignedTx`.
    Tx(Vec<u8>),
}

/// Handle returned to the rest of the node so it can:
///   * `out_tx.send(P2PMsg::Block(bytes))` — broadcast a block we just mined
///   * `out_tx.send(P2PMsg::Tx(bytes))`    — re-broadcast a locally-submitted tx
///   * `inbound_rx.recv().await`           — consume blocks/txs received from peers
pub struct P2PHandle {
    pub out_tx: mpsc::UnboundedSender<P2PMsg>,
    pub inbound_rx: mpsc::UnboundedReceiver<P2PMsg>,
    pub local_peer_id: PeerId,
}

#[derive(NetworkBehaviour)]
struct ZebvixBehaviour {
    gossipsub: gossipsub::Behaviour,
    mdns: mdns::tokio::Behaviour,
}

fn topic_blocks(chain_id: u64) -> gossipsub::IdentTopic {
    gossipsub::IdentTopic::new(format!("zebvix/{chain_id}/blocks/v1"))
}

fn topic_txs(chain_id: u64) -> gossipsub::IdentTopic {
    gossipsub::IdentTopic::new(format!("zebvix/{chain_id}/txs/v1"))
}

/// Spawn the P2P swarm in a background task and return a handle for the rest of the node.
///
/// `listen_port` — TCP port to listen on (0 = OS-assigned).
/// `bootstrap_peers` — optional multiaddrs to dial on startup (e.g. `/ip4/1.2.3.4/tcp/30333/p2p/<peer_id>`).
/// `disable_mdns` — set true on production VPS where mDNS LAN discovery is irrelevant.
pub fn spawn_p2p(
    chain_id: u64,
    listen_port: u16,
    bootstrap_peers: Vec<Multiaddr>,
    disable_mdns: bool,
) -> Result<P2PHandle> {
    // ── Build the swarm ───────────────────────────────────────────────
    let mut swarm = libp2p::SwarmBuilder::with_new_identity()
        .with_tokio()
        .with_tcp(
            tcp::Config::default().nodelay(true),
            noise::Config::new,
            yamux::Config::default,
        )
        .map_err(|e| anyhow!("p2p: tcp transport: {e}"))?
        .with_behaviour(|key| {
            // Gossipsub config: dedupe by hashing the message bytes.
            let msg_id_fn = |msg: &gossipsub::Message| {
                let mut h = DefaultHasher::new();
                msg.data.hash(&mut h);
                gossipsub::MessageId::from(h.finish().to_be_bytes().to_vec())
            };
            let gs_cfg = gossipsub::ConfigBuilder::default()
                .heartbeat_interval(Duration::from_secs(2))
                .validation_mode(gossipsub::ValidationMode::Strict)
                .message_id_fn(msg_id_fn)
                .max_transmit_size(1024 * 1024) // 1 MiB per gossip message (≈ 5k txs)
                .build()
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
            let gossipsub = gossipsub::Behaviour::new(
                gossipsub::MessageAuthenticity::Signed(key.clone()),
                gs_cfg,
            )
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

            let mdns_cfg = mdns::Config::default();
            let mdns = mdns::tokio::Behaviour::new(mdns_cfg, key.public().to_peer_id())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

            Ok(ZebvixBehaviour { gossipsub, mdns })
        })
        .map_err(|e| anyhow!("p2p: behaviour: {e}"))?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    let local_peer_id = *swarm.local_peer_id();

    // ── Subscribe to topics ───────────────────────────────────────────
    let blocks_topic = topic_blocks(chain_id);
    let txs_topic = topic_txs(chain_id);
    swarm
        .behaviour_mut()
        .gossipsub
        .subscribe(&blocks_topic)
        .map_err(|e| anyhow!("subscribe blocks: {e}"))?;
    swarm
        .behaviour_mut()
        .gossipsub
        .subscribe(&txs_topic)
        .map_err(|e| anyhow!("subscribe txs: {e}"))?;

    // ── Listen ────────────────────────────────────────────────────────
    let listen_addr: Multiaddr = format!("/ip4/0.0.0.0/tcp/{listen_port}").parse()?;
    swarm.listen_on(listen_addr.clone())?;

    // ── Dial bootstrap peers ──────────────────────────────────────────
    for addr in &bootstrap_peers {
        match swarm.dial(addr.clone()) {
            Ok(_) => tracing::info!("🔗 p2p dialing {addr}"),
            Err(e) => tracing::warn!("p2p dial {addr} failed: {e}"),
        }
    }

    // ── Channels ──────────────────────────────────────────────────────
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<P2PMsg>();
    let (inbound_tx, inbound_rx) = mpsc::unbounded_channel::<P2PMsg>();

    let blocks_topic_h = blocks_topic.hash();
    let txs_topic_h = txs_topic.hash();

    // ── Event loop ────────────────────────────────────────────────────
    tokio::spawn(async move {
        loop {
            tokio::select! {
                // Outbound: rest of node wants to publish
                Some(msg) = out_rx.recv() => {
                    let (topic, kind, bytes) = match msg {
                        P2PMsg::Block(b) => (blocks_topic.clone(), "block", b),
                        P2PMsg::Tx(b)    => (txs_topic.clone(),    "tx",    b),
                    };
                    let len = bytes.len();
                    match swarm.behaviour_mut().gossipsub.publish(topic, bytes) {
                        Ok(_)  => tracing::debug!("📤 p2p published {kind} ({len} bytes)"),
                        Err(e) => tracing::debug!("p2p publish {kind} failed: {e}"),
                    }
                }
                // Inbound: events from the swarm
                event = swarm.select_next_some() => {
                    handle_event(event, &inbound_tx, &mut swarm, &blocks_topic_h, &txs_topic_h, disable_mdns).await;
                }
            }
        }
    });

    Ok(P2PHandle { out_tx, inbound_rx, local_peer_id })
}

async fn handle_event(
    event: SwarmEvent<ZebvixBehaviourEvent>,
    inbound_tx: &mpsc::UnboundedSender<P2PMsg>,
    swarm: &mut Swarm<ZebvixBehaviour>,
    blocks_topic_h: &gossipsub::TopicHash,
    txs_topic_h: &gossipsub::TopicHash,
    disable_mdns: bool,
) {
    match event {
        SwarmEvent::NewListenAddr { address, .. } => {
            tracing::info!("🌐 p2p listening on {address}/p2p/{}", swarm.local_peer_id());
        }
        SwarmEvent::ConnectionEstablished { peer_id, .. } => {
            tracing::info!("✅ p2p connected: {peer_id}");
        }
        SwarmEvent::ConnectionClosed { peer_id, cause, .. } => {
            tracing::debug!("p2p disconnected {peer_id}: {cause:?}");
        }
        SwarmEvent::Behaviour(ZebvixBehaviourEvent::Gossipsub(gossipsub::Event::Message {
            propagation_source: peer,
            message,
            ..
        })) => {
            let topic = &message.topic;
            if topic == blocks_topic_h {
                tracing::debug!("📥 p2p block from {peer} ({} bytes)", message.data.len());
                let _ = inbound_tx.send(P2PMsg::Block(message.data));
            } else if topic == txs_topic_h {
                tracing::debug!("📥 p2p tx from {peer} ({} bytes)", message.data.len());
                let _ = inbound_tx.send(P2PMsg::Tx(message.data));
            }
        }
        SwarmEvent::Behaviour(ZebvixBehaviourEvent::Mdns(mdns::Event::Discovered(peers))) => {
            if disable_mdns { return; }
            for (peer, _addr) in peers {
                tracing::info!("📡 mdns discovered {peer}");
                swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer);
            }
        }
        SwarmEvent::Behaviour(ZebvixBehaviourEvent::Mdns(mdns::Event::Expired(peers))) => {
            for (peer, _addr) in peers {
                swarm.behaviour_mut().gossipsub.remove_explicit_peer(&peer);
            }
        }
        _ => {}
    }
}
