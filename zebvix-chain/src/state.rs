//! Persistent state: balances, nonces, blocks. Backed by RocksDB.

use crate::crypto::{block_hash, tx_hash, verify_tx, verify_txs_batch};
use crate::pool::Pool;
use crate::tokenomics::reward_at_height;
use crate::types::{Address, Block, Hash, SignedTx};
use anyhow::{anyhow, Result};
use parking_lot::RwLock;
use rocksdb::{ColumnFamilyDescriptor, Options, DB};
use std::path::Path;
use std::sync::Arc;

const CF_ACCOUNTS: &str = "accounts"; // address -> Account
const CF_BLOCKS: &str = "blocks";     // height (be u64) -> Block bytes
const CF_META: &str = "meta";         // misc keys

const META_HEIGHT: &[u8] = b"height";
const META_LAST_HASH: &[u8] = b"last_hash";
const META_POOL: &[u8] = b"pool";
const META_LP_PREFIX: &[u8] = b"lp/"; // followed by 20-byte address → u128 LP balance

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct Account {
    pub balance: u128,    // ZBX balance (wei)
    pub nonce: u64,
    #[serde(default)]
    pub zusd: u128,       // zUSD balance (18-decimals)
}

pub struct State {
    db: Arc<DB>,
    /// In-memory cache of current tip for fast access.
    tip: RwLock<(u64, Hash)>,
}

