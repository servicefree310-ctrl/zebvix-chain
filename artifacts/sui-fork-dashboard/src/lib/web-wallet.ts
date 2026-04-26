// Browser-side Zebvix wallet — **Phase B.11**: secp256k1 keys + ETH-style
// address derivation. The same private key used in MetaMask now derives the
// SAME 20-byte address on Zebvix:
//
//   addr = keccak256( uncompressed_pubkey[1..] )[12..]
//
// Signatures are ECDSA-secp256k1 with SHA-256 pre-hashing (matches Rust
// `k256::ecdsa::SigningKey::sign` exactly). We hand-hash with SHA-256 here
// so that what we sign on the wire matches what the chain verifies.
//
// Storage: keys live in localStorage as a JSON array under `zbx.wallets.v1`
// (plaintext — "hot dev wallet" mode) OR encrypted under `zbx.wallets.vault.v1`
// once the user opts in to a password vault (see `wallet-vault.ts`).
// Active address is in `zbx.wallet.active`.
//
// **When the vault exists but is not yet unlocked in this tab,
// `loadWallets()` returns `[]`** — UI must check `vaultExists() &&
// !vaultUnlocked()` and prompt the user to unlock first.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { rpc, getRecommendedFeeWei } from "./zbx-rpc";
import {
  vaultExists,
  vaultUnlocked,
  readVaultedWallets,
  memCacheSet,
} from "./wallet-vault";

const STORAGE_KEY = "zbx.wallets.v1";
const ACTIVE_KEY = "zbx.wallet.active";

/** The localStorage key that holds plaintext keystores (when no vault). */
export const PLAINTEXT_WALLETS_KEY = STORAGE_KEY;

export interface StoredWallet {
  address: string;          // 0x + 40 hex (ETH-style)
  publicKey: string;        // 0x + 66 hex (33-byte compressed secp256k1)
  privateKey: string;       // 0x + 64 hex (32-byte secret — ETH/MetaMask compatible)
  label: string;
  createdAt: number;
}

// ── Address / key derivation ───────────────────────────────────────────────

function ensureSeed(seed: Uint8Array): Uint8Array {
  if (seed.length !== 32) throw new Error("secp256k1 secret must be 32 bytes");
  return seed;
}

/** Compressed secp256k1 public key (33 bytes, SEC1 `0x02|0x03 || X`). */
export function publicKeyFromSeed(seed: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(ensureSeed(seed), true);
}

/** Uncompressed secp256k1 public key (65 bytes, `0x04 || X || Y`). */
export function uncompressedPublicKeyFromSeed(seed: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(ensureSeed(seed), false);
}

/// **ETH-standard** 20-byte address:
///   `keccak256( uncompressed_pubkey[1..] )[12..]` — drop the `0x04` SEC1
/// prefix, hash the 64-byte (X||Y) concatenation, take the last 20 bytes.
/// Accepts EITHER a 33-byte compressed pubkey (we decompress it via the
/// secp256k1 curve point) OR an already-uncompressed 65-byte key.
export function addressFromPublic(pub: Uint8Array): string {
  let uncompressed: Uint8Array;
  if (pub.length === 65 && pub[0] === 0x04) {
    uncompressed = pub;
  } else if (pub.length === 33 && (pub[0] === 0x02 || pub[0] === 0x03)) {
    // Decompress via the curve point.
    const point = secp256k1.Point.fromBytes(pub);
    uncompressed = point.toBytes(false); // 65 bytes, 0x04 || X || Y
  } else {
    throw new Error(
      `secp256k1 pubkey must be 33 bytes (compressed) or 65 bytes (uncompressed); got ${pub.length}`,
    );
  }
  const h = keccak_256(uncompressed.slice(1)); // hash X||Y (skip the 0x04 prefix)
  return "0x" + bytesToHex(h.slice(12, 32));
}

export function addressFromSeed(seed: Uint8Array): string {
  return addressFromPublic(publicKeyFromSeed(seed));
}

export function generateWallet(label = "Wallet"): StoredWallet {
  const seed = randomBytes(32);
  const pub = publicKeyFromSeed(seed);
  return {
    address: addressFromPublic(pub),
    publicKey: "0x" + bytesToHex(pub),
    privateKey: "0x" + bytesToHex(seed),
    label,
    createdAt: Date.now(),
  };
}

