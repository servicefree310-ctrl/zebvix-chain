import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Hammer, Rocket, CheckCircle2, AlertCircle, Settings, Coins, Network,
  Terminal, Download, Copy, Check, ArrowRight, ArrowLeft, Loader2, Zap, Shield,
  FileCode2, Server, Package, RefreshCw, KeyRound, Landmark, Sliders, Gauge,
  Flame, Layers, Cog, Info,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { CodeBlock } from "@/components/ui/code-block";

const API_BASE = (import.meta as any).env?.BASE_URL?.replace(/\/+$/, "") || "";

type FeatureKey =
  | "evm" | "zvm" | "smartContracts" | "mempool" | "snapshots"
  | "archiveMode" | "txIndex" | "websocket" | "metrics" | "txBurn" | "eip1559";

type FeatureFlags = Record<FeatureKey, boolean>;

type ChainConfig = {
  // identity
  chainName: string;
  chainId: number;
  symbol: string;
  decimals: number;
  description: string;
  // tokenomics
  totalSupplyZbx: number;
  fixedSupply: boolean;
  founderPremineZbx: number;
  founderAddress: string;
  mintPerBlockZbx: number;
  halvingBlocks: number;
  blockTimeSecs: number;
  // consensus / PoS
  consensus: "pos" | "poa";
  minValidatorStakeZbx: number;
  maxValidators: number;
  slashPercent: number;
  unbondingDays: number;
  // governance
  governanceEnabled: boolean;
  votingPeriodBlocks: number;
  quorumPercent: number;
  proposalThresholdZbx: number;
  executionDelayBlocks: number;
  // network
  rpcPort: number;
  p2pPort: number;
  // features
  features: FeatureFlags;
};

const DEFAULT_FEATURES: FeatureFlags = {
  evm: true,
  zvm: true,
  smartContracts: true,
  mempool: true,
  snapshots: true,
  archiveMode: false,
  txIndex: true,
  websocket: true,
  metrics: true,
  txBurn: false,
  eip1559: true,
};

const DEFAULT_CFG: ChainConfig = {
  chainName: "mychain",
  chainId: 9999,
  symbol: "MYC",
  decimals: 18,
  description: "",
  totalSupplyZbx: 150_000_000,
  fixedSupply: true,
  founderPremineZbx: 9_990_000,
  founderAddress: "",
  mintPerBlockZbx: 0,
  halvingBlocks: 0,
  blockTimeSecs: 5,
  consensus: "pos",
  minValidatorStakeZbx: 10_000,
  maxValidators: 100,
  slashPercent: 5,
  unbondingDays: 21,
  governanceEnabled: true,
  votingPeriodBlocks: 100_800,
  quorumPercent: 25,
  proposalThresholdZbx: 100_000,
  executionDelayBlocks: 7_200,
  rpcPort: 8545,
  p2pPort: 30303,
  features: { ...DEFAULT_FEATURES },
};

const STEPS = [
  { id: 1, label: "Identity",   icon: Coins,    blurb: "Name, chain ID, symbol, decimals" },
  { id: 2, label: "Tokenomics", icon: Sliders,  blurb: "Supply model, pre-mine, emission" },
  { id: 3, label: "Consensus",  icon: Shield,   blurb: "PoS validators, slashing, unbonding" },
  { id: 4, label: "Governance", icon: Landmark, blurb: "On-chain voting, quorum, execution" },
  { id: 5, label: "Features",   icon: Cog,      blurb: "Feature matrix + RPC / P2P ports" },
  { id: 6, label: "Build",      icon: Hammer,   blurb: "Review & generate setup bundle" },
] as const;

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;

type LogLine = { kind: "info" | "ok" | "warn" | "err" | "cmd"; text: string };
type BuildStage = "idle" | "validating" | "generating" | "packaging" | "ready" | "error";

