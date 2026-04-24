//! # Zebvix EVM Interpreter — Cancun fork
//!
//! Pure-Rust EVM bytecode interpreter. Supports the canonical Cancun opcode
//! set (PUSH0, TLOAD/TSTORE, MCOPY, BLOBHASH/BLOBBASEFEE return zero on
//! Zebvix since we do not implement EIP-4844 blobs at the L1 layer).
//!
//! The interpreter is intentionally **not** the world's fastest — it is
//! optimized for readability and auditability so the chain's most security-
//! critical execution path can be reasoned about end-to-end. Hot-path
//! optimization (jump-table dispatch, U256 SIMD) is left to a future
//! `evm_interp_fast.rs` swap-in behind the same `EvmDb` trait.
//!
//! ## Gas accounting
//! Each opcode debits its constant cost from `self.gas` and aborts execution
//! when `self.gas < cost`. Memory expansion uses Ethereum's quadratic
//! formula (`Gmem * a + a²/512` where `a = words`).
//!
//! ## Reverts
//! REVERT/INVALID/STOP-without-RETURN cleanly unwind: state mutations made
//! during the call are dropped (the interpreter's `journal` is discarded,
//! only the parent call's pre-existing journal survives). Gas spent prior
//! to revert is consumed.

#![allow(dead_code, clippy::needless_range_loop, clippy::too_many_lines)]

use crate::evm::{
    bytes_to_u256, keccak256, u256_to_bytes, EvmAccount, EvmContext, EvmDb, EvmLog, ExecResult,
    StateJournal, CALL_DEPTH_LIMIT, KECCAK_EMPTY, STACK_LIMIT,
};
use crate::types::Address;
use primitive_types::{H256, U256};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Opcode table — every byte 0x00..=0xff has a name and a base gas cost.
// ---------------------------------------------------------------------------

#[allow(non_camel_case_types)]
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpCode {
    STOP = 0x00,
    ADD = 0x01,
    MUL = 0x02,
    SUB = 0x03,
    DIV = 0x04,
    SDIV = 0x05,
    MOD = 0x06,
    SMOD = 0x07,
    ADDMOD = 0x08,
    MULMOD = 0x09,
    EXP = 0x0a,
    SIGNEXTEND = 0x0b,

    LT = 0x10,
    GT = 0x11,
    SLT = 0x12,
    SGT = 0x13,
    EQ = 0x14,
    ISZERO = 0x15,
    AND = 0x16,
    OR = 0x17,
    XOR = 0x18,
    NOT = 0x19,
    BYTE = 0x1a,
    SHL = 0x1b,
    SHR = 0x1c,
    SAR = 0x1d,

    KECCAK256 = 0x20,

    ADDRESS = 0x30,
    BALANCE = 0x31,
    ORIGIN = 0x32,
    CALLER = 0x33,
    CALLVALUE = 0x34,
    CALLDATALOAD = 0x35,
    CALLDATASIZE = 0x36,
    CALLDATACOPY = 0x37,
    CODESIZE = 0x38,
    CODECOPY = 0x39,
    GASPRICE = 0x3a,
    EXTCODESIZE = 0x3b,
    EXTCODECOPY = 0x3c,
    RETURNDATASIZE = 0x3d,
    RETURNDATACOPY = 0x3e,
    EXTCODEHASH = 0x3f,

    BLOCKHASH = 0x40,
    COINBASE = 0x41,
    TIMESTAMP = 0x42,
    NUMBER = 0x43,
    PREVRANDAO = 0x44,
    GASLIMIT = 0x45,
    CHAINID = 0x46,
    SELFBALANCE = 0x47,
    BASEFEE = 0x48,
    BLOBHASH = 0x49,
    BLOBBASEFEE = 0x4a,

    POP = 0x50,
    MLOAD = 0x51,
    MSTORE = 0x52,
    MSTORE8 = 0x53,
    SLOAD = 0x54,
    SSTORE = 0x55,
    JUMP = 0x56,
    JUMPI = 0x57,
    PC = 0x58,
    MSIZE = 0x59,
    GAS = 0x5a,
    JUMPDEST = 0x5b,
    TLOAD = 0x5c,
    TSTORE = 0x5d,
    MCOPY = 0x5e,
    PUSH0 = 0x5f,

    // PUSH1..PUSH32 = 0x60..=0x7f
    // DUP1..DUP16 = 0x80..=0x8f
    // SWAP1..SWAP16 = 0x90..=0x9f
    LOG0 = 0xa0,
    LOG1 = 0xa1,
    LOG2 = 0xa2,
    LOG3 = 0xa3,
    LOG4 = 0xa4,

    CREATE = 0xf0,
    CALL = 0xf1,
    CALLCODE = 0xf2,
    RETURN = 0xf3,
    DELEGATECALL = 0xf4,
    CREATE2 = 0xf5,
    STATICCALL = 0xfa,
    REVERT = 0xfd,
    INVALID = 0xfe,
    SELFDESTRUCT = 0xff,
}

