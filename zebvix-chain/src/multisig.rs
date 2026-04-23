//! Phase B.8 — M-of-N multisig wallets (full advanced).
//!
//! A multisig account is a chain-controlled address with **no private key**.
//! Funds held by it can only move when a proposal collects ≥ M approvals
//! from the N owners. The multisig address is deterministically derived from
//! `(sorted owners, threshold, salt, creator)` so the same inputs always
//! produce the same address (idempotent re-create blocked at the state level).
//!
//! Lifecycle:
//!   1. **Create**     — anyone (paying the fee) registers a multisig account.
//!                       Owners list is 2-10, threshold is 1..=N.
//!   2. **Propose**    — any owner submits an action (transfer for v1) +
//!                       expiry. Proposer is auto-counted as 1st approval.
//!   3. **Approve**    — other owners add their approval. Idempotent: a
//!                       second approval from the same owner is rejected.
//!   4. **Revoke**     — an owner can pull their approval before execution.
//!   5. **Execute**    — any owner can finalize once `approvals ≥ threshold`
//!                       and the proposal hasn't expired or been executed.
//!                       The multisig account is debited at execute time.
//!
//! Storage layout (CF_META prefix-keyed):
//!   - `ms/<addr20>`             → bincode(MultisigAccount)
//!   - `mspr/<addr20><id_be8>`   → bincode(MultisigProposal)
//!   - `mso/<owner20><addr20>`   → 1-byte marker (membership index for
//!                                 "list multisigs by owner")

use crate::types::Address;
use serde::{Deserialize, Serialize};

/// Hard caps to keep on-chain footprint and signature aggregation tractable.
pub const MIN_OWNERS: usize = 2;
pub const MAX_OWNERS: usize = 10;
pub const PROPOSAL_DEFAULT_EXPIRY_BLOCKS: u64 = 17_280; // ~24h @ 5s
pub const PROPOSAL_MAX_EXPIRY_BLOCKS: u64 = 1_000_000;  // ~58 days @ 5s

/// What a proposal will execute when threshold is reached.
/// v1 supports plain transfers; future variants can wrap any TxKind.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MultisigAction {
    Transfer { to: Address, amount: u128 },
}

impl MultisigAction {
    pub fn human(&self) -> String {
        match self {
            MultisigAction::Transfer { to, amount } => {
                format!("transfer {} wei → {}", amount, to)
            }
        }
    }
}

/// Operations dispatched through `TxKind::Multisig`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MultisigOp {
    Create  { owners: Vec<Address>, threshold: u8, salt: u64 },
    Propose { multisig: Address, action: MultisigAction, expiry_blocks: u64 },
    Approve { multisig: Address, proposal_id: u64 },
    Revoke  { multisig: Address, proposal_id: u64 },
    Execute { multisig: Address, proposal_id: u64 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MultisigAccount {
    pub address: Address,
    /// Sorted, de-duplicated owner addresses.
    pub owners: Vec<Address>,
    pub threshold: u8,
    pub created_height: u64,
    /// Monotonic; next proposal will get this id, then it bumps.
    pub proposal_seq: u64,
}

impl MultisigAccount {
    pub fn is_owner(&self, a: &Address) -> bool {
        self.owners.binary_search(a).is_ok()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MultisigProposal {
    pub multisig: Address,
    pub id: u64,
    pub action: MultisigAction,
    pub proposer: Address,
    /// Sorted, de-duplicated owner approvals.
    pub approvals: Vec<Address>,
    pub created_height: u64,
    pub expiry_height: u64,
    pub executed: bool,
}

impl MultisigProposal {
    pub fn has_approved(&self, a: &Address) -> bool {
        self.approvals.binary_search(a).is_ok()
    }
    pub fn add_approval(&mut self, a: Address) -> bool {
        match self.approvals.binary_search(&a) {
            Ok(_) => false,
            Err(pos) => { self.approvals.insert(pos, a); true }
        }
    }
    pub fn remove_approval(&mut self, a: &Address) -> bool {
        match self.approvals.binary_search(a) {
            Ok(pos) => { self.approvals.remove(pos); true }
            Err(_) => false,
        }
    }
}

/// Deterministic address derivation:
///   keccak256("ZBX_MULTISIG_v1" || sorted_owners || threshold || salt_LE || creator)
/// → take last 20 bytes (EVM-style).
pub fn derive_multisig_address(
    sorted_owners: &[Address],
    threshold: u8,
    salt: u64,
    creator: &Address,
) -> Address {
    use sha3::{Digest, Keccak256};
    let mut h = Keccak256::new();
    h.update(b"ZBX_MULTISIG_v1");
    for o in sorted_owners { h.update(o.0); }
    h.update([threshold]);
    h.update(salt.to_le_bytes());
    h.update(creator.0);
    let out = h.finalize();
    let mut a = [0u8; 20];
    a.copy_from_slice(&out[12..32]);
    Address(a)
}

/// Validate, sort+dedup, and return a clean owner set.
pub fn normalize_owners(raw: &[Address]) -> anyhow::Result<Vec<Address>> {
    use anyhow::anyhow;
    if raw.len() < MIN_OWNERS {
        return Err(anyhow!("multisig: need at least {} owners (got {})", MIN_OWNERS, raw.len()));
    }
    if raw.len() > MAX_OWNERS {
        return Err(anyhow!("multisig: max {} owners (got {})", MAX_OWNERS, raw.len()));
    }
    let mut v = raw.to_vec();
    v.sort_by_key(|a| a.0);
    v.dedup();
    if v.len() != raw.len() {
        return Err(anyhow!("multisig: duplicate owner addresses are not allowed"));
    }
    Ok(v)
}

pub fn validate_threshold(threshold: u8, n_owners: usize) -> anyhow::Result<()> {
    use anyhow::anyhow;
    if threshold == 0 {
        return Err(anyhow!("multisig: threshold must be ≥ 1"));
    }
    if (threshold as usize) > n_owners {
        return Err(anyhow!(
            "multisig: threshold {} cannot exceed owner count {}", threshold, n_owners
        ));
    }
    Ok(())
}
