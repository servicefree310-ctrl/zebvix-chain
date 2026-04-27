# Zebvix Chain — Hardening TODO (Honest Deferral List)

The Phase-H security pass (April 2026) shipped these fixes:

| ID  | Title                                              | Status |
|-----|----------------------------------------------------|--------|
| H3  | crypto: panic → Result on bad secret               | ✅ done |
| H1  | mempool: fee-priority sort + drop-lowest eviction  | ✅ done |
| H6  | bridge: global pause flag (admin-toggle)           | ✅ done |
| H4* | apply_block: WriteBatch on final commit window     | ✅ done (partial) |
| —   | mDNS: default off (opt-in via --enable-mdns)       | ✅ done |

The following are **deliberately deferred**. They're either chain-breaking
(would brick the live VPS chain at height ~30k+ unless coordinated via a
height-gated activation), or genuinely multi-week work that warrants its
own phase. This file tracks them honestly so they're not forgotten.

---

## C1 — Replace block-producer rotation with real BFT

**Phase B.3.2.5 (April 2026, commit-persistence landed):** The full BFT
side-table pipeline is now wired and live. Architecture choice:
**side-table storage**, NOT in-block fields.

**Storage:** BFT commits are persisted at `bft/c/<32-byte block_hash>`
in `CF_META` as `bincode::serialize(&Vec<Vote>)`. Helpers:
`State::put_bft_commit(&block_hash, blob)` and
`State::get_bft_commit(&block_hash) -> Option<Vec<u8>>`. **`Block` and
`BlockHeader` byte layouts are unchanged from chain inception.** Adding
or removing BFT data NEVER requires a DB migration.

**Persistence:** `main::try_persist_bft_commit_for(state, pool, height,
target_hash)` runs from BOTH vote-handling tasks (local emit + p2p
inbound) on every `AddVoteResult::Inserted { reached_quorum: true }`
for a Precommit. It calls `pool.collect_precommits_for(...)` (which
deterministically aggregates ALL Precommits for the (height, hash)
pair across rounds, sorted by validator address), bincodes the result,
and writes via `put_bft_commit`. Logged at INFO as `📜 BFT commit
persisted h=N hash=0x... precommits=K bytes=B` — ops can grep this
to confirm the pipeline is live.

**Restart safety:** the local emit task initializes
`last_emitted = tip.saturating_sub(1)` so a restart re-emits +
re-persists the commit for the existing tip block on the very first
tick. Without this, a restart that races a fresh tip would leave no
side-table entry for that block, breaking the gate when the next
height was produced.

**Verifier:** `vote::verify_last_commit_for_parent(parent_hash,
parent_height, last_commit_bytes, chain_id, validators)` enforces
per-vote sanity (chain_id / height / type / target / sig), dedup,
validator-set membership, the 2/3+ voting-power quorum, and the
genesis-adjacent rule (parent_height==0 → must be empty). 11 dedicated
unit tests in `vote.rs::tests` cover the verifier surface.

**Gate:** `state::apply_block` reads `get_bft_commit(parent_hash)` and
runs the verifier when `block.header.height >=
ZEBVIX_BFT_COMMIT_GATE_ACTIVATION_HEIGHT` (default `u64::MAX` = OFF).
Below the activation height, no check runs and `Producer::run` continues
as the single-validator-PoA driver.

**DB compatibility:** Existing RocksDB devnet/VPS databases boot
unchanged. `EXPECTED_DB_FORMAT_VERSION = 1` matches all chain history;
legacy DBs without the marker are auto-stamped v1 on first boot
(logged at INFO). **No wipe required to upgrade to this binary.**

**Phase 3 ops procedure — flip the gate ON:**
1. Deploy the Phase B.3.2.5 binary; verify `📜 BFT commit persisted`
   appears in journalctl on every block (every ~5s on default pacing).
2. Compute a future activation height: `ACTIVATION = current_tip + 100`
   (gives ~8 minutes of buffer at 5s/block before enforcement).
3. `sudo systemctl edit zebvix` and add:
   ```
   [Service]
   Environment="ZEBVIX_BFT_COMMIT_GATE_ACTIVATION_HEIGHT=NNNN"
   ```
4. `sudo systemctl restart zebvix` — chain continues, side-table
   commits keep being persisted.
5. After height passes `ACTIVATION`, every `apply_block` enforces that
   the parent's commit blob exists and verifies. Confirm no
   `BFT commit gate REJECTED` lines in logs.

