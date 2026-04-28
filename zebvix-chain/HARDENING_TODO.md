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

## Roadmap Tier Index

The remaining work is organised into three tiers by risk profile and
deployment coordination cost. Each tier has a **distinct activation
model**, so confusing them at deploy time has caused outages on other
chains — this index exists to keep the boundaries clear.

### Tier 1 — Consensus correctness (chain-breaking, height-gated)

Items that change consensus rules or transaction validity. Every Tier-1
item ships with an `ACTIVATION_HEIGHT` env (default `u64::MAX` = OFF) so
a binary can ship with the code present but the new rule dormant until a
coordinated operator flip. Wrong activation = chain fork. **Never flip
two Tier-1 gates on the same restart.**

| ID                      | Title                                          | Status               |
|-------------------------|------------------------------------------------|----------------------|
| **C1 / Phase B.3.2.x** | BFT consensus (round-robin → FSM-driven)       | Partial — see below |
| ↳ B.3.2.2-5             | Round-robin + timeouts + BFT commit blob       | ✅ live VPS         |
| ↳ B.3.2.6               | Pure-FSM module (`src/fsm.rs`, 20 tests)       | ✅ shipped dormant  |
| ↳ B.3.2.7-F006.1        | FSM runtime adapter scaffold                   | ✅ shipped dormant  |
| ↳ B.3.2.7-F006.2        | Vote-pool tally APIs (FSM event source primitives) | ✅ shipped dormant  |
| ↳ B.3.2.7-F006.3        | `FsmAction` → I/O sink (handle_action dispatch) | ✅ shipped dormant ¹ |
| ↳ B.3.2.7-F006.4        | Event sources + dispatch loop (vote-pool watcher, tick clock, proposal cache, recovery) | ✅ shipped dormant ⁴ |
| ↳ F006.5 → F006.7       | Observability, N=1 cadence, test matrix + VPS gate | ⏳ planned (§B.3.2.7) |
| **C2 / C2.1-C2.6**      | Keccak256 signing migration (EVM-native UX)    | ⏳ planned (§C2)     |
| **C3 / C3.1-C3.7**      | M-of-N bridge oracle multisig                  | ⏳ planned (§C3)     |

### Tier 2 — Production maturity (additive, no chain-break)

Items that add operational capability *around* the chain without
changing consensus rules. They can ship in any order, in parallel, by
different operators, without coordinating restarts. No height-gated
activation needed.

| ID                      | Title                                          | Status               |
|-------------------------|------------------------------------------------|----------------------|
| **D1**                  | Multi-validator decentralisation (N≥3)         | ⏳ planned (§Phase D) |
| **D2**                  | Slashing enforcement (equivocation evidence)   | 🟢 verifier + jail/burn apply path shipped ² |
| **D3**                  | State-sync (snapshot offer/accept)             | ⏳ planned (§Phase D) |
| **D4**                  | Monitoring stack (Prometheus + Grafana)        | 🟢 exporter + hookups + `/metrics` route shipped ³ |
| **D5**                  | Backup & DR (highest residual risk)            | ⏳ planned (§Phase D) |
| **D6**                  | Block explorer feature parity                  | ⏳ planned (§Phase D) |
| **D7**                  | EIP-1559 fee market (height-gated, but additive) | ⏳ planned (§Phase D) |
| **D8**                  | Operator runbook consolidation                 | ⏳ planned (§Phase D) |
| **D9**                  | RPC pagination + range caps (DoS hardening)    | ⏳ planned (§Phase D) |
| **D10**                 | CI gate (pre-tarball validation)               | 🟢 `scripts/ci-check.sh` + tarball-handler stale-check shipped |

¹ **F006.3 footnote.** `FsmRuntime::handle_action` dispatches every
`FsmAction` variant against the live `Producer`/`State`/`VotePool` —
`BuildProposal` calls `producer.build_block()` and emits `ProposalSeen`,
`CommitBlock` calls `state.apply_block()` and emits `BlockApplied`,
`BroadcastPrevote`/`BroadcastPrecommit` sign + push the vote to the
local pool (legacy gossip path), `EnteredRound`/`EnteredHeight` log
only. The previous panic in `FsmRuntime::run` is replaced with a
warn + sleep loop guard so flipping `ZEBVIX_FSM_ENABLED=true` without
F006.4-7 shipped does NOT crash the node — it just runs the legacy
producer alongside an inert FSM (safer than crash-on-startup). Three
new tests cover dispatch of each variant. `enabled()` still defaults
false; live VPS unaffected.

² **D2 footnote.** Apply path is `State::apply_evidence(ev,
current_height) → Result<u128>`: verify → 24h replay-window guard
(`EVIDENCE_REPLAY_WINDOW_HEIGHTS = 17_280` blocks at 5s) →
dedup-aware `staking::slash_for_evidence(offender, slot_h, slot_r)`
→ `zvb_evidence_verified_total` + `zvb_validator_jailed_total`
metric inc. Dedup uses a `BTreeSet<(Address, u64, u32)>` field on
`StakingModule` (`#[serde(default)]` so on-disk staking blob stays
backward-compatible). **What is NOT shipped this batch:** a
`TxKind::SubmitEvidence` mempool variant — that would change
consensus rules and requires height-gated activation, deferred to
the next session. For now the apply path is reachable from gossip
relayers and unit tests only; live VPS chain has nothing calling
it yet, so D2 is fully dormant in practice (zero production-side
risk).

⁴ **F006.4 footnote.** `FsmRuntime` gained four working components +
a real event loop, replacing F006.3's warn+sleep `run()` guard.
**(a) Vote-pool watcher** (`poll_vote_quorums`): walks
`tally_prevotes_for` / `tally_precommits_for` at the FSM's current
`(height, round)` and emits `PrevoteQuorum`/`PrecommitQuorum`
events for every target whose voting power crosses the 2/3+
threshold. Dedup via a `Mutex<HashSet<(height,round,VoteType,target)>>`
so a stable quorum doesn't re-fire on every poll; cleared on
`EnteredHeight` so the new height observes its own quorums fresh.
**(b) Tick clock** (`tick_once`): drives `FsmEvent::Tick(now)` at
the same 500ms cadence as the legacy producer (compile-time tied
to `consensus::PROPOSE_TIMEOUT_SECS` for round-bump parity).
**(c) Bounded proposal cache** (`cache_proposal`):
`Mutex<BTreeMap<u64, Block>>` capped at `PROPOSAL_CACHE_CAP = 64`
entries with smallest-height eviction; `handle_action(CommitBlock)`
sources the actual `Block` bytes for `state.apply_block` from this
cache. No production caller exists yet — a future p2p ingress
hook (F006.4.5 / bundled with F006.7) will populate it.
**(d) Recovery helper** (`recover_from_state`): derives the FSM
start height from `state.tip().0 + 1`, honoring the existing
`State::open` partial-write guard (`state.rs` lines 2767-2780).
`FsmRuntime::new` now calls this internally (cleaner API; the
old `start_height` arg is gone). **(e) Real event loop**:
tick-driven sequential loop (`tokio::time::interval` 500ms wake-up
→ tick clock → watcher poll → drain feedback events through
`step` until exhausted, capped at `MAX_EVENTS_PER_TICK = 64` as
a runaway-feedback guardrail) with a
`state.tip() >= height` safety guard in `handle_action(CommitBlock)`
that prevents double-apply over a height the legacy path already
finalised. Critically, `BuildProposal` / `BroadcastPrevote` /
`BroadcastPrecommit` remain log-only stubs (matches F006.3
behaviour) — this is **shadow-observer mode**: the FSM runtime
runs in parallel with `Producer::run` when enabled, but cannot
fork the chain because it produces no side effects beyond a
`CommitBlock` that's gated by tip. F006.7 will lift this
restriction (and simultaneously stop the legacy producer) once
F006.5 (cadence) + F006.6 (gating soak) prove the FSM
byte-identical. Five new tests (197 total chain tests):
`poll_vote_quorums_emits_prevote_quorum_under_n1`,
`tick_once_without_quorum_is_noop_on_height`,
`proposal_cache_caps_and_evicts_smallest_height`,
`recover_from_state_returns_tip_plus_one`,
`run_returns_immediately_when_disabled`. Plus three
`handle_action_*` updates for the new shadow-stub semantics.
`enabled()` still defaults `false` — live VPS unaffected.

