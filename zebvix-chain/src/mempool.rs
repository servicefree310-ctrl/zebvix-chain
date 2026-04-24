//! Simple in-memory transaction pool.

use crate::crypto::{tx_hash, verify_tx};
use crate::state::State;
use crate::tokenomics::MIN_TX_FEE_WEI;
use crate::types::SignedTx;
use anyhow::{anyhow, Result};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

pub struct Mempool {
    inner: RwLock<HashMap<[u8; 32], SignedTx>>,
    state: Arc<State>,
    max_size: usize,
}

impl Mempool {
    pub fn new(state: Arc<State>, max_size: usize) -> Self {
        Self { inner: RwLock::new(HashMap::new()), state, max_size }
    }

    pub fn add(&self, tx: SignedTx) -> Result<[u8; 32]> {
        if tx.body.fee < MIN_TX_FEE_WEI {
            return Err(anyhow!(
                "fee too low: {} wei < min {} wei (0.001 ZBX)",
                tx.body.fee, MIN_TX_FEE_WEI
            ));
        }
        if !verify_tx(&tx) {
            return Err(anyhow!("invalid signature"));
        }
        let cur_nonce = self.state.nonce(&tx.body.from);
        if tx.body.nonce < cur_nonce {
            return Err(anyhow!("nonce too low: cur {cur_nonce}, got {}", tx.body.nonce));
        }
        let h = tx_hash(&tx).0;
        let mut g = self.inner.write();
        if g.len() >= self.max_size {
            return Err(anyhow!("mempool full"));
        }
        g.insert(h, tx);
        Ok(h)
    }

    /// Drain up to `max` transactions, sorted by (sender, nonce).
    pub fn take(&self, max: usize) -> Vec<SignedTx> {
        let mut g = self.inner.write();
        let mut txs: Vec<SignedTx> = g.values().cloned().collect();
        txs.sort_by_key(|t| (t.body.from.0, t.body.nonce));
        txs.truncate(max);
        for t in &txs {
            g.remove(&tx_hash(t).0);
        }
        txs
    }

    pub fn len(&self) -> usize { self.inner.read().len() }

    pub fn max_size(&self) -> usize { self.max_size }

    /// Cheap snapshot for RPC: (hash, from, to, amount, fee, nonce, kind_index).
    /// Cloning the inner Vec keeps the read lock window small.
    pub fn snapshot(&self) -> Vec<([u8; 32], crate::types::Address, crate::types::Address, u128, u128, u64, u32)> {
        let g = self.inner.read();
        let mut out: Vec<_> = g.iter().map(|(h, t)| {
            let kind_idx = match &t.body.kind {
                crate::types::TxKind::Transfer             => 0u32,
                crate::types::TxKind::ValidatorAdd { .. }  => 1,
                crate::types::TxKind::ValidatorRemove { .. } => 2,
                crate::types::TxKind::ValidatorEdit { .. } => 3,
                crate::types::TxKind::GovernorChange { .. } => 4,
                crate::types::TxKind::Staking(_)           => 5,
                crate::types::TxKind::RegisterPayId { .. } => 6,
                crate::types::TxKind::Multisig(_)          => 7,
            };
            (*h, t.body.from, t.body.to, t.body.amount, t.body.fee, t.body.nonce, kind_idx)
        }).collect();
        // Sort by (sender, nonce) for stable display.
        out.sort_by_key(|(_, from, _, _, _, n, _)| (from.0, *n));
        out
    }
}
