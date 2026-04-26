import React from "react";
import { Link } from "wouter";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Rocket, Shield, Activity, HardDrive, Cpu, Wifi, KeyRound,
  ServerCog, AlertTriangle, ChevronRight, Database, Bell, BarChart3,
  Lock, Zap,
} from "lucide-react";

const SPECS = [
  { component: "CPU",        validator: "32+ cores (AMD EPYC / Intel Xeon)", rpc: "16+ cores" },
  { component: "RAM",        validator: "128 GB DDR5 ECC",                   rpc: "64 GB" },
  { component: "Storage",    validator: "4 TB NVMe SSD (RAID 1)",            rpc: "2 TB NVMe SSD" },
  { component: "Network",    validator: "1 Gbps dedicated",                  rpc: "1 Gbps dedicated" },
  { component: "OS",         validator: "Ubuntu 22.04 LTS",                  rpc: "Ubuntu 22.04 LTS" },
  { component: "Filesystem", validator: "ext4 / xfs (avoid btrfs/zfs CoW)", rpc: "ext4 / xfs" },
];

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
      "Validator P2P inside a private subnet or VPN.",
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

export default function Production() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <header>
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest mb-3">
          <Rocket className="h-3 w-3" />
          Production Grade
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-2">
          Zebvix Production Deployment
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-3xl">
          Bring a Zebvix node online with the security, monitoring, and resiliency that mainnet traffic demands. This guide assumes you've already built the binary via the {" "}
          <Link href="/quick-start"><span className="text-primary hover:underline cursor-pointer">Quick-Start script</span></Link>.
        </p>
      </header>

      {/* Server specs */}
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

      {/* Hardening grid */}
      <section className="space-y-3">
        <SectionTitle icon={Shield} num={2} title="Security hardening" />
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

      {/* systemd unit */}
      <section className="space-y-3">
        <SectionTitle icon={Zap} num={3} title="Production systemd unit" />
        <p className="text-sm text-muted-foreground">
          Replace the dev-grade unit installed by the Quick-Start script with this hardened version.
          It pins the binary to a non-login service user, locks the working dir, sets file-descriptor
          limits high enough for a busy mainnet RPC, and ships logs to journald.
        </p>
        <CodeBlock language="bash" code={`# /etc/systemd/system/zebvix.service
[Unit]
Description=Zebvix L1 Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=zebvix
Group=zebvix
WorkingDirectory=/var/zebvix
ExecStart=/usr/local/bin/zebvix-node \\
  --data-dir   /var/zebvix/db \\
  --rpc-bind   127.0.0.1:8545 \\
  --p2p-bind   0.0.0.0:30303 \\
  --metrics    127.0.0.1:9100
Restart=always
RestartSec=5
LimitNOFILE=1048576
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/zebvix
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zebvix

[Install]
WantedBy=multi-user.target

# Apply:
sudo systemctl daemon-reload
sudo systemctl enable --now zebvix.service`} />
      </section>

      {/* Reverse proxy */}
      <section className="space-y-3">
        <SectionTitle icon={Lock} num={4} title="Public RPC behind nginx + TLS" />
        <p className="text-sm text-muted-foreground">
          The systemd unit above binds JSON-RPC to <code className="text-xs bg-muted px-1 rounded">127.0.0.1</code> only.
          Front it with nginx for TLS termination, request-rate limiting, and method allow-listing.
        </p>
        <CodeBlock language="nginx" code={`# /etc/nginx/sites-available/rpc.zebvix.io
limit_req_zone $binary_remote_addr zone=rpc:10m rate=20r/s;

server {
  listen 443 ssl http2;
  server_name rpc.zebvix.io;

  ssl_certificate     /etc/letsencrypt/live/rpc.zebvix.io/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/rpc.zebvix.io/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;

  client_max_body_size 1m;

  location / {
    limit_req zone=rpc burst=40 nodelay;
    proxy_pass http://127.0.0.1:8545;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    add_header Access-Control-Allow-Origin *;
  }

  # Block admin / wallet methods at the edge — only public read methods allowed.
  location ~* (admin_|personal_|miner_) {
    return 403;
  }
}`} />
      </section>

      {/* Backups */}
      <section className="space-y-3">
        <SectionTitle icon={Database} num={5} title="Snapshots & disaster recovery" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { icon: HardDrive, t: "Hourly DB snapshot", d: "rsync /var/zebvix/db to a sibling NVMe — keep 24 rolling." },
            { icon: Database,  t: "Daily off-site",     d: "Encrypted tarball to S3 / R2 with 30-day retention." },
            { icon: AlertTriangle, t: "Restore drill",   d: "Cold-restore on a spare box every quarter; document RTO." },
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
      </section>

      {/* Monitoring */}
      <section className="space-y-3">
        <SectionTitle icon={Activity} num={6} title="Monitoring stack" />
        <p className="text-sm text-muted-foreground">
          Prometheus scrapes <code className="text-xs bg-muted px-1 rounded">127.0.0.1:9100/metrics</code> exposed by the node;
          Grafana dashboards visualise consensus health, RPC throughput, and disk usage.
        </p>
        <CodeBlock language="yaml" code={`# /etc/prometheus/prometheus.yml — scrape config
scrape_configs:
  - job_name: zebvix
    scrape_interval: 15s
    static_configs:
      - targets: ['127.0.0.1:9100']
        labels:
          chain: zebvix-mainnet
          node:  validator-01

# Critical alerts (Alertmanager rules):
#   - chain head not advancing for > 30s
#   - peer count < 3
#   - disk usage > 80%
#   - process restarted > 3 times / hour
#   - RPC error rate > 5% over 5m`} />
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
    </div>
  );
}

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
