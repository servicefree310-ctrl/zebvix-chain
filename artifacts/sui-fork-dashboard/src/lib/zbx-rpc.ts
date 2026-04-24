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
