//! Tendermint-style consensus FSM (Phase B.3.2.6).
//!
//! This module is **pure**: no I/O, no async, no networking. The FSM is a
//! deterministic state machine that consumes [`FsmEvent`]s and produces
//! [`FsmAction`]s. The runtime layer (`main.rs`, in a follow-up session)
//! is responsible for sourcing events from the live `VotePool` + p2p
//! gossip, and executing the emitted actions against `State`/`Mempool`/p2p.
//!
//! ## Why pure?
//! Consensus correctness is the single most fragile part of any blockchain
//! codebase. Bugs are usually impossible to reproduce, hard to test, and
//! catastrophic when they hit production (forks, double-spends, stalls).
//! By separating decision-making from I/O we get:
//!
//!   1. Exhaustive unit tests for every transition without spinning up
//!      RocksDB / sockets / threads.
//!   2. Re-playable execution: a captured trace of `FsmEvent`s deterministi-
//!      cally reconstructs the same chain of `FsmAction`s, which makes
//!      post-mortems tractable.
//!   3. Clean architectural boundary: the integration layer can be swapped
//!      (single-validator legacy / FSM-driven multi-validator) behind an env
//!      flag without touching this module.
//!
//! ## State model
//! For each height `H` the FSM cycles through rounds `R = 0, 1, 2, ...`.
//! Each round walks the steps Propose → Prevote → Precommit. A successful
//! round terminates in Commit, which advances the height. Stuck rounds
//! (no proposal, no prevote quorum, no precommit quorum) bump the round
//! via timeout, electing a new proposer.
//!
//! ## Lock-on-precommit (POL — Proof Of Lock)
//! Once a validator broadcasts `Precommit(hash)` in round R it becomes
//! "locked" on `(R, hash)`. In all subsequent rounds at the same height,
//! the validator MUST either prevote the locked hash again, or prevote
//! `nil`. The lock is released only when the validator observes
//! `2/3+` Prevotes in some round `R' > locked.round` for a different block
//! (Proof Of Lock). This is the safety property that prevents two
//! conflicting blocks from both gathering a precommit quorum at the same
//! height — the foundation of Tendermint-style BFT.
//!
//! ## Valid block tracking
//! Independent of locking: whenever the FSM sees `2/3+` Prevotes for some
//! block in any round, it remembers it as the "valid block". A future
//! proposer for the same height re-proposes the valid block (instead of
//! building a fresh one) when one exists, so the chain converges on a
//! single canonical proposal even after multiple round bumps.
//!
//! ## View-change (round skip)
//! Observing any vote message from `2/3+` validators in some `round > self.round`
//! triggers an immediate jump to that round (Tendermint's "f+1 messages
//! from higher round" trigger). This dramatically improves liveness when
//! the local node falls behind the consensus.
//!
//! ## Timeouts
//! Each step has its own configurable duration:
//!   - `propose`: how long to wait for proposer's block (then prevote nil/locked)
//!   - `prevote`: how long to wait for prevote quorum (then precommit nil)
//!   - `precommit`: how long to wait for precommit quorum (then bump round)
//!   - `commit`: pause after commit before starting next height (prevents
//!               flooding the network at the moment of state transition)
//!
//! ## N=1 single-validator compatibility
//! Under N=1 the lone validator is always the proposer, and any vote it
//! casts trivially achieves 1/1 = 100% > 2/3 quorum. The FSM therefore
//! sails straight through Propose → Prevote → Precommit → Commit on every
//! height with zero waiting, exactly mirroring the legacy PoA path.
//!
//! ## Integration
//! See task F006 (next session) for runtime wiring. The pure FSM ships in
//! this session as dead code (compiled, tested, never invoked from main)
//! so it can be reviewed in isolation before touching the producer loop.

use crate::types::Hash;
use std::time::{Duration, Instant};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/// Position within a single round's lifecycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// Waiting for the elected proposer's block (or building it if we are
    /// the proposer ourselves). Exits via [`FsmEvent::ProposalSeen`] or
    /// the propose-timeout tick.
    Propose,
    /// Prevote already broadcast; waiting for `2/3+` prevote quorum on
    /// some target. Exits on quorum or via the prevote-timeout tick.
    Prevote,
    /// Precommit already broadcast; waiting for `2/3+` precommit quorum
    /// on some target. Exits on commit, nil quorum, or precommit-timeout
    /// (which bumps the round).
    Precommit,
    /// Block has been committed for this height. After [`Timeouts::commit`]
    /// the FSM advances to height + 1 round 0.
    Commit,
}

/// A block we have already precommitted in some past round at the current
/// height. We must keep prevoting this hash (or nil) in future rounds until
/// we observe a Proof Of Lock (POL) for some other block at a strictly
/// higher round.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LockedBlock {
    pub round: u32,
    pub hash: Hash,
}

/// A block we have observed `2/3+` prevotes for in some past round at the
/// current height. The next proposer that we elect should re-propose this
/// block to converge consensus, even though we may not have precommitted
/// it ourselves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ValidBlock {
    pub round: u32,
    pub hash: Hash,
}

/// Per-step durations. Defaults match the existing PoA pacing
/// (`PROPOSE_TIMEOUT_SECS = 8`) so a switch from legacy to FSM does not
/// silently change the chain's block cadence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Timeouts {
    pub propose: Duration,
    pub prevote: Duration,
    pub precommit: Duration,
    pub commit: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            propose: Duration::from_secs(8),
            prevote: Duration::from_secs(2),
            precommit: Duration::from_secs(2),
            commit: Duration::from_secs(1),
        }
    }
}

