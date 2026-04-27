//! Block production: round-robin proposer + state-machine timeouts (B.3.2.2).
//!
//! Phase B.3.2 milestone 2: adds Tendermint-style round bumping on propose
//! timeout. If the elected proposer at (height H, round 0) does not get a
//! block committed within `PROPOSE_TIMEOUT_SECS`, every node bumps its
//! local round to 1 and re-elects via `who_proposes(H, 1)`. This rotates
//! through validators until SOMEONE proposes for height H — restoring
//! liveness when a single validator is offline.
//!
//! Round 0 still respects the natural `BLOCK_TIME_SECS` pacing so the chain
//! doesn't burn through heights too fast. Recovery rounds (≥1) propose
//! immediately for fast catch-up.
//!
//! 2/3+ commit gate (B.3.2.3) and `LastCommit` (B.3.2.4) come next.

use crate::crypto::{address_from_pubkey, block_hash, header_signing_bytes, keypair_from_secret, sign_bytes};
use crate::mempool::Mempool;
use crate::state::State;
use crate::tokenomics::BLOCK_TIME_SECS;
use crate::types::{Address, Block, BlockHeader, Hash, Validator};
use crate::vote::VotePool;
use anyhow::Result;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc::UnboundedSender;

pub const MAX_TXS_PER_BLOCK: usize = 5_000;

/// How long we wait for the round-`r` proposer at a given height before
/// bumping to round r+1. Must be ≥ `BLOCK_TIME_SECS` so the round-0 proposer
/// has time to produce a block under healthy conditions.
pub const PROPOSE_TIMEOUT_SECS: u64 = 8;

/// State-machine wake interval. Finer than block time so timeouts fire
/// promptly without busy-waiting.
pub const TICK_INTERVAL_MS: u64 = 500;

/// Deterministic round-robin proposer election with round support.
///
/// `validators` MUST be sorted by address (as `State::validators()` returns).
/// Returns `None` if the registry is empty.
///
/// Selection: `validators[(height + round) % validators.len()]`. With 2
/// validators, round 0 alternates by parity; round 1 flips that parity
/// (so a stuck round-0 proposer is replaced by the OTHER validator at r=1).
pub fn who_proposes(height: u64, round: u32, validators: &[Validator]) -> Option<Address> {
    if validators.is_empty() {
        return None;
    }
    let idx = (height as usize).wrapping_add(round as usize) % validators.len();
    Some(validators[idx].address)
}

pub struct Producer {
    secret: [u8; 32],
    state: Arc<State>,
    mempool: Arc<Mempool>,
    /// Optional P2P broadcast channel: when set, every successfully-mined block
    /// is bincode-serialized and pushed here for gossip propagation.
    block_broadcast: Option<UnboundedSender<Vec<u8>>>,
    /// **Phase B.3.2.4** — Optional vote pool. Plumbed in but not consulted
    /// by `build_block` itself: in the side-table architecture, the BFT
    /// commit blob for a JUST-COMMITTED block is written to
    /// `State::put_bft_commit` by the vote-handling tasks in `main.rs`
    /// (`try_persist_bft_commit_for`) on every `Inserted { reached_quorum:
    /// true }` for a Precommit. `Block` itself stays byte-stable (no
    /// LastCommit field), so upgrading binaries does not break existing
    /// RocksDB data — Phase 2 wiring is fully out-of-band.
    vote_pool: Option<Arc<VotePool>>,
}

impl Producer {
    pub fn new(secret: [u8; 32], state: Arc<State>, mempool: Arc<Mempool>) -> Self {
        Self { secret, state, mempool, block_broadcast: None, vote_pool: None }
    }

    pub fn with_broadcast(mut self, tx: UnboundedSender<Vec<u8>>) -> Self {
        self.block_broadcast = Some(tx);
        self
    }