export function importWalletFromHex(secretHex: string, label = "Imported"): StoredWallet {
  const s = secretHex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    throw new Error("private key must be 64 hex chars (32 bytes)");
  }
  const seed = hexToBytes(s);
  const pub = publicKeyFromSeed(seed);
  return {
    address: addressFromPublic(pub),
    publicKey: "0x" + bytesToHex(pub),
    privateKey: "0x" + bytesToHex(seed),
    label,
    createdAt: Date.now(),
  };
}

// ── Persistence ────────────────────────────────────────────────────────────

export function loadWallets(): StoredWallet[] {
  // Prefer the encrypted vault when one exists. Returning [] for a locked
  // vault is intentional — callers (the wallet page especially) detect this
  // via `vaultExists() && !vaultUnlocked()` and prompt for a password.
  if (vaultExists()) {
    if (!vaultUnlocked()) return [];
    return readVaultedWallets() ?? [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveWallets(ws: StoredWallet[]) {
  if (vaultExists() && vaultUnlocked()) {
    // Update the per-tab plaintext mirror immediately so the rest of the
    // app sees the new list. The on-disk vault is not re-encrypted on every
    // write (we don't keep the password) — the next explicit `lockVault`
    // call (or page unlock) flushes the latest state.
    memCacheSet(ws);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
}

export function addWallet(w: StoredWallet) {
  const ws = loadWallets();
  if (!ws.some(x => x.address.toLowerCase() === w.address.toLowerCase())) {
    ws.push(w);
    saveWallets(ws);
  }
  if (!getActiveAddress()) setActiveAddress(w.address);
}

export function removeWallet(addr: string) {
  const ws = loadWallets().filter(
    w => w.address.toLowerCase() !== addr.toLowerCase(),
  );
  saveWallets(ws);
  if (getActiveAddress()?.toLowerCase() === addr.toLowerCase()) {
    setActiveAddress(ws[0]?.address ?? null);
  }
}

export function getActiveAddress(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveAddress(addr: string | null) {
  if (addr) localStorage.setItem(ACTIVE_KEY, addr);
  else localStorage.removeItem(ACTIVE_KEY);
}

export function getWallet(addr: string): StoredWallet | null {
  return (
    loadWallets().find(
      w => w.address.toLowerCase() === addr.toLowerCase(),
    ) ?? null
  );
}

// ── Bincode encoding ───────────────────────────────────────────────────────
// Matches `bincode = "1.3"` default config: little-endian fixint, enum tag = u32 LE.
//
// Address has `#[serde(with = "hex_array_20")]` → serializes as a STRING
// (u64 LE length prefix + UTF-8 bytes "0x..40hex.."). 8 + 42 = 50 bytes.

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

/**
 * Encode a 33-byte compressed secp256k1 pubkey the way the chain's
 * `hex_array_33` serde adapter does for bincode: as a length-prefixed UTF-8
 * string "0x" + 66 hex chars (8 byte u64 length=68 + 68 UTF-8 bytes = 76).
 *
 * **Critical**: `SignedTx.pubkey` carries `#[serde(with = "hex_array_33")]`
 * on the chain — sending raw 33 bytes here yields "bad bincode: io error".
 */
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
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

/// Encode a Transfer-kind TxBody — exactly 152 bytes:
///   from(50) + to(50) + amount(16) + nonce(8) + fee(16) + chain_id(8) + kind(4) = 152
export function encodeTransferBody(opts: {
  from: string; to: string;
  amountWei: bigint; feeWei: bigint;
  nonce: number | bigint; chainId: number | bigint;
}): Uint8Array {
  return concat(
    addrBincode(opts.from),         // 50
    addrBincode(opts.to),           // 50
    u128Le(opts.amountWei),         // 16
    u64Le(opts.nonce),              //  8
    u128Le(opts.feeWei),            // 16
    u64Le(opts.chainId),            //  8
    u32Le(0),                       //  4  TxKind::Transfer
  );
}

// ── Phase B.10 — Swap (Buy/Sell) tx encoding ───────────────────────────────

/** Direction of an AMM swap. Matches `crate::transaction::SwapDirection`. */
export type SwapDirection = "zbx_to_zusd" | "zusd_to_zbx";

/// Encode a Swap-kind TxBody — exactly 172 bytes:
///   from(50) + to(50) + amount(16) + nonce(8) + fee(16) + chain_id(8)
///   + kind_tag(4 = 8) + direction_tag(4) + min_out(16) = 172.
///
/// `body.amount` carries the swap input amount (in ZBX wei OR zUSD micro-units
/// depending on `direction`). `body.to` MUST equal `body.from` (the chain
/// rejects swaps where to != from). Output is credited back to the sender's
/// account in the *opposite* token.
export function encodeSwapBody(opts: {
  from: string;
  amountIn: bigint;
  direction: SwapDirection;
  minOut: bigint;
  feeWei: bigint;
  nonce: number | bigint;
  chainId: number | bigint;
}): Uint8Array {
  const dirTag = opts.direction === "zbx_to_zusd" ? 0 : 1;
  return concat(
    addrBincode(opts.from),         // 50
    addrBincode(opts.from),         // 50  (to == from for swaps)
    u128Le(opts.amountIn),          // 16
    u64Le(opts.nonce),              //  8
    u128Le(opts.feeWei),            // 16
    u64Le(opts.chainId),            //  8
    u32Le(8),                       //  4  TxKind::Swap discriminator
    u32Le(dirTag),                  //  4  SwapDirection discriminator
    u128Le(opts.minOut),            // 16
  );
}

/** Convert a zUSD decimal-string to 18-decimal micro-units. Same scale as wei. */
export function zusdToMicros(zusd: string | number): bigint {
  // zUSD shares the 18-decimal layout with ZBX wei, so we can reuse zbxToWei.
  return zbxToWei(zusd);
}

// ── Signing + send ─────────────────────────────────────────────────────────

const ZBX_DECIMALS = 18n;

/** Parse a u64 nonce from either a JSON number or a "0x..."/decimal string. */
export function parseNonce(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    const big = /^0x[0-9a-fA-F]+$/.test(s)
      ? BigInt(s)                          // hex
      : /^\d+$/.test(s)
        ? BigInt(s)                        // decimal
        : null;
    if (big === null) throw new Error(`unrecognized nonce: "${raw}"`);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("nonce exceeds JS safe integer");
    }
    return Number(big);
  }
  throw new Error(`unrecognized nonce type: ${typeof raw}`);
}

export function zbxToWei(zbx: string | number): bigint {
  const s = String(zbx).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`invalid amount "${zbx}"`);
  if (s.startsWith("-")) throw new Error("amount cannot be negative");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 18) throw new Error("max 18 decimal places");
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** ZBX_DECIMALS + BigInt(padded || "0");
}

export interface SendResult { hash: string; }

/** Sign a Transfer with the given seed and submit via /api/rpc. */
export async function sendTransfer(opts: {
  privateKeyHex: string;          // 0x + 64 hex
  to: string;
  amountZbx: string | number;
  feeZbx?: string | number;       // default 0.002
  chainId?: number;               // default 7878
}): Promise<SendResult> {
  const seedHex = opts.privateKeyHex.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("private key must be 64 hex chars");
  }
  const seed = hexToBytes(seedHex);
  const pub = publicKeyFromSeed(seed);
  const from = addressFromPublic(pub);

  // Pull fresh nonce from chain. Chain currently returns a JSON number, but
  // tolerate decimal/hex strings as well so we don't silently send the wrong
  // nonce if the proxy ever wraps it.
  const nonceRaw = (await rpc<unknown>("zbx_getNonce", [from])) as
    | number | string;
  const nonce = parseNonce(nonceRaw);

  const chainId = opts.chainId ?? 7878;
  // Use chain-recommended fee when caller didn't override — clears the
  // AMM-pegged dynamic fee floor inside `apply_tx`.
  const feeWei = opts.feeZbx !== undefined
    ? zbxToWei(opts.feeZbx)
    : await getRecommendedFeeWei();

  const body = encodeTransferBody({
    from,
    to: opts.to,
    amountWei: zbxToWei(opts.amountZbx),
    feeWei,
    nonce,
    chainId,
  });

  // ECDSA-secp256k1 (matches Rust `k256::ecdsa::SigningKey::sign`):
  //   sk.sign(msg) == ECDSA(sha256(msg)) — so we pre-hash with SHA-256 and
  //   sign the digest. `secp256k1.sign` returns a 64-byte `Uint8Array` in
  //   compact `r || s` form (low-S normalized) directly.
  const sig = secp256k1.sign(body, seed, { lowS: true });
  const signed = concat(body, pubkeyBincode(pub), sig);  // 152 + 76 + 64 = 292
  const hexHex = "0x" + bytesToHex(signed);

  const res = await rpc<string>("zbx_sendRawTransaction", [hexHex]);
  return { hash: typeof res === "string" ? res : "" };
}