/// Full FSM state. Cheap to clone; cheap to construct.
#[derive(Clone, Debug)]
pub struct FsmState {
    pub height: u64,
    pub round: u32,
    pub step: Step,
    /// Wall-clock instant the current step was entered. Used for timeout
    /// comparisons against `Tick(now)` events.
    pub step_started_at: Instant,
    pub locked: Option<LockedBlock>,
    pub valid: Option<ValidBlock>,
    /// Hash of the proposal we have observed for the current round (if any).
    /// Cleared when entering a new round.
    pub proposal: Option<Hash>,
    /// Hash of the block we have asked the runtime to apply via
    /// [`FsmAction::CommitBlock`]. Cleared on [`FsmEvent::BlockApplied`].
    /// While `Some`, the FSM stays in [`Step::Commit`] and refuses to
    /// advance height — the runtime MUST acknowledge a successful apply
    /// before we move on. This eliminates the optimistic-advance hazard
    /// raised by the architect review (split between commit-observed and
    /// commit-applied events).
    pub committing: Option<Hash>,
    pub timeouts: Timeouts,
}

impl FsmState {
    /// Initialise at `(height, round=0, step=Propose)`. The runtime should
    /// construct this once on node start and feed it events thereafter.
    pub fn new(height: u64, timeouts: Timeouts, now: Instant) -> Self {
        Self {
            height,
            round: 0,
            step: Step::Propose,
            step_started_at: now,
            locked: None,
            valid: None,
            proposal: None,
            committing: None,
            timeouts,
        }
    }

    /// Start a fresh round inside the current height (used by view-change
    /// and propose/prevote/precommit timeouts). Resets `proposal` and step;
    /// preserves `locked` and `valid` (those are height-scoped, not
    /// round-scoped). `committing` is also preserved — once we've asked the
    /// runtime to apply a block we must NOT round-bump away from
    /// [`Step::Commit`] (the round-bump path explicitly refuses to leave
    /// Commit while `committing.is_some()`).
    fn enter_round(&mut self, new_round: u32, now: Instant) {
        self.round = new_round;
        self.step = Step::Propose;
        self.step_started_at = now;
        self.proposal = None;
    }

    /// Move to the next height — clears all height-scoped state.
    fn enter_height(&mut self, new_height: u64, now: Instant) {
        self.height = new_height;
        self.round = 0;
        self.step = Step::Propose;
        self.step_started_at = now;
        self.locked = None;
        self.valid = None;
        self.proposal = None;
        self.committing = None;
    }

    fn enter_step(&mut self, step: Step, now: Instant) {
        self.step = step;
        self.step_started_at = now;
    }
}

/// External signals the runtime feeds into the FSM. The runtime is
/// responsible for deduplicating / debouncing — `step()` may be called
/// repeatedly with the same event without changing FSM behaviour.
///
/// **Height binding (B.3.2.6 architect-review fix):** every event except
/// `Tick` carries the explicit `height` it pertains to. The FSM silently
/// drops any event whose `height` does not match `self.height`. This is
/// the runtime's safety net against misrouted stale or future-height
/// quorum signals — even a buggy plumbing layer cannot trick the FSM
/// into committing the wrong height's block.
#[derive(Clone, Debug)]
pub enum FsmEvent {
    /// Periodic wake. Used purely for timeout enforcement.
    Tick(Instant),
    /// A proposal block has appeared on the wire (or we built one ourselves).
    ProposalSeen { height: u64, round: u32, block_hash: Hash },
    /// Vote pool has crossed the `2/3+` threshold for prevotes of `target`
    /// in `round`. `target = None` represents a nil-prevote quorum (no
    /// block agreed on this round).
    PrevoteQuorum { height: u64, round: u32, target: Option<Hash> },
    /// Vote pool has crossed the `2/3+` threshold for precommits of `target`
    /// in `round`.
    PrecommitQuorum { height: u64, round: u32, target: Option<Hash> },
    /// `f+1` validators (i.e. enough to force a round-skip) have voted at
    /// some `round` strictly greater than `self.round`. Triggers a fast
    /// jump to that round per Tendermint's view-change rule.
    HigherRoundSeen { height: u64, round: u32 },
    /// Runtime has successfully applied the committed block to local state
    /// (and persisted the side-table commit blob). Releases the FSM from
    /// `Step::Commit` and advances to `height + 1`. The `hash` is checked
    /// against `self.committing` so a misrouted ack cannot advance us
    /// over the wrong block.
    BlockApplied { height: u64, hash: Hash },
}

/// Side effects the runtime is expected to perform after each [`FsmState::step`]
/// call. Actions are returned in the order they should be executed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FsmAction {
    /// We are the elected proposer for the current round. Build a block
    /// (re-using `valid.hash` if `Some`, else a fresh one from the mempool),
    /// gossip it, and feed `ProposalSeen` back into the FSM.
    BuildProposal { reuse_valid: Option<Hash> },
    /// Sign + gossip a Prevote with the given target. `None` = nil prevote.
    BroadcastPrevote { target: Option<Hash> },
    /// Sign + gossip a Precommit with the given target. `None` = nil precommit.
    BroadcastPrecommit { target: Option<Hash> },
    /// We have a quorum of precommits for this hash at the current
    /// (height, round) — the runtime must apply the corresponding block to
    /// `State` (and persist the side-table commit blob, as today's
    /// `try_persist_bft_commit_for` already does on `PrecommitQuorum`).
    CommitBlock { height: u64, hash: Hash },
    /// Round changed (via timeout or view-change). The runtime should re-
    /// elect the proposer and decide whether to feed `BuildProposal` back.
    EnteredRound { height: u64, round: u32 },
    /// Height advanced after a successful commit. The runtime should re-
    /// load the validator set for the new height (validator-set updates
    /// land at height boundaries).
    EnteredHeight { height: u64 },
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision logic
// ─────────────────────────────────────────────────────────────────────────────