³ **D4 footnote.** `/metrics` is mounted on the existing RPC port
instead of a separate `:9090` listener (see `rpc::router`'s
`/metrics` route comment for rationale): avoids a new CLI flag /
port-binding race with future operators, keeps the scrape contract
identical for Prometheus, and lets `nginx`-fronted operators
re-route `/metrics` traffic to a dedicated subdomain if they want
isolation. Hookups landed at: `state::apply_block` (height gauge,
applied counter, apply-time histogram numerator/denominator),
`mempool::add` + `mempool::take` (depth + bytes gauges),
`p2p::ConnectionEstablished`/`Closed` (peer-count gauge),
`main::try_persist_bft_commit_for` success site
(`zvb_bft_commit_persisted_total`), `consensus::Producer::run`
round-bump branch (`zvb_proposer_round_bumps_total`).

### Tier 3 — Performance & polish (deferred, no urgency)

Items that improve throughput / robustness but are not security-critical
and not blocking new functionality. They come after Tier 1 + Tier 2 are
materially shipped.

| ID                      | Title                                          | Status               |
|-------------------------|------------------------------------------------|----------------------|
| **H2 / H2.1-H2.6**      | Block-STM parallel transaction execution       | ⏳ planned (§H2)     |
| **H5 / H5.1-H5.5**      | Gossipsub peer scoring + slashing hooks        | ⏳ planned (§H5)     |

**Recommended global sequence:** Tier 1 (F006 → C2 → C3) **first**
because every Tier 2/3 item assumes a correct chain. Then Tier 2 in the
sequence given in the Phase D summary table. Tier 3 last.

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
freeze all bridge ops with one tx, but the bridge admin still has
unilateral mint authority for in-flight ops up to the moment of pause.

**Why deferred:** Real multi-sig oracles need:
- A federation registry (separate from validator set, with thresholds
  per asset / per network) stored in CF_META.
- A new `BridgeIn` carrying `Vec<(oracle_pubkey, sig)>` and a deterministic
  message hash that all signers sign.
- Off-chain oracle coordination (gossip layer or shared message queue)
  — out of scope for the chain crate itself, but the on-chain spec must
  be settled first so the off-chain implementation has a target.

**Migration plan (high-level):**
1. Add `BridgeFederation { asset_id, members: Vec<Address>, threshold: u8 }`.
2. New variant `BridgeOp::BridgeInMultisig { ..., signatures: Vec<(Address, [u8; 64])> }`.
3. Verify `signatures.len() ≥ federation.threshold` and each sig is by a
   member over `keccak256(asset_id || src_tx_hash || recipient || amount)`.
4. Keep single-admin `BridgeIn` available behind a feature flag for
   small / testnet deployments; deprecate post-activation.

**Concrete sub-tasks:**

- **C3.1 — `BridgeFederation` registry struct + RocksDB persistence.**
  In `state.rs`:
  ```rust
  pub struct BridgeFederation {
      pub asset_id: u32,           // 0 = native ZBX, 1+ = registered ERC-20-ish
      pub src_chain_id: u64,       // BSC = 56, ETH = 1, etc.
      pub members: Vec<Address>,   // sorted ascending for canonical hash
      pub threshold: u8,           // M in M-of-N
      pub nonce: u64,              // monotonic, bumped on every update
  }
  ```
  Store under `CF_META` with key
  `bridge/federation/{src_chain_id}/{asset_id}` (bincode-serialised).
  Add `pub fn get_bridge_federation(...)` / `pub fn
  put_bridge_federation(...)` API on `State`. **Acceptance:**
  RocksDB round-trip test; canonical-hash test (members reordered →
  same hash because we sort before hashing).

- **C3.2 — Admin RPC for federation lifecycle.** In `rpc.rs`:
  - `zvb_addBridgeFederation(src_chain_id, asset_id, members,
    threshold, admin_token)` — creates new federation if absent;
    rejects if members.len() < threshold or threshold == 0.
  - `zvb_updateBridgeFederation(...)` — replaces members + threshold;
    bumps nonce. Used for member rotation.
  - `zvb_removeBridgeFederation(src_chain_id, asset_id, admin_token)`
    — soft-delete (sets threshold = 255 = unreachable, preserves
    history for audit).
  - All three gated on `ADMIN_TOKEN` env (already in env per
    `<available_secrets>`). **Acceptance:** integration test
    creates → updates → removes a federation; wrong token returns
    HTTP 403.

- **C3.3 — `BridgeOp::BridgeInMultisig` variant + canonical message
  hash spec.** In `bridge.rs`:
  ```rust
  pub enum BridgeOp {
      BridgeIn { ... },                    // legacy, kept for migration
      BridgeInMultisig {
          src_chain_id: u64,
          asset_id: u32,
          src_tx_hash: [u8; 32],
          recipient: Address,
          amount: u128,
          federation_nonce: u64,           // must match current federation
          signatures: Vec<(Address, [u8; 64])>,
      },
      BridgeOut { ... },                   // unchanged
  }
  ```
  Canonical message digest:
  ```
  keccak256(b"ZVB_BRIDGE_IN_MULTISIG_V1" ||
            src_chain_id.to_be_bytes() ||
            asset_id.to_be_bytes() ||
            src_tx_hash ||
            recipient.0 ||
            amount.to_be_bytes() ||
            federation_nonce.to_be_bytes())
  ```
  The `V1` domain-separator string makes this deliberately
  incompatible with any other signature scheme — even if a
  member's key is reused for another product, signatures cannot
  cross-replay. **Acceptance:** golden-vector test pinning the
  exact bytes for a known input; cross-tx replay test rejects.

- **C3.4 — Verification path in `apply_block`.** In `state::
  apply_block` (or `bridge::apply_op`):
  ```
  let fed = state.get_bridge_federation(src_chain_id, asset_id)?;
  ensure!(op.federation_nonce == fed.nonce, "stale federation");
  let unique_signers: HashSet<Address> = op.signatures.iter()
      .map(|(addr, _)| *addr).collect();
  ensure!(unique_signers.len() == op.signatures.len(),
          "duplicate signer");
  ensure!(unique_signers.len() >= fed.threshold as usize,
          "insufficient signatures");
  let digest = canonical_digest(&op);
  for (addr, sig) in &op.signatures {
      ensure!(fed.members.contains(addr), "non-member signer");
      verify_signature_keccak(&digest, sig, addr)?;
  }
  ```
  Replay protection: track committed `src_tx_hash` per
  `(src_chain_id, asset_id)` in `CF_META` under key
  `bridge/seen/{src_chain_id}/{asset_id}/{src_tx_hash}` so the same
  source tx cannot be minted twice. **Acceptance:** under-threshold
  → reject; duplicate signer → reject; non-member signer → reject;
  stale nonce → reject; replay of committed tx → reject; happy path
  with exactly threshold sigs → accept.

