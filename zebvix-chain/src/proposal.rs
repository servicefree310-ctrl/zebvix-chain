//! Phase D — On-chain forkless governance.
//!
//! Wallet with at least 1 000 ZBX can submit a feature proposal. Each
//! proposal goes through a 14-day **shadow execution** test phase, then a
//! 76-day **voting** phase (90 days total). 1 wallet = 1 vote (no balance
//! weighting); voters only pay the standard gas fee. If `yes / total >=
//! 90 %` AND `total >= MIN_QUORUM_VOTES`, the proposal auto-activates at
//! its activation block — feature flag flips, param updates, or contract
//! gets whitelisted, with no hard fork.
//!
//! All proposal state lives in CF_META under the `prop/`, `prop_vote/`,
//! `prop_active/` prefixes (see `state.rs`). Feature flags live under
//! `ff/` and `ff_label/`.
//!
//! **Variant order is consensus-critical** — bincode encodes enum tags as
//! 0-based indices. Do NOT reorder.

use crate::types::Address;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

/// Minimum ZBX balance the proposer wallet must hold at submit time.
/// 1 000 ZBX = 1_000 * 10^18 wei.
pub const MIN_PROPOSER_BALANCE_WEI: u128 = 1_000u128 * 1_000_000_000_000_000_000u128;

/// Block-time assumption used to convert days → block heights. The chain
/// targets 6 s blocks, so 1 day ≈ 14 400 blocks.
pub const BLOCKS_PER_DAY: u64 = 14_400;

/// Length of the shadow-execution test phase: 14 days.
pub const TEST_PHASE_BLOCKS: u64 = 14 * BLOCKS_PER_DAY;

/// Length of the voting phase: 76 days. Total proposal lifecycle = 90 days.
pub const VOTE_PHASE_BLOCKS: u64 = 76 * BLOCKS_PER_DAY;

/// Total lifecycle: 90 days from submission to final tally.
pub const TOTAL_LIFECYCLE_BLOCKS: u64 = TEST_PHASE_BLOCKS + VOTE_PHASE_BLOCKS;

/// Minimum number of total votes (yes + no) required for a proposal to be
/// considered for approval. Below this, even 100 % yes is rejected as
/// "no quorum".
pub const MIN_QUORUM_VOTES: u64 = 5;

/// Pass threshold in basis points: 9000 = 90.00 % positive ratio.
pub const PASS_THRESHOLD_BPS: u64 = 9_000;

/// A proposer cannot have more than this many proposals in non-terminal
/// status (Testing or Voting) at any one time. Keeps the chain from being
/// spammed by a single wallet.
pub const MAX_ACTIVE_PROPOSALS_PER_ADDRESS: u64 = 3;

/// Validation bounds.
pub const MAX_TITLE_LEN: usize = 100;
pub const MAX_DESCRIPTION_LEN: usize = 4_000;
pub const MAX_FLAG_KEY_LEN: usize = 64;
pub const MAX_PARAM_NAME_LEN: usize = 64;
pub const MAX_LABEL_LEN: usize = 64;

// ──────────────────────────────────────────────────────────────────────────
// Proposal kinds — what kind of on-chain change the proposal would apply.
// Variant order is consensus-critical (bincode tag).
// ──────────────────────────────────────────────────────────────────────────

/// What this proposal would change if it passes.
///
/// **Variant order is consensus-critical** (bincode tag).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProposalKind {
    /// Toggle a named feature flag in chain state.
    /// Example: `key="zswap_v2_enabled", enabled=true`.
    /// On activation: `state.set_feature_flag(key, if enabled {1} else {0})`.
    FeatureFlag { key: String, enabled: bool },
    /// Change a numeric tunable parameter stored in chain state.
    /// Example: `param="amm_fee_bps", new_value=25`.
    /// On activation: `state.set_feature_flag(param, new_value)`.
    ParamChange { param: String, new_value: u128 },
    /// Register an EVM contract address as an "official" entry (whitelist).
    /// On activation: contract address recorded under `ff_label/<key>`.
    ContractWhitelist { key: String, address: Address, label: String },
    /// Pure signal proposal — no on-chain effect. Used for community
    /// sentiment polling.
    TextOnly,
}

