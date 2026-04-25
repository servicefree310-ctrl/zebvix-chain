// Browser-side helpers for the Multisig Explorer "Wallet Tools".
//
// This file mirrors `zebvix-chain/src/multisig.rs::derive_multisig_address`
// 1:1 so the UI can show users the SAME 20-byte address they will get on
// chain when they submit `multisig-create`. No private key is involved —
// multisig accounts have no key, only a deterministic identity.
//
// derive formula (multisig.rs:114-131):
//   keccak256(
//     "ZBX_MULTISIG_v1"
//     || sorted_owners        (each 20 bytes, ascending byte order)
//     || [threshold]          (1 byte)
//     || salt.to_le_bytes()   (8 bytes, little-endian u64)
//     || creator              (20 bytes)
//   )[12..32]                 // last 20 bytes (ZVM-style)

import { keccak_256 } from "@noble/hashes/sha3.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";

const TAG = new TextEncoder().encode("ZBX_MULTISIG_v1");

export function isValidAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

export function normalizeAddress(s: string): string {
  return s.trim().toLowerCase();
}

/** Sort by raw 20-byte order (ascending), matching Rust `Vec::sort_by_key(|a| a.0)`. */
export function sortOwners(owners: string[]): string[] {
  return [...owners].sort((a, b) => {
    const A = a.toLowerCase();
    const B = b.toLowerCase();
    return A < B ? -1 : A > B ? 1 : 0;
  });
}

export function deriveMultisigAddress(
  sortedOwners: string[],
  threshold: number,
  salt: bigint,
  creator: string,
): string {
  // total bytes = TAG(15) + N*20 + 1 + 8 + 20
  const len = TAG.length + sortedOwners.length * 20 + 1 + 8 + 20;
  const buf = new Uint8Array(len);
  let off = 0;
  buf.set(TAG, off); off += TAG.length;
  for (const o of sortedOwners) {
    buf.set(hexToBytes(o.toLowerCase().slice(2)), off);
    off += 20;
  }
  buf[off++] = threshold & 0xff;
  // u64 little-endian salt
  let s = salt;
  for (let i = 0; i < 8; i++) {
    buf[off + i] = Number(s & 0xffn);
    s >>= 8n;
  }
  off += 8;
  buf.set(hexToBytes(creator.toLowerCase().slice(2)), off);
  off += 20;
  const h = keccak_256(buf);
  return "0x" + bytesToHex(h.slice(12, 32));
}

/** Generate a random u64 salt as a bigint. */
export function randomSalt(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(8));
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
  return v;
}

/* ─────────────── Watchlist (localStorage) ─────────────── */

const WATCHLIST_KEY = "zbx.multisig.watchlist.v1";

export interface WatchlistEntry {
  label: string;
  address: string;
  added_at: number; // ms epoch
}

export function loadWatchlist(): WatchlistEntry[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as WatchlistEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveWatchlist(list: WatchlistEntry[]): void {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  } catch {
    /* quota exceeded — ignore */
  }
}

export function addToWatchlist(label: string, address: string): WatchlistEntry[] {
  const cur = loadWatchlist();
  const norm = normalizeAddress(address);
  if (cur.some((e) => normalizeAddress(e.address) === norm)) return cur;
  const next = [...cur, { label: label.trim() || "(unnamed)", address: norm, added_at: Date.now() }];
  saveWatchlist(next);
  return next;
}

export function removeFromWatchlist(address: string): WatchlistEntry[] {
  const norm = normalizeAddress(address);
  const next = loadWatchlist().filter((e) => normalizeAddress(e.address) !== norm);
  saveWatchlist(next);
  return next;
}

export function exportWatchlistJson(): string {
  return JSON.stringify(loadWatchlist(), null, 2);
}

export function importWatchlistJson(json: string, mode: "merge" | "replace"): WatchlistEntry[] {
  const incoming = JSON.parse(json) as WatchlistEntry[];
  if (!Array.isArray(incoming)) throw new Error("invalid watchlist JSON: expected array");
  const cleaned: WatchlistEntry[] = [];
  for (const e of incoming) {
    if (!e || typeof e.address !== "string" || !isValidAddress(e.address)) continue;
    cleaned.push({
      label: typeof e.label === "string" ? e.label : "(imported)",
      address: normalizeAddress(e.address),
      added_at: typeof e.added_at === "number" ? e.added_at : Date.now(),
    });
  }
  if (mode === "replace") {
    saveWatchlist(cleaned);
    return cleaned;
  }
  const cur = loadWatchlist();
  const seen = new Set(cur.map((e) => normalizeAddress(e.address)));
  for (const e of cleaned) {
    if (!seen.has(normalizeAddress(e.address))) {
      cur.push(e);
      seen.add(normalizeAddress(e.address));
    }
  }
  saveWatchlist(cur);
  return cur;
}
