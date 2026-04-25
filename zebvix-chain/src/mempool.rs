//! Simple in-memory transaction pool.
//!
//! ## Admission rules (hardened in security pass)
//!
//! Every incoming tx must pass ALL of the following before it sits in the
//! mempool — these gates protect against the most common DoS vectors:
//!
//! 1. **Fee floor** — `tx.body.fee >= MIN_TX_FEE_WEI` (static economic gate).
//! 2. **Signature** — full ECDSA-secp256k1 verify (CPU work paid up-front).
//! 3. **Nonce floor** — `tx.body.nonce >= sender's current on-chain nonce`.
//! 4. **Nonce window** — `tx.body.nonce <= cur + MAX_NONCE_GAP` (rejects
//!    nonce-bombing where an attacker fills 50k slots with far-future
//!    nonces that can never actually execute).
//! 5. **Balance** — sender's on-chain balance must cover `amount + fee`.
//!    Without this, an attacker with a valid keypair but zero balance can
//!    fill the mempool with garbage that fails at apply-time.
//!
//! Note: censorship resistance is preserved — there is NO admin/governor
//! filter, no address blacklist, no kind-based gating. Any well-formed,
//! well-funded tx from any signer is accepted.

use crate::crypto::{tx_hash, verify_tx};
use crate::state::State;
use crate::tokenomics::MIN_TX_FEE_WEI;
use crate::types::SignedTx;
use anyhow::{anyhow, Result};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

/// Maximum future-nonce gap allowed in the mempool. Tx with
/// `nonce > cur_nonce + MAX_NONCE_GAP` is rejected — prevents nonce-flooding.
pub const MAX_NONCE_GAP: u64 = 256;

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
        // Look up sender's current on-chain account ONCE (RocksDB read).
        let acc = self.state.account(&tx.body.from);
        let cur_nonce = acc.nonce;
        if tx.body.nonce < cur_nonce {
            return Err(anyhow!("nonce too low: cur {cur_nonce}, got {}", tx.body.nonce));
        }
        // SECURITY (H-4): cap how far into the future a nonce can be.
        // Prevents an attacker from submitting nonces in the millions to
        // saturate mempool slots without intent to ever execute.
        if tx.body.nonce > cur_nonce.saturating_add(MAX_NONCE_GAP) {
            return Err(anyhow!(
                "nonce too far in future: cur {cur_nonce}, got {}, max gap {}",
                tx.body.nonce, MAX_NONCE_GAP
            ));
        }
        // SECURITY (C-5): sender must be able to actually pay this tx.
        // Without this, a zero-balance attacker can flood 50k garbage txs.
        // Note: this is a snapshot check — if the sender's balance drops
        // before block-build time, the tx will still be filtered out by
        // apply_block's pre-validation pass.
        let total = tx.body.amount.checked_add(tx.body.fee)
            .ok_or_else(|| anyhow!("amount+fee overflow"))?;
        if acc.balance < total {
            return Err(anyhow!(
                "insufficient balance: have {} wei, need {} wei (amount + fee)",
                acc.balance, total
            ));
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
                crate::types::TxKind::Swap { .. }          => 8,
                crate::types::TxKind::Bridge(_)            => 9,
                crate::types::TxKind::Proposal(_)          => 10,
                crate::types::TxKind::TokenCreate { .. }   => 11,
                crate::types::TxKind::TokenTransfer { .. } => 12,
                crate::types::TxKind::TokenMint { .. }     => 13,
                crate::types::TxKind::TokenBurn { .. }     => 14,
            };
            (*h, t.body.from, t.body.to, t.body.amount, t.body.fee, t.body.nonce, kind_idx)
        }).collect();
        // Sort by (sender, nonce) for stable display.
        out.sort_by_key(|(_, from, _, _, _, n, _)| (from.0, *n));
        out
    }
}
