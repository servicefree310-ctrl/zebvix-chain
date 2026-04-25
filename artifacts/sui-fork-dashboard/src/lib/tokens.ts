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
import { rpc, getRecommendedFeeWei } from "./zbx-rpc";

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
  // Use chain-recommended fee when caller didn't override — guarantees we
  // clear the AMM-pegged dynamic floor enforced inside `apply_tx`.
  const feeWei = opts.feeZbx !== undefined
    ? zbxToWei(opts.feeZbx)
    : await getRecommendedFeeWei();
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
  /** Formal token-class label, e.g. "ZBX-20" for fungible. Optional for
   *  forward-compat with chain nodes that predate this field — UI should
   *  fall back to "ZBX-20" when missing/empty. */
  standard?: string;
  /** Phase G — on-chain metadata (logo, website, socials). `null` when
   *  the creator hasn't set any metadata yet, or `undefined` when talking
   *  to a pre-Phase-G chain node (forward-compat). */
  metadata?: TokenMetadata | null;
}

/** Phase G — token metadata stored on-chain by `TokenSetMetadata` (kind 19).
 *  All string fields default to "" when unset. `unset: true` is added by
 *  `zbx_getTokenMetadata` when the creator has never set metadata so the UI
 *  can show "not set" without an extra round-trip. */
export interface TokenMetadata {
  token_id: number;
  logo_url: string;
  website: string;
  description: string;
  twitter: string;
  telegram: string;
  discord: string;
  updated_at_height: number;
  unset?: boolean;
}

