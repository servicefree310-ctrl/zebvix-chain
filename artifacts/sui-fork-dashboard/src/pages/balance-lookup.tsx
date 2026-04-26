import React, { useEffect, useMemo, useRef, useState } from "react";
import { rpc, weiHexToZbx, weiToUsd, fmtUsd, shortAddr, ZbxRpcError } from "@/lib/zbx-rpc";
import {
  Search, Wallet, Lock, TrendingUp, AlertCircle, ArrowLeftRight, Inbox,
  Droplets, Info, Gift, Shield, Crown, Flame, Anchor, Server, FileCode2,
  RefreshCw, Download, Copy, Check, ExternalLink, Clock, Zap, Hash,
  ChevronRight, Activity, Banknote, ArrowDownToLine, ArrowUpFromLine,
  Star, History, Landmark, BookmarkPlus, X,
} from "lucide-react";
import { useLocation } from "wouter";

// ────────────────────────────────────────────────────────────────────────────
// Magic addresses — mirrored byte-for-byte from zebvix-chain/src/tokenomics.rs
// (POOL_ADDRESS_HEX, REWARDS_POOL_ADDRESS_HEX, BURN_ADDRESS_HEX, BRIDGE_LOCK_ADDRESS_HEX)
// All comparisons are lowercase.
// ────────────────────────────────────────────────────────────────────────────
const AMM_POOL_ADDRESS    = "0x7a73776170000000000000000000000000000000"; // "zswap"
const REWARDS_POOL_ADDRESS = "0x7277647300000000000000000000000000000000"; // "rwds"
const BURN_ADDRESS        = "0x6275726e0000000000000000000000000000dead"; // "burn..dead"
const BRIDGE_LOCK_ADDRESS = "0x7a62726467000000000000000000000000000000"; // "zbrdg"

// Tokenomics constants (mirror tokenomics.rs / staking.rs)
const BLOCK_TIME_SECS = 5;
const BLOCKS_PER_DAY = 17_280;
const BULK_INTERVAL_BLOCKS = 5_000_000;
const BULK_RELEASE_BPS = 2_500; // 25%
const DRIP_BPS_PER_DAY = 50;    // 0.5%
const EPOCH_BLOCKS = 17_280;

const BOOKMARKS_KEY = "zbx.balance.bookmarks.v1";
const RECENTS_KEY   = "zbx.balance.recents.v1";

// ────────────────────────────────────────────────────────────────────────────
// Types — mirror RPC response shapes from rpc.rs
// ────────────────────────────────────────────────────────────────────────────
interface DelegationsRes {
  delegator?: string;
  total_value_wei?: string;
  delegations?: Array<{ validator: string; value_wei: string; shares: string }>;
}
interface LockedRes {
  address?: string;
  current_height?: number;
  locked_balance_wei?: string;
  claimable_now_wei?: string;
  locked_after_claim_wei?: string;
  stake_wei?: string;
  daily_drip_wei?: string;
  drip_bps_per_day?: number;
  bulk_release_bps?: number;
  bulk_interval_blocks?: number;
  last_drip_height?: number;
  last_bulk_height?: number;
  next_drip_height?: number;
  next_bulk_height?: number;
  blocks_to_next_bulk?: number;
  total_released_wei?: string;
  // Legacy (older RPC builds):
  locked_wei?: string;
  released_wei?: string;
  unlock_per_block_wei?: string;
  unlock_at_height?: number;
}
interface PoolStateRes {
  initialized?: boolean;
  zbx_reserve_wei?: string;
  zusd_reserve?: string;
  lp_supply?: string;
  spot_price_usd_per_zbx?: string;
  init_height?: number;
  fee_pct?: string;
  loan_outstanding_zusd?: string;
  loan_repaid?: boolean;
  permissionless?: boolean;
}
interface ValidatorRes {
  address: string;
  pubkey: string;
  voting_power: number;
}
interface StakingValidatorRes {
  address: string;
  operator: string;
  pubkey: string;
  total_stake_wei: string;
  total_shares: string;
  commission_bps: number;
  commission_pool_wei: string;
  jailed: boolean;
  jailed_until_epoch: number;
}
interface AdminRes  { current_admin?: string; locked?: boolean }
interface GovernorRes { current_governor?: string; locked?: boolean }
interface MempoolPendingRes {
  size: number; max_size: number; returned: number;
  txs: Array<{ hash: string; from: string; to: string; amount: string; fee: string; nonce: number; kind: string }>;
}
interface PayIdRes { pay_id?: string; name?: string }
interface OnchainTx {
  height: number; ts: number; from: string; to: string;
  amount_wei: string; fee_wei: string; kind: string; hash?: string;
}
interface BookmarkEntry { addr: string; label: string; addedAt: number }
type AddressRole = "regular" | "amm" | "rewards" | "burn" | "bridge" | "admin" | "governor" | "validator" | "multisig" | "contract";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const lc = (s: string) => (s || "").trim().toLowerCase();
const isMagicAddr = (a: string, magic: string) => lc(a) === magic;

// `zbx_getNonce` returns a u64 number per rpc.rs:151 — but older builds, the
// ZVM bridge (`eth_getTransactionCount`), and any custom proxy may return a
// hex string ("0xa") or decimal string ("10"). Accept all three.
function parseNonce(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return 0;
    if (s.toLowerCase().startsWith("0x")) {
      const n = parseInt(s, 16);
      return Number.isFinite(n) ? n : 0;
    }
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// Older RPC builds return locked-rewards under different field names. Map
// every legacy name into the new preview_unlock shape so DripPanel and totals
// keep working byte-for-byte across both schemas.
function normalizeLocked(r: LockedRes | null): LockedRes | null {
  if (!r) return r;
  const out: LockedRes = { ...r };
  // locked balance
  if (out.locked_balance_wei == null && out.locked_wei != null) {
    out.locked_balance_wei = out.locked_wei;
  }
  // total released (lifetime claimed)
  if (out.total_released_wei == null && out.released_wei != null) {
    out.total_released_wei = out.released_wei;
  }
  // claimable_now: legacy schema doesn't expose it; fall back to 0 string so
  // BigInt(...) doesn't blow up in totals + DripPanel just shows 0 ZBX.
  if (out.claimable_now_wei == null) out.claimable_now_wei = "0";
  if (out.locked_after_claim_wei == null) {
    out.locked_after_claim_wei = out.locked_balance_wei ?? "0";
  }
  // daily_drip: legacy `unlock_per_block_wei` was per-block, multiply by
  // BLOCKS_PER_DAY. New schema gives per-day directly.
  if (out.daily_drip_wei == null) {
    if (out.unlock_per_block_wei != null) {
      try {
        const perBlock = BigInt(out.unlock_per_block_wei);
        out.daily_drip_wei = (perBlock * BigInt(BLOCKS_PER_DAY)).toString();
      } catch { out.daily_drip_wei = "0"; }
    } else {
      out.daily_drip_wei = "0";
    }
  }
  // bulk schedule defaults
  if (out.next_bulk_height == null) out.next_bulk_height = 0;
  if (out.blocks_to_next_bulk == null) out.blocks_to_next_bulk = 0;
  if (out.stake_wei == null) out.stake_wei = "0";
  return out;
}

function readQueryAddr(): string | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  const a = p.get("addr");
  return a && a.trim() ? a.trim() : null;
}

function loadBookmarks(): BookmarkEntry[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveBookmarks(b: BookmarkEntry[]) {
  try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(b)); } catch {}
}
function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
function pushRecent(addr: string) {
  try {
    const cur = loadRecents().filter((x) => lc(x) !== lc(addr));
    cur.unshift(lc(addr));
    localStorage.setItem(RECENTS_KEY, JSON.stringify(cur.slice(0, 10)));
  } catch {}
}

