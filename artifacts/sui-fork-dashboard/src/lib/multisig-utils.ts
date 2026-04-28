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
import { rpc, weiHexToZbx, ZbxRpcError } from "@/lib/zbx-rpc";

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

/* ─────────────── On-chain lookup ─────────────── */

/** Cached chain-side info about a multisig wallet. */
export interface MultisigMetadata {
  owners: string[];
  threshold: number;
  balanceWei: string;       // hex string, e.g. "0x0"
  balanceZbx: string;       // human, e.g. "12.500000000000000000"
  createdHeight: number;
  proposalSeq: number;
  checkedAt: number;        // ms epoch
}

interface ChainMultisig {
  address: string;
  owners: string[];
  threshold: number;
  created_height: number;
  proposal_seq: number;
}

/** Fetch a multisig from chain. Returns null when the address doesn't resolve. */
export async function fetchMultisigInfo(
  address: string,
): Promise<MultisigMetadata | null> {
  if (!isValidAddress(address)) return null;
  const norm = normalizeAddress(address);
  try {
    const [info, balRaw] = await Promise.all([
      rpc<ChainMultisig>("zbx_getMultisig", [norm]),
      rpc<string>("zbx_getBalance", [norm]).catch(() => "0x0"),
    ]);
    return {
      owners: info.owners.map(normalizeAddress),
      threshold: info.threshold,
      balanceWei: balRaw,
      balanceZbx: weiHexToZbx(balRaw),
      createdHeight: info.created_height,
      proposalSeq: info.proposal_seq,
      checkedAt: Date.now(),
    };
  } catch (e) {
    // -32004 = "multisig {addr} not found" — definitive negative.
    if (e instanceof ZbxRpcError && e.code === -32004) return null;
    // Network / parser errors → re-throw so caller can surface them.
    throw e;
  }
}

/* ─────────────── Watchlist (localStorage) ─────────────── */

const WATCHLIST_KEY = "zbx.multisig.watchlist.v1";

export interface WatchlistEntry {
  label: string;
  address: string;
  added_at: number;             // ms epoch
  /** Cached chain metadata. Optional for backward compat with v0 entries. */
  metadata?: MultisigMetadata;
  /** Free-form note the user can attach (e.g. "treasury", "ops"). */
  note?: string;
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

export function addToWatchlist(
  label: string,
  address: string,
  metadata?: MultisigMetadata,
  note?: string,
): WatchlistEntry[] {
  const cur = loadWatchlist();
  const norm = normalizeAddress(address);
  if (cur.some((e) => normalizeAddress(e.address) === norm)) {
    // Already present → fold in any newer metadata so re-import refreshes.
    if (metadata) {
      const next = cur.map((e) =>
        normalizeAddress(e.address) === norm
          ? { ...e, metadata, label: label.trim() || e.label, note: note ?? e.note }
          : e,
      );
      saveWatchlist(next);
      return next;
    }
    return cur;
  }
  const next = [
    ...cur,
    {
      label: label.trim() || "(unnamed)",
      address: norm,
      added_at: Date.now(),
      ...(metadata ? { metadata } : {}),
      ...(note ? { note } : {}),
    },
  ];
  saveWatchlist(next);
  return next;
}

export function updateWatchlistMetadata(
  address: string,
  metadata: MultisigMetadata,
): WatchlistEntry[] {
  const norm = normalizeAddress(address);
  const next = loadWatchlist().map((e) =>
    normalizeAddress(e.address) === norm ? { ...e, metadata } : e,
  );
  saveWatchlist(next);
  return next;
}

export function renameWatchlistEntry(
  address: string,
  label: string,
): WatchlistEntry[] {
  const norm = normalizeAddress(address);
  const next = loadWatchlist().map((e) =>
    normalizeAddress(e.address) === norm
      ? { ...e, label: label.trim() || e.label }
      : e,
  );
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
      ...(e.metadata && typeof e.metadata === "object" ? { metadata: e.metadata } : {}),
      ...(typeof e.note === "string" ? { note: e.note } : {}),
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

/** Parse a textarea's worth of addresses (one per line, comma or whitespace ok).
 *  Returns deduped, normalized, validity-tagged entries. */
export function parseAddressList(raw: string): Array<{ address: string; valid: boolean; raw: string }> {
  const seen = new Set<string>();
  const out: Array<{ address: string; valid: boolean; raw: string }> = [];
  for (const tok of raw.split(/[\s,;]+/)) {
    const t = tok.trim();
    if (!t) continue;
    const valid = isValidAddress(t);
    const addr = valid ? normalizeAddress(t) : t;
    const key = valid ? addr : `__invalid:${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ address: addr, valid, raw: t });
  }
  return out;
}
