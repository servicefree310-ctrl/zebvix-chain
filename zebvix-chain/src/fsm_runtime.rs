//! FSM runtime adapter (Phase B.3.2.7 — F006.1 → F006.4 ship).
//!
//! This module is the **integration layer** between the pure consensus FSM
//! (`crate::fsm`) and the live node services (`State`, `Mempool`,
//! `VotePool`, p2p gossip). It is intentionally *dormant* in this commit:
//!
//! 1. `enabled()` reads `ZEBVIX_FSM_ENABLED` and returns `false` by
//!    default, so existing operators are not auto-upgraded.
//! 2. `FsmRuntime::run` returns immediately when `enabled()` is `false`
//!    so a `tokio::spawn(rt.run())` task drops cleanly.
//! 3. Nothing in `main.rs` calls `FsmRuntime::run` yet. The legacy
//!    `Producer::run` continues to drive consensus, byte-identically to
//!    pre-B.3.2.7 behaviour. F006.7 will introduce the pre-emption path.
//!
//! ## What's new in F006.4 vs F006.3
//! F006.3 shipped a single `handle_action` dispatch surface with a
//! warn+sleep `run()` guard. F006.4 turns that surface into a working
//! event-driven loop:
//!
//! - **Vote-pool watcher** (`poll_vote_quorums`): walks the pool's
//!   tally APIs at the current `(height, round)` and emits
//!   `FsmEvent::PrevoteQuorum` / `PrecommitQuorum` for each target
//!   that has crossed the 2/3+ threshold. Dedup via
//!   `last_emitted_quorum` so a stable quorum doesn't spam the FSM.
//! - **Tick clock** (`tick_once`): drives `FsmEvent::Tick` into the
//!   FSM at the same 500ms cadence as the legacy producer.
//! - **Proposal cache** (`proposal_cache`): bounded `BTreeMap` of
//!   `(height → Block)` populated by `cache_proposal` (callable from
//!   any future p2p ingress) and consumed by
//!   `handle_action(CommitBlock)` to source the actual `Block` bytes
//!   for `state.apply_block`. Capped at `PROPOSAL_CACHE_CAP = 64`
//!   entries; oldest height evicted on overflow.
//! - **Startup recovery** (`recover_from_state`): derives the FSM
//!   start height from `state.tip().0 + 1`. Honors the existing
//!   commit-blob mismatch guard in `state.rs` (lines 2767–2780)
//!   which already halts startup if the last commit was a partial
//!   write — F006.4 simply trusts `state.tip()` because that's the
//!   post-recovery value once the operator clears the marker.
//! - **Real event loop** (`run`): replaces the F006.3 warn+sleep
//!   guard with a `tokio::select!` loop that drives the tick clock
//!   + vote-pool watcher when `enabled()=true`. Exits immediately
//!   when `enabled()=false` (no warning, no busy-wait) so a
//!   pre-emptive future caller can `tokio::spawn(rt.run())` on
//!   every startup unconditionally.
//!
//! ## What's NOT in F006.4 (deferred)
//! - **Legacy pre-emption** (F006.7): even with `enabled()=true`,
//!   this commit does NOT stop `consensus::Producer::run` from
//!   driving consensus. The FSM loop runs in parallel as a *shadow
//!   observer* — its `BuildProposal`/`BroadcastPrevote`/
//!   `BroadcastPrecommit` actions are still log-only stubs (matches
//!   F006.3 behaviour) so it cannot fork the chain. Only
//!   `CommitBlock` reaches `state.apply_block`, and that is gated
//!   by a `state.tip() < height` check that prevents double-apply.
//!   F006.7 will cleanly remove the legacy path once F006.5
//!   (cadence) + F006.6 (gating soak) prove the FSM byte-identical.
//! - **Proposal cache populator** (F006.4.5): no production code
//!   currently calls `cache_proposal`. The cache is wired into
//!   `handle_action(CommitBlock)`'s lookup path so it works in
//!   tests and from manual operator probes, but the p2p ingress
//!   subscription is a separate ship (small enough to bundle with
//!   F006.7 if convenient).
//!
//! ## Activation plan (per `HARDENING_TODO.md` §B.3.2.7)
//! - Dev rehearsal `ZEBVIX_FSM_ENABLED=false`: byte-identical to legacy
//!   over 1000 blocks (gating green-light).
//! - Dev rehearsal `ZEBVIX_FSM_ENABLED=true` under N=1: byte-identical
//!   to legacy (1/1 quorum trivially met, FSM and legacy produce the
//!   same block hash because they read the same mempool).
//! - Mainnet flag flip after ≥7 day soak with flag OFF.
//! - Never flip `ZEBVIX_FSM_ENABLED` and `ZEBVIX_SIGN_HASH_
//!   ACTIVATION_HEIGHT` (C2) on the same restart.

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use tokio::sync::Mutex;

use crate::consensus::{who_proposes, Producer};
use crate::fsm::{FsmAction, FsmEvent, FsmState, Timeouts};
use crate::state::State;
use crate::types::{Block, Hash};
use crate::vote::{VotePool, VoteType};

