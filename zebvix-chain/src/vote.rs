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
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_big_array::BigArray;
use std::collections::{BTreeMap, HashMap};

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
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Vote {
    pub data: VoteData,
    pub validator_address: Address,
    pub pubkey: [u8; 32],
    #[serde(with = "BigArray")]
    pub signature: [u8; 64],
}

/// Domain-separated canonical bytes for signing.
pub fn vote_signing_bytes(data: &VoteData) -> Vec<u8> {
    let mut out = VOTE_DOMAIN_TAG.to_vec();
    out.extend_from_slice(&bincode::serialize(data).expect("VoteData ser cannot fail"));
    out
}

pub fn sign_vote(secret: &[u8; 32], pubkey: [u8; 32], data: VoteData) -> Vote {
    let validator_address = address_from_pubkey(&pubkey);
    let signature = sign_bytes(secret, &vote_signing_bytes(&data));
    Vote { data, validator_address, pubkey, signature }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::generate_keypair;

    fn mk_validator(power: u64) -> ([u8; 32], [u8; 32], Validator) {
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
        let vote = sign_vote(&sk, pk, data);
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
        let mk = |sk: &[u8;32], pk: [u8;32]| sign_vote(sk, pk, VoteData {
            chain_id: 7878, height: 1, round: 0,
            vote_type: VoteType::Prevote, block_hash: target,
        });
        // 2/4 = no quorum
        let _ = pool.add(mk(&sk1, pk1), &set);
        assert!(!pool.has_quorum(1, 0, VoteType::Prevote, target, &set));
        let _ = pool.add(mk(&sk2, pk2), &set);
        assert!(!pool.has_quorum(1, 0, VoteType::Prevote, target, &set));
        // 3/4 = quorum (>2/3)
        let _ = pool.add(mk(&sk3, pk3), &set);
        assert!(pool.has_quorum(1, 0, VoteType::Prevote, target, &set));
    }

    #[test]
    fn double_sign_detected() {
        let (sk, pk, v) = mk_validator(1);
        let set = vec![v];
        let pool = VotePool::new(7878);
        let v1 = sign_vote(&sk, pk, VoteData {
            chain_id: 7878, height: 1, round: 0,
            vote_type: VoteType::Prevote, block_hash: Some(Hash([1u8; 32])),
        });
        let v2 = sign_vote(&sk, pk, VoteData {
            chain_id: 7878, height: 1, round: 0,
            vote_type: VoteType::Prevote, block_hash: Some(Hash([2u8; 32])),
        });
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
        });
        assert!(matches!(pool.add(vote.clone(), &set), AddVoteResult::Inserted { .. }));
        assert_eq!(pool.add(vote, &set), AddVoteResult::Duplicate);
    }
}
