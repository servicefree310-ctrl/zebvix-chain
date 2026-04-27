//! FSM runtime adapter (Phase B.3.2.7 — F006.1 → F006.3 ship).
//!
//! This module is the **integration layer** between the pure consensus FSM
//! (`crate::fsm`) and the live node services (`State`, `Mempool`,
//! `VotePool`, p2p gossip). It is intentionally *dormant* in this commit:
//!
//! 1. `enabled()` reads `ZEBVIX_FSM_ENABLED` and returns `false` by
//!    default, so existing operators are not auto-upgraded.
//! 2. `FsmRuntime::run` is a **soft-disabled** loop — it logs a warning
//!    once and then sleeps forever instead of driving consensus. This is
//!    a deliberate design: F006.4 (recovery) and F006.6 (cadence) are
//!    still missing, so even with `enabled()=true` we MUST NOT yet
//!    pre-empt the legacy `Producer::run`. The previous implementation
//!    `panic!`ed in the same situation; replaced because a panic on a
//!    misconfigured operator's startup would crash an otherwise healthy
//!    node — sleeping is strictly safer.
//! 3. Nothing in `main.rs` calls `FsmRuntime::run` yet. The legacy
//!    `Producer::run` continues to drive consensus, byte-identically to
//!    pre-B.3.2.7 behaviour.
//! 4. `handle_action` (F006.3, this commit) **is** wired against the
//!    live `Producer`/`State`/`VotePool` — it is the dispatch surface
//!    F006.4-7 will later drive from `FsmState::step` outputs. It is
//!    callable from unit tests today; production callers will arrive
//!    in F006.4.
//!
//! ## Why a separate adapter?
//! The FSM module (`crate::fsm`) is deliberately pure: no I/O, no async,
//! no networking. Wiring it into the live node requires an adapter that
//! (a) sources `FsmEvent`s from concurrent runtime state (`VotePool`
//! tallies, incoming proposals, the wall clock), and (b) executes the
//! emitted `FsmAction`s against `State::apply_block`, `Mempool`,
//! `crypto::sign`, and the p2p broadcast channel. Keeping the adapter in
//! its own module isolates that I/O surface area from the FSM's safety
//! proofs.
//!
//! ## Activation plan (per `HARDENING_TODO.md` §B.3.2.7)
//! - Dev rehearsal with `ZEBVIX_FSM_ENABLED=false`: byte-identical to
//!   legacy over 1000 blocks (this is the gating green-light).
//! - Dev rehearsal with `ZEBVIX_FSM_ENABLED=true` under N=1: byte-
//!   identical to legacy (1/1 quorum is trivially met every round).
//! - Mainnet deploy with flag OFF, soak ≥ 7 days, then flip ON.
//! - Never flip `ZEBVIX_FSM_ENABLED` and `ZEBVIX_SIGN_HASH_
//!   ACTIVATION_HEIGHT` (C2) on the same restart.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use tokio::sync::Mutex;

use crate::consensus::Producer;
use crate::fsm::{FsmAction, FsmEvent, FsmState, Timeouts};
use crate::state::State;
use crate::types::{Block, Hash};