/// Maximum number of `(height → Block)` entries kept in the proposal
/// cache. Sized for the worst-case round-bump scenario where a single
/// height churns through many proposers before committing — 64 entries
/// is ~5min of N=1 operation (5s/block) and ~100MB at the typical 1.5MB
/// block size, well below the node's RSS budget.
const PROPOSAL_CACHE_CAP: usize = 64;

/// Tick cadence for the FSM event loop. Matched to the legacy
/// `consensus::Producer::run` tick of 500ms so the FSM observes the
/// same wall-clock granularity as the legacy path. Changing this would
/// drift the FSM's timeout enforcement away from the legacy producer's
/// `propose_timeout=8s` semantics under N=1 — keep them in lockstep.
const TICK_INTERVAL_MS: u64 = 500;

/// **F006.5 — Minimum cadence interval between successive successful
/// `CommitBlock` applies.** Locked to `BLOCK_TIME_SECS` (5s) so the
/// FSM cannot outpace the legacy producer's commit cadence under N=1,
/// guaranteeing byte-identical commit blobs once F006.7 lifts the
/// shadow-observer.
///
/// This is a **defense-in-depth backstop**, not the primary cadence
/// gate — that role belongs to the FSM's `Timeouts.commit` (currently
/// 1s; F006.7 will raise it to `BLOCK_TIME_SECS`). The backstop here
/// catches the case where someone tunes `Timeouts.commit` below
/// `BLOCK_TIME_SECS` and breaks the byte-identical guarantee. Compile-
/// time tied to `crate::tokenomics::BLOCK_TIME_SECS` so a future
/// pacing change in tokenomics propagates here automatically; the
/// `min_block_interval_matches_block_time_secs` test enforces this
/// binding.
const MIN_BLOCK_INTERVAL: Duration =
    Duration::from_secs(crate::tokenomics::BLOCK_TIME_SECS);

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

/// **F006.4 — Startup recovery helper.**
///
/// Derives the FSM start height from on-disk state. Returns `state.tip().0
/// + 1` (the next height to be committed). Honors the existing partial-
/// write recovery guard in `State::open` (see `state.rs` lines 2767-2780):
/// if the last commit was a torn write, `State::open` already errors and
/// the operator must clear the recovery marker before re-attempting
/// startup. By the time this function is called, `state.tip()` is
/// guaranteed to be a fully-committed height.
pub fn recover_from_state(state: &State) -> u64 {
    state.tip().0.saturating_add(1)
}

/// Default propose / prevote / precommit / commit timeouts used when the
/// FSM runtime is bootstrapped. The propose timeout is tied at
/// **compile time** to the legacy producer's
/// [`crate::consensus::PROPOSE_TIMEOUT_SECS`] so a future operator
/// flipping `ZEBVIX_FSM_ENABLED` cannot silently change the chain's
/// round-bump cadence (architect-review fix from F006.1 evaluation).
/// The `parity_with_legacy_propose_timeout` test enforces this binding.
fn default_timeouts() -> Timeouts {
    Timeouts {
        propose: Duration::from_secs(crate::consensus::PROPOSE_TIMEOUT_SECS),
        prevote: Duration::from_secs(2),
        precommit: Duration::from_secs(2),
        commit: Duration::from_secs(1),
    }
}

/// Adapter that owns the live `FsmState` and translates between it and
/// the running node's I/O surfaces.
pub struct FsmRuntime {
    /// The pure consensus FSM. Behind a `Mutex` because event-source and
    /// action-sink tasks may both want to call `step()`. The mutex is
    /// held only for the duration of a single `step()` call (microseconds)
    /// so contention is negligible.
    fsm: Mutex<FsmState>,

    /// The legacy producer. We re-use its `build_block` / signing /
    /// broadcast plumbing instead of duplicating it. Held as `Arc`
    /// because both this runtime and the legacy `Producer::run` task
    /// may co-exist during the dormant phase.
    producer: Arc<Producer>,

    /// Direct handle to the live state. Required for `CommitBlock` so we
    /// can call `state.apply_block` without round-tripping through the
    /// `Producer` (which only exposes `build_block`, not `apply_block`).
    state: Arc<State>,

    /// **F006.4 — vote-pool watcher source.** Tally APIs polled on each
    /// tick by `poll_vote_quorums` to detect 2/3+ thresholds. Held as
    /// `Arc` because the same `VotePool` is shared with the legacy
    /// `vote_loop` in `main.rs` — both observe the same votes, only
    /// the legacy path acts on them in F006.4.
    vote_pool: Arc<VotePool>,

    /// **F006.4 — proposal cache.** Bounded map of `(height → Block)`
    /// populated by `cache_proposal` (and locally by
    /// `handle_action(BuildProposal)`) and consumed by
    /// `handle_action(CommitBlock)` to recover block bytes for
    /// `state.apply_block`. Capped at `PROPOSAL_CACHE_CAP` entries;
    /// oldest height evicted on overflow.
    proposal_cache: Mutex<BTreeMap<u64, Block>>,

    /// **F006.4 — quorum dedup ledger.** Tracks `(height, round,
    /// vote_type, target)` tuples for quorum events already emitted, so
    /// `poll_vote_quorums` does not feed the same `PrevoteQuorum` /
    /// `PrecommitQuorum` event into `step()` on every tick. The FSM
    /// itself is idempotent against duplicate events (architect-review
    /// safety from F006.1) but feeding duplicates wastes mutex/CPU
    /// cycles on every poll.
    last_emitted_quorum: Mutex<HashSet<(u64, u32, VoteType, Option<Hash>)>>,