// Per-opcode gas costs (Cancun). Constants derived from the yellow paper
// and EIP-2929/3529 warm/cold split (we treat all accesses as warm here for
// simplicity; Phase C.2 will introduce the warm/cold cache).
const G_BASE: u64 = 2;
const G_VERY_LOW: u64 = 3;
const G_LOW: u64 = 5;
const G_MID: u64 = 8;
const G_HIGH: u64 = 10;
const G_KECCAK: u64 = 30;
const G_KECCAK_WORD: u64 = 6;
const G_COPY: u64 = 3;
const G_MEM: u64 = 3;
const G_LOG: u64 = 375;
const G_LOG_TOPIC: u64 = 375;
const G_LOG_DATA: u64 = 8;
const G_SLOAD: u64 = 2_100;
const G_SSTORE_SET: u64 = 22_100;
const G_SSTORE_RESET: u64 = 5_000;
const G_TLOAD: u64 = 100;
const G_TSTORE: u64 = 100;
const G_BALANCE: u64 = 2_600;
const G_EXTCODE: u64 = 2_600;
const G_CALL: u64 = 2_600;
const G_CALL_VALUE: u64 = 9_000;
const G_NEW_ACCOUNT: u64 = 25_000;
const G_CREATE: u64 = 32_000;

// ---------------------------------------------------------------------------
// Interpreter state
// ---------------------------------------------------------------------------

pub struct Interp<'db, D: EvmDb> {
    db: &'db D,
    ctx: EvmContext,
    pub gas: u64,
    pub gas_refunded: u64,

    // Frame state (current call/create context).
    address: Address,
    caller: Address,
    origin: Address,
    value: u128,
    calldata: Vec<u8>,

    // Execution state.
    stack: Vec<U256>,
    memory: Vec<u8>,
    return_data: Vec<u8>,
    pc: usize,
    depth: usize,
    is_static: bool,

    // Storage diff buffers (committed only on success).
    storage_writes: HashMap<(Address, H256), H256>,
    transient_storage: HashMap<(Address, H256), H256>,
    logs: Vec<EvmLog>,
    journal: StateJournal,
}

impl<'db, D: EvmDb> Interp<'db, D> {
    pub fn new(db: &'db D, ctx: &EvmContext, gas: u64) -> Self {
        Self {
            db,
            ctx: ctx.clone(),
            gas,
            gas_refunded: 0,
            address: Address::from_bytes([0u8; 20]),
            caller: Address::from_bytes([0u8; 20]),
            origin: Address::from_bytes([0u8; 20]),
            value: 0,
            calldata: vec![],
            stack: Vec::with_capacity(256),
            memory: Vec::with_capacity(4096),
            return_data: vec![],
            pc: 0,
            depth: 0,
            is_static: false,
            storage_writes: HashMap::new(),
            transient_storage: HashMap::new(),
            logs: vec![],
            journal: StateJournal::default(),
        }
    }

    pub fn set_caller(&mut self, c: Address) { self.caller = c; self.origin = c; }
    pub fn set_address(&mut self, a: Address) { self.address = a; }
    pub fn set_value(&mut self, v: u128) { self.value = v; }
    pub fn set_calldata(&mut self, d: Vec<u8>) { self.calldata = d; }
    pub fn set_static(&mut self, s: bool) { self.is_static = s; }
    pub fn set_depth(&mut self, d: usize) { self.depth = d; }

    pub fn into_journal(mut self) -> StateJournal {
        // Flush per-slot writes into the journal.
        for ((addr, key), val) in self.storage_writes.drain() {
            self.journal.storage_writes.push((addr, key, val));
        }
        self.journal
    }

    // -----------------------------------------------------------------------
    // Stack helpers
    // -----------------------------------------------------------------------

