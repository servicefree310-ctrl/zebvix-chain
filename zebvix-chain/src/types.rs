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

    /// Construct from a raw 20-byte array. Used by EVM address derivation
    /// (CREATE / CREATE2) and any callers that already validated length.
    #[inline]
    pub fn from_bytes(bytes: [u8; ADDRESS_LEN]) -> Self {
        Address(bytes)
    }

    /// Borrow the raw 20-byte representation.
    #[inline]
    pub fn as_bytes(&self) -> &[u8; ADDRESS_LEN] {
        &self.0
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

// Transaction types (`TxKind`, `TxBody`, `SignedTx`) live in their own module
// at `crate::transaction`. We re-export them here so all existing imports of
// `crate::types::{TxKind, TxBody, SignedTx}` keep compiling unchanged.
pub use crate::transaction::{SignedTx, TxBody, TxKind};

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
    /// Proposer signature over `header_signing_bytes(&header)`.
    #[serde(with = "BigArray")]
    pub signature: [u8; 64],
}

// ─────────────────────────────────────────────────────────────────────────
// Phase B.3.2.4 — BFT LastCommit lives in a SIDE TABLE, not in `Block`.
//
// Persisted at `CF_META` key `bft/c/<32-byte block_hash>` →
// `bincode::serialize(&Vec<Vote>)` of the 2/3+ Precommits that justified
// committing that block. Helper accessors live in `state.rs`
// (`put_bft_commit`, `get_bft_commit`).
//
// Why a side table instead of a `Block` field: keeping `Block` byte-stable
// avoids a forced DB wipe on every BFT-related schema bump. Block hash is
// computed from `header_signing_bytes(&header)` (which excludes the
// commit), so chain history continuity is preserved across upgrades.
// Proposer-signature binding to the commit hash is deferred to a future
// versioned `HeaderV2` activated at a specific height.
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Phase B.1 — Validator set on-chain (Tendermint BFT prep).
// A Validator is a network participant authorized to propose blocks
// and (in B.2+) cast Prevote/Precommit votes. Voting power is a positive
// integer; consensus requires > 2/3 of total voting power to commit.
// ─────────────────────────────────────────────────────────────
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Validator {
    pub address: Address,
    /// **Phase B.11** — secp256k1 compressed public key (33 bytes, SEC1 `0x02|0x03 || X`).
    /// Address = `keccak256(uncompressed[1..])[12..]` (ETH-standard).
    #[serde(with = "hex_array_33")]
    pub pubkey: [u8; 33],
    /// Voting power. Must be > 0. Removed validators are deleted, not zeroed.
    pub voting_power: u64,
}

impl Validator {
    pub fn new(pubkey: [u8; 33], voting_power: u64) -> Self {
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

/// **Phase B.11** — serde adapter for 33-byte compressed secp256k1 pubkeys.
pub mod hex_array_33 {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &[u8; 33], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format!("0x{}", hex::encode(v)))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 33], D::Error> {
        let s = String::deserialize(d)?;
        let s = s.strip_prefix("0x").unwrap_or(&s);
        let bytes = hex::decode(s).map_err(serde::de::Error::custom)?;
        if bytes.len() != 33 {
            return Err(serde::de::Error::custom("expected 33 bytes"));
        }
        let mut a = [0u8; 33];
        a.copy_from_slice(&bytes);
        Ok(a)
    }
}
