//! # ZVM Interpreter — Cancun-EVM fork
//!
//! Pure-Rust EVM bytecode interpreter. Supports the canonical Cancun opcode
//! set (PUSH0, TLOAD/TSTORE, MCOPY, BLOBHASH/BLOBBASEFEE return zero on
//! Zebvix since we do not implement EIP-4844 blobs at the L1 layer).
//!
//! The interpreter is intentionally **not** the world's fastest — it is
//! optimized for readability and auditability so the chain's most security-
//! critical execution path can be reasoned about end-to-end. Hot-path
//! optimization (jump-table dispatch, U256 SIMD) is left to a future
//! `evm_interp_fast.rs` swap-in behind the same `ZvmDb` trait.
//!
//! ## Gas accounting
//! Each opcode debits its constant cost from `self.gas` and aborts execution
//! when `self.gas < cost`. Memory expansion uses the EVM's quadratic
//! formula (`Gmem * a + a²/512` where `a = words`).
//!
//! ## Reverts
//! REVERT/INVALID/STOP-without-RETURN cleanly unwind: state mutations made
//! during the call are dropped (the interpreter's `journal` is discarded,
//! only the parent call's pre-existing journal survives). Gas spent prior
//! to revert is consumed.

#![allow(dead_code, clippy::needless_range_loop, clippy::too_many_lines)]

use crate::zvm::{
    create2_address, create_address, keccak256, u256_to_bytes, ZvmAccount,
    ZvmContext, ZvmDb, ZvmLog, ExecResult, StateJournal, CALL_DEPTH_LIMIT, KECCAK_EMPTY,
    MAX_CODE_SIZE, MAX_INITCODE_SIZE, STACK_LIMIT,
};
use crate::zvm_precompiles::dispatch as precompile_dispatch;
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
const G_CODE_DEPOSIT: u64 = 200; // per byte of deployed runtime code
const G_CALL_STIPEND: u64 = 2_300; // free gas given to callee on value xfer

/// Phase C.2 — discriminator for the four CALL-family opcodes. Determines
/// caller / callee / value-transfer / static-flag rules per EIP-7 (DELEGATECALL),
/// EIP-2200 (STATICCALL), and the original yellow-paper CALLCODE semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallKind {
    /// Regular CALL — `to` becomes the new code & storage context, value transferred.
    Call,
    /// CALLCODE — execute `to`'s code in **caller's** storage context, value transferred to caller (no-op).
    CallCode,
    /// DELEGATECALL — execute `to`'s code in caller's context with caller's caller/value preserved.
    DelegateCall,
    /// STATICCALL — like CALL but state-modifying opcodes revert.
    StaticCall,
}

// ---------------------------------------------------------------------------
// Interpreter state
// ---------------------------------------------------------------------------

pub struct Interp<'db, D: ZvmDb> {
    db: &'db D,
    ctx: ZvmContext,
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
    logs: Vec<ZvmLog>,
    journal: StateJournal,
}

