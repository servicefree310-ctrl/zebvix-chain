//! Phase B.2 — Tendermint-style consensus vote messages.
//!
//! A `Vote` is a signed assertion by a validator about a specific block at a
//! given (height, round). Two vote types exist:
//!
//!   - **Prevote**   — first round of voting; validator declares which block
//!                     they would commit (or `None` for nil).
//!   - **Precommit** — second round; if a validator saw 2/3+ Prevotes for the
//!                     same block, they Precommit it. 2/3+ Precommits for the
//!                     same block = COMMIT (chain advances).
//!
//! Phase B.2 only introduces the **wire format + signing + pool + gossip**.
//! The producer still single-handedly commits via PoA. Phase B.3 wires votes
//! into the actual commit decision (replacing the producer's auto-apply).
//!
//! ## Anti-double-sign
//! The pool tracks **at most one Vote per (height, round, type, validator)**.
//! A second vote from the same validator in the same slot is rejected as
//! `DoubleSign` evidence (logged; in B.3 this triggers slashing).
//!
//! ## Signing domain
//! All votes are signed over the canonical bytes of `VoteData`, prefixed with
//! the domain tag `"zebvix-vote/v1\0"` to prevent cross-protocol replay.

use crate::crypto::{address_from_pubkey, sign_bytes, verify_signature};
use crate::types::{Address, Hash, Validator};
use anyhow::{anyhow, bail, Result};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_big_array::BigArray;
use std::collections::{BTreeMap, HashMap, HashSet};

pub const VOTE_DOMAIN_TAG: &[u8] = b"zebvix-vote/v1\0";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum VoteType {
    Prevote,
    Precommit,
}

impl VoteType {
    pub fn as_str(&self) -> &'static str {
        match self {
            VoteType::Prevote => "prevote",
            VoteType::Precommit => "precommit",
        }
    }
}

/// Canonical, signed payload. Order of fields is part of the protocol — do not
/// reorder without bumping `VOTE_DOMAIN_TAG`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoteData {
    pub chain_id: u64,
    pub height: u64,
    pub round: u32,
    pub vote_type: VoteType,
    /// `None` = nil vote (validator does not endorse any block this round).
    pub block_hash: Option<Hash>,
}

/// Signed vote message gossiped over P2P.
///
/// **Phase B.11** — `pubkey` is now a 33-byte compressed secp256k1 pubkey
/// (was 32-byte Ed25519 in B.10).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Vote {
    pub data: VoteData,
    pub validator_address: Address,
    #[serde(with = "crate::types::hex_array_33")]
    pub pubkey: [u8; 33],
    #[serde(with = "BigArray")]
    pub signature: [u8; 64],
}

/// Domain-separated canonical bytes for signing.
pub fn vote_signing_bytes(data: &VoteData) -> Vec<u8> {
    let mut out = VOTE_DOMAIN_TAG.to_vec();
    out.extend_from_slice(&bincode::serialize(data).expect("VoteData ser cannot fail"));
    out
}

/// Sign a vote with `secret`. Returns `Err` if the secret is not a valid
/// secp256k1 scalar (Phase H — no panics on bad keys; see `crypto.rs` doc
/// header). Callers (consensus loop, tests) must propagate.
pub fn sign_vote(
    secret: &[u8; 32],
    pubkey: [u8; 33],
    data: VoteData,
) -> anyhow::Result<Vote> {
    let validator_address = address_from_pubkey(&pubkey);
    let signature = sign_bytes(secret, &vote_signing_bytes(&data))?;
    Ok(Vote { data, validator_address, pubkey, signature })
}

/// Verify a vote's signature and that pubkey hashes to validator_address.
/// Does NOT check membership in the validator set — caller must do that.
pub fn verify_vote_sig(v: &Vote) -> bool {
    if address_from_pubkey(&v.pubkey) != v.validator_address {
        return false;
    }
    verify_signature(&v.pubkey, &vote_signing_bytes(&v.data), &v.signature)
}

#[derive(Debug, PartialEq, Eq)]
pub enum AddVoteResult {
    /// Vote was new and stored. Returns whether quorum was reached on this
    /// vote's `block_hash` for `(height, round, vote_type)` after insertion.
    Inserted { reached_quorum: bool },
    /// Same vote already present (idempotent gossip).
    Duplicate,
    /// Validator already cast a different vote for this slot — slashable.
    DoubleSign { previous: Box<Vote> },
    /// Vote signature is invalid.
    BadSignature,
    /// Validator is not in the active set (or has 0 power).
    UnknownValidator,
    /// Vote's chain_id doesn't match local chain.
    WrongChain,
}

/// Per-slot tally: votes grouped by validator address.
type SlotVotes = HashMap<Address, Vote>;
/// (height, round, vote_type) → SlotVotes
type Pool = BTreeMap<(u64, u32, VoteType), SlotVotes>;