/** UI helper — never let a missing/empty `standard` leak as an empty badge. */
export function tokenStandard(t: Pick<TokenInfo, "standard"> | null | undefined): string {
  const s = (t?.standard ?? "").trim();
  return s || "ZBX-20";
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
/** Anti-spam burn for TokenCreate. Currently 0 — gas-only. Mirrors
 *  `tokenomics::TOKEN_CREATION_BURN_WEI` on the chain. */
export const TOKEN_CREATION_BURN_WEI = 0n;

// ─────────────────────────────────────────────────────────────────────────────
// Phase F — Per-token AMM pool (Uniswap V2 style, ZBX-quoted)
//
// Wire format additions to TxKind (consensus order — see chain transaction.rs):
//   15 TokenPoolCreate          { token_id: u64, zbx_amount: u128, token_amount: u128 }
//   16 TokenPoolAddLiquidity    { token_id: u64, zbx_amount: u128, max_token_amount: u128, min_lp_out: u128 }
//   17 TokenPoolRemoveLiquidity { token_id: u64, lp_burn: u128, min_zbx_out: u128, min_token_out: u128 }
//   18 TokenPoolSwap            { token_id: u64, direction: TokenSwapDirection (u32 LE tag),
//                                 amount_in: u128, min_out: u128 }
//
// TokenSwapDirection bincode encoding (enum, no payload):
//   ZbxToToken → 4-byte LE u32 = 0
//   TokenToZbx → 4-byte LE u32 = 1
//
// Pool constants (mirror token_pool.rs):
export const TX_KIND_TOKEN_POOL_CREATE = 15;
export const TX_KIND_TOKEN_POOL_ADD_LIQUIDITY = 16;
export const TX_KIND_TOKEN_POOL_REMOVE_LIQUIDITY = 17;
export const TX_KIND_TOKEN_POOL_SWAP = 18;

export const TOKEN_POOL_FEE_BPS_NUM = 30n;     // 0.3%
export const TOKEN_POOL_FEE_BPS_DEN = 10_000n;
export const MIN_TOKEN_POOL_LIQUIDITY = 1_000n;

export type TokenSwapDirectionStr = "zbx_to_token" | "token_to_zbx";

function swapDirTag(d: TokenSwapDirectionStr): number {
  return d === "zbx_to_token" ? 0 : 1;
}

// ── Pool body encoders ────────────────────────────────────────────────────

export function encodeTokenPoolCreateBody(opts: BodyHeader & {
  tokenId: number | bigint;
  zbxAmountWei: bigint;
  tokenAmountBase: bigint;
}): Uint8Array {
  return concat(
    header(opts, TX_KIND_TOKEN_POOL_CREATE),
    u64Le(opts.tokenId),
    u128Le(opts.zbxAmountWei),
    u128Le(opts.tokenAmountBase),
  );
}

export function encodeTokenPoolAddLiquidityBody(opts: BodyHeader & {
  tokenId: number | bigint;
  zbxAmountWei: bigint;
  maxTokenAmountBase: bigint;
  minLpOut: bigint;
}): Uint8Array {
  return concat(
    header(opts, TX_KIND_TOKEN_POOL_ADD_LIQUIDITY),
    u64Le(opts.tokenId),
    u128Le(opts.zbxAmountWei),
    u128Le(opts.maxTokenAmountBase),
    u128Le(opts.minLpOut),
  );
}

export function encodeTokenPoolRemoveLiquidityBody(opts: BodyHeader & {
  tokenId: number | bigint;
  lpBurn: bigint;
  minZbxOutWei: bigint;
  minTokenOutBase: bigint;
}): Uint8Array {
  return concat(
    header(opts, TX_KIND_TOKEN_POOL_REMOVE_LIQUIDITY),
    u64Le(opts.tokenId),
    u128Le(opts.lpBurn),
    u128Le(opts.minZbxOutWei),
    u128Le(opts.minTokenOutBase),
  );
}

export function encodeTokenPoolSwapBody(opts: BodyHeader & {
  tokenId: number | bigint;
  direction: TokenSwapDirectionStr;
  amountIn: bigint;
  minOut: bigint;
}): Uint8Array {
  return concat(
    header(opts, TX_KIND_TOKEN_POOL_SWAP),
    u64Le(opts.tokenId),
    u32Le(swapDirTag(opts.direction)),  // bincode enum tag (no payload)
    u128Le(opts.amountIn),
    u128Le(opts.minOut),
  );
}

// ── Pool senders (sign + broadcast) ───────────────────────────────────────

export async function sendTokenPoolCreate(opts: CommonOpts & {
  tokenId: number;
  zbxAmount: string | number;       // display ZBX (e.g. "100" → 100 ZBX wei)
  tokenAmountDisplay: string | number;
  tokenDecimals: number;
}): Promise<TokenTxResult> {
  const zbxAmountWei = zbxToWei(opts.zbxAmount);
  const tokenAmountBase = displayToBase(opts.tokenAmountDisplay, opts.tokenDecimals);
  return buildAndSend(opts, (h) =>
    encodeTokenPoolCreateBody({
      ...h,
      tokenId: opts.tokenId,
      zbxAmountWei,
      tokenAmountBase,
    }),
  );
}

export async function sendTokenPoolAddLiquidity(opts: CommonOpts & {
  tokenId: number;
  zbxAmount: string | number;
  maxTokenAmountDisplay: string | number;
  tokenDecimals: number;
  minLpOut?: bigint;   // 0 by default — UI should pass a slippage-protected value
}): Promise<TokenTxResult> {
  const zbxAmountWei = zbxToWei(opts.zbxAmount);
  const maxTokenAmountBase = displayToBase(opts.maxTokenAmountDisplay, opts.tokenDecimals);
  const minLpOut = opts.minLpOut ?? 0n;
  return buildAndSend(opts, (h) =>
    encodeTokenPoolAddLiquidityBody({
      ...h,
      tokenId: opts.tokenId,
      zbxAmountWei,
      maxTokenAmountBase,
      minLpOut,
    }),
  );
}

export async function sendTokenPoolRemoveLiquidity(opts: CommonOpts & {
  tokenId: number;
  lpBurn: bigint;
  minZbxOutWei?: bigint;
  minTokenOutBase?: bigint;
}): Promise<TokenTxResult> {
  return buildAndSend(opts, (h) =>
    encodeTokenPoolRemoveLiquidityBody({
      ...h,
      tokenId: opts.tokenId,
      lpBurn: opts.lpBurn,
      minZbxOutWei: opts.minZbxOutWei ?? 0n,
      minTokenOutBase: opts.minTokenOutBase ?? 0n,
    }),
  );
}

export async function sendTokenPoolSwap(opts: CommonOpts & {
  tokenId: number;
  direction: TokenSwapDirectionStr;
  /** Amount in: when direction=zbx_to_token, this is ZBX display (parsed via zbxToWei).
   *  When direction=token_to_zbx, this is token display (parsed via displayToBase). */
  amountInDisplay: string | number;
  tokenDecimals: number;
  minOut: bigint;     // already in base units (wei or token-base)
}): Promise<TokenTxResult> {
  const amountIn = opts.direction === "zbx_to_token"
    ? zbxToWei(opts.amountInDisplay)
    : displayToBase(opts.amountInDisplay, opts.tokenDecimals);
  return buildAndSend(opts, (h) =>
    encodeTokenPoolSwapBody({
      ...h,
      tokenId: opts.tokenId,
      direction: opts.direction,
      amountIn,
      minOut: opts.minOut,
    }),
  );
}

// ── Pool RPC wrappers (read-only) ─────────────────────────────────────────

export interface TokenPoolJson {
  token_id: number;
  token_symbol: string;
  token_name: string;
  token_decimals: number;
  creator: string;
  init_height: number;
  zbx_reserve: string;        // wei decimal
  token_reserve: string;      // base-unit decimal
  lp_supply: string;
  spot_price_q18: string;     // ZBX-wei per 1 token-base, scaled 1e18
  swap_fee_bps_num: number;
  swap_fee_bps_den: number;
  min_lock_lp: string;
  cum_zbx_in_volume: string;
  cum_token_in_volume: string;
  swap_count: number;
}

export interface TokenPoolListResp {
  total: number;
  offset: number;
  limit: number;
  returned: number;
  pools: TokenPoolJson[];
}

export async function listTokenPools(offset = 0, limit = 50): Promise<TokenPoolListResp> {
  return rpc<TokenPoolListResp>("zbx_listTokenPools", [offset, limit]);
}

export async function getTokenPool(tokenId: number): Promise<TokenPoolJson | null> {
  try {
    return await rpc<TokenPoolJson>("zbx_getTokenPool", [tokenId]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found|-32004/i.test(msg)) return null;
    throw e;
  }
}

export interface TokenPoolStats {
  token_id: number;
  zbx_reserve: string;
  token_reserve: string;
  lp_supply: string;
  spot_price_q18: string;
  cum_zbx_in_volume: string;
  cum_token_in_volume: string;
  swap_count: number;
  init_height: number;
  creator: string;
}

export async function getTokenPoolStats(tokenId: number): Promise<TokenPoolStats | null> {
  try {
    return await rpc<TokenPoolStats>("zbx_tokenPoolStats", [tokenId]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found|-32004/i.test(msg)) return null;
    throw e;
  }
}

export interface TokenSwapQuoteResp {
  token_id: number;
  direction: TokenSwapDirectionStr;
  amount_in: string;
  amount_out: string;
  fee_in: string;
  fee_bps: number;
  fee_bps_den: number;
  zbx_reserve: string;
  token_reserve: string;
}

export async function getTokenSwapQuote(
  tokenId: number,
  direction: TokenSwapDirectionStr,
  amountIn: bigint,
): Promise<TokenSwapQuoteResp | null> {
  try {
    return await rpc<TokenSwapQuoteResp>(
      "zbx_tokenSwapQuote",
      [tokenId, direction, amountIn.toString()],
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found|-32004/i.test(msg)) return null;
    throw e;
  }
}

export interface TokenLpBalanceResp {
  token_id: number;
  address: string;
  lp_balance: string;
  lp_supply: string;
  redeemable_zbx: string;        // wei decimal
  redeemable_token: string;      // base-unit decimal
}

export async function getTokenLpBalance(
  tokenId: number,
  addr: string,
): Promise<TokenLpBalanceResp> {
  return rpc<TokenLpBalanceResp>("zbx_getTokenLpBalance", [tokenId, addr]);
}

// ── Pool math helpers (client-side) ───────────────────────────────────────

/** Apply slippage tolerance to an expected output. `bps = 50` → 0.5%. */
export function applySlippage(expected: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(5_000, Math.floor(slippageBps))));
  return (expected * (10_000n - bps)) / 10_000n;
}

