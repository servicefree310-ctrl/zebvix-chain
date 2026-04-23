use serde::{Deserialize, Serialize};
use serde_big_array::BigArray;
use std::fmt;

pub const ADDRESS_LEN: usize = 20;
pub const HASH_LEN: usize = 32;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize)]
pub struct Address(#[serde(with = "hex_array_20")] pub [u8; ADDRESS_LEN]);

impl Address {
    pub const ZERO: Address = Address([0u8; ADDRESS_LEN]);

    pub fn from_hex(s: &str) -> anyhow::Result<Self> {
        let s = s.strip_prefix("0x").unwrap_or(s);
        let bytes = hex::decode(s)?;
        if bytes.len() != ADDRESS_LEN {
            anyhow::bail!("address must be {ADDRESS_LEN} bytes");
        }
        let mut a = [0u8; ADDRESS_LEN];
        a.copy_from_slice(&bytes);
        Ok(Address(a))
    }

    pub fn to_hex(&self) -> String {
        format!("0x{}", hex::encode(self.0))
    }
}

impl fmt::Debug for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_hex())
    }
}

impl fmt::Display for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_hex())
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Hash(#[serde(with = "hex_array_32")] pub [u8; HASH_LEN]);

impl Hash {
    pub const ZERO: Hash = Hash([0u8; HASH_LEN]);
    pub fn to_hex(&self) -> String {
        format!("0x{}", hex::encode(self.0))
    }
}

impl fmt::Debug for Hash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_hex())
    }
}

impl fmt::Display for Hash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_hex())
    }
}

/// Phase B.3.1 — transaction kind discriminator.
///
/// `Transfer` is the legacy/default behaviour: move `amount` from
/// `body.from` → `body.to` (or trigger pool intercept if `to == POOL`).
///
/// `ValidatorAdd` / `ValidatorRemove` are admin-only governance txs that
/// mutate the on-chain validator registry. They MUST be signed by the
/// current admin address; `body.amount` is refunded (only `body.fee` is
/// burned/paid). This makes the validator set part of replicated state, so
/// every node — including new joiners — converges on the same set by simply
/// applying blocks.
#[derive(Clone, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum TxKind {
    #[default]
    Transfer,
    ValidatorAdd { pubkey: [u8; 32], power: u64 },
    ValidatorRemove { address: Address },
    /// Phase B.3.2 — change an existing validator's voting power **without**
    /// remove+add (which would briefly drop total power below quorum and risk
    /// halting the chain mid-block). Governor-only.
    ValidatorEdit { address: Address, new_power: u64 },
    /// Phase B.3.2 — rotate the governor key. Must be signed by the *current*
    /// governor. Capped at `MAX_GOVERNOR_CHANGES` rotations (then locked).
    GovernorChange { new_governor: Address },
    /// Phase B.4 — Sui-style PoS staking dispatch. The inner [`StakeOp`]
    /// variant selects the action (CreateValidator / Stake / Unstake /
    /// Redelegate / ClaimRewards / EditValidator). Sender = `body.from`,
    /// `body.amount` is debited from sender for `Stake` / `CreateValidator`
    /// (and credited back for matured `Unstake` / `ClaimRewards` payouts at
    /// epoch end). All other ops use `body.amount = 0`.
    Staking(crate::staking::StakeOp),
    /// Phase B.7 — register a human-readable Pay-ID for the sender's address.
    /// Format: `<handle>@zbx`, handle is 3-25 chars `[a-z0-9_]`. `name` is a
    /// 1-50 char display label (mandatory). One Pay-ID per address; once set,
    /// it is **permanent** — cannot be edited or deleted.
    RegisterPayId { pay_id: String, name: String },
}

/// Transaction body (unsigned). Amount is in wei (1 ZBX = 10^18 wei).
///
/// **Wire format note (B.3.1):** `kind` was added at the end of this struct.
/// This is a chain-breaking change vs. pre-B.3.1 binaries — devnets must
/// re-init genesis. The default value is `Transfer` so all existing CLI
/// helpers and EVM-style flows keep working unchanged.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TxBody {
    pub from: Address,
    pub to: Address,
    pub amount: u128,
    pub nonce: u64,
    pub fee: u128,
    pub chain_id: u64,
    pub kind: TxKind,
}

/// Signed transaction (BLS-style, but using ed25519 for v0.1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedTx {
    pub body: TxBody,
    /// Compressed ed25519 public key of sender (32 bytes).
    pub pubkey: [u8; 32],
    /// Ed25519 signature (64 bytes).
    #[serde(with = "BigArray")]
    pub signature: [u8; 64],
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockHeader {
    pub height: u64,
    pub parent_hash: Hash,
    pub state_root: Hash,
    pub tx_root: Hash,
    pub timestamp_ms: u64,
    pub proposer: Address,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    pub header: BlockHeader,
    pub txs: Vec<SignedTx>,
    /// Proposer signature over header bytes.
    #[serde(with = "BigArray")]
    pub signature: [u8; 64],
}

// ─────────────────────────────────────────────────────────────
// Phase B.1 — Validator set on-chain (Tendermint BFT prep).
// A Validator is a network participant authorized to propose blocks
// and (in B.2+) cast Prevote/Precommit votes. Voting power is a positive
// integer; consensus requires > 2/3 of total voting power to commit.
// ─────────────────────────────────────────────────────────────
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Validator {
    pub address: Address,
    /// Ed25519 public key (32 bytes).
    pub pubkey: [u8; 32],
    /// Voting power. Must be > 0. Removed validators are deleted, not zeroed.
    pub voting_power: u64,
}

impl Validator {
    pub fn new(pubkey: [u8; 32], voting_power: u64) -> Self {
        let address = crate::crypto::address_from_pubkey(&pubkey);
        Self { address, pubkey, voting_power }
    }
}

// ---------- hex serde helpers ----------
mod hex_array_20 {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &[u8; 20], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format!("0x{}", hex::encode(v)))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 20], D::Error> {
        let s = String::deserialize(d)?;
        let s = s.strip_prefix("0x").unwrap_or(&s);
        let bytes = hex::decode(s).map_err(serde::de::Error::custom)?;
        if bytes.len() != 20 {
            return Err(serde::de::Error::custom("expected 20 bytes"));
        }
        let mut a = [0u8; 20];
        a.copy_from_slice(&bytes);
        Ok(a)
    }
}

mod hex_array_32 {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &[u8; 32], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format!("0x{}", hex::encode(v)))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 32], D::Error> {
        let s = String::deserialize(d)?;
        let s = s.strip_prefix("0x").unwrap_or(&s);
        let bytes = hex::decode(s).map_err(serde::de::Error::custom)?;
        if bytes.len() != 32 {
            return Err(serde::de::Error::custom("expected 32 bytes"));
        }
        let mut a = [0u8; 32];
        a.copy_from_slice(&bytes);
        Ok(a)
    }
}