/**
 * Phase B.10 — sign a TxKind::Swap and submit to the chain.
 *
 * This is the explicit AMM buy/sell path with on-chain slippage protection
 * (`minOut`). If the AMM would return less than `minOut`, the swap reverts
 * and only the fee is consumed (principal refunded).
 */
export async function sendSwap(opts: {
  privateKeyHex: string;
  direction: SwapDirection;
  /** Amount of input token (ZBX wei or zUSD micro-units, same 18-dec scale). */
  amountIn: bigint;
  /** Minimum acceptable output from the pool (in opposite token's units). */
  minOut: bigint;
  feeZbx?: string | number; // default "0.002"
  chainId?: number;
}): Promise<SendResult> {
  const seedHex = opts.privateKeyHex.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("private key must be 64 hex chars");
  }
  const seed = hexToBytes(seedHex);
  const pub = publicKeyFromSeed(seed);
  const from = addressFromPublic(pub);

  const nonceRaw = (await rpc<unknown>("zbx_getNonce", [from])) as
    | number | string;
  const nonce = parseNonce(nonceRaw);

  const chainId = opts.chainId ?? 7878;
  const feeWei = opts.feeZbx !== undefined
    ? zbxToWei(opts.feeZbx)
    : await getRecommendedFeeWei();

  const body = encodeSwapBody({
    from,
    amountIn: opts.amountIn,
    direction: opts.direction,
    minOut: opts.minOut,
    feeWei,
    nonce,
    chainId,
  });

  const sig = secp256k1.sign(body, seed, { lowS: true });
  const signed = concat(body, pubkeyBincode(pub), sig);  // 172 + 76 + 64 = 312
  const hexHex = "0x" + bytesToHex(signed);

  const res = await rpc<string>("zbx_sendRawTransaction", [hexHex]);
  return { hash: typeof res === "string" ? res : "" };
}