**Status:**
1. ~~Add `Vote { height, round, kind, hash, signer, signature }`~~ — done.
2. ~~Add LastCommit verifier + side-table storage~~ — done (April 2026).
3. ~~Persist commit blob via `put_bft_commit` on Precommit quorum~~ — done (Phase B.3.2.5).
4. ~~Wire equivocation evidence → optional slash via staking `slash_double_sign`~~ — done (env-gated).
5. **Operator step:** flip `ZEBVIX_BFT_COMMIT_GATE_ACTIVATION_HEIGHT`
   to a future height once Phase 2 is deployed across all validators.
6. Replace `Producer::run` round-robin self-apply with full quorum-driven
   `ConsensusFsm { Propose, PreVote, PreCommit, Commit }` — **module
   shipped April 2026 (Phase B.3.2.6)**, runtime integration pending.
   - **Module:** `zebvix-chain/src/fsm.rs` (~750 lines incl. tests).
     Pure functions, no I/O, no async. Types: `Step`, `LockedBlock`,
     `ValidBlock`, `Timeouts`, `FsmState`, `FsmEvent`, `FsmAction`.
   - **Lock-on-precommit:** validator that broadcasts `Precommit(hash)`
     in round R locks `(R, hash)` and may only re-prevote that hash
     (or nil) until it observes 2/3+ Prevotes for a different block in
     some round R' > R (POL release). Re-locks on the new block at the
     new round when the FSM is at that round's Prevote/Propose step.
   - **View-change:** propose/prevote/precommit timeouts each bump the
     round; observing `f+1` votes at any round > self.round triggers
     immediate fast-forward via `EnteredRound`. Late precommit quorums
     from past rounds still commit.
   - **Valid block tracking:** every prevote quorum updates
     `valid = (round, hash)`; the next proposer reuses `valid.hash`
     instead of building a fresh block (Tendermint convergence).
   - **Tests:** 20 standalone tests cover happy path, propose timeout,
     precommit timeout, lock-respect, lock-release-with-relock,
     lock-release-without-relock, nil-prevote → nil-precommit,
     nil-precommit → round bump, view-change up & no-op down,
     proposal-from-higher-round jump, late-commit, valid-block reuse,
     the two helper functions, plus 5 architect-review safety tests
     (height-mismatch silent-drop, precommit-nil-on-unseen-hash,
     precommit-non-nil-after-proposal-seen, BlockApplied-wrong-hash-
     ignored, no-round-bump-while-committing). All pass via standalone
     `rustc --test` (full `cargo test --lib` blocked by environment
     build limits — see HARDENING_TODO note below).
   - **Architect-review safety hardening (April 2026):** the first
     architect pass returned FAIL with three critical findings, all
     now fixed in the shipped module:
     1. **Height binding on every event:** `FsmEvent` variants
        (`ProposalSeen`, `PrevoteQuorum`, `PrecommitQuorum`,
        `HigherRoundSeen`, `BlockApplied`) now carry an explicit
        `height: u64`. `FsmState::step` silently drops events whose
        height ≠ `self.height` so misrouted vote-pool signals can
        never commit the wrong height's block.
     2. **Precommit-only-on-seen-proposal:** non-nil precommit is
        emitted only when `self.proposal == Some(quorum_target)`. If
        a quorum forms on a hash we haven't validated locally, we
        precommit nil. This prevents byzantine majorities (or buggy
        plumbing) from forging our signature on unseen blocks.
     3. **Apply-acknowledged height advance:** `Step::Commit` no
        longer auto-advances on commit-timeout. The runtime must send
        a new `FsmEvent::BlockApplied { height, hash }` event after
        a successful state apply + side-table commit-blob persist;
        only then does `enter_height` fire. Mismatched-hash acks are
        refused. The new `committing: Option<Hash>` field on
        `FsmState` tracks the in-flight commit and also blocks any
        nil-quorum round-bump while the apply is outstanding.
   - **Runtime integration:** DEFERRED to next session. New env flag
     `ZEBVIX_FSM_ENABLED` (default OFF) will gate the swap-in. The
     existing `Producer::run` PoA path stays unchanged on deploy so
     the live VPS chain at h=50K+ keeps producing blocks identically.
     With flag ON + N=1, the FSM walks every step trivially (1/1
     quorum) and produces the same blocks; with N≥2 it delivers real
     BFT safety + liveness. See `.local/session_plan.md` task F006.
   - **F006 prerequisites flagged by architect re-review (must land in
     the next session):**
     a. **Durable, ordered commit-apply-ack plumbing:** the runtime
        adapter that consumes `FsmAction::CommitBlock` and emits
        `FsmEvent::BlockApplied` must be at-least-once with hash
        binding (i.e. apply must complete + side-table commit blob
        must persist BEFORE the ack fires). A lost ack is recoverable
        (FSM retries CommitBlock on commit-timeout, apply is
        idempotent at the State layer because applied-height is
        checked first), but an ack-before-persist would be a safety
        bug — never reorder.
     b. **Startup recovery for in-flight commit:** on node restart
        while the FSM was in `Step::Commit`, the adapter must inspect
        the side-table for the height's commit blob; if present the
        adapter immediately re-emits `BlockApplied { height, hash }`
        so the FSM resumes; if absent it re-issues the apply and
        waits. The FSM itself is in-memory only — it does not survive
        restarts and must be reconstructed from on-disk state.
     c. **Observability:** structured logs (or metrics) for
        "stuck-in-Commit > N seconds", "dropped wrong-height event",
        "dropped wrong-hash BlockApplied ack", and "round-bump count
        per height". These let an operator detect a runtime/plumbing
        regression that the FSM is silently absorbing.
     d. **Permanent apply failure policy:** commit-timeout retry is
        the right behaviour for transient failures, but a persistent
        apply error must escalate (fail-stop the node + alert), NOT
        spin forever. Decide policy: fail-stop after K retries, or
        deterministic recovery via state rebuild from peers.
     e. **N=1 cadence preservation:** when ENABLED with a single
        validator the FSM proposes immediately on Tick; the runtime
        adapter must rate-limit proposals to honour the legacy
        `BLOCK_TIME_SECS` so block timestamps stay stable for tooling
        that depends on a 5s cadence. Pure FSM intentionally has no
        wall-clock cadence — that is a runtime concern.

