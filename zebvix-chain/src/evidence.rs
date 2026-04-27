//! Phase D — D2 Equivocation Evidence verifier (slashing primitive).
//!
//! Pure cryptographic / structural verifier with no I/O. Ships today
//! ahead of the staking integration (jail + burn) so the verification
//! contract can be tested in isolation. The jail/burn hook lands once
//! D1 multi-validator deploy is live — slashing a single-validator
//! chain is meaningless because there's nobody else to advance the chain.
//!
//! ## What is equivocation?
//! A validator equivocates when they sign two **different** votes at
//! the same `(height, round, vote_type)`. Honest validators MUST sign
//! at most one vote per slot. The in-memory `VotePool` already detects
//! this on the receiving side via `AddVoteResult::DoubleSign`; this
//! module turns that local detection into a transferable, externally-
//! verifiable proof that any third party can re-check from the wire
//! bytes alone.
//!
//! ## Slashing semantics (deferred — see HARDENING_TODO.md §D2)
//! When the jail/burn hook lands, a verified `EquivocationEvidence`
//! triggers:
//! 1. `staking::jail(offender, current_height + SLASH_JAIL_HEIGHTS)`
//!    where `SLASH_JAIL_HEIGHTS = 50_000` (~3 days at 5s/block).
//! 2. Burn `SLASH_PERCENT = 5%` of the offender's stake to the
//!    fee-burn account (NOT redistributed — avoids incentive games).
//!
//! ## Replay window
//! D2 spec: 24-hour evidence-submission window. That logic lives at
//! the apply_block call site (height-bounded), NOT here — this
//! module only validates the cryptographic claim itself.
//!
//! ## Self-equivocation prevention
//! The verifier requires `vote_a` and `vote_b` to be by the **same**
//! validator address (else there is no equivocation — that's two
//! different validators voting). It also rejects `vote_a == vote_b`
//! at the target level (duplicate votes are honest gossip, not
//! equivocation).

use crate::types::{Address, Validator};
use crate::vote::{verify_vote_sig, Vote};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

/// A pair of conflicting votes proving a validator equivocated.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EquivocationEvidence {
    pub vote_a: Vote,
    pub vote_b: Vote,
}

/// Top-level evidence enum. Exists today as a single variant so the
/// on-wire format is forward-compatible with future evidence types
/// (e.g. `LightClientAttack` per D3 state-sync, `BadBlockProposal`
/// for proposer-side misbehaviour).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Evidence {
    Equivocation(EquivocationEvidence),
}

impl EquivocationEvidence {
    /// The accused validator's address. Both votes are by this
    /// validator (verifier enforces).
    pub fn offender(&self) -> Address {
        self.vote_a.validator_address
    }

    /// The `(height, round)` slot where the offence occurred.
    pub fn slot(&self) -> (u64, u32) {
        (self.vote_a.data.height, self.vote_a.data.round)
    }
}

impl Evidence {
    pub fn offender(&self) -> Address {
        match self {
            Self::Equivocation(e) => e.offender(),
        }
    }

    pub fn slot(&self) -> (u64, u32) {
        match self {
            Self::Equivocation(e) => e.slot(),
        }
    }
}

/// Verify an equivocation claim. On success the caller is entitled
/// to jail the offender and burn their stake (deferred to D1+D2 wiring).
///
/// All checks are independent of any local node state — given the same
/// `(ev, chain_id, validators)`, every honest verifier returns the
/// same Ok/Err, which is the determinism contract for slashing.
///
/// Failure modes:
/// - **different_validators** — `vote_a` and `vote_b` not by same address
/// - **heights_differ** / **rounds_differ** / **types_differ** — slot mismatch
/// - **duplicate** — same target (this is honest gossip, NOT slashable)
/// - **wrong_chain_id** — vote not for this chain
/// - **bad_signature** — either vote's ECDSA signature fails to verify
/// - **not_in_validator_set** — offender not currently registered
/// - **zero_voting_power** — offender has been removed (zero power)
pub fn verify_equivocation(
    ev: &EquivocationEvidence,
    chain_id: u64,
    validators: &[Validator],
) -> Result<()> {
    // 1. Same validator on both votes (otherwise it's two different
    //    validators voting, not equivocation).
    if ev.vote_a.validator_address != ev.vote_b.validator_address {
        bail!(
            "equivocation: votes by different validators ({} vs {})",
            ev.vote_a.validator_address,
            ev.vote_b.validator_address
        );
    }

    // 2. Same (height, round, vote_type) slot.
    if ev.vote_a.data.height != ev.vote_b.data.height {
        bail!(
            "equivocation: vote heights differ ({} vs {})",
            ev.vote_a.data.height,
            ev.vote_b.data.height
        );
    }
    if ev.vote_a.data.round != ev.vote_b.data.round {
        bail!(
            "equivocation: vote rounds differ ({} vs {})",
            ev.vote_a.data.round,
            ev.vote_b.data.round
        );
    }
    if ev.vote_a.data.vote_type != ev.vote_b.data.vote_type {
        bail!(
            "equivocation: vote types differ ({:?} vs {:?})",
            ev.vote_a.data.vote_type,
            ev.vote_b.data.vote_type
        );
    }

    // 3. Different targets — this IS the equivocation.
    //    Same target = honest duplicate, harmless.
    if ev.vote_a.data.block_hash == ev.vote_b.data.block_hash {
        bail!("equivocation: votes target the same block (duplicate, not equivocation)");
    }

    // 4. Both votes carry our chain_id.
    if ev.vote_a.data.chain_id != chain_id {
        bail!(
            "equivocation: vote_a wrong chain_id ({}, expected {})",
            ev.vote_a.data.chain_id,
            chain_id
        );
    }
    if ev.vote_b.data.chain_id != chain_id {
        bail!(
            "equivocation: vote_b wrong chain_id ({}, expected {})",
            ev.vote_b.data.chain_id,
            chain_id
        );
    }

    // 5. Both signatures verify (the offender voluntarily produced both).
    if !verify_vote_sig(&ev.vote_a) {
        bail!("equivocation: vote_a signature invalid");
    }
    if !verify_vote_sig(&ev.vote_b) {
        bail!("equivocation: vote_b signature invalid");
    }

    // 6. Offender is in the active validator set with non-zero power.
    let offender_addr = ev.offender();
    let validator = validators
        .iter()
        .find(|v| v.address == offender_addr)
        .ok_or_else(|| anyhow::anyhow!("equivocation: offender {offender_addr} not in validator set"))?;
    if validator.voting_power == 0 {
        bail!("equivocation: offender {offender_addr} has zero voting power (already removed)");
    }

    Ok(())
}

