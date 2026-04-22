//! Phase A — P2P networking foundation (complete).
//!
//! Stack:
//!   - libp2p 0.54: TCP + Noise + Yamux transport
//!   - Gossipsub: blocks, txs, heartbeats (chain-id namespaced)
//!   - mDNS: LAN auto-discovery
//!   - Bootstrap peers via CLI multiaddrs
//!   - request-response (cbor codec): block sync / catch-up protocol
//!
//! Topics:
//!   zebvix/<chain_id>/blocks/v1     — full Block bincode
//!   zebvix/<chain_id>/txs/v1        — SignedTx bincode
//!   zebvix/<chain_id>/heartbeat/v1  — periodic { peer_id, tip } announcement
//!
//! Sync protocol:
//!   On gossipsub block with height > tip+1, OR heartbeat with peer_tip > our_tip,
//!   we send a `SyncReq { from, to }` to that peer over request-response. Peer
//!   serves blocks from local State. Received blocks are fed back through the
//!   inbound channel in order so the main consumer applies them sequentially.

use crate::state::State;
use crate::types::Block;
use anyhow::{anyhow, Result};
use futures::StreamExt;
use libp2p::{
    gossipsub, mdns, noise,
    request_response::{self, ProtocolSupport, ResponseChannel},
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, yamux, Multiaddr, PeerId, StreamProtocol, Swarm,
};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

const SYNC_BATCH_MAX: u64 = 256;
const HEARTBEAT_SECS: u64 = 8;
const SYNC_PROTOCOL: &str = "/zebvix/sync/1.0.0";

/// Outbound or inbound P2P message.
#[derive(Debug, Clone)]
pub enum P2PMsg {
    /// Bincode-serialized `Block`.
    Block(Vec<u8>),
    /// Bincode-serialized `SignedTx`.
    Tx(Vec<u8>),
}

/// Heartbeat announcement: tip height of the sender.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Heartbeat {
    tip: u64,
}

/// Sync request: give me blocks in `[from..=to]` (inclusive, capped at `SYNC_BATCH_MAX`).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyncReq {
    from: u64,
    to: u64,
}

/// Sync response: blocks in ascending height order (may be partial / empty).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyncResp {
    blocks: Vec<Vec<u8>>,
}

/// Handle returned to the rest of the node.
pub struct P2PHandle {
    pub out_tx: mpsc::UnboundedSender<P2PMsg>,
    pub inbound_rx: mpsc::UnboundedReceiver<P2PMsg>,
    pub local_peer_id: PeerId,
}

#[derive(NetworkBehaviour)]
struct ZebvixBehaviour {
    gossipsub: gossipsub::Behaviour,
    mdns: mdns::tokio::Behaviour,
    sync: request_response::cbor::Behaviour<SyncReq, SyncResp>,
}

fn topic_blocks(chain_id: u64) -> gossipsub::IdentTopic {
    gossipsub::IdentTopic::new(format!("zebvix/{chain_id}/blocks/v1"))
}
fn topic_txs(chain_id: u64) -> gossipsub::IdentTopic {
    gossipsub::IdentTopic::new(format!("zebvix/{chain_id}/txs/v1"))
}
fn topic_heartbeat(chain_id: u64) -> gossipsub::IdentTopic {
    gossipsub::IdentTopic::new(format!("zebvix/{chain_id}/heartbeat/v1"))
}

