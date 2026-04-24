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