/// In-memory thread-safe vote pool.
///
/// Memory growth: O(validators × rounds × heights tracked). Call
/// `gc_below(height)` periodically (recommended every commit) to prune.
pub struct VotePool {
    inner: RwLock<Pool>,
    chain_id: u64,
}

impl VotePool {
    pub fn new(chain_id: u64) -> Self {
        Self { inner: RwLock::new(Pool::new()), chain_id }
    }

    /// Add a vote. Verifies signature, validator membership, chain_id, and
    /// double-sign. Returns the outcome.
    pub fn add(
        &self,
        vote: Vote,
        validator_set: &[Validator],
    ) -> AddVoteResult {
        if vote.data.chain_id != self.chain_id {
            return AddVoteResult::WrongChain;
        }
        if !verify_vote_sig(&vote) {
            return AddVoteResult::BadSignature;
        }
        // Validator must be in the active set with power > 0.
        let val = validator_set.iter().find(|v| v.address == vote.validator_address);
        let Some(val) = val else { return AddVoteResult::UnknownValidator };
        if val.voting_power == 0 { return AddVoteResult::UnknownValidator; }

        let total_power: u64 = validator_set.iter().map(|v| v.voting_power).sum();
        let quorum = if total_power == 0 { 0 } else { (total_power * 2) / 3 + 1 };

        let key = (vote.data.height, vote.data.round, vote.data.vote_type);
        let mut pool = self.inner.write();
        let slot = pool.entry(key).or_default();
        if let Some(prev) = slot.get(&vote.validator_address) {
            if prev == &vote {
                return AddVoteResult::Duplicate;
            }
            // Same validator, same (height, round, type) — different content. SLASHABLE.
            let previous = Box::new(prev.clone());
            return AddVoteResult::DoubleSign { previous };
        }
        slot.insert(vote.validator_address, vote.clone());

        // Compute power on this vote's target.
        let target = vote.data.block_hash;
        let mut power_for_target: u64 = 0;
        for v in slot.values() {
            if v.data.block_hash == target {
                if let Some(val) = validator_set.iter().find(|x| x.address == v.validator_address) {
                    power_for_target = power_for_target.saturating_add(val.voting_power);
                }
            }
        }
        let reached_quorum = quorum > 0 && power_for_target >= quorum;
        AddVoteResult::Inserted { reached_quorum }
    }

    /// Total voting power that voted for `target_hash` at (height, round, type).
    pub fn power_for(
        &self,
        height: u64,
        round: u32,
        vote_type: VoteType,
        target_hash: Option<Hash>,
        validator_set: &[Validator],
    ) -> u64 {
        let pool = self.inner.read();
        let Some(slot) = pool.get(&(height, round, vote_type)) else { return 0 };
        let mut p: u64 = 0;
        for v in slot.values() {
            if v.data.block_hash == target_hash {
                if let Some(val) = validator_set.iter().find(|x| x.address == v.validator_address) {
                    p = p.saturating_add(val.voting_power);
                }
            }
        }
        p
    }

    /// Returns true iff > 2/3 of total power voted for `target_hash`.
    pub fn has_quorum(
        &self,
        height: u64,
        round: u32,
        vote_type: VoteType,
        target_hash: Option<Hash>,
        validator_set: &[Validator],
    ) -> bool {
        let total: u64 = validator_set.iter().map(|v| v.voting_power).sum();
        if total == 0 { return false; }
        let threshold = (total * 2) / 3 + 1;
        self.power_for(height, round, vote_type, target_hash, validator_set) >= threshold
    }

    /// Drop all entries strictly below `min_height`. Call this on commit to
    /// bound memory.
    pub fn gc_below(&self, min_height: u64) -> usize {
        let mut pool = self.inner.write();
        let to_drop: Vec<(u64, u32, VoteType)> = pool
            .keys()
            .filter(|(h, _, _)| *h < min_height)
            .cloned()
            .collect();
        let n = to_drop.len();
        for k in to_drop {
            pool.remove(&k);
        }
        n
    }

