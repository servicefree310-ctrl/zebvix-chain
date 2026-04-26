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

**Current state:** `consensus.rs` uses round-robin proposer selection over
the validator set with single-validator finality. There is no PBFT-style
prepare/commit voting; a single Byzantine proposer can equivocate (sign
two blocks at the same height) and the chain has no detection mechanism.

**Why deferred:** A real BFT round-machine (Tendermint / HotStuff / Aura)
is multi-week work — propose / pre-vote / pre-commit phases, view-change
on timeout, equivocation evidence + slashing, gossip-based vote
aggregation, deterministic timeouts. It also needs a testnet bake-in
period before any mainnet rollout.

**Migration plan:**
1. Implement `ConsensusFsm` enum: `{ Propose, PreVote, PreCommit, Commit }`.
2. Add `Vote { height, round, kind, hash, signer, signature }` over
   `vote.rs` (skeleton already present).
3. Replace `apply_block` direct path with a `commit_block` that fires
   only after ⅔+ pre-commits collected by the consensus task.
4. Add equivocation evidence (`Evidence { vote_a, vote_b }`) → slash via
   staking module's `jail` path.
5. Activate at `BFT_ACTIVATION_HEIGHT` (env-driven), same pattern as
   `STATE_ROOT_ACTIVATION_HEIGHT`.

**Risk if not done:** A single malicious proposer can fork the chain.
Currently mitigated by the small validator set being trusted operators.

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