/// Spawn the P2P swarm in a background task and return a handle.
///
/// `state` — shared State used to serve sync responses (read-only for sync).
pub fn spawn_p2p(
    chain_id: u64,
    listen_port: u16,
    bootstrap_peers: Vec<Multiaddr>,
    disable_mdns: bool,
    state: Arc<State>,
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
                .max_transmit_size(1024 * 1024)
                .build()
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
            let gossipsub = gossipsub::Behaviour::new(
                gossipsub::MessageAuthenticity::Signed(key.clone()),
                gs_cfg,
            )
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

            let mdns = mdns::tokio::Behaviour::new(
                mdns::Config::default(),
                key.public().to_peer_id(),
            )
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

            let sync_cfg = request_response::Config::default()
                .with_request_timeout(Duration::from_secs(15));
            let sync = request_response::cbor::Behaviour::<SyncReq, SyncResp>::new(
                [(StreamProtocol::new(SYNC_PROTOCOL), ProtocolSupport::Full)],
                sync_cfg,
            );

            Ok(ZebvixBehaviour { gossipsub, mdns, sync })
        })
        .map_err(|e| anyhow!("p2p: behaviour: {e}"))?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    let local_peer_id = *swarm.local_peer_id();

    // ── Subscribe to topics ───────────────────────────────────────────
    let blocks_topic = topic_blocks(chain_id);
    let txs_topic = topic_txs(chain_id);
    let hb_topic = topic_heartbeat(chain_id);
    for t in [&blocks_topic, &txs_topic, &hb_topic] {
        swarm.behaviour_mut().gossipsub.subscribe(t)
            .map_err(|e| anyhow!("subscribe {}: {e}", t.hash()))?;
    }

    // ── Listen ────────────────────────────────────────────────────────
    let listen_addr: Multiaddr = format!("/ip4/0.0.0.0/tcp/{listen_port}").parse()?;
    swarm.listen_on(listen_addr)?;

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
    let hb_topic_h = hb_topic.hash();

    let st_for_task = state.clone();

    // Track in-flight sync requests so duplicate triggers don't spam the same peer.
    let mut syncing_with: HashSet<PeerId> = HashSet::new();

    // ── Heartbeat ticker ──────────────────────────────────────────────
    let mut hb_tick = tokio::time::interval(Duration::from_secs(HEARTBEAT_SECS));
    hb_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    // ── Event loop ────────────────────────────────────────────────────
    tokio::spawn(async move {
        loop {
            tokio::select! {
                // Heartbeat: announce our tip to the network.
                _ = hb_tick.tick() => {
                    let (tip, _) = st_for_task.tip();
                    let hb = Heartbeat { tip };
                    if let Ok(bytes) = serde_cbor_2bytes(&hb) {
                        let _ = swarm.behaviour_mut().gossipsub.publish(hb_topic.clone(), bytes);
                    }
                }
                // Outbound: rest of node wants to publish.
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
                // Inbound: events from the swarm.
                event = swarm.select_next_some() => {
                    handle_event(
                        event,
                        &inbound_tx,
                        &mut swarm,
                        &blocks_topic_h, &txs_topic_h, &hb_topic_h,
                        disable_mdns,
                        &st_for_task,
                        &mut syncing_with,
                    ).await;
                }
            }
        }
    });

    Ok(P2PHandle { out_tx, inbound_rx, local_peer_id })
}

/// Helper: serialize Heartbeat to CBOR bytes (avoids pulling serde_cbor — use bincode).
fn serde_cbor_2bytes(hb: &Heartbeat) -> Result<Vec<u8>, bincode::Error> {
    bincode::serialize(hb)
}
fn parse_hb(bytes: &[u8]) -> Option<Heartbeat> {
    bincode::deserialize(bytes).ok()
}