    /// **F006.5 — Wall-clock instant of our last successful
    /// `CommitBlock` state apply.** Consulted by
    /// `handle_action(CommitBlock)` to enforce the
    /// [`MIN_BLOCK_INTERVAL`] floor between commits. `None` until the
    /// first apply succeeds, so the genesis-bootstrap commit (or the
    /// first commit after a node restart with no prior commits this
    /// session) is never rate-limited. Updated atomically AFTER the
    /// `state.apply_block` call so a failed apply does not "consume"
    /// a cadence slot. Defense-in-depth: the FSM's `Timeouts.commit`
    /// is the primary cadence enforcement; this field powers a second
    /// gate in case of misconfiguration.
    last_commit_at: Mutex<Option<Instant>>,
}

impl FsmRuntime {
    /// Construct a fresh runtime. Start height is derived via
    /// [`recover_from_state`] — the caller must NOT pass a guess.
    /// Validators are loaded on-demand from `state.validators()` inside
    /// each `poll_vote_quorums` / `step` call so mid-run validator-set
    /// changes (height-boundary registration) are honored.
    pub fn new(producer: Arc<Producer>, state: Arc<State>, vote_pool: Arc<VotePool>) -> Self {
        let start_height = recover_from_state(&state);
        Self {
            fsm: Mutex::new(FsmState::new(start_height, default_timeouts(), Instant::now())),
            producer,
            state,
            vote_pool,
            proposal_cache: Mutex::new(BTreeMap::new()),
            last_emitted_quorum: Mutex::new(HashSet::new()),
            last_commit_at: Mutex::new(None),
        }
    }

    /// **F006.4 — Insert a freshly-seen proposal into the cache.**
    ///
    /// Callable from any p2p ingress hook (currently no production
    /// callers — see "What's NOT in F006.4" in the module docs).
    /// Eviction policy: when the cache reaches `PROPOSAL_CACHE_CAP`
    /// entries, the **smallest** height is removed first. That is the
    /// "oldest" entry by chain time, which is also the entry least
    /// likely to be needed by a future `CommitBlock` action (the FSM
    /// only commits at or above its current height, which monotonically
    /// advances).
    pub async fn cache_proposal(&self, block: Block) {
        let mut cache = self.proposal_cache.lock().await;
        let h = block.header.height;
        cache.insert(h, block);
        while cache.len() > PROPOSAL_CACHE_CAP {
            // BTreeMap iterates in key (height) order; pop the smallest.
            let smallest = *cache.keys().next().expect("len > cap implies non-empty");
            cache.remove(&smallest);
        }
    }

    /// **F006.4 — Vote-pool watcher.**
    ///
    /// Walks the pool's tally APIs at the FSM's current `(height,
    /// round)` and emits one `FsmEvent::PrevoteQuorum` /
    /// `PrecommitQuorum` per target whose voting power has crossed the
    /// `2/3+` threshold. Dedup via `last_emitted_quorum` ensures a
    /// stable quorum does not feed the same event on every tick.
    ///
    /// Returns the events to feed into `FsmState::step` — the caller
    /// (`run`) is responsible for actually invoking `step` so the
    /// emitted actions can be dispatched.
    ///
    /// **Lock order discipline:** acquires `fsm` first (read-only — to
    /// snapshot height/round), releases, then `last_emitted_quorum`,
    /// releases. Never holds two mutexes simultaneously, eliminating
    /// any risk of deadlock with `tick_once` (which acquires `fsm`
    /// for the `step` call).
    pub async fn poll_vote_quorums(&self) -> Vec<FsmEvent> {
        let (h, r) = {
            let fsm = self.fsm.lock().await;
            (fsm.height, fsm.round)
        };
        let validators = self.state.validators();
        let total_power: u64 = validators.iter().map(|v| v.voting_power).sum();
        if total_power == 0 {
            return Vec::new();
        }
        let quorum = total_power.saturating_mul(2) / 3 + 1;

        let mut events = Vec::new();
        let mut emitted = self.last_emitted_quorum.lock().await;

        for vt in [VoteType::Prevote, VoteType::Precommit] {
            let tally = match vt {
                VoteType::Prevote => self.vote_pool.tally_prevotes_for(h, r, &validators),
                VoteType::Precommit => self.vote_pool.tally_precommits_for(h, r, &validators),
            };
            for (target, power) in tally {
                if power < quorum {
                    continue;
                }
                let key = (h, r, vt, target);
                if !emitted.insert(key) {
                    continue;
                }
                let ev = match vt {
                    VoteType::Prevote => FsmEvent::PrevoteQuorum { height: h, round: r, target },
                    VoteType::Precommit => FsmEvent::PrecommitQuorum { height: h, round: r, target },
                };
                events.push(ev);
            }
        }
        events
    }

