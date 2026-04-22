//! Single-validator PoA block producer. Multi-validator BFT comes in v0.2.

use crate::crypto::{address_from_pubkey, block_hash, header_signing_bytes, keypair_from_secret, sign_bytes};
use crate::mempool::Mempool;
use crate::state::State;
use crate::tokenomics::BLOCK_TIME_SECS;
use crate::types::{Block, BlockHeader, Hash};
use anyhow::Result;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const MAX_TXS_PER_BLOCK: usize = 5_000;

pub struct Producer {
    secret: [u8; 32],
    state: Arc<State>,
    mempool: Arc<Mempool>,
}

impl Producer {
    pub fn new(secret: [u8; 32], state: Arc<State>, mempool: Arc<Mempool>) -> Self {
        Self { secret, state, mempool }
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
        loop {
            ticker.tick().await;
            match self.build_block() {
                Ok(block) => {
                    let height = block.header.height;
                    let txs = block.txs.len();
                    if let Err(e) = self.state.apply_block(&block) {
                        tracing::error!("apply_block failed at h={height}: {e}");
                    } else {
                        tracing::info!("⛏  block #{height} produced  txs={txs}  hash={}", block_hash(&block.header));
                    }
                }
                Err(e) => tracing::error!("build_block failed: {e}"),
            }
        }
    }
}