impl ProposalKind {
    pub fn variant_label(&self) -> &'static str {
        match self {
            ProposalKind::FeatureFlag { .. } => "feature_flag",
            ProposalKind::ParamChange { .. } => "param_change",
            ProposalKind::ContractWhitelist { .. } => "contract_whitelist",
            ProposalKind::TextOnly => "text_only",
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Proposal lifecycle status.
// ──────────────────────────────────────────────────────────────────────────

/// Lifecycle of a proposal. Ordered by progression through phases.
///
/// **Variant order is consensus-critical** (bincode tag).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProposalStatus {
    /// 0..TEST_PHASE_BLOCKS after creation. Users may shadow-exec but not
    /// vote yet.
    Testing,
    /// TEST_PHASE_BLOCKS..TOTAL_LIFECYCLE_BLOCKS. Voting open.
    Voting,
    /// Lifecycle ended, did not meet quorum/threshold. Terminal.
    Rejected,
    /// Lifecycle ended, met quorum + 90 % threshold. Awaiting activation
    /// (currently activated immediately at the same height).
    Approved,
    /// Approved AND state-effect applied. Terminal.
    Activated,
}

impl ProposalStatus {
    pub fn label(&self) -> &'static str {
        match self {
            ProposalStatus::Testing => "Testing",
            ProposalStatus::Voting => "Voting",
            ProposalStatus::Rejected => "Rejected",
            ProposalStatus::Approved => "Approved",
            ProposalStatus::Activated => "Activated",
        }
    }
    pub fn is_active(&self) -> bool {
        matches!(self, ProposalStatus::Testing | ProposalStatus::Voting)
    }
    pub fn is_terminal(&self) -> bool {
        matches!(self, ProposalStatus::Rejected | ProposalStatus::Activated)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Proposal struct.
// ──────────────────────────────────────────────────────────────────────────

/// A governance proposal. Stored under `prop/<id_be8>` in CF_META.
///
/// **Field order is consensus-critical** (bincode is positional).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Proposal {
    /// Sequential 1-based id, allocated at submit time.
    pub id: u64,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub kind: ProposalKind,
    pub status: ProposalStatus,
    /// Block height at which this proposal was submitted.
    pub created_at_height: u64,
    /// Block timestamp (ms) at submit time. Set from
    /// `state.current_block_ts_ms` so dashboards can render countdowns
    /// without scanning blocks.
    pub created_at_ms: u64,
    /// Voting opens at this height: `created_at_height + TEST_PHASE_BLOCKS`.
    pub voting_starts_at_height: u64,
    /// Voting closes at this height: `created_at_height + TOTAL_LIFECYCLE_BLOCKS`.
    pub voting_ends_at_height: u64,
    pub yes_votes: u64,
    pub no_votes: u64,
    /// Counters maintained by the (read-only) shadow-exec RPC. They are
    /// best-effort UX metadata, NOT consensus state — the only
    /// consensus-affecting fields are the votes and the status.
    #[serde(default)]
    pub test_runs: u64,
    #[serde(default)]
    pub test_success: u64,
    #[serde(default)]
    pub test_failure: u64,
    /// When the activation effect was applied (Approved → Activated).
    #[serde(default)]
    pub activated_at_height: Option<u64>,
}

impl Proposal {
    pub fn total_votes(&self) -> u64 {
        self.yes_votes.saturating_add(self.no_votes)
    }
    /// Yes-vote ratio in basis points (0..=10_000). Returns 0 if no votes.
    pub fn pass_pct_bps(&self) -> u64 {
        let total = self.total_votes();
        if total == 0 {
            0
        } else {
            ((self.yes_votes as u128 * 10_000u128) / total as u128) as u64
        }
    }
    /// True iff this proposal currently meets BOTH the quorum AND the
    /// 90 % positive threshold. Used at the end of voting to decide
    /// Approved vs Rejected.
    pub fn meets_pass_criteria(&self) -> bool {
        self.total_votes() >= MIN_QUORUM_VOTES
            && self.pass_pct_bps() >= PASS_THRESHOLD_BPS
    }
}

// ──────────────────────────────────────────────────────────────────────────
// On-wire transaction op (carried by TxKind::Proposal).
// ──────────────────────────────────────────────────────────────────────────

/// Operations dispatched through `TxKind::Proposal`.
///
/// **Variant order is consensus-critical** (bincode tag).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProposalOp {
    /// Submit a new proposal. Sender = `tx.body.from`. The sender must
    /// hold at least `MIN_PROPOSER_BALANCE_WEI` ZBX (balance check, no
    /// lock — funds remain spendable). Only `body.fee` is consumed;
    /// `body.amount` is refunded.
    Submit {
        title: String,
        description: String,
        kind: ProposalKind,
    },
    /// Cast a vote on an active proposal. Sender = `tx.body.from`. One
    /// vote per (proposal_id, sender) — second vote rejects with an
    /// error. Only `body.fee` is consumed; `body.amount` is refunded.
    Vote { proposal_id: u64, yes: bool },
}

