//! FSM runtime adapter (Phase B.3.2.7 — F006.1 scaffold).
//!
//! This module is the **integration layer** between the pure consensus FSM
//! (`crate::fsm`) and the live node services (`State`, `Mempool`,
//! `VotePool`, p2p gossip). It is intentionally *dormant* in this commit:
//!
//! 1. `enabled()` reads `ZEBVIX_FSM_ENABLED` and returns `false` by
//!    default, so existing operators are not auto-upgraded.
//! 2. `FsmRuntime::run` is a stub that immediately panics if invoked. It
//!    is wired up in F006.2 (vote-pool → `FsmEvent` translator), F006.3
//!    (`FsmAction` → I/O sink), F006.4 (startup recovery), F006.5
//!    (observability), and F006.6 (N=1 cadence preservation).
//! 3. Nothing in `main.rs` calls `FsmRuntime::run` yet. The legacy
//!    `Producer::run` continues to drive consensus, byte-identically to
//!    pre-B.3.2.7 behaviour.
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
use std::time::Instant;

use tokio::sync::Mutex;

use crate::consensus::Producer;
use crate::fsm::{FsmState, Timeouts};

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
///
/// Prevote / precommit / commit are not tied to legacy constants
/// because the legacy producer has no analogous step-level timers
/// (it is a single-step propose-then-commit loop with no Tendermint
/// round structure). 2s / 2s / 1s are picked to be conservative
/// defaults safe for N=1 single-validator runs; F006.6 will revisit
/// for N≥2 once we have empirical data from a multi-validator
/// dev-net rehearsal.
///
/// Tunable from env in a future sub-task; for now wired to constants.
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
/// **Note:** in F006.1 this struct only carries the FSM and a proposal
/// rate-limit instant. F006.2 will add a vote-pool watcher; F006.3 will
/// wire the `FsmAction` → I/O sink; F006.4 will add startup recovery
/// from the side-table commit blob.
pub struct FsmRuntime {
    /// The pure consensus FSM. Behind a `Mutex` because event-source and
    /// action-sink tasks may both want to call `step()`. The mutex is
    /// held only for the duration of a single `step()` call (microseconds)
    /// so contention is negligible.
    fsm: Mutex<FsmState>,

    /// The legacy producer. We keep a handle so F006.3 can re-use the
    /// existing `build_block` / signing / broadcast plumbing instead of
    /// duplicating it. Held as `Arc` because both this runtime and the
    /// legacy `Producer::run` task may co-exist during the dormant phase.
    #[allow(dead_code)] // wired up in F006.3
    producer: Arc<Producer>,

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
    pub fn new(producer: Arc<Producer>, start_height: u64) -> Self {
        Self {
            fsm: Mutex::new(FsmState::new(start_height, default_timeouts(), Instant::now())),
            producer,
            last_proposal_at: Mutex::new(Instant::now()),
        }
    }

    /// Run the FSM-driven producer loop. Called only when [`enabled()`]
    /// returns `true` (which is `false` by default in this release).
    ///
    /// **F006.1 stub.** This function is intentionally not yet wired —
    /// the event sources (F006.2), action sink (F006.3), startup
    /// recovery (F006.4), observability (F006.5), and N=1 cadence
    /// preservation (F006.6) all live in subsequent commits. Until then,
    /// invoking `run` is a programmer error: nothing in `main.rs`
    /// constructs an `FsmRuntime` or calls this method, and `enabled()`
    /// stays `false` so even a misconfigured operator cannot trigger it.
    ///
    /// We `panic!` rather than silently returning so a future wiring
    /// mistake (e.g. flipping the env on without the implementation
    /// shipped) fails loud at startup instead of producing a silent
    /// liveness hang.
    pub async fn run(self: Arc<Self>) -> ! {
        let fsm = self.fsm.lock().await;
        let height = fsm.height;
        drop(fsm);
        panic!(
            "fsm_runtime::FsmRuntime::run invoked but F006.2-6 not yet wired \
             (start_height={height}). This is a programmer error — main.rs \
             should not call FsmRuntime::run until B.3.2.7 sub-tasks F006.2 \
             through F006.6 have shipped. See HARDENING_TODO.md §B.3.2.7."
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Acceptance criterion for F006.1: `enabled()` returns `false` in a
    /// `cargo test` environment (no env var set). This is the safety
    /// guarantee that a deployed binary cannot accidentally hand
    /// consensus to the dormant runtime.
    ///
    /// Note: env-var tests are inherently global state. We remove the
    /// var first to defeat any leakage from a peer test in the same
    /// process.
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
    /// "byte-identical to legacy" gating green-light depends on. If
    /// some future patch tunes one of them in isolation this test
    /// blows up so the drift is caught before the operator-visible
    /// flag flip.
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
}
