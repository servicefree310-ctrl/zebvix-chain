use serde::{Deserialize, Serialize};
use std::fmt;

pub const ADDRESS_LEN: usize = 20;
pub const HASH_LEN: usize = 32;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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

/// Transaction body (unsigned). Amount is in wei (1 ZBX = 10^18 wei).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TxBody {
    pub from: Address,
    pub to: Address,
    pub amount: u128,
    pub nonce: u64,
    pub fee: u128,
    pub chain_id: u64,
}

/// Signed transaction (BLS-style, but using ed25519 for v0.1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedTx {
    pub body: TxBody,
    /// Compressed ed25519 public key of sender (32 bytes).
    pub pubkey: [u8; 32],
    /// Ed25519 signature (64 bytes).
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
    pub signature: [u8; 64],
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