/// Pick the prevote target for a freshly-seen proposal, respecting the
/// safety rule: a locked validator may only prevote the locked block (or
/// `nil`), never a different block, until POL releases the lock.
///
/// Pure helper; tested directly.
pub fn prevote_target_for_proposal(
    proposal_hash: Hash,
    locked: Option<LockedBlock>,
    proposal_is_valid: bool,
) -> Option<Hash> {
    if !proposal_is_valid {
        // Invalid block: vote nil regardless of lock state.
        return None;
    }
    match locked {
        None => Some(proposal_hash),
        Some(lock) => {
            if lock.hash == proposal_hash {
                Some(proposal_hash)
            } else {
                // Locked on a different block — Tendermint safety rule:
                // prevote nil. We will retry the locked hash next round
                // via the propose-timeout path.
                None
            }
        }
    }
}

/// Pick the prevote target on propose-timeout (no proposal received in
/// time). If we hold a lock, we keep voting the locked hash; otherwise nil.
pub fn prevote_target_on_timeout(locked: Option<LockedBlock>) -> Option<Hash> {
    locked.map(|l| l.hash)
}

impl FsmState {
    /// Process a single event. Returns the actions the runtime should
    /// perform, in order.
    ///
    /// `am_proposer` is set by the caller using `who_proposes(self.height,
    /// self.round, &validators)` — the FSM does not own the validator set
    /// because that data flips mid-run via on-chain registration txs.
    ///
    /// **Height filter (architect-review fix):** every non-Tick event must
    /// match `self.height`. Mismatched events are silently dropped — this
    /// prevents a misrouted stale or future-height vote pool signal from
    /// committing the wrong block. The runtime layer is encouraged to
    /// log dropped events at DEBUG so plumbing bugs are still observable.
    pub fn step(
        &mut self,
        event: FsmEvent,
        am_proposer: bool,
        now: Instant,
    ) -> Vec<FsmAction> {
        // Extract the event's claimed height (Tick is height-agnostic).
        let event_height = match &event {
            FsmEvent::Tick(_) => self.height,
            FsmEvent::ProposalSeen { height, .. } => *height,
            FsmEvent::PrevoteQuorum { height, .. } => *height,
            FsmEvent::PrecommitQuorum { height, .. } => *height,
            FsmEvent::HigherRoundSeen { height, .. } => *height,
            FsmEvent::BlockApplied { height, .. } => *height,
        };
        if event_height != self.height {
            // Wrong-height event: silently drop. Do NOT panic — the
            // runtime is allowed to be eventually-consistent about which
            // height it is feeding, as long as the FSM stays authoritative.
            return Vec::new();
        }

        match event {
            FsmEvent::Tick(_) => self.on_tick(am_proposer, now),
            FsmEvent::ProposalSeen { round, block_hash, .. } => {
                self.on_proposal(round, block_hash, now)
            }
            FsmEvent::PrevoteQuorum { round, target, .. } => {
                self.on_prevote_quorum(round, target, now)
            }
            FsmEvent::PrecommitQuorum { round, target, .. } => {
                self.on_precommit_quorum(round, target, now)
            }
            FsmEvent::HigherRoundSeen { round, .. } => {
                self.on_higher_round(round, am_proposer, now)
            }
            FsmEvent::BlockApplied { hash, .. } => self.on_block_applied(hash, now),
        }
    }

    fn on_tick(&mut self, am_proposer: bool, now: Instant) -> Vec<FsmAction> {
        let elapsed = now.saturating_duration_since(self.step_started_at);
        let mut actions = Vec::new();

        match self.step {
            Step::Propose => {
                // If we are the proposer and have not yet emitted a
                // BuildProposal for this (h, r), do it now. We rely on the
                // runtime to feed `ProposalSeen` back once the block is
                // built — at that point we leave Propose.
                if am_proposer && self.proposal.is_none() {
                    actions.push(FsmAction::BuildProposal {
                        reuse_valid: self.valid.map(|v| v.hash),
                    });
                    // Note: we do NOT advance step yet. The runtime must
                    // call `step(ProposalSeen, ...)` once the block exists,
                    // which advances us to Prevote.
                }
                // Propose timeout — vote nil (or locked hash) and proceed.
                if elapsed >= self.timeouts.propose {
                    let target = prevote_target_on_timeout(self.locked);
                    actions.push(FsmAction::BroadcastPrevote { target });
                    self.enter_step(Step::Prevote, now);
                }
            }
            Step::Prevote => {
                // Prevote timeout — broadcast nil precommit. We stay at the
                // current round and wait for precommit quorum (or its
                // own timeout for round-bump).
                if elapsed >= self.timeouts.prevote {
                    actions.push(FsmAction::BroadcastPrecommit { target: None });
                    self.enter_step(Step::Precommit, now);
                }
            }
            Step::Precommit => {
                // Precommit timeout — bump round.
                if elapsed >= self.timeouts.precommit {
                    let new_round = self.round.saturating_add(1);
                    self.enter_round(new_round, now);
                    actions.push(FsmAction::EnteredRound {
                        height: self.height,
                        round: new_round,
                    });
                }
            }
            Step::Commit => {
                // **architect-review fix:** do NOT auto-advance height on
                // commit timeout. Height advance is gated on an explicit
                // [`FsmEvent::BlockApplied`] from the runtime. If the
                // runtime is slow, we just re-emit the [`FsmAction::CommitBlock`]
                // request so a missed action is recoverable. Idempotent:
                // applying the same block twice is a no-op at the State
                // layer (height-already-applied check).
                if elapsed >= self.timeouts.commit {
                    if let Some(hash) = self.committing {
                        actions.push(FsmAction::CommitBlock {
                            height: self.height,
                            hash,
                        });
                        // Reset clock so we don't spam every tick.
                        self.step_started_at = now;
                    }
                }
            }
        }
        actions
    }

