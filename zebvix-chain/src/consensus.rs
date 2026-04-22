//! Block production: round-robin proposer selection (B.3.2.1).
//!
//! Phase B.3.2 milestone 1: replaces single-validator PoA with deterministic
//! round-robin election from the on-chain validator registry. Each height N
//! is proposed by `validators_sorted[N % len]`. Only the elected proposer
//! produces a block at that height; other producers tick but skip.
//!
//! State-machine timeouts, 2/3+ commit gate, and `LastCommit` come in
//! B.3.2.2 / B.3.2.3 / B.3.2.4 respectively.

use crate::crypto::{address_from_pubkey, block_hash, header_signing_bytes, keypair_from_secret, sign_bytes};
use crate::mempool::Mempool;
use crate::state::State;
use crate::tokenomics::BLOCK_TIME_SECS;
use crate::types::{Address, Block, BlockHeader, Hash, Validator};
use anyhow::Result;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc::UnboundedSender;

pub const MAX_TXS_PER_BLOCK: usize = 5_000;

/// Deterministic round-robin proposer election.
///
/// `validators` MUST be sorted by address (as `State::validators()` returns).
/// Returns `None` if the registry is empty.
///
/// Selection: `validators[height % validators.len()]`. With 2 validators
/// sorted by address, heights alternate strictly between the two.
pub fn who_proposes(height: u64, validators: &[Validator]) -> Option<Address> {
    if validators.is_empty() {
        return None;
    }
    let idx = (height as usize) % validators.len();
    Some(validators[idx].address)
}

pub struct Producer {
    secret: [u8; 32],
    state: Arc<State>,
    mempool: Arc<Mempool>,
    /// Optional P2P broadcast channel: when set, every successfully-mined block
    /// is bincode-serialized and pushed here for gossip propagation.
    block_broadcast: Option<UnboundedSender<Vec<u8>>>,
}

impl Producer {
    pub fn new(secret: [u8; 32], state: Arc<State>, mempool: Arc<Mempool>) -> Self {
        Self { secret, state, mempool, block_broadcast: None }
    }

    pub fn with_broadcast(mut self, tx: UnboundedSender<Vec<u8>>) -> Self {
        self.block_broadcast = Some(tx);
        self
    }

    pub fn proposer_address(&self) -> crate::types::Address {
        let (_, pk) = keypair_from_secret(&self.secret);
        address_from_pubkey(&pk)
    }

    fn now_ms() -> u64 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
    }

    pub fn build_block(&self) -> Result<Block> {
        let (height, parent) = self.state.tip();
        let next_height = height + 1;
        let txs = self.mempool.take(MAX_TXS_PER_BLOCK);

        // tx_root = keccak of concatenated tx hashes (simple, not Merkle)
        let tx_root = {
            let mut buf = Vec::with_capacity(32 * txs.len());
            for t in &txs {
                buf.extend_from_slice(&crate::crypto::tx_hash(t).0);
            }
            crate::crypto::keccak256(&buf)
        };

        let header = BlockHeader {
            height: next_height,
            parent_hash: parent,
            state_root: Hash::ZERO, // v0.1: skip state root (compute in v0.2 with Merkle Patricia)
            tx_root,
            timestamp_ms: Self::now_ms(),
            proposer: self.proposer_address(),
        };
        let sig = sign_bytes(&self.secret, &header_signing_bytes(&header));
        let block = Block { header, txs, signature: sig };
        // Sanity: hash check
        let _ = block_hash(&block.header);
        Ok(block)
    }

    pub async fn run(self: Arc<Self>) {
        let mut ticker = tokio::time::interval(Duration::from_secs(BLOCK_TIME_SECS));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let me = self.proposer_address();
        tracing::info!("⛏  producer started: my_address={me}, mode=ROUND_ROBIN (B.3.2.1)");
        loop {
            ticker.tick().await;

            // ── B.3.2.1: round-robin proposer election ──
            // Re-read validator set every tick so on-chain ValidatorAdd /
            // ValidatorRemove txs immediately affect the election order.
            let validators = self.state.validators();
            let next_height = self.state.tip().0 + 1;
            let elected = match who_proposes(next_height, &validators) {
                Some(a) => a,
                None => {
                    tracing::warn!("⏸  h={next_height}: no validators in registry, skipping block production");
                    continue;
                }
            };

            if elected != me {
                // Not my turn. Other producers' tick will handle this height.
                tracing::debug!(
                    "⏸  h={next_height}: not my turn (elected={elected}, me={me}); set_size={}",
                    validators.len()
                );
                continue;
            }

            match self.build_block() {
                Ok(block) => {
                    let height = block.header.height;
                    let txs = block.txs.len();
                    if let Err(e) = self.state.apply_block(&block) {
                        tracing::error!("apply_block failed at h={height}: {e}");
                    } else {
                        tracing::info!(
                            "⛏  block #{height} produced  proposer={me}  txs={txs}  hash={}",
                            block_hash(&block.header)
                        );
                        // Broadcast over P2P if hooked up.
                        if let Some(tx) = &self.block_broadcast {
                            match bincode::serialize(&block) {
                                Ok(bytes) => { let _ = tx.send(bytes); }
                                Err(e) => tracing::warn!("p2p block serialize failed: {e}"),
                            }
                        }
                    }
                }
                Err(e) => tracing::error!("build_block failed: {e}"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Validator;

    fn mk_validator(addr_byte: u8) -> Validator {
        let addr = crate::types::Address([addr_byte; 20]);
        Validator { address: addr, pubkey: [addr_byte; 32], voting_power: 1 }
    }

    #[test]
    fn round_robin_two_validators() {
        let mut vs = vec![mk_validator(0xaa), mk_validator(0x11)];
        vs.sort_by_key(|v| v.address.0); // matches State::validators() order
        // sorted: [0x11, 0xaa]
        assert_eq!(who_proposes(0, &vs).unwrap().0[0], 0x11);
        assert_eq!(who_proposes(1, &vs).unwrap().0[0], 0xaa);
        assert_eq!(who_proposes(2, &vs).unwrap().0[0], 0x11);
        assert_eq!(who_proposes(3, &vs).unwrap().0[0], 0xaa);
    }

    #[test]
    fn empty_registry_returns_none() {
        assert!(who_proposes(42, &[]).is_none());
    }

    #[test]
    fn deterministic_across_three_validators() {
        let mut vs = vec![mk_validator(0x33), mk_validator(0x11), mk_validator(0x22)];
        vs.sort_by_key(|v| v.address.0);
        // sorted: [0x11, 0x22, 0x33]
        for h in 0..9u64 {
            let expected = match h % 3 {
                0 => 0x11, 1 => 0x22, 2 => 0x33, _ => unreachable!(),
            };
            assert_eq!(who_proposes(h, &vs).unwrap().0[0], expected, "h={h}");
        }
    }
}
