// ─────────────────────────────────────────────────────────────────────────────
// Bridge tx encoder + signer — TxKind::Bridge(BridgeOp::BridgeOut).
//
// Layout MUST mirror Rust enum declaration order:
//   transaction.rs::TxKind discriminator: Bridge = 9
//   bridge.rs::BridgeOp discriminator:    BridgeOut = 4
//
// Body shape (variable length):
//   from(50) + to=from(50) + amount(16) + nonce(8) + fee(16) + chain_id(8)
//   + tx_kind_tag(4 = 9)
//   + bridge_op_tag(4 = 4)        <-- BridgeOut
//   + asset_id(8)
//   + dest_address: bincode-string (8-byte LE length + UTF-8 bytes)
//
// Then: signed = body || pubkey-bincode(76) || secp256k1-sig(64).
//
// `body.amount` carries the LOCK amount (debited from sender, credited into
// the on-chain bridge_lock_addr escrow). For ZBX-native assets this is wei
// (18 decimals). `dest_address` is validated server-side per network kind.
// ─────────────────────────────────────────────────────────────────────────────

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { rpc, getRecommendedFeeWei } from "./zbx-rpc";
import {
  publicKeyFromSeed,
  addressFromPublic,
  parseNonce,
  zbxToWei,
} from "./web-wallet";

// ── Tiny binary helpers (mirror lib/web-wallet.ts) ─────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const s = hex.replace(/^0x/i, "");
  if (s.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bs: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bs.length; i++) {
    s += bs[i].toString(16).padStart(2, "0");
  }
  return s;
}

function u32Le(n: number): Uint8Array {
  const v = new DataView(new ArrayBuffer(4));
  v.setUint32(0, n >>> 0, true);
  return new Uint8Array(v.buffer);
}

function u64Le(n: number | bigint): Uint8Array {
  const big = typeof n === "bigint" ? n : BigInt(n);
  const v = new DataView(new ArrayBuffer(8));
  v.setBigUint64(0, big, true);
  return new Uint8Array(v.buffer);
}

const U128_MAX = (1n << 128n) - 1n;

function u128Le(n: bigint): Uint8Array {
  if (n < 0n) throw new Error(`u128Le: value ${n} is negative`);
  if (n > U128_MAX) throw new Error(`u128Le: value ${n} overflows u128`);
  const out = new Uint8Array(16);
  let x = n;
  for (let i = 0; i < 16; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
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

/** bincode default encodes Vec<u8> / String as: u64-LE length + raw bytes. */
function strBincode(s: string): Uint8Array {
  const utf = new TextEncoder().encode(s);
  const out = new Uint8Array(8 + utf.length);
  out.set(u64Le(utf.length), 0);
  out.set(utf, 8);
  return out;
}

/** Address is bincode-serialized as the 0x-prefixed hex string (42 bytes). */
function addrBincode(addr0x: string): Uint8Array {
  const a = addr0x.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) {
    throw new Error(`bad address: ${addr0x}`);
  }
  const utf = new TextEncoder().encode(a); // 42 bytes
  const out = new Uint8Array(8 + utf.length);
  out.set(u64Le(utf.length), 0);
  out.set(utf, 8);
  return out;
}

/** Compressed-pubkey bincode encoding: 8-byte LE length + 66 hex chars. */
function pubkeyBincode(pub: Uint8Array): Uint8Array {
  const hex = "0x" + bytesToHex(pub);
  const utf = new TextEncoder().encode(hex); // 68 bytes
  const out = new Uint8Array(8 + utf.length);
  out.set(u64Le(utf.length), 0);
  out.set(utf, 8);
  return out;
}

// ── Tag constants ──────────────────────────────────────────────────────────

const TX_KIND_BRIDGE = 9;
const BRIDGE_OP_BRIDGE_OUT = 4;

// ── Body encoder ───────────────────────────────────────────────────────────

export interface EncodeBridgeOutOpts {
  from: string;
  amountWei: bigint;
  feeWei: bigint;
  nonce: number | bigint;
  chainId: number | bigint;
  assetId: bigint;
  destAddress: string;
}

export function encodeBridgeOutBody(opts: EncodeBridgeOutOpts): Uint8Array {
  return concat(
    addrBincode(opts.from),                  // 50  from
    addrBincode(opts.from),                  // 50  to == from (placeholder)
    u128Le(opts.amountWei),                  // 16  AMOUNT TO LOCK
    u64Le(opts.nonce),                       //  8
    u128Le(opts.feeWei),                     // 16
    u64Le(opts.chainId),                     //  8
    u32Le(TX_KIND_BRIDGE),                   //  4  TxKind::Bridge
    u32Le(BRIDGE_OP_BRIDGE_OUT),             //  4  BridgeOp::BridgeOut
    u64Le(opts.assetId),                     //  8  asset_id
    strBincode(opts.destAddress),            //  8 + N
  );
}

// ── High-level sign + broadcast ────────────────────────────────────────────

export interface BridgeOutResult {
  hash: string;
  from: string;
  /** Lock amount in the asset's smallest native unit (e.g. 18 dec for ZBX, 6 for zUSD). */
  amountWei: bigint;
  /** The asset's native decimals — caller uses this to format `amountWei` for display. */
  assetDecimals: number;
  destAddress: string;
  assetId: bigint;
}

/**
 * Convert a human-readable decimal string ("5.0", "0.0001") into the asset's
 * smallest native unit, given its decimals (ZBX = 18, zUSD = 6, etc).
 *
 * Throws on bad input. Truncation > `decimals` is rejected (no silent loss).
 */
export function amountToBaseUnits(
  amount: string | number,
  decimals: number,
): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`bad asset decimals: ${decimals}`);
  }
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`invalid amount "${amount}"`);
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    throw new Error(
      `too many decimal places (max ${decimals} for this asset, got ${frac.length})`,
    );
  }
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

