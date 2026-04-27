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
//!
//! ## Phase H — fee-priority ordering + drop-lowest-fee eviction
//!
//! Two upgrades vs. the original FIFO+(sender,nonce) pool:
//!
//! - **Eviction**: when the pool is at `max_size` and a new tx arrives, we
//!   compare its `fee` against the cheapest tx currently in the pool. If the
//!   newcomer pays strictly more, the cheapest is evicted to make room
//!   (replace-by-fee against the global minimum). Otherwise the new tx is
//!   rejected. This prevents an attacker from squatting on all 50k slots
//!   with min-fee txs and locking out higher-paying users.
//! - **Block ordering**: `take()` returns txs grouped by sender (so per-sender
//!   nonce ordering is preserved — required for sequential apply), but groups
//!   are sorted by their **maximum fee** descending. Highest-paying senders
//!   land in blocks first, which both maximises validator revenue and gives
//!   honest users a price they can actually pay to clear backlog.

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
        let new_fee = tx.body.fee;
        let mut g = self.inner.write();
        // SECURITY (H1): handle duplicate-hash submission BEFORE running
        // eviction. Without this fast-path, a re-broadcast of an existing
        // tx (very common: wallets retry, peers gossip) would unnecessarily
        // evict an unrelated min-fee tx and then `insert()` would just
        // overwrite the existing entry — net result a free DoS knife
        // against low-fee users. Same hash already in pool ⇒ no-op.
        if g.contains_key(&h) {
            return Ok(h);
        }
        if g.len() >= self.max_size {
            // Replace-by-fee against the cheapest tx in the pool.
            // Without this, an attacker can squat on all 50k slots
            // with min-fee garbage and lock out paying users.
            let min_entry = g.iter()
                .min_by_key(|(_, t)| t.body.fee)
                .map(|(h, t)| (*h, t.body.fee));
            match min_entry {
                Some((min_h, min_fee)) if new_fee > min_fee => {
                    g.remove(&min_h);
                }
                _ => {
                    return Err(anyhow!(
                        "mempool full ({}/{}); incoming fee {} not above min {} — \
                         raise fee to be admitted",
                        g.len(), self.max_size, new_fee,
                        min_entry.map(|(_, f)| f).unwrap_or(0)
                    ));
                }
            }
        }
        g.insert(h, tx);
        // D4 — depth gauge. Pre-registered in metrics.rs::Metrics::new().
        // Bytes gauge intentionally not updated here on the hot insert
        // path: computing bincode::serialized_size on every accepted tx
        // would add ~µs of work to a function called thousands of
        // times per second under flood. Bytes is recomputed in `take()`
        // (≈ once per 5s block) which is plenty of resolution for a
        // capacity-planning gauge.
        crate::metrics::METRICS.set("zvb_mempool_depth", g.len() as u64);
        Ok(h)
    }

    /// Drain up to `max` transactions, ordered for inclusion in the next
    /// block. Per-sender nonce ordering is preserved (required for
    /// sequential apply); senders themselves are ranked by their group's
    /// **highest-fee tx** descending so the most lucrative senders land
    /// first. Within a sender group, txs are kept ascending by nonce.
    pub fn take(&self, max: usize) -> Vec<SignedTx> {
        let mut g = self.inner.write();
        let all: Vec<SignedTx> = g.values().cloned().collect();
        // Group by sender.
        let mut groups: HashMap<[u8; 20], Vec<SignedTx>> = HashMap::new();
        for t in all {
            groups.entry(t.body.from.0).or_default().push(t);
        }
        // Within each group: sort by nonce ascending.
        // Across groups: sort by max-fee in the group, descending.
        let mut ranked: Vec<(u128, Vec<SignedTx>)> = groups
            .into_iter()
            .map(|(_addr, mut txs)| {
                txs.sort_by_key(|t| t.body.nonce);
                let max_fee = txs.iter().map(|t| t.body.fee).max().unwrap_or(0);
                (max_fee, txs)
            })
            .collect();
        ranked.sort_by(|a, b| b.0.cmp(&a.0));
        // Flatten and truncate to `max`.
        let mut out: Vec<SignedTx> = Vec::with_capacity(max);
        for (_fee, mut group) in ranked {
            if out.len() >= max { break; }
            let take_n = (max - out.len()).min(group.len());
            out.extend(group.drain(..take_n));
        }
        for t in &out {
            g.remove(&tx_hash(t).0);
        }
        // D4 — refresh depth + bytes gauges. Cost is bounded: pool is
        // capped at `max_size` (default 50_000) and `take()` runs at most
        // once per `BLOCK_TIME_SECS` (5s) under the legacy producer.
        crate::metrics::METRICS.set("zvb_mempool_depth", g.len() as u64);
        let total_bytes: u64 = g
            .values()
            .map(|t| bincode::serialized_size(t).unwrap_or(0))
            .sum();
        crate::metrics::METRICS.set("zvb_mempool_bytes", total_bytes);
        out
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
                crate::types::TxKind::TokenPoolCreate { .. }          => 15,
                crate::types::TxKind::TokenPoolAddLiquidity { .. }    => 16,
                crate::types::TxKind::TokenPoolRemoveLiquidity { .. } => 17,
                crate::types::TxKind::TokenPoolSwap { .. }            => 18,
                crate::types::TxKind::TokenSetMetadata { .. }         => 19,
            };
            (*h, t.body.from, t.body.to, t.body.amount, t.body.fee, t.body.nonce, kind_idx)
        }).collect();
        // Sort by (sender, nonce) for stable display.
        out.sort_by_key(|(_, from, _, _, _, n, _)| (from.0, *n));
        out
    }
}