**Deferred to a future versioned `HeaderV2` (single coordinated upgrade):**
- Proposer-signature binding to `commit_hash`. Today the side-table
  blob is trusted on its own merits (every signed precommit verifies
  independently); a byzantine proposer COULD serve different commit
  blobs to different peers. The fix is a single header-schema bump
  (height-gated) paired with `EXPECTED_DB_FORMAT_VERSION=2` and
  migration code.

**Risk profile:**
- Pre-Phase 3 (gate OFF): identical to legacy single-validator PoA;
  side-table fills but is not enforced.
- Post-Phase 3 (gate ON), N=1 validator: no security improvement vs
  PoA — the lone validator's signature IS the quorum (1/1 trivially
  passes). The gate only hardens N≥4.
- Post-Phase 3, N≥4 validators: forks require ≥1/3 byzantine power
  to suppress quorum on an honest proposal, and equivocation by a
  byzantine validator is detectable + slashable.

---

## C2 — Swap signing hash to Keccak256 (EVM-native compat)

**Current state:** `crypto::sign_tx` uses `k256::ecdsa::SigningKey::sign`
which hashes the message with SHA-256. This is cryptographically secure,
but it means a MetaMask-signed `personal_sign` blob will not verify on
Zebvix's native tx path. ETH-shaped *addresses* (Keccak256 of pubkey) are
already correct.

**Why deferred:** This is **chain-breaking**. Every transaction in
existing blocks (height 0 → tip) was signed under the SHA-256 path. A
straight swap would invalidate the entire chain history on full-sync
from genesis.

**Migration plan (high-level):**
1. Add `SIGN_HASH_ACTIVATION_HEIGHT` env (default `u64::MAX` = disabled).
2. Implement `sign_tx_keccak` using `k256::ecdsa::SigningKey::sign_prehash`
   over `Keccak256(bincode(body))`.
3. `verify_tx` chooses path based on `block_height_at_inclusion >= activation`.
4. Coordinate testnet → mainnet activation via governance proposal.

**Concrete sub-tasks (per the B.3.2.7 plan below):**

- **C2.1 — Dual signing API.** In `crypto.rs`:
  - Keep `sign_tx(...)` and `verify_tx(...)` byte-stable (do NOT touch
    legacy SHA-256 path — chain history depends on it).
  - Add `sign_tx_keccak(sk, body) -> Signature` using `SigningKey::
    sign_prehash(&Keccak256::digest(bincode::serialize(body)?))`.
  - Add `verify_tx_keccak(sig, body, addr) -> bool` mirroring it via
    `VerifyingKey::verify_prehash`.
  - Re-export both new functions from `lib.rs`.
  - **Acceptance:** unit tests in `crypto::tests` cover round-trip for
    both paths; cross-path verify MUST fail (sign-keccak / verify-sha →
    error and vice-versa).

