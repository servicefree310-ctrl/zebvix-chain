const RPC_PATH = "/api/rpc";

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class ZbxRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(e: RpcError) {
    super(e.message);
    this.code = e.code;
    this.data = e.data;
  }
}

export async function rpc<T = unknown>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const r = await fetch(RPC_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await r.json()) as { result?: T; error?: RpcError };
  if (json.error) throw new ZbxRpcError(json.error);
  return json.result as T;
}

// Add thousand separators to an integer string (handles leading minus)
function withCommas(intStr: string): string {
  const neg = intStr.startsWith("-");
  const s = neg ? intStr.slice(1) : intStr;
  const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return neg ? `-${out}` : out;
}

// Convert hex wei string ("0x...") to ZBX decimal string with up to 6 places
// and thousand separators on the integer part (e.g. "10,027,885.951666")
export function weiHexToZbx(hex: string | number | bigint): string {
  let n: bigint;
  try {
    n = typeof hex === "bigint" ? hex : BigInt(hex);
  } catch {
    return "0";
  }
  const denom = 10n ** 18n;
  const whole = n / denom;
  const frac = n % denom;
  const wholeStr = withCommas(whole.toString());
  if (frac === 0n) return wholeStr;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 6);
  const trimmed = fracStr.replace(/0+$/, "");
  return trimmed.length ? `${wholeStr}.${trimmed}` : wholeStr;
}

export function shortAddr(a: string, head = 6, tail = 4): string {
  if (!a || a.length < head + tail + 2) return a;
  return `${a.slice(0, 2 + head)}…${a.slice(-tail)}`;
}

// Convert wei (hex/string/bigint) to USD using a price-per-ZBX (number)
export function weiToUsd(
  wei: string | number | bigint,
  pricePerZbx: number,
): number {
  let n: bigint;
  try {
    n = typeof wei === "bigint" ? wei : BigInt(wei);
  } catch {
    return 0;
  }
  // Use string conversion to keep precision for large numbers
  const denom = 10n ** 18n;
  const whole = Number(n / denom);
  const frac = Number(n % denom) / Number(denom);
  return (whole + frac) * pricePerZbx;
}

// ──────────────────────────────────────────────────────────────────────
// Phase D — On-chain forkless governance helpers
//
// All proposal mutations (Submit, Vote) flow through the standard
// `zbx_sendRawTransaction` pipeline — they're plain TxKind::Proposal
// signed transactions. The helpers below are read-only views the
// dashboard uses to render the /governance page.
// ──────────────────────────────────────────────────────────────────────

export type ProposalStatus =
  | "Testing"
  | "Voting"
  | "Approved"
  | "Rejected"
  | "Activated";

export type ProposalKindJson =
  | { type: "feature_flag"; key: string; enabled: boolean }
  | { type: "param_change"; param: string; new_value: string }
  | {
      type: "contract_whitelist";
      key: string;
      address: string;
      label: string;
    }
  | { type: "text_only" };

export interface ProposalSummary {
  id: number;
  proposer: string;
  title: string;
  description: string;
  kind: ProposalKindJson;
  status: ProposalStatus;
  created_at_height: number;
  created_at_ms: number;
  voting_starts_at_height: number;
  voting_ends_at_height: number;
  yes_votes: number;
  no_votes: number;
  total_votes: number;
  pass_pct_bps: number;
  test_runs: number;
  test_success: number;
  test_failure: number;
  activated_at_height: number | null;
  blocks_until_voting: number;
  blocks_until_close: number;
}

export interface ProposalsListResp {
  count: number;
  tip_height: number;
  min_proposer_balance_wei: string;
  test_phase_blocks: number;
  vote_phase_blocks: number;
  total_lifecycle_blocks: number;
  min_quorum_votes: number;
  pass_threshold_bps: number;
  proposals: ProposalSummary[];
}

export interface FeatureFlag {
  key: string;
  value: string;
  enabled: boolean;
  contract_address: string | null;
  contract_label: string | null;
  set_at_height: number | null;
}

export interface ProposerCheckResp {
  address: string;
  balance_wei: string;
  balance_zbx: string;
  min_proposer_balance_wei: string;
  min_proposer_balance_zbx: string;
  has_min_balance: boolean;
  active_proposals: number;
  max_active_proposals: number;
  can_submit: boolean;
}

export async function listProposals(limit = 50): Promise<ProposalsListResp> {
  return rpc<ProposalsListResp>("zbx_proposalsList", [limit]);
}

export async function getProposal(id: number): Promise<ProposalSummary | null> {
  return rpc<ProposalSummary | null>("zbx_proposalGet", [id]);
}