/// Reads the `ZEBVIX_FSM_ENABLED` env var. Returns `true` only for the
/// canonical truthy strings (`1`, `true`, `yes`, `on` — case-insensitive).
/// Anything else — including unset, empty, malformed, `0`, `false` — is
/// treated as **disabled**. This biases toward the legacy producer being
/// in charge: an operator must take explicit action to opt in.
pub fn enabled() -> bool {
    match std::env::var("ZEBVIX_FSM_ENABLED") {
        Ok(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

/// Default propose / prevote / precommit / commit timeouts used when the
/// FSM runtime is bootstrapped. The propose timeout is tied at
/// **compile time** to the legacy producer's
/// [`crate::consensus::PROPOSE_TIMEOUT_SECS`] so a future operator
/// flipping `ZEBVIX_FSM_ENABLED` cannot silently change the chain's
/// round-bump cadence (architect-review fix from F006.1 evaluation —
/// previous value of 3s was a parity bug against the live constant of
/// 8s). The `parity_with_legacy_propose_timeout` test below enforces
/// this binding so a future change to the legacy constant
/// automatically propagates here, or fails the test if drift is
/// introduced.
fn default_timeouts() -> Timeouts {
    Timeouts {
        propose: std::time::Duration::from_secs(crate::consensus::PROPOSE_TIMEOUT_SECS),
        prevote: std::time::Duration::from_secs(2),
        precommit: std::time::Duration::from_secs(2),
        commit: std::time::Duration::from_secs(1),
    }
}

/// Adapter that owns the live `FsmState` and translates between it and
/// the running node's I/O surfaces.
///
/// **F006.3 surface area:** `handle_action` dispatches every `FsmAction`
/// variant. F006.4 will populate the event-source side (vote-pool watcher
/// + tick clock) and call `handle_action` on each emitted action.
pub struct FsmRuntime {
    /// The pure consensus FSM. Behind a `Mutex` because event-source and
    /// action-sink tasks may both want to call `step()`. The mutex is
    /// held only for the duration of a single `step()` call (microseconds)
    /// so contention is negligible.
    #[allow(dead_code)] // wired up in F006.4 (event sources + tick driver)
    fsm: Mutex<FsmState>,

    /// The legacy producer. We re-use its `build_block` / signing /
    /// broadcast plumbing instead of duplicating it. Held as `Arc`
    /// because both this runtime and the legacy `Producer::run` task
    /// may co-exist during the dormant phase.
    producer: Arc<Producer>,

    /// Direct handle to the live state. Required for `CommitBlock` so we
    /// can call `state.apply_block` without round-tripping through the
    /// `Producer` (which only exposes `build_block`, not `apply_block`).
    /// Held as `Arc` because the same `State` is also held by `Producer`,
    /// the RPC router, the p2p task, and main's BFT-commit task — all
    /// cloning the same `Arc` is the established sharing pattern.
    state: Arc<State>,

    /// In-flight proposal cache populated by `handle_action(BuildProposal)`
    /// and consumed by `handle_action(CommitBlock)`. Without this, a
    /// `CommitBlock { hash }` action could not recover the actual `Block`
    /// bytes to feed into `state.apply_block`. The cache is bounded to
    /// the most-recent proposal — older entries are evicted on overwrite,
    /// matching the FSM's "one proposal per (height, round)" invariant.
    /// `None` means no proposal has been built yet this session.
    current_proposal: Mutex<Option<Block>>,

    /// Wall-clock instant of our last broadcast `BuildProposal` action.
    /// F006.6 will use this to rate-limit consecutive proposals to
    /// `BLOCK_TIME_SECS` (5s) so N=1 timestamps stay stable.
    #[allow(dead_code)] // wired up in F006.6
    last_proposal_at: Mutex<Instant>,
}

impl FsmRuntime {
    /// Construct a fresh runtime starting at `(start_height, round=0,
    /// step=Propose)`. Caller is responsible for choosing
    /// `start_height = state.tip().0 + 1` (with optional recovery
    /// adjustment in F006.4).
    pub fn new(producer: Arc<Producer>, state: Arc<State>, start_height: u64) -> Self {
        Self {
            fsm: Mutex::new(FsmState::new(start_height, default_timeouts(), Instant::now())),
            producer,
            state,
            current_proposal: Mutex::new(None),
            last_proposal_at: Mutex::new(Instant::now()),
        }
    }

    /// **F006.3 — Dispatch a single `FsmAction` against the live node.**
    ///
    /// Returns the list of `FsmEvent`s the runtime should feed back into
    /// `FsmState::step`. The empty vector is a valid return — log-only
    /// actions (`EnteredRound`, `EnteredHeight`) emit nothing.
    ///
    /// **Determinism + safety:**
    /// - `BuildProposal` produces a block via the legacy producer, caches
    ///   it for the matching `CommitBlock`, and emits `ProposalSeen` so
    ///   the FSM advances out of `Step::Propose` without round-tripping
    ///   through gossip (gossip still happens — F006.4 will subscribe to
    ///   the producer's broadcast channel).
    /// - `CommitBlock` requires that the cached proposal's hash matches
    ///   the `hash` argument; mismatch returns `Err` (this is the
    ///   apply-acknowledged contract from `FsmEvent::BlockApplied`'s
    ///   doc-comment — runtime ack must be byte-precise).
    /// - `BroadcastPrevote` / `BroadcastPrecommit` are intentionally
    ///   **log-only stubs** in F006.3 because the live `VotePool` add
    ///   path requires the validator set + chain-id + sign step that
    ///   the legacy `vote_loop` already owns; double-wiring it here
    ///   would risk producing duplicate votes when both paths are live
    ///   during the F006 cutover. F006.4 will replace the stubs with a
    ///   single-source-of-truth gossip path that pre-empts the legacy
    ///   vote_loop the same way it pre-empts the legacy producer.
    pub async fn handle_action(&self, action: FsmAction) -> Result<Vec<FsmEvent>> {
        match action {
            FsmAction::BuildProposal { reuse_valid: _ } => {
                let block = self.producer.build_block()?;
                let hash = crate::crypto::block_hash(&block.header);
                let height = block.header.height;
                // Cache for the upcoming CommitBlock action. We
                // overwrite any previous proposal — the FSM never
                // emits two BuildProposal actions for the same
                // (height, round) so the only legitimate overwrite
                // is a round-bump that supersedes the prior block.
                *self.current_proposal.lock().await = Some(block);
                *self.last_proposal_at.lock().await = Instant::now();
                Ok(vec![FsmEvent::ProposalSeen {
                    height,
                    round: 0,
                    block_hash: hash,
                }])
            }
            FsmAction::CommitBlock { height, hash } => {
                let cached = self.current_proposal.lock().await.take();
                let block = cached.ok_or_else(|| {
                    anyhow!(
                        "fsm_runtime: CommitBlock(h={height}, hash={hash}) but no proposal cached \
                         (F006.4 will source committed blocks from the gossip cache)"
                    )
                })?;
                let cached_hash = crate::crypto::block_hash(&block.header);
                if cached_hash != hash {
                    return Err(anyhow!(
                        "fsm_runtime: CommitBlock hash mismatch (cached={cached_hash}, requested={hash})"
                    ));
                }
                self.state.apply_block(&block)?;
                Ok(vec![FsmEvent::BlockApplied { height, hash }])
            }
            FsmAction::BroadcastPrevote { target } => {
                tracing::debug!(
                    "fsm_runtime: BroadcastPrevote stub (target={:?}) — gossip via legacy vote_loop",
                    target
                );
                Ok(vec![])
            }
            FsmAction::BroadcastPrecommit { target } => {
                tracing::debug!(
                    "fsm_runtime: BroadcastPrecommit stub (target={:?}) — gossip via legacy vote_loop",
                    target
                );
                Ok(vec![])
            }
            FsmAction::EnteredRound { height, round } => {
                tracing::info!("fsm_runtime: entered round h={height} r={round}");
                Ok(vec![])
            }
            FsmAction::EnteredHeight { height } => {
                tracing::info!("fsm_runtime: entered height h={height}");
                Ok(vec![])
            }
        }
    }

    /// Soft-disabled FSM loop. Called only when [`enabled()`] returns
    /// `true` (which is `false` by default in this release).
    ///
    /// **Why warn-and-sleep instead of panic:** F006.4 (startup
    /// recovery) and F006.6 (N=1 cadence preservation) are not yet
    /// shipped, so we MUST NOT yet pre-empt the legacy producer even
    /// when `enabled()=true` — doing so would risk a divergent height
    /// or a missed-round timestamp on N=1. The previous implementation
    /// `panic!`ed in this branch; that crashed an otherwise healthy
    /// node when an operator flipped the env on prematurely. The
    /// warn + sleep loop is strictly safer: legacy `Producer::run`
    /// continues to drive consensus byte-identically while this task
    /// idles. No `_` patterns: we explicitly hold the runtime alive
    /// (`self`) so its `Arc` references to `Producer` / `State` are
    /// not dropped, ensuring deterministic shutdown ordering.
    pub async fn run(self: Arc<Self>) {
        let height = {
            let fsm = self.fsm.lock().await;
            fsm.height
        };
        tracing::warn!(
            "⚠  fsm_runtime::run invoked (start_height={height}) but F006.4-7 \
             not yet shipped — running soft-disabled idle loop. Legacy \
             Producer::run continues to drive consensus. To re-disable, \
             unset ZEBVIX_FSM_ENABLED and restart. See HARDENING_TODO.md \
             §B.3.2.7."
        );
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::generate_keypair;
    use crate::mempool::Mempool;
    use crate::types::Validator;
    use tempfile::TempDir;

    /// Acceptance criterion for F006.1: `enabled()` returns `false` in a
    /// `cargo test` environment (no env var set). This is the safety
    /// guarantee that a deployed binary cannot accidentally hand
    /// consensus to the dormant runtime.
    #[test]
    fn enabled_defaults_to_false() {
        std::env::remove_var("ZEBVIX_FSM_ENABLED");
        assert!(
            !enabled(),
            "FSM runtime must be dormant by default — operator must opt in"
        );
    }

    /// `default_timeouts()` returns sane non-zero values. A zero timeout
    /// would cause the FSM to immediately bump rounds on the first tick,
    /// stalling consensus.
    #[test]
    fn default_timeouts_are_nonzero() {
        let t = default_timeouts();
        assert!(t.propose.as_millis() > 0);
        assert!(t.prevote.as_millis() > 0);
        assert!(t.precommit.as_millis() > 0);
        assert!(t.commit.as_millis() > 0);
    }

    /// Architect-review parity guard (F006.1 fix). The FSM runtime's
    /// `propose` timeout MUST equal the legacy producer's
    /// `consensus::PROPOSE_TIMEOUT_SECS` — that is the contract the
    /// "byte-identical to legacy" gating green-light depends on.
    #[test]
    fn parity_with_legacy_propose_timeout() {
        let t = default_timeouts();
        let legacy = std::time::Duration::from_secs(crate::consensus::PROPOSE_TIMEOUT_SECS);
        assert_eq!(
            t.propose, legacy,
            "FSM propose timeout drifted from legacy PROPOSE_TIMEOUT_SECS \
             — N=1 cadence preservation (F006.6) will fail. Update both \
             values in lockstep or document the intentional divergence."
        );
    }

    /// Build a real `(Producer, State)` pair against a fresh RocksDB
    /// tempdir with one validator registered. Returns the secret so
    /// callers can sign blocks.
    fn fresh_runtime_fixture() -> (TempDir, Arc<FsmRuntime>, [u8; 32]) {
        let td = TempDir::new().unwrap();
        let state = Arc::new(State::open(td.path()).unwrap());
        let (sk, pk) = generate_keypair();
        let v = Validator::new(pk, 10);
        state.put_validator(&v).unwrap();
        let mempool = Arc::new(Mempool::new(50_000));
        let producer = Arc::new(Producer::new(sk, state.clone(), mempool));
        let start_height = state.tip().0 + 1;
        let rt = Arc::new(FsmRuntime::new(producer, state, start_height));
        (td, rt, sk)
    }

    /// F006.3 dispatch test — `EnteredRound` + `EnteredHeight` are
    /// log-only and must return an empty event vector without error.
    #[tokio::test(flavor = "current_thread")]
    async fn handle_action_log_only_variants_are_silent() {
        let (_td, rt, _sk) = fresh_runtime_fixture();
        let evs = rt.handle_action(FsmAction::EnteredRound { height: 1, round: 0 })
            .await
            .expect("EnteredRound must succeed");
        assert!(evs.is_empty(), "EnteredRound must emit no events");

        let evs = rt.handle_action(FsmAction::EnteredHeight { height: 2 })
            .await
            .expect("EnteredHeight must succeed");
        assert!(evs.is_empty(), "EnteredHeight must emit no events");

        let evs = rt.handle_action(FsmAction::BroadcastPrevote { target: None })
            .await
            .expect("BroadcastPrevote stub must succeed");
        assert!(evs.is_empty(), "BroadcastPrevote stub must emit no events");

        let evs = rt.handle_action(FsmAction::BroadcastPrecommit { target: None })
            .await
            .expect("BroadcastPrecommit stub must succeed");
        assert!(evs.is_empty(), "BroadcastPrecommit stub must emit no events");
    }

    /// F006.3 dispatch test — `BuildProposal` produces a real block and
    /// emits a matching `ProposalSeen` event whose `block_hash` matches
    /// the cached proposal.
    #[tokio::test(flavor = "current_thread")]
    async fn handle_action_build_proposal_emits_proposal_seen() {
        let (_td, rt, _sk) = fresh_runtime_fixture();
        let evs = rt.handle_action(FsmAction::BuildProposal { reuse_valid: None })
            .await
            .expect("BuildProposal must succeed against a live producer");
        assert_eq!(evs.len(), 1, "BuildProposal must emit exactly one event");
        match &evs[0] {
            FsmEvent::ProposalSeen { height, block_hash, .. } => {
                assert_eq!(*height, 1, "first proposal must be at height 1");
                let cached = rt.current_proposal.lock().await;
                let cached_block = cached.as_ref().expect("proposal must be cached");
                let cached_hash = crate::crypto::block_hash(&cached_block.header);
                assert_eq!(*block_hash, cached_hash, "emitted hash must match cached block");
            }
            other => panic!("expected ProposalSeen, got {other:?}"),
        }
    }

    /// F006.3 dispatch test — `CommitBlock` after a matching
    /// `BuildProposal` applies the block to state and emits
    /// `BlockApplied`. CommitBlock with no cached proposal must error
    /// (this is the F006.4 dependency the doc-comment calls out).
    #[tokio::test(flavor = "current_thread")]
    async fn handle_action_commit_block_applies_cached_proposal() {
        let (_td, rt, _sk) = fresh_runtime_fixture();
        // 1. Cache a proposal via BuildProposal.
        let evs = rt.handle_action(FsmAction::BuildProposal { reuse_valid: None })
            .await
            .unwrap();
        let (h, hash) = match &evs[0] {
            FsmEvent::ProposalSeen { height, block_hash, .. } => (*height, *block_hash),
            _ => unreachable!(),
        };
        // 2. Commit it — must apply to state and emit BlockApplied.
        let evs = rt.handle_action(FsmAction::CommitBlock { height: h, hash })
            .await
            .expect("CommitBlock with cached proposal must succeed");
        assert_eq!(evs.len(), 1);
        assert!(matches!(evs[0], FsmEvent::BlockApplied { .. }));
        assert_eq!(rt.state.tip().0, h, "state tip must advance to committed height");

        // 3. Second CommitBlock without a fresh BuildProposal must
        //    error (cache is single-shot — F006.4 will revisit).
        let err = rt.handle_action(FsmAction::CommitBlock { height: h + 1, hash })
            .await
            .expect_err("CommitBlock without cached proposal must error");
        assert!(format!("{err}").contains("no proposal cached"), "got: {err}");
    }
}
