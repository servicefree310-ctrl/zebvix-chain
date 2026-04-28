import React from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { Coins, Shield, Zap, Users, Lock, TrendingUp, Wallet, GitBranch, Flame, BarChart2, ChevronDown } from "lucide-react";

export default function ZbxTokenomics() {
  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">ZBX Custom Tokenomics</h1>
        <p className="text-lg text-muted-foreground">
          Complete economic design for Zebvix (ZBX) — supply cap, halving schedule, burn mechanism, and reward distribution.
        </p>
      </div>

      {/* ── Key Stats ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Coins,      label: "Genesis Supply",      value: "2,000,000 ZBX" },
          { icon: BarChart2,  label: "Max Total Supply",    value: "150,000,000 ZBX" },
          { icon: Flame,      label: "Fee Burn",            value: "10% of all fees" },
          { icon: ChevronDown,label: "1st Halving",         value: "@ 50M minted" },
          { icon: ChevronDown,label: "2nd Halving",         value: "@ 100M minted" },
          { icon: Zap,        label: "Block Time",          value: "0.4 seconds" },
          { icon: Shield,     label: "Validator Stake",     value: "10,000 ZBX min" },
          { icon: TrendingUp, label: "Block Reward",        value: "0.1 ZBX / block" },
          { icon: Wallet,     label: "Max Val Reward",      value: "1,000 ZBX / epoch" },
          { icon: Users,      label: "Node Runner Daily",   value: "5 ZBX / day" },
          { icon: Lock,       label: "Gas → Validators",    value: "80%" },
          { icon: GitBranch,  label: "Gas → Treasury",      value: "20%" },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="p-4 rounded-lg bg-card border border-border">
            <Icon className="h-5 w-5 text-primary mb-2" />
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-sm font-bold font-mono text-foreground mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      {/* ── Supply Architecture ───────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">01</span> Supply Architecture
        </h2>

        {/* Visual supply bar */}
        <div className="p-5 rounded-lg bg-card border border-border space-y-3">
          <div className="text-sm font-semibold text-foreground mb-3">ZBX Supply Journey (0 → 150M)</div>
          {[
            { label: "Genesis (start)",        amount: "2M",   pct: 1.3,  color: "bg-primary" },
            { label: "1st Halving zone (0–50M)",amount: "50M",  pct: 33.3, color: "bg-cyan-500" },
            { label: "2nd Halving zone (50–100M)", amount: "50M", pct: 33.3, color: "bg-blue-500" },
            { label: "Post-2nd Halving (100–150M)", amount: "50M", pct: 33.3, color: "bg-indigo-500" },
          ].map(({ label, amount, pct, color }) => (
            <div key={label} className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{label}</span>
                <span className="font-mono text-foreground">{amount} ZBX</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          ))}
          <div className="pt-2 border-t border-border flex justify-between text-xs">
            <span className="text-muted-foreground">Hard Cap</span>
            <span className="font-mono font-bold text-primary">150,000,000 ZBX — Never Exceeded</span>
          </div>
        </div>

        <CodeBlock language="rust" code={`// crates/sui-types/src/gas_coin.rs — Supply constants

pub const MIST_PER_ZBX: u64 = 1_000_000_000;          // 9 decimals

// Genesis initial mint (only this amount at chain start)
pub const GENESIS_SUPPLY_ZBX: u64 = 2_000_000;
pub const GENESIS_SUPPLY_MIST: u64 = GENESIS_SUPPLY_ZBX * MIST_PER_ZBX;

// Absolute maximum ever — hard cap (enforced in mint function)
pub const MAX_TOTAL_SUPPLY_ZBX: u64  = 150_000_000;
pub const MAX_TOTAL_SUPPLY_MIST: u64 = MAX_TOTAL_SUPPLY_ZBX * MIST_PER_ZBX;

// Halving checkpoints (in ZBX minted since genesis)
pub const FIRST_HALVING_SUPPLY_ZBX:  u64 = 50_000_000;  // @ 50M minted
pub const SECOND_HALVING_SUPPLY_ZBX: u64 = 100_000_000; // @ 100M minted

// Starting block reward (before any halving)
pub const INITIAL_BLOCK_REWARD_MIST: u64 = 100_000_000; // 0.1 ZBX`} />
      </div>

      {/* ── Halving Schedule ──────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">02</span> Halving Schedule
        </h2>
        <p className="text-sm text-muted-foreground">
          Halving triggers automatically when total minted supply crosses the checkpoint. Affects <strong className="text-foreground">all three reward types</strong> — validators, node runners, and delegators.
        </p>

        {/* Halving table */}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Phase</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Supply Range</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Block Reward</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Validator Max/epoch</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Node Runner/day</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Delegator APY</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                { phase: "Genesis",        range: "2M – 50M",    block: "0.1 ZBX",  valMax: "1,000 ZBX", node: "5 ZBX",  apy: "Full rate",  active: true },
                { phase: "After 1st Halving", range: "50M – 100M", block: "0.05 ZBX", valMax: "500 ZBX",   node: "2.5 ZBX", apy: "50% rate", active: false },
                { phase: "After 2nd Halving", range: "100M – 150M",block: "0.025 ZBX",valMax: "250 ZBX",   node: "1.25 ZBX",apy: "25% rate", active: false },
                { phase: "Hard Cap Reached",  range: "150M",       block: "0 ZBX",    valMax: "Gas fees only", node: "Gas share", apy: "Gas only", active: false },
              ].map(({ phase, range, block, valMax, node, apy, active }) => (
                <tr key={phase} className={`hover:bg-muted/20 transition-colors ${active ? "bg-primary/5" : ""}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {active && <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
                      <span className={`font-medium ${active ? "text-primary" : "text-foreground"}`}>{phase}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{range}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{block}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{valMax}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{node}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{apy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <CodeBlock language="rust" code={`// Halving logic — add to reward distribution module
// crates/sui-core/src/epoch/reconfiguration.rs

fn get_current_reward_multiplier(total_minted_mist: u64) -> u64 {
    let total_minted_zbx = total_minted_mist / MIST_PER_ZBX;

    if total_minted_zbx >= MAX_TOTAL_SUPPLY_ZBX {
        return 0; // Hard cap reached — no more block rewards
    } else if total_minted_zbx >= SECOND_HALVING_SUPPLY_ZBX {
        return 25; // After 2nd halving = 25% of original (0.025 ZBX/block)
    } else if total_minted_zbx >= FIRST_HALVING_SUPPLY_ZBX {
        return 50; // After 1st halving = 50% of original (0.05 ZBX/block)
    } else {
        return 100; // Genesis phase = 100% (0.1 ZBX/block)
    }
}

fn calculate_block_reward(total_minted_mist: u64) -> u64 {
    let multiplier = get_current_reward_multiplier(total_minted_mist);
    (INITIAL_BLOCK_REWARD_MIST * multiplier) / 100
}

// Apply same multiplier to ALL reward types:
fn calculate_validator_max_reward(base_max: u64, total_minted: u64) -> u64 {
    let multiplier = get_current_reward_multiplier(total_minted);
    std::cmp::min(earned, (base_max * multiplier) / 100)
}

fn calculate_node_runner_reward(total_minted: u64) -> u64 {
    let multiplier = get_current_reward_multiplier(total_minted);
    (PER_NODE_DAILY_REWARD_MIST * multiplier) / 100
}`} />
      </div>

      {/* ── Burn Mechanism ────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">03</span> Fee Burn — 10% of All Fees
        </h2>
        <p className="text-sm text-muted-foreground">
          10% of every transaction fee is permanently burned — reducing supply over time. This makes ZBX deflationary as network usage increases.
        </p>

        {/* Fee split visual */}
        <div className="p-5 rounded-lg bg-card border border-border space-y-3">
          <div className="text-sm font-semibold mb-3">Transaction Fee Distribution (per txn)</div>
          {[
            { label: "Node Runners",    pct: 22, color: "bg-cyan-500",   value: "22%" },
            { label: "Validators",      pct: 30, color: "bg-primary",    value: "30%" },
            { label: "Delegators",      pct: 20, color: "bg-pink-500",   value: "20%" },
            { label: "Founder Treasury",pct: 18, color: "bg-blue-500",   value: "18%" },
            { label: "Burned forever 🔥",pct: 10, color: "bg-red-500",   value: "10%" },
          ].map(({ label, pct, color, value }) => (
            <div key={label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono font-bold text-foreground">{value}</span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          ))}
        </div>

        <CodeBlock language="rust" code={`// In gas fee distribution function:
// crates/sui-types/src/sui_system_state/sui_system_state_inner_v1.rs

const GAS_NODE_BPS: u64      = 2200;  // 22% → node runners
const GAS_VALIDATOR_BPS: u64 = 3000;  // 30% → validators
const GAS_DELEGATOR_BPS: u64 = 2000;  // 20% → delegators
const GAS_TREASURY_BPS: u64  = 1800;  // 18% → founder treasury (20% of 90%)
// Total = 10000 bps = 100%

fn distribute_gas_fees(
    total_gas_mist: u64,
    validators: &[Validator],
    treasury_addr: SuiAddress,
    ctx: &mut TxContext,
) {
    // 1. Calculate shares
    let burn_amount      = (total_gas_mist * BURN_BPS)      / 10000;
    let validator_amount = (total_gas_mist * VALIDATOR_BPS)  / 10000;
    let treasury_amount  = (total_gas_mist * TREASURY_BPS)   / 10000;

    // 2. BURN — permanently destroy 10%
    // Burn by sending to 0x0 (dead address) or using coin::burn
    let burn_coin = coin::take(&mut fee_pool, burn_amount, ctx);
    coin::burn(burn_treasury_cap, burn_coin); // permanently removed from supply

    // 3. Distribute 22% to active node runners
    let per_node = node_amount / (node_runners.len() as u64);
    for node in node_runners {
        let reward = coin::take(&mut fee_pool, per_node, ctx);
        transfer::public_transfer(reward, node.wallet_address);
    }

    // 4. Split 30% among all active validators (staking reward)
    let per_validator = validator_amount / (validators.len() as u64);
    for validator in validators {
        let reward = coin::take(&mut fee_pool, per_validator, ctx);
        transfer::public_transfer(reward, validator.sui_address);
    }

    // 5. Split 20% proportionally among delegators
    // (handled by staking_pool.move — distributed via claim_delegation_rewards)

    // 6. Send 18% to founder treasury
    let treasury_coin = coin::take(&mut fee_pool, treasury_amount, ctx);
    transfer::public_transfer(treasury_coin, treasury_addr);
}`} />
        <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-xs">
          <span className="font-semibold text-red-400">Deflationary Effect: </span>
          <span className="text-muted-foreground">
            As network usage grows, more fees are burned. At 1M daily transactions @ 0.001 ZBX fee → 1,000 ZBX burned per day.
            Over the long term, circulating supply trends down.
          </span>
        </div>
      </div>

      {/* ── Delegator Rewards ─────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">04</span> Delegator Rewards (also Halving-affected)
        </h2>
        <p className="text-sm text-muted-foreground">
          ZBX holders who delegate to validators are also subject to the halving — their rewards scale by the same multiplier.
        </p>
        <CodeBlock language="move" code={`// Delegator reward calculation in Move (sui-system module)
// sources/sui_system/validator_set.move

// Delegator gets % of validator's reward proportional to their stake
// Halving applies: same multiplier as validator rewards

fun calculate_delegator_reward(
    delegated_amount: u64,
    validator_total_stake: u64,
    validator_epoch_reward: u64,  // already halving-adjusted
    commission_rate: u64,         // validator's cut (e.g. 10%)
): u64 {
    // Delegator's share = (their_stake / total_stake) × reward × (1 - commission)
    let gross_share = (delegated_amount * validator_epoch_reward) / validator_total_stake;
    let commission  = (gross_share * commission_rate) / 10000;
    gross_share - commission
    // Halving already applied to validator_epoch_reward so delegators affected too ✅
}`} />

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reward Type</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Pre-Halving</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">After 1st (50M)</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">After 2nd (100M)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["Block reward", "0.1 ZBX/block", "0.05 ZBX/block", "0.025 ZBX/block"],
                ["Validator max/epoch", "1,000 ZBX", "500 ZBX", "250 ZBX"],
                ["Node runner/day", "5 ZBX", "2.5 ZBX", "1.25 ZBX"],
                ["Delegator APY", "~Full rate", "~50% of rate", "~25% of rate"],
                ["Fee burn", "10% always", "10% always", "10% always"],
              ].map((row) => (
                <tr key={row[0]} className="hover:bg-muted/20 transition-colors">
                  {row.map((cell, i) => (
                    <td key={i} className={`px-4 py-2.5 font-mono text-xs ${i === 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Supply Control ────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2 flex items-center gap-2">
          <span className="text-primary font-mono text-lg">05</span> Hard Cap Enforcement
        </h2>
        <CodeBlock language="rust" code={`// Every mint call must check the hard cap — NO EXCEPTIONS
fn mint_zbx(
    amount_mist: u64,
    current_total_minted: &mut u64,
    ctx: &mut TxContext
) -> Coin<ZBX> {
    let new_total = *current_total_minted + amount_mist;

    // Hard cap: 150 million ZBX — cannot mint more ever
    assert!(
        new_total <= MAX_TOTAL_SUPPLY_MIST,
        EMaxSupplyExceeded  // error code
    );

    *current_total_minted = new_total;
    coin::mint(amount_mist, ctx)
    // After 150M: block rewards = 0, only gas fee distribution continues
}`} />
      </div>

      {/* ── Full Summary ──────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2">Complete ZBX Economic Summary</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Parameter</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Value</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Where to implement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["Address format", "ZVM 20-byte", "Rust — sui-types"],
                ["Genesis supply", "2,000,000 ZBX", "genesis.yaml"],
                ["Hard cap (max ever)", "150,000,000 ZBX", "Rust — mint function"],
                ["1st halving trigger", "@ 50M ZBX minted", "Rust — reward module"],
                ["2nd halving trigger", "@ 100M ZBX minted", "Rust — reward module"],
                ["Halving effect", "50% reward cut each time", "Rust — all reward calcs"],
                ["Block time", "0.4 seconds", "genesis.yaml"],
                ["Block reward (genesis)", "0.1 ZBX → treasury", "Rust — block processing"],
                ["Validator stake req", "10,000 ZBX min", "genesis.yaml"],
                ["Validator max reward", "1,000 ZBX/epoch (halving applies)", "Rust — reward cap"],
                ["Node bond", "100 ZBX locked collateral", "Move — ValidatorStake.node_bond"],
                ["Gas → node runners", "22% (active node operators only) — bond required", "Rust — gas distribution"],
                ["Gas → validators", "30% (staking reward)", "Rust — gas distribution"],
                ["Gas → delegators", "20% (proportional)", "Rust — gas distribution"],
                ["Gas → treasury", "18% (founder treasury)", "Rust — gas distribution"],
                ["Gas → burn", "10% permanently destroyed 🔥", "Rust — gas distribution"],
                ["Node runner reward", "5 ZBX/day (halving applies)", "Move contract"],
                ["Node runner pool cap", "4,000 ZBX/day total", "Move contract"],
                ["Delegator rewards", "Proportional, halving applies", "Move — sui-system"],
                ["Multisig treasury", "Custom rules", "Move contract"],
              ].map(([param, value, impl_]) => (
                <tr key={param} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2 font-medium text-foreground text-xs">{param}</td>
                  <td className="px-4 py-2 font-mono text-primary text-xs">{value}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{impl_}</td>
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
            { step: "1", label: "genesis.yaml — supply, block time, validator stake req", type: "No rebuild needed",  color: "green" },
            { step: "2", label: "ZVM 20-byte address (sui-types)", type: "Full rebuild", color: "yellow" },
            { step: "3", label: "MAX_TOTAL_SUPPLY hard cap in mint function", type: "Full rebuild", color: "yellow" },
            { step: "4", label: "Halving multiplier in reward module", type: "Full rebuild", color: "yellow" },
            { step: "5", label: "Gas fee split: 22% node / 30% val / 20% del / 18% treasury / 10% burn", type: "Full rebuild", color: "yellow" },
            { step: "6", label: "Block reward 0.1 ZBX → treasury per block", type: "Full rebuild", color: "yellow" },
            { step: "7", label: "Node runner 5 ZBX/day Move contract", type: "Deploy contract", color: "green" },
            { step: "8", label: "Delegator reward contract", type: "Deploy contract", color: "green" },
            { step: "9", label: "Multisig treasury Move contract", type: "Deploy contract", color: "green" },
          ].map(({ step, label, type, color }) => (
            <div key={step} className="flex items-center gap-4 p-3 rounded-lg bg-card border border-border">
              <div className="text-lg font-bold font-mono text-primary w-6 shrink-0">{step}</div>
              <div className="flex-1 text-sm text-foreground">{label}</div>
              <div className={`text-xs font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                color === "green"
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
