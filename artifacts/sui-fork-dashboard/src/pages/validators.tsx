import React, { useEffect, useMemo, useState } from "react";
import { rpc, weiHexToZbx, shortAddr } from "@/lib/zbx-rpc";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Server,
  Shield,
  Coins,
  Clock,
  Hammer,
  Cpu,
  HardDrive,
  Wifi,
  KeyRound,
  Settings2,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Users,
  Percent,
  TrendingUp,
  PlayCircle,
  Network,
  Copy,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────
interface ValidatorRecord {
  address: string;
  pubkey: string;
  voting_power: number;
}
interface ListValidatorsResponse {
  count: number;
  total_voting_power: number;
  quorum_threshold: number;
  validators: ValidatorRecord[];
}

interface StakingValidatorRecord {
  address: string;
  operator: string;
  pubkey: string;
  total_stake_wei: string;
  total_shares: string;
  commission_bps: number;
  commission_pool_wei: string;
  jailed: boolean;
  jailed_until_epoch: number;
  last_commission_edit_epoch?: number;
}
interface ActiveSetEntry {
  address: string;
  voting_power: number;
}
interface UnbondingEntry {
  delegator: string;
  validator: string;
  amount_wei: string;
  mature_at_epoch: number;
}
interface StakingResponse {
  current_epoch: number;
  epoch_blocks: number;
  epoch_reward_wei: string;
  unbonding_epochs: number;
  min_self_bond_wei: string;
  min_self_bond_dynamic_wei: string;
  min_self_bond_usd_micro: number;
  min_delegation_wei: string;
  max_commission_bps: number;
  max_commission_delta_bps: number;
  total_slashed_wei: string;
  validator_count: number;
  delegation_count: number;
  unbonding_count: number;
  validators: StakingValidatorRecord[];
  unbonding_queue: UnbondingEntry[];
  active_set: ActiveSetEntry[];
}