    fn on_proposal(&mut self, round: u32, block_hash: Hash, now: Instant) -> Vec<FsmAction> {
        let mut actions = Vec::new();

        // Stale proposals (for past rounds) are ignored. They can still be
        // useful evidence for the runtime to update peer health, but the
        // FSM has no use for them.
        if round < self.round {
            return actions;
        }
        // A proposal for a strictly-higher round implies a view-change.
        // Jump to that round before processing.
        if round > self.round {
            self.enter_round(round, now);
            actions.push(FsmAction::EnteredRound {
                height: self.height,
                round,
            });
        }

        // Only act on proposals while in Propose. If we have already
        // prevoted this round (step Prevote/Precommit/Commit), the proposal
        // is informational only — record the hash so a quorum check can
        // later commit it without a re-broadcast.
        self.proposal = Some(block_hash);
        if self.step != Step::Propose {
            return actions;
        }

        // Honest validators always treat the proposer's block as valid for
        // the purposes of the FSM (real validation — header structure,
        // tx execution, parent linkage — happens in the runtime layer
        // BEFORE feeding the event). So `proposal_is_valid = true` here.
        let target = prevote_target_for_proposal(block_hash, self.locked, true);
        actions.push(FsmAction::BroadcastPrevote { target });
        self.enter_step(Step::Prevote, now);

        actions
    }

    fn on_prevote_quorum(
        &mut self,
        round: u32,
        target: Option<Hash>,
        now: Instant,
    ) -> Vec<FsmAction> {
        let mut actions = Vec::new();

        // Update valid block tracker on any non-nil prevote quorum at
        // current-or-higher round (POL — so future proposers re-propose
        // this block, AND so we may release a stale lock).
        if let Some(hash) = target {
            if round >= self.round {
                let should_update = self
                    .valid
                    .map(|v| round > v.round)
                    .unwrap_or(true);
                if should_update {
                    self.valid = Some(ValidBlock { round, hash });
                }
            }
            // POL release: if we are locked on a different block at a
            // strictly-lower round, drop the lock.
            if let Some(lock) = self.locked {
                if round > lock.round && hash != lock.hash {
                    self.locked = None;
                }
            }
        }

        // Only the current round's quorum drives the next step transition.
        if round != self.round {
            return actions;
        }

        // Already past Prevote? Quorum is informational only.
        if !matches!(self.step, Step::Prevote | Step::Propose) {
            return actions;
        }

        // **architect-review fix:** non-nil precommit ONLY when we have
        // actually seen the proposed block locally AND its hash matches
        // the quorum target. Otherwise we precommit nil — we cannot sign
        // off on data we haven't validated, even if a quorum of other
        // validators says it's good (they could be byzantine, or we
        // could have a corrupt p2p plumbing layer).
        let precommit_target = match target {
            Some(hash) if self.proposal == Some(hash) => Some(hash),
            Some(_) => None, // hash-only quorum → safer to precommit nil
            None => None,
        };

        // If we precommit a hash, lock onto it.
        if let Some(hash) = precommit_target {
            self.locked = Some(LockedBlock { round: self.round, hash });
        }

        actions.push(FsmAction::BroadcastPrecommit { target: precommit_target });
        self.enter_step(Step::Precommit, now);
        actions
    }

    fn on_precommit_quorum(
        &mut self,
        round: u32,
        target: Option<Hash>,
        now: Instant,
    ) -> Vec<FsmAction> {
        let mut actions = Vec::new();

        // A non-nil precommit quorum at ANY round (current, past, or
        // future) for this height is a commit. Tendermint allows commits
        // from earlier rounds to land late.
        //
        // **architect-review fix:** record the committing hash and enter
        // [`Step::Commit`] but do NOT auto-advance height. The runtime
        // must apply the block and signal back via
        // [`FsmEvent::BlockApplied`] before we move on.
        if let Some(hash) = target {
            self.committing = Some(hash);
            actions.push(FsmAction::CommitBlock {
                height: self.height,
                hash,
            });
            self.enter_step(Step::Commit, now);
            return actions;
        }

        // Nil precommit quorum at the current round → bump round, BUT
        // not if we are already in [`Step::Commit`] for this height
        // (committing.is_some() means a non-nil quorum already won and we
        // are merely awaiting the apply ack).
        if round == self.round && self.committing.is_none() {
            let new_round = self.round.saturating_add(1);
            self.enter_round(new_round, now);
            actions.push(FsmAction::EnteredRound {
                height: self.height,
                round: new_round,
            });
        }
        actions
    }

