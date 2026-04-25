// User-token helpers — encode + sign + broadcast TxKind::Token{Create,Transfer,Mint,Burn},
// plus thin wrappers around the chain's `zbx_token*` / `zbx_listTokens` RPC family.
//
// Wire format (must match zebvix-chain `transaction.rs::TxKind` exactly):
//
//   body = from(50) + to(50) + amount(16) + nonce(8) + fee(16) + chain_id(8)
//        + kind_tag(4)              ← 11 / 12 / 13 / 14
//        + variant fields…
//
//   signed = body + pubkey-as-string(76) + 64-byte ECDSA(SHA-256(body))
//
// TxKind tag indices (declared order in src/transaction.rs):
//   11 TokenCreate   { name: String, symbol: String, decimals: u8, initial_supply: u128 }
//   12 TokenTransfer { token_id: u64, to: Address, amount: u128 }
//   13 TokenMint     { token_id: u64, to: Address, amount: u128 }   (creator-only)
//   14 TokenBurn     { token_id: u64, amount: u128 }
//
// Bincode default config:
//   * String  → 8-byte LE length prefix + UTF-8 bytes (no trailing null)
//   * u8      → 1 byte
//   * u64     → 8 bytes LE
//   * u128    → 16 bytes LE
//   * Address → 8-byte LE length (=42) + "0x"+40hex UTF-8 (50 bytes total)
//
// All variants set `body.amount = 0` and `body.to = body.from`; the chain
// refunds `body.amount` and ignores `body.to` for every Token* arm.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  publicKeyFromSeed,
  addressFromPublic,
  parseNonce,
  zbxToWei,
} from "./web-wallet";
import { rpc } from "./zbx-rpc";

// ── Bincode primitives ─────────────────────────────────────────────────────

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

function strBincode(s: string): Uint8Array {
  const utf = new TextEncoder().encode(s);
  const out = new Uint8Array(8 + utf.length);
  out.set(u64Le(utf.length), 0);
  out.set(utf, 8);
  return out;
}

function addrBincode(addr0x: string): Uint8Array {
  let s = addr0x.startsWith("0x") ? addr0x : "0x" + addr0x;
  s = s.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(s)) {
    throw new Error(`address must be 0x + 40 hex chars (got "${s}")`);
  }
  const utf = new TextEncoder().encode(s);
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
  const utf = new TextEncoder().encode(hex);
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

// ── TxKind tags ────────────────────────────────────────────────────────────

const TX_KIND_TOKEN_CREATE = 11;
const TX_KIND_TOKEN_TRANSFER = 12;
const TX_KIND_TOKEN_MINT = 13;
const TX_KIND_TOKEN_BURN = 14;

interface BodyHeader {
  from: string;
  feeWei: bigint;
  nonce: number | bigint;
  chainId: number | bigint;
}

function header(opts: BodyHeader, kindTag: number): Uint8Array {
  return concat(
    addrBincode(opts.from),       // 50  from (signer)
    addrBincode(opts.from),       // 50  to == from (placeholder; refunded)
    u128Le(0n),                   // 16  amount = 0 (refunded)
    u64Le(opts.nonce),            //  8  nonce
    u128Le(opts.feeWei),          // 16  fee in ZBX wei
    u64Le(opts.chainId),          //  8  chain_id
    u32Le(kindTag),               //  4  TxKind tag
  );
}

// ── Body encoders ──────────────────────────────────────────────────────────

export function encodeTokenCreateBody(opts: BodyHeader & {
  name: string;
  symbol: string;
  decimals: number;
  initialSupplyBase: bigint; // base units (already scaled by 10^decimals)
}): Uint8Array {
  return concat(
    header(opts, TX_KIND_TOKEN_CREATE),
    strBincode(opts.name),
    strBincode(opts.symbol),
    new Uint8Array([opts.decimals & 0xff]),  // u8
    u128Le(opts.initialSupplyBase),
  );
}

export function encodeTokenTransferBody(opts: BodyHeader & {
  tokenId: number | bigint;
  to: string;
  amountBase: bigint;
}): Uint8Array {
  return concat(
    header(opts, TX_KIND_TOKEN_TRANSFER),
    u64Le(opts.tokenId),
    addrBincode(opts.to),
    u128Le(opts.amountBase),
  );
}

export function encodeTokenMintBody(opts: BodyHeader & {
  tokenId: number | bigint;
  to: string;
  amountBase: bigint;
}): Uint8Array {
  return concat(
    header(opts, TX_KIND_TOKEN_MINT),
    u64Le(opts.tokenId),
    addrBincode(opts.to),
    u128Le(opts.amountBase),
  );
}

export function encodeTokenBurnBody(opts: BodyHeader & {
  tokenId: number | bigint;
  amountBase: bigint;
}): Uint8Array {
  return concat(
    header(opts, TX_KIND_TOKEN_BURN),
    u64Le(opts.tokenId),
    u128Le(opts.amountBase),
  );
}

// ── Sign + broadcast ──────────────────────────────────────────────────────

export interface TokenTxResult { hash: string; }

async function signAndSend(privateKeyHex: string, body: Uint8Array): Promise<TokenTxResult> {
  const seedHex = privateKeyHex.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("private key must be 64 hex chars");
  }
  const seed = hexToBytes(seedHex);
  const pub = publicKeyFromSeed(seed);
  // @noble/curves v1.2 sign() defaults to prehash:true — SHA-256s the input
  // itself, matching Rust k256 SigningKey::sign(msg) byte-for-byte.
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

async function buildAndSend(
  opts: CommonOpts,
  build: (h: BodyHeader) => Uint8Array,
): Promise<TokenTxResult> {
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
  const body = build({ from, feeWei, nonce, chainId });
  return signAndSend(opts.privateKeyHex, body);
}