- **C3.5 — Off-chain oracle coordination spec.** Document in
  `docs/BRIDGE_ORACLE.md` (out of crate scope, but spec ships with
  source so future implementers have a target):
  - Each oracle node watches BSC/ETH for `Deposited` events.
  - On confirmation depth ≥ 12, oracle computes the canonical
    digest (C3.3) and signs it.
  - Oracles gossip signatures via a shared NATS / Redis stream OR
    a libp2p sub-channel.
  - Once threshold sigs collected, any oracle can submit the
    `BridgeInMultisig` tx to the Zebvix RPC.
  - Recommended starter federations: native ZBX bridge from BSC
    (3-of-5), each major asset gets its own federation so a
    compromise of one asset's key set does not affect others.

- **C3.6 — Migration window: legacy `BridgeIn` deprecation.** Add
  env `ZEBVIX_BRIDGE_MULTISIG_ACTIVATION_HEIGHT` (default
  `u64::MAX`):
  - Below activation height: both `BridgeIn` (single-admin) and
    `BridgeInMultisig` accepted.
  - At/above activation height: `BridgeIn` rejected with
    `"legacy bridge path deprecated, use BridgeInMultisig"`.
  H6's global pause flag remains as an emergency kill-switch
  independent of activation height. **Acceptance:** integration test
  feeds a `BridgeIn` at `activation - 1` (accepts) and at
  `activation` (rejects).

- **C3.7 — Operator activation procedure.** Add to `docs/RUNBOOK.md`
  (see D8):
  1. Pre-flight: oracles online, members configured, threshold
     agreed (recommend 3-of-5 for BSC native, 2-of-3 for testnet).
  2. Day-T: chain operator runs `zvb_addBridgeFederation` for each
     `(src_chain_id, asset_id)` pair. Validators of federation
     verify the on-chain federation matches their known set.
  3. Day-T+1: oracles start producing `BridgeInMultisig` txs in
     parallel with the legacy admin path. Both work.
  4. Day-T+7 (after soak): operator computes
     `ACTIVATION = current_tip + 100`, sets
     `ZEBVIX_BRIDGE_MULTISIG_ACTIVATION_HEIGHT=NNNN` via
     `systemctl edit zebvix`, restarts.
  5. Post-activation monitoring: alert if any `BridgeIn` (legacy)
     attempt is rejected — indicates a stale oracle or wallet not
     yet upgraded.

**Risk if not done:** Oracle key compromise = full bridge mint authority.
**H6 pause flag is the kill-switch** until C3 ships, but pause is a
reactive (post-detection) defence — C3 is the proactive (pre-mint)
defence.

**Estimated effort:** 4 sessions (C3.1+C3.2 in 1 session; C3.3+C3.4 in
1 session because the verification logic needs careful test design;
C3.5 docs in 0.5 session; C3.6+C3.7 activation in 1.5 sessions).

**Dependencies:** none at code level. **Highest-priority Tier-1 item
after F006 ships** because bridge volume grows superlinearly with
chain adoption — single-admin risk grows with it.

---

## H2 — Block-STM parallel transaction execution

**Current state:** `block_stm.rs` is a doc-comment-only scaffold;
`state::apply_block` runs txs serially via a single `for tx in
block.txs` loop. Throughput is sender-serialised: independent txs from
different senders can't run in parallel, and the per-block latency
floor is `sum(tx_apply_time)`.

**Why deferred:** A real Block-STM needs deterministic MVCC
(multi-version concurrency control), per-tx read/write set tracking,
conflict detection, and re-execution — same model as Aptos. ~1k LoC
core + extensive correctness testing. Until Tier 1 + the most-impactful
Tier 2 items ship, the throughput ceiling has not been hit; serial
execution is fine at current TPS.

**Migration plan (high-level):** Implement Aptos-style `Scheduler {
task_queue, version_map }` in `block_stm.rs`. Wire into apply_block
behind `--enable-parallel-exec` CLI flag for safe rollout.

**Concrete sub-tasks:**

- **H2.1 — MVCC version map + per-tx read/write set struct.** In
  `block_stm.rs`:
  ```rust
  pub struct VersionedKey { key: Vec<u8>, tx_idx: usize }
  pub struct VersionMap {
      // key → (tx_idx, value) — readers see the latest write
      // strictly before their own tx_idx
      writes: BTreeMap<Vec<u8>, BTreeMap<usize, Vec<u8>>>,
  }
  pub struct TxReadSet { reads: Vec<(Vec<u8>, Option<usize>)> }
  pub struct TxWriteSet { writes: Vec<(Vec<u8>, Vec<u8>)> }
  ```
  `Option<usize>` in reads represents "what version did I see, or
  None for genesis-pre-block". This is the input to conflict
  detection in H2.3. **Acceptance:** unit test writes at idx=3,
  reads at idx=5 → returns the idx=3 value; reads at idx=2 →
  returns None (concurrent / before-write).

- **H2.2 — Scheduler with task queue.** Aptos-style state machine
  with `(tx_idx, incarnation)` tasks. States: `ReadyToExecute`,
  `Executing`, `Executed`, `Aborted`, `Validating`. The scheduler
  hands out tasks to a worker pool (rayon thread pool, sized to
  `num_cpus::get()`) and ensures: (a) a tx that aborts is retried
  with bumped incarnation, (b) validation runs in tx_idx order so
  conflicts are detected deterministically. **Acceptance:** unit
  test with 100 independent txs runs in parallel; with 100
  serially-dependent txs (each writes a counter the next reads)
  collapses to serial throughput.

- **H2.3 — Conflict detection + re-execution loop.** When tx_i
  finishes Execute, validate by re-reading every entry in its
  `TxReadSet` against the version map. If any read's seen version
  has changed (some tx_j with j < i wrote after our last read),
  abort + re-execute with a fresh incarnation. The re-execution
  cost is the price of optimistic concurrency. **Acceptance:**
  designed-conflict test (10 txs all writing the same account)
  runs to completion with 10 successful incarnations + N failed
  ones; final state matches serial execution byte-for-byte.

- **H2.4 — Wire into apply_block behind `--enable-parallel-exec`
  flag.** In `state::apply_block`:
  ```rust
  if cli_args.enable_parallel_exec {
      block_stm::execute_parallel(&block.txs, &mut self.versioned)?
  } else {
      // existing serial loop
  }
  ```
  Default OFF. The CLI flag, not an env var, because operators
  may want to A/B test on the same VPS by restarting with
  different flags. **Acceptance:** parallel and serial modes
  produce byte-identical state-root over a 10K-block replay (the
  determinism gate).

- **H2.5 — Determinism test suite.** Build a corpus of 10K
  recorded blocks from the live VPS chain (height 0 → 10000).
  Replay each block under both modes, assert state-root
  equivalence after every block. Any single-block divergence is
  a critical bug — never ship until this gate is green over the
  full corpus. **Acceptance:** all 10K blocks produce identical
  state-roots; CI rejects PRs that introduce a divergence.

- **H2.6 — Benchmark harness + go/no-go criteria.** Add
  `benches/parallel_apply.rs` using `criterion`:
  - Synthetic workload A: 100% independent txs (different senders,
    different recipients) — expect ~Nx speedup with N cores.
  - Synthetic workload B: 100% conflicting txs (all writing one
    counter) — expect parallel mode to be SLOWER (re-execution
    overhead). This is acceptable; documents the worst case.
  - Real workload C: 24h of recorded mainnet blocks replayed —
    measure actual speedup. **Go criterion:** workload C delivers
    ≥ 2.5x speedup on a 4-core VPS without changing state-root.
    **No-go:** any block produces divergent state, OR speedup
    is < 1.5x (not worth the complexity).

**Risk if not done:** Throughput ceiling at the sequential apply rate
(currently ~300 tx/s on a 4-core VPS at 5s blocks; floor on parallel
gain is ~3x = ~900 tx/s for typical workloads). Not a security issue —
chain stays correct, just bounded.