export async function checkProposer(addr: string): Promise<ProposerCheckResp> {
  return rpc<ProposerCheckResp>("zbx_proposerCheck", [addr]);
}

export async function listFeatureFlags(): Promise<{
  count: number;
  flags: FeatureFlag[];
}> {
  return rpc<{ count: number; flags: FeatureFlag[] }>(
    "zbx_featureFlagsList",
    [],
  );
}

export async function shadowExec(id: number): Promise<{
  ok: boolean;
  proposal_id?: number;
  status?: string;
  shadow_executed?: boolean;
  main_state_committed?: boolean;
  projected_effect?: unknown;
  reason?: string;
}> {
  return rpc("zbx_proposalShadowExec", [id]);
}

/** Convert ~14 400 blocks/day to a coarse "X days, Y hours" label. */
export function blocksToHuman(blocks: number): string {
  if (blocks <= 0) return "—";
  const BLOCKS_PER_DAY = 14_400;
  const BLOCKS_PER_HOUR = 600;
  const days = Math.floor(blocks / BLOCKS_PER_DAY);
  const hours = Math.floor((blocks % BLOCKS_PER_DAY) / BLOCKS_PER_HOUR);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor((blocks % BLOCKS_PER_HOUR) / 10);
  return `${mins}m`;
}

export function fmtUsd(n: number): string {
  if (!isFinite(n)) return "$0.00";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

// ──────────────────────────────────────────────────────────────────────
// Block / tx explorer helpers
// ──────────────────────────────────────────────────────────────────────

export interface EthBlock {
  number: string;            // hex
  hash: string;
  parentHash: string;
  timestamp: string;         // hex (seconds)
  miner: string;
  gasUsed: string;           // hex
  gasLimit: string;          // hex
  baseFeePerGas?: string;
  size?: string;
  transactions: string[] | EthTxLite[];
}

export interface EthTxLite {
  hash: string;
  from: string;
  to: string | null;
  value: string;             // hex wei
  nonce: string;             // hex
  gas: string;
  gasPrice?: string;
  blockNumber?: string | null;
  blockHash?: string | null;
  transactionIndex?: string | null;
  input?: string;
}

export interface EthReceipt {
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  from: string;
  to: string | null;
  status: string;            // "0x1" success, "0x0" revert
  gasUsed: string;
  cumulativeGasUsed?: string;
  contractAddress?: string | null;
  logs?: unknown[];
}

export interface ZbxTipInfo {
  height: number;
  hash: string;
  proposer: string;
  timestamp_ms: number;
  hex: string;
}

/** Tip header (height + proposer + ts). */
export async function getTip(): Promise<ZbxTipInfo | null> {
  try {
    const r = (await rpc<unknown>("zbx_blockNumber")) as ZbxTipInfo | null;
    return r ?? null;
  } catch {
    return null;
  }
}

/** Fetch a block via eth_getBlockByNumber. `tag` is "latest" or a number. */
export async function getEthBlock(
  tag: number | "latest",
  includeTxs = false,
): Promise<EthBlock | null> {
  const param = tag === "latest" ? "latest" : "0x" + tag.toString(16);
  try {
    return (await rpc<EthBlock | null>("eth_getBlockByNumber", [param, includeTxs])) ?? null;
  } catch {
    return null;
  }
}

/** Last `n` blocks ending at `tip` (newest first). */
export async function getRecentBlocks(tip: number, n = 10): Promise<EthBlock[]> {
  const heights: number[] = [];
  for (let i = 0; i < n && tip - i >= 0; i++) heights.push(tip - i);
  const blocks = await Promise.all(heights.map((h) => getEthBlock(h, true)));
  return blocks.filter((b): b is EthBlock => !!b);
}

export async function getEthTx(hash: string): Promise<EthTxLite | null> {
  try {
    return (await rpc<EthTxLite | null>("eth_getTransactionByHash", [hash])) ?? null;
  } catch {
    return null;
  }
}

export async function getEthReceipt(hash: string): Promise<EthReceipt | null> {
  try {
    return (await rpc<EthReceipt | null>("eth_getTransactionReceipt", [hash])) ?? null;
  } catch {
    return null;
  }
}

/**
 * Phase H.1 — typed-tx payload returned by `zbx_getTxByHash`. Mirrors the
 * shape produced by `tx_kind_to_json` in `zebvix-chain/src/rpc.rs`.
 *
 * The `payload` object is kind-specific. Every variant carries a `type`
 * discriminant string (e.g. "transfer", "token_pool_create", "token_transfer")
 * matching the canonical lower-snake-case variant name. Token-related kinds
 * additionally carry `token_symbol`, `token_name` and `token_decimals`
 * resolved server-side so the dashboard can format human-readable amounts
 * without a second RPC roundtrip.
 *
 * `amount` / `fee` are stringified u128 wei values (precision-safe).
 *
 * Returns null when the hash is outside the recent-tx ring window
 * (~1000 most recent committed txs) — fall back to `getEthTx` for older
 * history.
 */
export interface ZbxTypedTx {
  hash:       string;
  height:     number;
  from:       string;
  to:         string;
  amount:     string;     // u128 as decimal string (legacy `body.amount`, often 0 for non-Transfer)
  fee:        string;     // u128 as decimal string
  nonce:      number;
  chain_id:   number;
  // Canonical wire-format variant name from `TxKind::variant_name()` —
  // ALWAYS lowercase snake_case (e.g. "transfer", "token_pool_create").
  // NEVER PascalCase. Compare against the lowercase form only; for display
  // labels run it through a Title-Case helper. A wrong-case comparison
  // here would silently misclassify Transfer txs and is what triggered
  // the H.1 round-1 review failure.
  kind:       string;
  kind_index: number;     // numeric tag (0..=19)
  // Kind-specific decoded payload. Always carries a `type` string and any
  // semantic fields (amounts as decimal strings, addresses as 0x-hex).
  payload:    Record<string, unknown>;
}

export async function getZbxTypedTx(hash: string): Promise<ZbxTypedTx | null> {
  try {
    return (await rpc<ZbxTypedTx | null>("zbx_getTxByHash", [hash])) ?? null;
  } catch {
    return null;
  }
}

/**
 * Poll `eth_getTransactionReceipt(hash)` until a receipt arrives or until we
 * hit `timeoutMs`. Calls `onTick` on every poll with the latest snapshot so
 * UIs can render intermediate state ("waiting for inclusion…"). Resolves with
 * the final receipt (or null on timeout).
 */
export async function pollReceipt(
  hash: string,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    onTick?: (snap: { receipt: EthReceipt | null; elapsedMs: number }) => void;
  } = {},
): Promise<EthReceipt | null> {
  const interval = opts.intervalMs ?? 4000;
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    const r = await getEthReceipt(hash);
    opts.onTick?.({ receipt: r, elapsedMs: Date.now() - (deadline - (opts.timeoutMs ?? 90_000)) });
    if (r) return r;
    await new Promise((res) => setTimeout(res, interval));
  }
  return null;
}