// ── Tx history (per-browser, persisted) ────────────────────────────────────

export type TxStatus =
  | "submitted"        // signed + broadcast, no receipt yet
  | "included"         // mined into a block, receipt fetched
  | "confirmed"        // receipt status == success
  | "reverted"         // receipt status == revert
  | "failed"           // local broadcast error (never reached mempool)
  | "invalid";

export type TxKind = "native" | "metamask";

export interface TxRecord {
  hash: string | null;
  from: string;
  to: string;
  amountZbx: string;
  feeZbx: string;
  ts: number;
  status: TxStatus;
  error?: string;
  /** Block height containing the tx, once included. */
  block?: number;
  /** Wall-clock ms when the receipt was first observed. */
  confirmedTs?: number;
  /** Where the tx originated — native signer vs MetaMask provider. */
  kind?: TxKind;
  /** Optional Solidity calldata hex (MetaMask flow). */
  data?: string;
}

const HIST_KEY = "zbx.web.tx.history.v1";
const HIST_MAX = 200;

export function loadHistory(): TxRecord[] {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function recordTx(r: TxRecord) {
  const list = [r, ...loadHistory()].slice(0, HIST_MAX);
  localStorage.setItem(HIST_KEY, JSON.stringify(list));
}

/** Patch the first record matching `hash`; no-op if not found. */
export function updateTxByHash(hash: string, patch: Partial<TxRecord>) {
  const list = loadHistory();
  const idx = list.findIndex((r) => r.hash && r.hash.toLowerCase() === hash.toLowerCase());
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...patch };
  localStorage.setItem(HIST_KEY, JSON.stringify(list));
}

export function clearHistory() {
  localStorage.removeItem(HIST_KEY);
}
