import React, { useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Hourglass,
  Info,
} from "lucide-react";

type Status = "LIVE" | "PARTIAL" | "PLANNED";

interface Step {
  title: string;
  files: string[];
  description: string;
  detail: string;
  code?: string;
  codeLang?: string;
}

interface Phase {
  id: string;
  title: string;
  subtitle: string;
  status: Status;
  steps: Step[];
}

const STATUS_STYLE: Record<Status, { ring: string; bg: string; text: string; label: string }> = {
  LIVE:    { ring: "border-emerald-500/40", bg: "bg-emerald-500/5",  text: "text-emerald-400", label: "LIVE" },
  PARTIAL: { ring: "border-amber-500/40",   bg: "bg-amber-500/5",    text: "text-amber-400",   label: "PARTIAL" },
  PLANNED: { ring: "border-border",         bg: "bg-card/30",        text: "text-muted-foreground", label: "PLANNED" },
};

const phases: Phase[] = [
  // ─────────────────────── Phase A ───────────────────────
  {
    id: "A",
    title: "Phase A — P2P Networking Foundation",
    subtitle: "libp2p 0.54 stack: TCP + Noise + Yamux, gossipsub, mDNS, request_response sync",
    status: "LIVE",
    steps: [
      {
        title: "libp2p stack + 4 gossip topics + block sync protocol",
        files: ["zebvix-chain/src/p2p.rs"],
        description: "The whole P2P layer landed in one phase: SwarmBuilder, Noise XX handshake, Yamux multiplex, and gossipsub strict mode with 2s heartbeat and 1MiB cap.",
        detail: "Topics namespaced by chain-id: zebvix/7878/blocks/v1, txs/v1, heartbeat/v1, votes/v1. mDNS LAN discovery active by default (--no-mdns to disable). Block sync via request_response::cbor /zebvix/sync/1.0.0 with SYNC_BATCH_MAX = 256 and 15s timeout, one-in-flight enforced. See Network Configuration page for the full operational view.",
        code: `# Verify P2P came up on a running validator
journalctl -u zebvix-node -n 200 --no-pager | grep -E '🌐 p2p listening|🔗 connected|✅ peer'

# Expected:
#   🌐 p2p listening on /ip4/0.0.0.0/tcp/30333
#   🔗 connected: 12D3KooW...`,
      },
    ],
  },

  // ─────────────────────── Phase B.1 ───────────────────────
  {
    id: "B.1",
    title: "Phase B.1 — Validator Set On-Chain",
    subtitle: "Validator registry persisted to RocksDB; voting power participates in block verification",
    status: "LIVE",
    steps: [
      {
        title: "Validator struct + RocksDB-backed registry",
        files: ["zebvix-chain/src/types.rs:102"],
        description: "On-chain Validator { pubkey: 33-byte secp256k1 compressed, voting_power: u64 } persisted across restarts. Replaces hard-coded validator lists.",
        detail: "Genesis seeds the founder validator deterministically from FOUNDER_PUBKEY_HEX. Subsequent ValidatorAdd / ValidatorRemove / ValidatorEdit tx kinds (Phase B.3.2) mutate the registry through consensus, not config files. This is the foundation B.2 votes depend on.",
      },
    ],
  },

  // ─────────────────────── Phase B.2 ───────────────────────
  {
    id: "B.2",
    title: "Phase B.2 — Tendermint-style Vote Messages + Pool + Gossip",
    subtitle: "Wire format, signing, anti-double-sign pool, gossip topic — observable but not yet quorum-gating",
    status: "LIVE",
    steps: [
      {
        title: "Prevote / Precommit messages on zebvix/7878/votes/v1",
        files: ["zebvix-chain/src/vote.rs", "zebvix-chain/src/p2p.rs:50", "zebvix-chain/src/p2p.rs:96"],
        description: "Every registered validator auto-signs a Prevote and Precommit on every new tip and gossips them into a shared VotePool. Observable via zbx_voteStats RPC.",
        detail: "Anti-double-sign keyed by (height, round, vote_type), then per-validator slot inside that bucket — submitting a different vote for the same (height, round, vote_type) returns AddVoteResult::DoubleSign with the previous vote attached for slashing evidence. Phase B.2 ships the wire format + signing + pool + gossip only — the producer still single-handedly commits via PoA. Phase B.3 wires votes into actual quorum-gating.",
      },
    ],
  },

  // ─────────────────────── Phase B.3.1 ───────────────────────
  {
    id: "B.3.1",
    title: "Phase B.3.1 — TxKind Discriminator",
    subtitle: "One enum to dispatch every transaction type — the spine of apply_tx",
    status: "LIVE",
    steps: [
      {
        title: "Unified TxKind enum (variant order is consensus-critical)",
        files: ["zebvix-chain/src/transaction.rs:35"],
        description: "Every Zebvix transaction is a SignedTx wrapping a TxBody, which carries a TxKind discriminator. Bincode encodes the variant tag as u32 LE — never reorder.",
        detail: "Variants shipped across this and later phases (exact source names): Transfer, ValidatorAdd, ValidatorRemove, ValidatorEdit, GovernorChange, Staking(StakeOp), RegisterPayId { pay_id, name }, Multisig(MultisigOp), Swap { direction: SwapDirection, min_out: u128 }, Bridge(BridgeOp), Proposal(ProposalOp).",
      },
    ],
  },

  // ─────────────────────── Phase B.3.2 ───────────────────────
  {
    id: "B.3.2",
    title: "Phase B.3.2 — Tendermint Round Bumping + Validator Power Edit + Governor Rotate",
    subtitle: "Liveness fallback when the proposer is silent, plus governor-key rotation as a transaction",
    status: "LIVE",
    steps: [
      {
        title: "Round timeouts trigger proposer rotation in consensus.rs",
        files: ["zebvix-chain/src/consensus.rs:3"],
        description: "If the round-N proposer fails to produce within the timeout, round bumps to N+1 and the next round-robin proposer takes over. Block height does NOT advance until a block lands.",
        detail: "This is liveness insurance — without it, a single offline proposer halts the chain forever.",
      },
      {
        title: "ValidatorEdit + GovernorChange tx kinds",
        files: ["zebvix-chain/src/transaction.rs:59", "zebvix-chain/src/transaction.rs:63"],
        description: "ValidatorEdit { address, new_power } updates a validator's voting power without removing+re-adding (which would briefly drop total power below quorum and risk halting the chain mid-block). GovernorChange { new_governor } rotates the governor key, signed by the CURRENT governor.",
        detail: "Both governor-only. GovernorChange is the safe path off the genesis founder key once a multisig or DAO takes over operations — capped at MAX_GOVERNOR_CHANGES rotations, then locked.",
      },
    ],
  },

  // ─────────────────────── Phase B.4 ───────────────────────
  {
    id: "B.4",
    title: "Phase B.4 — PoS Staking (Sui-style share-based)",
    subtitle: "Validator registry, delegated staking with auto-compound, 7-epoch unbonding, epoch reward distribution",
    status: "LIVE",
    steps: [
      {
        title: "StakingModule with share-based accounting",
        files: ["zebvix-chain/src/staking.rs"],
        description: "Delegated staking that survives slashing without iterating all delegators. Each delegator owns shares; the validator's stake-per-share float reflects rewards and slashes uniformly.",
        detail: "MIN_SELF_BOND_WEI = 100 ZBX (fixed token amount, no USD-peg — the AMM-oracle vector was removed Apr 2026). MIN_DELEGATION_WEI = 10 ZBX. EPOCH_BLOCKS = 17280 (~24h at 5s blocks). UNBONDING_EPOCHS = 7 (~7d). Slashing primitives slash_double_sign = 5% and slash_downtime = 0.10% land in the module — auto-enforcement wiring is on the pending list (see below).",
      },
      {
        title: "Two-tier validator onboarding",
        files: ["zebvix-chain/src/staking.rs", "zebvix-chain/src/transaction.rs:66"],
        description: "Step 5a — anyone with ≥ 100 ZBX self-bond can submit StakeOp::CreateValidator. Step 5b — current governor must then submit ValidatorAdd to seat the validator into the active set.",
        detail: "Decoupling these prevents Sybil seating: stake alone does not grant block-production rights.",
      },
    ],
  },

  // ─────────────────────── Phase B.7 ───────────────────────
  {
    id: "B.7",
    title: "Phase B.7 — Pay-ID Registration",
    subtitle: "Human-readable alias for any 20-byte address, resolvable via JSON-RPC",
    status: "LIVE",
    steps: [
      {
        title: "RegisterPayId tx kind + zbx_lookupPayId / zbx_getPayIdOf RPCs",
        files: ["zebvix-chain/src/transaction.rs:73", "zebvix-chain/src/state.rs", "zebvix-chain/src/rpc.rs:1198"],
        description: "Sender registers a string alias bound to its own address. Format: <handle>@zbx, handle 3–25 chars [a-z0-9_]; name is a 1–50 char display label. One Pay-ID per address; once set it is PERMANENT — cannot be edited or deleted.",
        detail: "Forward lookup zbx_lookupPayId(pay_id) → address; reverse zbx_getPayIdOf(address) → pay_id; zbx_payIdCount returns total registered. Used by the ZVM Explorer's unified Smart Search bar to route alias queries to the right account.",
      },
    ],
  },

  // ─────────────────────── Phase B.8 ───────────────────────
  {
    id: "B.8",
    title: "Phase B.8 — M-of-N Multisig Wallets",
    subtitle: "Full advanced lifecycle: create → propose → approve → execute, persisted on-chain",
    status: "LIVE",
    steps: [
      {
        title: "Multisig module + 5 op variants (Create / Propose / Approve / Revoke / Execute)",
        files: ["zebvix-chain/src/multisig.rs", "zebvix-chain/src/transaction.rs:78"],
        description: "MultisigOp::{Create { owners, threshold, salt }, Propose { multisig, action, expiry_blocks }, Approve, Revoke, Execute}. Each wallet has an N-of-M signer set + a per-proposal approval ledger. MIN_OWNERS=2, MAX_OWNERS=10. Default proposal expiry 17 280 blocks (~24h); max 1 000 000 blocks (~58 days).",
        detail: "v1 only models MultisigAction::Transfer { to, amount } as the executable inner action — wrapping arbitrary TxKinds (Bridge, Swap, etc.) is a future variant. Once threshold approvals collected, anyone can submit Execute. Same primitive will eventually back the bridge oracle committee (Phase B.12 hardening).",
      },
    ],
  },

  // ─────────────────────── Phase B.10 ───────────────────────
  {
    id: "B.10",
    title: "Phase B.10 — Explicit On-Chain AMM Swap",
    subtitle: "Uniswap V2 x·y=k with explicit fee bucket, transparent loan repayment, then 50/50 protocol-treasury / LP split",
    status: "LIVE",
    steps: [
      {
        title: "Single ZBX/zUSD pool — permissionless, auto-routed",
        files: ["zebvix-chain/src/pool.rs", "zebvix-chain/src/transaction.rs:84"],
        description: "Single permissionless ZBX/zUSD pool seeded at genesis at $0.50/ZBX. No privileged role can withdraw the genesis liquidity — the seed is locked to the pool address forever. Anyone can swap.",
        detail: "Two interaction paths: (1) direct TxKind::Swap { direction: SwapDirection::{ZbxToZusd | ZusdToZbx}, min_out: u128 } with explicit slippage protection — body.amount is the input amount, output is always credited back to body.from, principal refunded on slippage trip; OR (2) implicit auto-router that intercepts plain transfers to POOL_ADDRESS and swaps the sent token for the other side.",
      },
      {
        title: "Fee bucket + 10M zUSD genesis-loan repayment economics",
        files: ["zebvix-chain/src/pool.rs"],
        description: "Each swap takes 0.3% from the input token into a sequestered fee bucket — NOT immediately added to reserves. settle_fees() runs after every swap.",
        detail: "While loan_outstanding_zusd > 0: fees go entirely to repaying the 10M zUSD genesis liquidity loan (tokens move into reserves). Once loan = 0: future fees split 50/50 between the protocol treasury (governance-controlled, multisig-held) and pool reserves (compounding LP value).",
      },
    ],
  },

  // ─────────────────────── Phase B.11 ───────────────────────
  {
    id: "B.11",
    title: "Phase B.11 — secp256k1 / ETH-Compatible Crypto Migration",
    subtitle: "Replaced ed25519-dalek with k256 ECDSA — MetaMask/MEW keys work directly on Zebvix",
    status: "LIVE",
    steps: [
      {
        title: "Address derivation = keccak256(uncompressed_pubkey[1..])[12..]",
        files: ["zebvix-chain/src/crypto.rs", "zebvix-chain/src/types.rs:110", "zebvix-chain/src/types.rs:162", "zebvix-chain/src/transaction.rs:267"],
        description: "Identical to Ethereum: the same private key in MetaMask gives the same 20-byte address on Zebvix. Validator pubkeys are 33-byte SEC1 compressed (0x02|0x03 || X).",
        detail: "Wire format: SignedTx { body, pubkey: [u8; 33], signature: [u8; 64] } — bincode(body) is the signing payload, pubkey is carried alongside (no recovery-id byte; sender address is recomputed from pubkey via address_from_pubkey, NOT recovered from signature). The chain rejects any tx whose body.from disagrees with address_from_pubkey(pubkey) OR whose ECDSA signature does not verify. Removed ed25519-dalek dependency entirely.",
        code: `# Founder address derivation is fully deterministic:
#   FOUNDER_PUBKEY_HEX (compressed secp256k1) → 0x40907000ac0a1a73e4cd89889b4d7ee8980c0315
#   private key       = keccak256("zebvix-genesis-founder-v1")
#                     = 0xa8674e60d95ec1fa2b37f264b01b8407d2fbb0789bd836382472d181973ebbf8
# Import that hex into MetaMask → control the founder / governor role on this chain.
# Production deployments MUST rotate to a fresh ETH key via env-var override before going live.`,
      },
    ],
  },

  // ─────────────────────── Phase B.12 ───────────────────────
  {
    id: "B.12",
    title: "Phase B.12 — Cross-Chain Bridge",
    subtitle: "Native lock-and-mint / burn-and-release. MVP: single-oracle (governor-signed); roadmap target: M-of-N multisig committee. Network registry is governance-extensible.",
    status: "LIVE",
    steps: [
      {
        title: "bridge.rs module + 6 BridgeOp variants",
        files: ["zebvix-chain/src/bridge.rs", "zebvix-chain/src/state.rs:1189"],
        description: "Native Rust bridge with a governance-controlled registry of foreign networks (BSC, ETH, Polygon, …) and per-asset mappings (e.g. ZBX ↔ BEP-20 wZBX). 4096-event ring buffer for outbound, 32-byte hash replay protection for inbound.",
        detail: "Lock vault address BRIDGE_LOCK_ADDRESS_HEX = 0x7a627264670…  (ASCII 'zbrdg' + zero-pad). Off-chain oracle service (operator-supplied) polls zbx_recentBridgeOutEvents and submits zbx_sendTransaction { BridgeIn { source_tx_hash, … } } in the reverse direction. See Cross-Chain Bridge page for full architecture, RPC table, CLI workflows, and trust caveats.",
      },
    ],
  },

  // ─────────────────────── Phase C.1 ───────────────────────
  {
    id: "C.1",
    title: "Phase C.1 — eth_* RPC Envelope Inspection",
    subtitle: "Initial Ethereum-compatible JSON-RPC surface — envelope decoding without execution",
    status: "LIVE",
    steps: [
      {
        title: "Initial eth_* namespace shipped without ZVM execution",
        files: ["zebvix-chain/src/evm_rpc.rs:10", "zebvix-chain/src/evm_rpc.rs:195"],
        description: "C.1 inspected the EIP-155 / EIP-2930 / EIP-1559 envelope-kind discriminator and exposed read-only methods (eth_chainId, eth_blockNumber, eth_getBalance, eth_getTransactionCount, …) so wallets could connect.",
        detail: "Send-raw-tx existed but rejected anything that needed actual interpretation. Phase C.2 fills in the execution.",
      },
    ],
  },

  // ─────────────────────── Phase C.2 ───────────────────────
  {
    id: "C.2",
    title: "Phase C.2 — RLP + Sender Recovery + Cancun ZVM Execution",
    subtitle: "Full Cancun-targeted interpreter, gated behind cargo --features zvm — partial coverage with documented gaps",
    status: "PARTIAL",
    steps: [
      {
        title: "RLP decoder + ECDSA sender recovery",
        files: ["zebvix-chain/src/evm_rlp.rs", "zebvix-chain/src/evm_rpc.rs:194"],
        description: "Decodes type-0 EIP-155-protected legacy, type-1 EIP-2930, type-2 EIP-1559 envelopes. Rejects unprotected legacy tx (chain-id replay risk).",
        detail: "eth_sendRawTransaction takes the full RLP path: decode envelope → reconstruct signing payload → secp256k1 ECDSA recover sender. eth_call takes a different, lighter path — parse_call_envelope reads a JSON object (from/to/data/…) WITHOUT recovery (the call is a simulation; no signature is required).",
      },
      {
        title: "Cancun interpreter — CREATE/CREATE2/CALL/STATICCALL with full memory/storage/journal/revert semantics",
        files: ["zebvix-chain/src/evm_interp.rs", "zebvix-chain/src/evm_state.rs"],
        description: "Solidity 0.8.24 contracts compile, deploy, and execute on Zebvix via eth_sendRawTransaction. CfEvmDb in-memory account cache + atomic journal applies. MCOPY (EIP-5656) supported, BLOBHASH stub returns 0, SELFDESTRUCT rejected.",
        detail: "Documented gaps (see Smart Contracts page for full list): signed-arithmetic SDIV/SMOD/SLT/SGT/SAR + EXTCODECOPY/RETURNDATACOPY not yet dispatched; EIP-2929/3529 warm/cold split not modelled (single-tier costs G_SLOAD=2100, G_BALANCE/G_EXTCODE/G_CALL=2600); SSTORE clear refunds accumulate but cap enforcement deferred to C.3; DEFAULT_BLOCK_GAS_LIMIT=30M is compiled-in (ParamChange runtime read deferred).",
      },
      {
        title: "Standard precompiles 0x01–0x05 with caveats; 0x06–0x09 deferred",
        files: ["zebvix-chain/src/evm_precompiles.rs"],
        description: "0x01 ECRECOVER full, 0x02 SHA256 full, 0x04 IDENTITY full, 0x03 RIPEMD160 gas-correct zero-output stub, 0x05 MODEXP fixed-200-gas placeholder (no EIP-2565 dynamic pricing). 0x06–0x09 (alt_bn128, blake2f) all deferred to C.2 follow-up.",
        detail: "MULMOD is correctly at opcode 0x09, not the precompile slot.",
      },
      {
        title: "Custom Zebvix precompiles 0x80–0x83 — preview-only on ZVM path",
        files: ["zebvix-chain/src/evm_precompiles.rs:55", "zebvix-chain/src/evm_precompiles.rs:292"],
        description: "0x80 PC_BRIDGE_OUT, 0x81 PC_PAYID_RESOLVE, 0x82 PC_AMM_SWAP, 0x83 PC_MULTISIG_PROPOSE. These return preview values (correct gas + ABI shape) but the native side-effects are NOT committed when called via eth_sendRawTransaction.",
        detail: "Production must use the zbx_* RPC namespace for state-mutating bridge / AMM / multisig / Pay-ID operations. Post-frame intent capture so Solidity contracts can trigger native side-effects through the ZVM is the headline C.3 work.",
      },
      {
        title: "Logs gap — eth_getLogs is empty for ZVM tx; receipts wired only for native ZBX (Phase C.2.1)",
        files: ["zebvix-chain/src/evm_state.rs", "zebvix-chain/src/zvm_rpc.rs", "zebvix-chain/src/state.rs"],
        description: "Phase C.2.1 (live): eth_getTransactionByHash + eth_getTransactionReceipt are wired for native ZBX tx — they resolve any hash present in the recent-tx ring buffer (1000-tx rolling window) into a synthetic Ethereum-shape JSON (status=0x1 by construction, gas=21000, logs=[]). Hash→seq side-index maintained in CF_META under rtx/h/ with cascade-delete on eviction.",
        detail: "Still gated to C.3: (a) ZVM (Solidity) tx are not yet indexed into the ring buffer — eth_sendRawTransaction goes straight into evm::execute() and the synthetic envelope is not pushed via push_recent_tx; (b) eth_getLogs returns [] because store_logs has zero callers from the ZVM path and emitted log entries inside the interpreter carry tx_hash=0x00 placeholder; (c) Real ZVM receipts (with per-execution gasUsed, contractAddress, logs[]) need the on-execution receipts table, not the synthetic 21000-gas envelope. C.3 wires (a)+(b)+(c) together with canonical tx-hash stamping.",
      },
    ],
  },

  // ─────────────────────── Phase D ───────────────────────
  {
    id: "D",
    title: "Phase D — Forkless On-Chain Governance",
    subtitle: "ProposalKind {FeatureFlag, ParamChange, ContractWhitelist, TextOnly}; 90-day lifecycle; auto-activation",
    status: "LIVE",
    steps: [
      {
        title: "proposal.rs module + 90-day lifecycle",
        files: ["zebvix-chain/src/proposal.rs"],
        description: "Wallets holding ≥ 1 000 ZBX may submit a proposal (only fee consumed; principal refunded). 14-day shadow-execution Testing phase → 76-day Voting phase = 90 days total.",
        detail: "1 wallet = 1 vote (no balance weighting; voters only pay gas). Auto-activates iff yes/total ≥ 90% AND total ≥ MIN_QUORUM_VOTES (5). Activation flips a feature flag, sets a u128 param, or whitelists a contract — NO HARD FORK required. Max 3 active (Testing|Voting) proposals per proposer.",
      },
      {
        title: "RPC + CLI + Dashboard /governance page",
        files: ["zebvix-chain/src/rpc.rs", "zebvix-chain/src/main.rs"],
        description: "RPC: zbx_proposalsList, zbx_proposalGet, zbx_proposerCheck, zbx_proposalHasVoted, zbx_proposalShadowExec (strictly read-only, never mutates consensus state), zbx_featureFlagsList, zbx_featureFlagGet.",
        detail: "CLI: propose, vote, proposals-list, proposal-get, feature-flags-list. Dashboard exposes eligibility check, proposals list, feature-flag sidebar, and shadow-exec preview. Status labels are capitalized end-to-end (Testing, Voting, Approved, Rejected, Activated).",
      },
    ],
  },

  // ─────────────────────── Phase C.3 PLANNED ───────────────────────
  {
    id: "C.3",
    title: "Phase C.3 — ZVM Maturity (PLANNED)",
    subtitle: "Cross-domain settlement + EIP-2929/3529 + receipts/logs + ParamChange runtime read + custom-precompile commit path",
    status: "PLANNED",
    steps: [
      {
        title: "Cross-domain settlement: CF_EVM ↔ CF_ACCOUNTS sync",
        files: ["zebvix-chain/src/state.rs", "zebvix-chain/src/evm_state.rs"],
        description: "Today eth_getBalance reads CF_ACCOUNTS via the legacy rpc.rs path, but ZVM-side balance changes are journaled into CF_EVM via apply_journal and NOT synced back. The two ledgers can diverge for the same secp256k1 address after ZVM activity.",
        detail: "C.3 either makes CF_EVM authoritative for balance or runs a tx-end settlement pass that mirrors deltas back into CF_ACCOUNTS so legacy and ZVM views stay coherent.",
      },
      {
        title: "EIP-2929/3529 warm/cold gas + refund-cap enforcement",
        files: ["zebvix-chain/src/evm_interp.rs:143"],
        description: "Single-tier costs today: G_SLOAD=2100, G_BALANCE/G_EXTCODE/G_CALL=2600. Need warm/cold cache with the standard EIP-2929 prices (100/2100, 100/2600) and EIP-3529 refund cap = gas_used / 5 enforced at frame end.",
        detail: "Interpreter accumulates SSTORE clear refunds today but does not enforce the cap.",
      },
      {
        title: "CF_LOGS producers wired + canonical tx-hash stamping + ZVM-tx receipts table",
        files: ["zebvix-chain/src/evm_state.rs", "zebvix-chain/src/state.rs"],
        description: "Native ZBX-tx receipts already work (Phase C.2.1, synthetic from ring buffer). C.3 extends coverage to ZVM (Solidity) tx: (a) push ZVM tx envelopes through push_recent_tx so they're hash-indexed; (b) wire eth_sendRawTransaction → store_logs so emitted events are persisted into CF_LOGS; (c) stamp every log with the real tx hash (no more 0x00 placeholder); (d) persist a real receipts table with per-execution gasUsed + contractAddress + logs[] (vs the synthetic 21000-gas native receipt).",
        detail: "Until this lands, Hardhat scripts targeting ZVM contracts MUST verify by re-reading state (balanceOf, etc.) — the receipt will return null for ZVM tx even for a successfully-mined contract call. Native ZBX-tx (transfer/stake/etc.) ARE queryable via eth_getTransactionReceipt today.",
      },
      {
        title: "ParamChange runtime read for DEFAULT_BLOCK_GAS_LIMIT",
        files: ["zebvix-chain/src/evm_rpc.rs"],
        description: "Phase D ParamChange API can already store a u128 gas-limit value; EvmRpcCtx::evm_context() still reads the compiled-in DEFAULT_BLOCK_GAS_LIMIT = 30M. C.3 changes the read site to pull from chain state so governance can move the limit without a redeploy.",
        detail: "",
      },
      {
        title: "Custom-precompile 0x80–0x83 post-frame intent capture",
        files: ["zebvix-chain/src/evm_precompiles.rs:55", "zebvix-chain/src/evm_precompiles.rs:292", "zebvix-chain/src/state.rs"],
        description: "Today 0x80 bridge_out / 0x81 payid_resolve / 0x82 amm_swap / 0x83 multisig_propose return preview values for gas + ABI shape but DO NOT commit native side-effects when called from Solidity through eth_sendRawTransaction.",
        detail: "C.3 captures the post-frame intent set, then re-issues the equivalent native dispatch (BridgeOp::BridgeOut, RegisterPayId, Swap{direction,min_out}, MultisigOp::Propose) inside the same apply_tx so Solidity-driven flows produce the same on-chain effects as direct zbx_sendTransaction. Note that 0x81 payid_resolve is read-only and does not need a write-side commit — only the other three need post-frame action capture.",
      },
      {
        title: "Signed-arithmetic + EXTCODECOPY/RETURNDATACOPY dispatch + MODEXP EIP-2565 + alt_bn128/blake2f precompiles",
        files: ["zebvix-chain/src/evm_interp.rs", "zebvix-chain/src/evm_precompiles.rs"],
        description: "Tail of the Cancun coverage: SDIV/SMOD/SLT/SGT/SAR + EXTCODECOPY/RETURNDATACOPY in interpreter; MODEXP gas under EIP-2565; precompiles 0x06 (BN_ADD), 0x07 (BN_MUL), 0x08 (BN_PAIRING), 0x09 (BLAKE2F).",
        detail: "Pulls in alt_bn128 + blake2 deps that are deferred today.",
      },
    ],
  },

  // ─────────────────────── Future / Hardening ───────────────────────
  {
    id: "★",
    title: "Future / Cross-Cutting Hardening (PLANNED)",
    subtitle: "Items spread across modules — tracked, prioritized after C.3",
    status: "PLANNED",
    steps: [
      {
        title: "Bridge multisig oracle committee",
        files: ["zebvix-chain/src/bridge.rs", "zebvix-chain/src/multisig.rs"],
        description: "Replace the single-key gate on BridgeIn with an N-of-M signature aggregate using the existing multisig.rs module. Eliminates single-key compromise as a bridge-drain vector.",
        detail: "",
      },
      {
        title: "Bridge SPV / light-client proof",
        files: ["zebvix-chain/src/bridge.rs"],
        description: "Replace the signature gate on BridgeIn entirely with an inclusion proof against the foreign chain's header chain (the multisig committee then only signs header batches). Eliminates the trusted-oracle layer for inbound transfers.",
        detail: "",
      },
      {
        title: "Slashing auto-enforcement (currently primitives only)",
        files: ["zebvix-chain/src/staking.rs", "zebvix-chain/src/state.rs"],
        description: "slash_double_sign (5%) and slash_downtime (0.10%) live in StakingModule but are not yet auto-fired by apply_block. Wire double-sign detection from the existing vote pool and downtime detection from missed-proposer counts.",
        detail: "",
      },
      {
        title: "libp2p peer-id pinning",
        files: ["zebvix-chain/src/p2p.rs"],
        description: "SwarmBuilder::with_new_identity() rotates the libp2p peer-id on EVERY restart, which makes static peer lists brittle. Switch to with_existing_identity backed by a key on disk so multiaddrs in operator docs survive restarts.",
        detail: "",
      },
      {
        title: "Block-STM parallel execution",
        files: ["zebvix-chain/src/block_stm.rs"],
        description: "block_stm.rs is currently a design sketch — algorithm explained, no implementation yet. Lands sometime after C.3 stabilises, when single-thread block apply becomes the bottleneck.",
        detail: "",
      },
      {
        title: "Bridge fee market via Phase D ParamChange",
        files: ["zebvix-chain/src/bridge.rs", "zebvix-chain/src/proposal.rs"],
        description: "Per-asset bridge fee parameter (set via a ParamChange governance proposal) so the off-chain oracle's foreign-chain gas costs can be reimbursed from user volume rather than the protocol treasury.",
        detail: "",
      },
    ],
  },
];