function blocksToHuman(blocks: number): string {
  if (!Number.isFinite(blocks) || blocks <= 0) return "now";
  const secs = blocks * BLOCK_TIME_SECS;
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  const days = Math.floor(secs / 86400);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function fmtNum(n: number | string, decimals = 2): string {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(num)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(num);
}

function kindLabel(kind: any): string {
  if (!kind) return "Tx";
  if (typeof kind === "string") return kind;
  if (typeof kind === "object") {
    const key = Object.keys(kind)[0];
    if (!key) return "Tx";
    const inner = kind[key];
    if (inner && typeof inner === "object") {
      const sub = Object.keys(inner)[0];
      return sub ? `${key}.${sub}` : key;
    }
    return key;
  }
  return "Tx";
}

// Classify an address into one or more semantic roles (a wallet can be both
// "validator" and "multisig" etc — we collect every match).
function classifyAddress(opts: {
  addr: string;
  admin?: string;
  governor?: string;
  validator?: ValidatorRes | null;
  multisigsOwned: number;
  isMultisigItself: boolean;
  hasContractCode: boolean;
}): AddressRole[] {
  const a = lc(opts.addr);
  const roles: AddressRole[] = [];
  if (a === AMM_POOL_ADDRESS) roles.push("amm");
  if (a === REWARDS_POOL_ADDRESS) roles.push("rewards");
  if (a === BURN_ADDRESS) roles.push("burn");
  if (a === BRIDGE_LOCK_ADDRESS) roles.push("bridge");
  if (opts.admin && lc(opts.admin) === a) roles.push("admin");
  if (opts.governor && lc(opts.governor) === a) roles.push("governor");
  if (opts.validator) roles.push("validator");
  if (opts.isMultisigItself) roles.push("multisig");
  if (opts.hasContractCode) roles.push("contract");
  if (roles.length === 0) roles.push("regular");
  return roles;
}

const ROLE_META: Record<AddressRole, { label: string; color: string; icon: React.ElementType; tip: string }> = {
  regular:   { label: "Regular Wallet",      color: "text-slate-300 bg-slate-500/15 border-slate-500/30",  icon: Wallet,    tip: "secp256k1 EOA — no contract code, no special protocol role" },
  amm:       { label: "AMM Pool",            color: "text-cyan-300 bg-cyan-500/15 border-cyan-500/30",     icon: Droplets,  tip: "Protocol-reserved magic address — pool reserves live in a separate column family, not as account balance" },
  rewards:   { label: "Block Reward Pool",   color: "text-amber-300 bg-amber-500/15 border-amber-500/30",  icon: Gift,      tip: "Magic address where validator block rewards are minted from (`rwds` ASCII)" },
  burn:      { label: "Burn Address",        color: "text-rose-300 bg-rose-500/15 border-rose-500/30",     icon: Flame,     tip: "Permanent burn sink — anything sent here is removed from circulating supply forever" },
  bridge:    { label: "Bridge Lock",         color: "text-violet-300 bg-violet-500/15 border-violet-500/30", icon: Anchor,    tip: "Cross-chain bridge custody address — holds locked assets backing wrapped tokens on other chains" },
  admin:     { label: "Admin",               color: "text-fuchsia-300 bg-fuchsia-500/15 border-fuchsia-500/30", icon: Crown, tip: "Current chain admin (treasury + AMM init + bridge configuration)" },
  governor:  { label: "Governor",            color: "text-pink-300 bg-pink-500/15 border-pink-500/30",     icon: Shield,    tip: "Current chain governor (validator-set ops + governance controls)" },
  validator: { label: "Validator",           color: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30", icon: Server, tip: "Active in the consensus validator set — earns block rewards" },
  multisig:  { label: "Multisig Wallet",     color: "text-sky-300 bg-sky-500/15 border-sky-500/30",        icon: Landmark,  tip: "On-chain M-of-N multisig — funds can move only when ≥M owners co-sign" },
  contract:  { label: "ZVM Contract",        color: "text-indigo-300 bg-indigo-500/15 border-indigo-500/30", icon: FileCode2, tip: "Has deployed bytecode at this address (ZVM)" },
};

// ────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────────────────────
export default function BalanceLookup() {
  const initialAddr = readQueryAddr() ?? "0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc";
  const [, navigate] = useLocation();

  const [addr, setAddr] = useState(initialAddr);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [data, setData] = useState<{
    liquid: string;
    delegations: DelegationsRes | null;
    locked: LockedRes | null;
    nonce: number;
    payId: string | null;
    payIdName: string | null;
    zusd: string;
    priceUsd: number;
    lpBalance: string;
    poolState: PoolStateRes | null;
    admin: string | null;
    governor: string | null;
    validator: ValidatorRes | null;
    stakingValidator: StakingValidatorRes | null;
    multisigsOwned: string[];
    isMultisigItself: boolean;
    multisigInfo: { owners: string[]; threshold: number; created_height: number; proposal_seq: number } | null;
    contractCode: string | null;
    chainTip: number;
  } | null>(null);

  // Mempool pending
  const [mempool, setMempool] = useState<MempoolPendingRes | null>(null);
  const [mempoolErr, setMempoolErr] = useState<string | null>(null);

  // Tx scan
  const [scanning, setScanning] = useState(false);
  const [scannedRange, setScannedRange] = useState(0);
  const [txs, setTxs] = useState<OnchainTx[]>([]);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [txFilter, setTxFilter] = useState<"all" | "transfer" | "staking" | "swap" | "bridge" | "multisig">("all");

  // UX
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(() => loadBookmarks());
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  const cancelRef = useRef(false);

  // ──────────────────────────────────────────────────────────────────────────
  // Address validation
  // ──────────────────────────────────────────────────────────────────────────
  const trimmedAddr = addr.trim();
  const validFmt = /^0x[0-9a-fA-F]{40}$/.test(trimmedAddr);
  const fmtReason = useMemo(() => {
    if (validFmt) return "";
    if (!trimmedAddr) return "";
    if (!/^0x/i.test(trimmedAddr)) return "address must start with 0x";
    if (!/^0x[0-9a-fA-F]*$/.test(trimmedAddr)) return "address must be hex (0-9, a-f) only";
    return `address must be exactly 40 hex chars after 0x — got ${trimmedAddr.slice(2).length}`;
  }, [trimmedAddr, validFmt]);

  // ──────────────────────────────────────────────────────────────────────────
  // Lookup — fans out 14 RPC calls in parallel
  // ──────────────────────────────────────────────────────────────────────────
  async function lookup() {
    if (!validFmt) return;
    setLoading(true); setErr(null);
    const a = trimmedAddr;
    try {
      const isAmm = isMagicAddr(a, AMM_POOL_ADDRESS);
      const [
        bal, delegations, locked, nonce, payIdR, zusd, price, lpBal, poolState,
        adminR, governorR, validatorR, stakingValR, multisigsOwned, multisigSelf,
        codeR, tipR,
      ] = await Promise.all([
        rpc<string>("zbx_getBalance", [a]).catch(() => "0x0"),
        rpc<DelegationsRes>("zbx_getDelegationsByDelegator", [a]).catch(() => null),
        rpc<LockedRes>("zbx_getLockedRewards", [a]).catch(() => null),
        rpc<unknown>("zbx_getNonce", [a]).catch(() => 0),
        rpc<PayIdRes>("zbx_getPayIdOf", [a]).catch(() => null),
        rpc<string>("zbx_getZusdBalance", [a]).catch(() => "0x0"),
        rpc<{ zbx_usd: string }>("zbx_getPriceUSD")
          .then((r) => parseFloat(r?.zbx_usd ?? "0"))
          .catch(() => 0),
        rpc<string>("zbx_getLpBalance", [a]).catch(() => "0"),
        isAmm ? rpc<PoolStateRes>("zbx_getPool").catch(() => null) : Promise.resolve<PoolStateRes | null>(null),
        rpc<AdminRes>("zbx_getAdmin").catch(() => null),
        rpc<GovernorRes>("zbx_getGovernor").catch(() => null),
        rpc<ValidatorRes | null>("zbx_getValidator", [a]).catch(() => null),
        rpc<StakingValidatorRes | null>("zbx_getStakingValidator", [a]).catch(() => null),
        rpc<string[]>("zbx_listMultisigsByOwner", [a]).catch(() => []),
        rpc<{ owners: string[]; threshold: number; created_height: number; proposal_seq: number }>("zbx_getMultisig", [a])
          .then((r) => r ?? null)
          .catch((e) => {
            // -32004 = not a multisig; that's fine
            if (e instanceof ZbxRpcError && e.code === -32004) return null;
            return null;
          }),
        rpc<string>("eth_getCode", [a, "latest"]).catch(() => null),
        rpc<{ height: number }>("zbx_blockNumber").catch(() => ({ height: 0 })),
      ]);

      const hasCode = !!codeR && codeR !== "0x" && codeR !== "0x0";

      setData({
        liquid: bal,
        delegations,
        locked: normalizeLocked(locked),
        nonce: parseNonce(nonce),
        payId: payIdR?.pay_id ?? null,
        payIdName: payIdR?.name ?? null,
        zusd,
        priceUsd: price,
        lpBalance: lpBal,
        poolState,
        admin: adminR?.current_admin ?? null,
        governor: governorR?.current_governor ?? null,
        validator: validatorR ?? null,
        stakingValidator: stakingValR ?? null,
        multisigsOwned: Array.isArray(multisigsOwned) ? multisigsOwned : [],
        isMultisigItself: !!multisigSelf,
        multisigInfo: multisigSelf ?? null,
        contractCode: hasCode ? codeR : null,
        chainTip: tipR.height,
      });
      pushRecent(a);
      setRecents(loadRecents());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadMempool() {
    try {
      const m = await rpc<MempoolPendingRes>("zbx_mempoolPending", [500]);
      setMempool(m); setMempoolErr(null);
    } catch (e) {
      setMempoolErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function scanTxs(window: number) {
    if (scanning || !validFmt) return;
    setScanning(true); setScanErr(null); setTxs([]); cancelRef.current = false;
    try {
      const tip = await rpc<{ height: number }>("zbx_blockNumber");
      const tipH = tip.height;
      const lower = lc(addr);
      const heights: number[] = [];
      for (let i = 0; i < window; i++) {
        const h = tipH - i;
        if (h >= 0) heights.push(h);
      }
      const CONC = 16;
      const found: OnchainTx[] = [];
      for (let i = 0; i < heights.length; i += CONC) {
        if (cancelRef.current) break;
        const slice = heights.slice(i, i + CONC);
        const results = await Promise.all(slice.map(async (h) => {
          try {
            const r = await rpc<any>("zbx_getBlockByNumber", [h]);
            if (!r) return null;
            const hdr = r.header ?? r;
            const tx = Array.isArray(r.txs) ? r.txs : [];
            return { h, ts: hdr.timestamp_ms ?? 0, txs: tx };
          } catch { return null; }
        }));
        for (const x of results) {
          if (!x || !x.txs.length) continue;
          for (const t of x.txs) {
            const body = t.body ?? t;
            const from = lc(body.from ?? "");
            const to = lc(body.to ?? "");
            const kindStr = JSON.stringify(body.kind ?? "").toLowerCase();
            if (from === lower || to === lower || kindStr.includes(lower)) {
              found.push({
                height: x.h, ts: x.ts,
                from: body.from ?? "", to: body.to ?? "",
                amount_wei: typeof body.amount === "number" ? body.amount.toString() : String(body.amount ?? "0"),
                fee_wei: typeof body.fee === "number" ? body.fee.toString() : String(body.fee ?? "0"),
                kind: kindLabel(body.kind),
              });
            }
          }
        }
        if (found.length >= 100) break;
      }
      found.sort((a, b) => b.height - a.height);
      setTxs(found.slice(0, 100));
      setScannedRange(window);
    } catch (e) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Effects
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    lookup(); scanTxs(500); loadMempool();
    return () => { cancelRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      if (validFmt) { lookup(); loadMempool(); }
    }, 15000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, validFmt, addr]);

  // ──────────────────────────────────────────────────────────────────────────
  // Derived
  // ──────────────────────────────────────────────────────────────────────────
  const totalWei = useMemo((): bigint => {
    if (!data) return 0n;
    try {
      const liquid = BigInt(data.liquid);
      const staked = data.delegations?.total_value_wei ? BigInt(data.delegations.total_value_wei) : 0n;
      const locked = (() => {
        const v = data.locked?.locked_balance_wei ?? data.locked?.locked_wei;
        return v ? BigInt(v) : 0n;
      })();
      return liquid + staked + locked;
    } catch { return 0n; }
  }, [data]);

  const totalZbx = weiHexToZbx(totalWei);
  const totalUsd = data ? weiToUsd(totalWei, data.priceUsd) : 0;

  const roles: AddressRole[] = useMemo(() => {
    if (!data) return ["regular"];
    return classifyAddress({
      addr,
      admin: data.admin ?? undefined,
      governor: data.governor ?? undefined,
      validator: data.validator,
      multisigsOwned: data.multisigsOwned.length,
      isMultisigItself: data.isMultisigItself,
      hasContractCode: !!data.contractCode,
    });
  }, [data, addr]);

  // Filter mempool by this address
  const mempoolForAddr = useMemo(() => {
    if (!mempool) return [];
    const lower = lc(addr);
    return mempool.txs.filter((t) => lc(t.from) === lower || lc(t.to) === lower);
  }, [mempool, addr]);

  // Filter txs by kind
  const filteredTxs = useMemo(() => {
    if (txFilter === "all") return txs;
    return txs.filter((t) => {
      const k = t.kind.toLowerCase();
      switch (txFilter) {
        case "transfer": return k.startsWith("transfer");
        case "staking":  return k.startsWith("staking");
        case "swap":     return k.startsWith("swap");
        case "bridge":   return k.startsWith("bridge");
        case "multisig": return k.startsWith("multisig");
        default: return true;
      }
    });
  }, [txs, txFilter]);

  // ──────────────────────────────────────────────────────────────────────────
  // Bookmarks
  // ──────────────────────────────────────────────────────────────────────────
  function addBookmark(label: string) {
    const a = lc(addr);
    if (!validFmt) return;
    const next = [{ addr: a, label: label || shortAddr(a, 6, 4), addedAt: Date.now() }, ...bookmarks.filter((b) => b.addr !== a)];
    setBookmarks(next); saveBookmarks(next);
  }
  function removeBookmark(a: string) {
    const next = bookmarks.filter((b) => b.addr !== lc(a));
    setBookmarks(next); saveBookmarks(next);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Export JSON snapshot
  // ──────────────────────────────────────────────────────────────────────────
  function exportSnapshot() {
    if (!data) return;
    const snap = {
      address: addr, captured_at: new Date().toISOString(), chain_tip: data.chainTip,
      roles, totals: { wei: totalWei.toString(), zbx: totalZbx, usd: totalUsd, price_usd_per_zbx: data.priceUsd },
      balances: { liquid_wei: data.liquid, staked_wei: data.delegations?.total_value_wei ?? "0",
                  locked_wei: data.locked?.locked_balance_wei ?? data.locked?.locked_wei ?? "0",
                  zusd: data.zusd, lp: data.lpBalance },
      identity: { pay_id: data.payId, pay_id_name: data.payIdName, nonce: data.nonce,
                  is_admin: roles.includes("admin"), is_governor: roles.includes("governor"),
                  validator: data.validator, staking_validator: data.stakingValidator,
                  multisigs_owned: data.multisigsOwned, is_multisig_itself: data.isMultisigItself,
                  multisig_info: data.multisigInfo, has_contract_code: !!data.contractCode },
      delegations: data.delegations?.delegations ?? [],
      locked_full: data.locked, mempool_pending: mempoolForAddr,
      recent_txs_scanned: { range_blocks: scannedRange, count: txs.length, txs },
    };
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `zbx-balance-${addr.slice(2, 10)}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function copyAddr() {
    navigator.clipboard.writeText(addr);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2 flex items-center gap-2">
            <Wallet className="h-7 w-7 text-primary" />
            Balance Lookup
          </h1>
          <p className="text-sm text-muted-foreground">
            Aggregate live state for any Zebvix address — balances, identity, roles, mempool, history. Fans out 17 RPC calls in parallel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-border bg-card hover:bg-muted/30 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-primary" />
            <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? "text-emerald-400 animate-spin" : "text-muted-foreground"}`} />
            <span>auto 15s</span>
          </label>
          <button
            onClick={() => { lookup(); loadMempool(); scanTxs(scannedRange || 500); }}
            disabled={loading}
            className="px-3 py-2 rounded-md bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> refresh
          </button>
          <button
            onClick={exportSnapshot} disabled={!data}
            className="px-3 py-2 rounded-md bg-muted hover:bg-muted/70 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
            title="Download full state snapshot as JSON"
          >
            <Download className="h-3.5 w-3.5" /> export JSON
          </button>
        </div>
      </div>

      {/* ADDRESS INPUT */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value.trim())}
            placeholder="0x... 40 hex chars (Zebvix address)"
            className={`flex-1 px-3 py-2 rounded-md bg-background border font-mono text-sm focus:outline-none focus:ring-2 ${
              !validFmt && trimmedAddr ? "border-rose-500/50 focus:ring-rose-500" : "border-border focus:ring-primary"}`}
            onKeyDown={(e) => { if (e.key === "Enter" && validFmt) { lookup(); scanTxs(500); loadMempool(); } }}
          />
          <button
            onClick={() => { lookup(); scanTxs(500); loadMempool(); }}
            disabled={loading || !validFmt}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm disabled:opacity-40 hover:bg-primary/90 flex items-center gap-2"
            title={!validFmt && trimmedAddr ? fmtReason : ""}
          >
            <Search className="h-4 w-4" /> {loading ? "…" : "Lookup"}
          </button>
          <button
            onClick={copyAddr} disabled={!validFmt}
            className="px-3 py-2 rounded-md bg-muted hover:bg-muted/70 text-xs disabled:opacity-40"
            title="copy address"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        {!validFmt && trimmedAddr && (
          <div className="text-xs text-rose-400 flex items-center gap-1.5 pl-1">
            <AlertCircle className="h-3 w-3" /> {fmtReason}
          </div>
        )}
        {validFmt && !loading && (
          <div className="text-xs text-emerald-400/70 flex items-center gap-1.5 pl-1">
            <Check className="h-3 w-3" /> valid address format
          </div>
        )}

        {/* RECENTS + BOOKMARKS QUICK BAR */}
        <RecentsBar
          recents={recents} bookmarks={bookmarks}
          onPick={(a) => { setAddr(a); setTimeout(() => { lookup(); scanTxs(500); loadMempool(); }, 0); }}
          onAddBookmark={addBookmark} onRemoveBookmark={removeBookmark}
          currentAddr={validFmt ? addr : ""}
        />
      </div>

      {err && (
        <div className="p-3 rounded-md border border-rose-500/40 bg-rose-500/5 text-sm flex gap-2">
          <AlertCircle className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
          <code className="text-xs">{err}</code>
        </div>
      )}

      {data && (
        <>
          {/* ROLES BANNER */}
          <RolesBanner roles={roles} />

          {/* GRAND TOTAL */}
          <div className="p-5 rounded-lg border-2 border-primary/30 bg-primary/5">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
              <div className="text-xs text-muted-foreground">GRAND TOTAL</div>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span>chain tip <code className="text-primary">#{data.chainTip.toLocaleString()}</code></span>
                <span>ZBX price <span className="font-mono text-primary">${data.priceUsd.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}</span></span>
              </div>
            </div>
            <div className="text-4xl font-bold text-primary tabular-nums">
              {totalZbx} <span className="text-lg text-muted-foreground">ZBX</span>
            </div>
            <div className="text-2xl font-semibold text-emerald-400 tabular-nums mt-1">
              ≈ {fmtUsd(totalUsd)}
            </div>
            <div className="mt-3 flex items-center gap-4 flex-wrap text-xs">
              {data.payId && (
                <span>Pay-ID: <code className="text-primary font-semibold">{data.payId}</code>{data.payIdName && <span className="text-muted-foreground"> ({data.payIdName})</span>}</span>
              )}
              <span>Nonce: <code className="text-primary">{data.nonce}</code></span>
              <span className="text-muted-foreground">total = liquid + staked + locked rewards</span>
            </div>
          </div>

          {/* SPECIAL ADDRESS BANNER (AMM / Rewards) */}
          {(roles.includes("amm") || roles.includes("rewards")) && (
            <SpecialAddressBanner
              kind={roles.includes("amm") ? "amm" : "rewards"}
              poolState={data.poolState}
              priceUsd={data.priceUsd}
            />
          )}

          {/* BURN ADDRESS BANNER */}
          {roles.includes("burn") && <BurnBanner liquidWei={data.liquid} priceUsd={data.priceUsd} />}

          {/* BALANCE GRID */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            <BalCard icon={Wallet} label="Liquid ZBX" wei={data.liquid} color="text-blue-400" priceUsd={data.priceUsd} />
            <BalCard icon={TrendingUp} label="Staked" wei={data.delegations?.total_value_wei ?? "0"} color="text-emerald-400" priceUsd={data.priceUsd} />
            <BalCard
              icon={Lock} label="Locked Rewards"
              wei={data.locked?.locked_balance_wei ?? data.locked?.locked_wei ?? "0"}
              color="text-amber-400" priceUsd={data.priceUsd}
            />
            <BalCard icon={Banknote} label="zUSD" wei={data.zusd} color="text-violet-400" priceUsd={1} unit="zUSD" />
          </div>

          {/* LP TOKENS — surface when held */}
          {data.lpBalance && data.lpBalance !== "0" && data.lpBalance !== "0x0" && (
            <LpCard lpBalance={data.lpBalance} isAmm={roles.includes("amm")} poolState={data.poolState} />
          )}

          {/* IDENTITY & ROLES — Pay-ID, Validator, Multisigs Owned, Contract */}
          <IdentityPanel
            data={data}
            addr={addr}
            roles={roles}
            onInspectMultisig={(a) => navigate(`/multisig-explorer?addr=${a}`)}
          />

          {/* REWARD DRIP DETAILS — full preview_unlock view */}
          {data.locked && (
            (data.locked.stake_wei && data.locked.stake_wei !== "0") ||
            (data.locked.locked_balance_wei && data.locked.locked_balance_wei !== "0") ||
            (data.locked.claimable_now_wei && data.locked.claimable_now_wei !== "0")
          ) && (
            <DripPanel locked={data.locked} priceUsd={data.priceUsd} />
          )}

          {/* MEMPOOL PENDING */}
          <MempoolPanel
            txs={mempoolForAddr}
            totalSize={mempool?.size ?? 0}
            err={mempoolErr}
            ownAddr={addr}
            onRefresh={loadMempool}
          />

          {/* DELEGATIONS TABLE */}
          {data.delegations?.delegations && data.delegations.delegations.length > 0 && (
            <DelegationsTable d={data.delegations} priceUsd={data.priceUsd} />
          )}

          {/* RECENT ON-CHAIN ACTIVITY */}
          <ActivityPanel
            txs={filteredTxs} totalCount={txs.length}
            scannedRange={scannedRange} scanning={scanning} scanErr={scanErr}
            txFilter={txFilter} setTxFilter={setTxFilter}
            ownAddr={addr}
            onScan={scanTxs}
          />
        </>
      )}
    </div>
  );
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

function RecentsBar({
  recents, bookmarks, onPick, onAddBookmark, onRemoveBookmark, currentAddr,
}: {
  recents: string[]; bookmarks: BookmarkEntry[]; currentAddr: string;
  onPick: (a: string) => void; onAddBookmark: (label: string) => void; onRemoveBookmark: (a: string) => void;
}) {
  const [labelInput, setLabelInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const isBookmarked = bookmarks.some((b) => b.addr === lc(currentAddr));

  if (recents.length === 0 && bookmarks.length === 0 && !currentAddr) return null;

  return (
    <div className="rounded-md border border-border bg-card/40 p-2 space-y-2">
      {bookmarks.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-amber-400/70 font-semibold flex items-center gap-1 pl-1">
            <Star className="h-3 w-3" /> bookmarks
          </span>
          {bookmarks.map((b) => (
            <div key={b.addr} className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 group">
              <button onClick={() => onPick(b.addr)} className="text-amber-300 hover:text-amber-200" title={b.addr}>
                <span className="font-semibold">{b.label}</span>
                <span className="text-amber-400/50 font-mono ml-1.5">{shortAddr(b.addr, 4, 3)}</span>
              </button>
              <button onClick={() => onRemoveBookmark(b.addr)} className="opacity-0 group-hover:opacity-70 hover:opacity-100 text-rose-400" title="remove">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {recents.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1 pl-1">
            <History className="h-3 w-3" /> recent
          </span>
          {recents.slice(0, 8).map((a) => (
            <button key={a} onClick={() => onPick(a)} className="px-2 py-1 rounded text-xs font-mono bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground" title={a}>
              {shortAddr(a, 6, 4)}
            </button>
          ))}
        </div>
      )}
      {currentAddr && !isBookmarked && (
        <div>
          {!showAdd ? (
            <button onClick={() => setShowAdd(true)} className="text-[11px] text-amber-400/70 hover:text-amber-300 flex items-center gap-1 pl-1">
              <BookmarkPlus className="h-3 w-3" /> bookmark this address
            </button>
          ) : (
            <div className="flex items-center gap-2 pl-1">
              <input
                value={labelInput} onChange={(e) => setLabelInput(e.target.value)}
                placeholder="label (e.g. 'Treasury')"
                className="flex-1 px-2 py-1 rounded bg-background border border-border text-xs"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") { onAddBookmark(labelInput); setLabelInput(""); setShowAdd(false); } }}
              />
              <button onClick={() => { onAddBookmark(labelInput); setLabelInput(""); setShowAdd(false); }}
                className="px-2 py-1 rounded text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-300">save</button>
              <button onClick={() => { setShowAdd(false); setLabelInput(""); }}
                className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground">×</button>
            </div>
          )}
        </div>
      )}
      {currentAddr && isBookmarked && (
        <div className="text-[11px] text-amber-400/70 pl-1 flex items-center gap-1">
          <Check className="h-3 w-3" /> bookmarked
        </div>
      )}
    </div>
  );
}

function RolesBanner({ roles }: { roles: AddressRole[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold pr-1">classified as</span>
          {roles.map((r) => {
            const m = ROLE_META[r];
            const Icon = m.icon;
            return (
              <span key={r} className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold border ${m.color}`} title={m.tip}>
                <Icon className="h-3.5 w-3.5" /> {m.label}
              </span>
            );
          })}
        </div>
        <div className="text-[11px] text-muted-foreground italic">
          {roles.length === 1 && roles[0] === "regular" ? "no special protocol role detected" : `${roles.length} role${roles.length > 1 ? "s" : ""} detected`}
        </div>
      </div>
    </div>
  );
}

function BalCard({ icon: Icon, label, wei, color, priceUsd, unit = "ZBX" }: {
  icon: React.ElementType; label: string; wei: string; color: string; priceUsd: number; unit?: string;
}) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className={`h-3.5 w-3.5 ${color}`} /> {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{weiHexToZbx(wei)}</div>
      <div className="text-xs text-muted-foreground mt-0.5 flex justify-between">
        <span>{unit}</span>
        <span className="font-mono">≈ {fmtUsd(weiToUsd(wei, priceUsd))}</span>
      </div>
    </div>
  );
}

function LpCard({ lpBalance, isAmm, poolState }: { lpBalance: string; isAmm: boolean; poolState: PoolStateRes | null }) {
  let lpAmount = 0;
  try { lpAmount = Number(BigInt(lpBalance)) / 1e18; } catch {}
  let totalSupply = 0;
  try { totalSupply = Number(BigInt(poolState?.lp_supply ?? "0")) / 1e18; } catch {}
  return (
    <div className="p-4 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
      <div className="flex items-center gap-2 text-xs text-cyan-300 mb-1">
        <Droplets className="h-3.5 w-3.5" /> LP TOKENS HELD
        {isAmm && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/20 text-cyan-300">
            permanent lock
          </span>
        )}
      </div>
      <div className="text-2xl font-bold tabular-nums text-cyan-300">
        {fmtNum(lpAmount, lpAmount < 0.0001 ? 6 : 4)}
        <span className="text-sm text-muted-foreground ml-1">LP</span>
      </div>
      {isAmm && poolState?.lp_supply && (
        <div className="text-xs text-muted-foreground mt-0.5">
          100% of total LP supply ({fmtNum(totalSupply, 2)} LP) — provably locked, never redeemable
        </div>
      )}
    </div>
  );
}

function IdentityPanel({
  data, addr, roles, onInspectMultisig,
}: {
  data: NonNullable<ReturnType<typeof useState<any>>[0]>; addr: string; roles: AddressRole[];
  onInspectMultisig: (a: string) => void;
}) {
  const hasAny = data.payId || data.validator || data.stakingValidator ||
    data.multisigsOwned.length > 0 || data.isMultisigItself || data.contractCode;
  if (!hasAny) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="text-sm font-semibold flex items-center gap-2">
        <Hash className="h-4 w-4 text-primary" /> On-Chain Identity
      </div>

      {/* Pay-ID */}
      {data.payId && (
        <div className="flex items-start gap-3 p-3 rounded border border-primary/20 bg-primary/5">
          <Hash className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">PAY-ID</div>
            <div className="font-mono text-primary font-semibold">{data.payId}</div>
            {data.payIdName && <div className="text-xs text-muted-foreground mt-0.5">{data.payIdName}</div>}
          </div>
        </div>
      )}

      {/* Validator */}
      {data.validator && (
        <div className="flex items-start gap-3 p-3 rounded border border-emerald-500/30 bg-emerald-500/5">
          <Server className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-emerald-400/70">CONSENSUS VALIDATOR</div>
            <div className="text-sm font-semibold text-emerald-300">Active in validator set</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2 text-xs">
              <div>
                <div className="text-[10px] text-muted-foreground">Voting Power</div>
                <div className="font-mono text-emerald-300 font-semibold">{data.validator.voting_power.toLocaleString()}</div>
              </div>
              {data.stakingValidator && (
                <>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Total Stake</div>
                    <div className="font-mono">{weiHexToZbx(data.stakingValidator.total_stake_wei)} ZBX</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Commission</div>
                    <div className="font-mono">{(data.stakingValidator.commission_bps / 100).toFixed(2)}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Operator</div>
                    <div className="font-mono text-xs">{shortAddr(data.stakingValidator.operator, 6, 4)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Commission Pool</div>
                    <div className="font-mono">{weiHexToZbx(data.stakingValidator.commission_pool_wei)} ZBX</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Status</div>
                    <div className={data.stakingValidator.jailed ? "text-rose-400 font-semibold" : "text-emerald-400 font-semibold"}>
                      {data.stakingValidator.jailed ? `JAILED until epoch ${data.stakingValidator.jailed_until_epoch}` : "ACTIVE"}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground font-mono break-all">
              pubkey: {data.validator.pubkey}
            </div>
          </div>
        </div>
      )}

      {/* Multisig itself */}
      {data.isMultisigItself && data.multisigInfo && (
        <div className="flex items-start gap-3 p-3 rounded border border-sky-500/30 bg-sky-500/5">
          <Landmark className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-sky-400/70">MULTISIG WALLET</div>
            <div className="text-sm font-semibold text-sky-300">
              {data.multisigInfo.threshold}-of-{data.multisigInfo.owners.length} multisig
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
              <div>
                <div className="text-[10px] text-muted-foreground">Owners</div>
                <div className="font-mono">{data.multisigInfo.owners.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">Threshold</div>
                <div className="font-mono">{data.multisigInfo.threshold}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">Created at</div>
                <div className="font-mono">#{data.multisigInfo.created_height.toLocaleString()}</div>
              </div>
            </div>
            <div className="mt-2 text-xs">
              <div className="text-[10px] text-muted-foreground mb-1">Owners:</div>
              <div className="flex flex-wrap gap-1">
                {data.multisigInfo.owners.map((o: string) => (
                  <code key={o} className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-mono text-[10px]" title={o}>
                    {shortAddr(o, 6, 4)}
                  </code>
                ))}
              </div>
            </div>
            <button onClick={() => onInspectMultisig(addr)}
              className="mt-2 text-[11px] text-sky-300 hover:text-sky-200 flex items-center gap-1">
              open in Multisig Explorer <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Multisigs Owned */}
      {data.multisigsOwned.length > 0 && (
        <div className="flex items-start gap-3 p-3 rounded border border-sky-500/20 bg-sky-500/5">
          <Landmark className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-sky-400/70">MULTISIGS WHERE THIS ADDRESS IS AN OWNER</div>
            <div className="text-sm font-semibold text-sky-300 mb-2">
              {data.multisigsOwned.length} multisig{data.multisigsOwned.length > 1 ? "s" : ""}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.multisigsOwned.map((m: string) => (
                <button key={m}
                  onClick={() => onInspectMultisig(m)}
                  className="px-2 py-1 rounded text-xs font-mono bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 flex items-center gap-1"
                  title={`open ${m} in Multisig Explorer`}
                >
                  {shortAddr(m, 8, 6)} <ChevronRight className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Contract code */}
      {data.contractCode && (
        <div className="flex items-start gap-3 p-3 rounded border border-indigo-500/30 bg-indigo-500/5">
          <FileCode2 className="h-4 w-4 text-indigo-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-indigo-400/70">ZVM CONTRACT</div>
            <div className="text-sm font-semibold text-indigo-300">
              Deployed bytecode — {Math.floor((data.contractCode.length - 2) / 2).toLocaleString()} bytes
            </div>
            <div className="mt-2 font-mono text-[10px] text-muted-foreground break-all bg-background/40 p-2 rounded max-h-24 overflow-y-auto">
              {data.contractCode.slice(0, 200)}{data.contractCode.length > 200 ? "…" : ""}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DripPanel({ locked, priceUsd }: { locked: LockedRes; priceUsd: number }) {
  const claimable = locked.claimable_now_wei ?? "0";
  const lockedAfter = locked.locked_after_claim_wei ?? "0";
  const dailyDrip = locked.daily_drip_wei ?? "0";
  const totalReleased = locked.total_released_wei ?? locked.released_wei ?? "0";
  const nextBulk = locked.next_bulk_height ?? 0;
  const blocksToBulk = locked.blocks_to_next_bulk ?? 0;
  const stake = locked.stake_wei ?? "0";

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-amber-300">Reward Drip & Unlock Schedule</h3>
        <span className="text-[10px] text-muted-foreground">staking.rs::preview_unlock</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DripStat label="Claimable Now" value={`${weiHexToZbx(claimable)} ZBX`} sub={`≈ ${fmtUsd(weiToUsd(claimable, priceUsd))}`} tone="emerald" highlight />
        <DripStat label="Daily Drip" value={`${weiHexToZbx(dailyDrip)} ZBX`} sub={`${(DRIP_BPS_PER_DAY / 100).toFixed(2)}% of stake / day`} tone="amber" />
        <DripStat label="Locked (after claim)" value={`${weiHexToZbx(lockedAfter)} ZBX`} sub={`≈ ${fmtUsd(weiToUsd(lockedAfter, priceUsd))}`} tone="slate" />
        <DripStat label="Total Released" value={`${weiHexToZbx(totalReleased)} ZBX`} sub="lifetime claimed" tone="cyan" />
      </div>

      {nextBulk > 0 && (
        <div className="rounded border border-amber-500/20 bg-background/40 p-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              <span className="text-xs text-amber-300 font-semibold">Next Bulk Release</span>
              <span className="text-[10px] text-muted-foreground">
                ({(BULK_RELEASE_BPS / 100).toFixed(0)}% per {fmtNum(BULK_INTERVAL_BLOCKS / BLOCKS_PER_DAY, 0)} days)
              </span>
            </div>
            <div className="text-xs flex items-center gap-3">
              <span>at <code className="text-amber-300 font-mono">#{nextBulk.toLocaleString()}</code></span>
              <span className="text-muted-foreground">in <span className="text-amber-300 font-mono">{blocksToHuman(blocksToBulk)}</span></span>
              <span className="text-muted-foreground">({blocksToBulk.toLocaleString()} blocks)</span>
            </div>
          </div>
        </div>
      )}

      <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-0.5 shrink-0 opacity-70" />
        <span>
          Locked rewards unlock via two mechanisms in parallel: (1) a smooth daily drip of <code>{(DRIP_BPS_PER_DAY / 100).toFixed(2)}%</code> of current stake per day,
          and (2) a bulk <code>{(BULK_RELEASE_BPS / 100).toFixed(0)}%</code> release every <code>{(BULK_INTERVAL_BLOCKS / BLOCKS_PER_DAY).toFixed(0)} days</code>.
          Stake-weighted: current effective stake is <code className="text-amber-300">{weiHexToZbx(stake)} ZBX</code>.
        </span>
      </div>
    </div>
  );
}

function DripStat({ label, value, sub, tone, highlight = false }: {
  label: string; value: string; sub?: string; tone: "emerald" | "amber" | "slate" | "cyan"; highlight?: boolean;
}) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-300", amber: "text-amber-300", slate: "text-slate-300", cyan: "text-cyan-300",
  };
  return (
    <div className={`rounded border p-3 ${highlight ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-background/40"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${colors[tone]}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function MempoolPanel({ txs, totalSize, err, ownAddr, onRefresh }: {
  txs: MempoolPendingRes["txs"]; totalSize: number; err: string | null;
  ownAddr: string; onRefresh: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-400" />
          Mempool Pending (this address)
          <span className="text-[10px] font-normal text-muted-foreground">
            {txs.length === 0 ? "none" : `${txs.length} pending`} · pool size {totalSize}
          </span>
        </h3>
        <button onClick={onRefresh} className="text-[11px] px-2 py-1 rounded bg-muted hover:bg-muted/70 flex items-center gap-1">
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </div>
      {err && <div className="p-3 text-xs text-rose-400">{err}</div>}
      {txs.length === 0 ? (
        <div className="p-4 text-center text-xs text-muted-foreground">
          no pending mempool txs involving this address
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-muted/20 text-muted-foreground">
            <tr>
              <th className="text-left p-2 font-medium">Hash</th>
              <th className="text-left p-2 font-medium">Kind</th>
              <th className="text-left p-2 font-medium">From</th>
              <th className="text-left p-2 font-medium">To</th>
              <th className="text-right p-2 font-medium">Amount</th>
              <th className="text-right p-2 font-medium">Fee</th>
              <th className="text-right p-2 font-medium">Nonce</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((t) => {
              const isFrom = lc(t.from) === lc(ownAddr);
              const isTo = lc(t.to) === lc(ownAddr);
              return (
                <tr key={t.hash} className="border-t border-border hover:bg-muted/20">
                  <td className="p-2 font-mono text-amber-400">{shortAddr(t.hash, 8, 4)}</td>
                  <td className="p-2"><KindBadge kind={t.kind} /></td>
                  <td className={`p-2 font-mono ${isFrom ? "text-amber-300 font-semibold" : "text-muted-foreground"}`}>
                    {isFrom && <ArrowUpFromLine className="inline h-3 w-3 mr-1" />}{shortAddr(t.from, 6, 4)}
                  </td>
                  <td className={`p-2 font-mono ${isTo ? "text-emerald-300 font-semibold" : "text-muted-foreground"}`}>
                    {isTo && <ArrowDownToLine className="inline h-3 w-3 mr-1" />}{shortAddr(t.to, 6, 4)}
                  </td>
                  <td className="p-2 text-right font-mono">{t.amount !== "0" ? `${weiHexToZbx(t.amount)} ZBX` : "—"}</td>
                  <td className="p-2 text-right font-mono text-amber-400">{weiHexToZbx(t.fee)}</td>
                  <td className="p-2 text-right font-mono">{t.nonce}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DelegationsTable({ d, priceUsd }: { d: DelegationsRes; priceUsd: number }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 text-sm font-semibold flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-emerald-400" />
        Delegations ({d.delegations?.length ?? 0})
        <span className="text-[10px] font-normal text-muted-foreground">
          total: {weiHexToZbx(d.total_value_wei ?? "0")} ZBX ≈ {fmtUsd(weiToUsd(d.total_value_wei ?? "0", priceUsd))}
        </span>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-muted/20 text-muted-foreground">
          <tr>
            <th className="text-left p-2 font-medium">Validator</th>
            <th className="text-right p-2 font-medium">Shares</th>
            <th className="text-right p-2 font-medium">Value (ZBX)</th>
            <th className="text-right p-2 font-medium">Value (USD)</th>
          </tr>
        </thead>
        <tbody>
          {(d.delegations ?? []).map((row) => (
            <tr key={row.validator} className="border-t border-border hover:bg-muted/20">
              <td className="p-2 font-mono">{row.validator}</td>
              <td className="p-2 text-right font-mono text-muted-foreground">{row.shares}</td>
              <td className="p-2 text-right font-mono text-emerald-400">{weiHexToZbx(row.value_wei)}</td>
              <td className="p-2 text-right font-mono">{fmtUsd(weiToUsd(row.value_wei, priceUsd))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityPanel({
  txs, totalCount, scannedRange, scanning, scanErr, txFilter, setTxFilter, ownAddr, onScan,
}: {
  txs: OnchainTx[]; totalCount: number; scannedRange: number; scanning: boolean; scanErr: string | null;
  txFilter: string; setTxFilter: (v: any) => void; ownAddr: string; onScan: (n: number) => void;
}) {
  const filters: Array<{ k: string; label: string }> = [
    { k: "all", label: "All" }, { k: "transfer", label: "Transfer" },
    { k: "staking", label: "Staking" }, { k: "swap", label: "Swap" },
    { k: "bridge", label: "Bridge" }, { k: "multisig", label: "Multisig" },
  ];
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Recent On-Chain Activity
          {scannedRange > 0 && (
            <span className="text-[10px] font-normal text-muted-foreground">
              ({txs.length}{txFilter !== "all" ? ` / ${totalCount}` : ""} hits in last {scannedRange.toLocaleString()} blocks)
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={() => onScan(500)} disabled={scanning}
            className="text-[11px] px-2 py-1 rounded bg-muted hover:bg-muted/70 disabled:opacity-40">
            {scanning ? "scanning…" : "scan 500"}
          </button>
          <button onClick={() => onScan(2000)} disabled={scanning}
            className="text-[11px] px-2 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40">
            {scanning ? "…" : "scan 2000"}
          </button>
          <button onClick={() => onScan(5000)} disabled={scanning}
            className="text-[11px] px-2 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-40">
            {scanning ? "…" : "scan 5000"}
          </button>
        </div>
      </div>

      {/* FILTER TABS */}
      <div className="flex border-b border-border overflow-x-auto">
        {filters.map((f) => (
          <button key={f.k} onClick={() => setTxFilter(f.k as any)}
            className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap ${
              txFilter === f.k
                ? "bg-primary/10 text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:bg-muted/40"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {scanErr && <div className="p-3 text-xs text-rose-400">{scanErr}</div>}
      {txs.length === 0 ? (
        <div className="p-8 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
          <div className="text-xs text-muted-foreground">
            {scanning ? "scanning blocks…" :
              scannedRange > 0
                ? txFilter !== "all"
                  ? `no ${txFilter} txs found in scanned window (try "All" or wider scan).`
                  : `no transactions found in last ${scannedRange.toLocaleString()} blocks. Try a wider scan.`
                : "ready to scan…"}
          </div>
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-muted/20 text-muted-foreground">
            <tr>
              <th className="text-left p-2 font-medium w-20">Block</th>
              <th className="text-left p-2 font-medium w-24">Kind</th>
              <th className="text-left p-2 font-medium">From</th>
              <th className="text-left p-2 font-medium">To</th>
              <th className="text-right p-2 font-medium">Amount</th>
              <th className="text-right p-2 font-medium">Fee</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((t, i) => {
              const lower = lc(ownAddr);
              const isFrom = lc(t.from) === lower;
              const isTo = lc(t.to) === lower;
              return (
                <tr key={`${t.height}-${i}`} className="border-t border-border hover:bg-muted/20">
                  <td className="p-2 font-mono text-primary">#{t.height}</td>
                  <td className="p-2"><KindBadge kind={t.kind} /></td>
                  <td className={`p-2 font-mono ${isFrom ? "text-amber-300 font-semibold" : "text-muted-foreground"}`}>
                    {isFrom && <ArrowUpFromLine className="inline h-3 w-3 mr-1" />}{shortAddr(t.from, 6, 4)}
                  </td>
                  <td className={`p-2 font-mono ${isTo ? "text-emerald-300 font-semibold" : "text-muted-foreground"}`}>
                    {isTo && <ArrowDownToLine className="inline h-3 w-3 mr-1" />}{shortAddr(t.to, 6, 4)}
                  </td>
                  <td className="p-2 text-right font-mono">
                    {t.amount_wei !== "0" ? `${weiHexToZbx(t.amount_wei)} ZBX` : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 text-right font-mono text-amber-400">{weiHexToZbx(t.fee_wei)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const k = kind.toLowerCase();
  let cls = "bg-violet-500/15 text-violet-400";
  if (k.startsWith("transfer")) cls = "bg-blue-500/15 text-blue-400";
  else if (k.startsWith("staking")) cls = "bg-emerald-500/15 text-emerald-400";
  else if (k.startsWith("swap")) cls = "bg-cyan-500/15 text-cyan-400";
  else if (k.startsWith("bridge")) cls = "bg-violet-500/15 text-violet-400";
  else if (k.startsWith("multisig")) cls = "bg-sky-500/15 text-sky-400";
  else if (k.startsWith("validator")) cls = "bg-fuchsia-500/15 text-fuchsia-400";
  else if (k.startsWith("governor")) cls = "bg-pink-500/15 text-pink-400";
  else if (k.startsWith("proposal")) cls = "bg-amber-500/15 text-amber-400";
  else if (k.startsWith("registerpayid")) cls = "bg-primary/15 text-primary";
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>{kind}</span>;
}

function BurnBanner({ liquidWei, priceUsd }: { liquidWei: string; priceUsd: number }) {
  return (
    <div className="p-5 rounded-lg border-2 border-rose-500/30 bg-rose-500/5">
      <div className="flex items-start gap-3">
        <Flame className="h-6 w-6 text-rose-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-rose-300 mb-0.5">Burn Address — protocol-reserved</div>
          <div className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5">
            <Info className="h-3 w-3 mt-0.5 shrink-0 opacity-70" />
            <span>
              Yeh burn sink hai (<code>burn..dead</code> ASCII bytes per <code>tokenomics::BURN_ADDRESS_HEX</code>). Yahan jo bhi ZBX bheji jaati hai woh permanent
              circulation se hat jaati hai — koi private key se kabhi access nahi hoga. Liquid balance neeche dikhaya hua wo hai jo ab tak burn ho chuki hai.
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-rose-500/20 bg-background/40 p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Total Burned</div>
              <div className="text-2xl font-bold text-rose-300 tabular-nums">{weiHexToZbx(liquidWei)} <span className="text-sm text-muted-foreground">ZBX</span></div>
              <div className="text-[10px] text-muted-foreground mt-0.5">≈ {fmtUsd(weiToUsd(liquidWei, priceUsd))} permanently removed</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpecialAddressBanner({ kind, poolState, priceUsd }: {
  kind: "amm" | "rewards"; poolState: PoolStateRes | null; priceUsd: number;
}) {
  const isAmm = kind === "amm";
  const Icon = isAmm ? Droplets : Gift;
  const wrapClass = isAmm
    ? "p-5 rounded-lg border-2 border-cyan-500/30 bg-cyan-500/5"
    : "p-5 rounded-lg border-2 border-amber-500/30 bg-amber-500/5";
  const iconClass = isAmm
    ? "h-6 w-6 text-cyan-400 shrink-0 mt-0.5"
    : "h-6 w-6 text-amber-400 shrink-0 mt-0.5";
  const titleClass = isAmm
    ? "text-sm font-semibold text-cyan-300 mb-0.5"
    : "text-sm font-semibold text-amber-300 mb-0.5";
  const title = isAmm ? "AMM Pool — protocol-reserved address" : "Block-reward Pool — protocol-reserved address";
  const note = isAmm
    ? "Yeh pool ka magic address hai (`zswap` ASCII bytes). Liquidity reserves yahan account-balance ke roop mein store nahi hote — wo Pool struct (alag column family) mein hain. `getBalance` 0 dikhata hai by design. Real reserves neeche dikhaye gaye hain."
    : "Yeh block-reward pool ka magic address hai (`rwds` ASCII bytes). Validator rewards yahan se mint hote hain — yeh emission source hai, regular wallet nahi.";

  let zbxReserveZbx = 0, zusdReserve = 0, lpSupply = 0, spotPrice = 0;
  if (isAmm && poolState) {
    try {
      zbxReserveZbx = Number(BigInt(poolState.zbx_reserve_wei ?? "0")) / 1e18;
      zusdReserve = Number(BigInt(poolState.zusd_reserve ?? "0")) / 1e18;
      lpSupply = Number(BigInt(poolState.lp_supply ?? "0")) / 1e18;
      spotPrice = parseFloat(poolState.spot_price_usd_per_zbx ?? "0");
    } catch {}
  }
  const zbxValueUsd = zbxReserveZbx * (spotPrice || priceUsd);
  const tvlUsd = zbxValueUsd + zusdReserve;

  return (
    <div className={wrapClass}>
      <div className="flex items-start gap-3">
        <Icon className={iconClass} />
        <div className="flex-1">
          <div className={titleClass}>{title}</div>
          <div className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5">
            <Info className="h-3 w-3 mt-0.5 shrink-0 opacity-70" />
            <span>{note}</span>
          </div>
        </div>
      </div>

      {isAmm && poolState && (
        <>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <ReserveStat label="ZBX reserve" value={`${fmtNum(zbxReserveZbx, 0)}`} unit="ZBX" sub={`≈ ${fmtUsd(zbxValueUsd)}`} tone="cyan" />
            <ReserveStat label="zUSD reserve" value={`${fmtNum(zusdReserve, 0)}`} unit="zUSD" sub={`≈ ${fmtUsd(zusdReserve)}`} tone="violet" />
            <ReserveStat label="Pool TVL" value={fmtUsd(tvlUsd)} sub="ZBX+zUSD combined" tone="emerald" />
            <ReserveStat label="Spot price" value={`$${fmtNum(spotPrice, 6)}`} unit="/ ZBX" sub={poolState.permissionless ? "permissionless swaps ON" : ""} tone="amber" />
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <Field label="LP supply (locked)" value={fmtNum(lpSupply, 2)} />
            <Field label="Init height" value={poolState.init_height ? `#${poolState.init_height}` : "—"} />
            <Field label="Fee" value={poolState.fee_pct ? `${poolState.fee_pct}%` : "—"} />
          </div>
        </>
      )}

      {isAmm && !poolState && (
        <div className="mt-4 text-xs text-amber-400/80">
          Pool state load nahi ho saka — RPC unreachable ya pool initialized nahi.
        </div>
      )}
    </div>
  );
}

function ReserveStat({ label, value, unit, sub, tone }: {
  label: string; value: string; unit?: string; sub?: string; tone: "cyan" | "violet" | "emerald" | "amber";
}) {
  const colorMap: Record<string, string> = {
    cyan: "text-cyan-300", violet: "text-violet-300", emerald: "text-emerald-300", amber: "text-amber-300",
  };
  return (
    <div className="rounded-md bg-background/40 border border-border/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${colorMap[tone]}`}>
        {value}{unit && <span className="text-xs text-muted-foreground ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}