impl ProposalOp {
    pub fn variant_label(&self) -> &'static str {
        match self {
            ProposalOp::Submit { .. } => "submit",
            ProposalOp::Vote { .. } => "vote",
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Validation helpers (called from apply_tx Submit arm).
// ──────────────────────────────────────────────────────────────────────────

pub fn validate_title(s: &str) -> Result<String> {
    let t = s.trim().to_string();
    if t.is_empty() {
        return Err(anyhow!("proposal title required"));
    }
    if t.chars().count() > MAX_TITLE_LEN {
        return Err(anyhow!(
            "proposal title too long (max {} chars, got {})",
            MAX_TITLE_LEN,
            t.chars().count()
        ));
    }
    if t.chars().any(|c| c.is_control()) {
        return Err(anyhow!("proposal title must not contain control chars"));
    }
    Ok(t)
}

pub fn validate_description(s: &str) -> Result<String> {
    let n = s.chars().count();
    if n == 0 {
        return Err(anyhow!("proposal description must not be empty"));
    }
    if n > MAX_DESCRIPTION_LEN {
        return Err(anyhow!(
            "proposal description too long (max {} chars, got {})",
            MAX_DESCRIPTION_LEN,
            n
        ));
    }
    Ok(s.to_string())
}

/// Feature-flag / param-name keys: `[a-z0-9_.]+`, 1..=64 chars.
pub fn validate_flag_key(s: &str) -> Result<String> {
    let n = s.chars().count();
    if n == 0 || n > MAX_FLAG_KEY_LEN {
        return Err(anyhow!(
            "flag/param key length must be 1..={} (got {})",
            MAX_FLAG_KEY_LEN,
            n
        ));
    }
    if !s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.') {
        return Err(anyhow!("flag/param key must be [a-z0-9_.]+"));
    }
    Ok(s.to_string())
}

pub fn validate_label(s: &str) -> Result<String> {
    let t = s.trim().to_string();
    if t.is_empty() {
        return Err(anyhow!("label required"));
    }
    if t.chars().count() > MAX_LABEL_LEN {
        return Err(anyhow!("label too long (max {})", MAX_LABEL_LEN));
    }
    if t.chars().any(|c| c.is_control()) {
        return Err(anyhow!("label must not contain control chars"));
    }
    Ok(t)
}

/// Structural validation of a `ProposalKind` payload — runs at submit time
/// before any storage writes. Mutates string fields to canonical (trimmed)
/// form where appropriate.
pub fn validate_kind(kind: &mut ProposalKind) -> Result<()> {
    match kind {
        ProposalKind::FeatureFlag { key, .. } => {
            *key = validate_flag_key(key)?;
        }
        ProposalKind::ParamChange { param, .. } => {
            *param = validate_flag_key(param)?;
        }
        ProposalKind::ContractWhitelist { key, label, .. } => {
            *key = validate_flag_key(key)?;
            *label = validate_label(label)?;
        }
        ProposalKind::TextOnly => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_constants_sum_to_90_days() {
        assert_eq!(TEST_PHASE_BLOCKS + VOTE_PHASE_BLOCKS, 90 * BLOCKS_PER_DAY);
        assert_eq!(TOTAL_LIFECYCLE_BLOCKS, 90 * BLOCKS_PER_DAY);
    }

    #[test]
    fn pass_pct_thresholds() {
        let mk = |yes: u64, no: u64| Proposal {
            id: 1,
            proposer: Address::ZERO,
            title: "t".into(),
            description: String::new(),
            kind: ProposalKind::TextOnly,
            status: ProposalStatus::Voting,
            created_at_height: 0,
            created_at_ms: 0,
            voting_starts_at_height: 0,
            voting_ends_at_height: 0,
            yes_votes: yes,
            no_votes: no,
            test_runs: 0,
            test_success: 0,
            test_failure: 0,
            activated_at_height: None,
        };
        assert_eq!(mk(0, 0).pass_pct_bps(), 0);
        assert_eq!(mk(9, 1).pass_pct_bps(), 9_000);
        assert_eq!(mk(8, 2).pass_pct_bps(), 8_000);
        assert!(mk(9, 1).meets_pass_criteria());        // 90% + quorum 10
        assert!(!mk(4, 0).meets_pass_criteria());       // below quorum
        assert!(!mk(8, 2).meets_pass_criteria());       // below threshold
        assert!(mk(45, 5).meets_pass_criteria());       // 90% + quorum 50
    }

    #[test]
    fn validation_rejects_bad_keys() {
        assert!(validate_flag_key("").is_err());
        assert!(validate_flag_key("UpperCase").is_err());
        assert!(validate_flag_key("with space").is_err());
        assert!(validate_flag_key("ok_key.v2").is_ok());
    }

    #[test]
    fn validation_trims_title_and_label() {
        assert_eq!(validate_title("  hello  ").unwrap(), "hello");
        assert_eq!(validate_label("  My Flag  ").unwrap(), "My Flag");
        assert!(validate_title("").is_err());
        assert!(validate_title("   ").is_err());
    }
}