interface SupplyInfo {
  height: number;
  current_block_reward_wei?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function safeBig(s: string | undefined | null): bigint {
  if (!s) return 0n;
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

function bpsToPct(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);
}

function fmtSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)} days`;
}

function copyToClipboard(t: string) {
  void navigator.clipboard?.writeText(t).catch(() => {});
}

// ─── Sub-components ────────────────────────────────────────────────────────
function StatTile({
  icon: Icon,
  label,
  value,
  unit,
  hint,
  iconColor = "text-cyan-400",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: string;
  iconColor?: string;
}) {
  return (
    <div className="p-4 border border-border rounded-lg bg-card/80 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-foreground font-mono leading-tight">
          {value}
        </span>
        {unit && (
          <span className="text-xs text-muted-foreground font-mono">{unit}</span>
        )}
      </div>
      {hint && (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

function ParamRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border/40 last:border-0">
      <div className="space-y-0.5">
        <div className="text-sm text-foreground">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="text-sm font-mono text-cyan-300 text-right whitespace-nowrap">
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ jailed }: { jailed: boolean }) {
  return jailed ? (
    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30 font-mono">
      <Lock className="w-3 h-3" /> JAILED
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
      <CheckCircle2 className="w-3 h-3" /> ACTIVE
    </span>
  );
}

function StepHeader({
  num,
  title,
  icon: Icon,
}: {
  num: number;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-8 h-8 rounded-md bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 font-mono text-sm font-bold">
        {num}
      </div>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-cyan-400" />
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
    </div>
  );
}

function CopyableAddress({ addr }: { addr: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        copyToClipboard(addr);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground hover:text-cyan-300 transition-colors group"
      title={addr}
    >
      <span>{shortAddr(addr, 8, 6)}</span>
      <Copy
        className={`w-3 h-3 transition-colors ${copied ? "text-emerald-400" : "text-muted-foreground group-hover:text-cyan-300"}`}
      />
    </button>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────
export default function Validators() {
  const [list, setList] = useState<ListValidatorsResponse | null>(null);
  const [staking, setStaking] = useState<StakingResponse | null>(null);
  const [supply, setSupply] = useState<SupplyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [lv, sk, sp] = await Promise.all([
          rpc<ListValidatorsResponse>("zbx_listValidators"),
          rpc<StakingResponse>("zbx_getStaking"),
          rpc<SupplyInfo>("zbx_supply").catch(() => null),
        ]);
        if (!cancelled) {
          setList(lv);
          setStaking(sk);
          setSupply(sp);
          setError(null);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "RPC unreachable");
        }
      }
    };
    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Derived metrics
  const totalBondedWei = useMemo(() => {
    if (!staking) return 0n;
    return staking.validators.reduce(
      (acc, v) => acc + safeBig(v.total_stake_wei),
      0n,
    );
  }, [staking]);

  const epochSeconds = useMemo(() => {
    if (!staking) return 0;
    return staking.epoch_blocks * 5;
  }, [staking]);

  const annualEpochs = useMemo(() => {
    if (!staking) return 0;
    return Math.floor((365.25 * 24 * 3600) / epochSeconds);
  }, [staking, epochSeconds]);

  // Approximate APY: epochs/year × epoch_reward / total_bonded_zbx × 100
  const networkApyPct = useMemo(() => {
    if (!staking || totalBondedWei === 0n) return null;
    const rewardPerYearWei =
      safeBig(staking.epoch_reward_wei) * BigInt(annualEpochs);
    if (totalBondedWei === 0n) return null;
    const bp = Number((rewardPerYearWei * 10000n) / totalBondedWei);
    return bp / 100;
  }, [staking, totalBondedWei, annualEpochs]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
          Validator Setup
        </h1>
        <p className="text-muted-foreground">
          Run a Zebvix validator node — produce blocks, secure the chain, and
          earn ZBX rewards. Every value below is pulled live from the running
          chain.
        </p>
      </div>

      {error && (
        <div className="p-4 border border-red-500/30 bg-red-500/10 rounded-lg text-sm text-red-300">
          ⚠ Validator RPC unreachable: {error}
        </div>
      )}

      {/* Live network stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile
          icon={Server}
          label="Active Validators"
          value={list ? list.count : "—"}
          unit={list ? `/ ∞` : ""}
          hint={list ? `Voting power: ${list.total_voting_power}` : undefined}
          iconColor="text-cyan-400"
        />
        <StatTile
          icon={Coins}
          label="Total Bonded"
          value={staking ? weiHexToZbx(totalBondedWei.toString()) : "—"}
          unit="ZBX"
          hint="Self-bond + delegations"
          iconColor="text-emerald-400"
        />
        <StatTile
          icon={Activity}
          label="Current Epoch"
          value={staking ? `#${staking.current_epoch}` : "—"}
          hint={
            staking
              ? `${staking.epoch_blocks.toLocaleString()} blocks (~${fmtSeconds(epochSeconds)})`
              : undefined
          }
          iconColor="text-violet-400"
        />
        <StatTile
          icon={TrendingUp}
          label="Epoch Reward"
          value={staking ? weiHexToZbx(staking.epoch_reward_wei) : "—"}
          unit="ZBX"
          hint={
            networkApyPct !== null
              ? networkApyPct > 100
                ? `Bootstrap APY ${networkApyPct.toFixed(0)}% (normalizes as bond grows)`
                : `Network APY ≈ ${networkApyPct.toFixed(2)}%`
              : "Distributed pro-rata"
          }
          iconColor="text-amber-400"
        />
        <StatTile
          icon={Shield}
          label="Quorum Threshold"
          value={list ? `${list.quorum_threshold}` : "—"}
          hint={
            list && list.total_voting_power
              ? `${((list.quorum_threshold / list.total_voting_power) * 100).toFixed(1)}% of voting power`
              : "BFT 2/3"
          }
          iconColor="text-red-400"
        />
      </div>

      {/* Active validator set table */}
      <div className="border border-border rounded-lg bg-card/80 overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="w-5 h-5 text-cyan-400" />
              Active Validator Set
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live from <code className="text-cyan-300">zbx_getStaking</code> ·
              auto-refresh every 10s
            </p>
          </div>
          {staking && (
            <div className="text-xs text-muted-foreground font-mono">
              {staking.validator_count} validator(s) ·{" "}
              {staking.delegation_count} delegation(s) ·{" "}
              {staking.unbonding_count} unbonding
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Address</th>
                <th className="text-right px-4 py-2 font-medium">Total Stake</th>
                <th className="text-right px-4 py-2 font-medium">Voting Power</th>
                <th className="text-right px-4 py-2 font-medium">Commission</th>
                <th className="text-right px-4 py-2 font-medium">
                  Pending Commission
                </th>
                <th className="text-center px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {staking ? (
                staking.validators.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center text-muted-foreground text-sm"
                    >
                      No validators registered yet.
                    </td>
                  </tr>
                ) : (
                  staking.validators.map((v) => {
                    const active = staking.active_set.find(
                      (a) => a.address === v.address,
                    );
                    return (
                      <tr
                        key={v.address}
                        className="border-t border-border/40 hover:bg-zinc-900/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <CopyableAddress addr={v.address} />
                            <div className="text-[10px] text-muted-foreground">
                              op: {shortAddr(v.operator, 6, 4)}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-300">
                          {weiHexToZbx(v.total_stake_wei)}{" "}
                          <span className="text-muted-foreground">ZBX</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-foreground">
                          {active ? active.voting_power.toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-violet-300">
                          {bpsToPct(v.commission_bps)}%
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-amber-300">
                          {weiHexToZbx(v.commission_pool_wei)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge jailed={v.jailed} />
                        </td>
                      </tr>
                    );
                  })
                )
              ) : (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-muted-foreground text-sm"
                  >
                    Loading validator set…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Network parameters */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-border rounded-lg bg-card/80 p-5">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
            <Settings2 className="w-5 h-5 text-cyan-400" />
            Stake & Bond Requirements
          </h2>
          <div className="space-y-1">
            <ParamRow
              label="Min self-bond (hard floor)"
              value={
                staking
                  ? `${weiHexToZbx(staking.min_self_bond_wei)} ZBX`
                  : "—"
              }
              hint="Validator's own ZBX collateral required to register"
            />
            <ParamRow
              label="Min self-bond (USD-pegged)"
              value={
                staking
                  ? `$${(staking.min_self_bond_usd_micro / 1_000_000).toFixed(2)}`
                  : "—"
              }
              hint={
                staking
                  ? `Currently ≈ ${weiHexToZbx(staking.min_self_bond_dynamic_wei)} ZBX at spot price`
                  : undefined
              }
            />
            <ParamRow
              label="Min delegation amount"
              value={
                staking
                  ? `${weiHexToZbx(staking.min_delegation_wei)} ZBX`
                  : "—"
              }
              hint="Minimum a delegator can stake to a validator"
            />
            <ParamRow
              label="Total slashed"
              value={
                staking ? `${weiHexToZbx(staking.total_slashed_wei)} ZBX` : "—"
              }
              hint="Lifetime slashing across all validators"
            />
          </div>
        </div>

        <div className="border border-border rounded-lg bg-card/80 p-5">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
            <Percent className="w-5 h-5 text-violet-400" />
            Commission & Epoch Rules
          </h2>
          <div className="space-y-1">
            <ParamRow
              label="Maximum commission"
              value={staking ? `${bpsToPct(staking.max_commission_bps)}%` : "—"}
              hint="Hard cap on operator's reward cut"
            />
            <ParamRow
              label="Max edit per epoch"
              value={
                staking ? `±${bpsToPct(staking.max_commission_delta_bps)}%` : "—"
              }
              hint="Rate-limit on commission changes"
            />
            <ParamRow
              label="Epoch length"
              value={
                staking
                  ? `${staking.epoch_blocks.toLocaleString()} blocks (~${fmtSeconds(epochSeconds)})`
                  : "—"
              }
              hint="Reward distribution + commission edit boundary"
            />
            <ParamRow
              label="Unbonding period"
              value={
                staking
                  ? `${staking.unbonding_epochs} epochs (~${fmtSeconds(staking.unbonding_epochs * epochSeconds)})`
                  : "—"
              }
              hint="Time between Unstake tx and ZBX returning liquid"
            />
          </div>
        </div>
      </div>

      {/* ─── Become a validator ─────────────────────────────────────────── */}
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-foreground">
          Become a Zebvix Validator
        </h2>
        <p className="text-sm text-muted-foreground">
          End-to-end on-chain registration flow. All commands target the live
          chain id <code className="text-cyan-300">7878</code>.
        </p>
      </div>

      {/* Hardware reqs */}
      <div className="border border-border rounded-lg bg-card/80 p-5">
        <h3 className="text-base font-semibold flex items-center gap-2 mb-4">
          <Cpu className="w-5 h-5 text-amber-400" />
          Hardware Requirements (single-tenant VPS recommended)
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="bg-zinc-900/50 border border-border rounded p-3">
            <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground tracking-wider mb-1">
              <Cpu className="w-3.5 h-3.5" /> CPU
            </div>
            <div className="text-foreground font-mono">4+ vCPU</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              x86_64 or arm64
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-border rounded p-3">
            <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground tracking-wider mb-1">
              <HardDrive className="w-3.5 h-3.5" /> RAM
            </div>
            <div className="text-foreground font-mono">8+ GB</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              16 GB for archive
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-border rounded p-3">
            <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground tracking-wider mb-1">
              <HardDrive className="w-3.5 h-3.5" /> Disk
            </div>
            <div className="text-foreground font-mono">100+ GB SSD</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              NVMe preferred
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-border rounded p-3">
            <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground tracking-wider mb-1">
              <Wifi className="w-3.5 h-3.5" /> Network
            </div>
            <div className="text-foreground font-mono">100 Mbit+</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Static IP, low jitter
            </div>
          </div>
        </div>
      </div>

      {/* Step 1 - keypair */}
      <div className="border border-border rounded-lg bg-card/80 p-5">
        <StepHeader num={1} title="Generate Validator Keypair (secp256k1)" icon={KeyRound} />
        <p className="text-sm text-muted-foreground mb-3">
          Since Phase B.11 Zebvix uses{" "}
          <strong className="text-foreground">ECDSA-secp256k1</strong> — the
          same curve as Ethereum / MetaMask. A single 32-byte secret produces
          a 33-byte compressed pubkey, and the 20-byte address is derived
          ETH-style:{" "}
          <code className="text-cyan-300">
            keccak256(uncompressed_pubkey[1..])[12..]
          </code>
          . This means a Zebvix validator key is byte-compatible with any
          MetaMask / hardware-wallet seed.
        </p>
        <CodeBlock
          language="bash"
          code={`# Build zbx CLI from source (cargo build --release inside the chain repo)
sudo cp /home/zebvix-chain/target/release/zbx /usr/local/bin/

# Generate a fresh secp256k1 keypair
zbx new --out /root/.zebvix/validator.key

# Inspect the resulting key file (address + pubkey, positional path)
zbx show /root/.zebvix/validator.key

# Or print just the address
zbx address /root/.zebvix/validator.key`}
        />
        <div className="mt-3 flex items-start gap-2 text-xs bg-amber-500/5 border border-amber-500/20 rounded p-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-muted-foreground">
            <strong className="text-amber-300">Backup immediately.</strong> The
            secret in <code>validator.key</code> controls all signing power and
            self-bonded ZBX. Lose it and your validator is permanently
            unrecoverable. Recommended: hardware-encrypted USB + offline paper
            copy.
          </div>
        </div>
      </div>

      {/* Step 2 - init node */}
      <div className="border border-border rounded-lg bg-card/80 p-5">
        <StepHeader num={2} title="Initialize the Node" icon={Settings2} />
        <p className="text-sm text-muted-foreground mb-3">
          Build the node binary and initialize a fresh chain home. The{" "}
          <code className="text-cyan-300">--validator-key</code> flag binds
          your keyfile so the node signs blocks with it. Pass{" "}
          <code className="text-cyan-300">--no_default_premine</code> when
          joining a non-foundation deployment so you don't accidentally re-mint
          the founder allocation.
        </p>
        <CodeBlock
          language="bash"
          code={`# Clone & build the node binary
git clone https://github.com/zebvix/chain.git /home/zebvix-chain
cd /home/zebvix-chain
cargo build --release    # ~2 min on 4 vCPU
sudo cp target/release/zebvix-node /usr/local/bin/

# Initialize chain home (NOTE: flag is --validator-key, NOT --validator-keyfile)
zebvix-node init \\
  --home /root/.zebvix \\
  --validator-key /root/.zebvix/validator.key \\
  --no_default_premine

# After init, genesis.json + chain.toml live under /root/.zebvix/
ls -la /root/.zebvix/`}
        />
      </div>

      {/* Step 3 - systemd */}
      <div className="border border-border rounded-lg bg-card/80 p-5">
        <StepHeader num={3} title="Run as systemd Service" icon={PlayCircle} />
        <p className="text-sm text-muted-foreground mb-3">
          A systemd unit ensures the node restarts on crash and survives
          reboots. Adjust ports if you have multiple nodes on one host.
        </p>
        <CodeBlock
          language="ini"
          code={`# /etc/systemd/system/zebvix.service
[Unit]
Description=Zebvix L1 Blockchain Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/zebvix-node start \\
  --home /root/.zebvix \\
  --rpc 0.0.0.0:8545 \\
  --p2p-port 30333 \\
  --no-mdns
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target`}
        />
        <CodeBlock
          language="bash"
          code={`sudo systemctl daemon-reload
sudo systemctl enable --now zebvix
sudo systemctl status zebvix
journalctl -u zebvix -f --no-pager   # tail logs`}
        />
      </div>

      {/* Step 4 - firewall + sync */}
      <div className="border border-border rounded-lg bg-card/80 p-5">
        <StepHeader num={4} title="Firewall, P2P & Sync Verification" icon={Network} />
        <p className="text-sm text-muted-foreground mb-3">
          Open the P2P port to the public internet, but keep RPC on localhost
          (or behind a TLS-terminating proxy). Then verify your node is at the
          chain tip before bonding.
        </p>
        <CodeBlock
          language="bash"
          code={`# UFW (Ubuntu/Debian)
sudo ufw allow 30333/tcp comment "zebvix p2p"
# RPC stays internal — bind to 127.0.0.1 in production
# Use nginx + Let's Encrypt for public RPC

# Verify sync
zbx tip   --rpc http://127.0.0.1:8545
zbx info  --rpc http://127.0.0.1:8545

# Compare your tip height against the public canary node
curl -s -X POST https://rpc.zebvix.io \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_blockNumber","params":[]}'`}
        />
      </div>

      {/* Step 5 - register validator (two-tier) */}
      <div className="border border-border rounded-lg bg-card/80 p-5">
        <StepHeader
          num={5}
          title="Two-Tier Registration: Staking + Consensus"
          icon={Hammer}
        />
        <div className="mb-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded text-xs flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-muted-foreground leading-relaxed">
            <strong className="text-amber-300">Important:</strong> Zebvix has
            two separate validator registries. Staking-module registration
            (anyone can submit) is what you see in{" "}
            <code className="text-cyan-300">zbx_getStaking</code>. The{" "}
            <strong className="text-foreground">consensus committee</strong>{" "}
            (returned by <code className="text-cyan-300">zbx_listValidators</code>)
            is{" "}
            <strong className="text-foreground">governor-only</strong> — only
            the current governor address can grant block-producing rights via{" "}
            <code className="text-cyan-300">ValidatorAdd</code>. Both steps are
            required to actually produce blocks.
          </div>
        </div>

        {/* Sub-step 5a: staking module */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-cyan-300 font-mono text-xs px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30">
              5a
            </span>
            <h4 className="text-sm font-semibold text-foreground">
              Self-bond into staking module (anyone)
            </h4>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Submit a <code className="text-cyan-300">CreateValidator</code> tx.
            This locks your self-bond, opens you to delegations, and registers
            you in the staking module — but does NOT yet make you a consensus
            validator.
          </p>
          <div className="bg-zinc-900/50 border border-border rounded p-3 text-xs space-y-1.5 mb-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tx kind</span>
              <code className="text-cyan-300 font-mono">
                TxKind::Staking(StakeOp::CreateValidator)
              </code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Min self-bond</span>
              <code className="text-emerald-300 font-mono">
                {staking
                  ? `${weiHexToZbx(staking.min_self_bond_wei)} ZBX (or $${(staking.min_self_bond_usd_micro / 1_000_000).toFixed(0)} USD floor)`
                  : "100 ZBX or $50 USD floor"}
              </code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max commission</span>
              <code className="text-violet-300 font-mono">
                {staking ? `${bpsToPct(staking.max_commission_bps)}%` : "50%"}
              </code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Authorization</span>
              <code className="text-foreground font-mono">tx signer (anyone)</code>
            </div>
          </div>
          <CodeBlock
            language="rust"
            code={`// Rust SDK shape (a JS SDK ships in Phase E)
use zebvix_node::types::{TxKind, StakeOp};

let op = StakeOp::CreateValidator {
    pubkey,                                  // [u8; 33] secp256k1 compressed
    commission_bps: 1000,                    // 10.00 %
    self_bond:      1_000 * 10u128.pow(18),  // 1,000 ZBX in wei
};
let tx = wallet.build_signed_tx(
    TxKind::Staking(op),
    /* fee_wei = */ 1_000_000_000_000_000,   // 0.001 ZBX
);
let txid = rpc("zbx_sendRawTransaction", [hex::encode(tx.encode())]).await?;`}
          />
        </div>

        {/* Sub-step 5b: governor admission */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-violet-300 font-mono text-xs px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/30">
              5b
            </span>
            <h4 className="text-sm font-semibold text-foreground">
              Consensus admission (governor-only)
            </h4>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Once the foundation/governor approves your operator profile, they
            broadcast a <code className="text-cyan-300">ValidatorAdd</code> tx
            with your pubkey + voting power. Only after this tx is mined will
            you appear in <code className="text-cyan-300">zbx_listValidators</code>{" "}
            and start producing blocks.
          </p>
          <div className="bg-zinc-900/50 border border-border rounded p-3 text-xs space-y-1.5 mb-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tx kind</span>
              <code className="text-cyan-300 font-mono">
                TxKind::ValidatorAdd {`{ pubkey, power }`}
              </code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Authorization</span>
              <code className="text-violet-300 font-mono">
                governor key only (refunded if not)
              </code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Side-effects</span>
              <code className="text-foreground font-mono">
                fee consumed; tx amount refunded
              </code>
            </div>
          </div>
          <CodeBlock
            language="bash"
            code={`# Inspect current governor (only this address can run ValidatorAdd)
curl -s -X POST http://127.0.0.1:8545 \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_getGovernor","params":[]}'

# Coordinate with the foundation to publish a ValidatorAdd tx for your pubkey.
# Until that tx is mined, your node will sync but cannot propose blocks.`}
          />
        </div>
      </div>

      {/* Step 6 - verify */}
      <div className="border border-border rounded-lg bg-card/80 p-5">
        <StepHeader num={6} title="Verify Live On-Chain" icon={CheckCircle2} />
        <CodeBlock
          language="bash"
          code={`# Confirm you're in the active set
curl -s -X POST http://127.0.0.1:8545 \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_listValidators","params":[]}'

# Watch your reward accrue (commission_pool grows on each 100-block rewards distribution)
watch -n 30 'curl -sX POST http://127.0.0.1:8545 \\
  -H "content-type: application/json" \\
  -d "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"zbx_getStakingValidator\\",\\"params\\":[\\"0xYourAddr\\"]}"'

# Locked-rewards drip schedule (90% of your share unlocks gradually)
curl -s -X POST http://127.0.0.1:8545 \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_getLockedRewards","params":["0xYourAddr"]}'`}
        />
      </div>

      {/* Reward economics */}
      <div className="border border-border rounded-lg bg-card/80 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-emerald-400" />
          <h2 className="text-base font-semibold">Reward Economics</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          <div className="bg-zinc-900/50 border border-border rounded p-4 space-y-1">
            <div className="text-xs uppercase text-muted-foreground tracking-wider">
              Per-block mint
            </div>
            <div className="text-xl font-mono font-bold text-emerald-300">
              3 ZBX
            </div>
            <div className="text-[11px] text-muted-foreground">
              → rewards pool every block; halves every 25M blocks (~3.96 yrs)
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-border rounded p-4 space-y-1">
            <div className="text-xs uppercase text-muted-foreground tracking-wider">
              Distribution interval
            </div>
            <div className="text-xl font-mono font-bold text-cyan-300">
              every 100 blocks
            </div>
            <div className="text-[11px] text-muted-foreground">
              ~8.3 min · pool drains and splits stake-proportionally
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-border rounded p-4 space-y-1">
            <div className="text-xs uppercase text-muted-foreground tracking-wider">
              Reward share
            </div>
            <div className="text-xl font-mono font-bold text-violet-300">
              10% / 90%
            </div>
            <div className="text-[11px] text-muted-foreground">
              90% goes to bonded (0.50%/day drip + 25%/5M-block bulk release).
              Pool commission currently routes to the founder address during
              Phase A bootstrap; per-operator routing ships later.
            </div>
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-border rounded p-4 text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground">
              Live epoch-reward APY estimate (excludes per-block stream)
            </span>
            <span className="font-mono text-emerald-300 text-base">
              {networkApyPct !== null ? `${networkApyPct.toFixed(2)}%` : "—"}
            </span>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            ({staking ? weiHexToZbx(staking.epoch_reward_wei) : "—"} ZBX/epoch ×{" "}
            {annualEpochs.toLocaleString()} epochs/yr) ÷{" "}
            {staking ? weiHexToZbx(totalBondedWei.toString()) : "—"} ZBX bonded
          </div>
          {networkApyPct !== null && networkApyPct > 100 && (
            <div className="mt-2 text-[11px] text-amber-300 leading-relaxed">
              ⚠ Bootstrap state: only{" "}
              {staking ? weiHexToZbx(totalBondedWei.toString()) : "—"} ZBX
              currently bonded across {staking?.validator_count ?? 0}{" "}
              validator(s). APY collapses to typical 5–15% range as more
              operators join and total bond grows. Per-block reward stream (3
              ZBX × 17,280 blocks/epoch) is distributed separately via{" "}
              <code className="text-cyan-300">REWARDS_POOL</code> and is not
              included in this estimate.
            </div>
          )}
        </div>
      </div>

      {/* Slashing & jail */}
      <div className="border border-red-500/20 rounded-lg bg-red-500/5 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <h2 className="text-base font-semibold">Slashing & Jail Conditions</h2>
        </div>
        <div className="text-xs text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded p-3">
          <strong>Status:</strong> Slashing primitives{" "}
          <code className="text-foreground">slash_double_sign</code> (5%) and{" "}
          <code className="text-foreground">slash_downtime</code> (0.10%) are
          implemented in <code className="text-foreground">staking.rs</code>,
          but automatic enforcement from the block-apply path ships in a later
          phase. For now, slashing is governance-triggered; the on-chain
          functions exist and are unit-tested.
        </div>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div className="bg-zinc-900/50 border border-border rounded p-3">
            <div className="font-semibold text-red-300 mb-1">
              Downtime slash (0.10%)
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              When auto-enforcement lands, a validator missing votes beyond the
              liveness threshold gets 0.10% of stake burned and{" "}
              <code>jailed = true</code> until the operator submits an unjail
              tx after the cooldown epoch.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-border rounded p-3">
            <div className="font-semibold text-red-300 mb-1">
              Double-sign slash (5%)
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Signing two conflicting blocks at the same height burns 5% of
              total stake (self-bond + delegations) and slashes any in-flight
              unbonding entries that are still inside the unbonding window.
            </p>
          </div>
        </div>
        <div className="text-xs text-muted-foreground bg-zinc-900/50 border border-border rounded p-3">
          <strong className="text-foreground">Slashed to date:</strong>{" "}
          <code className="text-red-300 font-mono">
            {staking ? `${weiHexToZbx(staking.total_slashed_wei)} ZBX` : "—"}
          </code>{" "}
          across the entire chain.
        </div>
      </div>

      {/* RPC cheatsheet */}
      <div className="border border-border rounded-lg bg-card/80 p-5 space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Server className="w-5 h-5 text-cyan-400" />
          Validator RPC Cheatsheet
        </h2>
        <div className="grid md:grid-cols-2 gap-2 text-xs">
          {[
            ["zbx_listValidators", "All registered validators + voting power"],
            ["zbx_getValidator [addr]", "Consensus record for a single validator"],
            ["zbx_getStaking", "Full staking module state (params + sets)"],
            ["zbx_getStakingValidator [addr]", "Stake, commission, jail status"],
            ["zbx_getDelegation [d, v]", "Delegator's position on a validator"],
            ["zbx_getDelegationsByDelegator [d]", "All positions held by addr"],
            ["zbx_getLockedRewards [addr]", "Bonded-share unlock schedule"],
            ["zbx_voteStats [height]", "Live consensus quorum at a height"],
          ].map(([m, d]) => (
            <div
              key={m}
              className="flex items-start justify-between gap-3 bg-zinc-900/50 border border-border rounded px-3 py-2"
            >
              <code className="text-cyan-300 font-mono text-[11px]">{m}</code>
              <span className="text-[11px] text-muted-foreground text-right">
                {d}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Source pointer */}
      <div className="bg-muted/30 border border-border p-5 rounded-lg space-y-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Hammer className="w-4 h-4 text-cyan-400" />
          Tweaking validator parameters
        </h3>
        <p className="text-xs text-muted-foreground">
          All consensus-critical staking constants live in a single Rust file.
          Changing any value here is a hard-fork — coordinate via on-chain
          governance (Phase D) before deploying.
        </p>
        <div className="bg-background border border-border rounded p-3 font-mono text-xs text-cyan-300">
          zebvix-chain/src/staking.rs
        </div>
        <div className="grid md:grid-cols-2 gap-2 text-[11px] text-muted-foreground pt-1">
          <div>
            <code>EPOCH_BLOCKS</code> · <code>UNBONDING_EPOCHS</code> ·{" "}
            <code>STAKING_EPOCH_REWARD_WEI</code>
          </div>
          <div>
            <code>MIN_SELF_BOND_WEI</code> · <code>MIN_DELEGATION_WEI</code> ·{" "}
            <code>MAX_COMMISSION_BPS</code>
          </div>
        </div>
      </div>

      {supply && (
        <div className="text-[11px] text-muted-foreground text-right font-mono">
          Live data · chain id 7878 · height #{supply.height}
        </div>
      )}
    </div>
  );
}