**Estimated effort:** 5 sessions (H2.1+H2.2 in 2 sessions because
the scheduler state machine is fiddly; H2.3 in 1 session; H2.4 in
0.5 session; H2.5 corpus build + replay infra in 1 session; H2.6
benchmark harness in 0.5 session). **Largest individual item in this
TODO.**

**Dependencies:** none, but most useful AFTER D7 (fee market) since
parallel execution incentivises fee-prioritised tx ordering.

---

## H5 — Gossipsub peer scoring + slashing hooks

**Current state:** `p2p.rs` uses `gossipsub::ValidationMode::Strict`
and hashes messages for dedupe, but has no `peer_score_params`
configured. Misbehaving peers (spammy txs, invalid blocks) are not
penalised at the transport layer — they only get rejected on a
per-message basis, with no cumulative cost to the misbehaver. A
sustained-attack peer can keep retrying.

**Why deferred:** libp2p's `PeerScoreParams` has 12+ tunable knobs
(`time_in_mesh_quantum`, `topic_score_cap`, `behaviour_penalty_*`,
`mesh_message_deliveries_*`, etc.) that need empirical baseline from
real-network traffic. Tuning before live data risks accidentally
banning honest peers — false positives can wreck network
connectivity faster than the peers we're trying to ban.

**Migration plan (high-level):**
1. Add `gossipsub::ConfigBuilder::peer_score_params(...)` with
   conservative thresholds (`gossip_threshold = -10.0`,
   `publish_threshold = -50.0`, `graylist_threshold = -80.0`).
2. Hook gossipsub `peer_score` events into staking-module `jail` for
   validators that drop below the graylist threshold.
3. Bake on testnet for ≥ 1 week, then ship.

**Concrete sub-tasks:**

- **H5.1 — Conservative `PeerScoreParams` baseline.** In `p2p.rs`:
  ```rust
  PeerScoreParams {
      topics: HashMap::from([
          (TopicHash::from_raw("zvb/blocks"),  TopicScoreParams { ... }),
          (TopicHash::from_raw("zvb/votes"),   TopicScoreParams { ... }),
          (TopicHash::from_raw("zvb/txs"),     TopicScoreParams { ... }),
      ]),
      topic_score_cap: 100.0,
      app_specific_weight: 0.0,           // we don't compute app scores yet
      ip_colocation_factor_weight: -5.0,
      ip_colocation_factor_threshold: 5.0, // tolerate VPS clusters
      behaviour_penalty_weight: -10.0,
      behaviour_penalty_threshold: 6.0,
      behaviour_penalty_decay: 0.999,
      decay_interval: Duration::from_secs(1),
      decay_to_zero: 0.01,
      retain_score: Duration::from_secs(60 * 60 * 6), // 6 hours
  }
  PeerScoreThresholds {
      gossip_threshold: -10.0,
      publish_threshold: -50.0,
      graylist_threshold: -80.0,
      accept_px_threshold: 100.0,
      opportunistic_graft_threshold: 5.0,
  }
  ```
  All numbers picked to match what Lighthouse / Prysm ship for
  Ethereum (closest neighbour with similar topology). **Acceptance:**
  module compiles + unit test asserts no panic on a synthetic
  100-peer mesh.

- **H5.2 — Peer-score event listener task.** In `p2p::run_swarm`,
  capture `SwarmEvent::Behaviour(Gossipsub(Event::PeerScore { ... }))`
  and forward to a new `tokio::sync::broadcast::Sender<PeerScoreEvent>`
  channel. Subscribers (H5.4 staking hook + monitoring exporter)
  consume independently. **Acceptance:** integration test triggers
  a synthetic score below `graylist_threshold`, asserts the event
  reaches a test subscriber within 100ms.

- **H5.3 — Cross-reference peer_id → validator address.** Add a
  `peer_validator_map: Arc<RwLock<HashMap<PeerId, Address>>>`
  populated by parsing the validator-handshake message exchanged on
  connection (a new message type `ZvbHello { peer_id, validator_addr,
  signature_over_peer_id }` proving the peer controls the address).
  Without this map, score events can't be tied back to economic
  identity. **Acceptance:** handshake replay-attack test (signing a
  different peer_id) is rejected; happy-path handshake populates the
  map.

- **H5.4 — Hook into `staking::jail` for validators below
  graylist.** New task in `main.rs` subscribed to the H5.2 channel:
  ```rust
  while let Ok(ev) = score_rx.recv().await {
      if ev.score < GRAYLIST_THRESHOLD {
          if let Some(addr) = peer_validator_map.read().get(&ev.peer_id) {
              staking::jail(*addr, current_height + JAIL_HEIGHTS_GOSSIP)
                  .await;
              tracing::warn!("⚠ p2p-jail validator={addr} \
                              score={} peer_id={}", ev.score, ev.peer_id);
          }
      }
  }
  ```
  Jail duration shorter than D2's slashing-jail (~6h vs ~3 days)
  because gossip misbehaviour is recoverable (might be a network
  hiccup) whereas equivocation is provable byzantine intent. No
  stake burn at this stage — jail-only. **Acceptance:** integration
  test forces a peer below threshold, asserts the corresponding
  validator's `jailed = true` in state.

- **H5.5 — Testnet bake-in procedure + tuning checklist.** Add to
  `docs/RUNBOOK.md` (D8):
  1. Deploy with peer scoring ENABLED on the dev VPS only.
  2. Watch for 7 days minimum. Track:
     - False-positive jails (honest validator briefly graylisted —
       should be ZERO; if non-zero, raise `graylist_threshold`).
     - True-positive jails (a deliberately-misbehaving test peer
       gets jailed within ≤ 30s — should be > 80% capture rate).
     - Score distribution histogram (export via D4 monitoring).
  3. After 7 clean days, deploy to mainnet with the same
     parameters. Continue monitoring score histogram.
  4. Tuning checklist: if peer-count drops > 20% post-deploy,
     revert immediately (tuning too aggressive). If misbehaving
     peers persist > 5 min, tighten `behaviour_penalty_threshold`
     by 1 unit and re-bake.

**Risk if not done:** A noisy peer can degrade gossip latency. Not
exploitable for funds, just liveness pressure. With D2 slashing, an
attacker who can flood the gossip layer gets economic feedback only
on equivocation, not on bandwidth abuse — H5 closes that gap.

**Estimated effort:** 2.5 sessions (H5.1 in 0.5 session; H5.2+H5.3
handshake + score channel in 1 session; H5.4 jail hook in 0.5
session; H5.5 bake-in procedure in 0.5 session). Smallest
non-trivial item in this TODO.

**Dependencies:** D2 (slashing primitives) for the jail hook to be
meaningful; D4 (monitoring) for the score histogram; D1
(multi-validator) so there are >1 peers worth scoring.

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

