# Zebvix BFT Commit Phase — Implementation Roadmap

**Status:** Specification only. NOT YET IMPLEMENTED.
**Reason for separate document:** A full Tendermint-style BFT commit phase touches consensus safety, requires deterministic-simulation testing with malicious validator injection, and ships unsafe code if rushed. This document is the spec for the next dedicated effort, separate from the Phase B.3.3 hardening pass that delivered state-root commitment, slashing wiring, RPC hardening, and snapshot tooling.

---

## What's Already Done (Phase B.3.2.1 + B.3.2.2 + B.3.3)

- ✅ Round-robin proposer election (`consensus.rs::who_proposes`)
- ✅ Per-round propose timeout with round bumping (`consensus.rs::run`)
- ✅ Vote pool with double-sign detection (`vote.rs::VotePool`)
- ✅ Vote signing with domain tag `"zebvix-vote/v1\0"`
- ✅ Vote gossip over libp2p gossipsub topic `zebvix/<chain_id>/votes/v1`
- ✅ State Merkle root commitment (`state.rs::compute_state_root`) — gated by `ZEBVIX_STATE_ROOT_ACTIVATION_HEIGHT`
- ✅ Slashing wired (`state.rs::slash_double_sign` + `main.rs` DoubleSign branch) — gated by `ZEBVIX_SLASHING_ENABLED`
- ✅ Evidence ledger (`state.rs::record_evidence` / `list_evidence` + `zbx_listEvidence` RPC)
- ✅ RPC hardening (CORS allowlist via `ZEBVIX_RPC_CORS_ORIGINS`, 256 KiB body limit)
- ✅ RocksDB snapshot CLI (`zebvix-node snapshot --home … --out …`)
- ✅ Validator-key separation CLI (`zebvix-node validator-key --out …`)

---

## What's Missing (Phase B.3.2.3 + B.3.2.4)

The current chain finalizes a block as soon as the proposer publishes it. With N=1 validator this is fine; with N≥2 it is **unsafe** — two proposers can produce conflicting blocks at the same height with no aggregation step to pick one canonical chain.

Tendermint BFT solves this with two voting rounds (PreVote + PreCommit) and a 2/3+ commit gate. Zebvix already has `VoteType::Prevote` and `VoteType::Precommit` defined in `vote.rs`; the missing piece is the round-state machine that drives them and the LastCommit verification that proves a block was 2/3+-PreCommitted before extending the chain.

---

## Phase B.3.2.3 — 2/3+ Commit Gate

### Required changes

1. **New types in `consensus.rs`:**
   ```rust
   enum RoundStep { Propose, Prevote, PrevoteWait, Precommit, PrecommitWait, Commit }
   struct RoundState {
       height: u64,
       round: u32,
       step: RoundStep,
       proposed_block: Option<Block>,
       valid_block: Option<(Hash, Block)>,         // 2/3+ prevoted at some round
       locked_block: Option<(Hash, Block)>,        // 2/3+ precommitted at some round
       step_started_at: Instant,
   }
   ```

2. **New constants in `consensus.rs`:**
   ```rust
   pub const PREVOTE_TIMEOUT_SECS: u64 = 4;
   pub const PRECOMMIT_TIMEOUT_SECS: u64 = 4;
   pub const COMMIT_TIMEOUT_SECS: u64 = 2;
   ```

3. **Round-state-machine driver loop** in `Producer::run`:
   - On Propose: if I am proposer, build block, broadcast `Proposal { block }`. Else wait for proposal. On step deadline → bump round.
   - On Prevote: if proposed block is valid and I am not locked on a different block, broadcast `Prevote(block_hash)`. Else `Prevote(nil)`. Wait until 2/3+ prevotes received OR timeout.
   - On Precommit: if 2/3+ prevoted the same block, lock on it and broadcast `Precommit(block_hash)`. Else `Precommit(nil)` and unlock if needed.
   - On Commit: if 2/3+ precommitted the same block, apply it. Else bump round.

4. **Reuse existing `VotePool`** — it already aggregates by (height, round, type, validator) and returns `reached_quorum: bool`.