    /// **F006.4 — Tick clock driver.**
    ///
    /// Feeds a single `FsmEvent::Tick(now)` into the FSM and dispatches
    /// every emitted action through `handle_action`. Returns the
    /// downstream events those dispatches produced (e.g. a
    /// `CommitBlock` action returns a `BlockApplied` event), so the
    /// caller can re-feed them into the FSM in the next loop iteration.
    pub async fn tick_once(&self, now: Instant) -> Result<Vec<FsmEvent>> {
        let actions = {
            let mut fsm = self.fsm.lock().await;
            let am_p = self.am_proposer_now(&fsm);
            fsm.step(FsmEvent::Tick(now), am_p, now)
        };
        let mut downstream = Vec::new();
        for action in actions {
            let events = self.handle_action(action).await?;
            downstream.extend(events);
        }
        Ok(downstream)
    }

    /// Determine if the local validator is the elected proposer for the
    /// FSM's current `(height, round)`. Used as the `am_proposer` arg
    /// to `FsmState::step`.
    fn am_proposer_now(&self, fsm: &FsmState) -> bool {
        let validators = self.state.validators();
        match who_proposes(fsm.height, fsm.round, &validators) {
            Some(addr) => addr == self.producer.proposer_address(),
            None => false,
        }
    }

    /// **F006.3+F006.4 — Dispatch a single `FsmAction` against the live
    /// node.** Returns the list of `FsmEvent`s the runtime should feed
    /// back into `FsmState::step`. The empty vector is a valid return.
    ///
    /// **F006.4 shadow-observer mode** (active until F006.7):
    /// `BuildProposal` / `BroadcastPrevote` / `BroadcastPrecommit` are
    /// log-only stubs because the legacy `Producer::run` and
    /// `vote_loop` are still in charge. Acting on these actions would
    /// risk a divergent fork (FSM proposes block A while legacy
    /// proposes block B at the same height). Only `CommitBlock`
    /// reaches `state.apply_block`, and it is gated by a
    /// `state.tip() < height` check so a late FSM commit cannot
    /// double-apply over a height the legacy path already finalised.
    pub async fn handle_action(&self, action: FsmAction) -> Result<Vec<FsmEvent>> {
        match action {
            FsmAction::BuildProposal { reuse_valid: _ } => {
                tracing::debug!(
                    "fsm_runtime: BuildProposal stub — legacy producer in charge (F006.7 will pre-empt)"
                );
                Ok(Vec::new())
            }
            FsmAction::CommitBlock { height, hash } => {
                // Safety guard: don't double-apply a height the legacy
                // path has already committed. This is the F006.4
                // shadow-observer's primary fork-prevention check.
                let tip = self.state.tip().0;
                if height <= tip {
                    tracing::debug!(
                        "fsm_runtime: CommitBlock(h={height}) below tip {tip} — legacy already committed, skipping"
                    );
                    // Still emit BlockApplied so the FSM advances out of
                    // Step::Commit. Without this it would be stuck.
                    return Ok(vec![FsmEvent::BlockApplied { height, hash }]);
                }
                // **F006.5 — Cadence rate-limiter backstop.** Defer this
                // commit if less than `MIN_BLOCK_INTERVAL` (== legacy
                // `BLOCK_TIME_SECS`, currently 5s) has elapsed since
                // the previous successful apply. Returning an empty
                // event vector keeps the FSM in `Step::Commit`, so the
                // next `tick_once` re-issues the same `CommitBlock`
                // action — at which point either enough time has
                // passed (rate-limit clears) or we defer again. The
                // `proposal_cache` is intentionally untouched on this
                // path so the retry hits the same cached block bytes.
                //
                // Why gate here, not at `BuildProposal`?
                // 1. `BuildProposal` is a no-op stub in F006.4
                //    shadow-observer mode — no cadence to limit yet.
                // 2. Gating at the apply site is what actually matters
                //    for byte-identical-to-legacy commit blobs (the
                //    timestamp in the block header is set at proposal
                //    time, but the on-chain effect of cadence is the
                //    spacing between `state.apply_block` calls).
                // 3. F006.7 will additionally raise `Timeouts.commit`
                //    to `BLOCK_TIME_SECS`, making this backstop
                //    redundant in the happy path — it stays as
                //    defense-in-depth against future misconfiguration.
                {
                    let last = self.last_commit_at.lock().await;
                    if let Some(prev) = *last {
                        let elapsed = prev.elapsed();
                        if elapsed < MIN_BLOCK_INTERVAL {
                            tracing::debug!(
                                "fsm_runtime: CommitBlock(h={height}) rate-limited (elapsed={:?} < min={:?}) — deferring to next tick",
                                elapsed, MIN_BLOCK_INTERVAL
                            );
                            return Ok(Vec::new());
                        }
                    }
                }
                let cached = self.proposal_cache.lock().await.remove(&height);
                let block = cached.ok_or_else(|| {
                    anyhow!(
                        "fsm_runtime: CommitBlock(h={height}, hash={hash}) but no proposal cached \
                         (cache_proposal must be wired from p2p ingress before F006.7 activation)"
                    )
                })?;
                let cached_hash = crate::crypto::block_hash(&block.header);
                if cached_hash != hash {
                    return Err(anyhow!(
                        "fsm_runtime: CommitBlock hash mismatch (cached={cached_hash}, requested={hash})"
                    ));
                }
                self.state.apply_block(&block)?;
                // **F006.5** — record the apply timestamp AFTER a
                // successful apply so a failed apply does not "consume"
                // a cadence slot (a retry would otherwise be incorrectly
                // rate-limited even though no commit actually happened).
                *self.last_commit_at.lock().await = Some(Instant::now());
                Ok(vec![FsmEvent::BlockApplied { height, hash }])
            }
            FsmAction::BroadcastPrevote { target } => {
                tracing::debug!(
                    "fsm_runtime: BroadcastPrevote stub (target={:?}) — gossip via legacy vote_loop",
                    target
                );
                Ok(Vec::new())
            }
            FsmAction::BroadcastPrecommit { target } => {
                tracing::debug!(
                    "fsm_runtime: BroadcastPrecommit stub (target={:?}) — gossip via legacy vote_loop",
                    target
                );
                Ok(Vec::new())
            }
            FsmAction::EnteredRound { height, round } => {
                tracing::info!("fsm_runtime: entered round h={height} r={round}");
                Ok(Vec::new())
            }
            FsmAction::EnteredHeight { height } => {
                tracing::info!("fsm_runtime: entered height h={height}");
                // Fresh height: clear quorum dedup ledger so the new
                // height's quorums can be observed without false
                // "already emitted" hits.
                self.last_emitted_quorum.lock().await.clear();
                Ok(Vec::new())
            }
        }
    }