export async function sendTokenCreate(opts: CommonOpts & {
  name: string;
  symbol: string;
  decimals: number;
  /** Initial supply in DISPLAY units (e.g. "1000000" for one million tokens).
   * Will be scaled by 10^decimals automatically. */
  initialSupplyDisplay: string | number;
}): Promise<TokenTxResult> {
  const initialSupplyBase = displayToBase(opts.initialSupplyDisplay, opts.decimals);
  return buildAndSend(opts, (h) =>
    encodeTokenCreateBody({
      ...h,
      name: opts.name,
      symbol: opts.symbol,
      decimals: opts.decimals,
      initialSupplyBase,
    }),
  );
}

export async function sendTokenTransfer(opts: CommonOpts & {
  tokenId: number;
  to: string;
  amountDisplay: string | number;
  decimals: number;
}): Promise<TokenTxResult> {
  const amountBase = displayToBase(opts.amountDisplay, opts.decimals);
  return buildAndSend(opts, (h) =>
    encodeTokenTransferBody({ ...h, tokenId: opts.tokenId, to: opts.to, amountBase }),
  );
}

export async function sendTokenMint(opts: CommonOpts & {
  tokenId: number;
  to: string;
  amountDisplay: string | number;
  decimals: number;
}): Promise<TokenTxResult> {
  const amountBase = displayToBase(opts.amountDisplay, opts.decimals);
  return buildAndSend(opts, (h) =>
    encodeTokenMintBody({ ...h, tokenId: opts.tokenId, to: opts.to, amountBase }),
  );
}

export async function sendTokenBurn(opts: CommonOpts & {
  tokenId: number;
  amountDisplay: string | number;
  decimals: number;
}): Promise<TokenTxResult> {
  const amountBase = displayToBase(opts.amountDisplay, opts.decimals);
  return buildAndSend(opts, (h) =>
    encodeTokenBurnBody({ ...h, tokenId: opts.tokenId, amountBase }),
  );
}

// ── Read-only RPC ──────────────────────────────────────────────────────────

export interface TokenInfo {
  id: number;
  creator: string;
  name: string;
  symbol: string;
  decimals: number;
  total_supply: string;        // base-unit decimal string
  total_supply_hex: string;
  created_at_height: number;
}

export interface TokenListResp {
  total: number;
  offset: number;
  limit: number;
  tokens: TokenInfo[];
}

export async function listTokens(offset = 0, limit = 50): Promise<TokenListResp> {
  return rpc<TokenListResp>("zbx_listTokens", [offset, limit]);
}

export async function getTokenInfo(id: number): Promise<TokenInfo | null> {
  try {
    return await rpc<TokenInfo>("zbx_tokenInfo", [id]);
  } catch {
    return null;
  }
}

/** Look up a token by symbol (case-insensitive on the chain). Returns null
 *  when the symbol is free — used by the create form for live availability. */
export async function getTokenBySymbol(symbol: string): Promise<TokenInfo | null> {
  try {
    return await rpc<TokenInfo>("zbx_tokenInfoBySymbol", [symbol]);
  } catch (e) {
    // The chain returns -32004 "token not found" for free symbols; we want
    // that to surface as `null`, not as a thrown error.
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found|-32004/i.test(msg)) return null;
    throw e;
  }
}

export interface TokenBalanceResp {
  token_id: number;
  address: string;
  balance: string;
  balance_hex: string;
}

export async function getTokenBalance(tokenId: number, addr: string): Promise<TokenBalanceResp> {
  return rpc<TokenBalanceResp>("zbx_tokenBalanceOf", [tokenId, addr]);
}

export async function getTokenCount(): Promise<number> {
  const r = await rpc<{ total: number }>("zbx_tokenCount", []);
  return r?.total ?? 0;
}

// ── Display helpers ────────────────────────────────────────────────────────

/** Convert a human-readable amount ("1000000" or "1.5") to base units using
 *  the token's `decimals`. Throws on overflow or invalid syntax. */
export function displayToBase(amount: string | number, decimals: number): bigint {
  if (decimals < 0 || decimals > 18) {
    throw new Error(`decimals must be 0..=18 (got ${decimals})`);
  }
  const s = String(amount).trim();
  if (!s) throw new Error("amount is empty");
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`amount must be a positive decimal number (got "${s}")`);
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    throw new Error(
      `amount has ${frac.length} decimal places but token only allows ${decimals}`,
    );
  }
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = (whole + fracPadded).replace(/^0+/, "") || "0";
  const result = BigInt(combined);
  // u128 max
  if (result > (1n << 128n) - 1n) throw new Error("amount overflows u128");
  return result;
}

/** Convert base units back to a display string with up to `decimals` digits. */
export function baseToDisplay(base: string | bigint, decimals: number, maxDp = 6): string {
  const b = typeof base === "bigint" ? base : BigInt(base || "0");
  if (decimals === 0) return b.toLocaleString();
  const div = 10n ** BigInt(decimals);
  const whole = b / div;
  const frac = b % div;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, Math.min(maxDp, decimals))
    .replace(/0+$/, "");
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

// On-chain constants (mirror of zebvix-chain/src/tokenomics.rs).
export const TOKEN_NAME_MAX_LEN = 50;
export const TOKEN_SYMBOL_MIN_LEN = 2;
export const TOKEN_SYMBOL_MAX_LEN = 10;
export const TOKEN_MAX_DECIMALS = 18;
/** 100 ZBX one-time burn paid on every successful TokenCreate. */
export const TOKEN_CREATION_BURN_WEI = 100n * 10n ** 18n;