- **F006.1 — Adapter scaffold. ✅ SHIPPED (Phase B.3.2.7 commit 1).**
  New file `zebvix-chain/src/fsm_runtime.rs` (~165 lines including
  doc-block + tests) and `pub mod fsm_runtime;` registered in
  `lib.rs`. Owns:
  - `pub struct FsmRuntime { fsm: Mutex<FsmState>, producer:
    Arc<Producer>, last_proposal_at: Mutex<Instant> }` —
    `tokio::sync::Mutex` for cross-task safety, only held for the
    duration of a `step()` call. `producer` and `last_proposal_at`
    annotated `#[allow(dead_code)]` until F006.3/F006.6 wire them.
  - `pub fn enabled() -> bool` — reads `ZEBVIX_FSM_ENABLED`,
    accepts `1|true|yes|on` (case-insensitive), default + anything
    else = `false`. Bias toward legacy producer staying in charge.
  - `fn default_timeouts() -> Timeouts` (private) — `propose` is
    bound at compile time to `crate::consensus::PROPOSE_TIMEOUT_SECS`
    (= 8s on the live VPS), so a future operator flipping
    `ZEBVIX_FSM_ENABLED` cannot silently change the chain's
    round-bump cadence. **Architect-review fix:** the initial draft
    used a hard-coded `3s` which would have broken N=1 cadence
    parity; replaced with the const reference + a
    `parity_with_legacy_propose_timeout` test that fails loud on
    drift. `prevote=2s`, `precommit=2s`, `commit=1s` are conservative
    defaults with no legacy analogue — F006.6 will tune for N≥2.
  - `pub fn FsmRuntime::new(producer, start_height) -> Self` —
    initialises FSM at `(start_height, round=0, step=Propose)` with
    `Instant::now()`.
  - `pub async fn run(self: Arc<Self>) -> !` — **stub that
    `panic!`s** with a clear "F006.2-6 not yet wired" message. No
    caller in `main.rs` constructs an `FsmRuntime` or invokes
    `run`, and `enabled()` stays `false` by default. Fail-loud
    chosen over silent-return so a future operator who flips the
    env without the implementation shipped gets an immediate crash
    instead of a liveness hang.
  - **Acceptance verified:** `cargo check --features zvm` clean (only
    pre-existing dead-code warning); standalone rustc test of the
    `enabled()` logic — 3 tests pass (default-false, truthy
    `1/true/TRUE/Yes/on/ON` → true, falsy `""/0/false/no/off/garbage/2`
    → false). Run via standalone `rustc --test` because
    `cargo test --lib` triggers a `librocksdb-sys` rebuild that
    exceeds the dev-environment per-command CPU budget (same
    pattern used for `fsm.rs` tests in B.3.2.6).

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

- **F006.4 — Event sources + dispatch loop. ✅ SHIPPED (Phase B.3.2.7
  commit 4).** `FsmRuntime` gained `Arc<VotePool>` + `proposal_cache:
  Mutex<BTreeMap<u64, Block>>` (cap 64 with smallest-height eviction)
  + `last_emitted_quorum: Mutex<HashSet<(u64,u32,VoteType,Option<Hash>)>>`
  fields, plus four working components and a real event loop:
  - `pub async fn poll_vote_quorums(&self) -> Vec<FsmEvent>` — walks
    `tally_prevotes_for` / `tally_precommits_for` at the FSM's
    current `(height, round)` and emits one
    `PrevoteQuorum` / `PrecommitQuorum` event per target whose
    voting power crosses the 2/3+ threshold. Dedup via the
    `last_emitted_quorum` set so a stable quorum doesn't re-fire on
    every poll; the set is cleared on `EnteredHeight` so the new
    height observes its own quorums fresh. Lock discipline:
    acquires `fsm` (read-only snapshot), releases, then
    `last_emitted_quorum`, releases — never holds two mutexes
    simultaneously.
  - `pub async fn tick_once(&self, now: Instant) -> Result<Vec<FsmEvent>>`
    — feeds a single `FsmEvent::Tick(now)` into the FSM and dispatches
    every emitted action through `handle_action`. Returns downstream
    events for the caller to re-feed.
  - `pub async fn cache_proposal(&self, block: Block)` — bounded LRU
    insert into `proposal_cache`. Eviction policy: when len exceeds
    `PROPOSAL_CACHE_CAP = 64`, the smallest height is removed. No
    production caller exists yet — a future p2p ingress hook
    (F006.4.5 / bundled with F006.7) will populate it.
  - `pub fn recover_from_state(state: &State) -> u64` — returns
    `state.tip().0 + 1`. Honors the existing `State::open`
    partial-write recovery guard (`state.rs` lines 2767-2780):
    by the time this runs, `state.tip()` is guaranteed to be a
    fully-committed height. `FsmRuntime::new` calls this internally
    (cleaner API; the old `start_height` arg is gone).
  - `pub async fn run(self: Arc<Self>)` — replaces F006.3's warn+sleep
    with a tick-driven sequential loop (`tokio::time::interval` 500ms
    wake-up matching legacy `consensus::Producer::run`, then tick
    clock → watcher poll → drain feedback events through `step`
    until exhausted). Each `handle_action` return value (e.g.
    `BlockApplied` from a `CommitBlock` dispatch) is folded back
    into the pending-event queue inside the same tick so the FSM
    advances out of `Step::Commit` immediately — closed-loop
    "event → action → event" pipeline without a separate broker.
    Hard cap `MAX_EVENTS_PER_TICK = 64` as a defensive belt against
    feedback runaway. Not yet a `tokio::select!` because the only
    awaitable source today is the tick interval; F006.4.5 will add
    the p2p proposal-ingress channel as a real second arm. Disabled-
    fast path: returns immediately when `enabled()=false`, no
    warning, no busy-wait. Shadow-observer mode (default even when
    enabled): `BuildProposal` / `BroadcastPrevote` /
    `BroadcastPrecommit` remain log-only stubs; only `CommitBlock`
    reaches `state.apply_block`, gated by a `state.tip() < height`
    safety check that prevents double-apply if the legacy path
    already committed that height (which it always has in F006.4 —
    legacy producer is still in charge until F006.7).
  - **Why no legacy pre-emption in F006.4?** The F006 contract
    requires "byte-identical to legacy over 1000 blocks" with the
    flag OFF before F006.7 flips it ON. Pre-empting in F006.4
    without the cadence rate-limiter (F006.6) and the proposal
    gossip ingress wired (F006.4.5) would risk forking under a
    cold-start race. Shadow-observer mode lets us soak the FSM
    code paths in production (with `enabled()=true` set
    out-of-band by the operator on a test VPS) without touching
    the legacy consensus drive, so a regression discovered late
    is recoverable by simply unsetting the env var.
  - **Five new tests** (chain test count: 192 → 197):
    - `poll_vote_quorums_emits_prevote_quorum_under_n1` (T001)
    - `tick_once_without_quorum_is_noop_on_height` (T002)
    - `proposal_cache_caps_and_evicts_smallest_height` (T003)
    - `recover_from_state_returns_tip_plus_one` (T004)
    - `run_returns_immediately_when_disabled` (T005)
  - Plus three `handle_action_*` test updates for the new
    shadow-stub semantics (`BuildProposal` no-op,
    `CommitBlock` below-tip is idempotent, `CommitBlock`
    above-tip without cache errors with a clear message).
  - **Acceptance (this commit):** `cargo test --features zvm`
    on the build host runs all 197 tests green. Live VPS chain
    rebuild + binary swap shows `mode=ROUND_ROBIN+TIMEOUTS`
    in the journal (legacy producer still in charge), block
    height advances at 5s cadence, FSM dormant.

- **F006.4.5 — Proposal gossip ingress** (deferred, can bundle
  with F006.7). Wire `cache_proposal` to the p2p ingress so
  every received block proposal lands in the cache before the
  FSM emits a corresponding `CommitBlock`. Currently the cache
  is reachable only from tests + manual operator probes — fine
  for shadow-observer mode, blocking for F006.7 activation.

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

## Phase D — Operator Maturity Roadmap (Production-Readiness)

The B/C/H series above are **chain-correctness** items (consensus,
crypto, mempool, p2p safety). Even after every C/H item ships, the
chain remains operationally fragile — single VPS, no off-site backups,
no metrics dashboard, no slashing teeth, no state-sync. This section
catalogues what an "advanced production chain" needs *beyond
correctness*: decentralisation, observability, disaster recovery,
operator workflow polish.