/** Pure constant-product quote — same formula as the chain. Useful for
 *  client-side previews while typing (RPC is hit only on debounced commit). */
export function quoteZbxForToken(
  zbxIn: bigint,
  zbxReserve: bigint,
  tokenReserve: bigint,
): bigint {
  if (zbxIn <= 0n || zbxReserve <= 0n || tokenReserve <= 0n) return 0n;
  const fee = (zbxIn * TOKEN_POOL_FEE_BPS_NUM) / TOKEN_POOL_FEE_BPS_DEN;
  const eff = zbxIn - fee;
  return (tokenReserve * eff) / (zbxReserve + eff);
}

export function quoteTokenForZbx(
  tokenIn: bigint,
  zbxReserve: bigint,
  tokenReserve: bigint,
): bigint {
  if (tokenIn <= 0n || zbxReserve <= 0n || tokenReserve <= 0n) return 0n;
  const fee = (tokenIn * TOKEN_POOL_FEE_BPS_NUM) / TOKEN_POOL_FEE_BPS_DEN;
  const eff = tokenIn - fee;
  return (zbxReserve * eff) / (tokenReserve + eff);
}

/** Spot price of 1 token in ZBX (display). Uses the pool's `spot_price_q18`. */
export function spotPriceZbxPerToken(pool: Pick<TokenPoolJson, "spot_price_q18">): number {
  try {
    const q = BigInt(pool.spot_price_q18 || "0");
    // q is wei-per-token-base scaled 1e18 → divide by 1e18 once for wei,
    // then by 1e18 again for ZBX. Combined: divide by 1e36 for "ZBX per
    // 1 base-unit-of-token". Most UI wants ZBX per WHOLE token, so caller
    // can scale by token's decimals.
    const num = Number(q) / 1e18;  // ZBX-wei per token-base, in JS float
    return num / 1e18;             // → ZBX per token-base
  } catch {
    return 0;
  }
}

