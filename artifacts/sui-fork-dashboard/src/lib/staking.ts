// Bonded-PoS staking helpers — encode + sign + broadcast TxKind::Staking ops,
// plus thin wrappers around the chain's `zbx_getStaking*` RPC family.
//
// Wire format (must match zebvix-chain `staking::StakeOp` exactly):
//
//   body  = from(50) + to(50) + amount(16) + nonce(8) + fee(16) + chain_id(8)
//         + kind_tag(4 = 5)            ← TxKind::Staking
//         + stakeop_tag(4)             ← StakeOp variant index
//         + variant fields…
//
//   signed = body + pubkey-as-string(76) + 64-byte ECDSA(SHA-256(body))
//
// StakeOp variant indices (declared order in src/staking.rs):
//   0 CreateValidator { pubkey: [u8;33], commission_bps: u64, self_bond: u128 }
//   1 EditValidator   { validator: Address, new_commission_bps: Option<u64> }
//   2 Stake           { validator: Address, amount: u128 }
//   3 Unstake         { validator: Address, shares: u128 }
//   4 Redelegate      { from: Address, to: Address, shares: u128 }
//   5 ClaimRewards    { validator: Address }
//
// `body.amount` is refunded by state.rs for staking ops, so we always set it
// to 0. `body.to` is unused — we set it = body.from to satisfy the address
// validator (no special-case in the chain).

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  publicKeyFromSeed,
  addressFromPublic,
  parseNonce,
  zbxToWei,
} from "./web-wallet";
import { rpc } from "./zbx-rpc";

// ── Bincode primitives (mirror of payid.ts / web-wallet.ts) ────────────────

function u32Le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function u64Le(n: number | bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}

function u128Le(n: bigint): Uint8Array {
  if (n < 0n) throw new Error("u128 cannot be negative");
  const b = new Uint8Array(16);
  let x = n;
  for (let i = 0; i < 16; i++) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  if (x !== 0n) throw new Error("u128 overflow");
  return b;
}

function addrBincode(addr0x: string): Uint8Array {
  let s = addr0x.startsWith("0x") ? addr0x : "0x" + addr0x;
  s = s.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(s)) {
    throw new Error(`address must be 0x + 40 hex chars (got "${s}")`);
  }
  const utf = new TextEncoder().encode(s); // 42 bytes
  const out = new Uint8Array(8 + utf.length);
  out.set(u64Le(utf.length), 0);
  out.set(utf, 8);
  return out;
}

