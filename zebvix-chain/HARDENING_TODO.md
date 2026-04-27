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

**Phase B.3.2.4 (April 2026, partial):** Wire skeleton + commit-gate
landed. Block headers now carry a proposer-signed `last_commit_hash`
binding the body's `last_commit` Vec<Vote> payload. New verifier
`vote::verify_last_commit_for_parent(block, chain_id, validators)`
enforces hash-binding, per-vote sanity (chain_id/height/type/target/sig),
dedup, validator-set membership, and a 2/3+ voting-power quorum, plus the
genesis-adjacent rule. The gate is wired into `apply_block` behind
`ZEBVIX_BFT_COMMIT_GATE_ACTIVATION_HEIGHT` (default `u64::MAX` = OFF).
Producer now takes an `Option<Arc<VotePool>>` and packs parent precommits
into every block. 12 dedicated unit tests in `vote.rs::tests` cover the
verifier surface. **The single-validator devnet behavior is unchanged
until an operator sets the env var.**

**Still single-validator-PoA in practice:** Despite the new commit gate,
the round machine itself is **not yet implemented** — `consensus.rs`
still self-applies via `Producer::run`. Phase 2 (next session) will
restructure that into a real propose / prevote / precommit / commit
cycle wired through P2P, with a separate `ProposedBlock` gossip variant
and quorum-driven commit decisions. Until then, multi-validator networks
WILL silently fork at concurrent proposals — the gate detects bad
LastCommit but has nothing to feed it from a peer.

**Why fully deferred:** A real BFT round-machine (Tendermint / HotStuff /
Aura) is multi-week work — propose / pre-vote / pre-commit phases,
view-change on timeout, equivocation evidence + slashing, gossip-based
vote aggregation, deterministic timeouts. It also needs a testnet
bake-in period before any mainnet rollout.

**Migration plan (remaining):**
1. ~~Add `Vote { height, round, kind, hash, signer, signature }` over
   `vote.rs`~~ — already present.
2. ~~Add LastCommit binding to BlockHeader + verifier~~ — Phase B.3.2.4
   done (April 2026).
3. Implement `ConsensusFsm` enum: `{ Propose, PreVote, PreCommit, Commit }`
   — Phase B.3.2.5 (next).
4. Replace `apply_block` direct path with a `commit_block` that fires
   only after ⅔+ pre-commits collected by the consensus task.
5. Add equivocation evidence (`Evidence { vote_a, vote_b }`) → slash via
   staking module's `jail` path.
6. Flip `ZEBVIX_BFT_COMMIT_GATE_ACTIVATION_HEIGHT` to a future height
   once Phase B.3.2.5 is deployed across all validators.

**Risk if not done:** A single malicious proposer can fork the chain.
Currently mitigated by the small validator set being trusted operators
AND single-validator-only deployment.

**Bincode migration note:** The BlockHeader/Block layout changed in
Phase B.3.2.4 (added `last_commit_hash` and `last_commit` fields).
Existing devnet RocksDB databases CANNOT be read by the new binary —
operators must wipe `~/.zebvix/data` (or equivalent home dir) before
restarting. Acceptable for testnet-only deployment as of April 2026.

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

**Migration plan:**
1. Add `SIGN_HASH_ACTIVATION_HEIGHT` env (default `u64::MAX` = disabled).
2. Implement `sign_tx_keccak` using `k256::ecdsa::SigningKey::sign_prehash`
   over `Keccak256(bincode(body))`.
3. `verify_tx` chooses path based on `block_height_at_inclusion >= activation`.
4. Coordinate testnet → mainnet activation via governance proposal.

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

## Process

These items are tracked here, in `replit.md`, and in the project tasks
list. Any future "production hardening" PR should reduce, not grow, this
list. When a deferral ships, move its row to the "shipped" table at the
top of this file with the activation height + commit SHA.