- **C2.2 — Height-gated dispatch in transaction verification.** Locate
  the single call site in `state::apply_block` (or wherever `verify_tx`
  is invoked) and replace with:
  ```
  let use_keccak = block.header.height >= sign_hash_activation_height();
  if use_keccak { verify_tx_keccak(...) } else { verify_tx(...) }
  ```
  - Add `pub fn sign_hash_activation_height() -> u64` reading
    `ZEBVIX_SIGN_HASH_ACTIVATION_HEIGHT` env var (default
    `u64::MAX`).
  - **Acceptance:** integration test feeds a block at height
    `activation - 1` with sha-signed tx (must verify) and a block at
    `activation` with keccak-signed tx (must verify); both with the
    "wrong" sig variant must fail.

- **C2.3 — Mempool propagation.** `mempool::insert` ALSO verifies
  signatures pre-insertion. Mirror the dispatch logic using the
  *current tip* height (the height at which this tx will likely be
  included) so a MetaMask-signed tx is accepted into the pool only
  after the activation height passes locally.
  - **Acceptance:** mempool unit test rejects keccak-signed tx
    pre-activation, accepts post-activation; rejects sha-signed tx
    post-activation.

- **C2.4 — RPC submission path.** `eth_sendRawTransaction` and Zebvix's
  native `zvb_submitTx` both feed the mempool — confirm both paths
  hit the dispatch in C2.3 (no separate verify shortcut).

- **C2.5 — Tooling: signing CLI + Flutter wallet.** Add a
  `--keccak` flag to whichever CLI signs txs (e.g. `cli::tx::sign`
  subcommand). Update the Flutter wallet's signing call site to flip
  to keccak path once activation height is set in the wallet config.
  Document in `replit.md` the exact upgrade order: chain
  binary → activation env → wallet config → user-visible flip.

- **C2.6 — Operator activation run-book.** Add to `replit.md` the
  same procedure pattern as `ZEBVIX_BFT_COMMIT_GATE_ACTIVATION_HEIGHT`:
  compute `ACTIVATION = current_tip + 100` (~8min buffer at 5s/block),
  `sudo systemctl edit zebvix` to set
  `Environment="ZEBVIX_SIGN_HASH_ACTIVATION_HEIGHT=NNNN"`, restart,
  watch logs.

**Risk if not done:** dApps signing intents in MetaMask need a Zebvix-aware
relayer (the current Flutter wallet pattern). No security risk per se —
the SHA-256 ECDSA-secp256k1 scheme is a NIST standard.

---

## C3 — M-of-N validator threshold for `BridgeIn` (replace single-admin oracle)

**Current state:** `BridgeOp::BridgeIn` is admin-only (single key — see
`state.rs:1570`). H6 added a global pause flag as the immediate
mitigation: if the admin key is compromised, the chain operator can
freeze all bridge ops with one tx.

**Why deferred:** Real multi-sig oracles need:
- A federation registry (separate from validator set, with thresholds
  per asset / per network) stored in CF_META.
- A new `BridgeIn` carrying `Vec<(oracle_pubkey, sig)>` and a deterministic
  message hash that all signers sign.
- Off-chain oracle coordination (gossip layer or shared message queue)
  — out of scope for the chain crate itself.

**Migration plan:**
1. Add `BridgeFederation { asset_id, members: Vec<Address>, threshold: u8 }`.
2. New variant `BridgeOp::BridgeInMultisig { ..., signatures: Vec<(Address, [u8; 64])> }`.
3. Verify `signatures.len() ≥ federation.threshold` and each sig is by a
   member over `keccak256(asset_id || src_tx_hash || recipient || amount)`.
4. Keep single-admin `BridgeIn` available behind a feature flag for
   small / testnet deployments; deprecate post-activation.

**Risk if not done:** Oracle key compromise = full bridge mint authority.
**H6 pause flag is the kill-switch** until C3 ships.

---

## H2 — Block-STM parallel transaction execution

**Current state:** `block_stm.rs` is a doc-comment-only scaffold; apply_block
runs txs serially. Throughput is sender-serialized.

**Why deferred:** A real Block-STM needs deterministic MVCC (multi-version
concurrency control), per-tx read/write set tracking, conflict detection,
and re-execution — same model as Aptos. ~1k LoC + extensive testing.