function pubkeyBincode(pub: Uint8Array): Uint8Array {
  if (pub.length !== 33) {
    throw new Error(`pubkey must be 33 bytes (got ${pub.length})`);
  }
  const hex = "0x" + bytesToHex(pub);
  const utf = new TextEncoder().encode(hex); // 68 bytes
  const out = new Uint8Array(8 + utf.length);
  out.set(u64Le(utf.length), 0);
  out.set(utf, 8);
  return out;
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// ── StakeOp variant tags (must mirror Rust enum declaration order) ─────────

const TX_KIND_STAKING = 5;

const STAKE_OP_CREATE_VALIDATOR = 0;
const STAKE_OP_EDIT_VALIDATOR = 1;
const STAKE_OP_STAKE = 2;
const STAKE_OP_UNSTAKE = 3;
const STAKE_OP_REDELEGATE = 4;
const STAKE_OP_CLAIM_REWARDS = 5;

// ── Body encoders ──────────────────────────────────────────────────────────

interface BodyHeader {
  from: string;       // signer (delegator) address
  feeWei: bigint;
  nonce: number | bigint;
  chainId: number | bigint;
}

/** Common 156-byte prefix for every staking tx. */
function header(opts: BodyHeader): Uint8Array {
  return concat(
    addrBincode(opts.from),       // 50  from
    addrBincode(opts.from),       // 50  to == from (placeholder)
    u128Le(0n),                   // 16  amount = 0 (refunded by chain)
    u64Le(opts.nonce),            //  8  nonce
    u128Le(opts.feeWei),          // 16  fee
    u64Le(opts.chainId),          //  8  chain_id
    u32Le(TX_KIND_STAKING),       //  4  TxKind tag
  );
}

export function encodeStakeBody(opts: BodyHeader & {
  validator: string;
  amountWei: bigint;
}): Uint8Array {
  return concat(
    header(opts),
    u32Le(STAKE_OP_STAKE),        //  4  StakeOp::Stake
    addrBincode(opts.validator),  // 50
    u128Le(opts.amountWei),       // 16
  );
}

export function encodeUnstakeBody(opts: BodyHeader & {
  validator: string;
  shares: bigint;
}): Uint8Array {
  return concat(
    header(opts),
    u32Le(STAKE_OP_UNSTAKE),
    addrBincode(opts.validator),
    u128Le(opts.shares),
  );
}

export function encodeRedelegateBody(opts: BodyHeader & {
  fromValidator: string;
  toValidator: string;
  shares: bigint;
}): Uint8Array {
  return concat(
    header(opts),
    u32Le(STAKE_OP_REDELEGATE),
    addrBincode(opts.fromValidator),
    addrBincode(opts.toValidator),
    u128Le(opts.shares),
  );
}

export function encodeClaimRewardsBody(opts: BodyHeader & {
  validator: string;
}): Uint8Array {
  return concat(
    header(opts),
    u32Le(STAKE_OP_CLAIM_REWARDS),
    addrBincode(opts.validator),
  );
}

export function encodeEditValidatorBody(opts: BodyHeader & {
  validator: string;
  newCommissionBps: number | null;   // null = None
}): Uint8Array {
  // Option<u64>: 1 byte tag (0 = None, 1 = Some) then u64 LE if Some.
  let optionBytes: Uint8Array;
  if (opts.newCommissionBps === null) {
    optionBytes = new Uint8Array([0]);
  } else {
    optionBytes = concat(new Uint8Array([1]), u64Le(opts.newCommissionBps));
  }
  return concat(
    header(opts),
    u32Le(STAKE_OP_EDIT_VALIDATOR),
    addrBincode(opts.validator),
    optionBytes,
  );
}

// CreateValidator is operator-only and rarely used from a delegator UI;
// we still expose the encoder so dashboards can offer it later.
export function encodeCreateValidatorBody(opts: BodyHeader & {
  pubkey: Uint8Array;        // 33-byte compressed
  commissionBps: number;
  selfBondWei: bigint;
}): Uint8Array {
  return concat(
    header(opts),
    u32Le(STAKE_OP_CREATE_VALIDATOR),
    pubkeyBincode(opts.pubkey),
    u64Le(opts.commissionBps),
    u128Le(opts.selfBondWei),
  );
}

// ── Sign + broadcast ────────────────────────────────────────────────────────

export interface StakingResult { hash: string; }

/** Lower-level: sign an arbitrary already-encoded body and broadcast it. */
async function signAndSend(privateKeyHex: string, body: Uint8Array): Promise<StakingResult> {
  const seedHex = privateKeyHex.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("private key must be 64 hex chars");
  }
  const seed = hexToBytes(seedHex);
  const pub = publicKeyFromSeed(seed);
  // @noble/curves v1.2 sign() defaults to prehash:true → it SHA-256s the
  // input itself, matching Rust k256 SigningKey::sign(msg) byte-for-byte.
  const sig = secp256k1.sign(body, seed, { lowS: true });
  const signed = concat(body, pubkeyBincode(pub), sig);
  const hexHex = "0x" + bytesToHex(signed);
  const res = await rpc<string>("zbx_sendRawTransaction", [hexHex]);
  return { hash: typeof res === "string" ? res : "" };
}

interface CommonOpts {
  privateKeyHex: string;
  feeZbx?: string | number;
  chainId?: number;
}

async function withHeader<T extends object>(
  opts: CommonOpts,
  build: (h: BodyHeader, from: string) => Uint8Array,
): Promise<{ result: StakingResult; from: string }> {
  const seedHex = opts.privateKeyHex.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("private key must be 64 hex chars");
  }
  const seed = hexToBytes(seedHex);
  const pub = publicKeyFromSeed(seed);
  const from = addressFromPublic(pub);
  const nonceRaw = (await rpc<unknown>("zbx_getNonce", [from])) as number | string;
  const nonce = parseNonce(nonceRaw);
  const chainId = opts.chainId ?? 7878;
  const feeWei = zbxToWei(opts.feeZbx ?? "0.002");
  const body = build({ from, feeWei, nonce, chainId }, from);
  const result = await signAndSend(opts.privateKeyHex, body);
  return { result, from };
}

export async function sendStake(opts: CommonOpts & {
  validator: string;
  amountZbx: string | number;
}): Promise<StakingResult> {
  const amountWei = zbxToWei(opts.amountZbx);
  const { result } = await withHeader(opts, (h) =>
    encodeStakeBody({ ...h, validator: opts.validator, amountWei }),
  );
  return result;
}