/** Hex to decimal (safe for u64-sized numbers). */
export function hexToInt(hex: string | null | undefined): number {
  if (!hex) return 0;
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!s) return 0;
  return parseInt(s, 16);
}

// ── Dynamic fee bounds ────────────────────────────────────────────────────
//
// The chain enforces an AMM-pegged fee floor (≈ $0.001 USD worth of ZBX at
// current pool spot price) inside `apply_tx`. A hardcoded 0.002 ZBX default
// can silently fall *under* this floor when the pool moves, causing txs to
// be admitted to mempool but then dropped at block-build time (no receipt,
// no error). This helper fetches the live `recommended_fee_wei` and caches
// it for a few seconds so every signing path uses a fee that is guaranteed
// to clear the dynamic floor.

export interface FeeBoundsResp {
  min_fee_wei: string;
  max_fee_wei: string;
  recommended_fee_wei: string;
  pool_initialized: boolean;
  source: string;
}

let feeBoundsCache: { wei: bigint; ts: number } | null = null;
const FEE_CACHE_MS = 10_000;
// Safety net: 0.005 ZBX is comfortably above all observed dynamic minimums
// and below the dynamic max — used only if `zbx_feeBounds` RPC fails.
const FEE_FALLBACK_WEI = 5_000_000_000_000_000n;

export async function getRecommendedFeeWei(): Promise<bigint> {
  const now = Date.now();
  if (feeBoundsCache && now - feeBoundsCache.ts < FEE_CACHE_MS) {
    return feeBoundsCache.wei;
  }
  try {
    const b = await rpc<FeeBoundsResp>("zbx_feeBounds");
    const wei = BigInt(b.recommended_fee_wei);
    feeBoundsCache = { wei, ts: now };
    return wei;
  } catch {
    return FEE_FALLBACK_WEI;
  }
}

export function detectQueryKind(q: string): "block-num" | "block-hash" | "tx-hash" | "address" | "unknown" {
  const s = q.trim();
  if (/^\d+$/.test(s)) return "block-num";
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) {
    // Heuristic: try tx first (chain has both block hashes and tx hashes as 32B);
    // we'll let the caller try tx, fall back to block.
    return "tx-hash";
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return "address";
  return "unknown";
}