**Migration plan:** Implement Aptos-style `Scheduler { task_queue, version_map }`
in `block_stm.rs`. Wire into apply_block behind `--enable-parallel-exec`
flag for safe rollout.

**Risk if not done:** Throughput ceiling. Not a security issue.

---

## H5 — Gossipsub peer scoring + slashing hooks

**Current state:** `p2p.rs` uses `gossipsub::ValidationMode::Strict` and
hashes messages for dedupe, but has no `peer_score_params` configured.
Misbehaving peers (spammy txs, invalid blocks) are not penalized at the
transport layer.

**Why deferred:** libp2p's `PeerScoreParams` has 12+ tunable knobs that
need empirical baseline from real-network traffic. Tuning before live
data risks accidentally banning honest peers.

**Migration plan:**
1. Add `gossipsub::ConfigBuilder::peer_score_params(...)` with conservative
   thresholds (`gossip_threshold = -10.0`, `publish_threshold = -50.0`,
   `graylist_threshold = -80.0`).
2. Hook gossipsub `peer_score` events into staking-module `jail` for
   validators that drop below the graylist threshold.
3. Bake on testnet for ≥ 1 week, then ship.

**Risk if not done:** A noisy peer can degrade gossip latency. Not
exploitable for funds, just liveness pressure.

---

## Phase B.3.2.7 — Next Implementation Session Plan (F006 + C2)

This is the consolidated, priority-ordered execution plan for the next
session. Both items below are tracked above (F006 = C1.6 prerequisites
checklist; C2 = §C2 sub-tasks). They are listed here together so the
session has a single roadmap with explicit dependencies, sequencing,
and risk profile.

**Priority order:** F006 first (consensus-critical), then C2 (chain-
breaking activation needs careful operator coordination, lower urgency).
The two are independent — they touch different modules — so if a
parallel pair-coding situation arises they can advance in parallel,
but the deploy ordering MUST be: F006 ON in dev first, then C2 dev,
then F006 mainnet, then C2 mainnet (never both height-gates flipping
on the same restart).

**Risk profile:** F006 is a runtime swap inside `Producer::run` —
behaviour-altering even with the flag OFF if the wiring is wrong, so
the test matrix must include "ENABLED=false produces byte-identical
blocks to current legacy path" as the gating green-light. C2 is a
pure addition (new functions + dispatch) and cannot break legacy
because the activation env defaults to `u64::MAX`.

### F006 — FSM runtime integration behind `ZEBVIX_FSM_ENABLED` flag

**Pure-FSM module (`zebvix-chain/src/fsm.rs`) is already shipped and
architect-passed.** This task wires it into the live producer loop.

- **F006.1 — Adapter scaffold.** New file
  `zebvix-chain/src/fsm_runtime.rs`. Owns:
  - `pub struct FsmRuntime { fsm: FsmState, last_proposal_at:
    Instant, ... }`
  - `pub fn enabled() -> bool` reading `ZEBVIX_FSM_ENABLED` env
    (default false).
  - `pub async fn run(state: Arc<State>, pool: Arc<VotePool>,
    mempool: Arc<Mempool>, broadcast: Sender<NetMsg>, my_addr:
    Address) -> !` — the new producer loop body, only called when
    `enabled()`.
  - **Acceptance:** module compiles; `enabled()` returns false in
    `cargo test` env.

- **F006.2 — Vote-pool → `FsmEvent` translator.** In
  `fsm_runtime.rs`:
  - On every `Tick` (every 500ms): for current `(height, round)`
    inspect `pool.tally_prevotes_for(height, round)` and
    `pool.tally_precommits_for(height, round)`; emit
    `FsmEvent::PrevoteQuorum { height, round, target }` /
    `PrecommitQuorum` once a 2f+1 threshold crosses (with dedup —
    do not re-emit the same quorum).
  - Watch incoming proposals via a new `state.subscribe_proposals()`
    channel; emit `FsmEvent::ProposalSeen { height, round,
    block_hash }`.
  - Watch `pool.max_round_seen(height)`; if it exceeds `fsm.round +
    1` and a `f+1` threshold is crossed at that round, emit
    `HigherRoundSeen { height, round }`.
  - **Acceptance:** unit test wires a mock pool, fires a proposal +
    quorum, asserts FSM advances to Commit.