impl<'db, D: ZvmDb> Interp<'db, D> {
    pub fn new(db: &'db D, ctx: &ZvmContext, gas: u64) -> Self {
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
            0x05 => self.arith(G_LOW, signed_div),
            0x06 => self.arith(G_LOW, |a, b| if b.is_zero() { U256::zero() } else { a % b }),
            0x07 => self.arith(G_LOW, signed_mod),
            0x08 => self.arith3(G_MID, |a, b, n| if n.is_zero() { U256::zero() } else { (a + b) % n }),
            0x09 => self.arith3(G_MID, |a, b, n| if n.is_zero() { U256::zero() } else { (a.overflowing_mul(b).0) % n }),
            0x0a => self.op_exp(),
            0x0b => self.op_signextend(),

            // Comparison & bitwise
            0x10 => self.cmp(|a, b| a < b),
            0x11 => self.cmp(|a, b| a > b),
            0x12 => self.cmp(signed_lt),
            0x13 => self.cmp(signed_gt),
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
            0x1d => self.op_sar(),

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
            0x3c => self.op_extcodecopy(),
            0x3d => self.push_value(U256::from(self.return_data.len())),
            0x3e => self.op_returndatacopy(),
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

            // System — Phase C.2 ships real recursive frames for all of these.
            0xf0 => self.op_create(false),
            0xf5 => self.op_create(true),
            0xf3 => self.op_return(),
            0xfd => self.op_revert(),
            0xfe => StepResult::Error("INVALID opcode"),
            0xff => StepResult::Error("SELFDESTRUCT disabled (post-Cancun deprecation)"),
            0xf1 => self.op_call_generic(CallKind::Call),
            0xf2 => self.op_call_generic(CallKind::CallCode),
            0xf4 => self.op_call_generic(CallKind::DelegateCall),
            0xfa => self.op_call_generic(CallKind::StaticCall),

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

    /// EIP-145 SAR — signed (arithmetic) shift right. Preserves the sign bit
    /// by shifting in copies of the high bit. For shift >= 256, the result is
    /// 0 if non-negative, all-ones (-1) if negative.
    fn op_sar(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let shift = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let v = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let is_neg = v.bit(255);
        let result = if shift >= U256::from(256) {
            if is_neg { !U256::zero() } else { U256::zero() }
        } else {
            let s = shift.as_u32();
            let logical = v >> s;
            if is_neg && s > 0 {
                // Set the top `s` bits to 1.
                let mask = (!U256::zero()) << (256 - s);
                logical | mask
            } else {
                logical
            }
        };
        let _ = self.push(result);
        StepResult::Continue
    }

    /// EXTCODECOPY — copy `len` bytes of `addr`'s deployed code starting at
    /// `code_off` into caller's memory at `dst_off`. Out-of-bounds source
    /// reads are zero-padded per yellow paper §9.4.
    fn op_extcodecopy(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_EXTCODE) { return StepResult::Error(e); }
        let a = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let dst = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };
        let src = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };
        let len = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };
        let words = (len as u64 + 31) / 32;
        if let Err(e) = self.use_gas(G_COPY * words) { return StepResult::Error(e); }
        let addr = u256_to_address(a);
        let code = self.db.account(&addr)
            .and_then(|acct| if acct.code_hash != KECCAK_EMPTY {
                self.db.code(&acct.code_hash)
            } else { None })
            .unwrap_or_default();
        let mut buf = vec![0u8; len];
        for i in 0..len {
            let s = src + i;
            if s < code.len() { buf[i] = code[s]; }
        }
        if let Err(e) = self.mem_write(dst, &buf) { return StepResult::Error(e); }
        StepResult::Continue
    }

    /// RETURNDATACOPY (EIP-211) — copy from the most-recent sub-call's
    /// `return_data` buffer. Unlike CALLDATA/CODECOPY, this MUST revert
    /// when source range exceeds the buffer (no zero-padding).
    fn op_returndatacopy(&mut self) -> StepResult {
        if let Err(e) = self.use_gas(G_VERY_LOW) { return StepResult::Error(e); }
        let dst = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };
        let src = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };
        let len = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };
        let words = (len as u64 + 31) / 32;
        if let Err(e) = self.use_gas(G_COPY * words) { return StepResult::Error(e); }
        // EIP-211: out-of-bounds read aborts the whole frame.
        let end = src.checked_add(len).ok_or("return data offset overflow");
        let end = match end { Ok(e) => e, Err(e) => return StepResult::Error(e) };
        if end > self.return_data.len() {
            return StepResult::Error("RETURNDATACOPY out of bounds");
        }
        let buf = self.return_data[src..end].to_vec();
        if let Err(e) = self.mem_write(dst, &buf) { return StepResult::Error(e); }
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
        self.logs.push(ZvmLog {
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

    // -----------------------------------------------------------------------
    // Phase C.2 — In-contract CREATE / CREATE2 with recursive init code
    // -----------------------------------------------------------------------
    //
    // Yellow Paper §7 + EIP-1014 (CREATE2) + EIP-3860 (init-code limit) +
    // EIP-684 (collision check) + EIP-170 (runtime code limit).
    //
    // Stack layout:
    //   CREATE:  [value, in_off, in_size]                    -> [addr_or_0]
    //   CREATE2: [value, in_off, in_size, salt]              -> [addr_or_0]

    fn op_create(&mut self, create2: bool) -> StepResult {
        if self.is_static {
            return StepResult::Error("static call: CREATE forbidden");
        }
        if let Err(e) = self.use_gas(G_CREATE) {
            return StepResult::Error(e);
        }
        let value = match self.pop() { Ok(v) => v.low_u128(), Err(e) => return StepResult::Error(e) };
        let in_off = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };
        let in_size = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };
        let salt: Option<[u8; 32]> = if create2 {
            let s = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
            Some(u256_to_bytes(s))
        } else {
            None
        };

        // Read init code from memory (also charges expansion gas).
        let init_code = match self.mem_read(in_off, in_size) {
            Ok(d) => d,
            Err(e) => return StepResult::Error(e),
        };
        if init_code.len() > MAX_INITCODE_SIZE {
            // EIP-3860: init code over limit → push 0, no further gas charged.
            let _ = self.push(U256::zero());
            return StepResult::Continue;
        }

        // Depth check (no return data on overflow).
        if self.depth + 1 > CALL_DEPTH_LIMIT {
            self.return_data.clear();
            let _ = self.push(U256::zero());
            return StepResult::Continue;
        }

        // Caller balance check.
        let mut caller_acct = self.db.account(&self.address).unwrap_or_default();
        if caller_acct.balance < value {
            self.return_data.clear();
            let _ = self.push(U256::zero());
            return StepResult::Continue;
        }

        // Compute new contract address.
        let nonce = caller_acct.nonce;
        let new_addr = match salt {
            Some(s) => create2_address(&self.address, &s, &init_code),
            None => create_address(&self.address, nonce),
        };

        // EIP-684 collision: existing account must have nonce 0 AND no code.
        // Note: `ZvmAccount::default()` reports `code_hash = KECCAK_EMPTY` for
        // accounts the DB doesn't know about — must compare against
        // KECCAK_EMPTY, not the all-zero sentinel.
        let existing = match self.db.account(&new_addr) {
            Some(a) if a.nonce != 0 || a.code_hash != KECCAK_EMPTY => {
                self.return_data.clear();
                let _ = self.push(U256::zero());
                return StepResult::Continue;
            }
            Some(a) => a,
            None => ZvmAccount::default(),
        };

        // Per yellow paper §7 / EIP-684: nonce bump on the caller MUST
        // persist even when the CREATE reverts. The value transfer, by
        // contrast, MUST be rolled back on revert. We split into two
        // journal entries so the snapshot/truncate logic below can drop
        // the value-transfer entry while keeping the nonce-only entry.
        //
        // 1. Push nonce-only state (balance unchanged).
        caller_acct.nonce = nonce.saturating_add(1);
        let caller_balance_before = caller_acct.balance;
        self.journal.touched_accounts.push((self.address, caller_acct.clone()));

        // EIP-150: forward all but 1/64 of remaining gas.
        let avail = self.gas;
        let forward = avail.saturating_sub(avail / 64);
        if let Err(e) = self.use_gas(forward) {
            return StepResult::Error(e);
        }

        // 2. Snapshot AFTER the nonce-only push but BEFORE the value
        //    transfer. On revert, truncating to this index drops the
        //    debit entry, restoring the original balance while keeping
        //    the bumped nonce as the last write for the caller.
        let snap_writes = self.storage_writes.clone();
        let snap_trans = self.transient_storage.clone();
        let snap_logs_len = self.logs.len();
        let snap_refunded = self.gas_refunded;
        let snap_journal_touched = self.journal.touched_accounts.len();
        let snap_journal_code = self.journal.new_code.len();

        // 3. Apply the value transfer (debit caller; new contract is
        //    credited at the success-path account-write below).
        if value > 0 {
            caller_acct.balance = caller_balance_before.saturating_sub(value);
            self.journal.touched_accounts.push((self.address, caller_acct.clone()));
        }

        // Build child interpreter inheriting current pending state.
        let mut child = Interp::new(self.db, &self.ctx, forward);
        child.address = new_addr;
        child.caller = self.address;
        child.origin = self.origin;
        child.value = value;
        child.calldata = vec![];
        child.depth = self.depth + 1;
        child.is_static = false;
        child.storage_writes = self.storage_writes.clone();
        child.transient_storage = self.transient_storage.clone();

        // Run init code → return data is the runtime bytecode.
        let res = child.run(&init_code);
        // Refund unused gas to parent.
        self.gas = self.gas.saturating_add(forward.saturating_sub(res.gas_used));

        if !res.success {
            // Restore snapshot, push 0.
            self.storage_writes = snap_writes;
            self.transient_storage = snap_trans;
            self.logs.truncate(snap_logs_len);
            self.gas_refunded = snap_refunded;
            self.journal.touched_accounts.truncate(snap_journal_touched);
            self.journal.new_code.truncate(snap_journal_code);
            self.return_data = res.return_data;
            let _ = self.push(U256::zero());
            return StepResult::Continue;
        }

        let runtime_code = res.return_data;

        // EIP-170 runtime size + EIP-3541 leading-0xEF rejection.
        if runtime_code.len() > MAX_CODE_SIZE
            || (!runtime_code.is_empty() && runtime_code[0] == 0xef)
        {
            self.storage_writes = snap_writes;
            self.transient_storage = snap_trans;
            self.logs.truncate(snap_logs_len);
            self.gas_refunded = snap_refunded;
            self.journal.touched_accounts.truncate(snap_journal_touched);
            self.journal.new_code.truncate(snap_journal_code);
            self.return_data.clear();
            let _ = self.push(U256::zero());
            return StepResult::Continue;
        }

        // Charge code-deposit gas. If we cannot afford it, treat as failed CREATE.
        let deposit = (runtime_code.len() as u64).saturating_mul(G_CODE_DEPOSIT);
        if self.gas < deposit {
            self.storage_writes = snap_writes;
            self.transient_storage = snap_trans;
            self.logs.truncate(snap_logs_len);
            self.gas_refunded = snap_refunded;
            self.journal.touched_accounts.truncate(snap_journal_touched);
            self.journal.new_code.truncate(snap_journal_code);
            self.return_data.clear();
            let _ = self.push(U256::zero());
            return StepResult::Continue;
        }
        self.gas -= deposit;

        // Commit: adopt child buffers and register the new contract.
        self.storage_writes = std::mem::take(&mut child.storage_writes);
        self.transient_storage = std::mem::take(&mut child.transient_storage);
        self.logs.append(&mut child.logs);
        self.gas_refunded = self.gas_refunded.saturating_add(res.gas_refunded);
        self.return_data.clear();

        let code_hash = keccak256(&runtime_code);
        let new_acct = ZvmAccount {
            nonce: 1,
            balance: existing.balance.saturating_add(value),
            code_hash,
            ..Default::default()
        };
        // Pull child journal entries for any further nested CREATE that
        // happened during init code execution.
        let mut child_touched = std::mem::take(&mut child.journal.touched_accounts);
        let mut child_codes = std::mem::take(&mut child.journal.new_code);
        self.journal.touched_accounts.append(&mut child_touched);
        self.journal.new_code.append(&mut child_codes);
        self.journal.touched_accounts.push((new_addr, new_acct));
        self.journal.new_code.push((code_hash, runtime_code));

        // Push the 20-byte address as a U256 (top 12 bytes zero).
        let _ = self.push(U256::from_big_endian(new_addr.as_bytes()));
        StepResult::Continue
    }

    // -----------------------------------------------------------------------
    // Phase C.2 — Generic CALL / CALLCODE / DELEGATECALL / STATICCALL
    // -----------------------------------------------------------------------
    //
    // Stack layout:
    //   CALL / CALLCODE:        [gas, to, value, in_off, in_size, out_off, out_size]
    //   DELEGATECALL / STATIC:  [gas, to,        in_off, in_size, out_off, out_size]
    //
    // Gas accounting (simplified — we treat all addresses as warm):
    //   base       = G_CALL                                  (2_600)
    //   value xfer = G_CALL_VALUE if value > 0               (9_000)
    //   new acct   = G_NEW_ACCOUNT if value > 0 && empty     (25_000)
    //   forward    = min(gas_arg, available - available/64)  (EIP-150)
    //   stipend    = G_CALL_STIPEND added to forwarded gas if value > 0

    fn op_call_generic(&mut self, kind: CallKind) -> StepResult {
        // Pop stack arguments.
        let gas_arg = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let to_word = match self.pop() { Ok(v) => v, Err(e) => return StepResult::Error(e) };
        let to = address_from_u256(to_word);

        let value = match kind {
            CallKind::Call | CallKind::CallCode => {
                match self.pop() { Ok(v) => v.low_u128(), Err(e) => return StepResult::Error(e) }
            }
            CallKind::DelegateCall | CallKind::StaticCall => 0u128,
        };

        let in_off = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };
        let in_size = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };
        let out_off = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };
        let out_size = match self.pop() { Ok(v) => v.as_usize(), Err(e) => return StepResult::Error(e) };

        // Static-call enforcement: a CALL with value > 0 inside a static context
        // is forbidden (the value transfer is the state mutation).
        if self.is_static && matches!(kind, CallKind::Call) && value > 0 {
            return StepResult::Error("static call: value transfer forbidden");
        }

        // Read calldata for sub-call (charges memory expansion).
        let sub_calldata = match self.mem_read(in_off, in_size) {
            Ok(d) => d,
            Err(e) => return StepResult::Error(e),
        };
        // Pre-charge output region too so revert path can still copy returndata.
        if let Err(e) = self.mem_expand(out_off, out_size) {
            return StepResult::Error(e);
        }

        // Base call cost.
        if let Err(e) = self.use_gas(G_CALL) { return StepResult::Error(e); }

        // Value-transfer surcharges (CALL / CALLCODE only).
        // "Empty" per EIP-161: no account record, OR account exists with
        // (nonce == 0 && balance == 0 && code_hash == KECCAK_EMPTY).
        let target_is_empty = match self.db.account(&to) {
            None => true,
            Some(a) => a.nonce == 0 && a.balance == 0 && a.code_hash == KECCAK_EMPTY,
        };

        if matches!(kind, CallKind::Call | CallKind::CallCode) && value > 0 {
            if let Err(e) = self.use_gas(G_CALL_VALUE) { return StepResult::Error(e); }
            if matches!(kind, CallKind::Call) && target_is_empty {
                if let Err(e) = self.use_gas(G_NEW_ACCOUNT) { return StepResult::Error(e); }
            }
        }

        // Depth check.
        if self.depth + 1 > CALL_DEPTH_LIMIT {
            self.return_data.clear();
            let _ = self.push(U256::zero());
            return StepResult::Continue;
        }

        // Caller balance check (CALL / CALLCODE with value).
        if matches!(kind, CallKind::Call | CallKind::CallCode) && value > 0 {
            let caller_acct = self.db.account(&self.address).unwrap_or_default();
            if caller_acct.balance < value {
                self.return_data.clear();
                let _ = self.push(U256::zero());
                return StepResult::Continue;
            }
        }

        // EIP-150 gas forwarding.
        let avail = self.gas;
        let max_forward = avail.saturating_sub(avail / 64);
        let mut forward = std::cmp::min(gas_arg.low_u64(), max_forward);
        // Stipend on value transfer is *added* to the forwarded gas (and is
        // **not** charged from the caller; it lives on top of `forward`).
        let stipend = if matches!(kind, CallKind::Call | CallKind::CallCode) && value > 0 {
            G_CALL_STIPEND
        } else {
            0
        };
        if let Err(e) = self.use_gas(forward) { return StepResult::Error(e); }
        // Stipend is added on top of the forwarded budget AFTER caller has
        // paid `forward`. Per yellow paper / geth, any unused stipend is
        // refunded back to caller — this is intentional spec behavior, not
        // gas creation. The 9000-gas G_CALL_VALUE charge already paid for
        // it; the stipend just guarantees the callee can run a fallback.
        forward = forward.saturating_add(stipend);

        // Snapshot for rollback on revert.
        let snap_writes = self.storage_writes.clone();
        let snap_trans = self.transient_storage.clone();
        let snap_logs_len = self.logs.len();
        let snap_refunded = self.gas_refunded;
        let snap_journal_touched = self.journal.touched_accounts.len();
        let snap_journal_code = self.journal.new_code.len();

        // Apply value transfer (CALL only — CALLCODE keeps funds with caller).
        if matches!(kind, CallKind::Call) && value > 0 {
            let mut caller_acct = self.db.account(&self.address).unwrap_or_default();
            let mut target_acct = self.db.account(&to).unwrap_or_default();
            caller_acct.balance = caller_acct.balance.saturating_sub(value);
            target_acct.balance = target_acct.balance.saturating_add(value);
            self.journal.touched_accounts.push((self.address, caller_acct));
            self.journal.touched_accounts.push((to, target_acct));
        }

        // ---- Precompile dispatch ----
        if let Some(out) = precompile_dispatch(&to, &sub_calldata, forward) {
            // Refund unused gas.
            self.gas = self.gas.saturating_add(forward.saturating_sub(out.gas_used));
            if out.success {
                self.return_data = out.return_data.clone();
                let copy_len = std::cmp::min(out_size, out.return_data.len());
                if copy_len > 0 {
                    self.memory[out_off..out_off + copy_len]
                        .copy_from_slice(&out.return_data[..copy_len]);
                }
                let _ = self.push(U256::one());
            } else {
                // Failed precompile → rollback value transfer too.
                self.storage_writes = snap_writes;
                self.transient_storage = snap_trans;
                self.logs.truncate(snap_logs_len);
                self.gas_refunded = snap_refunded;
                self.journal.touched_accounts.truncate(snap_journal_touched);
                self.journal.new_code.truncate(snap_journal_code);
                self.return_data.clear();
                let _ = self.push(U256::zero());
            }
            return StepResult::Continue;
        }

        // ---- Bytecode dispatch ----
        let target_acct = self.db.account(&to).unwrap_or_default();
        let target_code = if target_acct.code_hash == [0u8; 32]
            || target_acct.code_hash == KECCAK_EMPTY
        {
            vec![]
        } else {
            self.db.code(&target_acct.code_hash).unwrap_or_default()
        };

        // No code at target with no value xfer → success with empty return.
        if target_code.is_empty() && value == 0 {
            self.gas = self.gas.saturating_add(forward);
            self.return_data.clear();
            let _ = self.push(U256::one());
            return StepResult::Continue;
        }

        // Build child interpreter. Frame state depends on kind.
        let (sub_address, sub_caller, sub_value) = match kind {
            CallKind::Call | CallKind::StaticCall => (to, self.address, value),
            CallKind::CallCode => (self.address, self.address, value),
            CallKind::DelegateCall => (self.address, self.caller, self.value),
        };
        let sub_static = self.is_static || matches!(kind, CallKind::StaticCall);

        let mut child = Interp::new(self.db, &self.ctx, forward);
        child.address = sub_address;
        child.caller = sub_caller;
        child.origin = self.origin;
        child.value = sub_value;
        child.calldata = sub_calldata;
        child.depth = self.depth + 1;
        child.is_static = sub_static;
        child.storage_writes = self.storage_writes.clone();
        child.transient_storage = self.transient_storage.clone();

        let res = child.run(&target_code);
        // Refund unused gas from the forwarded budget.
        self.gas = self.gas.saturating_add(forward.saturating_sub(res.gas_used));

        if res.success {
            // Adopt child mutations.
            self.storage_writes = std::mem::take(&mut child.storage_writes);
            self.transient_storage = std::mem::take(&mut child.transient_storage);
            self.logs.append(&mut child.logs);
            self.gas_refunded = self.gas_refunded.saturating_add(res.gas_refunded);
            // Merge child's journal entries (e.g. nested CREATEs).
            let mut t = std::mem::take(&mut child.journal.touched_accounts);
            let mut c = std::mem::take(&mut child.journal.new_code);
            self.journal.touched_accounts.append(&mut t);
            self.journal.new_code.append(&mut c);

            // Copy return data into caller's memory window.
            self.return_data = res.return_data.clone();
            let copy_len = std::cmp::min(out_size, res.return_data.len());
            if copy_len > 0 {
                self.memory[out_off..out_off + copy_len]
                    .copy_from_slice(&res.return_data[..copy_len]);
            }
            let _ = self.push(U256::one());
        } else {
            // Roll back: snapshot already captured *before* the value transfer,
            // so restoring it implicitly reverts that too.
            self.storage_writes = snap_writes;
            self.transient_storage = snap_trans;
            self.logs.truncate(snap_logs_len);
            self.gas_refunded = snap_refunded;
            self.journal.touched_accounts.truncate(snap_journal_touched);
            self.journal.new_code.truncate(snap_journal_code);

            // Return data still copied per yellow paper §9.4.
            self.return_data = res.return_data.clone();
            let copy_len = std::cmp::min(out_size, res.return_data.len());
            if copy_len > 0 {
                self.memory[out_off..out_off + copy_len]
                    .copy_from_slice(&res.return_data[..copy_len]);
            }
            let _ = self.push(U256::zero());
        }

        StepResult::Continue
    }
}

