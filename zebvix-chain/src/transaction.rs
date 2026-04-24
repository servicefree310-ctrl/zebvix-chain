//! Transaction types and helpers for Zebvix L1.
//!
//! This module is the single source of truth for everything wire-format
//! related to transactions: [`TxKind`], [`TxBody`], and [`SignedTx`].
//!
//! ## Wire format guarantee
//!
//! The bincode serialization of [`TxBody`] and [`SignedTx`] is **part of the
//! consensus rules**. Reordering fields, adding fields without bumping the
//! genesis, or changing variant order in [`TxKind`] is a chain-breaking change
//! and will cause forks. All historical field order is preserved exactly here.
//!
//! ## Helpers
//!
//! Inherent methods on [`SignedTx`] / [`TxBody`] / [`TxKind`] provide a clean
//! ergonomic API on top of the lower-level functions in [`crate::crypto`]:
//!
//! ```ignore
//! use zebvix_node::transaction::{TxBody, TxKind};
//! let body = TxBody::transfer(from, to, amount_wei, nonce, fee_wei, chain_id);
//! let tx = body.sign(&secret);
//! let h = tx.hash();
//! assert!(tx.verify());
//! assert_eq!(tx.sender_address(), tx.body.from);
//! ```

use crate::types::{Address, Hash};
use serde::{Deserialize, Serialize};
use serde_big_array::BigArray;

// ──────────────────────────────────────────────────────────────────────────
// TxKind — discriminator for all on-chain operations.
// ──────────────────────────────────────────────────────────────────────────

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
///
/// **Variant order is consensus-critical** — bincode encodes the tag as the
/// 0-based index of the variant. Do NOT reorder.
#[derive(Clone, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum TxKind {
    #[default]
    Transfer,
    ValidatorAdd {
        #[serde(with = "crate::types::hex_array_33")]
        pubkey: [u8; 33],
        power: u64,
    },
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
    /// Phase B.8 — M-of-N multisig wallets. The inner [`MultisigOp`] selects
    /// the action (Create / Propose / Approve / Revoke / Execute). Sender =
    /// `body.from`. `body.amount` is always refunded; only `body.fee` is paid.
    /// Multisig accounts hold their own balance separately and can be funded
    /// like any normal address.
    Multisig(crate::multisig::MultisigOp),
    /// Phase B.10 — explicit on-chain AMM swap with slippage protection.
    ///
    /// First-class buy/sell against the ZBX/zUSD pool. Unlike the legacy
    /// auto-router (sending ZBX to the pool address as a Transfer), this
    /// variant supports BOTH directions and includes a `min_out` slippage
    /// guard: if the pool would return less than `min_out`, the swap is
    /// reverted and the principal refunded (only the fee is consumed).
    ///
    /// `body.amount` carries the **input amount** (in ZBX wei or zUSD micro-units
    /// depending on `direction`). `body.to` should equal `body.from` (output is
    /// always credited back to the sender) and is enforced by `apply_tx`.
    /// `body.fee` is always paid in ZBX wei.
    Swap {
        direction: SwapDirection,
        min_out: u128,
    },
    /// Phase B.12 — cross-chain bridge dispatch.
    ///
    /// Carries one of [`crate::bridge::BridgeOp`] (network/asset registry
    /// management by admin, plus user `BridgeOut` and admin/oracle
    /// `BridgeIn`). See `bridge.rs` for the full trust model.
    ///
    /// `body.amount` is interpreted op-specifically:
    /// - `BridgeOut`: amount of the native asset to lock.
    /// - All others: ignored (refunded).
    /// `body.fee` is always paid in ZBX wei.
    Bridge(crate::bridge::BridgeOp),
}

/// Phase B.10 — direction of an AMM [`TxKind::Swap`].
///
/// Variant order is consensus-critical (bincode encodes as u32 LE tag).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SwapDirection {
    /// Sell ZBX, receive zUSD ("buy zUSD with ZBX").
    ZbxToZusd,
    /// Sell zUSD, receive ZBX ("buy ZBX with zUSD").
    ZusdToZbx,
}