/**
 * Sign and submit a TxKind::Bridge(BridgeOut { asset_id, dest_address }) tx.
 *
 * Trustless from the user side: the sender locally signs with their own
 * private key and broadcasts the raw signed bincode envelope via
 * `zbx_sendRawTransaction`. The node only verifies the secp256k1 signature
 * and applies the lock atomically. No admin / oracle is involved on the
 * outbound (lock) leg — that's the decentralized half.
 */
export async function sendBridgeOut(opts: {
  privateKeyHex: string;
  assetId: string | number | bigint;
  /** Human-readable amount in the asset's native units (e.g. "5.0" ZBX, "100.5" zUSD). */
  amount: string | number;
  /**
   * Decimals of the SELECTED bridge asset (ZBX = 18, zUSD = 6). Required —
   * otherwise the chain receives a wrongly scaled lock amount.
   */
  assetDecimals: number;
  destAddress: string;
  feeZbx?: string | number;       // default → chain-recommended floor (ZBX, 18 dec)
  chainId?: number;               // default 7878
}): Promise<BridgeOutResult> {
  const seedHex = opts.privateKeyHex.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("private key must be 64 hex chars");
  }
  const dest = opts.destAddress.trim();
  if (!dest) throw new Error("destination address required");
  if (dest.length > 128) throw new Error("destination address > 128 chars");

  const seed = hexToBytes(seedHex);
  const pub = publicKeyFromSeed(seed);
  const from = addressFromPublic(pub);

  const nonceRaw = (await rpc<unknown>("zbx_getNonce", [from])) as
    | number | string;
  const nonce = parseNonce(nonceRaw);

  const chainId = opts.chainId ?? 7878;
  // Fee is always paid in ZBX native (18 dec), regardless of bridged asset.
  const feeWei = opts.feeZbx !== undefined
    ? zbxToWei(opts.feeZbx)
    : await getRecommendedFeeWei();

  const amountWei = amountToBaseUnits(opts.amount, opts.assetDecimals);
  if (amountWei <= 0n) throw new Error("amount must be > 0");

  const assetId = typeof opts.assetId === "bigint"
    ? opts.assetId
    : BigInt(opts.assetId);

  const body = encodeBridgeOutBody({
    from, amountWei, feeWei, nonce, chainId, assetId, destAddress: dest,
  });

  // secp256k1 — chain side hashes with SHA-256 internally; @noble/curves
  // also pre-hashes by default, so we pass the raw body. lowS-normalized.
  const sig = secp256k1.sign(body, seed, { lowS: true });
  const signed = concat(body, pubkeyBincode(pub), sig);
  const hexHex = "0x" + bytesToHex(signed);

  const res = await rpc<string>("zbx_sendRawTransaction", [hexHex]);
  return {
    hash: typeof res === "string" ? res : "",
    from,
    amountWei,
    assetDecimals: opts.assetDecimals,
    destAddress: dest,
    assetId,
  };
}

// ── Read-side helpers (used by the live page) ──────────────────────────────

export interface BridgeStats {
  networks_count: number;
  assets_count: number;
  active_networks: number;
  active_assets: number;
  locked_zbx_wei: string;
  locked_zusd: string;
  out_events_total: number;
  claims_used: number;
  lock_address: string;
}

export interface BridgeAsset {
  asset_id: string;
  network_id: number;
  native: string;
  native_decimals: number;
  contract: string;
  decimals: number;
  active: boolean;
  registered_height: number;
}

export interface BridgeNetwork {
  id: number;
  name: string;
  kind: string;
  active: boolean;
  registered_height: number;
}

export interface BridgeOutEvent {
  seq: number;
  asset_id: string;
  native_symbol: string;
  from: string;
  dest_address: string;
  amount: string;
  height: number;
  tx_hash: string;
}

export async function getBridgeStats(): Promise<BridgeStats> {
  return rpc<BridgeStats>("zbx_bridgeStats", []);
}

export async function listBridgeAssets(): Promise<BridgeAsset[]> {
  const res = await rpc<{ count: number; assets: BridgeAsset[] }>(
    "zbx_listBridgeAssets",
    [],
  );
  return res?.assets ?? [];
}

export async function listBridgeNetworks(): Promise<BridgeNetwork[]> {
  const res = await rpc<{ count: number; networks: BridgeNetwork[] }>(
    "zbx_listBridgeNetworks",
    [],
  );
  return res?.networks ?? [];
}

export async function recentBridgeOutEvents(
  limit = 50,
): Promise<{ returned: number; total: number; events: BridgeOutEvent[] }> {
  return rpc<{ returned: number; total: number; events: BridgeOutEvent[] }>(
    "zbx_recentBridgeOutEvents",
    [limit],
  );
}