5. **Block validity check** before Prevote includes: header well-formed, parent matches our tip, all txs sign-verify, state-root matches (Phase B.3.3 already done).

### Locking rules (critical for safety)

- Once a validator has Precommitted block B at round R, it is **locked** on B.
- In subsequent rounds at the same height, the validator MUST Prevote for the locked block (not the new proposer's block) UNLESS it sees a *valid round* — 2/3+ Prevotes for a different block at some round ≥ R.
- This is what gives BFT its safety: as long as < 1/3 of voting power is byzantine, no two conflicting blocks can both gather 2/3+ Precommits at the same height.

### Test methodology

- **Deterministic simulation**: spin up N=4 in-process validators with shared mock clock + mock network. Inject scenarios:
  - Honest happy path → block commits in 1 round
  - Proposer offline → round bumps, alternate proposer
  - Network partition isolates 1 of 4 → other 3 still commit
  - 1 of 4 byzantine, sends conflicting prevotes → DoubleSign detected, slashing triggered, no fork
  - 2 of 4 byzantine (above 1/3) → liveness lost (expected) but no safety violation
- Assert no two distinct block hashes ever both achieve 2/3+ Precommits at the same height across all sims.

---

## Phase B.3.2.4 — LastCommit Verification

Once the commit gate exists, blocks must carry **proof** that the previous block was 2/3+-Precommitted. Without this, a node syncing from genesis cannot verify chain history without re-running the consensus protocol against archived votes.

### Required changes

1. **Extend `BlockHeader` in `types.rs`:**
   ```rust
   pub struct BlockHeader {
       pub height: u64,
       pub parent_hash: Hash,
       pub state_root: Hash,
       pub tx_root: Hash,
       pub last_commit_hash: Hash,    // ← NEW: keccak of LastCommit struct
       pub timestamp_ms: u64,
       pub proposer: Address,
   }
   ```

2. **New `LastCommit` struct in `consensus.rs`:**
   ```rust
   pub struct LastCommit {
       pub height: u64,                          // height being committed (= header.height - 1)
       pub round: u32,                           // commit round
       pub precommits: Vec<CommitSig>,           // exactly validator-set length, in canonical order
   }
   pub struct CommitSig {
       pub validator: Address,
       pub vote: Option<Vote>,                   // None = absent / nil-vote
   }
   ```

3. **In `Block`:** add `pub last_commit: LastCommit` field.

4. **In `state.rs::apply_block`:** verify `last_commit_hash == keccak(serialize(last_commit))`, then verify each precommit's signature, then verify the sum of voting power in the precommits ≥ 2/3 of total voting power.

5. **Activation:** gate behind `LAST_COMMIT_ACTIVATION_HEIGHT` env, same pattern as state-root activation.

### Migration

- This is a hard fork — old blocks have no `last_commit` field.
- Plan: at activation height, the genesis block's "last commit" is the empty-set hash. From height H_activation onward, every block carries a real LastCommit.

---

## Operational Prerequisites (NOT code)

Even with all of the above implemented, mainnet-grade BFT requires:

1. **N ≥ 4 validators** (BFT tolerates `f` byzantine where N = 3f+1; min 4 = 1 byzantine tolerance).
2. **Geographic distribution** of validator nodes (different ASes, different regions).
3. **Operator key separation** — Phase B.3.3 added `validator-key` CLI for this; operators must actually use it.
4. **Hardware security modules** for high-stake validator keys.
5. **External audit** — Trail of Bits / OtterSec scale, post-implementation, pre-mainnet.

---

## Estimated Effort

| Phase | Scope | Effort |
|---|---|---|
| B.3.2.3 — Commit gate | Round-state machine + locking rules + sim tests | 4–6 weeks experienced engineer |
| B.3.2.4 — LastCommit | Header field + verification + activation gate | 2–3 weeks |
| Audit fixes | Address audit findings | 4–8 weeks |
| **Total to mainnet-grade** | | **~3–4 months** |

This estimate assumes one full-time experienced Rust + blockchain engineer. Cutting corners on simulation testing is the single biggest risk to chain safety — do not skip it.
