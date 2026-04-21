import React from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { Coins, Shield, Zap, Users, Lock, TrendingUp, Wallet, GitBranch } from "lucide-react";

export default function ZbxTokenomics() {
  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">ZBX Custom Tokenomics</h1>
        <p className="text-lg text-muted-foreground">
          Complete implementation guide for Zebvix (ZBX) chain's custom economic rules — addresses, supply, rewards, and governance.
        </p>
      </div>

      {/* Full spec summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Coins,     label: "Initial Supply",    value: "2,000,000 ZBX" },
          { icon: Zap,       label: "Block Time",        value: "0.4 seconds" },
          { icon: Shield,    label: "Validator Stake",   value: "10,000 ZBX min" },
          { icon: TrendingUp,label: "Block Reward",      value: "0.1 ZBX / block" },
          { icon: Wallet,    label: "Max Val Reward",    value: "1,000 ZBX / epoch" },
          { icon: Users,     label: "Node Runner Daily", value: "5 ZBX / day" },
          { icon: Lock,      label: "Gas → Validators",  value: "80%" },
          { icon: GitBranch, label: "Gas → Treasury",    value: "20%" },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="p-4 rounded-lg bg-card border border-border">
            <Icon className="h-5 w-5 text-primary mb-2" />
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-sm font-bold font-mono text-foreground mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      {/* ── 1. EVM-Style Addresses ─────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">01</span> EVM-Compatible Addresses
        </h2>
        <div className="p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-sm">
          <span className="font-semibold text-yellow-400">Implementation level: </span>
          <span className="text-muted-foreground">Deep Rust change — requires modifying sui-types address format (32-byte → 20-byte). Requires full rebuild.</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Sui uses 32-byte addresses. To use EVM-style 20-byte (0x…40 hex chars) addresses, modify the address type in <code className="text-primary">sui-types</code>.
        </p>
        <CodeBlock language="bash" code={`# File to edit after build completes:
~/zebvix-node/crates/sui-types/src/base_types.rs`} />
        <CodeBlock language="rust" code={`// In crates/sui-types/src/base_types.rs
// Change address length constant:

// BEFORE (Sui default — 32 bytes):
pub const SUI_ADDRESS_LENGTH: usize = 32;

// AFTER (EVM-compatible — 20 bytes):
pub const SUI_ADDRESS_LENGTH: usize = 20;

// Also update the display format to show 0x prefix (40 hex chars)
// This makes addresses look like: 0x742d35Cc6634C0532925a3b8D4C9C8d8e1b5c3f
// (same as Ethereum wallet addresses)`} />
        <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs text-muted-foreground">
          <strong className="text-primary">Note:</strong> After this change, rebuild is needed + genesis must be regenerated. All wallets (MetaMask etc.) will natively support ZBX addresses.
        </div>
      </div>

      {/* ── 2. Multisig ───────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">02</span> Custom Multisig Rules
        </h2>
        <p className="text-sm text-muted-foreground">
          Zebvix (Sui) already has built-in multisig. Custom rules (e.g. 2-of-3 for treasury, time-locked multisig) go in a Move module.
        </p>
        <CodeBlock language="move" code={`// sources/zebvix_multisig.move
module zebvix::multisig {
    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;
    use sui::vec_set::{Self, VecSet};
    use sui::coin::Coin;
    use sui::transfer;

    /// Custom Zebvix Multisig Vault
    struct MultiSigVault has key {
        id: UID,
        owners: VecSet<address>,     // allowed signers
        required_sigs: u64,          // e.g. 2 out of 3
        pending_txns: vector<PendingTx>,
    }

    struct PendingTx has store, drop {
        to: address,
        amount: u64,
        approvals: VecSet<address>,
        executed: bool,
    }

    /// Create a new multisig vault — e.g. Founder treasury (2-of-3)
    public entry fun create_vault(
        owners: vector<address>,
        required_sigs: u64,
        ctx: &mut TxContext
    ) {
        let vault = MultiSigVault {
            id: object::new(ctx),
            owners: vec_set::from_keys(owners),
            required_sigs,
            pending_txns: vector::empty(),
        };
        transfer::share_object(vault);
    }

    /// Owner approves a pending transaction
    public entry fun approve_tx(
        vault: &mut MultiSigVault,
        tx_index: u64,
        ctx: &TxContext
    ) {
        let sender = sui::tx_context::sender(ctx);
        assert!(vec_set::contains(&vault.owners, &sender), 0);
        let tx = vector::borrow_mut(&mut vault.pending_txns, tx_index);
        vec_set::insert(&mut tx.approvals, sender);
    }
}`} />
      </div>

      {/* ── 3. Native Token Supply ────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">03</span> Native Token — 2 Million Initial Supply
        </h2>
        <p className="text-sm text-muted-foreground">
          Set in genesis.yaml — only 2,000,000 ZBX minted at genesis. Goes into a chain pool with pre-allocation buckets.
        </p>
        <CodeBlock language="yaml" code={`# /var/zebvix/genesis/genesis.yaml
chain_id: "zebvix-mainnet-1"
epoch_duration_ms: 86400000          # 24 hours per epoch
block_time_ms: 400                   # 0.4 seconds per block ✅

# Total initial supply: 2,000,000 ZBX (in MIST = × 10^9)
initial_supply_mist: 2000000000000000  # 2,000,000 ZBX

# Pre-allocation from initial supply:
allocations:
  - address: "0xFOUNDER_TREASURY"
    amount_mist: 600000000000000     # 600,000 ZBX (30%) — Founder Treasury

  - address: "0xCHAIN_POOL"
    amount_mist: 800000000000000     # 800,000 ZBX (40%) — Chain Pool

  - address: "0xTEAM_VESTING"
    amount_mist: 400000000000000     # 400,000 ZBX (20%) — Team (vested)

  - address: "0xECOSYSTEM"
    amount_mist: 200000000000000     # 200,000 ZBX (10%) — Ecosystem grants

# Validator staking requirement
min_validator_stake_mist: 10000000000000  # 10,000 ZBX ✅
max_validator_count: 100
reference_gas_price: 1000`} />
      </div>

      {/* ── 4. Block Reward to Founder Treasury ──────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">04</span> Block Reward — 0.1 ZBX per Block to Treasury
        </h2>
        <p className="text-sm text-muted-foreground">
          Every 0.4 seconds (each block), 0.1 ZBX is minted and sent to Founder Treasury. This is a Rust-level change in the reward distribution module.
        </p>
        <CodeBlock language="rust" code={`// File: crates/sui-core/src/epoch/reconfiguration.rs
// OR: crates/sui-types/src/sui_system_state/sui_system_state_inner_v1.rs
// Find the block/epoch reward calculation function and add:

// Zebvix: 0.1 ZBX per block to founder treasury
const ZEBVIX_BLOCK_TREASURY_REWARD_MIST: u64 = 100_000_000; // 0.1 ZBX
const FOUNDER_TREASURY_ADDRESS: &str = "0xFOUNDER_TREASURY_ADDRESS_HERE";

// In block processing function, add:
fn distribute_block_reward(block_height: u64, ctx: &mut TxContext) {
    // Mint 0.1 ZBX to founder treasury every block
    let treasury_coin = coin::mint(ZEBVIX_BLOCK_TREASURY_REWARD_MIST, ctx);
    transfer::public_transfer(treasury_coin, FOUNDER_TREASURY_ADDRESS.parse().unwrap());
}`} />
        <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs">
          <strong className="text-primary">Math: </strong>
          <span className="text-muted-foreground">
            0.1 ZBX × (86400 ÷ 0.4) blocks/day = <strong className="text-foreground">21,600 ZBX/day</strong> to treasury.
            Per year = ~7.9M ZBX minted to treasury.
          </span>
        </div>
      </div>

      {/* ── 5. Block Time 0.4s ───────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">05</span> Block Time — 0.4 Seconds
        </h2>
        <CodeBlock language="yaml" code={`# genesis.yaml mein set karo:
consensus_config:
  max_round_delay_ms: 400          # 0.4 second max round time
  round_timeout_ms: 400`} />
        <CodeBlock language="rust" code={`// crates/sui-node/src/lib.rs ya consensus config mein:
const ZEBVIX_ROUND_TIMEOUT_MS: u64 = 400;  // 0.4 seconds ✅

// Mysticeti consensus (Sui's engine) already supports sub-second finality
// 0.4s is achievable with good network between validators`} />
      </div>

      {/* ── 6. Gas Fee Distribution ──────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">06</span> Gas Fee Split — 80% Validators / 20% Treasury
        </h2>
        <CodeBlock language="rust" code={`// crates/sui-types/src/sui_system_state/sui_system_state_inner_v1.rs
// Find gas fee distribution logic:

const VALIDATOR_GAS_SHARE_BPS: u64 = 8000;  // 80% to validators ✅
const TREASURY_GAS_SHARE_BPS: u64  = 2000;  // 20% to founder treasury ✅
const FOUNDER_TREASURY: address = @0xFOUNDER_TREASURY;

fun distribute_gas_fees(total_gas: u64, validators: &vector<ValidatorV1>, ctx: &mut TxContext) {
    let validator_share = (total_gas * VALIDATOR_GAS_SHARE_BPS) / 10000;
    let treasury_share  = (total_gas * TREASURY_GAS_SHARE_BPS)  / 10000;

    // Split equally among all active validators
    let per_validator = validator_share / vector::length(validators);
    // ... distribute per_validator to each validator address

    // Send 20% to founder treasury
    let treasury_coin = coin::take(&mut gas_pool, treasury_share, ctx);
    transfer::public_transfer(treasury_coin, FOUNDER_TREASURY);
}`} />
      </div>

      {/* ── 7. Validator Reward Cap ──────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">07</span> Validator Max Reward — 1,000 ZBX/epoch
        </h2>
        <CodeBlock language="rust" code={`// In validator reward distribution:
const MAX_VALIDATOR_REWARD_PER_EPOCH_MIST: u64 = 1_000_000_000_000; // 1,000 ZBX

fn calculate_validator_reward(earned: u64) -> u64 {
    // Cap rewards at 1,000 ZBX per epoch per validator
    std::cmp::min(earned, MAX_VALIDATOR_REWARD_PER_EPOCH_MIST)
}`} />
        <div className="p-3 rounded-lg border border-border bg-muted/20 text-xs text-muted-foreground">
          Validator requirements: <span className="text-foreground font-mono">min stake = 10,000 ZBX</span> &nbsp;·&nbsp;
          <span className="text-foreground font-mono">max reward = 1,000 ZBX/epoch</span> &nbsp;·&nbsp;
          <span className="text-foreground font-mono">max validators = 100</span>
        </div>
      </div>

      {/* ── 8. Node Runner Reward ────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">08</span> Node Runner Reward — 5 ZBX/day (max 4,000 ZBX total)
        </h2>
        <p className="text-sm text-muted-foreground">
          Full nodes (jo bina stake ke chain data serve karte hain) ko 5 ZBX/day milega — lekin saare node runners mein combined limit 4,000 ZBX/day hai.
        </p>
        <CodeBlock language="move" code={`// sources/node_rewards.move — Move contract for node runner rewards
module zebvix::node_rewards {
    use sui::object::{Self, UID};
    use sui::coin::{Self, Coin};
    use sui::clock::Clock;
    use sui::tx_context::TxContext;
    use sui::transfer;
    use sui::table::{Self, Table};

    const PER_NODE_DAILY_REWARD_MIST: u64 = 5_000_000_000;      // 5 ZBX per day
    const MAX_TOTAL_DAILY_POOL_MIST: u64  = 4_000_000_000_000;  // 4,000 ZBX total/day cap
    const MS_PER_DAY: u64 = 86_400_000;

    struct NodeRewardPool has key {
        id: UID,
        registered_nodes: Table<address, u64>, // address -> last_claim_timestamp
        daily_pool_remaining: u64,             // resets each epoch
        last_reset_epoch: u64,
    }

    /// Node runner registers to receive daily rewards
    public entry fun register_node(pool: &mut NodeRewardPool, ctx: &mut TxContext) {
        let node_addr = sui::tx_context::sender(ctx);
        if (!table::contains(&pool.registered_nodes, node_addr)) {
            table::add(&mut pool.registered_nodes, node_addr, 0);
        }
    }

    /// Node runner claims their daily 5 ZBX reward
    public entry fun claim_daily_reward(
        pool: &mut NodeRewardPool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let node_addr = sui::tx_context::sender(ctx);
        let now = sui::clock::timestamp_ms(clock);
        let last_claim = *table::borrow(&pool.registered_nodes, node_addr);

        // Check: 24 hours passed since last claim
        assert!(now - last_claim >= MS_PER_DAY, 0);
        // Check: daily pool not exhausted
        assert!(pool.daily_pool_remaining >= PER_NODE_DAILY_REWARD_MIST, 1);

        // Update state
        *table::borrow_mut(&mut pool.registered_nodes, node_addr) = now;
        pool.daily_pool_remaining = pool.daily_pool_remaining - PER_NODE_DAILY_REWARD_MIST;

        // Mint 5 ZBX to node runner
        // (integrate with treasury mint capability)
    }
}`} />
      </div>

      {/* ── Full Summary Table ───────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold border-b border-border pb-2">Complete ZBX Economic Summary</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Parameter</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Value</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Implementation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["Address format", "EVM 20-byte (0x…)", "Rust change — sui-types"],
                ["Multisig", "Custom rules", "Move module"],
                ["Initial supply", "2,000,000 ZBX", "genesis.yaml"],
                ["Chain pool (pre-alloc)", "800,000 ZBX (40%)", "genesis.yaml"],
                ["Founder treasury (pre-alloc)", "600,000 ZBX (30%)", "genesis.yaml"],
                ["Block time", "0.4 seconds", "genesis.yaml + consensus config"],
                ["Block reward → treasury", "0.1 ZBX / block", "Rust change — reward module"],
                ["Validator min stake", "10,000 ZBX", "genesis.yaml"],
                ["Validator max reward", "1,000 ZBX / epoch", "Rust change — reward cap"],
                ["Gas fee split", "80% validators / 20% treasury", "Rust change — gas distribution"],
                ["Node runner reward", "5 ZBX / day", "Move contract"],
                ["Node runner pool cap", "4,000 ZBX / day total", "Move contract"],
              ].map(([param, value, impl_]) => (
                <tr key={param} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-foreground">{param}</td>
                  <td className="px-4 py-2.5 font-mono text-primary text-xs">{value}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{impl_}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Implementation Order ─────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold border-b border-border pb-2">Implementation Order</h2>
        <div className="space-y-2">
          {[
            { step: "1", label: "Genesis config (supply, block time, stake req)", type: "No rebuild", color: "text-green-400" },
            { step: "2", label: "EVM addresses (sui-types address length)", type: "Full rebuild", color: "text-yellow-400" },
            { step: "3", label: "Gas fee split 80/20 (reward module)", type: "Full rebuild", color: "text-yellow-400" },
            { step: "4", label: "Block reward 0.1 ZBX to treasury", type: "Full rebuild", color: "text-yellow-400" },
            { step: "5", label: "Validator reward cap 1000 ZBX", type: "Full rebuild", color: "text-yellow-400" },
            { step: "6", label: "Node runner rewards (Move contract)", type: "Deploy contract", color: "text-green-400" },
            { step: "7", label: "Multisig treasury (Move contract)", type: "Deploy contract", color: "text-green-400" },
          ].map(({ step, label, type, color }) => (
            <div key={step} className="flex items-center gap-4 p-3 rounded-lg bg-card border border-border">
              <div className="text-lg font-bold font-mono text-primary w-6">{step}</div>
              <div className="flex-1 text-sm text-foreground">{label}</div>
              <div className={`text-xs font-mono px-2 py-0.5 rounded-full border ${
                color === "text-green-400"
                  ? "border-green-500/30 bg-green-500/10 text-green-400"
                  : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
              }`}>{type}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