/** ZBX-per-WHOLE-token: scales by 10^(token_decimals) so the result is
 *  human-readable as "1 TOKEN = X ZBX". */
export function spotPriceZbxPerWholeToken(
  pool: Pick<TokenPoolJson, "spot_price_q18" | "token_decimals">,
): number {
  const perBase = spotPriceZbxPerToken(pool);
  return perBase * Math.pow(10, pool.token_decimals);
}

// ─────────────────────────── Phase G — Token metadata ───────────────────────────

export const TX_KIND_TOKEN_SET_METADATA = 19;

/** Mirror of zebvix-chain/src/tokenomics.rs — keep in sync. The chain
 *  rejects (and refunds) anything longer. We pre-validate here so the user
 *  doesn't burn a fee on a guaranteed-fail tx. */
export const TOKEN_META_LOGO_MAX_LEN        = 256;
export const TOKEN_META_WEBSITE_MAX_LEN     = 256;
export const TOKEN_META_DESCRIPTION_MAX_LEN = 1024;
export const TOKEN_META_SOCIAL_MAX_LEN      = 64;

export interface TokenMetadataInput {
  tokenId: number | bigint;
  logoUrl?: string;
  website?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
}

function clampField(name: string, val: string | undefined, max: number): string {
  const s = (val ?? "").toString();
  if (s.length > max) {
    throw new Error(`${name} is ${s.length} chars; max is ${max}`);
  }
  return s;
}

export function encodeTokenSetMetadataBody(
  opts: BodyHeader & TokenMetadataInput,
): Uint8Array {
  const logo  = clampField("logo_url",    opts.logoUrl,     TOKEN_META_LOGO_MAX_LEN);
  const site  = clampField("website",     opts.website,     TOKEN_META_WEBSITE_MAX_LEN);
  const desc  = clampField("description", opts.description, TOKEN_META_DESCRIPTION_MAX_LEN);
  const tw    = clampField("twitter",     opts.twitter,     TOKEN_META_SOCIAL_MAX_LEN);
  const tg    = clampField("telegram",    opts.telegram,    TOKEN_META_SOCIAL_MAX_LEN);
  const dc    = clampField("discord",     opts.discord,     TOKEN_META_SOCIAL_MAX_LEN);
  return concat(
    header(opts, TX_KIND_TOKEN_SET_METADATA),
    u64Le(opts.tokenId),
    strBincode(logo),
    strBincode(site),
    strBincode(desc),
    strBincode(tw),
    strBincode(tg),
    strBincode(dc),
  );
}

export async function sendTokenSetMetadata(
  opts: CommonOpts & TokenMetadataInput,
): Promise<TokenTxResult> {
  return buildAndSend(opts, (h) =>
    encodeTokenSetMetadataBody({
      ...h,
      tokenId:     opts.tokenId,
      logoUrl:     opts.logoUrl,
      website:     opts.website,
      description: opts.description,
      twitter:     opts.twitter,
      telegram:    opts.telegram,
      discord:     opts.discord,
    }),
  );
}

/** Read on-chain metadata for `tokenId`. Returns the record (with `unset:true`
 *  when nothing has ever been set). Throws if the token does not exist. */
export async function getTokenMetadata(tokenId: number | bigint): Promise<TokenMetadata> {
  return rpc<TokenMetadata>("zbx_getTokenMetadata", [Number(tokenId)]);
}