function StatTile({ icon: Icon, label, value, sub }: {
  icon: React.ElementType; label: string; value: string; sub: string;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card/60">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide mb-2">
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
      <div className="text-2xl font-mono font-bold text-foreground truncate">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}

function StepPill({
  step, current, completed,
}: {
  step: typeof STEPS[number]; current: boolean; completed: boolean;
}) {
  const Icon = step.icon;
  return (
    <div className={[
      "flex items-center gap-3 p-3 rounded-lg border transition-colors",
      current ? "border-primary/60 bg-primary/10"
              : completed ? "border-emerald-500/40 bg-emerald-500/5"
                          : "border-border bg-card/40",
    ].join(" ")}>
      <div className={[
        "h-8 w-8 rounded-md flex items-center justify-center shrink-0",
        completed ? "bg-emerald-500/20 text-emerald-400"
                  : current ? "bg-primary/20 text-primary"
                            : "bg-muted text-muted-foreground",
      ].join(" ")}>
        {completed ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
      </div>
      <div className="min-w-0">
        <div className={[
          "text-xs font-semibold uppercase tracking-wide",
          current ? "text-primary" : completed ? "text-emerald-400" : "text-muted-foreground",
        ].join(" ")}>Step {step.id}</div>
        <div className="text-sm font-medium text-foreground truncate">{step.label}</div>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, hint }: {
  icon: React.ElementType; title: string; hint?: string;
}) {
  return (
    <div className="flex items-start gap-2 pt-1">
      <Icon className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

function ToggleRow({
  id, label, hint, checked, onChange, badge,
}: {
  id: string; label: string; hint?: string; checked: boolean;
  onChange: (v: boolean) => void; badge?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-3 border border-border rounded-md bg-card/40">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Label htmlFor={id} className="text-sm font-medium text-foreground cursor-pointer">{label}</Label>
          {badge && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-border">{badge}</Badge>}
        </div>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={`toggle-${id}`} />
    </div>
  );
}

function NumberField({
  id, label, hint, value, onChange, min, max, suffix, error, mono,
}: {
  id: string; label: string; hint?: string; value: number;
  onChange: (n: number) => void; min?: number; max?: number;
  suffix?: string; error?: boolean; mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-2">
        {label}
        {suffix && <span className="text-xs text-muted-foreground font-normal">({suffix})</span>}
      </Label>
      <Input
        id={id}
        data-testid={`input-${id}`}
        type="number"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className={[mono ? "font-mono" : "", error ? "border-rose-500/60 focus-visible:ring-rose-500/40" : ""].join(" ")}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function validateStep(step: number, c: ChainConfig): { field?: string; message: string } | null {
  if (step === 1) {
    if (!SLUG_RE.test(c.chainName))
      return { field: "chainName", message: "Chain name must be lowercase letters / digits / dash, 2-31 chars." };
    if (!Number.isInteger(c.chainId) || c.chainId < 1 || c.chainId > 2_147_483_647)
      return { field: "chainId", message: "Chain ID must be a positive integer ≤ 2,147,483,647." };
    if (!/^[A-Z]{2,8}$/.test(c.symbol))
      return { field: "symbol", message: "Symbol must be 2-8 uppercase letters." };
    if (!Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 36)
      return { field: "decimals", message: "Decimals must be an integer between 0 and 36." };
  }
  if (step === 2) {
    if (!Number.isInteger(c.totalSupplyZbx) || c.totalSupplyZbx < 1 || c.totalSupplyZbx > 1_000_000_000_000)
      return { field: "totalSupplyZbx", message: "Total supply must be 1..1,000,000,000,000 whole tokens." };
    if (!Number.isInteger(c.founderPremineZbx) || c.founderPremineZbx < 0 || c.founderPremineZbx > 1_000_000_000_000)
      return { field: "founderPremineZbx", message: "Founder pre-mine must be 0..1,000,000,000,000 whole tokens." };
    if (c.fixedSupply && c.founderPremineZbx > c.totalSupplyZbx)
      return { field: "founderPremineZbx", message: "On a fixed-supply chain, pre-mine cannot exceed total supply." };
    const addr = c.founderAddress.trim();
    if (addr !== "") {
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr))
        return { field: "founderAddress", message: "Founder address must be 0x followed by 40 hex characters (an EVM address). Leave blank to use the validator key." };
      if (c.founderPremineZbx === 0)
        return { field: "founderAddress", message: "Set a founder pre-mine above 0, or clear this address." };
    }
    if (!Number.isInteger(c.mintPerBlockZbx) || c.mintPerBlockZbx < 0 || c.mintPerBlockZbx > 1_000_000)
      return { field: "mintPerBlockZbx", message: "Mint per block must be 0..1,000,000 tokens." };
    if (c.fixedSupply && c.mintPerBlockZbx > 0)
      return { field: "mintPerBlockZbx", message: "Fixed-supply chains cannot mint per block. Disable fixed supply or set mint to 0." };
    if (!Number.isInteger(c.halvingBlocks) || c.halvingBlocks < 0 || c.halvingBlocks > 100_000_000)
      return { field: "halvingBlocks", message: "Halving interval must be 0..100,000,000 blocks (0 = no halving)." };
    if (!Number.isInteger(c.blockTimeSecs) || c.blockTimeSecs < 1 || c.blockTimeSecs > 60)
      return { field: "blockTimeSecs", message: "Block time must be 1..60 seconds." };
  }
  if (step === 3) {
    if (c.consensus !== "pos" && c.consensus !== "poa")
      return { field: "consensus", message: "Consensus must be PoS or PoA." };
    if (!Number.isInteger(c.minValidatorStakeZbx) || c.minValidatorStakeZbx < 0 || c.minValidatorStakeZbx > 1_000_000_000_000)
      return { field: "minValidatorStakeZbx", message: "Min validator stake must be 0..1,000,000,000,000 whole tokens." };
    if (c.fixedSupply && c.minValidatorStakeZbx > c.totalSupplyZbx)
      return { field: "minValidatorStakeZbx", message: "Min stake cannot exceed total supply." };
    if (!Number.isInteger(c.maxValidators) || c.maxValidators < 1 || c.maxValidators > 1000)
      return { field: "maxValidators", message: "Max validators must be 1..1000." };
    if (!Number.isInteger(c.slashPercent) || c.slashPercent < 0 || c.slashPercent > 100)
      return { field: "slashPercent", message: "Slash percent must be 0..100." };
    if (!Number.isInteger(c.unbondingDays) || c.unbondingDays < 0 || c.unbondingDays > 365)
      return { field: "unbondingDays", message: "Unbonding period must be 0..365 days." };
  }
  if (step === 4) {
    if (c.governanceEnabled) {
      if (!Number.isInteger(c.votingPeriodBlocks) || c.votingPeriodBlocks < 1 || c.votingPeriodBlocks > 100_000_000)
        return { field: "votingPeriodBlocks", message: "Voting period must be 1..100,000,000 blocks." };
      if (!Number.isInteger(c.quorumPercent) || c.quorumPercent < 0 || c.quorumPercent > 100)
        return { field: "quorumPercent", message: "Quorum must be 0..100 percent." };
      if (!Number.isInteger(c.proposalThresholdZbx) || c.proposalThresholdZbx < 0 || c.proposalThresholdZbx > 1_000_000_000_000)
        return { field: "proposalThresholdZbx", message: "Proposal threshold must be 0..1,000,000,000,000 whole tokens." };
      if (c.fixedSupply && c.proposalThresholdZbx > c.totalSupplyZbx)
        return { field: "proposalThresholdZbx", message: "Proposal threshold cannot exceed total supply." };
      if (!Number.isInteger(c.executionDelayBlocks) || c.executionDelayBlocks < 0 || c.executionDelayBlocks > 10_000_000)
        return { field: "executionDelayBlocks", message: "Execution delay must be 0..10,000,000 blocks." };
    }
  }
  if (step === 5) {
    if (!Number.isInteger(c.rpcPort) || c.rpcPort < 1024 || c.rpcPort > 65535)
      return { field: "rpcPort", message: "RPC port must be an integer 1024..65535." };
    if (!Number.isInteger(c.p2pPort) || c.p2pPort < 1024 || c.p2pPort > 65535)
      return { field: "p2pPort", message: "P2P port must be an integer 1024..65535." };
    if (c.rpcPort === c.p2pPort)
      return { field: "p2pPort", message: "RPC and P2P ports must differ." };
    if (!c.features.evm && !c.features.zvm)
      return { field: "features", message: "At least one VM (EVM or ZVM) must remain enabled." };
  }
  return null;
}

const STEP_FOR_FIELD: Record<string, number> = {
  chainName: 1, chainId: 1, symbol: 1, decimals: 1,
  totalSupplyZbx: 2, founderPremineZbx: 2, founderAddress: 2, mintPerBlockZbx: 2, halvingBlocks: 2, blockTimeSecs: 2,
  consensus: 3, minValidatorStakeZbx: 3, maxValidators: 3, slashPercent: 3, unbondingDays: 3,
  votingPeriodBlocks: 4, quorumPercent: 4, proposalThresholdZbx: 4, executionDelayBlocks: 4,
  rpcPort: 5, p2pPort: 5, features: 5,
};

const FEATURE_META: Array<{ key: FeatureKey; label: string; hint: string; badge?: string }> = [
  { key: "evm",            label: "EVM execution",        hint: "Solidity 0.8+, MetaMask, Hardhat, Foundry, ethers, viem.", badge: "core" },
  { key: "zvm",            label: "ZVM (Zebvix VM)",      hint: "Native Zebvix bytecode + zbx_ namespace methods.",         badge: "core" },
  { key: "smartContracts", label: "Smart contracts",      hint: "Allow contract deploy + call. Disable for payments-only L1." },
  { key: "mempool",        label: "Public mempool",       hint: "Accept and gossip pending tx. Off = private/permissioned tx flow." },
  { key: "snapshots",      label: "State snapshots",      hint: "Periodic chain snapshots for fast-sync of new nodes." },
  { key: "archiveMode",    label: "Archive mode",         hint: "Keep full historical state. Heavy disk; needed for explorers.", badge: "heavy" },
  { key: "txIndex",        label: "Tx index",             hint: "Index transactions by hash for instant lookup." },
  { key: "websocket",      label: "WebSocket RPC",        hint: "Push subscriptions on the same RPC port (eth_subscribe)." },
  { key: "metrics",        label: "Prometheus metrics",   hint: "/metrics endpoint for Grafana / Prometheus scraping." },
  { key: "txBurn",         label: "Tx fee burn",          hint: "Burn a fraction of base fee (deflationary, EIP-1559 style)." },
  { key: "eip1559",        label: "EIP-1559 fees",        hint: "Base fee + priority tip pricing instead of legacy gasPrice." },
];

export default function ChainBuilderPage() {
  const [step, setStep] = useState<number>(1);
  const [cfg, setCfg] = useState<ChainConfig>(DEFAULT_CFG);
  const [stepError, setStepError] = useState<{ field?: string; message: string } | null>(null);

  const [stage, setStage] = useState<BuildStage>("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>("");
  const [downloadBytes, setDownloadBytes] = useState<number>(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const update = (patch: Partial<ChainConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const updateFeature = (k: FeatureKey, v: boolean) =>
    setCfg((c) => ({ ...c, features: { ...c.features, [k]: v } }));

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  function appendLog(line: LogLine) {
    setLogs((prev) => [...prev, line]);
  }

  async function next() {
    const err = validateStep(step, cfg);
    if (err) { setStepError(err); return; }
    setStepError(null);
    if (step < STEPS.length) setStep(step + 1);
  }
  function prev() {
    setStepError(null);
    if (step > 1) setStep(step - 1);
  }

  function jumpToFieldStep(field?: string) {
    if (!field) return;
    const target = STEP_FOR_FIELD[field];
    if (target) setStep(target);
  }

  const enabledFeatureCount = useMemo(
    () => Object.values(cfg.features).filter(Boolean).length,
    [cfg.features],
  );
  const totalFeatureCount = Object.keys(cfg.features).length;

  async function build() {
    setLogs([]);
    setDownloadUrl(null);
    setStage("validating");
    appendLog({ kind: "cmd", text: `$ zebvix chain-builder generate ${cfg.chainName}` });
    appendLog({ kind: "info", text: `Validating configuration...` });
    await new Promise((r) => setTimeout(r, 300));

    for (const s of [1, 2, 3, 4, 5] as const) {
      const e = validateStep(s, cfg);
      if (e) {
        setStage("error");
        appendLog({ kind: "err", text: `Validation failed (step ${s}): ${e.message}` });
        setStepError(e);
        jumpToFieldStep(e.field);
        return;
      }
    }
    appendLog({ kind: "ok", text: `  ✓ chain name      ${cfg.chainName}` });
    appendLog({ kind: "ok", text: `  ✓ chain ID        ${cfg.chainId}  (0x${cfg.chainId.toString(16)})` });
    appendLog({ kind: "ok", text: `  ✓ symbol          ${cfg.symbol}` });
    appendLog({ kind: "ok", text: `  ✓ supply model    ${cfg.fixedSupply ? "fixed" : "inflationary"}` });
    appendLog({ kind: "ok", text: `  ✓ supply          ${cfg.totalSupplyZbx.toLocaleString()} ${cfg.symbol}${cfg.fixedSupply ? "" : "  (initial)"}` });
    appendLog({ kind: "ok", text: `  ✓ pre-mine        ${cfg.founderPremineZbx.toLocaleString()} ${cfg.symbol} → ${cfg.founderAddress ? `admin ${cfg.founderAddress.slice(0, 10)}…${cfg.founderAddress.slice(-6)}` : "validator key (auto-generated on VPS)"}` });
    if (cfg.mintPerBlockZbx > 0) {
      appendLog({ kind: "ok", text: `  ✓ mint per block  ${cfg.mintPerBlockZbx.toLocaleString()} ${cfg.symbol}${cfg.halvingBlocks > 0 ? `  (halving every ${cfg.halvingBlocks.toLocaleString()} blocks)` : ""}` });
    }
    appendLog({ kind: "ok", text: `  ✓ block time      ${cfg.blockTimeSecs} s` });
    appendLog({ kind: "ok", text: `  ✓ consensus       ${cfg.consensus.toUpperCase()}  (max ${cfg.maxValidators} validators, ${cfg.slashPercent}% slash, ${cfg.unbondingDays}d unbond)` });
    if (cfg.governanceEnabled) {
      appendLog({ kind: "ok", text: `  ✓ governance      voting=${cfg.votingPeriodBlocks}b · quorum=${cfg.quorumPercent}% · exec-delay=${cfg.executionDelayBlocks}b` });
    } else {
      appendLog({ kind: "warn", text: `  ! governance      disabled` });
    }
    appendLog({ kind: "ok", text: `  ✓ features        ${enabledFeatureCount}/${totalFeatureCount} enabled` });
    appendLog({ kind: "ok", text: `  ✓ RPC / P2P       ${cfg.rpcPort} / ${cfg.p2pPort}` });

    setStage("generating");
    appendLog({ kind: "info", text: `Generating install.sh, systemd unit, chain.config.yaml, README.md...` });
    await new Promise((r) => setTimeout(r, 350));

    try {
      const previewRes = await fetch(`${API_BASE}/api/chain-builder/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!previewRes.ok) {
        const j = await previewRes.json().catch(() => ({ error: `HTTP ${previewRes.status}` }));
        throw new Error(j.error || `HTTP ${previewRes.status}`);
      }
      const preview = await previewRes.json();
      appendLog({ kind: "ok", text: `  ✓ install.sh hash  ${preview.summary.installHash.slice(0, 24)}...` });
      appendLog({ kind: "ok", text: `  ✓ files generated  ${Object.keys(preview.files).length}` });
      appendLog({ kind: "ok", text: `  ✓ payload size     ${preview.summary.totalBytes} bytes` });
      appendLog({ kind: "ok", text: `  ✓ source URL       ${preview.baseUrl}/api/download/newchain` });

      setStage("packaging");
      appendLog({ kind: "info", text: `Packaging tarball...` });
      const dlRes = await fetch(`${API_BASE}/api/chain-builder/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!dlRes.ok) {
        const j = await dlRes.json().catch(() => ({ error: `HTTP ${dlRes.status}` }));
        throw new Error(j.error || `HTTP ${dlRes.status}`);
      }
      const blob = await dlRes.blob();
      const url = URL.createObjectURL(blob);
      const name = `${cfg.chainName}-setup.tar.gz`;
      setDownloadUrl(url);
      setDownloadName(name);
      setDownloadBytes(blob.size);

      appendLog({ kind: "ok", text: `  ✓ ${name}  (${(blob.size / 1024).toFixed(1)} KB)` });
      appendLog({ kind: "ok", text: `Done. Click "Download setup bundle" below.` });
      setStage("ready");
    } catch (e: any) {
      appendLog({ kind: "err", text: `Build failed: ${String(e?.message || e)}` });
      setStage("error");
    }
  }

  function reset() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setDownloadName("");
    setDownloadBytes(0);
    setLogs([]);
    setStage("idle");
    setStep(1);
    setCfg(DEFAULT_CFG);
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  }

  const installCmd = useMemo(
    () => `tar -xzf ${cfg.chainName}-setup.tar.gz\ncd ${cfg.chainName}\nsudo bash install.sh`,
    [cfg.chainName],
  );

  const fieldErrClass = (name: string) =>
    stepError?.field === name ? "border-rose-500/60 focus-visible:ring-rose-500/40" : "";

  const StepIcon = STEPS[step - 1].icon;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">Chain Builder</Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">≈ 15-min setup</Badge>
          <Badge variant="outline" className="text-amber-400 border-amber-500/40">No-code wizard</Badge>
          <Badge variant="outline" className="text-violet-400 border-violet-500/40">Self-hosted</Badge>
          <Badge variant="outline" className="text-cyan-400 border-cyan-500/40">PoS · governance · features</Badge>
          <Badge variant="outline" className="text-fuchsia-400 border-fuchsia-500/40">Pro</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Hammer className="w-7 h-7 text-primary" />
          Build Your Own Chain
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Fork the Zebvix base node into your own L1 with full control: identity, supply model
          (fixed or inflationary), per-block emission, PoS validators with slashing, on-chain
          governance, and a feature matrix you can toggle on or off. We package everything into a
          one-shot installer for a fresh Ubuntu/Debian VPS.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">What's in the bundle</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li><strong className="text-emerald-400">install.sh</strong> — sed-patches <code className="bg-muted px-1 rounded">src/tokenomics.rs</code> with chain ID / supply / pre-mine / block time, then <code className="bg-muted px-1 rounded">cargo build</code> + init + systemd start</li>
              <li><strong className="text-emerald-400">chain.config.yaml</strong> — the full advanced config (PoS, governance, mint, halving, feature matrix). The current binary reads what it supports; the rest is recorded for upcoming releases and audit</li>
              <li><strong className="text-emerald-400">systemd unit</strong> — production service with auto-restart and journald logging</li>
              <li><strong className="text-emerald-400">README.md</strong> — operator runbook with status / logs / RPC test / pre-mine transfer commands and a clear "active vs declared" table</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile icon={Zap}        label="Setup time"   value="≈ 15 min" sub="on a 4 vCPU / 8 GB VPS" />
        <StatTile icon={FileCode2}  label="Files"        value="4"        sub="installer + unit + yaml + readme" />
        <StatTile icon={Server}     label="Bundle size"  value="< 30 KB"  sub="tarball, instant download" />
        <StatTile icon={Shield}     label="Hardening"    value="systemd"  sub="auto-restart + journald" />
      </div>

      {/* Step tracker */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {STEPS.map((s) => (
          <StepPill key={s.id} step={s} current={step === s.id} completed={step > s.id} />
        ))}
      </div>

      {/* Wizard body */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepIcon className="w-5 h-5 text-primary" />
            Step {step} — {STEPS[step - 1].label}
          </CardTitle>
          <CardDescription>{STEPS[step - 1].blurb}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* ── Step 1: Identity ── */}
          {step === 1 && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="chainName">Chain name (slug)</Label>
                <Input id="chainName" data-testid="input-chainName" value={cfg.chainName}
                  onChange={(e) => update({ chainName: e.target.value.toLowerCase() })}
                  placeholder="mychain" className={fieldErrClass("chainName")} />
                <p className="text-xs text-muted-foreground">Used as binary name (<code>{cfg.chainName}-node</code>), data dir, systemd unit.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="chainId">Chain ID (numeric)</Label>
                <Input id="chainId" data-testid="input-chainId" type="number" value={cfg.chainId}
                  onChange={(e) => update({ chainId: Number(e.target.value) })}
                  placeholder="9999" className={fieldErrClass("chainId")} />
                <p className="text-xs text-muted-foreground">EVM chain ID. Pick something unique to avoid conflicts (e.g. 9999, 5555, 31337).</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="symbol">Token symbol</Label>
                <Input id="symbol" data-testid="input-symbol" value={cfg.symbol}
                  onChange={(e) => update({ symbol: e.target.value.toUpperCase() })}
                  placeholder="MYC" maxLength={8} className={fieldErrClass("symbol")} />
                <p className="text-xs text-muted-foreground">2-8 uppercase letters. Shown in wallets, explorers, RPC.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="decimals">Decimals</Label>
                <Input id="decimals" data-testid="input-decimals" type="number" value={cfg.decimals}
                  onChange={(e) => update({ decimals: Number(e.target.value) })}
                  placeholder="18" className={fieldErrClass("decimals")} />
                <p className="text-xs text-muted-foreground">Standard EVM is 18 — keep this unless you have a strong reason.</p>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="description">Description (optional, ≤ 280 chars)</Label>
                <Input id="description" value={cfg.description}
                  onChange={(e) => update({ description: e.target.value.slice(0, 280) })}
                  placeholder="A purpose-built L1 for ..." />
                <p className="text-xs text-muted-foreground">Shown in the generated README — describe what your chain is for.</p>
              </div>
            </div>
          )}

          {/* ── Step 2: Tokenomics ── */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="border-l-4 border-l-cyan-500/50 bg-cyan-500/5 p-3 rounded-md flex gap-3 text-xs">
                <Coins className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                <div className="text-muted-foreground">
                  <strong className="text-foreground">Whole-token units.</strong> Enter values
                  in <strong className="text-cyan-400">{cfg.symbol || "TOKEN"}</strong> (1 = 10<sup>{cfg.decimals}</sup> raw wei).
                  Total supply, pre-mine, and block time are <strong className="text-emerald-400">sed-patched into <code className="bg-muted px-1 rounded">src/tokenomics.rs</code></strong> before
                  <code className="bg-muted px-1 rounded">cargo build</code>. Mint-per-block and halving are recorded in <code className="bg-muted px-1 rounded">chain.config.yaml</code>.
                </div>
              </div>

              <SectionHeader icon={Layers} title="Supply model" hint="Choose between a hard-capped (Bitcoin-style) or inflationary (Ethereum-style) economy." />
              <div className="grid md:grid-cols-2 gap-3">
                <ToggleRow id="fixedSupply" label="Fixed total supply"
                  hint="ON = hard cap, no minting after genesis. OFF = inflationary; mint-per-block continues forever (or until halving exhausts it)."
                  checked={cfg.fixedSupply}
                  onChange={(v) => update({ fixedSupply: v, ...(v ? { mintPerBlockZbx: 0 } : {}) })}
                  badge={cfg.fixedSupply ? "fixed" : "inflationary"} />
                <div className="border border-border rounded-md p-3 bg-card/40 text-xs text-muted-foreground space-y-1">
                  <div className="font-semibold text-foreground">Currently selected</div>
                  <div className="font-mono">
                    {cfg.fixedSupply
                      ? <>Hard-capped at <span className="text-foreground">{cfg.totalSupplyZbx.toLocaleString()} {cfg.symbol}</span>.</>
                      : <>Initial <span className="text-foreground">{cfg.totalSupplyZbx.toLocaleString()} {cfg.symbol}</span>, then +{cfg.mintPerBlockZbx.toLocaleString()} {cfg.symbol}/block{cfg.halvingBlocks > 0 ? `, halving every ${cfg.halvingBlocks.toLocaleString()} blocks` : ", no halving"}.</>}
                  </div>
                </div>
              </div>

              <Separator />

              <SectionHeader icon={Coins} title="Supply numbers" />
              <div className="grid md:grid-cols-2 gap-4">
                <NumberField id="totalSupplyZbx" label={`${cfg.fixedSupply ? "Total" : "Initial"} supply`}
                  suffix={cfg.symbol || "TOKEN"} mono
                  hint={`= ${cfg.totalSupplyZbx.toLocaleString()} ${cfg.symbol}`}
                  value={cfg.totalSupplyZbx} min={1}
                  error={stepError?.field === "totalSupplyZbx"}
                  onChange={(n) => update({ totalSupplyZbx: n })} />
                <NumberField id="founderPremineZbx" label="Founder pre-mine"
                  suffix={cfg.symbol || "TOKEN"} mono
                  hint={cfg.totalSupplyZbx > 0
                    ? `= ${cfg.founderPremineZbx.toLocaleString()} ${cfg.symbol} · ${((cfg.founderPremineZbx / cfg.totalSupplyZbx) * 100).toFixed(2)}% of supply`
                    : `= ${cfg.founderPremineZbx.toLocaleString()} ${cfg.symbol}`}
                  value={cfg.founderPremineZbx} min={0}
                  error={stepError?.field === "founderPremineZbx"}
                  onChange={(n) => update({ founderPremineZbx: n })} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="founderAddress">
                  Founder / admin address <span className="text-muted-foreground font-normal">(optional — receives the pre-mine at genesis)</span>
                </Label>
                <Input
                  id="founderAddress"
                  data-testid="input-founderAddress"
                  className={`font-mono ${stepError?.field === "founderAddress" ? "border-destructive" : ""}`}
                  placeholder="0x... — leave blank to credit the auto-generated validator key"
                  value={cfg.founderAddress}
                  onChange={(e) => update({ founderAddress: e.target.value.trim() })}
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={42}
                />
                <p className="text-xs text-muted-foreground">
                  {cfg.founderAddress
                    ? <>Pre-mine of <span className="text-foreground font-mono">{cfg.founderPremineZbx.toLocaleString()} {cfg.symbol}</span> will be credited at block 0 to <span className="text-foreground font-mono break-all">{cfg.founderAddress}</span>. You control this address off-chain (MetaMask, hardware wallet, multisig, etc.).</>
                    : <>Blank = the validator key generated on the VPS will hold the pre-mine. Paste a 0x address to send the pre-mine to a wallet you already control.</>}
                </p>
              </div>

              <Separator />

              <SectionHeader icon={Flame} title="Block emission" hint="Inflationary chains only — fixed-supply chains keep these at 0." />
              <div className="grid md:grid-cols-3 gap-4">
                <NumberField id="mintPerBlockZbx" label="Mint per block"
                  suffix={cfg.symbol || "TOKEN"} mono
                  hint={cfg.fixedSupply ? "Disabled — fixed supply is on." : `≈ ${(cfg.mintPerBlockZbx * Math.floor(86400 / Math.max(cfg.blockTimeSecs, 1))).toLocaleString()} ${cfg.symbol}/day`}
                  value={cfg.mintPerBlockZbx} min={0}
                  error={stepError?.field === "mintPerBlockZbx"}
                  onChange={(n) => update({ mintPerBlockZbx: n })} />
                <NumberField id="halvingBlocks" label="Halving interval"
                  suffix="blocks" mono
                  hint={cfg.halvingBlocks === 0 ? "0 = no halving (constant emission)." : `≈ every ${((cfg.halvingBlocks * cfg.blockTimeSecs) / 86400).toFixed(1)} days`}
                  value={cfg.halvingBlocks} min={0}
                  error={stepError?.field === "halvingBlocks"}
                  onChange={(n) => update({ halvingBlocks: n })} />
                <NumberField id="blockTimeSecs" label="Block time"
                  suffix="seconds" mono
                  hint="1 s = very fast; 5 s = balanced default; 10+ s = lighter."
                  value={cfg.blockTimeSecs} min={1} max={60}
                  error={stepError?.field === "blockTimeSecs"}
                  onChange={(n) => update({ blockTimeSecs: n })} />
              </div>
            </div>
          )}

          {/* ── Step 3: Consensus / PoS ── */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="border-l-4 border-l-violet-500/50 bg-violet-500/5 p-3 rounded-md flex gap-3 text-xs">
                <Shield className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
                <div className="text-muted-foreground">
                  <strong className="text-foreground">Consensus & validator economics.</strong> Captured into <code className="bg-muted px-1 rounded">chain.config.yaml</code>.
                  The current Zebvix base node ships with PoS using these defaults; tweaking them takes effect on the next start. PoA is reserved for the next builder release.
                </div>
              </div>

              <SectionHeader icon={Shield} title="Consensus algorithm" />
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="consensus">Algorithm</Label>
                  <Select value={cfg.consensus} onValueChange={(v) => update({ consensus: v as "pos" | "poa" })}>
                    <SelectTrigger id="consensus" data-testid="select-consensus">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pos">Proof of Stake (PoS)</SelectItem>
                      <SelectItem value="poa">Proof of Authority (PoA)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">PoS = open validator set, stake-weighted. PoA = whitelisted authorities, deterministic block production.</p>
                </div>
                <NumberField id="maxValidators" label="Max validator set size"
                  suffix="validators" mono
                  hint="Top N by stake (PoS) or by whitelist (PoA). 100-150 is a healthy default."
                  value={cfg.maxValidators} min={1} max={1000}
                  error={stepError?.field === "maxValidators"}
                  onChange={(n) => update({ maxValidators: n })} />
              </div>

              <Separator />

              <SectionHeader icon={Coins} title="Stake & slashing" />
              <div className="grid md:grid-cols-3 gap-4">
                <NumberField id="minValidatorStakeZbx" label="Min validator stake"
                  suffix={cfg.symbol || "TOKEN"} mono
                  hint={`= ${cfg.minValidatorStakeZbx.toLocaleString()} ${cfg.symbol}`}
                  value={cfg.minValidatorStakeZbx} min={0}
                  error={stepError?.field === "minValidatorStakeZbx"}
                  onChange={(n) => update({ minValidatorStakeZbx: n })} />
                <NumberField id="slashPercent" label="Double-sign slash"
                  suffix="%" mono
                  hint="Percent of stake destroyed on equivocation (5% is a strong but recoverable default)."
                  value={cfg.slashPercent} min={0} max={100}
                  error={stepError?.field === "slashPercent"}
                  onChange={(n) => update({ slashPercent: n })} />
                <NumberField id="unbondingDays" label="Unbonding period"
                  suffix="days" mono
                  hint="Days a withdrawing validator's stake remains slashable. 21 days matches Cosmos."
                  value={cfg.unbondingDays} min={0} max={365}
                  error={stepError?.field === "unbondingDays"}
                  onChange={(n) => update({ unbondingDays: n })} />
              </div>
            </div>
          )}

          {/* ── Step 4: Governance ── */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="border-l-4 border-l-fuchsia-500/50 bg-fuchsia-500/5 p-3 rounded-md flex gap-3 text-xs">
                <Landmark className="w-4 h-4 text-fuchsia-400 flex-shrink-0 mt-0.5" />
                <div className="text-muted-foreground">
                  <strong className="text-foreground">On-chain governance.</strong> Captured into <code className="bg-muted px-1 rounded">chain.config.yaml</code>.
                  Token holders submit proposals (parameter change, software upgrade, treasury spend),
                  vote within the voting period, and proposals execute after the delay if quorum is met.
                </div>
              </div>

              <ToggleRow id="governanceEnabled" label="Enable on-chain governance"
                hint="OFF = parameters are immutable post-genesis. Validators can still upgrade via coordinated restart."
                checked={cfg.governanceEnabled}
                onChange={(v) => update({ governanceEnabled: v })}
                badge={cfg.governanceEnabled ? "active" : "off"} />

              {cfg.governanceEnabled && (
                <>
                  <Separator />
                  <SectionHeader icon={Gauge} title="Voting parameters" />
                  <div className="grid md:grid-cols-2 gap-4">
                    <NumberField id="votingPeriodBlocks" label="Voting period"
                      suffix="blocks" mono
                      hint={`≈ ${((cfg.votingPeriodBlocks * cfg.blockTimeSecs) / 86400).toFixed(1)} days at ${cfg.blockTimeSecs}s blocks`}
                      value={cfg.votingPeriodBlocks} min={1} max={100_000_000}
                      error={stepError?.field === "votingPeriodBlocks"}
                      onChange={(n) => update({ votingPeriodBlocks: n })} />
                    <NumberField id="quorumPercent" label="Quorum"
                      suffix="%" mono
                      hint="Fraction of total voting power that must participate for a vote to be valid."
                      value={cfg.quorumPercent} min={0} max={100}
                      error={stepError?.field === "quorumPercent"}
                      onChange={(n) => update({ quorumPercent: n })} />
                    <NumberField id="proposalThresholdZbx" label="Proposal deposit threshold"
                      suffix={cfg.symbol || "TOKEN"} mono
                      hint={`= ${cfg.proposalThresholdZbx.toLocaleString()} ${cfg.symbol} required to submit a proposal (anti-spam)`}
                      value={cfg.proposalThresholdZbx} min={0}
                      error={stepError?.field === "proposalThresholdZbx"}
                      onChange={(n) => update({ proposalThresholdZbx: n })} />
                    <NumberField id="executionDelayBlocks" label="Execution delay"
                      suffix="blocks" mono
                      hint={`≈ ${((cfg.executionDelayBlocks * cfg.blockTimeSecs) / 3600).toFixed(1)} hours after a passed vote, before changes take effect`}
                      value={cfg.executionDelayBlocks} min={0} max={10_000_000}
                      error={stepError?.field === "executionDelayBlocks"}
                      onChange={(n) => update({ executionDelayBlocks: n })} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 5: Features + Network ── */}
          {step === 5 && (
            <div className="space-y-5">
              <div className="border-l-4 border-l-cyan-500/50 bg-cyan-500/5 p-3 rounded-md flex gap-3 text-xs">
                <Cog className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                <div className="text-muted-foreground">
                  <strong className="text-foreground">Feature matrix.</strong> Captured in <code className="bg-muted px-1 rounded">chain.config.yaml</code>.
                  The current binary honours <code className="bg-muted px-1 rounded">evm</code>, <code className="bg-muted px-1 rounded">zvm</code>, <code className="bg-muted px-1 rounded">mempool</code>, <code className="bg-muted px-1 rounded">snapshots</code>, <code className="bg-muted px-1 rounded">txIndex</code>, <code className="bg-muted px-1 rounded">websocket</code>, and <code className="bg-muted px-1 rounded">metrics</code> at startup; the rest are recorded for upcoming releases.
                </div>
              </div>

              <SectionHeader icon={Cog} title={`Feature toggles  (${enabledFeatureCount}/${totalFeatureCount} enabled)`} />
              {stepError?.field === "features" && (
                <div className="text-xs text-rose-400 -mt-2">{stepError.message}</div>
              )}
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {FEATURE_META.map((f) => (
                  <ToggleRow key={f.key} id={`feat-${f.key}`} label={f.label} hint={f.hint}
                    badge={f.badge}
                    checked={cfg.features[f.key]}
                    onChange={(v) => updateFeature(f.key, v)} />
                ))}
              </div>

              <Separator />

              <SectionHeader icon={Network} title="Network ports" />
              <div className="grid md:grid-cols-2 gap-4">
                <NumberField id="rpcPort" label="RPC port"
                  hint="8545 is the EVM convention. Open this in your firewall for external access."
                  value={cfg.rpcPort} min={1024} max={65535}
                  error={stepError?.field === "rpcPort"}
                  onChange={(n) => update({ rpcPort: n })} />
                <NumberField id="p2pPort" label="P2P port"
                  hint="30303 is the EVM convention. Other validators / followers connect here."
                  value={cfg.p2pPort} min={1024} max={65535}
                  error={stepError?.field === "p2pPort"}
                  onChange={(n) => update({ p2pPort: n })} />
              </div>
            </div>
          )}

          {/* ── Step 6: Build ── */}
          {step === 6 && (
            <div className="space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="border border-border rounded-lg p-4 bg-card/60 space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2"><Coins className="w-3.5 h-3.5" /> Identity & tokenomics</div>
                  <dl className="text-sm space-y-1.5">
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Chain</dt><dd className="font-mono text-foreground truncate">{cfg.chainName}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Chain ID</dt><dd className="font-mono text-foreground">{cfg.chainId}  (0x{cfg.chainId.toString(16)})</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Symbol</dt><dd className="font-mono text-foreground">{cfg.symbol}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Decimals</dt><dd className="font-mono text-foreground">{cfg.decimals}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Supply model</dt><dd className="font-mono text-foreground">{cfg.fixedSupply ? "fixed" : "inflationary"}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{cfg.fixedSupply ? "Total" : "Initial"} supply</dt><dd className="font-mono text-foreground">{cfg.totalSupplyZbx.toLocaleString()} {cfg.symbol}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Founder pre-mine</dt><dd className="font-mono text-foreground">{cfg.founderPremineZbx.toLocaleString()} {cfg.symbol}</dd></div>
                    <div className="flex justify-between gap-4 items-start"><dt className="text-muted-foreground flex-shrink-0">Pre-mine to</dt>
                      <dd className="font-mono text-foreground text-xs text-right break-all">
                        {cfg.founderAddress
                          ? <span className="text-emerald-300">{cfg.founderAddress.slice(0, 10)}…{cfg.founderAddress.slice(-8)}</span>
                          : <span className="text-amber-400">validator key (auto)</span>}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Mint per block</dt><dd className="font-mono text-foreground">{cfg.mintPerBlockZbx.toLocaleString()} {cfg.symbol}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Halving</dt><dd className="font-mono text-foreground">{cfg.halvingBlocks === 0 ? "none" : `${cfg.halvingBlocks.toLocaleString()} blocks`}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Block time</dt><dd className="font-mono text-foreground">{cfg.blockTimeSecs} s</dd></div>
                  </dl>
                </div>
                <div className="border border-border rounded-lg p-4 bg-card/60 space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2"><Shield className="w-3.5 h-3.5" /> Consensus & governance</div>
                  <dl className="text-sm space-y-1.5">
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Consensus</dt><dd className="font-mono text-foreground uppercase">{cfg.consensus}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Max validators</dt><dd className="font-mono text-foreground">{cfg.maxValidators}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Min stake</dt><dd className="font-mono text-foreground">{cfg.minValidatorStakeZbx.toLocaleString()} {cfg.symbol}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Slash</dt><dd className="font-mono text-foreground">{cfg.slashPercent}%</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Unbonding</dt><dd className="font-mono text-foreground">{cfg.unbondingDays} days</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Governance</dt><dd className="font-mono text-foreground">{cfg.governanceEnabled ? "enabled" : "disabled"}</dd></div>
                    {cfg.governanceEnabled && (
                      <>
                        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Voting period</dt><dd className="font-mono text-foreground">{cfg.votingPeriodBlocks.toLocaleString()} blocks</dd></div>
                        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Quorum</dt><dd className="font-mono text-foreground">{cfg.quorumPercent}%</dd></div>
                        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Proposal threshold</dt><dd className="font-mono text-foreground">{cfg.proposalThresholdZbx.toLocaleString()} {cfg.symbol}</dd></div>
                        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Exec delay</dt><dd className="font-mono text-foreground">{cfg.executionDelayBlocks.toLocaleString()} blocks</dd></div>
                      </>
                    )}
                  </dl>
                </div>
                <div className="border border-border rounded-lg p-4 bg-card/60 space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2"><Cog className="w-3.5 h-3.5" /> Features & runtime</div>
                  <dl className="text-sm space-y-1.5">
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">RPC</dt><dd className="font-mono text-foreground">0.0.0.0:{cfg.rpcPort}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">P2P</dt><dd className="font-mono text-foreground">0.0.0.0:{cfg.p2pPort}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Binary</dt><dd className="font-mono text-foreground text-xs">/usr/local/bin/{cfg.chainName}-node</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Data dir</dt><dd className="font-mono text-foreground text-xs">/var/lib/{cfg.chainName}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Validator key</dt><dd className="font-mono text-foreground text-xs">/etc/{cfg.chainName}/validator.key</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Service</dt><dd className="font-mono text-foreground text-xs">{cfg.chainName}-node.service</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Features on</dt><dd className="font-mono text-foreground">{enabledFeatureCount}/{totalFeatureCount}</dd></div>
                  </dl>
                  <div className="pt-1 flex flex-wrap gap-1">
                    {FEATURE_META.filter((f) => cfg.features[f.key]).map((f) => (
                      <Badge key={f.key} variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-400 border-emerald-500/30">{f.key}</Badge>
                    ))}
                    {FEATURE_META.filter((f) => !cfg.features[f.key]).map((f) => (
                      <Badge key={f.key} variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground/60 border-border line-through">{f.key}</Badge>
                    ))}
                  </div>
                </div>
                <div className="border border-amber-500/30 rounded-lg p-4 bg-amber-500/5 space-y-2">
                  <div className="text-xs uppercase tracking-wide text-amber-400 flex items-center gap-2"><Info className="w-3.5 h-3.5" /> Active vs declared</div>
                  <p className="text-xs text-muted-foreground">
                    Settings <strong className="text-emerald-400">sed-patched into the binary</strong>: chain ID, total supply, founder pre-mine, block time.
                    The <strong className="text-emerald-400">founder/admin address</strong> is applied at chain-init time via <code className="bg-muted px-1 rounded">init --alloc</code> (deterministic, verified post-init against <code className="bg-muted px-1 rounded">genesis.json</code>).
                    Everything else is captured in <code className="bg-muted px-1 rounded">chain.config.yaml</code> and read by the node at startup where supported,
                    otherwise recorded for audit and upcoming binary releases.
                  </p>
                  <div className="pt-1 border-t border-amber-500/20 text-xs text-muted-foreground flex gap-2">
                    <KeyRound className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <span>
                      {cfg.founderAddress
                        ? <>Pre-mine of <strong className="text-foreground">{cfg.founderPremineZbx.toLocaleString()} {cfg.symbol}</strong> goes to your admin wallet <span className="font-mono text-foreground break-all">{cfg.founderAddress}</span> at genesis. The validator key auto-generated on the VPS is used for block production / staking only.</>
                        : <>The validator key is auto-generated on the VPS — its address holds your <strong className="text-foreground">{cfg.founderPremineZbx.toLocaleString()} {cfg.symbol}</strong> pre-mine at genesis (because you left the founder address blank). Back it up, or set a founder address on Step 2 to send the pre-mine to a wallet you already control.</>}
                    </span>
                  </div>
                </div>
              </div>

              {/* Build action */}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={build}
                  data-testid="button-build"
                  disabled={stage === "validating" || stage === "generating" || stage === "packaging"}
                  size="lg"
                >
                  {stage === "validating" || stage === "generating" || stage === "packaging" ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Building...</>
                  ) : stage === "ready" ? (
                    <><RefreshCw className="w-4 h-4 mr-2" />Rebuild</>
                  ) : (
                    <><Hammer className="w-4 h-4 mr-2" />Generate setup bundle</>
                  )}
                </Button>
                {stage === "ready" && downloadUrl && (
                  <a href={downloadUrl} download={downloadName}>
                    <Button variant="outline" size="lg" className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" data-testid="button-download">
                      <Download className="w-4 h-4 mr-2" />
                      Download {downloadName} ({(downloadBytes / 1024).toFixed(1)} KB)
                    </Button>
                  </a>
                )}
                <Button onClick={reset} variant="ghost" size="sm" className="ml-auto">
                  Start over
                </Button>
              </div>

              {/* Terminal-style live log */}
              <div className="rounded-lg border border-border bg-black/80 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Terminal className="w-3.5 h-3.5" />
                    <span className="font-mono">chain-builder@zebvix:~$</span>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      stage === "ready" ? "text-emerald-400 border-emerald-500/40"
                      : stage === "error" ? "text-rose-400 border-rose-500/40"
                      : stage === "idle" ? "text-muted-foreground border-border"
                      : "text-amber-400 border-amber-500/40"
                    }
                  >
                    {stage === "idle" ? "ready" : stage}
                  </Badge>
                </div>
                <div className="font-mono text-xs p-3 max-h-72 overflow-y-auto space-y-0.5">
                  {logs.length === 0 ? (
                    <div className="text-muted-foreground/60 italic">
                      Press "Generate setup bundle" — the build log will appear here.
                    </div>
                  ) : logs.map((l, i) => (
                    <div key={i} className={[
                      "whitespace-pre-wrap break-all",
                      l.kind === "ok"   && "text-emerald-400",
                      l.kind === "warn" && "text-amber-400",
                      l.kind === "err"  && "text-rose-400",
                      l.kind === "cmd"  && "text-cyan-400",
                      l.kind === "info" && "text-foreground",
                    ].filter(Boolean).join(" ")}>
                      {l.text}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>

              {/* Install instructions — appear after build */}
              {stage === "ready" && (
                <div className="space-y-4 border border-emerald-500/30 rounded-lg p-4 bg-emerald-500/5">
                  <div className="flex items-center gap-2">
                    <Rocket className="w-5 h-5 text-emerald-400" />
                    <div className="font-semibold text-foreground">Deploy to your VPS in 3 commands</div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    SSH into a fresh Ubuntu 22.04+ VPS (4 vCPU / 8 GB RAM recommended), upload the
                    tarball, then:
                  </p>
                  <div className="relative">
                    <CodeBlock language="bash" code={installCmd} />
                    <button
                      type="button"
                      onClick={() => copyText(installCmd, "install")}
                      className="absolute top-2 right-2 text-xs px-2 py-1 rounded border border-border bg-background/80 hover:bg-muted flex items-center gap-1"
                    >
                      {copied === "install" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      {copied === "install" ? "copied" : "copy"}
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>The installer will:</p>
                    <ol className="list-decimal pl-5 space-y-0.5">
                      <li>Install system deps (apt) and Rust toolchain if missing</li>
                      <li>Fetch the Zebvix base node source (~88 MB)</li>
                      <li><strong className="text-foreground">Sed-patch <code className="bg-muted px-1 rounded">src/tokenomics.rs</code></strong> with chain ID, supply, pre-mine, block time</li>
                      <li>Install <code className="bg-muted px-1 rounded">chain.config.yaml</code> at <code className="bg-muted px-1 rounded">/etc/{cfg.chainName}/chain.config.yaml</code> for runtime parameters (PoS, governance, mint, features)</li>
                      <li><code className="bg-muted px-1 rounded">cargo build --release --bin zebvix-node</code> and install as <code className="bg-muted px-1 rounded">{cfg.chainName}-node</code></li>
                      <li>Generate validator key + run <code className="bg-muted px-1 rounded">init</code> + start systemd service + health check</li>
                    </ol>
                  </div>
                  <div className="pt-2 border-t border-emerald-500/20">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">After install — verify RPC</div>
                    <CodeBlock
                      language="bash"
                      code={`curl -s http://YOUR_VPS_IP:${cfg.rpcPort} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# → {"jsonrpc":"2.0","id":1,"result":"0x${cfg.chainId.toString(16)}"}`}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step error */}
          {stepError && (
            <div className="border-l-4 border-l-rose-500/60 bg-rose-500/5 p-3 rounded-md flex gap-2 text-sm">
              <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5" />
              <div className="text-rose-300">{stepError.message}</div>
            </div>
          )}

          {/* Nav */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Button variant="ghost" onClick={prev} disabled={step === 1} data-testid="button-prev">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
            {step < STEPS.length ? (
              <Button onClick={next} data-testid="button-next">
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <div className="text-xs text-muted-foreground">
                Step {step} of {STEPS.length}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Help / FAQ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="w-4 h-4 text-primary" />
            What this builder is (and isn't)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <div className="text-emerald-400 font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Yes
            </div>
            <ul className="text-muted-foreground text-xs space-y-1 list-disc pl-5">
              <li>Forks the Zebvix base node into your own L1 with a custom chain ID</li>
              <li>Sed-patches supply, pre-mine, block time into the Rust source before build</li>
              <li>Captures PoS, governance, emission, and feature toggles into <code>chain.config.yaml</code> for runtime read</li>
              <li>EVM-compatible — Solidity 0.8+, MetaMask, Hardhat, Foundry, ethers, viem all work</li>
              <li>Production systemd unit with auto-restart and journald logs</li>
              <li>Free — open source, MIT license</li>
            </ul>
          </div>
          <div className="space-y-2">
            <div className="text-amber-400 font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> Not yet
            </div>
            <ul className="text-muted-foreground text-xs space-y-1 list-disc pl-5">
              <li>Multi-validator genesis — you start with one validator, add more after launch</li>
              <li>Full PoA whitelist editor — PoA is reserved for the next builder release</li>
              <li>In-browser node hosting — you bring your own VPS</li>
              <li>Block explorer + faucet UI — coming as the next builder modules</li>
              <li>Bridges to other chains — wire up after launch using <code className="bg-muted px-1 rounded">/bridge</code></li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
