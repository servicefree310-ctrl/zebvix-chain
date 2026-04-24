// Browser-side Zebvix wallet: ed25519 keypair + EVM-style 20-byte address
// (last 20 bytes of keccak256(pubkey)), bincode-encoded SignedTx Transfer
// matching the chain's wire format, sent via /api/rpc → zbx_sendRawTransaction.
//
// Storage: keys live in localStorage as a JSON array under `zbx.wallets.v1`.
// Active address is in `zbx.wallet.active`. Private keys are stored UNENCRYPTED
// in the browser — this is a developer / hot-wallet flow only. Always export
// the keystore JSON as a backup; losing localStorage = losing the funds.

import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { rpc } from "./zbx-rpc";

const STORAGE_KEY = "zbx.wallets.v1";
const ACTIVE_KEY = "zbx.wallet.active";

export interface StoredWallet {
  address: string;          // 0x + 40 hex
  publicKey: string;        // 0x + 64 hex
  privateKey: string;       // 0x + 64 hex (32-byte seed)
  label: string;
  createdAt: number;
}

// ── Address / key derivation ───────────────────────────────────────────────

function ensureSeed(seed: Uint8Array): Uint8Array {
  if (seed.length !== 32) throw new Error("ed25519 seed must be 32 bytes");
  return seed;
}

export function publicKeyFromSeed(seed: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(ensureSeed(seed));
}

/// EVM-style 20-byte address: last 20 bytes of keccak256(pubkey).
export function addressFromPublic(pub: Uint8Array): string {
  if (pub.length !== 32) throw new Error("ed25519 pubkey must be 32 bytes");
  const h = keccak_256(pub);
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
  const feeZbx = opts.feeZbx ?? "0.002";

  const body = encodeTransferBody({
    from,
    to: opts.to,
    amountWei: zbxToWei(opts.amountZbx),
    feeWei: zbxToWei(feeZbx),
    nonce,
    chainId,
  });

  const sig = ed25519.sign(body, seed);            // 64 bytes
  const signed = concat(body, pub, sig);           // 152 + 32 + 64 = 248
  const hexHex = "0x" + bytesToHex(signed);

  const res = await rpc<string>("zbx_sendRawTransaction", [hexHex]);
  return { hash: typeof res === "string" ? res : "" };
}

// ── Tx history (per-browser, persisted) ────────────────────────────────────

export type TxStatus = "submitted" | "failed" | "invalid";

export interface TxRecord {
  hash: string | null;
  from: string;
  to: string;
  amountZbx: string;
  feeZbx: string;
  ts: number;
  status: TxStatus;
  error?: string;
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

export function clearHistory() {
  localStorage.removeItem(HIST_KEY);
}