These are deliberately **separated** from B/C/H because they are
mostly **additive** — no chain-breaking activation height needed, no
risk of bricking the live VPS chain. They can ship in any order, in
parallel, by different operators, without coordinating restarts.

The recommended sequencing (by impact-per-week-of-work) is:
**D2 → D5 → D4 → D1 → D6 → D7 → D9 → D10 → D3 → D8**, but each
section is self-contained.

---

## D1 — Multi-validator decentralisation (N ≥ 3)

**Current state:** Live VPS runs a single validator
(`0x40907000ac0a1a73e4cd89889b4d7ee8980c0315`). Genesis is hard-coded
to this address; `state::validators()` returns this single entry; the
"BFT" path technically computes 2/3-of-N quorums but with N=1 every
quorum trivially holds.

**Why deferred:** Real BFT safety + liveness requires the full FSM
runtime (F006.2-7) shipped first. Adding a second validator today
under the legacy producer would create a fork-prone race because the
legacy `Producer::run` has no real Tendermint vote handling — both
validators would mine round-0 blocks at the same height.

**Migration plan:**
1. Block on F006.7 (`ENABLED=true` byte-identical to legacy on N=1
   over 1000 blocks) being green on dev VPS.
2. Provision 2 additional VPS hosts (target geographic diversity:
   one EU, one APAC, one US-East). Same systemd unit + same
   `cargo build --release --features zvm` binary.
3. Generate 2 new validator keypairs offline (HSM or air-gapped
   laptop). Never paste private keys into chat / Replit / SSH
   history. Store in `pass`/`gpg`/Yubikey for each operator.
4. Add a new admin RPC endpoint `zvb_addValidator(address, stake,
   admin_token)` that writes to `state::validators` via the
   side-table (no Block schema change). Gate behind `ADMIN_TOKEN`
   already in env.
5. Activation procedure:
   - Validators 2 + 3 sync from genesis with `ZEBVIX_FSM_ENABLED=
     false` (they catch up via legacy producer driven by V1).
   - When all 3 are at the same tip, V1 calls `zvb_addValidator`
     for V2 and V3 (one at a time, 100 blocks apart).
   - All 3 nodes restart with `ZEBVIX_FSM_ENABLED=true` at a
     coordinated height (`current_tip + 200` ≈ 16 minutes).
   - Watch logs: every node should see prevote + precommit
     quorums from the other two within 5 seconds of each block.
6. Once N=3 is stable for ≥ 7 days, remove V1's "boot validator"
   privilege so any 2-of-3 can advance the chain alone.

**Risk if not done:** Any V1 outage (hardware, network, Hetzner
incident, key compromise) = entire chain stalls. No fault tolerance.

**Estimated effort:** 2 sessions (1 for `zvb_addValidator` RPC + side-
table writer, 1 for activation procedure + 7-day soak).

**Dependencies:** F006.7 SHIPPED.

---

## D2 — Slashing enforcement (equivocation evidence)

**Current state:** `staking.rs` has `Validator::jailed: bool` and
`jail_until: u64` fields, plus a `jail()` API. **Nothing actually
calls `jail()`.** A double-signing validator (signing two conflicting
prevotes / precommits at the same height + round) faces zero
economic cost. Stake is at risk only via voluntary unbonding.

**Why deferred:** Useless under N=1 (you cannot slash yourself
gainfully). Only meaningful once D1 ships and we have multiple
validators that could equivocate.

**Migration plan:**
1. Add a new module `src/evidence.rs`:
   - `pub struct EquivocationEvidence { height, round, validator,
     vote_a, vote_b }` — two signed votes by the same validator
     for different targets at the same `(height, round, kind)`.
   - `pub fn verify_evidence(ev, validators) -> Result<()>` — checks
     both signatures, asserts they are by the same address, asserts
     `vote_a.target != vote_b.target`, asserts same `(h, r, kind)`.
   - `pub struct Evidence` enum (Equivocation today; LightClientAttack
     placeholder for D3).
2. Extend `state::apply_block` (or side-table) to accept an
   `evidence: Vec<Evidence>` field passed from the FSM runtime
   (F006.3 will collect these from the vote pool — duplicate
   detection there).
3. On verified evidence:
   - Call `staking::jail(validator, jail_until = current_height +
     SLASH_JAIL_HEIGHTS)` (initial value 50_000 ≈ 3 days at 5s/block).
   - Burn `SLASH_PERCENT` (initial 5%) of the validator's stake
     directly into the fee-burn account — does NOT redistribute to
     other validators (avoids incentive games).
4. Add a CLI tool `zbx evidence submit <bincode-hex>` for off-chain
   evidence collectors to forward equivocation proofs to any
   validator's RPC.
5. Add a 24-hour evidence-submission window after the offending
   height — beyond that, evidence is rejected (prevents stale
   slashing weaponisation against a now-honest operator).

**Risk if not done:** A byzantine validator under D1 can fork the
chain at no cost. With a 1/3 minority byzantine + no slashing, an
attacker can grief the chain (round-bumps every block) without
losing stake.

**Estimated effort:** 2 sessions (evidence verification + jail/burn
plumbing).

**Dependencies:** D1 deployed (need ≥ 2 validators to slash).

---

## D3 — State-sync (snapshot offer/accept) for fast new-validator bootstrap

**Current state:** A new node joining the network must sync from
genesis (height 0). At today's tip ≈ 51 K this is ~minutes; at 10 M
blocks it would be days. Block-by-block sync via existing p2p
`SyncReq/SyncResp` works, just slowly.

**Why deferred:** Not blocking under low height. Becomes critical at
~1 M+ blocks or whenever a fresh validator needs to join.

**Migration plan:**
1. Add a new RocksDB checkpoint API call in `state.rs`:
   `pub fn snapshot_at(height: u64) -> Result<PathBuf>` — uses
   `rocksdb::checkpoint::Checkpoint::create_checkpoint` for a
   hard-link (zero-copy) snapshot. Run periodically (every 100 K
   blocks) into `/root/.zebvix/snapshots/<height>/`.
2. Add a new p2p message `SnapshotOffer { height, hash, manifest }`
   gossiped by validators that have a snapshot ready, and
   `SnapshotRequest { height }` / `SnapshotChunk { idx, total, bytes }`
   for chunked transfer (1 MB chunks).
3. Receiver validates each chunk's hash against the manifest, then
   atomically swaps `/root/.zebvix/state/` with the assembled
   snapshot, then resumes block-by-block sync from the snapshot
   height.
4. Cold-start operator UX: a new flag `--state-sync-trust <height>:
   <hash>` lets operators pin a known-good (height, hash) tuple from
   a trusted source (block explorer, social media announcement) so a
   malicious peer cannot serve a poisoned snapshot.

**Risk if not done:** Onboarding new validators becomes a
multi-day ordeal once the chain grows. Single biggest deterrent to
decentralisation past N=3.

**Estimated effort:** 3 sessions (snapshot API + chunked transfer +
trust-anchor UX).

**Dependencies:** none at code level; D1 makes it useful.

---

## D4 — Monitoring stack (Prometheus exporter + Grafana dashboard)

**Current state:** Operator visibility = `journalctl -u zebvix -f`.
No metrics, no alerting, no historical trend graphs. A slow memory
leak or growing mempool would be invisible until OOM-kill.

**Why deferred:** Manual journal grep was sufficient at N=1.

**Migration plan:**
1. Add `prometheus = "0.13"` + `lazy_static` to `Cargo.toml`. Create
   `src/metrics.rs` with `lazy_static!` registry exposing:
   - `zvb_block_height` (gauge)
   - `zvb_block_apply_seconds` (histogram, buckets 0.01 → 5.0)
   - `zvb_mempool_depth` (gauge)
   - `zvb_mempool_bytes` (gauge)
   - `zvb_peer_count` (gauge)
   - `zvb_vote_pool_size` (gauge, by `kind` label)
   - `zvb_bft_commit_persisted_total` (counter)
   - `zvb_proposer_round_bumps_total` (counter, by `reason` label)
   - `zvb_fsm_step_seconds` (histogram, by `step` label) — enabled
     once F006 is live
   - `zvb_validator_jailed_total` (counter) — once D2 lands