    /// Phase B.3.2.4 — collect deterministic, unique-per-validator Precommits
    /// at `height` whose `block_hash == Some(target_hash)`.
    ///
    /// **Determinism contract** (CRITICAL for byzantine safety): two honest
    /// nodes assembling the side-table commit blob for the same `(height,
    /// target_hash)` pair must produce byte-identical `Vec<Vote>` outputs,
    /// otherwise the same block ends up with different commit blobs at
    /// `bft/c/<block_hash>` across nodes. To meet this:
    ///
    ///   1. Outer iteration over `inner` is `BTreeMap<(height, round, type), …>`
    ///      → already sorted by `(h, r, vt)`. Higher rounds visited last.
    ///   2. When a validator has Precommits at multiple rounds for the same
    ///      `target_hash` (a legal honest pattern when consensus advances
    ///      rounds before commit), we KEEP the highest-round vote (`insert`
    ///      overwrites — last write wins). Tendermint convention: the most
    ///      recent precommit is the canonical one.
    ///   3. Final output is sorted by validator address (`[u8; 20]` lex order)
    ///      so the bincode encoding is identical regardless of validator
    ///      arrival order or HashMap rehash state.
    ///
    /// Within a single `(h, r, vt)` slot the vote pool already enforces
    /// at-most-one vote per validator (double-sign detection), so no inner
    /// non-determinism exists.
    pub fn collect_precommits_for(&self, height: u64, target_hash: Hash) -> Vec<Vote> {
        let pool = self.inner.read();
        let mut by_validator: HashMap<Address, Vote> = HashMap::new();
        // BTreeMap iteration is sorted by key tuple (h, r, vt). For each
        // validator, later rounds overwrite earlier ones → highest round wins.
        for ((h, _r, vt), slot) in pool.iter() {
            if *h != height || *vt != VoteType::Precommit { continue; }
            for v in slot.values() {
                if v.data.block_hash == Some(target_hash) {
                    by_validator.insert(v.validator_address, v.clone());
                }
            }
        }
        let mut out: Vec<Vote> = by_validator.into_values().collect();
        out.sort_by_key(|v| v.validator_address.0);
        out
    }

    /// **Phase B.3.2.7 — F006.2** Tally prevote power per target hash at
    /// `(height, round)`. Returns `HashMap<target, total_voting_power>`
    /// where `target = None` means a nil prevote (no block endorsed).
    ///
    /// Used by the FSM runtime adapter to detect:
    /// - 2/3+ prevotes for a specific target → step to Precommit
    /// - 2/3+ nil prevotes → bump round
    /// - f+1 prevotes split across >1 target → POL conflict (no quorum yet)
    ///
    /// Cheaper than calling `power_for(...)` per candidate because it walks
    /// the slot exactly once and indexes by target. Important when the FSM
    /// runtime polls every tick (twice per second).
    pub fn tally_prevotes_for(
        &self,
        height: u64,
        round: u32,
        validator_set: &[Validator],
    ) -> HashMap<Option<Hash>, u64> {
        self.tally_for(height, round, VoteType::Prevote, validator_set)
    }

    /// **Phase B.3.2.7 — F006.2** Tally precommit power per target hash at
    /// `(height, round)`. Same semantics as [`tally_prevotes_for`] but for
    /// precommits. Drives the Commit step transition.
    pub fn tally_precommits_for(
        &self,
        height: u64,
        round: u32,
        validator_set: &[Validator],
    ) -> HashMap<Option<Hash>, u64> {
        self.tally_for(height, round, VoteType::Precommit, validator_set)
    }

    /// Internal helper for the two `tally_*` APIs. Walks one `(h, r, vt)`
    /// slot exactly once, indexes votes by `block_hash`, and sums voting
    /// power per target. Saturating add prevents overflow on pathological
    /// validator sets.
    ///
    /// **Perf note (deferred — see HARDENING_TODO.md Tier-3):** the
    /// per-vote `validator_set.iter().find(...)` is O(N). Combined with
    /// the outer slot walk this is O(N²) per call, mirrored from the
    /// pre-existing `add()` / `power_for()` shape. For target N≤21
    /// validators (Zebvix's near-term decentralisation target per D1)
    /// this is ~441 ops per call — negligible. A future caching pass
    /// (`HashMap<Address, u64>` built once per FSM tick at the runtime
    /// adapter) reduces this to O(N) without touching the API surface.
    fn tally_for(
        &self,
        height: u64,
        round: u32,
        vote_type: VoteType,
        validator_set: &[Validator],
    ) -> HashMap<Option<Hash>, u64> {
        let pool = self.inner.read();
        let mut out: HashMap<Option<Hash>, u64> = HashMap::new();
        let Some(slot) = pool.get(&(height, round, vote_type)) else { return out };
        for v in slot.values() {
            if let Some(val) = validator_set.iter().find(|x| x.address == v.validator_address) {
                let entry = out.entry(v.data.block_hash).or_insert(0);
                *entry = entry.saturating_add(val.voting_power);
            }
        }
        out
    }

    /// **Phase B.3.2.7 — F006.2** Highest round seen for `height` in the
    /// pool across either vote type. The FSM runtime uses this for the
    /// catch-up heuristic: "if I see f+1 votes at round r > my_round, jump
    /// to round r" — see fsm.rs `Step::handle_round_catchup`.
    pub fn max_round_seen(&self, height: u64) -> Option<u32> {
        let pool = self.inner.read();
        pool.keys()
            .filter(|(h, _, _)| *h == height)
            .map(|(_, r, _)| *r)
            .max()
    }