    /// Phase B.3.2.4 — wire a shared `VotePool`. The producer does not pack
    /// votes into the block (Block schema is byte-stable to avoid forced DB
    /// wipes). The pool is held here for symmetry with future round-driven
    /// proposal logic; per-block commit persistence happens in main.rs's
    /// vote tasks via `try_persist_bft_commit_for` (Phase B.3.2.5 / Phase 2).
    pub fn with_vote_pool(mut self, vp: Arc<VotePool>) -> Self {
        self.vote_pool = Some(vp);
        self
    }

    pub fn proposer_address(&self) -> crate::types::Address {
        // The validator secret was loaded + validated at node startup
        // (cmd_start in main.rs constructs Producer only after a successful
        // keypair derivation). If we somehow got here with a corrupt secret
        // the only safe action is to abort — block production cannot
        // proceed without a stable proposer identity.
        let (_, pk) = keypair_from_secret(&self.secret)
            .expect("Producer constructed with pre-validated secret (see cmd_start)");
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

        // Phase B.3.3 — populate state_root with the parent's post-state
        // (Tendermint AppHash convention). Until activation height is
        // reached on a given chain, fall back to ZERO for backward compat
        // with already-mined blocks.
        let state_root = if next_height >= *crate::state::STATE_ROOT_ACTIVATION_HEIGHT {
            self.state.compute_state_root()
        } else {
            Hash::ZERO
        };

        // Phase B.3.2.4 — Block schema stays byte-stable. The parent's
        // BFT commit (when produced) lives in the side table at
        // `bft/c/<parent_hash>` in CF_META, not inside this Block.
        let header = BlockHeader {
            height: next_height,
            parent_hash: parent,
            state_root,
            tx_root,
            timestamp_ms: Self::now_ms(),
            proposer: self.proposer_address(),
        };
        let sig = sign_bytes(&self.secret, &header_signing_bytes(&header))?;
        let block = Block { header, txs, signature: sig };
        let _ = block_hash(&block.header);
        Ok(block)
    }