// ────────────────────────────────────────────────────────────────────
// Components
// ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_STYLE[status];
  const Icon = status === "LIVE" ? CheckCircle2 : status === "PARTIAL" ? AlertTriangle : Hourglass;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono uppercase tracking-wider ${s.ring} ${s.bg} ${s.text}`}
    >
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  );
}

function PhaseSection({ phase, defaultOpen }: { phase: Phase; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState<number | null>(defaultOpen ? 0 : null);
  const s = STATUS_STYLE[phase.status];

  return (
    <div className={`rounded-lg border ${s.ring} ${s.bg} overflow-hidden`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/5 transition-colors"
      >
        <span className={`font-bold font-mono text-sm w-12 shrink-0 ${s.text}`}>{phase.id}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{phase.title}</span>
            <StatusBadge status={phase.status} />
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{phase.subtitle}</div>
        </div>
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3">
          {phase.steps.map((step, i) => (
            <div key={i} className="bg-background/50 rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === i ? null : i)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
              >
                {expanded === i
                  ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{step.title}</div>
                  {step.files.length > 0 && (
                    <div className="text-[11px] font-mono text-muted-foreground mt-0.5 break-all">
                      {step.files.join("  ·  ")}
                    </div>
                  )}
                </div>
                {expanded === i
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              </button>
              {expanded === i && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                  {step.detail && (
                    <p className="text-xs text-muted-foreground/80 leading-relaxed border-l-2 border-border pl-3">
                      {step.detail}
                    </p>
                  )}
                  {step.code && <CodeBlock language={step.codeLang ?? "bash"} code={step.code} />}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Implementation() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">
          Implementation Roadmap
        </h1>
        <p className="text-lg text-muted-foreground">
          The historical phase log for the Zebvix L1 codebase plus the explicitly-tracked pending work — all entries cross-referenced to actual files in <code className="text-xs bg-muted px-1 rounded">zebvix-chain/src/</code>. Phase ids match the <code className="text-xs bg-muted px-1 rounded">//! Phase X.Y</code> markers at the top of each Rust module.
        </p>
      </div>

      {/* Scope clarifier */}
      <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 text-sm flex gap-3">
        <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-primary">Scope of this page</div>
          <div className="text-muted-foreground text-xs leading-relaxed">
            This is <strong>not</strong> a copy-paste setup tutorial. For day-1 build &amp; node bring-up steps go to{" "}
            <strong className="text-foreground">Environment Setup</strong>; for the launch-day operational checklist see{" "}
            <strong className="text-foreground">Launch Checklist</strong>. This page tracks <em>what shipped, when, and what is pending</em> across the codebase phases — the kind of view you would want when deciding whether to build on a feature today or wait for it to mature.
          </div>
        </div>
      </div>

      {/* Compact phase strip */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {phases.map((p) => {
          const s = STATUS_STYLE[p.status];
          return (
            <div
              key={p.id}
              className={`shrink-0 flex flex-col items-center gap-1 px-2.5 py-2 rounded-md border ${s.ring} ${s.bg}`}
              title={`${p.title} — ${p.status}`}
            >
              <div className={`font-mono font-bold text-[11px] ${s.text}`}>{p.id}</div>
              <div className={`text-[9px] uppercase tracking-wider ${s.text}`}>{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Phase sections */}
      <div className="space-y-4">
        {phases.map((phase, i) => (
          <PhaseSection key={phase.id} phase={phase} defaultOpen={i === 0} />
        ))}
      </div>

      {/* Footer note */}
      <div className="p-4 rounded-lg border border-border bg-card/40 text-xs text-muted-foreground space-y-1.5">
        <div className="font-semibold text-foreground text-sm mb-1">Reading order tips</div>
        <div>• Phase A → B series → D ran in numeric order; Phase C (the ZVM stack) is tracked separately because it is gated behind <code className="text-xs bg-muted px-1 rounded">cargo --features zvm</code> and ships in its own slice.</div>
        <div>• Items in <strong className="text-foreground">PARTIAL</strong> phases are usable today within the documented caveats — see the linked dashboard pages (Smart Contracts ZVM, Cross-Chain Bridge) for exact behavior.</div>
        <div>• <strong className="text-foreground">PLANNED</strong> entries are intentionally pulled out so integrators know what they are building against vs. what is coming. Nothing in PLANNED has merged into <code className="text-xs bg-muted px-1 rounded">main</code> yet.</div>
      </div>
    </div>
  );
}