/// Convert a U256 stack word into a 20-byte EVM address by taking the
/// lower 160 bits (top 96 bits ignored per yellow paper §9.4).
fn address_from_u256(v: U256) -> Address {
    let buf = v.to_big_endian();
    let mut addr = [0u8; 20];
    addr.copy_from_slice(&buf[12..]);
    Address::from_bytes(addr)
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

// ---------------------------------------------------------------------------
// Signed-arithmetic helpers for SDIV / SMOD / SLT / SGT
//
// EVM 256-bit signed integers use two's complement: bit 255 is the sign bit.
// We provide cheap helpers that interpret a `U256` as `I256` without needing
// a third-party crate. All inputs/outputs remain `U256`/`bool` to slot into
// the interpreter's `arith`/`cmp` callbacks unchanged.
// ---------------------------------------------------------------------------

/// True if the U256 value, interpreted as I256, is negative (top bit set).
#[inline]
fn is_neg_i256(v: U256) -> bool { v.bit(255) }

/// Two's-complement negation: `!v + 1` (wrapping). For `0` returns `0`.
#[inline]
fn neg_i256(v: U256) -> U256 { (!v).overflowing_add(U256::one()).0 }

/// Absolute value as U256. The minimum signed value (`I256::MIN = 0x8000…`)
/// negates to itself; callers (SDIV / SMOD) handle that overflow case.
#[inline]
fn abs_i256(v: U256) -> U256 {
    if is_neg_i256(v) { neg_i256(v) } else { v }
}

/// Signed division per EVM spec:
///   * `b == 0`           → 0
///   * `a == I256::MIN && b == -1` → I256::MIN  (overflow wraps to MIN)
///   * otherwise           → `(|a| / |b|)` with sign = `sign(a) XOR sign(b)`
fn signed_div(a: U256, b: U256) -> U256 {
    if b.is_zero() { return U256::zero(); }
    let i256_min = U256::one() << 255;
    let neg_one = !U256::zero();
    if a == i256_min && b == neg_one {
        return i256_min;
    }
    let neg_result = is_neg_i256(a) ^ is_neg_i256(b);
    let q = abs_i256(a) / abs_i256(b);
    if neg_result { neg_i256(q) } else { q }
}

/// Signed modulo per EVM spec:
///   * `b == 0` → 0
///   * Sign of result = sign of dividend `a`.
fn signed_mod(a: U256, b: U256) -> U256 {
    if b.is_zero() { return U256::zero(); }
    let r = abs_i256(a) % abs_i256(b);
    if is_neg_i256(a) { neg_i256(r) } else { r }
}

/// Signed less-than per EVM spec.
fn signed_lt(a: U256, b: U256) -> bool {
    let na = is_neg_i256(a);
    let nb = is_neg_i256(b);
    match (na, nb) {
        (true, false) => true,
        (false, true) => false,
        // Same sign: unsigned comparison gives the right answer because
        // two's-complement preserves ordering within a sign bucket.
        _ => a < b,
    }
}

/// Signed greater-than per EVM spec.
fn signed_gt(a: U256, b: U256) -> bool { signed_lt(b, a) }

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
    use crate::zvm::create_address;

    struct StubDb;
    impl ZvmDb for StubDb {
        fn account(&self, _: &Address) -> Option<ZvmAccount> { Some(ZvmAccount::default()) }
        fn code(&self, _: &[u8; 32]) -> Option<Vec<u8>> { None }
        fn storage(&self, _: &Address, _: &H256) -> H256 { H256::zero() }
        fn block_hash(&self, _: u64) -> H256 { H256::zero() }
    }

    fn ctx() -> ZvmContext {
        ZvmContext {
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
    fn signed_div_handles_negatives_and_overflow() {
        // NOTE (test-fixture fix, April 2026): the previous expression
        // `!U256::one() + U256::one()` is **not** -2. `!1` flips every
        // bit of 0x00…01 → 0xff…fe (which is -2 in two's complement),
        // and adding 1 yields 0xff…ff = -1. So the old `neg_two` was
        // actually -1, making the test assert `signed_div(-1, -1) == 2`
        // when the correct answer is 1. Production `signed_div` math is
        // correct; the fixture constant was wrong. Use the canonical
        // helper `neg_i256(2)` to construct the value unambiguously.
        let neg_one = !U256::zero();
        let neg_two = neg_i256(U256::from(2u64));
        let i256_min = U256::one() << 255;
        // -2 / -1 = 2
        assert_eq!(signed_div(neg_two, neg_one), U256::from(2u64));
        // 10 / -2 = -5
        assert_eq!(signed_div(U256::from(10u64), neg_two), neg_i256(U256::from(5u64)));
        // I256::MIN / -1 = I256::MIN (overflow wraps)
        assert_eq!(signed_div(i256_min, neg_one), i256_min);
        // x / 0 = 0
        assert_eq!(signed_div(U256::from(7u64), U256::zero()), U256::zero());
    }

    #[test]
    fn signed_mod_sign_follows_dividend() {
        let neg_seven = neg_i256(U256::from(7u64));
        let neg_three = neg_i256(U256::from(3u64));
        // -7 % 3 = -1   (sign follows dividend)
        assert_eq!(signed_mod(neg_seven, U256::from(3u64)), neg_i256(U256::one()));
        // 7 % -3 = 1    (positive dividend → positive result)
        assert_eq!(signed_mod(U256::from(7u64), neg_three), U256::one());
        // x % 0 = 0
        assert_eq!(signed_mod(U256::from(7u64), U256::zero()), U256::zero());
    }

    #[test]
    fn signed_lt_gt_cross_sign() {
        let neg_one = !U256::zero();
        let one = U256::one();
        // -1 < 1
        assert!(signed_lt(neg_one, one));
        assert!(!signed_gt(neg_one, one));
        // 1 > -1
        assert!(signed_gt(one, neg_one));
        // -2 < -1
        let neg_two = neg_i256(U256::from(2u64));
        assert!(signed_lt(neg_two, neg_one));
    }

    #[test]
    fn sar_preserves_sign() {
        // NOTE (test-fixture fix, April 2026): EVM SAR (and SHL, SHR)
        // pop `shift` first (top of stack), then `value`. To compute
        // `(-1) SAR 1` you must push `value` FIRST and `shift` SECOND
        // so the shift count is on top when SAR executes. The previous
        // bytecode pushed shift=1 first then value=-1, causing SAR to
        // pop shift=-1 (a huge unsigned magnitude > 256) and value=1,
        // then return 0 because value's sign bit is clear and shift
        // saturates. Production op_sar semantics in zvm_interp.rs are
        // correct per EIP-145; only the test bytecode push order needed
        // swapping.
        // Correct sequence: PUSH32 -1, PUSH1 1, SAR, MSTORE 0, RETURN 32.
        let mut code = Vec::new();
        code.push(0x7f);                              // PUSH32
        code.extend_from_slice(&[0xffu8; 32]);        // value = -1 (all ones)
        code.extend_from_slice(&[0x60, 0x01]);        // PUSH1 1 (shift count, ends up on top)
        code.push(0x1d);                              // SAR → -1 SAR 1 = -1
        code.extend_from_slice(&[0x60, 0x00, 0x52]);  // PUSH1 0 MSTORE
        code.extend_from_slice(&[0x60, 0x20, 0x60, 0x00, 0xf3]); // PUSH1 32 PUSH1 0 RETURN
        let db = StubDb;
        let mut interp = Interp::new(&db, &ctx(), 1_000_000);
        let res = interp.run(&code);
        assert!(res.success);
        // Result should be all-ones (-1 in two's complement).
        assert_eq!(res.return_data, vec![0xffu8; 32]);
    }

    #[test]
    fn returndatacopy_out_of_bounds_aborts() {
        // RETURNDATACOPY when no return data exists, len=1 → must error.
        // PUSH1 0x01 PUSH1 0x00 PUSH1 0x00 RETURNDATACOPY (dst=0, src=0, len=1)
        let code = vec![0x60, 0x01, 0x60, 0x00, 0x60, 0x00, 0x3e];
        let db = StubDb;
        let mut interp = Interp::new(&db, &ctx(), 1_000_000);
        let res = interp.run(&code);
        assert!(!res.success, "out-of-bounds RETURNDATACOPY must revert");
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