export async function sendUnstake(opts: CommonOpts & {
  validator: string;
  shares: bigint;          // raw share count from getDelegation
}): Promise<StakingResult> {
  const { result } = await withHeader(opts, (h) =>
    encodeUnstakeBody({ ...h, validator: opts.validator, shares: opts.shares }),
  );
  return result;
}

export async function sendRedelegate(opts: CommonOpts & {
  fromValidator: string;
  toValidator: string;
  shares: bigint;
}): Promise<StakingResult> {
  const { result } = await withHeader(opts, (h) =>
    encodeRedelegateBody({
      ...h,
      fromValidator: opts.fromValidator,
      toValidator: opts.toValidator,
      shares: opts.shares,
    }),
  );
  return result;
}

export async function sendClaimRewards(opts: CommonOpts & {
  validator: string;
}): Promise<StakingResult> {
  const { result } = await withHeader(opts, (h) =>
    encodeClaimRewardsBody({ ...h, validator: opts.validator }),
  );
  return result;
}

// ── Read-only RPC helpers ──────────────────────────────────────────────────

export interface StakingValidatorInfo {
  address: string;
  operator: string;
  pubkey: string;
  total_stake_wei: string;     // u128 as decimal string
  total_shares: string;
  commission_bps: number;
  commission_pool_wei: string;
  jailed: boolean;
  jailed_until_epoch: number;
}

export interface StakingOverview {
  current_epoch: number;
  epoch_blocks: number;
  epoch_reward_wei: string;
  unbonding_epochs: number;
  min_self_bond_wei: string;
  min_delegation_wei: string;
  max_commission_bps: number;
  validator_count: number;
  delegation_count: number;
  unbonding_count: number;
  validators: StakingValidatorInfo[];
  unbonding_queue: Array<{
    delegator: string;
    validator: string;
    amount_wei: string;
    mature_at_epoch: number;
  }>;
  active_set: Array<{ address: string; voting_power: number }>;
}

/** GET full staking module snapshot — every validator + module-level stats. */
export async function getStakingOverview(): Promise<StakingOverview> {
  const r = await rpc<StakingOverview>("zbx_getStaking");
  return r;
}

export interface DelegationInfo {
  delegator?: string;
  validator: string;
  shares: string;          // decimal u128
  value_wei: string;       // shares converted to current wei value (live)
}

/** All delegations made BY a given delegator address.
 * Errors propagate so the caller can surface them — pages should not silently
 * treat a network failure as "no delegations". */
export async function getMyDelegations(delegator: string): Promise<DelegationInfo[]> {
  const r = await rpc<{ delegations: DelegationInfo[] }>(
    "zbx_getDelegationsByDelegator",
    [delegator],
  );
  return r?.delegations ?? [];
}

/** Lookup a single delegation row. Returns null when shares == 0. */
export async function getDelegation(
  delegator: string,
  validator: string,
): Promise<DelegationInfo | null> {
  try {
    const r = await rpc<DelegationInfo | null>("zbx_getDelegation", [delegator, validator]);
    if (!r) return null;
    if (BigInt(r.shares || "0") === 0n) return null;
    return r;
  } catch {
    return null;
  }
}

export interface LockedRewardsInfo {
  address: string;
  balance_wei: string;
  total_released: string;
  total_locked_lifetime: string;
  daily_drip_wei?: string;
  stake_wei?: string;
}

/** Drip + bulk locked-rewards bucket for an address (Phase B.5). */
export async function getLockedRewards(addr: string): Promise<LockedRewardsInfo | null> {
  try {
    const r = await rpc<LockedRewardsInfo>("zbx_getLockedRewards", [addr]);
    return r;
  } catch {
    return null;
  }
}

// ── Display helpers ────────────────────────────────────────────────────────

const ZBX_DECIMALS = 18n;

/** Convert a decimal-string wei amount to a human-readable ZBX number. */
export function weiStrToZbx(wei: string | bigint, dp = 4): string {
  const w = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  const whole = w / 10n ** ZBX_DECIMALS;
  const frac = w % 10n ** ZBX_DECIMALS;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(18, "0").slice(0, dp).replace(/0+$/, "");
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

/** Format basis-points as a percentage string with one decimal. */
export function bpsToPct(bps: number | string): string {
  const n = typeof bps === "string" ? Number(bps) : bps;
  return `${(n / 100).toFixed(2)}%`;
}
