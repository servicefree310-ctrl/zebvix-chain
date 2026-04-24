//! # Zebvix EVM State Backend — `CF_EVM` column family
//!
//! Concrete [`EvmDb`] implementation backed by the existing `state.rs`
//! RocksDB instance. Adds a new column family (`evm`) that holds three
//! key-prefixed namespaces:
//!
//! ```text
//!   acct/<addr20>          → bincode(EvmAccount)
//!   code/<keccak256_32>    → raw bytecode
//!   stor/<addr20><key32>   → raw 32-byte slot value
//! ```
//!
//! On boot, [`open_with_evm`] is called from `state::State::open()` to
//! ensure the column family exists; existing chains will have it auto-
//! created on first run (RocksDB handles missing CFs as empty).
//!
//! ## Concurrency
//! Reads are lock-free (RocksDB MVCC). Writes are batched via
//! [`StateJournalApplier`] which wraps a `WriteBatch` so the entire EVM
//! diff for one transaction commits atomically with the chain's other
//! state mutations in `state::apply_tx`.

#![allow(dead_code)]

use crate::evm::{EvmAccount, EvmDb, EvmLog, StateJournal};
use crate::types::Address;
use anyhow::{Context, Result};
use parking_lot::RwLock;
use primitive_types::H256;
use rocksdb::{ColumnFamilyDescriptor, Options, WriteBatch, DB};
use std::collections::HashMap;
use std::sync::Arc;

pub const CF_EVM: &str = "evm";
pub const CF_LOGS: &str = "evm_logs";

const PREFIX_ACCT: u8 = 0x01;
const PREFIX_CODE: u8 = 0x02;
const PREFIX_STOR: u8 = 0x03;
const PREFIX_BLOCKHASH: u8 = 0x04;

// ---------------------------------------------------------------------------
// Key encoding
// ---------------------------------------------------------------------------

fn key_acct(addr: &Address) -> Vec<u8> {
    let mut k = Vec::with_capacity(1 + 20);
    k.push(PREFIX_ACCT);
    k.extend_from_slice(addr.as_bytes());
    k
}

fn key_code(hash: &[u8; 32]) -> Vec<u8> {
    let mut k = Vec::with_capacity(1 + 32);
    k.push(PREFIX_CODE);
    k.extend_from_slice(hash);
    k
}

fn key_stor(addr: &Address, slot: &H256) -> Vec<u8> {
    let mut k = Vec::with_capacity(1 + 20 + 32);
    k.push(PREFIX_STOR);
    k.extend_from_slice(addr.as_bytes());
    k.extend_from_slice(slot.as_bytes());
    k
}

fn key_blockhash(num: u64) -> Vec<u8> {
    let mut k = Vec::with_capacity(1 + 8);
    k.push(PREFIX_BLOCKHASH);
    k.extend_from_slice(&num.to_be_bytes());
    k
}

fn log_key(block_height: u64, log_index: u32) -> Vec<u8> {
    let mut k = Vec::with_capacity(8 + 4);
    k.extend_from_slice(&block_height.to_be_bytes());
    k.extend_from_slice(&log_index.to_be_bytes());
    k
}

// ---------------------------------------------------------------------------
// Column family setup
// ---------------------------------------------------------------------------

/// Returns the descriptors that must be added to the existing `state::open()`
/// call. Wire by appending these to the `cfs` vec before `DB::open_cf_descriptors`.
pub fn evm_column_families() -> Vec<ColumnFamilyDescriptor> {
    vec![
        ColumnFamilyDescriptor::new(CF_EVM, Options::default()),
        ColumnFamilyDescriptor::new(CF_LOGS, Options::default()),
    ]
}

// ---------------------------------------------------------------------------
// Concrete EvmDb implementation
// ---------------------------------------------------------------------------

pub struct CfEvmDb {
    db: Arc<DB>,
    /// In-memory cache for hot accounts. Flushed on every `apply_journal`.
    cache: RwLock<HashMap<Address, EvmAccount>>,
}

impl CfEvmDb {
    pub fn new(db: Arc<DB>) -> Self {
        Self { db, cache: RwLock::new(HashMap::new()) }
    }

    pub fn record_block_hash(&self, num: u64, hash: H256) -> Result<()> {
        let cf = self.db.cf_handle(CF_EVM).context("CF_EVM missing")?;
        self.db.put_cf(cf, key_blockhash(num), hash.as_bytes())?;
        Ok(())
    }