    /// **F006.4 — Real event loop.** Replaces the F006.3 warn+sleep
    /// guard with a tick-driven sequential loop that, on every
    /// `TICK_INTERVAL_MS` (500ms) wake-up, runs (a) the tick clock
    /// then (b) the vote-pool watcher poll. Each emitted action is
    /// dispatched through `handle_action`, and any downstream events
    /// the dispatch produces (e.g. `BlockApplied` from `CommitBlock`)
    /// are re-fed into `FsmState::step` in the same iteration so the
    /// FSM can advance out of `Step::Commit` immediately. This
    /// implements the closed-loop "event → action → event" pipeline
    /// the FSM needs to cycle through Tendermint's Propose → Prevote
    /// → Precommit → Commit phases without a separate broker.
    ///
    /// **Why not `tokio::select!`?** With only the tick interval as
    /// an awaitable source (the watcher is a synchronous poll, not a
    /// channel) `select!` would degenerate to a single-arm `select!`
    /// over `interval.tick()` — equivalent to `interval.tick().await`
    /// but harder to read. F006.4.5 (proposal gossip ingress) will
    /// add a real second source — a channel of incoming
    /// `cache_proposal` calls from p2p — at which point this loop
    /// becomes a proper `tokio::select!` over both. Keeping the
    /// shape simple now reduces F006.7 review surface.
    ///
    /// Caller pattern is `tokio::spawn(rt.run())` — the loop owns
    /// `self` via `Arc<FsmRuntime>` cloning so multiple sites (RPC
    /// `/fsm/state` getter, future architect dashboards) can hold
    /// references concurrently.
    ///
    /// **Disabled-fast path:** when `enabled()` returns `false`, the
    /// loop returns immediately. No warning, no busy-wait. This means
    /// a future `main.rs` change to unconditionally `tokio::spawn`
    /// the runtime is safe — the spawn does nothing in production
    /// until the operator opts in.
    ///
    /// **Shadow-observer mode** (F006.4 default even when enabled):
    /// the loop runs but `handle_action` no-ops `BuildProposal` /
    /// `BroadcastPrevote` / `BroadcastPrecommit`, so the FSM cannot
    /// produce side effects that would diverge from the legacy
    /// producer. F006.7 will lift this restriction (and simultaneously
    /// stop the legacy producer) once F006.5 + F006.6 prove the FSM
    /// byte-identical.
    pub async fn run(self: Arc<Self>) {
        if !enabled() {
            tracing::debug!(
                "fsm_runtime: ZEBVIX_FSM_ENABLED unset — runtime exits without driving consensus (legacy producer in charge)"
            );
            return;
        }
        let start_height = {
            let fsm = self.fsm.lock().await;
            fsm.height
        };
        tracing::info!(
            "fsm_runtime: starting shadow-observer loop at h={start_height} (F006.4 — legacy producer still in charge, FSM will not pre-empt until F006.7)"
        );
        let mut interval = tokio::time::interval(Duration::from_millis(TICK_INTERVAL_MS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            let now = Instant::now();

            // 1. Tick clock — drives timeout enforcement. Collect any
            //    downstream events its action dispatches produce.
            let mut pending: Vec<FsmEvent> = match self.tick_once(now).await {
                Ok(evs) => evs,
                Err(e) => {
                    tracing::warn!("fsm_runtime: tick_once error: {e}");
                    Vec::new()
                }
            };

            // 2. Vote-pool watcher — append any newly-crossed quorums
            //    to the pending event queue.
            pending.extend(self.poll_vote_quorums().await);

            // 3. Closed-loop event drain — feed every pending event
            //    through `step`, dispatch its actions, and fold any
            //    further downstream events back into the queue.
            //    Bounded by FSM monotonicity (height/round only
            //    advance) so the queue cannot grow unboundedly within
            //    one tick. Hard cap as a defensive belt-and-braces.
            const MAX_EVENTS_PER_TICK: usize = 64;
            let mut drained = 0usize;
            while let Some(event) = pending.pop() {
                drained += 1;
                if drained > MAX_EVENTS_PER_TICK {
                    tracing::warn!(
                        "fsm_runtime: event queue exceeded {MAX_EVENTS_PER_TICK} per tick — possible feedback loop, dropping remainder"
                    );
                    break;
                }
                let actions = {
                    let mut fsm = self.fsm.lock().await;
                    let am_p = self.am_proposer_now(&fsm);
                    fsm.step(event, am_p, now)
                };
                for action in actions {
                    match self.handle_action(action).await {
                        Ok(downstream) => pending.extend(downstream),
                        Err(e) => tracing::warn!("fsm_runtime: handle_action error: {e}"),
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::generate_keypair;
    use crate::mempool::Mempool;
    use crate::types::{Address, Validator};
    use crate::vote::{sign_vote, VoteData};
    use tempfile::TempDir;

    /// Acceptance criterion for F006.1: `enabled()` returns `false` in a
    /// `cargo test` environment (no env var set). Safety guarantee that
    /// a deployed binary cannot accidentally hand consensus to the
    /// dormant runtime.
    #[test]
    fn enabled_defaults_to_false() {
        std::env::remove_var("ZEBVIX_FSM_ENABLED");
        assert!(
            !enabled(),
            "FSM runtime must be dormant by default — operator must opt in"
        );
    }

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
        let legacy = Duration::from_secs(crate::consensus::PROPOSE_TIMEOUT_SECS);
        assert_eq!(
            t.propose, legacy,
            "FSM propose timeout drifted from legacy PROPOSE_TIMEOUT_SECS"
        );
    }

    /// Build a real `(State, Producer, VotePool, FsmRuntime)` fixture
    /// against a fresh RocksDB tempdir with one validator registered.
    /// Returns the secret + the validator's address so callers can
    /// sign votes / blocks.
    fn fresh_runtime_fixture() -> (
        TempDir,
        Arc<FsmRuntime>,
        [u8; 32],
        [u8; 33],
        crate::types::Address,
    ) {
        let td = TempDir::new().unwrap();
        let state = Arc::new(State::open(td.path()).unwrap());
        let (sk, pk) = generate_keypair();
        let v = Validator::new(pk, 10);
        let addr = v.address;
        state.put_validator(&v).unwrap();
        let mempool = Arc::new(Mempool::new(state.clone(), 50_000));
        let producer = Arc::new(Producer::new(sk, state.clone(), mempool));
        let chain_id = 0u64;
        let vote_pool = Arc::new(VotePool::new(chain_id));
        let rt = Arc::new(FsmRuntime::new(producer, state, vote_pool));
        (td, rt, sk, pk, addr)
    }

    /// F006.3 dispatch test — `EnteredRound` + `EnteredHeight` are
    /// log-only and must return an empty event vector without error.
    #[tokio::test(flavor = "current_thread")]
    async fn handle_action_log_only_variants_are_silent() {
        let (_td, rt, _sk, _pk, _addr) = fresh_runtime_fixture();
        let evs = rt.handle_action(FsmAction::EnteredRound { height: 1, round: 0 })
            .await.unwrap();
        assert!(evs.is_empty());
        let evs = rt.handle_action(FsmAction::EnteredHeight { height: 2 })
            .await.unwrap();
        assert!(evs.is_empty());
        let evs = rt.handle_action(FsmAction::BroadcastPrevote { target: None })
            .await.unwrap();
        assert!(evs.is_empty());
        let evs = rt.handle_action(FsmAction::BroadcastPrecommit { target: None })
            .await.unwrap();
        assert!(evs.is_empty());
    }

    /// F006.4 — `BuildProposal` is now a no-op stub (shadow-observer
    /// mode). Returns Ok(empty) without touching producer.build_block.
    #[tokio::test(flavor = "current_thread")]
    async fn handle_action_build_proposal_is_shadow_stub() {
        let (_td, rt, _sk, _pk, _addr) = fresh_runtime_fixture();
        let evs = rt.handle_action(FsmAction::BuildProposal { reuse_valid: None })
            .await.unwrap();
        assert!(evs.is_empty(), "BuildProposal must be log-only in F006.4");
        // Cache must be unchanged — no production-side effect.
        assert!(rt.proposal_cache.lock().await.is_empty());
    }

    /// F006.4 — `CommitBlock` below current tip is a no-op (legacy
    /// already committed) but must still emit `BlockApplied` so the
    /// FSM advances out of `Step::Commit`.
    #[tokio::test(flavor = "current_thread")]
    async fn handle_action_commit_block_below_tip_is_idempotent() {
        let (_td, rt, _sk, _pk, _addr) = fresh_runtime_fixture();
        // Tip is 0 (genesis-only). CommitBlock at height 0 → below tip
        // (0 <= 0), should skip apply but emit ack.
        let dummy_hash = Hash([7u8; 32]);
        let evs = rt.handle_action(FsmAction::CommitBlock { height: 0, hash: dummy_hash })
            .await.unwrap();
        assert_eq!(evs.len(), 1);
        assert!(matches!(evs[0], FsmEvent::BlockApplied { .. }));
    }

    /// F006.4 — `CommitBlock` above tip without a cached proposal must
    /// error (the cache_proposal hook must be wired before F006.7).
    #[tokio::test(flavor = "current_thread")]
    async fn handle_action_commit_block_above_tip_without_cache_errs() {
        let (_td, rt, _sk, _pk, _addr) = fresh_runtime_fixture();
        let dummy_hash = Hash([9u8; 32]);
        let err = rt.handle_action(FsmAction::CommitBlock { height: 5, hash: dummy_hash })
            .await.expect_err("must error without cached proposal");
        assert!(format!("{err}").contains("no proposal cached"), "got: {err}");
    }

    /// **T001 acceptance** — vote-pool watcher emits `PrevoteQuorum`
    /// when the pool crosses the 2/3+ threshold (trivially met under
    /// N=1: 1 vote = 1/1 = 100% > 66.7%).
    #[tokio::test(flavor = "current_thread")]
    async fn poll_vote_quorums_emits_prevote_quorum_under_n1() {
        let (_td, rt, sk, pk, _addr) = fresh_runtime_fixture();
        let target_hash = Hash([1u8; 32]);
        let chain_id = 0u64;
        // FSM starts at height 1 (genesis tip is 0, recover_from_state
        // returns 0+1).
        let vd = VoteData {
            chain_id,
            height: 1,
            round: 0,
            vote_type: VoteType::Prevote,
            block_hash: Some(target_hash),
        };
        let vote = sign_vote(&sk, pk, vd).expect("sign_vote ok");
        let validators = rt.state.validators();
        let r = rt.vote_pool.add(vote, &validators);
        assert!(matches!(r, crate::vote::AddVoteResult::Inserted { reached_quorum: true }),
                "1/1 vote must reach quorum, got: {:?}", r);
        let evs = rt.poll_vote_quorums().await;
        assert_eq!(evs.len(), 1, "expected one PrevoteQuorum event, got {}", evs.len());
        match &evs[0] {
            FsmEvent::PrevoteQuorum { height, round, target } => {
                assert_eq!(*height, 1);
                assert_eq!(*round, 0);
                assert_eq!(*target, Some(target_hash));
            }
            other => panic!("expected PrevoteQuorum, got {other:?}"),
        }
        // Dedup: second poll with no new votes emits nothing.
        let evs2 = rt.poll_vote_quorums().await;
        assert!(evs2.is_empty(), "dedup must suppress repeat emission");
    }

    /// **T002 acceptance** — `tick_once` with no quorum / no proposal
    /// must complete without error and not change FSM height.
    #[tokio::test(flavor = "current_thread")]
    async fn tick_once_without_quorum_is_noop_on_height() {
        let (_td, rt, _sk, _pk, _addr) = fresh_runtime_fixture();
        let h_before = rt.fsm.lock().await.height;
        let downstream = rt.tick_once(Instant::now()).await.unwrap();
        // Single-validator setup MAY emit BuildProposal at height 1 r=0
        // (we are the proposer). That action is now a no-op stub, so
        // no downstream events should be produced.
        assert!(downstream.is_empty(), "shadow-observer must not produce events");
        let h_after = rt.fsm.lock().await.height;
        assert_eq!(h_before, h_after, "tick alone must not advance height");
    }

    /// Helper — build a dummy `Block` at a given height. All other
    /// fields are zeroed; the cache only keys by `height`.
    fn dummy_block_at(h: u64) -> Block {
        use crate::types::BlockHeader;
        Block {
            header: BlockHeader {
                height: h,
                parent_hash: Hash([0u8; 32]),
                state_root: Hash([0u8; 32]),
                tx_root: Hash([0u8; 32]),
                timestamp_ms: 0,
                proposer: Address::default(),
            },
            txs: Vec::new(),
            signature: [0u8; 64],
        }
    }

    /// **T003 acceptance** — proposal cache caps at PROPOSAL_CACHE_CAP
    /// and evicts the smallest height first.
    #[tokio::test(flavor = "current_thread")]
    async fn proposal_cache_caps_and_evicts_smallest_height() {
        let (_td, rt, _sk, _pk, _addr) = fresh_runtime_fixture();
        // Insert PROPOSAL_CACHE_CAP + 6 blocks at heights 100..170.
        for h in 100..(100 + PROPOSAL_CACHE_CAP as u64 + 6) {
            rt.cache_proposal(dummy_block_at(h)).await;
        }
        let cache = rt.proposal_cache.lock().await;
        assert_eq!(cache.len(), PROPOSAL_CACHE_CAP, "cache must cap at PROPOSAL_CACHE_CAP");
        // The 6 smallest heights (100..106) should be evicted.
        let smallest_kept = *cache.keys().next().unwrap();
        assert_eq!(smallest_kept, 100 + 6, "smallest 6 must be evicted");
        let largest_kept = *cache.keys().next_back().unwrap();
        assert_eq!(largest_kept, 100 + PROPOSAL_CACHE_CAP as u64 + 5);
    }

    /// **T004 acceptance** — `recover_from_state` returns `tip + 1`.
    /// Fresh state has tip 0, so recovery returns 1.
    #[test]
    fn recover_from_state_returns_tip_plus_one() {
        let td = TempDir::new().unwrap();
        let state = State::open(td.path()).unwrap();
        let h = recover_from_state(&state);
        assert_eq!(h, 1, "fresh state has tip 0, recovery must return 1");
    }

    /// **T005 acceptance** — `run()` returns immediately when
    /// `ZEBVIX_FSM_ENABLED` is unset. No infinite loop, no warning,
    /// no busy-wait.
    #[tokio::test(flavor = "current_thread")]
    async fn run_returns_immediately_when_disabled() {
        std::env::remove_var("ZEBVIX_FSM_ENABLED");
        let (_td, rt, _sk, _pk, _addr) = fresh_runtime_fixture();
        let start = Instant::now();
        // Should return within milliseconds — assert under 100ms.
        tokio::time::timeout(Duration::from_millis(100), rt.run())
            .await
            .expect("run() must return immediately when disabled");
        assert!(start.elapsed() < Duration::from_millis(100));
    }

    // ─── F006.5 — Cadence rate-limiter tests ─────────────────────────

    /// **F006.5 acceptance — Parity guard.** `MIN_BLOCK_INTERVAL` MUST
    /// equal `BLOCK_TIME_SECS`. If a future tokenomics change tweaks
    /// the legacy producer's pacing, this test fails until F006.5 is
    /// re-tuned in lockstep — preventing silent byte-divergence
    /// between FSM and legacy commits.
    #[test]
    fn min_block_interval_matches_block_time_secs() {
        assert_eq!(
            MIN_BLOCK_INTERVAL,
            Duration::from_secs(crate::tokenomics::BLOCK_TIME_SECS),
            "F006.5 cadence drifted from legacy BLOCK_TIME_SECS — fix one or the other"
        );
    }

    /// **F006.5 acceptance — Recent commit triggers rate-limit defer.**
    /// With `last_commit_at = Some(now)`, an above-tip CommitBlock that
    /// would otherwise hit the cache-miss error path MUST instead be
    /// short-circuited by the rate-limiter and return `Ok(empty)`. The
    /// fact that we never reach the cache lookup proves the gate fires
    /// BEFORE cache mutation — preserving cache integrity for the
    /// retry on the next tick.
    #[tokio::test(flavor = "current_thread")]
    async fn handle_action_commit_block_rate_limited_returns_empty_and_preserves_cache() {
        let (_td, rt, _sk, _pk, _addr) = fresh_runtime_fixture();
        // Cache a dummy proposal at h=5 so we can prove cache survives.
        rt.cache_proposal(dummy_block_at(5)).await;
        assert_eq!(
            rt.proposal_cache.lock().await.len(),
            1,
            "precondition: one cached proposal"
        );
        // Simulate a recent successful commit (just now).
        *rt.last_commit_at.lock().await = Some(Instant::now());

        // Try to commit at h=5 (above tip 0). The rate-limiter must
        // fire BEFORE the cache lookup. Without the gate, the next
        // line would error or apply.
        let dummy_hash = Hash([3u8; 32]);
        let evs = rt
            .handle_action(FsmAction::CommitBlock { height: 5, hash: dummy_hash })
            .await
            .expect("rate-limited commit must NOT propagate as error");
        assert!(
            evs.is_empty(),
            "rate-limited commit must return empty events (FSM stays in Step::Commit)"
        );
        // Cache entry MUST be preserved so the next-tick retry can use it.
        assert_eq!(
            rt.proposal_cache.lock().await.len(),
            1,
            "cache must be preserved when commit is rate-limit-deferred"
        );
    }

    /// **F006.5 acceptance — Rate-limit clears after `MIN_BLOCK_INTERVAL`.**
    /// With `last_commit_at` set to longer than `MIN_BLOCK_INTERVAL`
    /// ago, the gate MUST clear and the dispatch MUST proceed past
    /// the rate-limiter into the cache-lookup path (and error there
    /// because the cache is empty — that error is the proof we got
    /// past the gate). Belt-and-braces test that elapsed-time math
    /// is correct (no off-by-one or sign errors).
    #[tokio::test(flavor = "current_thread")]
    async fn handle_action_commit_block_rate_limit_clears_after_min_interval() {
        let (_td, rt, _sk, _pk, _addr) = fresh_runtime_fixture();
        // Set last_commit_at to slightly more than MIN_BLOCK_INTERVAL ago.
        let past = Instant::now()
            .checked_sub(MIN_BLOCK_INTERVAL + Duration::from_millis(50))
            .expect("system clock must support subtraction (CI runs on uptime > 5s)");
        *rt.last_commit_at.lock().await = Some(past);

        // No cached proposal at h=5 → after rate-limit gate clears,
        // we hit the cache-miss error. That error proves the gate
        // cleared (otherwise we'd see Ok(empty) instead).
        let dummy_hash = Hash([4u8; 32]);
        let err = rt
            .handle_action(FsmAction::CommitBlock { height: 5, hash: dummy_hash })
            .await
            .expect_err("rate-limit cleared, expected to reach cache-miss error");
        assert!(
            format!("{err}").contains("no proposal cached"),
            "expected cache-miss error proving rate-limit cleared, got: {err}"
        );
    }
}