    /// **Phase B.3.2.7 — F006.2** Total voting power that voted at any
    /// `(height, r > my_round, vote_type)`, regardless of target. Used by
    /// the FSM runtime to detect "f+1 votes at some r > my_round" — that
    /// is the BFT catch-up signal that bumps the local round past a
    /// network majority that has already moved on.
    ///
    /// Note: counts each unique validator at most once, even if they have
    /// votes at multiple rounds > my_round. This matches the f+1
    /// definition (validators, not vote-events).
    pub fn power_above_round(
        &self,
        height: u64,
        my_round: u32,
        vote_type: VoteType,
        validator_set: &[Validator],
    ) -> u64 {
        let pool = self.inner.read();
        let mut seen: HashSet<Address> = HashSet::new();
        for ((h, r, vt), slot) in pool.iter() {
            if *h != height || *r <= my_round || *vt != vote_type {
                continue;
            }
            for addr in slot.keys() {
                seen.insert(*addr);
            }
        }
        let mut p: u64 = 0;
        for addr in &seen {
            if let Some(val) = validator_set.iter().find(|x| x.address == *addr) {
                p = p.saturating_add(val.voting_power);
            }
        }
        p
    }

    /// Snapshot of all votes for a given height across all rounds and types.
    /// Used by RPC stats. Returns Vec<(round, type, votes)>.
    pub fn snapshot_height(&self, height: u64) -> Vec<(u32, VoteType, Vec<Vote>)> {
        let pool = self.inner.read();
        let mut out = Vec::new();
        for ((h, r, t), slot) in pool.iter() {
            if *h == height {
                let mut votes: Vec<Vote> = slot.values().cloned().collect();
                votes.sort_by_key(|v| v.validator_address.0);
                out.push((*r, *t, votes));
            }
        }
        out.sort_by_key(|(r, t, _)| (*r, format!("{}", t.as_str())));
        out
    }
}