2. Add an HTTP scrape endpoint at `/metrics` on the existing RPC
   port (or a separate port if mTLS strictness needed).
3. Increment / observe these from the relevant call sites:
   `state::apply_block` for height + apply_seconds, `mempool::insert/
   evict` for depth + bytes, `p2p` swarm event handler for peer_count,
   `vote::insert` for vote_pool_size + commit_persisted, `consensus::
   run` for round_bumps.
4. Ship a Grafana dashboard JSON at `ops/grafana/zebvix-chain.json`
   with 12 panels (the metrics above + derived rates). Include in
   the source tarball.
5. Add Prometheus alerting rules at `ops/prometheus/zebvix-alerts.
   yml`:
   - `ZebvixBlockHeightStalled` — no height change in 60s.
   - `ZebvixMempoolGrowing` — mempool > 10 K txs sustained for 5 min.
   - `ZebvixPeerCountLow` — peer_count < 2 for 10 min.
   - `ZebvixApplyTimeHigh` — p99 apply_seconds > 1.0 over 10 min.
6. Document in `replit.md` how operators wire `node_exporter` +
   `prometheus` + `grafana` + `alertmanager` to Pushover / Telegram /
   PagerDuty for on-call alerts.

**Risk if not done:** Slow degradations (memory leak, peer-count
collapse, mempool DoS) go unnoticed until catastrophic failure.

**Estimated effort:** 1.5 sessions (metrics module + scrape endpoint +
dashboard JSON).

**Dependencies:** none.

---

## D5 — Backup & disaster-recovery strategy

**Current state:** `/root/.zebvix/` lives on a single VPS. No
off-site backup. Validator private key (`/root/.zebvix/validator.key`)
exists in exactly one place. Hetzner hardware failure or accidental
`rm -rf` = chain irrecoverable, validator address permanently locked.

**Why deferred:** Manual operator hygiene worked at N=1, but is the
single largest residual risk.

**Migration plan:**
1. **State backup:** add a systemd timer `zebvix-backup.timer` that
   runs every 6 hours:
   - Calls `zbx admin snapshot --out /var/backups/zebvix/<ts>.tar.zst`
     (uses RocksDB checkpoint from D3, then `tar | zstd -9`).
   - Pushes via `rclone` to one of {S3, B2, R2, Hetzner Storage Box}
     under a per-day prefix.
   - Retention: keep all snapshots ≤ 7 days, daily snapshots ≤ 30
     days, weekly snapshots ≤ 1 year. Pruned by a second timer.
2. **Validator key escrow:** split the validator key with Shamir's
   Secret Sharing (`ssss`) into a 2-of-3 share set. Distribute to
   3 trusted operators in geographically separate locations,
   stored on Yubikeys + paper backup in a tamper-evident envelope.
   Document the recovery procedure (gather any 2 of 3, run `ssss-
   combine`, write to `/root/.zebvix/validator.key`, `chmod 0400`,
   restart service).
3. **DR drill:** quarterly `restore-from-backup` exercise on a
   throwaway VPS — pull latest snapshot, verify chain catches up to
   live tip, verify a test transaction mines. Document the runbook
   in `docs/DR.md`.
4. **State-integrity self-check:** add `zbx admin verify-state` that
   walks the RocksDB and asserts every persisted block's hash
   matches the chain it claims to extend, every BFT commit blob
   verifies, every account balance >= 0. Run weekly via systemd
   timer; alert via Prometheus on failure.

**Risk if not done:** **Single largest operator risk today.** A
disk failure on `srv1266996` = total chain loss + permanent
validator-address lockout (the address is determined by the key;
losing the key means that address can never sign again).

**Estimated effort:** 1 session for backup timer + rclone wiring;
0.5 session for SSS key split (mostly procedure docs); 0.5 session
for self-check tool.

**Dependencies:** D3 snapshot API (or use raw `tar` of stopped-node
state dir as MVP).

---

## D6 — Block explorer feature parity (`sui-fork-dashboard`)

**Current state:** `artifacts/sui-fork-dashboard` is registered and
running. Audit has not been done since the B.3.2.5 BFT commit blob
shipped — explorer may not display per-block precommit signers,
validator-set changes, or evidence submissions (D2).

**Why deferred:** Cosmetic until a public user base exists.

**Migration plan:**
1. Add explorer endpoints (in `rpc.rs` or `zvm_rpc.rs`):
   - `zvb_getBftCommit(height) -> { precommits, total_voting_power,
     signed_voting_power }` — for the "BFT confirmation" badge.
   - `zvb_getValidators(height?) -> Vec<ValidatorView>` — current
     set, optionally historical.
   - `zvb_getEvidence(height?) -> Vec<Evidence>` — D2 dependency.
   - `zvb_getMempool(limit?) -> Vec<TxView>` — pending tx list.
2. Update `sui-fork-dashboard` UI:
   - Block detail page: show precommit signers + BFT commit badge.
   - Validators page: voting power, jailed flag, recent uptime %.
   - Evidence page: list of slashing events with links to offending
     blocks.
   - Mempool page: live-updating list with fee-priority sort
     visualisation.
3. Add WebSocket subscription `zvb_subscribe(channels: ["heads",
   "votes", "evidence", "mempool"])` for real-time updates instead
   of polling.

**Risk if not done:** No public-facing transparency. Investors /
users cannot independently verify chain health.

**Estimated effort:** 2 sessions (RPC + UI), parallelisable across
two operators.

**Dependencies:** D2 (for evidence), D1 (for meaningful validator
diversity).

---

## D7 — Fee market dynamics (EIP-1559 base-fee + priority-fee)

**Current state:** `transaction.rs` charges a flat
`gas_price * gas_used`, paid entirely to the proposer. No base-fee
burn, no priority-fee tipping, no congestion-aware pricing.

**Why deferred:** Adequate at low transaction volume. Becomes
problematic at scale because (a) proposers face perverse incentive to
include spam at floor price, (b) users have no reliable way to
prioritise during congestion.

**Migration plan:**
1. Add `base_fee: u64` field to a new `FeeMarket` side-table (no
   Block schema change — keep Block byte-stable, store base-fee per
   height in the side-table same as BFT commit blobs).
2. EIP-1559 update rule per block:
   ```
   if block.gas_used > target: base_fee *= (1 + (gas_used - target) /
                                             target / 8)
   if block.gas_used < target: base_fee *= (1 - (target - gas_used) /
                                             target / 8)
   ```
   With `target = block.gas_limit / 2` and a hard floor of 1 wei.
3. Transaction format: add `max_fee_per_gas` and
   `max_priority_fee_per_gas` fields. Existing `gas_price` field
   becomes legacy (height-gated activation via
   `ZEBVIX_FEE_MARKET_ACTIVATION_HEIGHT`).
4. Receipt computation: `effective_gas_price = min(max_fee_per_gas,
   base_fee + max_priority_fee_per_gas)`. Of that,
   `base_fee * gas_used` is **burned** (sent to a sink address) and
   `priority_fee * gas_used` goes to the proposer.
5. RPC: add `eth_feeHistory(blockCount, newestBlock, percentiles)`
   for wallet UX (MetaMask uses this for the fee slider).
6. Mempool: re-prioritise by `effective_gas_price` instead of
   `gas_price`. Existing fee-priority sort code in `mempool.rs`
   adapts trivially.

