// Pay-ID registration helper. Builds and broadcasts a TxKind::RegisterPayId
// (tag = 6) signed transaction. Wire format mirrors zebvix-chain bincode v1.3:
//
//   from(50) + to(50) + amount(16) + nonce(8) + fee(16) + chain_id(8)
//   + kind_tag(4=6)
//   + pay_id_len(8) + pay_id_utf8 + name_len(8) + name_utf8
//
// followed by pubkey-as-string(76) + 64-byte ECDSA signature (r||s).
//
// CRITICAL: chain's `SignedTx.pubkey` uses `#[serde(with = "hex_array_33")]`,
// which serialises the 33-byte compressed key as a length-prefixed UTF-8 string
// "0x" + 66 hex chars (8 byte u64 length=68 + 68 bytes UTF-8 = 76 bytes total).
// Sending raw 33 bytes here yields "bad bincode: io error" from the chain.

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

function strBincode(s: string): Uint8Array {
  const utf = new TextEncoder().encode(s);
  const out = new Uint8Array(8 + utf.length);
  out.set(u64Le(utf.length), 0);
  out.set(utf, 8);
  return out;
}

/**
 * Encode a 33-byte compressed secp256k1 pubkey the way the chain's
 * `hex_array_33` serde adapter does for bincode: as a length-prefixed UTF-8
 * string "0x" + 66 hex chars. Total = 8 + 68 = 76 bytes.
 */
function pubkeyBincode(pub: Uint8Array): Uint8Array {
  if (pub.length !== 33) {
    throw new Error(`pubkey must be 33 bytes (got ${pub.length})`);
  }
  return strBincode("0x" + bytesToHex(pub));
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

// ── Validation (mirror of zebvix-chain `validate_payid` / `_name`) ────────

const HANDLE_RE = /^[a-z0-9_]{3,25}$/;

export interface PayIdValidation {
  ok: boolean;
  canonical?: string;
  reason?: string;
}

/** Validate handle-or-full-payid input. Returns canonical "<handle>@zbx". */
export function validatePayIdInput(raw: string): PayIdValidation {
  const lc = raw.trim().toLowerCase();
  const handle = lc.endsWith("@zbx") ? lc.slice(0, -4) : lc;
  if (!HANDLE_RE.test(handle)) {
    return {
      ok: false,
      reason:
        "handle must be 3–25 chars, lowercase letters / digits / underscore only",
    };
  }
  return { ok: true, canonical: `${handle}@zbx` };
}

export function validatePayIdName(raw: string): PayIdValidation {
  const s = raw.trim();
  if (!s) return { ok: false, reason: "display name is required" };
  if (s.length > 50) return { ok: false, reason: "name max 50 chars" };
  if (/[\u0000-\u001f\u007f]/.test(s)) {
    return { ok: false, reason: "name must not contain control chars" };
  }
  return { ok: true, canonical: s };
}

// ── Encoding ───────────────────────────────────────────────────────────────

export function encodeRegisterPayIdBody(opts: {
  from: string;
  payId: string; // canonical "<handle>@zbx"
  name: string;
  feeWei: bigint;
  nonce: number | bigint;
  chainId: number | bigint;
}): Uint8Array {
  return concat(
    addrBincode(opts.from), // 50
    addrBincode(opts.from), // 50  (to == from for register)
    u128Le(0n),             // 16  amount = 0
    u64Le(opts.nonce),      //  8
    u128Le(opts.feeWei),    // 16
    u64Le(opts.chainId),    //  8
    u32Le(6),               //  4  TxKind::RegisterPayId
    strBincode(opts.payId),
    strBincode(opts.name),
  );
}

// ── Sign + broadcast ───────────────────────────────────────────────────────

export interface RegisterPayIdResult {
  hash: string;
  payId: string;
}

/**
 * Sign + submit a RegisterPayId tx for the wallet whose private key is given.
 * Throws on invalid input or RPC error. Returns the broadcast tx hash.
 */
export async function registerPayId(opts: {
  privateKeyHex: string; // 0x + 64 hex
  payId: string;          // raw input, with or without @zbx
  name: string;
  feeZbx?: string | number; // default "0.002"
  chainId?: number;          // default 7878
}): Promise<RegisterPayIdResult> {
  const idChk = validatePayIdInput(opts.payId);
  if (!idChk.ok || !idChk.canonical) {
    throw new Error(idChk.reason ?? "invalid Pay-ID");
  }
  const nameChk = validatePayIdName(opts.name);
  if (!nameChk.ok || !nameChk.canonical) {
    throw new Error(nameChk.reason ?? "invalid display name");
  }

  const seedHex = opts.privateKeyHex.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("private key must be 64 hex chars");
  }
  const seed = hexToBytes(seedHex);
  const pub = publicKeyFromSeed(seed);
  const from = addressFromPublic(pub);

  const nonceRaw = (await rpc<unknown>("zbx_getNonce", [from])) as
    | number
    | string;
  const nonce = parseNonce(nonceRaw);

  const chainId = opts.chainId ?? 7878;
  const feeZbx = opts.feeZbx ?? "0.002";

  const body = encodeRegisterPayIdBody({
    from,
    payId: idChk.canonical,
    name: nameChk.canonical,
    feeWei: zbxToWei(feeZbx),
    nonce,
    chainId,
  });

  // @noble/curves defaults to `prehash: true` — it SHA-256s the input itself.
  // We pass the raw body so the lib produces sig over SHA-256(body), exactly
  // matching the chain's `k256::ecdsa::SigningKey::sign(msg)` (which also
  // internally hashes msg with SHA-256). Pre-hashing here would double-hash.
  const sig = secp256k1.sign(body, seed, { lowS: true });
  const signed = concat(body, pubkeyBincode(pub), sig);
  const hexHex = "0x" + bytesToHex(signed);

  const res = await rpc<string>("zbx_sendRawTransaction", [hexHex]);
  return {
    hash: typeof res === "string" ? res : "",
    payId: idChk.canonical,
  };
}

// ── Lookup helpers (forward + reverse) ─────────────────────────────────────

export interface PayIdRecord {
  pay_id?: string;
  address?: string;
  name?: string;
}

/**
 * Returns the on-chain record for a Pay-ID, or `null` if the handle is not
 * registered (free to claim). Throws on real network / RPC failures so callers
 * can distinguish "not registered" (null) from "could not check" (throw).
 *
 * The chain returns an RPC error like "pay-id 'foo@zbx' not registered" for
 * absent handles — we normalise that to `null` here.
 */
export async function lookupPayIdForward(payId: string): Promise<PayIdRecord | null> {
  const v = validatePayIdInput(payId);
  const q = v.ok && v.canonical ? v.canonical : payId.trim();
  try {
    const r = await rpc<PayIdRecord>("zbx_lookupPayId", [q]);
    return r ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not\s*(registered|found)|unknown|does\s*not\s*exist/i.test(msg)) {
      return null;
    }
    throw e;
  }
}

export async function lookupPayIdReverse(addr: string): Promise<PayIdRecord | null> {
  try {
    const r = await rpc<PayIdRecord>("zbx_getPayIdOf", [addr.trim()]);
    return r ?? null;
  } catch {
    return null;
  }
}

export async function payIdCount(): Promise<number> {
  try {
    const r = await rpc<{ total: number }>("zbx_payIdCount");
    return r?.total ?? 0;
  } catch {
    return 0;
  }
}

/** Check if a Pay-ID handle is currently free. */
export async function isPayIdAvailable(payId: string): Promise<boolean> {
  const rec = await lookupPayIdForward(payId);
  return !rec?.address;
}