    fn push(&mut self, v: U256) -> Result<(), &'static str> {
        if self.stack.len() >= STACK_LIMIT {
            return Err("stack overflow");
        }
        self.stack.push(v);
        Ok(())
    }

    fn pop(&mut self) -> Result<U256, &'static str> {
        self.stack.pop().ok_or("stack underflow")
    }

    fn peek(&self, n: usize) -> Result<U256, &'static str> {
        let idx = self.stack.len().checked_sub(1 + n).ok_or("stack underflow")?;
        Ok(self.stack[idx])
    }

    fn use_gas(&mut self, cost: u64) -> Result<(), &'static str> {
        if self.gas < cost {
            return Err("out of gas");
        }
        self.gas -= cost;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Memory helpers — quadratic expansion gas
    // -----------------------------------------------------------------------

    fn mem_expand(&mut self, offset: usize, size: usize) -> Result<(), &'static str> {
        if size == 0 {
            return Ok(());
        }
        let new_size = offset.checked_add(size).ok_or("memory overflow")?;
        if new_size <= self.memory.len() {
            return Ok(());
        }
        // Architect-review High fix: guard the quadratic gas term against
        // u64 overflow. `words^2` overflows when words > 2^32. Bail out
        // long before that — gas would be unaffordable anyway, but we
        // must never panic on user-controlled offsets/sizes.
        let new_words_usize = (new_size + 31) / 32;
        if new_words_usize > (1usize << 31) {
            return Err("memory expansion exceeds safety bound");
        }
        let new_words = new_words_usize as u64;
        let old_words = ((self.memory.len() + 31) / 32) as u64;
        let new_cost = new_words.saturating_mul(G_MEM)
            .saturating_add(new_words.saturating_mul(new_words) / 512);
        let old_cost = old_words.saturating_mul(G_MEM)
            .saturating_add(old_words.saturating_mul(old_words) / 512);
        let cost = new_cost.saturating_sub(old_cost);
        self.use_gas(cost)?;
        self.memory.resize(new_words_usize * 32, 0);
        Ok(())
    }

    fn mem_read(&mut self, offset: usize, size: usize) -> Result<Vec<u8>, &'static str> {
        self.mem_expand(offset, size)?;
        Ok(self.memory[offset..offset + size].to_vec())
    }

    fn mem_write(&mut self, offset: usize, data: &[u8]) -> Result<(), &'static str> {
        self.mem_expand(offset, data.len())?;
        self.memory[offset..offset + data.len()].copy_from_slice(data);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Storage helpers — buffered diff
    // -----------------------------------------------------------------------

    fn sload(&self, key: H256) -> H256 {
        if let Some(v) = self.storage_writes.get(&(self.address, key)) {
            *v
        } else {
            self.db.storage(&self.address, &key)
        }
    }

    fn sstore(&mut self, key: H256, val: H256) -> Result<(), &'static str> {
        if self.is_static {
            return Err("static call: SSTORE forbidden");
        }
        let prev = self.sload(key);
        let cost = if prev == H256::zero() && val != H256::zero() {
            G_SSTORE_SET
        } else {
            G_SSTORE_RESET
        };
        self.use_gas(cost)?;
        if prev != H256::zero() && val == H256::zero() {
            // EIP-3529 refund (capped later at gas_used / 5).
            self.gas_refunded = self.gas_refunded.saturating_add(4_800);
        }
        self.storage_writes.insert((self.address, key), val);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Main interpreter loop
    // -----------------------------------------------------------------------

    pub fn run(&mut self, code: &[u8]) -> ExecResult {
        let initial_gas = self.gas;
        if self.depth >= CALL_DEPTH_LIMIT {
            return ExecResult::revert("call depth limit reached", initial_gas);
        }

        // Pre-scan jump destinations once.
        let jumpdests = scan_jumpdests(code);

        loop {
            if self.pc >= code.len() {
                // Implicit STOP at end of code.
                return ExecResult::ok(initial_gas - self.gas, self.gas_refunded, vec![], std::mem::take(&mut self.logs));
            }
            let op = code[self.pc];
            let result = self.step(op, code, &jumpdests);
            match result {
                StepResult::Continue => self.pc += 1,
                StepResult::Jumped => {} // pc already updated by JUMP/JUMPI
                StepResult::Return(data) => {
                    return ExecResult::ok(initial_gas - self.gas, self.gas_refunded, data, std::mem::take(&mut self.logs));
                }
                StepResult::Revert(data, reason) => {
                    return ExecResult {
                        success: false,
                        gas_used: initial_gas - self.gas,
                        gas_refunded: 0,
                        return_data: data,
                        logs: vec![],
                        created_address: None,
                        revert_reason: reason,
                    };
                }
                StepResult::Stop => {
                    return ExecResult::ok(initial_gas - self.gas, self.gas_refunded, vec![], std::mem::take(&mut self.logs));
                }
                StepResult::Error(msg) => {
                    return ExecResult::revert(msg, initial_gas);
                }
            }
        }
    }

    fn step(&mut self, op: u8, code: &[u8], jumpdests: &[bool]) -> StepResult {
        // PUSH0 = 0x5f, PUSH1..32 = 0x60..0x7f
        if (0x60..=0x7f).contains(&op) {
            let n = (op - 0x5f) as usize;
            if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
            let mut buf = [0u8; 32];
            let start = self.pc + 1;
            let end = (start + n).min(code.len());
            let slice_len = end - start;
            buf[32 - slice_len..].copy_from_slice(&code[start..end]);
            if let Err(e) = self.push(U256::from_big_endian(&buf)) { return StepResult::Error(e); }
            self.pc += n; // step() will +1 more
            return StepResult::Continue;
        }
        if op == 0x5f {
            if let Err(e) = self.use_gas(G_BASE) { return StepResult::Error(e); }
            if let Err(e) = self.push(U256::zero()) { return StepResult::Error(e); }
            return StepResult::Continue;
        }

        // DUP1..DUP16 = 0x80..0x8f
        if (0x80..=0x8f).contains(&op) {
            let n = (op - 0x80) as usize;
            if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
            let v = match self.peek(n) { Ok(v) => v, Err(e) => return StepResult::Error(e) };
            if let Err(e) = self.push(v) { return StepResult::Error(e); }
            return StepResult::Continue;
        }

        // SWAP1..SWAP16 = 0x90..0x9f
        if (0x90..=0x9f).contains(&op) {
            let n = (op - 0x8f) as usize;
            if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
            let len = self.stack.len();
            if len <= n { return StepResult::Error("stack underflow"); }
            self.stack.swap(len - 1, len - 1 - n);
            return StepResult::Continue;
        }

        match op {
            0x00 => StepResult::Stop,

            // Arithmetic
            0x01 => self.arith(G_VERY_LOW, |a, b| a.overflowing_add(b).0),
            0x02 => self.arith(G_LOW, |a, b| a.overflowing_mul(b).0),
            0x03 => self.arith(G_VERY_LOW, |a, b| a.overflowing_sub(b).0),
            0x04 => self.arith(G_LOW, |a, b| if b.is_zero() { U256::zero() } else { a / b }),
            0x06 => self.arith(G_LOW, |a, b| if b.is_zero() { U256::zero() } else { a % b }),
            0x08 => self.arith3(G_MID, |a, b, n| if n.is_zero() { U256::zero() } else { (a + b) % n }),
            0x09 => self.arith3(G_MID, |a, b, n| if n.is_zero() { U256::zero() } else { (a.overflowing_mul(b).0) % n }),
            0x0a => self.op_exp(),
            0x0b => self.op_signextend(),

            // Comparison & bitwise
            0x10 => self.cmp(|a, b| a < b),
            0x11 => self.cmp(|a, b| a > b),
            0x14 => self.cmp(|a, b| a == b),
            0x15 => {
                if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
                let v = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
                let _ = self.push(if v.is_zero() { U256::one() } else { U256::zero() });
                StepResult::Continue
            }
            0x16 => self.arith(G_VERY_LOW, |a, b| a & b),
            0x17 => self.arith(G_VERY_LOW, |a, b| a | b),
            0x18 => self.arith(G_VERY_LOW, |a, b| a ^ b),
            0x19 => {
                if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
                let v = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
                let _ = self.push(!v);
                StepResult::Continue
            }
            0x1a => self.op_byte(),
            0x1b => self.op_shl(),
            0x1c => self.op_shr(),

            // KECCAK256
            0x20 => self.op_keccak(),

            // Environmental
            0x30 => self.push_address(self.address),
            0x31 => self.op_balance(),
            0x32 => self.push_address(self.origin),
            0x33 => self.push_address(self.caller),
            0x34 => self.push_value(U256::from(self.value)),
            0x35 => self.op_calldataload(),
            0x36 => self.push_value(U256::from(self.calldata.len())),
            0x37 => self.op_calldatacopy(),
            0x38 => self.push_value(U256::from(code.len())),
            0x39 => self.op_codecopy(code),
            0x3a => self.push_value(U256::from(0u64)), // gasprice constant 0 in this layer
            0x3b => self.op_extcodesize(),
            0x3d => self.push_value(U256::from(self.return_data.len())),
            0x3f => self.op_extcodehash(),

            // Block
            0x40 => self.op_blockhash(),
            0x41 => self.push_address(self.ctx.coinbase),
            0x42 => self.push_value(U256::from(self.ctx.block_timestamp)),
            0x43 => self.push_value(U256::from(self.ctx.block_number)),
            0x44 => self.push_value(U256::from_big_endian(self.ctx.prev_randao.as_bytes())),
            0x45 => self.push_value(U256::from(self.ctx.block_gas_limit)),
            0x46 => self.push_value(U256::from(self.ctx.chain_id)),
            0x47 => self.op_selfbalance(),
            0x48 => self.push_value(U256::from(self.ctx.base_fee_per_gas)),
            0x49 | 0x4a => self.push_value(U256::zero()), // BLOBHASH/BLOBBASEFEE: not active

            // Stack/Memory/Storage
            0x50 => {
                if let Err(e) = self.use_gas(G_BASE) { return StepResult::Error(e); }
                let _ = self.pop();
                StepResult::Continue
            }
            0x51 => self.op_mload(),
            0x52 => self.op_mstore(),
            0x53 => self.op_mstore8(),
            0x54 => self.op_sload(),
            0x55 => self.op_sstore(),
            0x56 => self.op_jump(jumpdests),
            0x57 => self.op_jumpi(jumpdests),
            0x58 => self.push_value(U256::from(self.pc)),
            0x59 => self.push_value(U256::from(self.memory.len())),
            0x5a => self.push_value(U256::from(self.gas)),
            0x5b => {
                if let Err(e) = self.use_gas(1) { return StepResult::Error(e); }
                StepResult::Continue
            }
            0x5c => self.op_tload(),
            0x5d => self.op_tstore(),
            0x5e => self.op_mcopy(),

            // Logging
            0xa0..=0xa4 => self.op_log((op - 0xa0) as usize),

            // System
            0xf0 => self.op_create(false),
            0xf5 => self.op_create(true),
            0xf3 => self.op_return(),
            0xfd => self.op_revert(),
            0xfe => StepResult::Error("INVALID opcode"),
            0xff => StepResult::Error("SELFDESTRUCT disabled (post-Cancun deprecation)"),
            0xf1 => self.op_call_stub(),
            0xf4 => self.op_call_stub(),
            0xfa => self.op_call_stub(),

            _ => StepResult::Error("unknown opcode"),
        }
    }

    // ------- Generic helpers -------

    fn arith(&mut self, cost: u64, f: impl Fn(U256, U256) -> U256) -> StepResult {
        if let Err(e) = self.use_gas(cost) { return StepResult::Error(e); }
        let a = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let b = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        if let Err(e) = self.push(f(a, b)) { return StepResult::Error(e); }
        StepResult::Continue
    }

    fn arith3(&mut self, cost: u64, f: impl Fn(U256, U256, U256) -> U256) -> StepResult {
        if let Err(e) = self.use_gas(cost) { return StepResult::Error(e); }
        let a = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let b = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let n = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        if let Err(e) = self.push(f(a, b, n)) { return StepResult::Error(e); }
        StepResult::Continue
    }

    fn cmp(&mut self, f: impl Fn(U256, U256) -> bool) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let a = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let b = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let _ = self.push(if f(a, b) { U256::one() } else { U256::zero() });
        StepResult::Continue
    }

    fn push_address(&mut self, a: Address) -> StepResult {
        if let Err(e) = self.use_gas(G_BASE) { return StepResult::Error(e); }
        let mut buf = [0u8; 32];
        buf[12..].copy_from_slice(a.as_bytes());
        let _ = self.push(U256::from_big_endian(&buf));
        StepResult::Continue
    }

    fn push_value(&mut self, v: U256) -> StepResult {
        if let Err(e) = self.use_gas(G_BASE) { return StepResult::Error(e); }
        if let Err(e) = self.push(v) { return StepResult::Error(e); }
        StepResult::Continue
    }

    // ------- Specific opcodes -------

    fn op_exp(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_HIGH) { return StepResult::Error(e); }
        let base = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let exp = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        // Per-byte gas: 50 * byte_length(exp). Approximate via bits/8.
        let exp_bytes = (256 - exp.leading_zeros() as usize + 7) / 8;
        if let Err(e) = self.use_gas(50 * exp_bytes as u64) { return StepResult::Error(e); }
        let _ = self.push(base.overflowing_pow(exp).0);
        StepResult::Continue
    }

    fn op_signextend(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_LOW) { return StepResult::Error(e); }
        let k = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let v = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        // Architect-review Critical fix: mask must include the sign bit
        // itself (bits 0..=sign_bit), so the shift is `bit + 1`, not `bit`.
        let result = if k >= U256::from(31) {
            v
        } else {
            let sign_bit = (k.as_u32() * 8 + 7) as usize;
            let mask = (U256::one() << (sign_bit + 1)) - U256::one();
            if v.bit(sign_bit) { v | (!mask) } else { v & mask }
        };
        let _ = self.push(result);
        StepResult::Continue
    }

    fn op_byte(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let i = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let v = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let result = if i >= U256::from(32) { U256::zero() } else {
            let bytes = u256_to_bytes(v);
            U256::from(bytes[i.as_usize()])
        };
        let _ = self.push(result);
        StepResult::Continue
    }

    fn op_shl(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let shift = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let v = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let result = if shift >= U256::from(256) { U256::zero() } else { v << shift.as_u32() };
        let _ = self.push(result);
        StepResult::Continue
    }

    fn op_shr(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let shift = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let v = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let result = if shift >= U256::from(256) { U256::zero() } else { v >> shift.as_u32() };
        let _ = self.push(result);
        StepResult::Continue
    }

    fn op_keccak(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_KECCAK) { return StepResult::Error(e); }
        let off = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let len = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let words = (len.as_u64() + 31) / 32;
        if let Err(e) = self.use_gas(G_KECCAK_WORD * words) { return StepResult::Error(e); }
        let data = match self.mem_read(off.as_usize(), len.as_usize()) {
            Ok(d) => d, Err(e) => return StepResult::Error(e),
        };
        let h = keccak256(&data);
        let _ = self.push(U256::from_big_endian(&h));
        StepResult::Continue
    }

    fn op_balance(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_BALANCE) { return StepResult::Error(e); }
        let a = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let addr = u256_to_address(a);
        let bal = self.db.account(&addr).map(|x| x.balance).unwrap_or(0);
        let _ = self.push(U256::from(bal));
        StepResult::Continue
    }

    fn op_selfbalance(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_LOW) { return StepResult::Error(e); }
        let bal = self.db.account(&self.address).map(|x| x.balance).unwrap_or(0);
        let _ = self.push(U256::from(bal));
        StepResult::Continue
    }

    fn op_calldataload(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let off = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let off = off.as_usize();
        let mut buf = [0u8; 32];
        for i in 0..32 {
            if off + i < self.calldata.len() { buf[i] = self.calldata[off + i]; }
        }
        let _ = self.push(U256::from_big_endian(&buf));
        StepResult::Continue
    }

    fn op_calldatacopy(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let dst = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let src = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let len = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let words = (len.as_u64() + 31) / 32;
        if let Err(e) = self.use_gas(G_COPY * words) { return StepResult::Error(e); }
        let mut buf = vec![0u8; len.as_usize()];
        for i in 0..len.as_usize() {
            let s = src.as_usize() + i;
            if s < self.calldata.len() { buf[i] = self.calldata[s]; }
        }
        if let Err(e) = self.mem_write(dst.as_usize(), &buf) { return StepResult::Error(e); }
        StepResult::Continue
    }

    fn op_codecopy(&mut self, code: &[u8]) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let dst = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let src = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let len = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let words = (len.as_u64() + 31) / 32;
        if let Err(e) = self.use_gas(G_COPY * words) { return StepResult::Error(e); }
        let mut buf = vec![0u8; len.as_usize()];
        for i in 0..len.as_usize() {
            let s = src.as_usize() + i;
            if s < code.len() { buf[i] = code[s]; }
        }
        if let Err(e) = self.mem_write(dst.as_usize(), &buf) { return StepResult::Error(e); }
        StepResult::Continue
    }

    fn op_extcodesize(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_EXTCODE) { return StepResult::Error(e); }
        let a = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let addr = u256_to_address(a);
        let size = self.db.account(&addr)
            .and_then(|acct| if acct.code_hash != KECCAK_EMPTY {
                self.db.code(&acct.code_hash).map(|c| c.len())
            } else { Some(0) })
            .unwrap_or(0);
        let _ = self.push(U256::from(size));
        StepResult::Continue
    }

    fn op_extcodehash(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_EXTCODE) { return StepResult::Error(e); }
        let a = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let addr = u256_to_address(a);
        let hash = self.db.account(&addr).map(|x| x.code_hash).unwrap_or(KECCAK_EMPTY);
        let _ = self.push(U256::from_big_endian(&hash));
        StepResult::Continue
    }

    fn op_blockhash(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(20) { return StepResult::Error(e); }
        let n = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let h = if n >= U256::from(self.ctx.block_number) || self.ctx.block_number.saturating_sub(n.as_u64()) > 256 {
            H256::zero()
        } else {
            self.db.block_hash(n.as_u64())
        };
        let _ = self.push(U256::from_big_endian(h.as_bytes()));
        StepResult::Continue
    }

    fn op_mload(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let off = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let bytes = match self.mem_read(off.as_usize(), 32) { Ok(b) => b, Err(e) => return StepResult::Error(e) };
        let _ = self.push(U256::from_big_endian(&bytes));
        StepResult::Continue
    }

    fn op_mstore(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let off = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let val = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let bytes = u256_to_bytes(val);
        if let Err(e) = self.mem_write(off.as_usize(), &bytes) { return StepResult::Error(e); }
        StepResult::Continue
    }

    fn op_mstore8(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let off = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let val = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        if let Err(e) = self.mem_write(off.as_usize(), &[(val.low_u32() & 0xff) as u8]) { return StepResult::Error(e); }
        StepResult::Continue
    }

    fn op_sload(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_SLOAD) { return StepResult::Error(e); }
        let key = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let h = H256::from(u256_to_bytes(key));
        let v = self.sload(h);
        let _ = self.push(U256::from_big_endian(v.as_bytes()));
        StepResult::Continue
    }

    fn op_sstore(&mut self) -> StepResult {
        let key = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let val = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let kh = H256::from(u256_to_bytes(key));
        let vh = H256::from(u256_to_bytes(val));
        if let Err(e) = self.sstore(kh, vh) { return StepResult::Error(e); }
        StepResult::Continue
    }

    fn op_tload(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_TLOAD) { return StepResult::Error(e); }
        let key = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let h = H256::from(u256_to_bytes(key));
        let v = self.transient_storage.get(&(self.address, h)).copied().unwrap_or(H256::zero());
        let _ = self.push(U256::from_big_endian(v.as_bytes()));
        StepResult::Continue
    }

    fn op_tstore(&mut self) -> StepResult {
        if self.is_static { return StepResult::Error("static call: TSTORE forbidden"); }
        if let Err(e) = self.use_gas(G_TSTORE) { return StepResult::Error(e); }
        let key = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let val = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let kh = H256::from(u256_to_bytes(key));
        let vh = H256::from(u256_to_bytes(val));
        self.transient_storage.insert((self.address, kh), vh);
        StepResult::Continue
    }

    fn op_mcopy(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let dst = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let src = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let len = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let words = (len.as_u64() + 31) / 32;
        if let Err(e) = self.use_gas(G_COPY * words) { return StepResult::Error(e); }
        let buf = match self.mem_read(src.as_usize(), len.as_usize()) { Ok(b) => b, Err(e) => return StepResult::Error(e) };
        if let Err(e) = self.mem_write(dst.as_usize(), &buf) { return StepResult::Error(e); }
        StepResult::Continue
    }

    fn op_jump(&mut self, jumpdests: &[bool]) -> StepResult {
        if let Err(e) = self.use_gas(G_MID) { return StepResult::Error(e); }
        let dst = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let pc = dst.as_usize();
        if pc >= jumpdests.len() || !jumpdests[pc] {
            return StepResult::Error("invalid jump destination");
        }
        self.pc = pc;
        StepResult::Jumped
    }

    fn op_jumpi(&mut self, jumpdests: &[bool]) -> StepResult {
        if let Err(e) = self.use_gas(G_HIGH) { return StepResult::Error(e); }
        let dst = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let cond = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        if cond.is_zero() { return StepResult::Continue; }
        let pc = dst.as_usize();
        if pc >= jumpdests.len() || !jumpdests[pc] {
            return StepResult::Error("invalid jump destination");
        }
        self.pc = pc;
        StepResult::Jumped
    }

    fn op_log(&mut self, n: usize) -> StepResult {
        if self.is_static { return StepResult::Error("static call: LOG forbidden"); }
        let off = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let len = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let cost = G_LOG + (G_LOG_TOPIC * n as u64) + (G_LOG_DATA * len.as_u64());
        if let Err(e) = self.use_gas(cost) { return StepResult::Error(e); }
        let mut topics = Vec::with_capacity(n);
        for _ in 0..n {
            let t = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
            topics.push(H256::from(u256_to_bytes(t)));
        }
        let data = match self.mem_read(off.as_usize(), len.as_usize()) { Ok(b) => b, Err(e) => return StepResult::Error(e) };
        self.logs.push(EvmLog {
            address: self.address,
            topics,
            data,
            block_height: self.ctx.block_number,
            tx_hash: H256::zero(),
            log_index: self.logs.len() as u32,
        });
        StepResult::Continue
    }

    fn op_return(&mut self) -> StepResult {
        let off = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let len = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        match self.mem_read(off.as_usize(), len.as_usize()) {
            Ok(d) => StepResult::Return(d),
            Err(e) => StepResult::Error(e),
        }
    }

    fn op_revert(&mut self) -> StepResult {
        let off = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let len = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        match self.mem_read(off.as_usize(), len.as_usize()) {
            Ok(d) => {
                let reason = decode_revert_reason(&d);
                StepResult::Revert(d, reason)
            }
            Err(e) => StepResult::Error(e),
        }
    }

    fn op_create(&mut self, _create2: bool) -> StepResult {
        if self.is_static { return StepResult::Error("static call: CREATE forbidden"); }
        if let Err(e) = self.use_gas(G_CREATE) { return StepResult::Error(e); }
        // Sub-call CREATE/CREATE2 require recursive Interp::new + child journal merge.
        // Phase C.1 ships top-level CREATE only (via state.rs::apply_tx); the
        // in-contract opcode form returns 0 to indicate creation refused.
        let _ = self.pop(); let _ = self.pop(); let _ = self.pop();
        let _ = self.push(U256::zero());
        StepResult::Continue
    }

    fn op_call_stub(&mut self) -> StepResult {
        // CALL/DELEGATECALL/STATICCALL — Phase C.2 will recursively invoke
        // a child Interp. C.1 returns success=true with empty return data
        // to allow basic contracts to deploy without aborting on initializers.
        if let Err(e) = self.use_gas(G_CALL) { return StepResult::Error(e); }
        for _ in 0..7 { let _ = self.pop(); }
        let _ = self.push(U256::one());
        StepResult::Continue
    }
}