**Risk if not done:** During congestion, users cannot reliably get
txs included. Validators have no incentive to include only valuable
txs (since spam pays the same per gas as valuable tx).

**Estimated effort:** 2 sessions (fee market state + tx format
plumbing + RPC).

**Dependencies:** D1 (height-gated activation pattern is identical to
C2's, no extra infra needed).

---

## D8 — Operator run-book consolidation (`docs/RUNBOOK.md`)

**Current state:** Deploy steps live in chat-history scrollback.
Rollback steps live in `replit.md`'s session notes. Activation env
flag procedures (BFT commit gate, ZEBVIX_FSM_ENABLED,
ZEBVIX_SIGN_HASH_ACTIVATION_HEIGHT) are scattered across
`HARDENING_TODO.md` sections. A new operator joining the team would
have to read the entire chat history to figure out how to deploy.

**Why deferred:** Single-operator situation didn't need
consolidation.

**Migration plan:**
1. Create `docs/RUNBOOK.md` with these top-level sections:
   - **0. Architecture overview** (1 page: VPS, systemd unit,
     RocksDB layout, key files)
   - **1. Routine deploy** (the 5-step pull-build-restart
     procedure, with rollback at each step)
   - **2. Activation flags** (one sub-section per env flag with
     compute-activation-height + edit-systemd + restart + verify)
   - **3. Validator key rotation** (when, why, how — with the SSS
     procedure from D5)
   - **4. Evidence submission** (operator-facing, when D2 lands)
   - **5. Backup & restore** (D5 procedures)
   - **6. Multi-validator addition** (D1's `zvb_addValidator` flow)
   - **7. Snapshot pin update** (D3 trust-anchor refresh)
   - **8. Incident response** (chain-stalled, fork-detected,
     evidence-of-attack, key-compromise)
2. Cross-link from `replit.md` and `HARDENING_TODO.md`. Move all
   operational procedures OUT of those two files into the runbook.
3. Add `docs/RUNBOOK.md` to the source tarball so it ships to every
   VPS.

**Risk if not done:** Operator turnover = lost institutional
knowledge. Rollback under stress (3am incident) requires hunting
through chat history.

**Estimated effort:** 1 session (mostly extraction of existing
procedures, no new code).

**Dependencies:** none, but most useful AFTER D1/D2/D3/D5 land
(more procedures to document).

---

## D9 — RPC pagination + range caps (DoS hardening)

**Current state:** `eth_getLogs` accepts arbitrary block ranges.
A request with `fromBlock=0&toBlock=latest` over a chain with
significant log volume would attempt to load every event into
memory and serialise to a single response. OOM the node trivially.
Same hazard for `eth_getBlockByNumber` with `fullTransactions=true`
on huge blocks.

**Why deferred:** Legitimate users have not hit it; no public RPC
exposure yet.

**Migration plan:**
1. Hard cap: `eth_getLogs` rejects if `toBlock - fromBlock > 10_000`
   with error code `-32602` and message
   `"range too large (max 10000 blocks per request)"`.
2. Result-size cap: even within range, abort if
   `accumulated_logs.len() > 5_000` with a paginated response shape
   `{ logs, next_cursor }`. Wallet adapts via repeated calls with
   the cursor.
3. Per-IP rate limit: `governor` crate, 100 req/s per IP for read
   methods, 10 req/s for write methods. Configurable via env.
4. Request-body size cap: reject any request body > 1 MB.
5. Add `eth_chainId`-style introspection for the limits:
   `zvb_getRpcLimits() -> { max_log_range, max_logs_per_response,
   per_ip_read_rps, per_ip_write_rps }` so wallets can adapt.

**Risk if not done:** Once the chain has even modest public
adoption, a single malicious request can OOM the node. Repeated
attacks = chain stalls.

**Estimated effort:** 1 session.

**Dependencies:** none.

---

## D10 — CI gate (pre-tarball validation)

**Current state:** Tarball at `/api/download/newchain` streams
the live `zebvix-chain/src/` directory on every request, regardless
of whether the source even compiles. A broken commit on Replit
would propagate to VPS on the next operator-initiated pull.

**Why deferred:** Single-operator workflow has been "build locally
first, deploy second" — the implicit CI was the operator's brain.

**Migration plan:**
1. Add `scripts/ci-check.sh`:
   - `cargo check --features zvm` (timeout 120s).
   - `cargo clippy --features zvm -- -D warnings` (allow specific
     pre-existing warnings via `#[allow]` annotations, not via
     blanket flags).
   - Standalone-rustc tests for FSM modules (the established
     pattern from B.3.2.6 / B.3.2.7).
   - Smoke test: spawn the binary against an ephemeral RocksDB,
     submit a single tx via RPC, assert it mines, kill the binary.
2. Wire into the Replit api-server's tarball handler:
   - Before streaming, check the timestamp of `target/.last-ci-pass`.
   - If older than 24h OR newer than `target/.last-ci-pass`'s
     manifest hash of `src/`, refuse to stream and return HTTP 503
     with `{"error": "ci-stale", "last_pass": "<ts>"}`.
   - A separate cron / file-watcher (or manual `bash scripts/ci-
     check.sh && touch target/.last-ci-pass`) re-runs CI when
     `src/` changes.
3. Add a green-bypass for emergency rollback deploys:
   `?bypass_ci=true&token=<ADMIN_TOKEN>` accepts the request even
   without a fresh CI pass, but logs the bypass loudly.
4. Replit-side workflow file `.github/workflows/ci.yml` (or
   equivalent) that runs the same script on every push to a
   branch that auto-PRs into main.

**Risk if not done:** A typo or broken `cargo check` on Replit
silently propagates to VPS, where the operator only discovers it
during `cargo build --release` — losing 1m34s of build time per
mistake. Worse, a subtle behavioural regression that compiles
clean but mis-handles an edge case can ship to mainnet without
any test gate.

**Estimated effort:** 1.5 sessions (CI script + tarball-handler
wiring + bypass UX).

**Dependencies:** none, but most useful AFTER D8 (so the bypass
procedure is documented).

---

## Phase D summary table

| ID  | Title                                              | Effort | Deps        | Impact-per-week |
|-----|----------------------------------------------------|--------|-------------|------|
| D1  | Multi-validator decentralisation                   | 2 sessions | F006.7      | High (no SPOF) |
| D2  | Slashing enforcement                               | 2 sessions | D1          | High (deterrent) |
| D3  | State-sync (snapshot offer/accept)                 | 3 sessions | —           | Medium (long-term) |
| D4  | Monitoring stack (Prom + Grafana)                  | 1.5 sessions | —         | High (visibility) |
| D5  | Backup & DR                                        | 2 sessions | (D3 nice)   | **Highest** (single biggest residual risk) |
| D6  | Block explorer feature parity                      | 2 sessions | D1, D2      | Medium (transparency) |
| D7  | Fee market (EIP-1559)                              | 2 sessions | —           | Medium (scale) |
| D8  | Operator run-book consolidation                    | 1 session | (post-D1-5) | Medium (ops hygiene) |
| D9  | RPC pagination + range caps                        | 1 session | —           | High (DoS) |
| D10 | CI gate (pre-tarball validation)                   | 1.5 sessions | —         | High (ship safety) |

**Total: ~18 sessions** for full Phase D. Recommended sequence
**D2 → D5 → D4 → D9 → D10 → D1 → D6 → D7 → D3 → D8** prioritises
correctness/safety first, decentralisation second, polish last.

---

## Process

These items are tracked here, in `replit.md`, and in the project tasks
list. Any future "production hardening" PR should reduce, not grow, this
list. When a deferral ships, move its row to the "shipped" table at the
top of this file with the activation height + commit SHA.