    pub fn put_account(&self, addr: &Address, acct: &EvmAccount) -> Result<()> {
        let cf = self.db.cf_handle(CF_EVM).context("CF_EVM missing")?;
        let bytes = bincode::serialize(acct)?;
        self.db.put_cf(cf, key_acct(addr), bytes)?;
        self.cache.write().insert(*addr, acct.clone());
        Ok(())
    }

    pub fn put_code(&self, hash: &[u8; 32], code: &[u8]) -> Result<()> {
        let cf = self.db.cf_handle(CF_EVM).context("CF_EVM missing")?;
        self.db.put_cf(cf, key_code(hash), code)?;
        Ok(())
    }

    pub fn put_storage(&self, addr: &Address, slot: &H256, val: &H256) -> Result<()> {
        let cf = self.db.cf_handle(CF_EVM).context("CF_EVM missing")?;
        if val == &H256::zero() {
            // Optimization: deleting a slot is cheaper than storing zeros.
            self.db.delete_cf(cf, key_stor(addr, slot))?;
        } else {
            self.db.put_cf(cf, key_stor(addr, slot), val.as_bytes())?;
        }
        Ok(())
    }

    /// Atomically commit one [`StateJournal`] produced by [`crate::evm::execute`].
    /// Uses a single RocksDB `WriteBatch` so the entire diff lands together
    /// (no half-applied state if a node crashes mid-write).
    pub fn apply_journal(&self, journal: &StateJournal) -> Result<()> {
        let cf = self.db.cf_handle(CF_EVM).context("CF_EVM missing")?;
        let mut batch = WriteBatch::default();

        for (addr, acct) in &journal.touched_accounts {
            let bytes = bincode::serialize(acct)?;
            batch.put_cf(cf, key_acct(addr), bytes);
            self.cache.write().insert(*addr, acct.clone());
        }
        for (hash, code) in &journal.new_code {
            batch.put_cf(cf, key_code(hash), code);
        }
        for (addr, slot, val) in &journal.storage_writes {
            if val == &H256::zero() {
                batch.delete_cf(cf, key_stor(addr, slot));
            } else {
                batch.put_cf(cf, key_stor(addr, slot), val.as_bytes());
            }
        }
        for addr in &journal.destructed {
            batch.delete_cf(cf, key_acct(addr));
            self.cache.write().remove(addr);
        }

        self.db.write(batch)?;
        Ok(())
    }

    pub fn store_logs(&self, logs: &[EvmLog]) -> Result<()> {
        let cf = self.db.cf_handle(CF_LOGS).context("CF_LOGS missing")?;
        let mut batch = WriteBatch::default();
        for log in logs {
            let key = log_key(log.block_height, log.log_index);
            let bytes = bincode::serialize(log)?;
            batch.put_cf(cf, key, bytes);
        }
        self.db.write(batch)?;
        Ok(())
    }

    /// Iterate logs by block-range. `eth_getLogs` further filters by address
    /// and topics in the RPC layer.
    pub fn iter_logs(&self, from_block: u64, to_block: u64) -> Result<Vec<EvmLog>> {
        let cf = self.db.cf_handle(CF_LOGS).context("CF_LOGS missing")?;
        let from_key = log_key(from_block, 0);
        let to_key = log_key(to_block.saturating_add(1), 0);
        let mut out = vec![];
        let iter = self.db.iterator_cf(cf, rocksdb::IteratorMode::From(&from_key, rocksdb::Direction::Forward));
        for item in iter {
            let (k, v) = item?;
            if k.as_ref() >= to_key.as_slice() {
                break;
            }
            if let Ok(log) = bincode::deserialize::<EvmLog>(&v) {
                out.push(log);
            }
        }
        Ok(out)
    }

    /// Cheap account-existence test (avoids deserializing the value body).
    pub fn account_exists(&self, addr: &Address) -> bool {
        if self.cache.read().contains_key(addr) {
            return true;
        }
        let cf = match self.db.cf_handle(CF_EVM) { Some(cf) => cf, None => return false };
        self.db.get_cf(cf, key_acct(addr)).map(|o| o.is_some()).unwrap_or(false)
    }
}

impl EvmDb for CfEvmDb {
    fn account(&self, addr: &Address) -> Option<EvmAccount> {
        if let Some(a) = self.cache.read().get(addr) {
            return Some(a.clone());
        }
        let cf = self.db.cf_handle(CF_EVM)?;
        let bytes = self.db.get_cf(cf, key_acct(addr)).ok().flatten()?;
        bincode::deserialize::<EvmAccount>(&bytes).ok()
    }

