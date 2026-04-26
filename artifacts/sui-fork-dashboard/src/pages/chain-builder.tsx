import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Hammer, Rocket, CheckCircle2, AlertCircle, Settings, Coins, Network,
  Terminal, Download, Copy, Check, ArrowRight, ArrowLeft, Loader2, Zap, Shield,
  FileCode2, Server, Package, RefreshCw, KeyRound,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeBlock } from "@/components/ui/code-block";

const API_BASE = (import.meta as any).env?.BASE_URL?.replace(/\/+$/, "") || "";

type ChainConfig = {
  chainName: string;
  chainId: number;
  symbol: string;
  decimals: number;
  totalSupplyZbx: number;
  founderPremineZbx: number;
  blockTimeSecs: number;
  rpcPort: number;
  p2pPort: number;
  description: string;
};

const DEFAULT_CFG: ChainConfig = {
  chainName: "mychain",
  chainId: 9999,
  symbol: "MYC",
  decimals: 18,
  totalSupplyZbx: 150_000_000,
  founderPremineZbx: 9_990_000,
  blockTimeSecs: 5,
  rpcPort: 8545,
  p2pPort: 30303,
  description: "",
};

const STEPS = [
  { id: 1, label: "Identity",   icon: Coins,    blurb: "Name, chain ID, symbol, decimals" },
  { id: 2, label: "Tokenomics", icon: Coins,    blurb: "Supply, pre-mine, block time" },
  { id: 3, label: "Network",    icon: Network,  blurb: "RPC + P2P ports" },
  { id: 4, label: "Build",      icon: Hammer,   blurb: "Generate & download bundle" },
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

function validateStep(step: number, c: ChainConfig): { field?: string; message: string } | null {
  if (step === 1) {
    if (!SLUG_RE.test(c.chainName))
      return { field: "chainName", message: "Chain name must be lowercase letters / digits / dash, 2-31 chars." };
    if (!Number.isInteger(c.chainId) || c.chainId < 1 || c.chainId > 2_147_483_647)
      return { field: "chainId", message: "Chain ID must be a positive integer ≤ 2,147,483,647." };
    if (!/^[A-Z]{2,8}$/.test(c.symbol))
      return { field: "symbol", message: "Symbol must be 2-8 uppercase letters." };
    if (c.decimals < 0 || c.decimals > 36)
      return { field: "decimals", message: "Decimals must be between 0 and 36." };
  }
  if (step === 2) {
    if (!Number.isInteger(c.totalSupplyZbx) || c.totalSupplyZbx < 1 || c.totalSupplyZbx > 1_000_000_000_000)
      return { field: "totalSupplyZbx", message: "Total supply must be 1..1,000,000,000,000 whole tokens." };
    if (!Number.isInteger(c.founderPremineZbx) || c.founderPremineZbx < 0 || c.founderPremineZbx > c.totalSupplyZbx)
      return { field: "founderPremineZbx", message: "Founder pre-mine must be 0..total supply." };
    if (!Number.isInteger(c.blockTimeSecs) || c.blockTimeSecs < 1 || c.blockTimeSecs > 60)
      return { field: "blockTimeSecs", message: "Block time must be 1..60 seconds." };
  }
  if (step === 3) {
    if (c.rpcPort < 1024 || c.rpcPort > 65535)
      return { field: "rpcPort", message: "RPC port must be 1024..65535." };
    if (c.p2pPort < 1024 || c.p2pPort > 65535)
      return { field: "p2pPort", message: "P2P port must be 1024..65535." };
    if (c.rpcPort === c.p2pPort)
      return { field: "p2pPort", message: "RPC and P2P ports must differ." };
  }
  return null;
}

const STEP_FOR_FIELD: Record<string, number> = {
  chainName: 1, chainId: 1, symbol: 1, decimals: 1,
  totalSupplyZbx: 2, founderPremineZbx: 2, blockTimeSecs: 2,
  rpcPort: 3, p2pPort: 3,
};

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

  async function build() {
    setLogs([]);
    setDownloadUrl(null);
    setStage("validating");
    appendLog({ kind: "cmd", text: `$ zebvix chain-builder generate ${cfg.chainName}` });
    appendLog({ kind: "info", text: `Validating configuration...` });
    await new Promise((r) => setTimeout(r, 300));

    for (const s of [1, 2, 3] as const) {
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
    appendLog({ kind: "ok", text: `  ✓ supply          ${cfg.totalSupplyZbx.toLocaleString()} ${cfg.symbol}` });
    appendLog({ kind: "ok", text: `  ✓ pre-mine        ${cfg.founderPremineZbx.toLocaleString()} ${cfg.symbol} (to validator)` });
    appendLog({ kind: "ok", text: `  ✓ block time      ${cfg.blockTimeSecs} s` });
    appendLog({ kind: "ok", text: `  ✓ RPC / P2P       ${cfg.rpcPort} / ${cfg.p2pPort}` });

    setStage("generating");
    appendLog({ kind: "info", text: `Generating install.sh, systemd unit, README.md...` });
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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">Chain Builder</Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">≈ 15-min setup</Badge>
          <Badge variant="outline" className="text-amber-400 border-amber-500/40">No-code wizard</Badge>
          <Badge variant="outline" className="text-violet-400 border-violet-500/40">Self-hosted</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Hammer className="w-7 h-7 text-primary" />
          Build Your Own Chain
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Fork the Zebvix base node into your own L1 in four steps — name it, set the supply &
          pre-mine, pick the ports, and we generate a one-shot installer that patches the source,
          builds the binary, generates a validator key, initializes genesis, and starts the
          systemd service on a fresh Ubuntu/Debian VPS.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">What you get</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li><strong className="text-emerald-400">install.sh</strong> — patches <code className="bg-muted px-1 rounded">src/tokenomics.rs</code> with your chain ID, supply, pre-mine and block time, then builds + initializes + starts the node</li>
              <li><strong className="text-emerald-400">systemd unit</strong> — production-grade service that runs <code className="bg-muted px-1 rounded">{`<chain>`}-node start</code> with auto-restart and journald logging</li>
              <li><strong className="text-emerald-400">README.md</strong> — operator runbook with status / logs / RPC test / pre-mine transfer commands</li>
              <li>Validator key is auto-generated on your VPS during install — its address holds your founder pre-mine at genesis</li>
              <li>Bundle stays under 30 KB; the heavy ~88 MB Zebvix base source is fetched by the installer only once</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile icon={Zap}        label="Setup time"   value="≈ 15 min" sub="on a 4 vCPU / 8 GB VPS" />
        <StatTile icon={FileCode2}  label="Files"        value="3"        sub="installer + unit + readme" />
        <StatTile icon={Server}     label="Bundle size"  value="< 30 KB"  sub="tarball, instant download" />
        <StatTile icon={Shield}     label="Hardening"    value="systemd"  sub="auto-restart + journald" />
      </div>

      {/* Step tracker */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STEPS.map((s) => (
          <StepPill key={s.id} step={s} current={step === s.id} completed={step > s.id} />
        ))}
      </div>

      {/* Wizard body */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {step === 1 && <Coins className="w-5 h-5 text-primary" />}
            {step === 2 && <Coins className="w-5 h-5 text-primary" />}
            {step === 3 && <Network className="w-5 h-5 text-primary" />}
            {step === 4 && <Hammer className="w-5 h-5 text-primary" />}
            Step {step} — {STEPS[step - 1].label}
          </CardTitle>
          <CardDescription>{STEPS[step - 1].blurb}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {step === 1 && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="chainName">Chain name (slug)</Label>
                <Input id="chainName" value={cfg.chainName}
                  onChange={(e) => update({ chainName: e.target.value.toLowerCase() })}
                  placeholder="mychain" className={fieldErrClass("chainName")} />
                <p className="text-xs text-muted-foreground">Used as binary name (<code>{cfg.chainName}-node</code>), data dir, systemd unit.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="chainId">Chain ID (numeric)</Label>
                <Input id="chainId" type="number" value={cfg.chainId}
                  onChange={(e) => update({ chainId: Number(e.target.value) })}
                  placeholder="9999" className={fieldErrClass("chainId")} />
                <p className="text-xs text-muted-foreground">EVM chain ID. Pick something unique to avoid conflicts (e.g. 9999, 5555, 31337).</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="symbol">Token symbol</Label>
                <Input id="symbol" value={cfg.symbol}
                  onChange={(e) => update({ symbol: e.target.value.toUpperCase() })}
                  placeholder="MYC" maxLength={8} className={fieldErrClass("symbol")} />
                <p className="text-xs text-muted-foreground">2-8 uppercase letters. Shown in wallets, explorers, RPC.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="decimals">Decimals</Label>
                <Input id="decimals" type="number" value={cfg.decimals}
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

          {step === 2 && (
            <div className="space-y-4">
              <div className="border-l-4 border-l-cyan-500/50 bg-cyan-500/5 p-3 rounded-md flex gap-3 text-xs">
                <Coins className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                <div className="text-muted-foreground">
                  <strong className="text-foreground">Whole-token units.</strong> Enter values
                  in <strong className="text-cyan-400">{cfg.symbol || "TOKEN"}</strong> (1 = 10<sup>{cfg.decimals}</sup> raw wei). The installer
                  patches these into <code className="bg-muted px-1 rounded">src/tokenomics.rs</code> as
                  <code className="bg-muted px-1 rounded">TOTAL_SUPPLY_ZBX</code> + <code className="bg-muted px-1 rounded">FOUNDER_PREMINE_ZBX</code> before
                  <code className="bg-muted px-1 rounded">cargo build</code>.
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="totalSupplyZbx">Total supply ({cfg.symbol || "TOKEN"})</Label>
                  <Input id="totalSupplyZbx" type="number" min={1} value={cfg.totalSupplyZbx}
                    onChange={(e) => update({ totalSupplyZbx: Number(e.target.value) })}
                    className={`font-mono ${fieldErrClass("totalSupplyZbx")}`} />
                  <p className="text-xs text-muted-foreground font-mono">
                    = {cfg.totalSupplyZbx.toLocaleString()} {cfg.symbol}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="founderPremineZbx">Founder pre-mine ({cfg.symbol || "TOKEN"})</Label>
                  <Input id="founderPremineZbx" type="number" min={0} value={cfg.founderPremineZbx}
                    onChange={(e) => update({ founderPremineZbx: Number(e.target.value) })}
                    className={`font-mono ${fieldErrClass("founderPremineZbx")}`} />
                  <p className="text-xs text-muted-foreground font-mono">
                    = {cfg.founderPremineZbx.toLocaleString()} {cfg.symbol}
                    {cfg.totalSupplyZbx > 0 && (
                      <span className="text-muted-foreground/60"> · {((cfg.founderPremineZbx / cfg.totalSupplyZbx) * 100).toFixed(2)}% of supply</span>
                    )}
                  </p>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="blockTimeSecs">Block time (seconds)</Label>
                  <Input id="blockTimeSecs" type="number" min={1} max={60} value={cfg.blockTimeSecs}
                    onChange={(e) => update({ blockTimeSecs: Number(e.target.value) })}
                    className={fieldErrClass("blockTimeSecs")} />
                  <p className="text-xs text-muted-foreground">
                    1 s = very fast, more bandwidth. 5 s = Zebvix default, balanced. 10+ s = lighter, slower finality.
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="rpcPort">RPC port</Label>
                  <Input id="rpcPort" type="number" value={cfg.rpcPort}
                    onChange={(e) => update({ rpcPort: Number(e.target.value) })}
                    className={fieldErrClass("rpcPort")} />
                  <p className="text-xs text-muted-foreground">8545 is the EVM convention. Open this in your firewall for external access.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p2pPort">P2P port</Label>
                  <Input id="p2pPort" type="number" value={cfg.p2pPort}
                    onChange={(e) => update({ p2pPort: Number(e.target.value) })}
                    className={fieldErrClass("p2pPort")} />
                  <p className="text-xs text-muted-foreground">30303 is the EVM convention. Other validators / followers connect here.</p>
                </div>
              </div>

              <div className="border-l-4 border-l-cyan-500/50 bg-cyan-500/5 p-3 rounded-md flex gap-3 text-xs">
                <Settings className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                <div className="text-muted-foreground">
                  <strong className="text-foreground">Final review.</strong> On the next step we
                  generate <code className="bg-muted px-1 rounded">{cfg.chainName}-setup.tar.gz</code> and
                  show the install command. You can come back and tweak any setting before downloading.
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="border border-border rounded-lg p-4 bg-card/60 space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Identity & tokenomics</div>
                  <dl className="text-sm space-y-1.5">
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Chain</dt><dd className="font-mono text-foreground truncate">{cfg.chainName}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Chain ID</dt><dd className="font-mono text-foreground">{cfg.chainId}  (0x{cfg.chainId.toString(16)})</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Symbol</dt><dd className="font-mono text-foreground">{cfg.symbol}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Decimals</dt><dd className="font-mono text-foreground">{cfg.decimals}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Total supply</dt><dd className="font-mono text-foreground">{cfg.totalSupplyZbx.toLocaleString()} {cfg.symbol}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Founder pre-mine</dt><dd className="font-mono text-foreground">{cfg.founderPremineZbx.toLocaleString()} {cfg.symbol}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Block time</dt><dd className="font-mono text-foreground">{cfg.blockTimeSecs} s</dd></div>
                  </dl>
                </div>
                <div className="border border-border rounded-lg p-4 bg-card/60 space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Network & runtime</div>
                  <dl className="text-sm space-y-1.5">
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">RPC</dt><dd className="font-mono text-foreground">0.0.0.0:{cfg.rpcPort}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">P2P</dt><dd className="font-mono text-foreground">0.0.0.0:{cfg.p2pPort}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Binary</dt><dd className="font-mono text-foreground text-xs">/usr/local/bin/{cfg.chainName}-node</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Data dir</dt><dd className="font-mono text-foreground text-xs">/var/lib/{cfg.chainName}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Validator key</dt><dd className="font-mono text-foreground text-xs">/etc/{cfg.chainName}/validator.key</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Service</dt><dd className="font-mono text-foreground text-xs">{cfg.chainName}-node.service</dd></div>
                  </dl>
                  <div className="pt-2 border-t border-border text-xs text-muted-foreground flex gap-2">
                    <KeyRound className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <span>The validator key is auto-generated on the VPS. Its address holds your <strong className="text-foreground">{cfg.founderPremineZbx.toLocaleString()} {cfg.symbol}</strong> pre-mine at genesis — back it up.</span>
                  </div>
                </div>
              </div>

              {/* Build action */}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={build}
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
                    <Button variant="outline" size="lg" className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10">
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
                      <li><strong className="text-foreground">Sed-patch <code className="bg-muted px-1 rounded">src/tokenomics.rs</code></strong> with your chain ID, supply, pre-mine, block time</li>
                      <li><code className="bg-muted px-1 rounded">cargo build --release --bin zebvix-node</code> and install as <code className="bg-muted px-1 rounded">{cfg.chainName}-node</code></li>
                      <li>Generate validator key at <code className="bg-muted px-1 rounded">/etc/{cfg.chainName}/validator.key</code></li>
                      <li>Run <code className="bg-muted px-1 rounded">{cfg.chainName}-node init</code> to write genesis at <code className="bg-muted px-1 rounded">/var/lib/{cfg.chainName}</code></li>
                      <li>Install + enable the systemd unit, open firewall ports, start the service</li>
                      <li>Run a health check and print the RPC endpoint + validator address</li>
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
            <Button variant="ghost" onClick={prev} disabled={step === 1}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
            {step < STEPS.length ? (
              <Button onClick={next}>
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
              <li>Patches supply, pre-mine, and block time into the Rust source before build</li>
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
              <li>Multi-validator genesis — you start with one validator, add more via governance later</li>
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