/// **Phase B.3.2.4 — verify a stored LastCommit proves 2/3+ Precommits
/// for `parent_hash` at `parent_height`.**
///
/// This is the heart of the BFT commit gate. The commit blob is the raw
/// `bincode::serialize(&Vec<Vote>)` retrieved from the side table
/// (`State::get_bft_commit(parent_hash)`). On success, the blob proves
/// that the canonical validator set placed >2/3 voting power behind
/// `parent_hash` at `parent_height`.
///
/// Checks performed:
///
///   1. **Per-vote sanity** — every vote MUST have:
///        - matching `chain_id`
///        - `height == parent_height`
///        - `vote_type == Precommit`
///        - `block_hash == Some(parent_hash)` (no nil votes count
///          toward parent commitment)
///        - valid signature (via `verify_vote_sig`)
///   2. **Membership** — every voter MUST be in `validators` with
///      `voting_power > 0`.
///   3. **Dedup** — at most one vote per validator address is counted.
///   4. **Quorum** — sum of voting power across counted votes MUST be
///      `>= (total_power * 2) / 3 + 1`.
///
/// **Genesis-adjacent rule**: when `parent_height == 0` the parent IS
/// genesis and no commit can exist; `last_commit_bytes` MUST be empty.
///
/// **No header binding**: unlike a single-header design, this side-table
/// architecture does not authenticate the commit blob via the proposer
/// signature. The blob is trusted as cryptographic evidence on its own
/// merits (every signed precommit independently verifies). A future
/// versioned `HeaderV2` activated at a specific height will add explicit
/// proposer-signature binding to the commit hash.
///
/// **Validator set**: caller passes the CURRENT (post-parent) validator
/// set. For the typical case (validator set changes are rare and
/// admin-gated), this is equivalent to the parent-height set. A future
/// hardening (Phase B.4) will pin the parent-height set explicitly via
/// `validator_set_hash` in the parent header.
pub fn verify_last_commit_for_parent(
    parent_hash: Hash,
    parent_height: u64,
    last_commit_bytes: &[u8],
    chain_id: u64,
    validators: &[Validator],
) -> Result<()> {
    // ── Genesis-adjacent: no parent commit possible ──
    if parent_height == 0 {
        if !last_commit_bytes.is_empty() {
            bail!("LastCommit must be empty when parent is genesis (parent_height=0)");
        }
        return Ok(());
    }

    if last_commit_bytes.is_empty() {
        bail!("LastCommit empty for parent_height={parent_height} but commit required");
    }

    let votes: Vec<Vote> = bincode::deserialize(last_commit_bytes)
        .map_err(|e| anyhow!("LastCommit bincode decode failed for parent_height={parent_height}: {e}"))?;

    if votes.is_empty() {
        bail!("LastCommit decoded to zero votes for parent_height={parent_height}");
    }

    let mut seen: HashSet<Address> = HashSet::new();
    let mut counted_power: u64 = 0;

    for v in &votes {
        if v.data.chain_id != chain_id {
            bail!(
                "LastCommit vote: wrong chain_id {} (expected {chain_id}) from {}",
                v.data.chain_id,
                v.validator_address,
            );
        }
        if v.data.height != parent_height {
            bail!(
                "LastCommit vote: height {} != parent {parent_height} from {}",
                v.data.height,
                v.validator_address,
            );
        }
        if v.data.vote_type != VoteType::Precommit {
            bail!(
                "LastCommit vote: not a Precommit (got {}) from {}",
                v.data.vote_type.as_str(),
                v.validator_address,
            );
        }
        if v.data.block_hash != Some(parent_hash) {
            bail!(
                "LastCommit vote: target {:?} != parent {parent_hash} from {}",
                v.data.block_hash,
                v.validator_address,
            );
        }
        if !verify_vote_sig(v) {
            bail!(
                "LastCommit vote: bad signature from {}",
                v.validator_address,
            );
        }
        if !seen.insert(v.validator_address) {
            bail!(
                "LastCommit vote: duplicate from {}",
                v.validator_address,
            );
        }
        let validator = validators
            .iter()
            .find(|val| val.address == v.validator_address)
            .ok_or_else(|| {
                anyhow!(
                    "LastCommit vote from non-validator {}",
                    v.validator_address,
                )
            })?;
        if validator.voting_power == 0 {
            bail!(
                "LastCommit vote from zero-power validator {}",
                v.validator_address,
            );
        }
        counted_power = counted_power.saturating_add(validator.voting_power);
    }

    let total: u64 = validators.iter().map(|v| v.voting_power).sum();
    if total == 0 {
        bail!("LastCommit: validator set has zero total power");
    }
    let quorum = (total * 2) / 3 + 1;
    if counted_power < quorum {
        bail!(
            "LastCommit: insufficient power for parent_height={parent_height}: counted {counted_power} < quorum {quorum} (total {total})",
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::generate_keypair;

    fn mk_validator(power: u64) -> ([u8; 32], [u8; 33], Validator) {
        let (sk, pk) = generate_keypair();
        let v = Validator::new(pk, power);
        (sk, pk, v)
    }

    #[test]
    fn sign_verify_roundtrip() {
        let (sk, pk, _) = mk_validator(1);
        let data = VoteData {
            chain_id: 7878, height: 1, round: 0, vote_type: VoteType::Prevote,
            block_hash: Some(Hash::ZERO),
        };
        let vote = sign_vote(&sk, pk, data).unwrap();
        assert!(verify_vote_sig(&vote));
    }

    #[test]
    fn quorum_with_3_of_4() {
        let (sk1, pk1, v1) = mk_validator(1);
        let (sk2, pk2, v2) = mk_validator(1);
        let (sk3, pk3, v3) = mk_validator(1);
        let (_,   _,   v4) = mk_validator(1);
        let set = vec![v1, v2, v3, v4];
        let pool = VotePool::new(7878);
        let target = Some(Hash([7u8; 32]));
        let mk = |sk: &[u8;32], pk: [u8;33]| sign_vote(sk, pk, VoteData {
            chain_id: 7878, height: 1, round: 0,
            vote_type: VoteType::Prevote, block_hash: target,
        }).unwrap();
        // 2/4 = no quorum
        let _ = pool.add(mk(&sk1, pk1), &set);
        assert!(!pool.has_quorum(1, 0, VoteType::Prevote, target, &set));
        let _ = pool.add(mk(&sk2, pk2), &set);
        assert!(!pool.has_quorum(1, 0, VoteType::Prevote, target, &set));
        // 3/4 = quorum (>2/3)
        let _ = pool.add(mk(&sk3, pk3), &set);
        assert!(pool.has_quorum(1, 0, VoteType::Prevote, target, &set));
    }

    // ────────────────────────────────────────────────────────────────────
    // Phase B.3.2.4 — verify_last_commit_for_parent unit tests
    //
    // These exercise the BFT commit gate's verifier in isolation (no
    // RocksDB). They lock in: genesis-adjacent rule, hash binding, vote
    // sanity (chain_id / height / type / target / sig), dedup, membership,
    // and the 2/3+ quorum threshold.
    // ────────────────────────────────────────────────────────────────────

    /// Helper: bincode-encode a slice of Precommits as the side-table blob.
    fn encode_commit(precommits: &[Vote]) -> Vec<u8> {
        if precommits.is_empty() { Vec::new() } else { bincode::serialize(precommits).unwrap() }
    }

    fn precommit_for(
        sk: &[u8; 32],
        pk: [u8; 33],
        height: u64,
        target: Hash,
        chain_id: u64,
    ) -> Vote {
        sign_vote(sk, pk, VoteData {
            chain_id, height, round: 0,
            vote_type: VoteType::Precommit,
            block_hash: Some(target),
        }).unwrap()
    }

    #[test]
    fn verify_last_commit_genesis_must_be_empty() {
        let (_sk, _pk, v) = mk_validator(1);
        let bytes = encode_commit(&[]);
        verify_last_commit_for_parent(Hash::ZERO, 0, &bytes, 7878, &[v])
            .expect("parent_height=0 with empty LC must pass");
    }

    #[test]
    fn verify_last_commit_genesis_rejects_nonempty_payload() {
        let (sk1, pk1, v1) = mk_validator(1);
        let parent = Hash([0xAAu8; 32]);
        let bogus_pre = precommit_for(&sk1, pk1, 0, parent, 7878);
        let bytes = encode_commit(&[bogus_pre]);
        let err = verify_last_commit_for_parent(Hash::ZERO, 0, &bytes, 7878, &[v1]).unwrap_err();
        assert!(format!("{err}").contains("must be empty when parent is genesis"), "got: {err}");
    }

    #[test]
    fn verify_last_commit_quorum_3_of_4_passes() {
        let (sk1, pk1, v1) = mk_validator(1);
        let (sk2, pk2, v2) = mk_validator(1);
        let (sk3, pk3, v3) = mk_validator(1);
        let (_,   _,   v4) = mk_validator(1);
        let set = vec![v1.clone(), v2.clone(), v3.clone(), v4];
        let parent = Hash([0xC0u8; 32]);
        let pre1 = precommit_for(&sk1, pk1, 5, parent, 7878);
        let pre2 = precommit_for(&sk2, pk2, 5, parent, 7878);
        let pre3 = precommit_for(&sk3, pk3, 5, parent, 7878);
        let bytes = encode_commit(&[pre1, pre2, pre3]);
        verify_last_commit_for_parent(parent, 5, &bytes, 7878, &set)
            .expect("3/4 power must reach quorum");
    }

    #[test]
    fn verify_last_commit_quorum_2_of_4_rejected() {
        let (sk1, pk1, v1) = mk_validator(1);
        let (sk2, pk2, v2) = mk_validator(1);
        let (_,   _,   v3) = mk_validator(1);
        let (_,   _,   v4) = mk_validator(1);
        let set = vec![v1.clone(), v2.clone(), v3, v4];
        let parent = Hash([0xC1u8; 32]);
        let pre1 = precommit_for(&sk1, pk1, 5, parent, 7878);
        let pre2 = precommit_for(&sk2, pk2, 5, parent, 7878);
        let bytes = encode_commit(&[pre1, pre2]);
        let err = verify_last_commit_for_parent(parent, 5, &bytes, 7878, &set).unwrap_err();
        assert!(format!("{err}").contains("insufficient power"), "got: {err}");
    }

    #[test]
    fn verify_last_commit_rejects_wrong_target() {
        let (sk1, pk1, v1) = mk_validator(1);
        let parent = Hash([0xC3u8; 32]);
        let other = Hash([0xDEu8; 32]);
        let pre = precommit_for(&sk1, pk1, 5, other, 7878);
        let bytes = encode_commit(&[pre]);
        let err = verify_last_commit_for_parent(parent, 5, &bytes, 7878, &[v1]).unwrap_err();
        assert!(format!("{err}").contains("target"), "got: {err}");
    }

    #[test]
    fn verify_last_commit_rejects_wrong_height() {
        let (sk1, pk1, v1) = mk_validator(1);
        let parent = Hash([0xC4u8; 32]);
        let pre = precommit_for(&sk1, pk1, 4, parent, 7878);
        let bytes = encode_commit(&[pre]);
        let err = verify_last_commit_for_parent(parent, 5, &bytes, 7878, &[v1]).unwrap_err();
        assert!(format!("{err}").contains("height"), "got: {err}");
    }

    #[test]
    fn verify_last_commit_rejects_wrong_chain_id() {
        let (sk1, pk1, v1) = mk_validator(1);
        let parent = Hash([0xC5u8; 32]);
        let pre = precommit_for(&sk1, pk1, 5, parent, 9999);
        let bytes = encode_commit(&[pre]);
        let err = verify_last_commit_for_parent(parent, 5, &bytes, 7878, &[v1]).unwrap_err();
        assert!(format!("{err}").contains("chain_id"), "got: {err}");
    }

    #[test]
    fn verify_last_commit_rejects_prevote_in_lastcommit_slot() {
        let (sk1, pk1, v1) = mk_validator(1);
        let parent = Hash([0xC6u8; 32]);
        let prevote = sign_vote(&sk1, pk1, VoteData {
            chain_id: 7878, height: 5, round: 0,
            vote_type: VoteType::Prevote, block_hash: Some(parent),
        }).unwrap();
        let bytes = encode_commit(&[prevote]);
        let err = verify_last_commit_for_parent(parent, 5, &bytes, 7878, &[v1]).unwrap_err();
        assert!(format!("{err}").contains("not a Precommit"), "got: {err}");
    }

    #[test]
    fn verify_last_commit_rejects_duplicate_validator() {
        let (sk1, pk1, v1) = mk_validator(2);
        let (_,   _,   v2) = mk_validator(1);
        let set = vec![v1.clone(), v2];
        let parent = Hash([0xC7u8; 32]);
        let pre = precommit_for(&sk1, pk1, 5, parent, 7878);
        let bytes = encode_commit(&[pre.clone(), pre]);
        let err = verify_last_commit_for_parent(parent, 5, &bytes, 7878, &set).unwrap_err();
        assert!(format!("{err}").contains("duplicate"), "got: {err}");
    }

    #[test]
    fn verify_last_commit_rejects_non_validator() {
        let (_sk1, _pk1, v1) = mk_validator(2);
        let (sk_x, pk_x, _v_x) = mk_validator(0);
        let set = vec![v1.clone()];
        let parent = Hash([0xC8u8; 32]);
        let pre_attacker = precommit_for(&sk_x, pk_x, 5, parent, 7878);
        let bytes = encode_commit(&[pre_attacker]);
        let err = verify_last_commit_for_parent(parent, 5, &bytes, 7878, &set).unwrap_err();
        assert!(format!("{err}").contains("non-validator"), "got: {err}");
    }

    #[test]
    fn verify_last_commit_rejects_forged_signature() {
        let (sk1, pk1, v1) = mk_validator(1);
        let parent = Hash([0xC9u8; 32]);
        let mut pre = precommit_for(&sk1, pk1, 5, parent, 7878);
        pre.signature[0] ^= 0xFF;
        let bytes = encode_commit(&[pre]);
        let err = verify_last_commit_for_parent(parent, 5, &bytes, 7878, &[v1]).unwrap_err();
        assert!(format!("{err}").contains("bad signature"), "got: {err}");
    }

    #[test]
    fn verify_last_commit_rejects_empty_lastcommit_post_genesis() {
        let (_sk1, _pk1, v1) = mk_validator(1);
        let parent = Hash([0xCAu8; 32]);
        let err = verify_last_commit_for_parent(parent, 5, &[], 7878, &[v1]).unwrap_err();
        assert!(format!("{err}").contains("empty"), "got: {err}");
    }

    #[test]
    fn double_sign_detected() {
        let (sk, pk, v) = mk_validator(1);
        let set = vec![v];
        let pool = VotePool::new(7878);
        let v1 = sign_vote(&sk, pk, VoteData {
            chain_id: 7878, height: 1, round: 0,
            vote_type: VoteType::Prevote, block_hash: Some(Hash([1u8; 32])),
        }).unwrap();
        let v2 = sign_vote(&sk, pk, VoteData {
            chain_id: 7878, height: 1, round: 0,
            vote_type: VoteType::Prevote, block_hash: Some(Hash([2u8; 32])),
        }).unwrap();
        assert!(matches!(pool.add(v1, &set), AddVoteResult::Inserted { .. }));
        assert!(matches!(pool.add(v2, &set), AddVoteResult::DoubleSign { .. }));
    }

    #[test]
    fn duplicate_is_idempotent() {
        let (sk, pk, v) = mk_validator(1);
        let set = vec![v];
        let pool = VotePool::new(7878);
        let vote = sign_vote(&sk, pk, VoteData {
            chain_id: 7878, height: 1, round: 0,
            vote_type: VoteType::Precommit, block_hash: Some(Hash([3u8; 32])),
        }).unwrap();
        assert!(matches!(pool.add(vote.clone(), &set), AddVoteResult::Inserted { .. }));
        assert_eq!(pool.add(vote, &set), AddVoteResult::Duplicate);
    }

    // ────────────────────────────────────────────────────────────────────
    // F006.2 — VotePool tally APIs (tally_prevotes_for, tally_precommits_for,
    // max_round_seen, power_above_round). These are the read-only signals
    // the FSM runtime polls every tick to decide step transitions.
    // ────────────────────────────────────────────────────────────────────

    #[test]
    fn tally_prevotes_indexes_by_target() {
        let (sk1, pk1, v1) = mk_validator(10);
        let (sk2, pk2, v2) = mk_validator(7);
        let (sk3, pk3, v3) = mk_validator(3);
        let set = vec![v1, v2, v3];
        let pool = VotePool::new(7878);
        let target_a = Some(Hash([0xA; 32]));
        let target_b = Some(Hash([0xB; 32]));
        let mk = |sk: &[u8;32], pk: [u8;33], t: Option<Hash>| sign_vote(sk, pk, VoteData {
            chain_id: 7878, height: 1, round: 0,
            vote_type: VoteType::Prevote, block_hash: t,
        }).unwrap();
        // v1 (10) → A; v2 (7) → A; v3 (3) → B
        let _ = pool.add(mk(&sk1, pk1, target_a), &set);
        let _ = pool.add(mk(&sk2, pk2, target_a), &set);
        let _ = pool.add(mk(&sk3, pk3, target_b), &set);
        let tally = pool.tally_prevotes_for(1, 0, &set);
        assert_eq!(tally.get(&target_a).copied(), Some(17));
        assert_eq!(tally.get(&target_b).copied(), Some(3));
        assert_eq!(tally.get(&None).copied(), None);
    }

    #[test]
    fn tally_precommits_includes_nil() {
        let (sk1, pk1, v1) = mk_validator(5);
        let (sk2, pk2, v2) = mk_validator(5);
        let set = vec![v1, v2];
        let pool = VotePool::new(7878);
        let target = Some(Hash([0xC; 32]));
        let mk = |sk: &[u8;32], pk: [u8;33], t: Option<Hash>| sign_vote(sk, pk, VoteData {
            chain_id: 7878, height: 4, round: 2,
            vote_type: VoteType::Precommit, block_hash: t,
        }).unwrap();
        let _ = pool.add(mk(&sk1, pk1, target), &set);
        let _ = pool.add(mk(&sk2, pk2, None), &set);
        let tally = pool.tally_precommits_for(4, 2, &set);
        assert_eq!(tally.get(&target).copied(), Some(5));
        assert_eq!(tally.get(&None).copied(), Some(5));
    }

    #[test]
    fn tally_empty_slot_returns_empty_map() {
        let (_, _, v) = mk_validator(1);
        let set = vec![v];
        let pool = VotePool::new(7878);
        let tally = pool.tally_prevotes_for(99, 0, &set);
        assert!(tally.is_empty());
    }

    #[test]
    fn max_round_seen_returns_highest() {
        let (sk1, pk1, v1) = mk_validator(1);
        let set = vec![v1];
        let pool = VotePool::new(7878);
        let mk_round = |r: u32| sign_vote(&sk1, pk1, VoteData {
            chain_id: 7878, height: 7, round: r,
            vote_type: VoteType::Prevote, block_hash: Some(Hash([7u8; 32])),
        }).unwrap();
        assert_eq!(pool.max_round_seen(7), None);
        let _ = pool.add(mk_round(0), &set);
        assert_eq!(pool.max_round_seen(7), Some(0));
        let _ = pool.add(mk_round(3), &set);
        assert_eq!(pool.max_round_seen(7), Some(3));
        let _ = pool.add(mk_round(1), &set); // out-of-order should not regress max
        assert_eq!(pool.max_round_seen(7), Some(3));
        // Other height untouched.
        assert_eq!(pool.max_round_seen(8), None);
    }

    #[test]
    fn power_above_round_dedupes_validators() {
        // Same validator voting at multiple rounds > my_round must count
        // once (f+1 is over validators, not vote-events).
        let (sk1, pk1, v1) = mk_validator(10);
        let (sk2, pk2, v2) = mk_validator(5);
        let set = vec![v1, v2];
        let pool = VotePool::new(7878);
        let mk = |sk: &[u8;32], pk: [u8;33], r: u32| sign_vote(sk, pk, VoteData {
            chain_id: 7878, height: 2, round: r,
            vote_type: VoteType::Prevote, block_hash: Some(Hash([1u8; 32])),
        }).unwrap();
        // v1 at r=2, r=3, r=4; v2 at r=3 only. my_round = 1.
        let _ = pool.add(mk(&sk1, pk1, 2), &set);
        let _ = pool.add(mk(&sk1, pk1, 3), &set);
        let _ = pool.add(mk(&sk1, pk1, 4), &set);
        let _ = pool.add(mk(&sk2, pk2, 3), &set);
        // Both validators counted once each → 10 + 5 = 15.
        assert_eq!(pool.power_above_round(2, 1, VoteType::Prevote, &set), 15);
        // my_round = 3 → only r=4 (v1 only) qualifies → 10.
        assert_eq!(pool.power_above_round(2, 3, VoteType::Prevote, &set), 10);
        // my_round = 4 → no rounds strictly greater → 0.
        assert_eq!(pool.power_above_round(2, 4, VoteType::Prevote, &set), 0);
        // Wrong vote_type → 0.
        assert_eq!(pool.power_above_round(2, 1, VoteType::Precommit, &set), 0);
    }

    #[test]
    fn tally_excludes_unknown_validator() {
        // A vote in the pool from a validator no longer in the set
        // (e.g. removed mid-height) must NOT contribute power.
        let (sk1, pk1, v1) = mk_validator(100);
        let (_, _, v2) = mk_validator(50);
        let pool = VotePool::new(7878);
        let mk = sign_vote(&sk1, pk1, VoteData {
            chain_id: 7878, height: 1, round: 0,
            vote_type: VoteType::Prevote, block_hash: Some(Hash([1u8; 32])),
        }).unwrap();
        let set_with = vec![v1.clone(), v2.clone()];
        let _ = pool.add(mk, &set_with);
        // Tally with v1 absent: no power for that target.
        let set_without = vec![v2];
        let tally = pool.tally_prevotes_for(1, 0, &set_without);
        assert!(tally.is_empty(), "removed validator must not contribute: {tally:?}");
        // Tally with v1 present: full power.
        let tally_with = pool.tally_prevotes_for(1, 0, &set_with);
        assert_eq!(tally_with.get(&Some(Hash([1u8; 32]))).copied(), Some(100));
    }
}