    fn code(&self, hash: &[u8; 32]) -> Option<Vec<u8>> {
        let cf = self.db.cf_handle(CF_EVM)?;
        self.db.get_cf(cf, key_code(hash)).ok().flatten()
    }

    fn storage(&self, addr: &Address, key: &H256) -> H256 {
        let cf = match self.db.cf_handle(CF_EVM) { Some(cf) => cf, None => return H256::zero() };
        match self.db.get_cf(cf, key_stor(addr, key)) {
            Ok(Some(bytes)) if bytes.len() == 32 => {
                let mut buf = [0u8; 32];
                buf.copy_from_slice(&bytes);
                H256::from(buf)
            }
            _ => H256::zero(),
        }
    }

    fn block_hash(&self, number: u64) -> H256 {
        let cf = match self.db.cf_handle(CF_EVM) { Some(cf) => cf, None => return H256::zero() };
        match self.db.get_cf(cf, key_blockhash(number)) {
            Ok(Some(bytes)) if bytes.len() == 32 => {
                let mut buf = [0u8; 32];
                buf.copy_from_slice(&bytes);
                H256::from(buf)
            }
            _ => H256::zero(),
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers for state.rs integration
// ---------------------------------------------------------------------------

/// Read EVM nonce (used by `eth_getTransactionCount`). Falls back to the
/// chain's native nonce so EOAs created via `TxKind::Transfer` are visible
/// from MetaMask immediately.
pub fn evm_nonce(db: &CfEvmDb, native_nonce: u64, addr: &Address) -> u64 {
    db.account(addr).map(|a| a.nonce).unwrap_or(native_nonce)
}

/// Read EVM balance. Same dual-source fallback as nonce.
pub fn evm_balance(db: &CfEvmDb, native_balance: u128, addr: &Address) -> u128 {
    db.account(addr).map(|a| a.balance).unwrap_or(native_balance)
}

/// Compose a fully-populated [`EvmAccount`] from the chain's native state
/// for accounts that have never executed EVM code yet. This makes the EVM
/// world-state continuous with the native ledger.
pub fn synth_account_from_native(native_balance: u128, native_nonce: u64) -> EvmAccount {
    EvmAccount {
        nonce: native_nonce,
        balance: native_balance,
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use rocksdb::Options;
    use tempfile::tempdir;

    fn open_test_db() -> (Arc<DB>, tempfile::TempDir) {
        let dir = tempdir().unwrap();
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);
        let cfs = evm_column_families();
        let db = DB::open_cf_descriptors(&opts, dir.path(), cfs).unwrap();
        (Arc::new(db), dir)
    }

    #[test]
    fn account_roundtrip() {
        let (db, _dir) = open_test_db();
        let edb = CfEvmDb::new(db);
        let addr = Address::from_bytes([0x42u8; 20]);
        let acct = EvmAccount { nonce: 7, balance: 1_000_000, ..Default::default() };
        edb.put_account(&addr, &acct).unwrap();
        assert_eq!(edb.account(&addr).unwrap().nonce, 7);
        assert_eq!(edb.account(&addr).unwrap().balance, 1_000_000);
    }

    #[test]
    fn storage_zero_optimization() {
        let (db, _dir) = open_test_db();
        let edb = CfEvmDb::new(db);
        let addr = Address::from_bytes([0x01u8; 20]);
        let slot = H256::repeat_byte(1);
        edb.put_storage(&addr, &slot, &H256::repeat_byte(0x77)).unwrap();
        assert_eq!(edb.storage(&addr, &slot), H256::repeat_byte(0x77));
        edb.put_storage(&addr, &slot, &H256::zero()).unwrap();
        assert_eq!(edb.storage(&addr, &slot), H256::zero());
    }

    #[test]
    fn journal_apply_atomic() {
        let (db, _dir) = open_test_db();
        let edb = CfEvmDb::new(db);
        let addr = Address::from_bytes([0xabu8; 20]);
        let acct = EvmAccount { nonce: 1, balance: 500, ..Default::default() };

        let mut j = StateJournal::default();
        j.touched_accounts.push((addr, acct.clone()));
        j.storage_writes.push((addr, H256::repeat_byte(1), H256::repeat_byte(0x42)));
        j.new_code.push(([0xaau8; 32], b"contract bytes".to_vec()));

        edb.apply_journal(&j).unwrap();

        assert_eq!(edb.account(&addr).unwrap().balance, 500);
        assert_eq!(edb.storage(&addr, &H256::repeat_byte(1)), H256::repeat_byte(0x42));
        assert_eq!(edb.code(&[0xaau8; 32]).unwrap(), b"contract bytes");
    }
}