#[allow(clippy::too_many_arguments)]
async fn handle_event(
    event: SwarmEvent<ZebvixBehaviourEvent>,
    inbound_tx: &mpsc::UnboundedSender<P2PMsg>,
    swarm: &mut Swarm<ZebvixBehaviour>,
    blocks_topic_h: &gossipsub::TopicHash,
    txs_topic_h: &gossipsub::TopicHash,
    hb_topic_h: &gossipsub::TopicHash,
    disable_mdns: bool,
    state: &Arc<State>,
    syncing_with: &mut HashSet<PeerId>,
) {
    match event {
        SwarmEvent::NewListenAddr { address, .. } => {
            tracing::info!("🌐 p2p listening on {address}/p2p/{}", swarm.local_peer_id());
        }
        SwarmEvent::ConnectionEstablished { peer_id, .. } => {
            tracing::info!("✅ p2p connected: {peer_id}");
            // Greet new peer with our tip via heartbeat-style direct check:
            // we'll catch their heartbeat within HEARTBEAT_SECS, no need to push.
        }
        SwarmEvent::ConnectionClosed { peer_id, cause, .. } => {
            tracing::debug!("p2p disconnected {peer_id}: {cause:?}");
            syncing_with.remove(&peer_id);
        }
        SwarmEvent::Behaviour(ZebvixBehaviourEvent::Gossipsub(gossipsub::Event::Message {
            propagation_source: peer,
            message,
            ..
        })) => {
            let topic = &message.topic;
            if topic == blocks_topic_h {
                tracing::debug!("📥 p2p block from {peer} ({} bytes)", message.data.len());
                // Peek at height to decide if we need to sync.
                if let Ok(blk) = bincode::deserialize::<Block>(&message.data) {
                    let h = blk.header.height;
                    let (tip, _) = state.tip();
                    if h > tip + 1 && !syncing_with.contains(&peer) {
                        // We're behind. Request the gap.
                        let to = h.saturating_sub(1);
                        let from = tip + 1;
                        let to = from.saturating_add(SYNC_BATCH_MAX - 1).min(to);
                        tracing::info!("⏬ p2p out-of-order block #{h} (tip={tip}); requesting [{from}..={to}] from {peer}");
                        swarm.behaviour_mut().sync.send_request(&peer, SyncReq { from, to });
                        syncing_with.insert(peer);
                    }
                }
                let _ = inbound_tx.send(P2PMsg::Block(message.data));
            } else if topic == txs_topic_h {
                tracing::debug!("📥 p2p tx from {peer} ({} bytes)", message.data.len());
                let _ = inbound_tx.send(P2PMsg::Tx(message.data));
            } else if topic == hb_topic_h {
                if let Some(hb) = parse_hb(&message.data) {
                    let (tip, _) = state.tip();
                    if hb.tip > tip && !syncing_with.contains(&peer) {
                        let from = tip + 1;
                        let to = from.saturating_add(SYNC_BATCH_MAX - 1).min(hb.tip);
                        tracing::info!("⏬ heartbeat: {peer} tip={} (we={tip}); requesting [{from}..={to}]", hb.tip);
                        swarm.behaviour_mut().sync.send_request(&peer, SyncReq { from, to });
                        syncing_with.insert(peer);
                    }
                }
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
        // ── Sync request-response ────────────────────────────────────
        SwarmEvent::Behaviour(ZebvixBehaviourEvent::Sync(request_response::Event::Message {
            peer, message,
        })) => {
            match message {
                request_response::Message::Request { request, channel, .. } => {
                    handle_sync_request(swarm, state, peer, request, channel);
                }
                request_response::Message::Response { response, .. } => {
                    let n = response.blocks.len();
                    tracing::info!("⏬ sync response from {peer}: {n} blocks");
                    for b in response.blocks {
                        let _ = inbound_tx.send(P2PMsg::Block(b));
                    }
                    syncing_with.remove(&peer);
                }
            }
        }
        SwarmEvent::Behaviour(ZebvixBehaviourEvent::Sync(request_response::Event::OutboundFailure {
            peer, error, ..
        })) => {
            tracing::warn!("sync outbound to {peer} failed: {error}");
            syncing_with.remove(&peer);
        }
        SwarmEvent::Behaviour(ZebvixBehaviourEvent::Sync(request_response::Event::InboundFailure {
            peer, error, ..
        })) => {
            tracing::debug!("sync inbound from {peer} failed: {error}");
        }
        _ => {}
    }
}

fn handle_sync_request(
    swarm: &mut Swarm<ZebvixBehaviour>,
    state: &Arc<State>,
    peer: PeerId,
    req: SyncReq,
    channel: ResponseChannel<SyncResp>,
) {
    let SyncReq { from, mut to } = req;
    if to < from {
        let _ = swarm.behaviour_mut().sync.send_response(channel, SyncResp { blocks: vec![] });
        return;
    }
    if to - from + 1 > SYNC_BATCH_MAX {
        to = from + SYNC_BATCH_MAX - 1;
    }
    let (tip, _) = state.tip();
    let to = to.min(tip);

    let mut blocks = Vec::new();
    for h in from..=to {
        match state.block_at(h) {
            Some(blk) => match bincode::serialize(&blk) {
                Ok(b) => blocks.push(b),
                Err(e) => {
                    tracing::warn!("sync: serialize block {h} failed: {e}");
                    break;
                }
            },
            None => break, // gap — stop here
        }
    }
    tracing::info!("⏫ sync response → {peer}: serving {} blocks [{from}..={}]", blocks.len(), from + blocks.len().saturating_sub(1) as u64);
    let _ = swarm.behaviour_mut().sync.send_response(channel, SyncResp { blocks });
}