/// Convenience verifier for any `Evidence` variant.
pub fn verify_evidence(
    ev: &Evidence,
    chain_id: u64,
    validators: &[Validator],
) -> Result<()> {
    match ev {
        Evidence::Equivocation(e) => verify_equivocation(e, chain_id, validators),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::generate_keypair;
    use crate::types::Hash;
    use crate::vote::{sign_vote, VoteData, VoteType};

    fn mk_validator(power: u64) -> ([u8; 32], [u8; 33], Validator) {
        let (sk, pk) = generate_keypair();
        let v = Validator::new(pk, power);
        (sk, pk, v)
    }

    fn precommit(
        sk: &[u8; 32],
        pk: [u8; 33],
        h: u64,
        r: u32,
        target: Option<Hash>,
        chain_id: u64,
    ) -> Vote {
        sign_vote(
            sk,
            pk,
            VoteData {
                chain_id,
                height: h,
                round: r,
                vote_type: VoteType::Precommit,
                block_hash: target,
            },
        )
        .unwrap()
    }

    #[test]
    fn happy_path_two_different_targets() {
        let (sk, pk, v) = mk_validator(10);
        let a = precommit(&sk, pk, 5, 0, Some(Hash([0xAA; 32])), 7878);
        let b = precommit(&sk, pk, 5, 0, Some(Hash([0xBB; 32])), 7878);
        let ev = EquivocationEvidence { vote_a: a, vote_b: b };
        verify_equivocation(&ev, 7878, &[v]).expect("valid equivocation");
        assert_eq!(ev.slot(), (5, 0));
    }

    #[test]
    fn nil_vs_block_is_equivocation() {
        // Voting nil and voting for a block at the same slot is also
        // equivocation. (vote_a = nil, vote_b = some block.)
        let (sk, pk, v) = mk_validator(10);
        let a = precommit(&sk, pk, 5, 0, None, 7878);
        let b = precommit(&sk, pk, 5, 0, Some(Hash([0xBB; 32])), 7878);
        let ev = EquivocationEvidence { vote_a: a, vote_b: b };
        verify_equivocation(&ev, 7878, &[v]).expect("nil-vs-block must be equivocation");
    }

    #[test]
    fn rejects_same_target_as_duplicate() {
        let (sk, pk, v) = mk_validator(10);
        let a = precommit(&sk, pk, 5, 0, Some(Hash([0xAA; 32])), 7878);
        let b = precommit(&sk, pk, 5, 0, Some(Hash([0xAA; 32])), 7878);
        let ev = EquivocationEvidence { vote_a: a, vote_b: b };
        let err = verify_equivocation(&ev, 7878, &[v]).unwrap_err();
        assert!(format!("{err}").contains("duplicate"), "got: {err}");
    }

    #[test]
    fn rejects_different_validators() {
        let (sk1, pk1, v1) = mk_validator(10);
        let (sk2, pk2, v2) = mk_validator(10);
        let a = precommit(&sk1, pk1, 5, 0, Some(Hash([0xAA; 32])), 7878);
        let b = precommit(&sk2, pk2, 5, 0, Some(Hash([0xBB; 32])), 7878);
        let ev = EquivocationEvidence { vote_a: a, vote_b: b };
        let err = verify_equivocation(&ev, 7878, &[v1, v2]).unwrap_err();
        assert!(format!("{err}").contains("different validators"), "got: {err}");
    }

    #[test]
    fn rejects_different_heights() {
        let (sk, pk, v) = mk_validator(10);
        let a = precommit(&sk, pk, 5, 0, Some(Hash([0xAA; 32])), 7878);
        let b = precommit(&sk, pk, 6, 0, Some(Hash([0xBB; 32])), 7878);
        let ev = EquivocationEvidence { vote_a: a, vote_b: b };
        let err = verify_equivocation(&ev, 7878, &[v]).unwrap_err();
        assert!(format!("{err}").contains("heights differ"), "got: {err}");
    }

    #[test]
    fn rejects_different_rounds() {
        let (sk, pk, v) = mk_validator(10);
        let a = precommit(&sk, pk, 5, 0, Some(Hash([0xAA; 32])), 7878);
        let b = precommit(&sk, pk, 5, 1, Some(Hash([0xBB; 32])), 7878);
        let ev = EquivocationEvidence { vote_a: a, vote_b: b };
        let err = verify_equivocation(&ev, 7878, &[v]).unwrap_err();
        assert!(format!("{err}").contains("rounds differ"), "got: {err}");
    }

    #[test]
    fn rejects_wrong_chain_id() {
        let (sk, pk, v) = mk_validator(10);
        let a = precommit(&sk, pk, 5, 0, Some(Hash([0xAA; 32])), 9999);
        let b = precommit(&sk, pk, 5, 0, Some(Hash([0xBB; 32])), 9999);
        let ev = EquivocationEvidence { vote_a: a, vote_b: b };
        let err = verify_equivocation(&ev, 7878, &[v]).unwrap_err();
        assert!(format!("{err}").contains("wrong chain_id"), "got: {err}");
    }

    #[test]
    fn rejects_bad_signature() {
        let (sk, pk, v) = mk_validator(10);
        let mut a = precommit(&sk, pk, 5, 0, Some(Hash([0xAA; 32])), 7878);
        let b = precommit(&sk, pk, 5, 0, Some(Hash([0xBB; 32])), 7878);
        a.signature[0] ^= 0xFF; // tamper
        let ev = EquivocationEvidence { vote_a: a, vote_b: b };
        let err = verify_equivocation(&ev, 7878, &[v]).unwrap_err();
        assert!(format!("{err}").contains("signature invalid"), "got: {err}");
    }

    #[test]
    fn rejects_offender_not_in_set() {
        let (sk, pk, _) = mk_validator(10);
        let (_, _, other) = mk_validator(10);
        let a = precommit(&sk, pk, 5, 0, Some(Hash([0xAA; 32])), 7878);
        let b = precommit(&sk, pk, 5, 0, Some(Hash([0xBB; 32])), 7878);
        let ev = EquivocationEvidence { vote_a: a, vote_b: b };
        let err = verify_equivocation(&ev, 7878, &[other]).unwrap_err();
        assert!(format!("{err}").contains("not in validator set"), "got: {err}");
    }

    #[test]
    fn rejects_zero_power_validator() {
        let (sk, pk) = generate_keypair();
        let zero = Validator::new(pk, 0);
        let a = precommit(&sk, pk, 5, 0, Some(Hash([0xAA; 32])), 7878);
        let b = precommit(&sk, pk, 5, 0, Some(Hash([0xBB; 32])), 7878);
        let ev = EquivocationEvidence { vote_a: a, vote_b: b };
        let err = verify_equivocation(&ev, 7878, &[zero]).unwrap_err();
        assert!(format!("{err}").contains("zero voting power"), "got: {err}");
    }

    #[test]
    fn evidence_enum_dispatch_works() {
        let (sk, pk, v) = mk_validator(10);
        let a = precommit(&sk, pk, 5, 0, Some(Hash([0xAA; 32])), 7878);
        let b = precommit(&sk, pk, 5, 0, Some(Hash([0xBB; 32])), 7878);
        let ev = Evidence::Equivocation(EquivocationEvidence { vote_a: a, vote_b: b });
        verify_evidence(&ev, 7878, &[v]).expect("enum dispatch must work");
        assert_eq!(ev.slot(), (5, 0));
    }

    #[test]
    fn evidence_serde_roundtrip() {
        let (sk, pk, _) = mk_validator(10);
        let a = precommit(&sk, pk, 5, 0, Some(Hash([0xAA; 32])), 7878);
        let b = precommit(&sk, pk, 5, 0, Some(Hash([0xBB; 32])), 7878);
        let ev = Evidence::Equivocation(EquivocationEvidence { vote_a: a, vote_b: b });
        let bytes = bincode::serialize(&ev).unwrap();
        let decoded: Evidence = bincode::deserialize(&bytes).unwrap();
        assert_eq!(ev, decoded);
    }
}