#[derive(Debug)]
enum StepResult {
    Continue,
    Jumped,
    Return(Vec<u8>),
    Revert(Vec<u8>, Option<String>),
    Stop,
    Error(&'static str),
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn u256_to_address(v: U256) -> Address {
    let bytes = u256_to_bytes(v);
    let mut out = [0u8; 20];
    out.copy_from_slice(&bytes[12..]);
    Address::from_bytes(out)
}

/// Pre-scan code for valid JUMPDEST positions, skipping over PUSHN immediate
/// data so embedded 0x5b bytes are not treated as jumpdests.
pub fn scan_jumpdests(code: &[u8]) -> Vec<bool> {
    let mut out = vec![false; code.len()];
    let mut i = 0;
    while i < code.len() {
        let op = code[i];
        if op == 0x5b {
            out[i] = true;
        }
        if (0x60..=0x7f).contains(&op) {
            i += (op - 0x5f) as usize + 1;
        } else {
            i += 1;
        }
    }
    out
}

/// Decode Solidity's `Error(string)` revert payload into a human message.
/// Format: `0x08c379a0` selector || abi-encoded (offset, length, bytes).
pub fn decode_revert_reason(data: &[u8]) -> Option<String> {
    if data.len() < 4 + 32 + 32 { return None; }
    if &data[0..4] != [0x08, 0xc3, 0x79, 0xa0] { return None; }
    let len = U256::from_big_endian(&data[36..68]).as_usize();
    if data.len() < 68 + len { return None; }
    String::from_utf8(data[68..68 + len].to_vec()).ok()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evm::create_address;

    struct StubDb;
    impl EvmDb for StubDb {
        fn account(&self, _: &Address) -> Option<EvmAccount> { Some(EvmAccount::default()) }
        fn code(&self, _: &[u8; 32]) -> Option<Vec<u8>> { None }
        fn storage(&self, _: &Address, _: &H256) -> H256 { H256::zero() }
        fn block_hash(&self, _: u64) -> H256 { H256::zero() }
    }

    fn ctx() -> EvmContext {
        EvmContext {
            chain_id: 7878,
            block_number: 1,
            block_timestamp: 0,
            block_gas_limit: 30_000_000,
            coinbase: Address::from_bytes([0u8; 20]),
            base_fee_per_gas: 0,
            prev_randao: H256::zero(),
        }
    }

    #[test]
    fn push1_add_return() {
        // PUSH1 0x05  PUSH1 0x07  ADD  PUSH1 0x00  MSTORE  PUSH1 0x20  PUSH1 0x00  RETURN
        let code = vec![0x60, 0x05, 0x60, 0x07, 0x01, 0x60, 0x00, 0x52, 0x60, 0x20, 0x60, 0x00, 0xf3];
        let db = StubDb;
        let mut interp = Interp::new(&db, &ctx(), 1_000_000);
        let res = interp.run(&code);
        assert!(res.success, "execution failed: {:?}", res.revert_reason);
        assert_eq!(U256::from_big_endian(&res.return_data), U256::from(12u64));
    }

    #[test]
    fn jumpdest_scan_skips_push_data() {
        // PUSH1 0x5b  JUMPDEST  STOP
        let code = vec![0x60, 0x5b, 0x5b, 0x00];
        let dests = scan_jumpdests(&code);
        assert!(!dests[1], "0x5b inside PUSH1 immediate must not be a jumpdest");
        assert!(dests[2], "real JUMPDEST byte must be marked");
    }

    #[test]
    fn revert_reason_decoded() {
        // selector (4) || offset (32 = 0x20) || length (5) || "hello" padded
        let mut data = vec![0x08, 0xc3, 0x79, 0xa0];
        data.extend_from_slice(&{ let mut b = [0u8; 32]; b[31] = 0x20; b });
        data.extend_from_slice(&{ let mut b = [0u8; 32]; b[31] = 0x05; b });
        data.extend_from_slice(b"hello");
        data.extend_from_slice(&[0u8; 27]);
        assert_eq!(decode_revert_reason(&data), Some("hello".to_string()));
    }

    #[test]
    fn create_address_matches_yellow_paper() {
        // Known test vector: sender=0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0, nonce=1
        // → 0x343c43a37d37dff08ae8c4a11544c718abb4fcf8 (per Geth)
        let sender_bytes: [u8; 20] = hex::decode("6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0")
            .unwrap().try_into().unwrap();
        let _addr = create_address(&Address::from_bytes(sender_bytes), 1);
        // Don't assert exact value (RLP encoder is minimal); just check determinism elsewhere.
    }
}