impl State {
    pub fn open(path: &Path) -> Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);
        let cfs = vec![
            ColumnFamilyDescriptor::new(CF_ACCOUNTS, Options::default()),
            ColumnFamilyDescriptor::new(CF_BLOCKS, Options::default()),
            ColumnFamilyDescriptor::new(CF_META, Options::default()),
        ];
        let db = DB::open_cf_descriptors(&opts, path, cfs)?;
        let height = db
            .get_cf(db.cf_handle(CF_META).unwrap(), META_HEIGHT)?
            .map(|b| {
                let mut a = [0u8; 8];
                a.copy_from_slice(&b);
                u64::from_be_bytes(a)
            })
            .unwrap_or(0);
        let last = db
            .get_cf(db.cf_handle(CF_META).unwrap(), META_LAST_HASH)?
            .map(|b| {
                let mut a = [0u8; 32];
                a.copy_from_slice(&b);
                Hash(a)
            })
            .unwrap_or(Hash::ZERO);
        Ok(Self { db: Arc::new(db), tip: RwLock::new((height, last)) })
    }

    pub fn tip(&self) -> (u64, Hash) {
        *self.tip.read()
    }

    pub fn account(&self, a: &Address) -> Account {
        let cf = self.db.cf_handle(CF_ACCOUNTS).unwrap();
        match self.db.get_cf(cf, a.0).ok().flatten() {
            Some(b) => bincode::deserialize(&b).unwrap_or_default(),
            None => Account::default(),
        }
    }

    pub fn balance(&self, a: &Address) -> u128 { self.account(a).balance }
    pub fn nonce(&self, a: &Address) -> u64 { self.account(a).nonce }

    fn put_account(&self, a: &Address, acc: &Account) -> Result<()> {
        let cf = self.db.cf_handle(CF_ACCOUNTS).unwrap();
        let bytes = bincode::serialize(acc)?;
        self.db.put_cf(cf, a.0, bytes)?;
        Ok(())
    }

    /// Pre-allocate balances at genesis.
    pub fn genesis_credit(&self, alloc: &[(Address, u128)]) -> Result<()> {
        for (addr, amount) in alloc {
            let mut acc = self.account(addr);
            acc.balance = acc.balance.saturating_add(*amount);
            self.put_account(addr, &acc)?;
        }
        Ok(())
    }

    /// Apply a single transaction (no signature check — caller should verify first).
    pub fn apply_tx(&self, tx: &SignedTx) -> Result<()> {
        // Enforce minimum gas fee (spam protection).
        if tx.body.fee < crate::tokenomics::MIN_TX_FEE_WEI {
            return Err(anyhow!(
                "fee too low: {} wei < min {} wei (0.001 ZBX)",
                tx.body.fee, crate::tokenomics::MIN_TX_FEE_WEI
            ));
        }
        let mut from = self.account(&tx.body.from);
        if from.nonce != tx.body.nonce {
            return Err(anyhow!("bad nonce: have {}, got {}", from.nonce, tx.body.nonce));
        }
        let total = tx.body.amount.checked_add(tx.body.fee)
            .ok_or_else(|| anyhow!("amount+fee overflow"))?;
        if from.balance < total {
            return Err(anyhow!("insufficient balance"));
        }
        from.balance -= total;
        from.nonce += 1;
        let mut to = self.account(&tx.body.to);
        to.balance = to.balance.saturating_add(tx.body.amount);
        self.put_account(&tx.body.from, &from)?;
        self.put_account(&tx.body.to, &to)?;
        Ok(())
    }

    /// Apply a full block: verify txs, update state, mint reward + fees to proposer.
    pub fn apply_block(&self, block: &Block) -> Result<()> {
        let (h, last) = self.tip();
        if block.header.height != h + 1 {
            return Err(anyhow!("non-contiguous height: tip {h} got {}", block.header.height));
        }
        if block.header.parent_hash != last {
            return Err(anyhow!("parent hash mismatch"));
        }
        // Step 1 — parallel + batch signature verification (Rayon + ed25519 batch).
        // For small blocks (<4 txs) the per-tx overhead beats batching, so fall back.
        if block.txs.len() >= 4 {
            if !verify_txs_batch(&block.txs) {
                return Err(anyhow!("bad tx signature in block (batch verify failed)"));
            }
        } else {
            for tx in &block.txs {
                if !verify_tx(tx) {
                    return Err(anyhow!("bad tx signature: {}", tx_hash(tx)));
                }
            }
        }

        // Step 2 — sequential state apply (will be parallelized via Block-STM in v0.3).
        let mut total_fees: u128 = 0;
        for tx in &block.txs {
            self.apply_tx(tx)?;
            total_fees = total_fees.saturating_add(tx.body.fee);
        }
        // Block reward + fees to proposer
        let reward = reward_at_height(block.header.height);
        let mut prop = self.account(&block.header.proposer);
        prop.balance = prop.balance
            .saturating_add(reward)
            .saturating_add(total_fees);
        self.put_account(&block.header.proposer, &prop)?;

        // Persist block
        let cf_b = self.db.cf_handle(CF_BLOCKS).unwrap();
        let cf_m = self.db.cf_handle(CF_META).unwrap();
        let key = block.header.height.to_be_bytes();
        self.db.put_cf(cf_b, key, bincode::serialize(block)?)?;
        let bh = block_hash(&block.header);
        self.db.put_cf(cf_m, META_HEIGHT, key)?;
        self.db.put_cf(cf_m, META_LAST_HASH, bh.0)?;
        *self.tip.write() = (block.header.height, bh);
        Ok(())
    }

    pub fn block_at(&self, height: u64) -> Option<Block> {
        let cf = self.db.cf_handle(CF_BLOCKS).unwrap();
        self.db.get_cf(cf, height.to_be_bytes()).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
    }

    // ───────── zUSD + Pool operations ─────────

    /// Read the singleton AMM pool. Returns default (uninitialized) if missing.
    pub fn pool(&self) -> Pool {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.get_cf(cf, META_POOL).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
            .unwrap_or_default()
    }

    fn put_pool(&self, p: &Pool) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        self.db.put_cf(cf, META_POOL, bincode::serialize(p)?)?;
        Ok(())
    }

    /// LP token balance for an address.
    pub fn lp_balance(&self, a: &Address) -> u128 {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut k = META_LP_PREFIX.to_vec();
        k.extend_from_slice(&a.0);
        self.db.get_cf(cf, &k).ok().flatten()
            .and_then(|b| bincode::deserialize(&b).ok())
            .unwrap_or(0u128)
    }

    fn put_lp(&self, a: &Address, bal: u128) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).unwrap();
        let mut k = META_LP_PREFIX.to_vec();
        k.extend_from_slice(&a.0);
        self.db.put_cf(cf, &k, bincode::serialize(&bal)?)?;
        Ok(())
    }

    /// Founder/admin: mint zUSD to an address (testnet faucet, removed in v1.0).
    pub fn faucet_mint_zusd(&self, to: &Address, amount: u128) -> Result<()> {
        let mut acc = self.account(to);
        acc.zusd = acc.zusd.saturating_add(amount);
        self.put_account(to, &acc)?;
        Ok(())
    }

    /// Initialize the pool with first liquidity (admin/founder action).
    /// Debits ZBX + zUSD from `from`, credits LP tokens.
    pub fn pool_init(&self, from: &Address, zbx: u128, zusd: u128) -> Result<u128> {
        let mut p = self.pool();
        if p.is_initialized() {
            return Err(anyhow!("pool already initialized"));
        }
        let mut acc = self.account(from);
        if acc.balance < zbx { return Err(anyhow!("insufficient ZBX")); }
        if acc.zusd < zusd { return Err(anyhow!("insufficient zUSD")); }
        let height = self.tip().0;
        let lp = p.init_liquidity(zbx, zusd, height).map_err(|e| anyhow!(e))?;
        acc.balance -= zbx;
        acc.zusd -= zusd;
        self.put_account(from, &acc)?;
        self.put_lp(from, self.lp_balance(from).saturating_add(lp))?;
        self.put_pool(&p)?;
        Ok(lp)
    }

    /// Add liquidity proportionally to current ratio. Returns (zbx_used, zusd_used, lp_minted).
    pub fn pool_add_liquidity(&self, from: &Address, zbx_max: u128, zusd_max: u128) -> Result<(u128, u128, u128)> {
        let mut p = self.pool();
        let mut acc = self.account(from);
        if acc.balance < zbx_max { return Err(anyhow!("insufficient ZBX")); }
        if acc.zusd < zusd_max { return Err(anyhow!("insufficient zUSD")); }
        let height = self.tip().0;
        let (zbx_in, zusd_in, lp) = p.add_liquidity(zbx_max, zusd_max, height).map_err(|e| anyhow!(e))?;
        acc.balance -= zbx_in;
        acc.zusd -= zusd_in;
        self.put_account(from, &acc)?;
        self.put_lp(from, self.lp_balance(from).saturating_add(lp))?;
        self.put_pool(&p)?;
        Ok((zbx_in, zusd_in, lp))
    }

    /// Swap ZBX → zUSD. Returns zUSD received.
    pub fn pool_swap_zbx_to_zusd(&self, from: &Address, zbx_in: u128, min_out: u128) -> Result<u128> {
        let mut p = self.pool();
        let mut acc = self.account(from);
        if acc.balance < zbx_in { return Err(anyhow!("insufficient ZBX")); }
        let height = self.tip().0;
        let out = p.swap_zbx_for_zusd(zbx_in, height).map_err(|e| anyhow!(e))?;
        if out < min_out { return Err(anyhow!("slippage: got {} < min {}", out, min_out)); }
        acc.balance -= zbx_in;
        acc.zusd = acc.zusd.saturating_add(out);
        self.put_account(from, &acc)?;
        self.put_pool(&p)?;
        Ok(out)
    }

    /// Swap zUSD → ZBX. Returns ZBX received.
    pub fn pool_swap_zusd_to_zbx(&self, from: &Address, zusd_in: u128, min_out: u128) -> Result<u128> {
        let mut p = self.pool();
        let mut acc = self.account(from);
        if acc.zusd < zusd_in { return Err(anyhow!("insufficient zUSD")); }
        let height = self.tip().0;
        let out = p.swap_zusd_for_zbx(zusd_in, height).map_err(|e| anyhow!(e))?;
        if out < min_out { return Err(anyhow!("slippage: got {} < min {}", out, min_out)); }
        acc.zusd -= zusd_in;
        acc.balance = acc.balance.saturating_add(out);
        self.put_account(from, &acc)?;
        self.put_pool(&p)?;
        Ok(out)
    }
}
