import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { CodeBlock } from "@/components/ui/code-block";
import { useToast } from "@/hooks/use-toast";
import {
  Rocket, Shield, Activity, HardDrive, Cpu, Wifi, KeyRound,
  ServerCog, AlertTriangle, ChevronRight, Database, Bell, BarChart3,
  Lock, Zap, Gauge, DollarSign, FileCode, Download, Copy, CheckCircle2,
  Loader2, Network, Globe, Mail, Hash, Bug, RefreshCw, Sparkles,
} from "lucide-react";

const API_BASE = (import.meta as any).env?.BASE_URL?.replace(/\/+$/, "") || "";

// ─────────────────────────────────────────────────────────────────────────────
// Hardware reference (static — same hardware applies regardless of config)
// ─────────────────────────────────────────────────────────────────────────────

const SPECS = [
  { component: "CPU",        validator: "32+ cores (AMD EPYC / Intel Xeon)", rpc: "16+ cores" },
  { component: "RAM",        validator: "128 GB DDR5 ECC",                   rpc: "64 GB" },
  { component: "Storage",    validator: "4 TB NVMe SSD (RAID 1)",            rpc: "2 TB NVMe SSD" },
  { component: "Network",    validator: "1 Gbps dedicated",                  rpc: "1 Gbps dedicated" },
  { component: "OS",         validator: "Ubuntu 22.04 LTS",                  rpc: "Ubuntu 22.04 LTS" },
  { component: "Filesystem", validator: "ext4 / xfs (avoid btrfs/zfs CoW)", rpc: "ext4 / xfs" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Workbench config (kept in lock-step with backend DeployConfig)
// ─────────────────────────────────────────────────────────────────────────────

type BackupDest = "none" | "s3" | "r2" | "local";

interface DeployConfig {
  chainName: string;
  rpcDomain: string;
  adminEmail: string;
  validatorCount: number;
  publicRpcCount: number;
  region: string;
  rpcPort: number;
  p2pPort: number;
  metricsPort: number;
  corsOrigins: string;
  enableAdminAuth: boolean;
  enableFail2ban: boolean;
  enableUfw: boolean;
  enableWireguard: boolean;
  wireguardCidr: string;
  adminMethodBlocklist: string;
  backupDest: BackupDest;
  backupBucket: string;
  backupRetentionDays: number;
  enableHourlySnapshot: boolean;
  alertSlackWebhook: string;
  alertPagerdutyKey: string;
  alertEmail: string;
  thresholdPeerMin: number;
  thresholdSyncLagSec: number;
  thresholdDiskPct: number;
}

const DEFAULT_CFG: DeployConfig = {
  chainName: "zebvix",
  rpcDomain: "rpc.example.io",
  adminEmail: "ops@example.io",
  validatorCount: 4,
  publicRpcCount: 2,
  region: "eu-central-1",
  rpcPort: 8545,
  p2pPort: 30303,
  metricsPort: 9100,
  corsOrigins: "*",
  enableAdminAuth: true,
  enableFail2ban: true,
  enableUfw: true,
  enableWireguard: true,
  wireguardCidr: "10.42.0.0/24",
  adminMethodBlocklist: "admin_|personal_|miner_|debug_|txpool_",
  backupDest: "s3",
  backupBucket: "zebvix-prod-snapshots",
  backupRetentionDays: 30,
  enableHourlySnapshot: true,
  alertSlackWebhook: "",
  alertPagerdutyKey: "",
  alertEmail: "oncall@example.io",
  thresholdPeerMin: 3,
  thresholdSyncLagSec: 30,
  thresholdDiskPct: 80,
};

interface ScoreItem { key: string; label: string; weight: number; got: number }
interface PreviewResponse {
  config: DeployConfig;
  baseUrl: string;
  files: Record<string, string>;
  score: { total: number; items: ScoreItem[] };
  cost: { total: number; breakdown: { item: string; usd: number }[] };
  summary: { installHash: string; totalBytes: number; fileCount: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Static hardening reference (kept as a quick-glance summary, complementary
// to the live workbench output below it)
// ─────────────────────────────────────────────────────────────────────────────

const HARDEN_BLOCKS = [
  {
    icon: KeyRound, title: "Key Management",
    items: [
      "Generate validator keys on an air-gapped machine.",
      "Store keys in an HSM or YubiHSM2 — never plaintext on disk.",
      "Cold-backup all keypairs offline (encrypted).",
      "Rotate operator SSH keys quarterly; disable password auth.",
    ],
  },
  {
    icon: Wifi, title: "Network Security",
    items: [
      "Validator P2P inside a private subnet or VPN (WireGuard).",
      "JSON-RPC behind a CDN / WAF with rate limits.",
      "DDoS protection on every public endpoint.",
      "fail2ban on SSH, ufw default deny inbound.",
    ],
  },
  {
    icon: ServerCog, title: "Infrastructure",
    items: [
      "≥ 4 geographically distributed validators.",
      "Dedicated bare-metal — avoid noisy-neighbour cloud.",
      "NVMe SSD with RAID-1 for chain database.",
      "UPS + redundant PSU; ECC RAM mandatory.",
    ],
  },
  {
    icon: BarChart3, title: "Monitoring",
    items: [
      "Prometheus scrape on /metrics; Grafana dashboards.",
      "Alert on consensus lag, missed proposals, peer drop.",
      "Track disk growth — chain DB grows ~ 5 GB/month.",
      "On-call rotation with PagerDuty / Opsgenie.",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function Production() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<DeployConfig>(DEFAULT_CFG);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [activeFile, setActiveFile] = useState<string>("install-production.sh");
  const [copied, setCopied] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced live preview
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchPreview(cfg);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  async function fetchPreview(c: DeployConfig) {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await fetch(`${API_BASE}/api/production-deploy/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      const body = await res.json();
      if (!res.ok) {
        setPreviewError(String(body?.error || `HTTP ${res.status}`));
        return;
      }
      setPreview(body as PreviewResponse);
      // Make sure the active file still exists in the new bundle.
      if (body?.files && !body.files[activeFile]) {
        setActiveFile(Object.keys(body.files)[0] || "install-production.sh");
      }
    } catch (e: any) {
      setPreviewError(String(e?.message || e));
    } finally {
      setPreviewing(false);
    }
  }

  async function downloadBundle() {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/production-deploy/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: "Generate failed",
          description: String(err?.error || `HTTP ${res.status}`),
          variant: "destructive",
        });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${cfg.chainName}-prod.tar.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: "Bundle generated",
        description: `${cfg.chainName}-prod.tar.gz — extract and run install-production.sh`,
      });
    } catch (e: any) {
      toast({ title: "Generate failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  function copyFile(name: string, body: string) {
    void navigator.clipboard.writeText(body);
    setCopied(name);
    setTimeout(() => setCopied((c) => (c === name ? null : c)), 1400);
  }

  function downloadFile(name: string, body: string) {
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name.split("/").pop() || name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const update = <K extends keyof DeployConfig>(key: K, value: DeployConfig[K]) =>
    setCfg((prev) => ({ ...prev, [key]: value }));

  const fileList = useMemo(() => Object.keys(preview?.files || {}), [preview]);
  const score = preview?.score?.total ?? 0;
  const scoreColor = score >= 85 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-rose-400";
  const scoreRing  = score >= 85 ? "stroke-emerald-400" : score >= 60 ? "stroke-amber-400" : "stroke-rose-400";

  const langForFile = (f: string): string => {
    if (f.endsWith(".sh"))      return "bash";
    if (f.endsWith(".yml") || f.endsWith(".yaml")) return "yaml";
    if (f.endsWith(".conf"))    return "nginx";
    if (f.endsWith(".service")) return "ini";
    if (f.endsWith(".md"))      return "markdown";
    if (f.endsWith(".template"))return "ini";
    return "text";
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500" data-testid="page-production">
      {/* Hero */}
      <header>
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest mb-3">
          <Rocket className="h-3 w-3" />
          Production Grade
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-2">
          Zebvix Production Deployment Workbench
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-3xl">
          Configure your topology, security posture, backups and alerting on the left — the workbench
          generates a hardened systemd unit, nginx + TLS reverse proxy, Prometheus + Alertmanager,
          optional WireGuard private subnet, and an idempotent installer on the right.
          Assumes the binary is already built via the {" "}
          <Link href="/quick-start"><span className="text-primary hover:underline cursor-pointer">Quick-Start</span></Link>{" "}
          or {" "}
          <Link href="/chain-builder"><span className="text-primary hover:underline cursor-pointer">Chain Builder</span></Link>.
        </p>
      </header>

      {/* Server specs (static reference) */}
      <section className="rounded-xl border border-border/60 bg-card/40 backdrop-blur p-5">
        <SectionTitle icon={ServerCog} num={1} title="Recommended server specs" />
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Component</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Validator node</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Public RPC node</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {SPECS.map((row) => (
                <tr key={row.component} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-semibold text-foreground/90">{row.component}</td>
                  <td className="px-4 py-2.5 text-foreground/80">{row.validator}</td>
                  <td className="px-4 py-2.5 text-foreground/80">{row.rpc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Hardening reference grid */}
      <section className="space-y-3">
        <SectionTitle icon={Shield} num={2} title="Security hardening reference" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {HARDEN_BLOCKS.map((b) => {
            const Icon = b.icon;
            return (
              <div key={b.title} className="rounded-xl border border-border/60 bg-card/40 p-4">
                <header className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground">{b.title}</h3>
                </header>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {b.items.map((x) => (
                    <li key={x} className="flex items-start gap-2">
                      <span className="mt-1 inline-block h-1 w-1 rounded-full bg-primary/70 shrink-0" />
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* Workbench */}
      <section className="space-y-3" data-testid="workbench">
        <SectionTitle icon={Sparkles} num={3} title="Production deployment workbench" />
        <p className="text-sm text-muted-foreground -mt-1">
          All fields validate live and stream into the bundle preview on the right. No secrets
          are stored — Slack webhook / PagerDuty key are only baked into the configs you download.
        </p>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-4">
          {/* ─── LEFT: configuration ──────────────────────────────────────── */}
          <div className="space-y-4">
            <ConfigCard icon={Globe} title="Identity & DNS">
              <Field label="Chain name (slug)" hint="lowercase a-z 0-9 -, 2-31 chars">
                <input
                  data-testid="input-chainName"
                  value={cfg.chainName}
                  onChange={(e) => update("chainName", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Public RPC domain" hint="must already point at the box's IPv4/IPv6">
                <input
                  data-testid="input-rpcDomain"
                  value={cfg.rpcDomain}
                  onChange={(e) => update("rpcDomain", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Admin email (Let's Encrypt)" icon={Mail}>
                <input
                  data-testid="input-adminEmail"
                  value={cfg.adminEmail}
                  onChange={(e) => update("adminEmail", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Region label" hint="free-form, used in Prometheus external_labels">
                <input
                  data-testid="input-region"
                  value={cfg.region}
                  onChange={(e) => update("region", e.target.value)}
                  className="input"
                />
              </Field>
            </ConfigCard>

            <ConfigCard icon={Network} title="Topology">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Validator nodes" hint="≥ 4 recommended">
                  <input
                    data-testid="input-validatorCount"
                    type="number" min={1} max={100}
                    value={cfg.validatorCount}
                    onChange={(e) => update("validatorCount", Number(e.target.value))}
                    className="input"
                  />
                </Field>
                <Field label="Public RPC nodes" hint="separate from validators, behind a load balancer">
                  <input
                    data-testid="input-publicRpcCount"
                    type="number" min={0} max={50}
                    value={cfg.publicRpcCount}
                    onChange={(e) => update("publicRpcCount", Number(e.target.value))}
                    className="input"
                  />
                </Field>
              </div>
            </ConfigCard>

            <ConfigCard icon={Hash} title="Ports & CORS">
              <div className="grid grid-cols-3 gap-3">
                <Field label="RPC port"><input data-testid="input-rpcPort" type="number" min={1} max={65535} value={cfg.rpcPort} onChange={(e) => update("rpcPort", Number(e.target.value))} className="input" /></Field>
                <Field label="P2P port"><input data-testid="input-p2pPort" type="number" min={1} max={65535} value={cfg.p2pPort} onChange={(e) => update("p2pPort", Number(e.target.value))} className="input" /></Field>
                <Field label="Metrics port"><input data-testid="input-metricsPort" type="number" min={1} max={65535} value={cfg.metricsPort} onChange={(e) => update("metricsPort", Number(e.target.value))} className="input" /></Field>
              </div>
              <Field label="CORS Allow-Origin" hint="* for fully public, or comma-list of explicit origins">
                <input data-testid="input-cors" value={cfg.corsOrigins} onChange={(e) => update("corsOrigins", e.target.value)} className="input" />
              </Field>
            </ConfigCard>

            <ConfigCard icon={Lock} title="Security posture">
              <Toggle
                label="HTTP basic-auth on /admin endpoint"
                hint="installer provisions htpasswd and prints credentials once"
                testId="toggle-admin-auth"
                checked={cfg.enableAdminAuth}
                onChange={(v) => update("enableAdminAuth", v)}
              />
              <Toggle
                label="ufw default-deny inbound"
                testId="toggle-ufw"
                checked={cfg.enableUfw}
                onChange={(v) => update("enableUfw", v)}
              />
              <Toggle
                label="fail2ban brute-force protection"
                testId="toggle-fail2ban"
                checked={cfg.enableFail2ban}
                onChange={(v) => update("enableFail2ban", v)}
              />
              <Toggle
                label="WireGuard validator P2P (private subnet)"
                hint="firewalls off the public P2P port — validators talk only over wg0"
                testId="toggle-wireguard"
                checked={cfg.enableWireguard}
                onChange={(v) => update("enableWireguard", v)}
              />
              {cfg.enableWireguard && (
                <Field label="WireGuard CIDR" hint="IPv4, /24 or larger">
                  <input data-testid="input-wgCidr" value={cfg.wireguardCidr} onChange={(e) => update("wireguardCidr", e.target.value)} className="input" />
                </Field>
              )}
              <Field label="Admin/wallet method blocklist (regex)" hint="alternation of method prefixes blocked at the edge">
                <input data-testid="input-blocklist" value={cfg.adminMethodBlocklist} onChange={(e) => update("adminMethodBlocklist", e.target.value)} className="input font-mono text-xs" />
              </Field>
            </ConfigCard>

            <ConfigCard icon={Database} title="Backups & disaster recovery">
              <Field label="Off-site destination">
                <select
                  data-testid="select-backupDest"
                  value={cfg.backupDest}
                  onChange={(e) => update("backupDest", e.target.value as BackupDest)}
                  className="input"
                >
                  <option value="none">None (not recommended)</option>
                  <option value="s3">AWS S3</option>
                  <option value="r2">Cloudflare R2</option>
                  <option value="local">Local NVMe / NAS</option>
                </select>
              </Field>
              {cfg.backupDest !== "none" && (
                <Field
                  label={cfg.backupDest === "local" ? "Absolute path" : "Bucket name"}
                  hint={cfg.backupDest === "local" ? "e.g. /mnt/backup-zebvix" : "3-63 chars, lowercase"}
                >
                  <input data-testid="input-backupBucket" value={cfg.backupBucket} onChange={(e) => update("backupBucket", e.target.value)} className="input" />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Retention days"><input data-testid="input-retention" type="number" min={1} max={3650} value={cfg.backupRetentionDays} onChange={(e) => update("backupRetentionDays", Number(e.target.value))} className="input" /></Field>
                <Toggle
                  label="Hourly snapshot"
                  hint="rsync to sibling NVMe"
                  testId="toggle-hourly"
                  checked={cfg.enableHourlySnapshot}
                  onChange={(v) => update("enableHourlySnapshot", v)}
                  compact
                />
              </div>
            </ConfigCard>

            <ConfigCard icon={Bell} title="Monitoring & alerts">
              <Field label="Slack incoming webhook" hint="https://hooks.slack.com/services/… — leave blank if unused">
                <input
                  data-testid="input-slack"
                  value={cfg.alertSlackWebhook}
                  onChange={(e) => update("alertSlackWebhook", e.target.value)}
                  className="input font-mono text-xs"
                  placeholder="https://hooks.slack.com/services/…"
                />
              </Field>
              <Field label="PagerDuty integration key" hint="20-64 chars; routes critical alerts only">
                <input
                  data-testid="input-pagerduty"
                  value={cfg.alertPagerdutyKey}
                  onChange={(e) => update("alertPagerdutyKey", e.target.value)}
                  className="input font-mono text-xs"
                  placeholder="optional"
                />
              </Field>
              <Field label="On-call email" icon={Mail}>
                <input
                  data-testid="input-alertEmail"
                  value={cfg.alertEmail}
                  onChange={(e) => update("alertEmail", e.target.value)}
                  className="input"
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Min peers"><input data-testid="input-peerMin" type="number" min={1} max={1000} value={cfg.thresholdPeerMin} onChange={(e) => update("thresholdPeerMin", Number(e.target.value))} className="input" /></Field>
                <Field label="Sync lag (s)"><input data-testid="input-syncLag" type="number" min={1} max={86400} value={cfg.thresholdSyncLagSec} onChange={(e) => update("thresholdSyncLagSec", Number(e.target.value))} className="input" /></Field>
                <Field label="Disk pct alarm"><input data-testid="input-diskPct" type="number" min={50} max={99} value={cfg.thresholdDiskPct} onChange={(e) => update("thresholdDiskPct", Number(e.target.value))} className="input" /></Field>
              </div>
            </ConfigCard>
          </div>

          {/* ─── RIGHT: live readiness, cost, summary ─────────────────────── */}
          <aside className="space-y-4 xl:sticky xl:top-4 self-start">
            <div className="rounded-xl border border-border/60 bg-card/40 p-5" data-testid="readiness-card">
              <header className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Gauge className="h-3.5 w-3.5" /> Production readiness
                </h3>
                {previewing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </header>
              <div className="flex items-center gap-5">
                <ScoreGauge score={score} colorClass={scoreColor} ringClass={scoreRing} />
                <div className="space-y-1.5 flex-1 min-w-0">
                  {(preview?.score?.items || []).slice(0, 6).map((it) => (
                    <div key={it.key} className="flex items-center gap-2 text-xs">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${it.got === it.weight ? "bg-emerald-400" : it.got > 0 ? "bg-amber-400" : "bg-rose-400"}`} />
                      <span className="text-foreground/80 truncate">{it.label}</span>
                      <span className="ml-auto text-muted-foreground tabular-nums">{it.got}/{it.weight}</span>
                    </div>
                  ))}
                </div>
              </div>
              {preview?.score?.items && preview.score.items.length > 6 && (
                <details className="mt-3" data-testid="readiness-more">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">
                    Show all {preview.score.items.length} criteria
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {preview.score.items.slice(6).map((it) => (
                      <div key={it.key} className="flex items-center gap-2 text-xs">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${it.got === it.weight ? "bg-emerald-400" : it.got > 0 ? "bg-amber-400" : "bg-rose-400"}`} />
                        <span className="text-foreground/80 truncate">{it.label}</span>
                        <span className="ml-auto text-muted-foreground tabular-nums">{it.got}/{it.weight}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>

            <div className="rounded-xl border border-border/60 bg-card/40 p-5" data-testid="cost-card">
              <header className="flex items-center gap-2 mb-3">
                <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Estimated monthly cost</h3>
              </header>
              <div className="text-3xl font-bold text-foreground tabular-nums">
                {preview ? `$${preview.cost.total.toLocaleString()}` : "—"}
                <span className="text-xs font-normal text-muted-foreground ml-1.5">USD/mo</span>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {(preview?.cost?.breakdown || []).map((b) => (
                  <li key={b.item} className="flex justify-between">
                    <span className="truncate pr-2">{b.item}</span>
                    <span className="tabular-nums shrink-0">${b.usd.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[10px] text-muted-foreground/70 leading-relaxed">
                Reference prices: bare-metal validator $280/mo, RPC $140/mo, S3 $25/mo, R2 $15/mo,
                Prometheus stack $20/mo. Your provider may differ.
              </p>
            </div>

            <div className="rounded-xl border border-border/60 bg-card/40 p-5">
              <header className="flex items-center gap-2 mb-3">
                <FileCode className="h-3.5 w-3.5 text-primary" />
                <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Bundle summary</h3>
              </header>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <dt className="text-muted-foreground">Files</dt>
                <dd className="text-right font-semibold text-foreground tabular-nums">{preview?.summary.fileCount ?? "—"}</dd>
                <dt className="text-muted-foreground">Total size</dt>
                <dd className="text-right font-semibold text-foreground tabular-nums">
                  {preview ? `${(preview.summary.totalBytes / 1024).toFixed(1)} KB` : "—"}
                </dd>
                <dt className="text-muted-foreground">install hash</dt>
                <dd className="text-right font-mono text-[10px] text-foreground/80 truncate" title={preview?.summary.installHash}>
                  {preview ? preview.summary.installHash.slice(0, 12) + "…" : "—"}
                </dd>
              </dl>
              <button
                onClick={downloadBundle}
                disabled={generating || !!previewError || !preview}
                data-testid="button-download-bundle"
                className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground font-semibold text-sm py-2.5 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {generating ? "Packaging…" : `Download ${cfg.chainName}-prod.tar.gz`}
              </button>
              {previewError && (
                <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 flex items-start gap-2" data-testid="preview-error">
                  <Bug className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="break-words">{previewError}</span>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>

      {/* File preview */}
      {preview && fileList.length > 0 && (
        <section className="space-y-3" data-testid="file-preview">
          <SectionTitle icon={FileCode} num={4} title="Live bundle preview" />
          <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
            <div className="flex flex-wrap gap-1 border-b border-border/40 bg-muted/20 px-2 py-2">
              {fileList.map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveFile(f)}
                  data-testid={`tab-file-${f.replace(/[^a-zA-Z0-9]/g, "-")}`}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                    activeFile === f
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-background/40">
              <span className="text-xs font-mono text-muted-foreground">{activeFile}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => copyFile(activeFile, preview.files[activeFile] || "")}
                  data-testid="button-copy-file"
                  className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  {copied === activeFile ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copied === activeFile ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={() => downloadFile(activeFile, preview.files[activeFile] || "")}
                  data-testid="button-download-file"
                  className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  <Download className="h-3 w-3" /> File
                </button>
              </div>
            </div>
            <div className="max-h-[520px] overflow-auto">
              <CodeBlock language={langForFile(activeFile)} code={preview.files[activeFile] || ""} />
            </div>
          </div>
        </section>
      )}

      {/* Snapshots & DR cards */}
      <section className="space-y-3">
        <SectionTitle icon={Database} num={5} title="Snapshots & disaster recovery" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { icon: HardDrive, t: "Hourly DB snapshot", d: "rsync /var/lib/<chain>/ to a sibling NVMe — keep 24 rolling." },
            { icon: Database,  t: "Daily off-site",     d: "restic-encrypted snapshot to S3 / R2 with N-day retention." },
            { icon: AlertTriangle, t: "Restore drill",  d: "Cold-restore on a spare box every quarter; document RTO." },
          ].map((x) => {
            const Icon = x.icon;
            return (
              <div key={x.t} className="rounded-xl border border-border/60 bg-card/40 p-4">
                <Icon className="h-4 w-4 text-primary mb-2" />
                <div className="text-sm font-semibold text-foreground">{x.t}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{x.d}</div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          The workbench installer wires <code className="text-[10px] bg-muted px-1 rounded">/etc/cron.d/&lt;chain&gt;-backup</code> when an off-site destination is selected above.
        </p>
      </section>

      {/* Pre-launch checklist */}
      <section className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 p-5">
        <header className="flex items-center gap-2 mb-4">
          <Bell className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-300">
            Pre-launch checklist
          </h2>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          {[
            "Validator keys generated on air-gapped machine + cold-backed-up",
            "≥ 4 validators online from independent providers",
            "TLS-terminated RPC behind rate limit + admin method block",
            "Prometheus scraping; alerts wired to on-call",
            "Hourly DB snapshot + daily off-site backup tested",
            "Restore drill executed within last 90 days",
            "DNS, status page, and incident-comms channel ready",
            "Runbook for stuck-chain / fork / DDoS scenarios written",
          ].map((c) => (
            <div key={c} className="flex items-start gap-2 rounded-md border border-emerald-500/15 bg-background/40 px-3 py-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-foreground/85">{c}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-end">
          <Link href="/checklist">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer">
              Open full launch checklist
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        </div>
      </section>

      <style>{`
        .input {
          width: 100%;
          background: hsl(var(--background) / 0.6);
          border: 1px solid hsl(var(--border) / 0.6);
          border-radius: 0.375rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.8125rem;
          color: hsl(var(--foreground));
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .input:focus {
          outline: none;
          border-color: hsl(var(--primary) / 0.6);
          box-shadow: 0 0 0 3px hsl(var(--primary) / 0.15);
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SectionTitle({
  icon: Icon, num, title,
}: { icon: React.ElementType; num: number; title: string }) {
  return (
    <h2 className="flex items-center gap-3 text-lg font-semibold text-foreground mb-3">
      <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary/10 border border-primary/30 text-primary text-xs font-bold">
        {num}
      </span>
      <Icon className="h-4 w-4 text-primary/80" />
      <span>{title}</span>
    </h2>
  );
}

function ConfigCard({
  icon: Icon, title, children,
}: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-3">
      <header className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </header>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label, hint, icon: Icon, children,
}: { label: string; hint?: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
        <span className="text-xs font-medium text-foreground/85">{label}</span>
      </div>
      {children}
      {hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
    </label>
  );
}

function Toggle({
  label, hint, checked, onChange, testId, compact,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; testId?: string; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={`w-full flex items-start gap-3 rounded-md border px-3 ${compact ? "py-2" : "py-2.5"} text-left transition-colors ${
        checked
          ? "border-primary/40 bg-primary/5"
          : "border-border/60 bg-background/40 hover:bg-muted/30"
      }`}
    >
      <span
        className={`mt-0.5 inline-flex h-4 w-7 rounded-full transition-colors shrink-0 ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-background border border-border/60 shadow-sm transition-transform ${
            checked ? "translate-x-3" : "translate-x-0"
          }`}
        />
      </span>
      <span className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </span>
    </button>
  );
}

function ScoreGauge({ score, colorClass, ringClass }: { score: number; colorClass: string; ringClass: string }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <div className="relative h-24 w-24 shrink-0" data-testid="score-gauge">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} className="fill-none stroke-border/40" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={r}
          className={`fill-none ${ringClass} transition-all duration-500`}
          strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={`text-2xl font-bold tabular-nums ${colorClass}`}>{score}</div>
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground">/ 100</div>
      </div>
    </div>
  );
}