    /// Runtime confirmed the block was applied to local state and the
    /// side-table commit blob persisted. Releases [`Step::Commit`] and
    /// advances to `height + 1`. Mismatched-hash acks are silently
    /// ignored (defensive — a misrouted ack must NEVER advance us over
    /// the wrong block).
    fn on_block_applied(&mut self, hash: Hash, now: Instant) -> Vec<FsmAction> {
        let mut actions = Vec::new();
        if self.step != Step::Commit {
            return actions; // unsolicited / out-of-step ack
        }
        if self.committing != Some(hash) {
            return actions; // ack for a different block — refuse
        }
        let new_height = self.height.saturating_add(1);
        self.enter_height(new_height, now);
        actions.push(FsmAction::EnteredHeight { height: new_height });
        actions
    }

    fn on_higher_round(
        &mut self,
        round: u32,
        _am_proposer: bool,
        now: Instant,
    ) -> Vec<FsmAction> {
        let mut actions = Vec::new();
        if round > self.round {
            self.enter_round(round, now);
            actions.push(FsmAction::EnteredRound {
                height: self.height,
                round,
            });
        }
        actions
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn h(byte: u8) -> Hash {
        Hash([byte; 32])
    }

    fn mk_state() -> (FsmState, Instant) {
        let now = Instant::now();
        (FsmState::new(1, Timeouts::default(), now), now)
    }

    #[test]
    fn happy_path_single_validator() {
        // N=1: every quorum trivially passes. FSM should walk
        // Propose → Prevote → Precommit → Commit → next height.
        let (mut fsm, t0) = mk_state();
        let block = h(0xAA);

        // Tick as proposer at round 0 — should emit BuildProposal.
        let actions = fsm.step(FsmEvent::Tick(t0), true, t0);
        assert_eq!(actions, vec![FsmAction::BuildProposal { reuse_valid: None }]);
        assert_eq!(fsm.step, Step::Propose);

        // Runtime feeds the proposal back.
        let actions = fsm.step(
            FsmEvent::ProposalSeen { height: 1, round: 0, block_hash: block },
            true,
            t0,
        );
        assert_eq!(actions, vec![FsmAction::BroadcastPrevote { target: Some(block) }]);
        assert_eq!(fsm.step, Step::Prevote);

        // Prevote quorum (1/1) → precommit, lock.
        let actions = fsm.step(
            FsmEvent::PrevoteQuorum { height: 1, round: 0, target: Some(block) },
            true,
            t0,
        );
        assert_eq!(actions, vec![FsmAction::BroadcastPrecommit { target: Some(block) }]);
        assert_eq!(fsm.step, Step::Precommit);
        assert_eq!(fsm.locked, Some(LockedBlock { round: 0, hash: block }));
        assert_eq!(fsm.valid, Some(ValidBlock { round: 0, hash: block }));

        // Precommit quorum → commit.
        let actions = fsm.step(
            FsmEvent::PrecommitQuorum { height: 1, round: 0, target: Some(block) },
            true,
            t0,
        );
        assert_eq!(actions, vec![FsmAction::CommitBlock { height: 1, hash: block }]);
        assert_eq!(fsm.step, Step::Commit);
        assert_eq!(fsm.committing, Some(block));

        // architect-review fix: commit-timeout no longer auto-advances.
        // Tick during Commit just RE-EMITS CommitBlock so a missed action
        // is recoverable.
        let t_retry = t0 + Duration::from_secs(2);
        let actions = fsm.step(FsmEvent::Tick(t_retry), true, t_retry);
        assert_eq!(
            actions,
            vec![FsmAction::CommitBlock { height: 1, hash: block }]
        );
        assert_eq!(fsm.step, Step::Commit, "must stay in Commit until BlockApplied");
        assert_eq!(fsm.height, 1);

        // Runtime acks via BlockApplied → height advances.
        let t_ack = t0 + Duration::from_secs(3);
        let actions = fsm.step(
            FsmEvent::BlockApplied { height: 1, hash: block },
            true,
            t_ack,
        );
        assert_eq!(actions, vec![FsmAction::EnteredHeight { height: 2 }]);
        assert_eq!(fsm.height, 2);
        assert_eq!(fsm.round, 0);
        assert_eq!(fsm.step, Step::Propose);
        // Lock + valid + committing all cleared at height boundary.
        assert!(fsm.locked.is_none());
        assert!(fsm.valid.is_none());
        assert!(fsm.committing.is_none());
    }

    #[test]
    fn propose_timeout_bumps_to_prevote_nil() {
        // Not the proposer; proposer is offline → no proposal arrives.
        // After propose timeout we must broadcast nil prevote and move on.
        let (mut fsm, t0) = mk_state();

        // Tick before timeout: no action.
        let early = t0 + Duration::from_secs(1);
        let actions = fsm.step(FsmEvent::Tick(early), false, early);
        assert!(actions.is_empty());
        assert_eq!(fsm.step, Step::Propose);

        // Tick after propose timeout (8s default).
        let late = t0 + Duration::from_secs(9);
        let actions = fsm.step(FsmEvent::Tick(late), false, late);
        assert_eq!(actions, vec![FsmAction::BroadcastPrevote { target: None }]);
        assert_eq!(fsm.step, Step::Prevote);
    }

    #[test]
    fn precommit_timeout_bumps_round() {
        let (mut fsm, t0) = mk_state();
        // Force into Precommit step manually.
        fsm.enter_step(Step::Precommit, t0);

        let late = t0 + Duration::from_secs(3);
        let actions = fsm.step(FsmEvent::Tick(late), false, late);
        assert_eq!(
            actions,
            vec![FsmAction::EnteredRound { height: 1, round: 1 }]
        );
        assert_eq!(fsm.round, 1);
        assert_eq!(fsm.step, Step::Propose);
    }

    #[test]
    fn lock_forces_nil_prevote_on_different_proposal() {
        let (mut fsm, t0) = mk_state();
        let block_a = h(0xAA);
        let block_b = h(0xBB);

        // Round 0: see proposal A, prevote A, get prevote quorum, precommit A
        // (locking on A).
        fsm.step(
            FsmEvent::ProposalSeen { height: 1, round: 0, block_hash: block_a },
            true,
            t0,
        );
        fsm.step(
            FsmEvent::PrevoteQuorum { height: 1, round: 0, target: Some(block_a) },
            true,
            t0,
        );
        assert_eq!(fsm.locked, Some(LockedBlock { round: 0, hash: block_a }));

        // Bump round (precommit timeout).
        let later = t0 + Duration::from_secs(3);
        fsm.step(FsmEvent::Tick(later), false, later);
        assert_eq!(fsm.round, 1);
        assert_eq!(fsm.step, Step::Propose);

        // Round 1: proposer offers DIFFERENT block B.
        // We are locked on A → must prevote nil.
        let actions = fsm.step(
            FsmEvent::ProposalSeen { height: 1, round: 1, block_hash: block_b },
            false,
            later,
        );
        assert_eq!(actions, vec![FsmAction::BroadcastPrevote { target: None }]);
        // Lock unchanged.
        assert_eq!(fsm.locked, Some(LockedBlock { round: 0, hash: block_a }));
    }

    #[test]
    fn lock_release_and_relock_via_pol_at_current_round() {
        // Tendermint POL @ self.round: old lock on A is released by the
        // POL-for-B test, AND because we are at step Propose for round 2
        // when quorum arrives, the FSM immediately precommits B and
        // re-locks on B at round 2. Net effect: lock A → lock B.
        let (mut fsm, t0) = mk_state();
        let block_a = h(0xAA);
        let block_b = h(0xBB);

        fsm.locked = Some(LockedBlock { round: 0, hash: block_a });
        fsm.enter_round(2, t0);
        assert_eq!(fsm.locked, Some(LockedBlock { round: 0, hash: block_a }));

        // Per architect-review safety rule, non-nil precommit requires
        // having seen the proposal locally — feed it before the quorum.
        let _ = fsm.step(
            FsmEvent::ProposalSeen { height: 1, round: 2, block_hash: block_b },
            false,
            t0,
        );

        let actions = fsm.step(
            FsmEvent::PrevoteQuorum { height: 1, round: 2, target: Some(block_b) },
            false,
            t0,
        );
        // FSM precommits the new block...
        assert_eq!(
            actions,
            vec![FsmAction::BroadcastPrecommit { target: Some(block_b) }]
        );
        // ...and re-locks on it at the new round.
        assert_eq!(
            fsm.locked,
            Some(LockedBlock { round: 2, hash: block_b }),
            "POL should release old lock and re-lock on new block at the higher round"
        );
        assert_eq!(fsm.valid, Some(ValidBlock { round: 2, hash: block_b }));
    }

    #[test]
    fn lock_release_without_relock_when_quorum_at_other_round() {
        // POL fires for round 2 while FSM is at round 5: lock release
        // happens (because the POL is at a round strictly greater than
        // lock.round), but no precommit/re-lock because the quorum is
        // not at self.round.
        let (mut fsm, t0) = mk_state();
        let block_a = h(0xAA);
        let block_b = h(0xBB);

        fsm.locked = Some(LockedBlock { round: 0, hash: block_a });
        fsm.enter_round(5, t0);

        let actions = fsm.step(
            FsmEvent::PrevoteQuorum { height: 1, round: 2, target: Some(block_b) },
            false,
            t0,
        );
        assert!(actions.is_empty(), "no precommit/round-change for off-round quorum");
        assert!(
            fsm.locked.is_none(),
            "lock must be released even when quorum is not at self.round"
        );
        // Valid block tracker was NOT updated because round (2) < self.round (5).
        assert!(fsm.valid.is_none());
    }

    #[test]
    fn nil_prevote_quorum_triggers_nil_precommit() {
        let (mut fsm, t0) = mk_state();
        // Manually enter Prevote step (after some prevote was broadcast).
        fsm.enter_step(Step::Prevote, t0);

        let actions = fsm.step(
            FsmEvent::PrevoteQuorum { height: 1, round: 0, target: None },
            false,
            t0,
        );
        assert_eq!(actions, vec![FsmAction::BroadcastPrecommit { target: None }]);
        assert_eq!(fsm.step, Step::Precommit);
        // No lock — we precommitted nil.
        assert!(fsm.locked.is_none());
    }

    #[test]
    fn nil_precommit_quorum_bumps_round() {
        let (mut fsm, t0) = mk_state();
        fsm.enter_step(Step::Precommit, t0);

        let actions = fsm.step(
            FsmEvent::PrecommitQuorum { height: 1, round: 0, target: None },
            false,
            t0,
        );
        assert_eq!(
            actions,
            vec![FsmAction::EnteredRound { height: 1, round: 1 }]
        );
        assert_eq!(fsm.round, 1);
    }

    #[test]
    fn higher_round_seen_triggers_view_change() {
        let (mut fsm, t0) = mk_state();
        assert_eq!(fsm.round, 0);

        let actions = fsm.step(FsmEvent::HigherRoundSeen { height: 1, round: 5 }, false, t0);
        assert_eq!(
            actions,
            vec![FsmAction::EnteredRound { height: 1, round: 5 }]
        );
        assert_eq!(fsm.round, 5);
        assert_eq!(fsm.step, Step::Propose);
    }

    #[test]
    fn higher_round_seen_below_current_is_noop() {
        let (mut fsm, t0) = mk_state();
        fsm.enter_round(7, t0);

        let actions = fsm.step(FsmEvent::HigherRoundSeen { height: 1, round: 3 }, false, t0);
        assert!(actions.is_empty());
        assert_eq!(fsm.round, 7);
    }

    #[test]
    fn proposal_for_higher_round_jumps() {
        let (mut fsm, t0) = mk_state();
        let block = h(0xCC);

        let actions = fsm.step(
            FsmEvent::ProposalSeen { height: 1, round: 4, block_hash: block },
            false,
            t0,
        );
        // Should EnteredRound + BroadcastPrevote.
        assert_eq!(actions.len(), 2);
        assert!(matches!(
            actions[0],
            FsmAction::EnteredRound { height: 1, round: 4 }
        ));
        assert!(matches!(
            actions[1],
            FsmAction::BroadcastPrevote { target: Some(_) }
        ));
        assert_eq!(fsm.round, 4);
        assert_eq!(fsm.step, Step::Prevote);
    }

    #[test]
    fn late_precommit_quorum_from_past_round_still_commits() {
        // Tendermint: a 2/3+ precommit quorum at ANY round commits the
        // block, even if the FSM has already round-bumped past it.
        let (mut fsm, t0) = mk_state();
        let block = h(0xDD);
        fsm.enter_round(3, t0);

        let actions = fsm.step(
            FsmEvent::PrecommitQuorum { height: 1, round: 1, target: Some(block) },
            false,
            t0,
        );
        assert_eq!(
            actions,
            vec![FsmAction::CommitBlock { height: 1, hash: block }]
        );
        assert_eq!(fsm.step, Step::Commit);
    }

    #[test]
    fn proposal_reuses_valid_block() {
        // After a round where prevote quorum was reached but no commit
        // happened (e.g. precommit timeout), the next proposer must reuse
        // the valid block instead of building a fresh one.
        let (mut fsm, t0) = mk_state();
        let block = h(0xEE);

        // Manually set valid (as if a prior round had quorum).
        fsm.valid = Some(ValidBlock { round: 0, hash: block });
        fsm.enter_round(1, t0);

        // Tick as proposer.
        let actions = fsm.step(FsmEvent::Tick(t0), true, t0);
        assert_eq!(
            actions,
            vec![FsmAction::BuildProposal {
                reuse_valid: Some(block)
            }]
        );
    }

    #[test]
    fn prevote_target_helper_respects_lock() {
        let block_a = h(0xA1);
        let block_b = h(0xB1);

        // No lock + valid proposal → vote it.
        assert_eq!(
            prevote_target_for_proposal(block_a, None, true),
            Some(block_a)
        );
        // No lock + invalid → nil.
        assert_eq!(
            prevote_target_for_proposal(block_a, None, false),
            None
        );
        // Locked on A, proposal A → vote A.
        assert_eq!(
            prevote_target_for_proposal(
                block_a,
                Some(LockedBlock { round: 0, hash: block_a }),
                true
            ),
            Some(block_a)
        );
        // Locked on A, proposal B → nil.
        assert_eq!(
            prevote_target_for_proposal(
                block_b,
                Some(LockedBlock { round: 0, hash: block_a }),
                true
            ),
            None
        );
    }

    #[test]
    fn prevote_target_on_timeout_respects_lock() {
        let block = h(0xF0);
        assert_eq!(prevote_target_on_timeout(None), None);
        assert_eq!(
            prevote_target_on_timeout(Some(LockedBlock { round: 2, hash: block })),
            Some(block)
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // architect-review safety tests (B.3.2.6 hardening)
    // ─────────────────────────────────────────────────────────────────

    #[test]
    fn wrong_height_events_silently_dropped() {
        // Misrouted vote-pool signal claiming a different height must
        // never alter FSM state. Critical: a bug in the runtime's
        // height-routing layer cannot trick us into committing.
        let (mut fsm, t0) = mk_state();
        let block = h(0x55);
        let snapshot_before = (
            fsm.height,
            fsm.round,
            fsm.step,
            fsm.proposal,
            fsm.locked,
            fsm.committing,
        );

        // Stale-height proposal
        let actions = fsm.step(
            FsmEvent::ProposalSeen { height: 0, round: 0, block_hash: block },
            true,
            t0,
        );
        assert!(actions.is_empty());

        // Future-height prevote quorum
        let actions = fsm.step(
            FsmEvent::PrevoteQuorum { height: 9999, round: 0, target: Some(block) },
            true,
            t0,
        );
        assert!(actions.is_empty());

        // Future-height precommit quorum (the dangerous one — would have
        // committed the wrong block before the fix)
        let actions = fsm.step(
            FsmEvent::PrecommitQuorum { height: 9999, round: 0, target: Some(block) },
            true,
            t0,
        );
        assert!(actions.is_empty());

        // Future-height view-change signal
        let actions = fsm.step(
            FsmEvent::HigherRoundSeen { height: 42, round: 7 },
            true,
            t0,
        );
        assert!(actions.is_empty());

        // Stale BlockApplied ack (e.g., late ack from a previous height)
        let actions = fsm.step(
            FsmEvent::BlockApplied { height: 0, hash: block },
            true,
            t0,
        );
        assert!(actions.is_empty());

        // Nothing changed.
        let snapshot_after = (
            fsm.height,
            fsm.round,
            fsm.step,
            fsm.proposal,
            fsm.locked,
            fsm.committing,
        );
        assert_eq!(snapshot_before, snapshot_after);
    }

    #[test]
    fn precommit_nil_when_quorum_target_unseen_locally() {
        // Other validators have prevoted a block hash X but we never
        // received the proposal for X. A correct node MUST precommit nil
        // — signing a precommit for data we cannot validate would let a
        // byzantine majority forge our signature on bad blocks.
        let (mut fsm, t0) = mk_state();
        let unseen = h(0xBA);

        // No ProposalSeen fed.
        let actions = fsm.step(
            FsmEvent::PrevoteQuorum { height: 1, round: 0, target: Some(unseen) },
            false,
            t0,
        );

        // Must precommit NIL, not unseen.
        assert_eq!(actions, vec![FsmAction::BroadcastPrecommit { target: None }]);
        assert_eq!(fsm.step, Step::Precommit);
        // And we MUST NOT lock onto a block we never saw.
        assert!(fsm.locked.is_none(), "must not lock on unseen hash");
    }

    #[test]
    fn precommit_non_nil_only_after_proposal_seen() {
        // Same scenario but proposal arrives first → non-nil precommit OK.
        let (mut fsm, t0) = mk_state();
        let block = h(0x77);

        let _ = fsm.step(
            FsmEvent::ProposalSeen { height: 1, round: 0, block_hash: block },
            false,
            t0,
        );
        assert_eq!(fsm.proposal, Some(block));

        let actions = fsm.step(
            FsmEvent::PrevoteQuorum { height: 1, round: 0, target: Some(block) },
            false,
            t0,
        );

        assert_eq!(
            actions,
            vec![FsmAction::BroadcastPrecommit { target: Some(block) }]
        );
        assert_eq!(fsm.locked, Some(LockedBlock { round: 0, hash: block }));
    }

    #[test]
    fn block_applied_ack_with_wrong_hash_is_ignored() {
        // Defensive: a misrouted BlockApplied ack for a different block
        // hash MUST NOT advance the FSM's height. Otherwise a buggy
        // runtime could ack the wrong block and we'd skip a real commit.
        let (mut fsm, t0) = mk_state();
        let real = h(0xAA);
        let wrong = h(0xBB);

        let _ = fsm.step(
            FsmEvent::ProposalSeen { height: 1, round: 0, block_hash: real },
            true,
            t0,
        );
        let _ = fsm.step(
            FsmEvent::PrevoteQuorum { height: 1, round: 0, target: Some(real) },
            true,
            t0,
        );
        let _ = fsm.step(
            FsmEvent::PrecommitQuorum { height: 1, round: 0, target: Some(real) },
            true,
            t0,
        );
        assert_eq!(fsm.step, Step::Commit);
        assert_eq!(fsm.committing, Some(real));

        // Bad ack for a different hash — must be refused.
        let actions = fsm.step(
            FsmEvent::BlockApplied { height: 1, hash: wrong },
            true,
            t0 + Duration::from_millis(5),
        );
        assert!(actions.is_empty(), "wrong-hash ack must produce no actions");
        assert_eq!(fsm.height, 1, "height must not advance on wrong-hash ack");
        assert_eq!(fsm.step, Step::Commit, "still awaiting correct ack");
        assert_eq!(fsm.committing, Some(real));

        // Correct ack — now we advance.
        let actions = fsm.step(
            FsmEvent::BlockApplied { height: 1, hash: real },
            true,
            t0 + Duration::from_millis(10),
        );
        assert_eq!(actions, vec![FsmAction::EnteredHeight { height: 2 }]);
        assert_eq!(fsm.height, 2);
        assert!(fsm.committing.is_none());
    }

    #[test]
    fn commit_step_does_not_round_bump_on_nil_quorum() {
        // Once we are in Step::Commit (non-nil quorum already seen), a
        // late-arriving NIL precommit quorum at the same round must NOT
        // bump our round — we are awaiting BlockApplied, not retrying.
        let (mut fsm, t0) = mk_state();
        let block = h(0x33);

        let _ = fsm.step(
            FsmEvent::ProposalSeen { height: 1, round: 0, block_hash: block },
            true,
            t0,
        );
        let _ = fsm.step(
            FsmEvent::PrevoteQuorum { height: 1, round: 0, target: Some(block) },
            true,
            t0,
        );
        let _ = fsm.step(
            FsmEvent::PrecommitQuorum { height: 1, round: 0, target: Some(block) },
            true,
            t0,
        );
        assert_eq!(fsm.step, Step::Commit);
        assert_eq!(fsm.round, 0);

        // Late nil quorum from another node's perspective.
        let actions = fsm.step(
            FsmEvent::PrecommitQuorum { height: 1, round: 0, target: None },
            true,
            t0,
        );
        assert!(actions.is_empty());
        assert_eq!(fsm.step, Step::Commit, "still committing");
        assert_eq!(fsm.round, 0, "round must NOT bump while committing");
    }
}