- **F006.3 — `FsmAction` → I/O sink.**
  - `BroadcastPrevote { target }` → wraps in `Vote { ... }`, signs,
    inserts into local pool (which triggers gossip) — same path the
    legacy `vote_emit_task` uses today. Re-use, don't duplicate.
  - `BroadcastPrecommit { target }` → same.
  - `CommitBlock { height, hash }` → calls `state.apply_block(...)`
    with the proposal stored in a side-buffer keyed by hash. On
    success: feed `FsmEvent::BlockApplied { height, hash }` back
    into the FSM. On error: structured `error!` log + retry counter;
    after K=10 retries → fail-stop (panic with operator-readable
    message).
  - `BuildAndProposeBlock { height, round }` (NEW action variant —
    add to `fsm.rs` if missing) → builds via existing
    `Producer::build_block(...)` helper (refactored out of
    `Producer::run`), broadcasts proposal, also emits local
    `FsmEvent::ProposalSeen`.
  - **Acceptance:** with a single validator and `enabled()=true`,
    one full Tick cycle commits one block and the next height
    starts.

- **F006.4 — Startup recovery.** In `FsmRuntime::run` startup:
  - Load `current_tip = state.tip()`. Construct
    `FsmState::new(current_tip + 1, default_timeouts(), now)`.
  - Inspect `state.get_bft_commit(&tip_hash)` for the tip:
    - Present + valid → no recovery needed.
    - Absent BUT a quorum exists in pool → re-emit
      `PrecommitQuorum` synthetically so the FSM re-issues
      `CommitBlock` then `BlockApplied` fires.
  - **Acceptance:** kill `-9` the process during a `Step::Commit`,
    restart, watch a single `[fsm-recover]` log line and chain
    resumes from same height.

- **F006.5 — Observability.** Add metrics-style structured INFO logs:
  - `[fsm] tick height=N round=R step=S elapsed_ms=E` (every 5
    seconds, not every tick — too noisy).
  - `[fsm] dropped wrong-height event height=X self=Y kind=...`
  - `[fsm] dropped wrong-hash BlockApplied ack hash=... expected=...`
  - `[fsm] stuck-in-Commit duration_ms=X` (warn after 30s, error
    after 5min).
  - `[fsm] round_bump height=N old_round=A new_round=B reason=...`
  - **Acceptance:** journalctl grep finds each log type after a
    deliberate stress test.

- **F006.6 — N=1 cadence preservation.** In the `BuildAndProposeBlock`
  action handler (F006.3): rate-limit so consecutive proposals are
  ≥ `BLOCK_TIME_SECS` (5s) apart; if FSM asks for an earlier
  proposal, defer the action until the cadence window opens
  (without losing the action). This keeps block timestamps stable
  for downstream tooling on N=1.
  - **Acceptance:** with N=1 + `ENABLED=true` over 100 blocks,
    `(timestamp[i+1] - timestamp[i])` distribution centres on 5.0s
    ± 0.5s (same as legacy).

- **F006.7 — Test matrix + VPS deploy gate.**
  - Local: `cargo test --features fsm-tests` runs F006.2/3/4/6
    integration tests; all green.
  - VPS dev rehearsal: deploy with `ENABLED=false`, observe 1000
    blocks → byte-identical to legacy. Then flip
    `ENABLED=true`, observe 1000 blocks → byte-identical (N=1
    must produce identical blocks because 1/1 quorum is
    trivially met every round).
  - VPS mainnet: deploy with `ENABLED=false`. Wait 24h. Flip
    `ENABLED=true` only after a calm period.

### C2 — Keccak256 signing migration (sub-tasks above in §C2)

After F006 ships and stays green for ≥ 7 days on mainnet, execute
**C2.1 → C2.6** in order. Each sub-task has its own acceptance criterion
in the §C2 section above; treat each as a separate commit. The
activation env (`ZEBVIX_SIGN_HASH_ACTIVATION_HEIGHT`) defaults to
`u64::MAX`, so the binary can ship with all the code and stay legacy-
compatible until an operator-coordinated flip. Wallet flip happens
last (C2.5) — never before chain code is live.

**Cross-dependency between F006 and C2:** none at the code level. Both
modify different modules (`producer.rs` / new `fsm_runtime.rs` for F006;
`crypto.rs` / `state.rs::apply_block` / `mempool.rs` for C2). Deploy-
ordering above is the only coordination requirement.

---

## Process

These items are tracked here, in `replit.md`, and in the project tasks
list. Any future "production hardening" PR should reduce, not grow, this
list. When a deferral ships, move its row to the "shipped" table at the
top of this file with the activation height + commit SHA.
