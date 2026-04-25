export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export interface BlockInfo {
  height: number;
  hex: Hex;
  hash: Hex;
  timestamp_ms: number;
  proposer: Address;
}

export interface SupplyInfo {
  total_supply_wei: string;
  circulating_supply_wei?: string;
  burned_wei?: string;
  reserve_wei?: string;
  [key: string]: unknown;
}

// ── Governance / Proposals ───────────────────────────────────────────────
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
      address: Address;
      label: string;
    }
  | { type: "text_only" };

export interface ProposalSummary {
  id: number;
  proposer: Address;
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
  contract_address: Address | null;
  contract_label: string | null;
  set_at_height: number | null;
}

export interface FeatureFlagsListResp {
  count: number;
  flags: FeatureFlag[];
}

export interface ProposerCheckResp {
  address: Address;
  balance_wei: string;
  balance_zbx: string;
  min_proposer_balance_wei: string;
  min_proposer_balance_zbx: string;
  has_min_balance: boolean;
  active_proposals: number;
  max_active_proposals: number;
  can_submit: boolean;
}

// ── Pay-ID ───────────────────────────────────────────────────────────────
export interface PayIdRecord {
  pay_id: string;
  address: Address;
  registered_height?: number;
  [key: string]: unknown;
}

// ── Multisig ─────────────────────────────────────────────────────────────
export interface MultisigInfo {
  owners: Address[];
  threshold: number;
  created_height: number;
  proposal_seq: number;
}

// ── AMM / Pool ───────────────────────────────────────────────────────────
export type SwapDirection = "zbx_to_zusd" | "zusd_to_zbx";

export interface SwapQuote {
  amount_in_wei: string;
  amount_out_wei: string;
  price: string;
  fee_wei: string;
  [key: string]: unknown;
}

export interface RecentSwap {
  block_height: number;
  trader: Address;
  direction: SwapDirection;
  amount_in_wei: string;
  amount_out_wei: string;
  timestamp_ms: number;
  [key: string]: unknown;
}

// ── Bridge ───────────────────────────────────────────────────────────────
export interface BridgeNetwork {
  id: number;
  name: string;
  kind: string;
  active: boolean;
  registered_height?: number;
  chain_id?: number;
  [key: string]: unknown;
}

export interface BridgeNetworksResp {
  count: number;
  networks: BridgeNetwork[];
}

// ── Counts ───────────────────────────────────────────────────────────────
export interface CountResp {
  total: number;
}

// ── Mempool ──────────────────────────────────────────────────────────────
export interface MempoolStatus {
  pending_count: number;
  queued_count: number;
  total_bytes?: number;
  [key: string]: unknown;
}

// ── Fee bounds ───────────────────────────────────────────────────────────
export interface FeeBounds {
  base_fee_wei: string;
  min_priority_fee_wei: string;
  max_priority_fee_wei: string;
  [key: string]: unknown;
}
