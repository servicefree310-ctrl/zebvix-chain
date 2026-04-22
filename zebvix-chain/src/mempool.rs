//! Simple in-memory transaction pool.

use crate::crypto::{tx_hash, verify_tx};
use crate::state::State;
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
}