impl SwapDirection {
    pub fn label(&self) -> &'static str {
        match self {
            SwapDirection::ZbxToZusd => "zbx_to_zusd",
            SwapDirection::ZusdToZbx => "zusd_to_zbx",
        }
    }
    pub fn input_symbol(&self) -> &'static str {
        match self {
            SwapDirection::ZbxToZusd => "ZBX",
            SwapDirection::ZusdToZbx => "zUSD",
        }
    }
    pub fn output_symbol(&self) -> &'static str {
        match self {
            SwapDirection::ZbxToZusd => "zUSD",
            SwapDirection::ZusdToZbx => "ZBX",
        }
    }
}

impl TxKind {
    /// Stable, lower-snake-case label for this kind. Useful for RPC payloads,
    /// log lines, and dashboards.
    pub fn variant_name(&self) -> &'static str {
        match self {
            TxKind::Transfer => "transfer",
            TxKind::ValidatorAdd { .. } => "validator_add",
            TxKind::ValidatorRemove { .. } => "validator_remove",
            TxKind::ValidatorEdit { .. } => "validator_edit",
            TxKind::GovernorChange { .. } => "governor_change",
            TxKind::Staking(_) => "staking",
            TxKind::RegisterPayId { .. } => "register_pay_id",
            TxKind::Multisig(_) => "multisig",
            TxKind::Swap { .. } => "swap",
            TxKind::Bridge(_) => "bridge",
        }
    }

    /// Bincode tag (0-based index) — matches the on-wire discriminator.
    /// Returned by RPC as `kind_index` for cross-language clients that don't
    /// want to round-trip the full enum.
    pub fn tag_index(&self) -> u32 {
        match self {
            TxKind::Transfer => 0,
            TxKind::ValidatorAdd { .. } => 1,
            TxKind::ValidatorRemove { .. } => 2,
            TxKind::ValidatorEdit { .. } => 3,
            TxKind::GovernorChange { .. } => 4,
            TxKind::Staking(_) => 5,
            TxKind::RegisterPayId { .. } => 6,
            TxKind::Multisig(_) => 7,
            TxKind::Swap { .. } => 8,
            TxKind::Bridge(_) => 9,
        }
    }

    /// Returns true if this kind moves user funds (Transfer, Staking, or Swap —
    /// each debits/credits the sender's balance).
    pub fn is_value_bearing(&self) -> bool {
        matches!(
            self,
            TxKind::Transfer | TxKind::Staking(_) | TxKind::Swap { .. }
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TxBody — unsigned payload that gets hashed for signature.
// ──────────────────────────────────────────────────────────────────────────

/// Transaction body (unsigned). Amount is in wei (1 ZBX = 10^18 wei).
///
/// **Wire format note (B.3.1):** `kind` was added at the end of this struct.
/// This is a chain-breaking change vs. pre-B.3.1 binaries — devnets must
/// re-init genesis. The default value is `Transfer` so all existing CLI
/// helpers and EVM-style flows keep working unchanged.
///
/// **Field order is consensus-critical** — bincode is positional, so DO NOT
/// reorder these fields without bumping genesis.
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

impl TxBody {
    /// Convenience constructor for a plain ZBX transfer.
    pub fn transfer(
        from: Address,
        to: Address,
        amount_wei: u128,
        nonce: u64,
        fee_wei: u128,
        chain_id: u64,
    ) -> Self {
        Self {
            from,
            to,
            amount: amount_wei,
            nonce,
            fee: fee_wei,
            chain_id,
            kind: TxKind::Transfer,
        }
    }

    /// Canonical bytes that get hashed for the signature. This is the
    /// deterministic bincode encoding of `self` and MUST match the bytes
    /// produced by every other node — a single field reorder would break
    /// signature verification across the network.
    pub fn signing_bytes(&self) -> Vec<u8> {
        bincode::serialize(self).expect("body serialization cannot fail")
    }

    /// Sign this body with `secret` (32-byte secp256k1 secret) and return a
    /// fully-formed [`SignedTx`] ready to broadcast.
    pub fn sign(self, secret: &[u8; 32]) -> SignedTx {
        crate::crypto::sign_tx(secret, self)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SignedTx — what travels on the wire and ends up in blocks.
// ──────────────────────────────────────────────────────────────────────────

/// Signed transaction. **Phase B.11** — secp256k1 ECDSA signature of
/// `bincode(body)` by `pubkey`.
///
/// `from` (inside `body`) MUST equal `address_from_pubkey(&pubkey)` — the
/// network rejects any tx where the binding is wrong, before even verifying
/// the signature.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedTx {
    pub body: TxBody,
    /// **Phase B.11** — compressed secp256k1 public key of the sender
    /// (33 bytes, SEC1 `0x02|0x03 || X`). The 20-byte address is derived as
    /// `keccak256(uncompressed_pubkey[1..])[12..]` — same as Ethereum.
    #[serde(with = "crate::types::hex_array_33")]
    pub pubkey: [u8; 33],
    /// ECDSA-secp256k1 compact signature (64 bytes, `r || s`) over
    /// `bincode(body)`.
    #[serde(with = "BigArray")]
    pub signature: [u8; 64],
}

impl SignedTx {
    /// Keccak-256 of the bincode-encoded `SignedTx`. This is the canonical
    /// "tx hash" exposed by RPC (`zbx_sendRawTransaction` returns this) and
    /// used as the dedup key in the mempool.
    pub fn hash(&self) -> Hash {
        crate::crypto::tx_hash(self)
    }

    /// Recompute the sender's address from the embedded pubkey. This MUST
    /// equal `self.body.from` for the tx to be valid.
    pub fn sender_address(&self) -> Address {
        crate::crypto::address_from_pubkey(&self.pubkey)
    }

    /// Verify (a) `from == address_from_pubkey(pubkey)` and (b) signature is
    /// valid ECDSA-secp256k1 over `bincode(body)`. Returns `false` on any mismatch.
    pub fn verify(&self) -> bool {
        crate::crypto::verify_tx(self)
    }

    /// Bincode-encoded raw bytes (what gets sent over the wire / hex-encoded
    /// for `zbx_sendRawTransaction`).
    pub fn to_bytes(&self) -> Vec<u8> {
        bincode::serialize(self).expect("signed tx ser cannot fail")
    }

    /// Inverse of [`Self::to_bytes`]. Used by `zbx_sendRawTransaction` to
    /// decode the hex-encoded raw payload submitted by clients.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, bincode::Error> {
        bincode::deserialize(bytes)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{address_from_pubkey, generate_keypair};
    use crate::types::Address;

    #[test]
    fn transfer_constructor_sets_kind_transfer() {
        let body = TxBody::transfer(Address::ZERO, Address::ZERO, 100, 0, 1, 7878);
        assert_eq!(body.kind, TxKind::Transfer);
        assert_eq!(body.amount, 100);
        assert_eq!(body.chain_id, 7878);
    }

    #[test]
    fn sign_and_verify_via_inherent_methods() {
        let (sk, pk) = generate_keypair();
        let from = address_from_pubkey(&pk);
        let body = TxBody::transfer(from, Address::ZERO, 42, 0, 1, 7878);
        let tx = body.sign(&sk);
        assert!(tx.verify());
        assert_eq!(tx.sender_address(), from);
    }

    #[test]
    fn hash_is_deterministic() {
        let (sk, pk) = generate_keypair();
        let from = address_from_pubkey(&pk);
        let body = TxBody::transfer(from, Address::ZERO, 1, 7, 1, 7878);
        let tx = body.sign(&sk);
        assert_eq!(tx.hash(), tx.hash());
    }

    #[test]
    fn roundtrip_to_from_bytes() {
        let (sk, pk) = generate_keypair();
        let from = address_from_pubkey(&pk);
        let body = TxBody::transfer(from, Address::ZERO, 1, 0, 1, 7878);
        let tx = body.sign(&sk);
        let bytes = tx.to_bytes();
        let decoded = SignedTx::from_bytes(&bytes).expect("decode");
        assert_eq!(decoded, tx);
        assert!(decoded.verify());
    }

    #[test]
    fn variant_names_are_stable() {
        assert_eq!(TxKind::Transfer.variant_name(), "transfer");
        assert_eq!(TxKind::Transfer.tag_index(), 0);
    }

    #[test]
    fn tampered_signature_fails_verify() {
        let (sk, pk) = generate_keypair();
        let from = address_from_pubkey(&pk);
        let body = TxBody::transfer(from, Address::ZERO, 1, 0, 1, 7878);
        let mut tx = body.sign(&sk);
        tx.signature[0] ^= 0xff;
        assert!(!tx.verify());
    }
}