    pub async fn run(self: Arc<Self>) {
        let mut ticker = tokio::time::interval(Duration::from_millis(TICK_INTERVAL_MS));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let me = self.proposer_address();
        tracing::info!(
            "⛏  producer started: my_address={me}, mode=ROUND_ROBIN+TIMEOUTS (B.3.2.2) \
             pacing={}s propose_timeout={}s tick={}ms",
            BLOCK_TIME_SECS, PROPOSE_TIMEOUT_SECS, TICK_INTERVAL_MS
        );

        // ── State-machine local state (per-node) ──
        let mut current_height: u64 = 0;
        let mut current_round: u32 = 0;
        let mut round_started_at: Instant = Instant::now();
        // Guard so we don't repeatedly re-produce the same (h, r).
        let mut produced_at: Option<(u64, u32)> = None;

        loop {
            ticker.tick().await;

            let (tip_h, _) = self.state.tip();
            let next_height = tip_h + 1;

            // ── 1. Detect tip advance ──
            // Some node (maybe us, maybe a peer) committed a block. Reset to
            // round 0 of the new height.
            if next_height != current_height {
                if current_height != 0 && current_round > 0 {
                    tracing::info!(
                        "✓ height advanced to {next_height} (recovered after r={current_round} at h={current_height})"
                    );
                }
                current_height = next_height;
                current_round = 0;
                round_started_at = Instant::now();
                produced_at = None;
            } else if round_started_at.elapsed() >= Duration::from_secs(PROPOSE_TIMEOUT_SECS) {
                // ── 2. Propose timeout — bump round ──
                let prev_round = current_round;
                current_round += 1;
                round_started_at = Instant::now();
                produced_at = None;
                tracing::warn!(
                    "⏰ propose timeout at h={current_height} r={prev_round} → bumping to r={current_round}"
                );
            }

            // ── 3. Re-read validator set every tick (live registry updates) ──
            let validators = self.state.validators();
            let elected = match who_proposes(current_height, current_round, &validators) {
                Some(a) => a,
                None => {
                    tracing::warn!("⏸  h={current_height} r={current_round}: no validators");
                    continue;
                }
            };

            if elected != me {
                continue; // not my turn this round
            }

            // ── 4. Don't re-produce same (h, r) ──
            if produced_at == Some((current_height, current_round)) {
                continue;
            }

            // ── 5. Pacing: round 0 honours BLOCK_TIME_SECS;
            //    recovery rounds (≥1) propose immediately ──
            if current_round == 0
                && round_started_at.elapsed() < Duration::from_secs(BLOCK_TIME_SECS)
            {
                continue;
            }

            // ── 6. Build & broadcast block ──
            match self.build_block() {
                Ok(block) => {
                    let height = block.header.height;
                    let txs = block.txs.len();
                    // Mark attempted so we don't loop on a flaky apply.
                    produced_at = Some((current_height, current_round));
                    if let Err(e) = self.state.apply_block(&block) {
                        tracing::error!("apply_block failed at h={height} r={current_round}: {e}");
                    } else {
                        tracing::info!(
                            "⛏  block #{height} produced  proposer={me}  round={current_round}  txs={txs}  hash={}",
                            block_hash(&block.header)
                        );
                        if let Some(tx) = &self.block_broadcast {
                            match bincode::serialize(&block) {
                                Ok(bytes) => { let _ = tx.send(bytes); }
                                Err(e) => tracing::warn!("p2p block serialize failed: {e}"),
                            }
                        }
                    }
                }
                Err(e) => tracing::error!("build_block failed at h={current_height} r={current_round}: {e}"),
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
        Validator { address: addr, pubkey: [addr_byte; 33], voting_power: 1 }
    }

    #[test]
    fn round_robin_two_validators_round_zero() {
        let mut vs = vec![mk_validator(0xaa), mk_validator(0x11)];
        vs.sort_by_key(|v| v.address.0);
        // sorted: [0x11, 0xaa]
        assert_eq!(who_proposes(0, 0, &vs).unwrap().0[0], 0x11);
        assert_eq!(who_proposes(1, 0, &vs).unwrap().0[0], 0xaa);
        assert_eq!(who_proposes(2, 0, &vs).unwrap().0[0], 0x11);
        assert_eq!(who_proposes(3, 0, &vs).unwrap().0[0], 0xaa);
    }

    #[test]
    fn round_one_flips_proposer() {
        // With 2 validators, round 1 must elect the OTHER validator
        // (so a stuck round-0 proposer is replaced).
        let mut vs = vec![mk_validator(0xaa), mk_validator(0x11)];
        vs.sort_by_key(|v| v.address.0);
        for h in 0..6u64 {
            let r0 = who_proposes(h, 0, &vs).unwrap();
            let r1 = who_proposes(h, 1, &vs).unwrap();
            assert_ne!(r0, r1, "h={h}: round 0 and round 1 must differ for 2 validators");
        }
    }

    #[test]
    fn empty_registry_returns_none() {
        assert!(who_proposes(42, 0, &[]).is_none());
        assert!(who_proposes(42, 7, &[]).is_none());
    }

    #[test]
    fn deterministic_three_validators_with_rounds() {
        let mut vs = vec![mk_validator(0x33), mk_validator(0x11), mk_validator(0x22)];
        vs.sort_by_key(|v| v.address.0);
        // sorted: [0x11, 0x22, 0x33]
        // (h+r) % 3 picks the proposer
        assert_eq!(who_proposes(0, 0, &vs).unwrap().0[0], 0x11);
        assert_eq!(who_proposes(0, 1, &vs).unwrap().0[0], 0x22);
        assert_eq!(who_proposes(0, 2, &vs).unwrap().0[0], 0x33);
        assert_eq!(who_proposes(0, 3, &vs).unwrap().0[0], 0x11); // wraps
        assert_eq!(who_proposes(5, 1, &vs).unwrap().0[0], 0x11); // (5+1)%3=0
    }
}
