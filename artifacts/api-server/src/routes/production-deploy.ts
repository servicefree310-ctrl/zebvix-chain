import { Router } from "express";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const productionDeployRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Production Deployment Workbench API
//
// Generates a production-grade deployment bundle for a Zebvix node:
//   <chain>-prod/
//     install-production.sh        orchestrator (idempotent, set -euo pipefail)
//     systemd/zebvix.service       hardened systemd unit
//     nginx/<chain>-rpc.conf       TLS reverse proxy with rate limit + admin block
//     prometheus/prometheus.yml    scrape config
//     prometheus/rules/alerts.yml  alerting rules
//     alertmanager/alertmanager.yml routing to Slack / PagerDuty / email
//     wireguard/wg0.conf.template  validator P2P private subnet (optional)
//     backup/backup.sh + restore.sh idempotent rsync + restic to S3/R2/local (optional)
//     healthcheck.sh               eth_chainId / peer / sync probes
//     runbook.md                   ops runbook with real values
//     README.md                    architecture, file map, ops commands
//
// Server also returns a Production Readiness Score (0-100) and a USD/month
// cost estimate based on validator/RPC topology.
// ─────────────────────────────────────────────────────────────────────────────

type BackupDest = "none" | "s3" | "r2" | "local";

interface DeployConfig {
  // identity
  chainName: string;
  rpcDomain: string;
  adminEmail: string;
  // topology
  validatorCount: number;
  publicRpcCount: number;
  region: string;
  // network
  rpcPort: number;
  p2pPort: number;
  metricsPort: number;
  corsOrigins: string;
  // security
  enableAdminAuth: boolean;   // adds HTTP basic auth (htpasswd) on /admin in nginx
  enableFail2ban: boolean;
  enableUfw: boolean;
  enableWireguard: boolean;
  wireguardCidr: string;
  adminMethodBlocklist: string;
  // backups
  backupDest: BackupDest;
  backupBucket: string;
  backupRetentionDays: number;
  enableHourlySnapshot: boolean;
  // monitoring & alerts
  alertSlackWebhook: string;
  alertPagerdutyKey: string;
  alertEmail: string;
  thresholdPeerMin: number;
  thresholdSyncLagSec: number;
  thresholdDiskPct: number;
}

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CIDR_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\/(?:[0-9]|[12]\d|3[0-2])$/;
const SLACK_RE = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_\-/]{20,}$/;
const REGION_RE = /^[a-z0-9][a-z0-9\-]{0,39}$/i;
// CORS: either a literal "*" or a comma-separated list of http(s) origins.
const CORS_ORIGIN_RE = /^https:\/\/[a-z0-9.\-]{1,253}(?::\d{1,5})?$/i;

function intInRange(v: any, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function validate(cfg: any): { ok: true; value: DeployConfig } | { ok: false; error: string } {
  if (!cfg || typeof cfg !== "object") return { ok: false, error: "body must be a JSON object" };

  const chainName = String(cfg.chainName || "").toLowerCase().trim();
  if (!SLUG_RE.test(chainName))
    return { ok: false, error: "chainName: must be 2-31 chars, lowercase a-z 0-9 -, starting with a letter" };

  const rpcDomain = String(cfg.rpcDomain || "").toLowerCase().trim();
  if (!DOMAIN_RE.test(rpcDomain))
    return { ok: false, error: "rpcDomain: must be a fully-qualified DNS name (e.g. rpc.example.io)" };

  const adminEmail = String(cfg.adminEmail || "").trim();
  if (!EMAIL_RE.test(adminEmail))
    return { ok: false, error: "adminEmail: must be a valid email (used for Let's Encrypt registration)" };

  const validatorCount = intInRange(cfg.validatorCount, 1, 100);
  if (validatorCount === null) return { ok: false, error: "validatorCount: integer 1..100" };

  const publicRpcCount = intInRange(cfg.publicRpcCount, 0, 50);
  if (publicRpcCount === null) return { ok: false, error: "publicRpcCount: integer 0..50" };

  const region = String(cfg.region || "").trim().slice(0, 40);
  if (region && !REGION_RE.test(region))
    return { ok: false, error: "region: only [a-z0-9-] allowed (e.g. us-east-1, eu, ap-south-1)" };

  const rpcPort = intInRange(cfg.rpcPort, 1, 65535);
  if (rpcPort === null) return { ok: false, error: "rpcPort: integer 1..65535" };
  const p2pPort = intInRange(cfg.p2pPort, 1, 65535);
  if (p2pPort === null) return { ok: false, error: "p2pPort: integer 1..65535" };
  const metricsPort = intInRange(cfg.metricsPort, 1, 65535);
  if (metricsPort === null) return { ok: false, error: "metricsPort: integer 1..65535" };
  if (new Set([rpcPort, p2pPort, metricsPort]).size !== 3)
    return { ok: false, error: "rpcPort / p2pPort / metricsPort must all differ" };

  // CORS: "*" or a single http(s) origin. (CORS spec only allows one Origin
  // value per response; for multi-origin support the operator should add a
  // nginx `map $http_origin` block manually after install.)
  const corsRaw = String(cfg.corsOrigins || "*").trim().slice(0, 253);
  let corsOrigins: string;
  if (corsRaw === "*") {
    corsOrigins = "*";
  } else if (CORS_ORIGIN_RE.test(corsRaw)) {
    corsOrigins = corsRaw;
  } else {
    return { ok: false, error: "corsOrigins: must be '*' or a single HTTPS origin like https://app.example.io (http:// is not allowed for production)" };
  }

  const enableAdminAuth  = Boolean(cfg.enableAdminAuth ?? cfg.enableJwtAdmin);
  const enableFail2ban   = Boolean(cfg.enableFail2ban);
  const enableUfw        = Boolean(cfg.enableUfw);
  const enableWireguard  = Boolean(cfg.enableWireguard);

  let wireguardCidr = String(cfg.wireguardCidr || "10.42.0.0/24").trim();
  if (enableWireguard && !CIDR_RE.test(wireguardCidr))
    return { ok: false, error: "wireguardCidr: must be IPv4 CIDR (e.g. 10.42.0.0/24)" };

  const adminMethodBlocklist = String(cfg.adminMethodBlocklist || "admin_|personal_|miner_|debug_|txpool_").trim().slice(0, 200);
  if (!/^[A-Za-z0-9_|]+$/.test(adminMethodBlocklist))
    return { ok: false, error: "adminMethodBlocklist: only [A-Za-z0-9_|] allowed (regex alternation of method prefixes)" };

  const backupDest = (["none", "s3", "r2", "local"] as const).includes(cfg.backupDest)
    ? (cfg.backupDest as BackupDest)
    : "none";
  const backupBucket = String(cfg.backupBucket || "").trim().slice(0, 200);
  if (backupDest === "s3" || backupDest === "r2") {
    if (!/^[a-z0-9.\-]{3,63}$/.test(backupBucket))
      return { ok: false, error: "backupBucket: 3..63 chars, lowercase a-z 0-9 . - (required for s3/r2)" };
  }
  if (backupDest === "local" && backupBucket && !backupBucket.startsWith("/"))
    return { ok: false, error: "backupBucket (local): must be an absolute path starting with /" };

  const backupRetentionDays = intInRange(cfg.backupRetentionDays, 1, 3650);
  if (backupRetentionDays === null) return { ok: false, error: "backupRetentionDays: integer 1..3650" };

  const enableHourlySnapshot = Boolean(cfg.enableHourlySnapshot);

  const alertSlackWebhook = String(cfg.alertSlackWebhook || "").trim();
  if (alertSlackWebhook && !SLACK_RE.test(alertSlackWebhook))
    return { ok: false, error: "alertSlackWebhook: must be a https://hooks.slack.com/services/... URL or blank" };

  const alertPagerdutyKey = String(cfg.alertPagerdutyKey || "").trim();
  if (alertPagerdutyKey && !/^[a-zA-Z0-9_-]{20,64}$/.test(alertPagerdutyKey))
    return { ok: false, error: "alertPagerdutyKey: must be 20-64 chars [A-Za-z0-9_-] or blank" };

  const alertEmail = String(cfg.alertEmail || "").trim();
  if (alertEmail && !EMAIL_RE.test(alertEmail))
    return { ok: false, error: "alertEmail: must be a valid email or blank" };

  const thresholdPeerMin = intInRange(cfg.thresholdPeerMin, 1, 1000);
  if (thresholdPeerMin === null) return { ok: false, error: "thresholdPeerMin: integer 1..1000" };
  const thresholdSyncLagSec = intInRange(cfg.thresholdSyncLagSec, 1, 86400);
  if (thresholdSyncLagSec === null) return { ok: false, error: "thresholdSyncLagSec: integer 1..86400" };
  const thresholdDiskPct = intInRange(cfg.thresholdDiskPct, 50, 99);
  if (thresholdDiskPct === null) return { ok: false, error: "thresholdDiskPct: integer 50..99" };

  return {
    ok: true,
    value: {
      chainName, rpcDomain, adminEmail,
      validatorCount, publicRpcCount, region,
      rpcPort, p2pPort, metricsPort, corsOrigins,
      enableAdminAuth, enableFail2ban, enableUfw, enableWireguard, wireguardCidr,
      adminMethodBlocklist,
      backupDest, backupBucket, backupRetentionDays, enableHourlySnapshot,
      alertSlackWebhook, alertPagerdutyKey, alertEmail,
      thresholdPeerMin, thresholdSyncLagSec, thresholdDiskPct,
    },
  };
}

function escSh(s: string | number): string {
  return "'" + String(s).replace(/'/g, "'\\''").replace(/\x00/g, "") + "'";
}

// Double-quoted YAML string. Escapes backslashes, quotes, and control chars.
// Safe for any input that survives upstream validation.
function yamlStr(s: string): string {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\x00/g, "") + '"';
}

// ─────────────────────────────────────────────────────────────────────────────
// Readiness scoring (0-100). Each item carries a weight; missing items lose
// their weight proportionally. Returned to the client so the UI can render a
// gauge that updates live as the operator fills in fields.
// ─────────────────────────────────────────────────────────────────────────────

interface ScoreItem { key: string; label: string; weight: number; got: number }

function computeScore(c: DeployConfig): { total: number; items: ScoreItem[] } {
  const items: ScoreItem[] = [];

  const push = (key: string, label: string, weight: number, ok: boolean | number) => {
    const got = typeof ok === "boolean" ? (ok ? weight : 0) : Math.max(0, Math.min(weight, ok));
    items.push({ key, label, weight, got });
  };

  push("domain",     "TLS-protected domain (Let's Encrypt)", 8, !!c.rpcDomain && !!c.adminEmail);
  push("validators", "Decentralisation: ≥4 validators",      14, Math.min(14, Math.round((c.validatorCount / 4) * 14)));
  push("publicRpc",  "Dedicated public RPC node(s)",          6, c.publicRpcCount > 0);
  push("adminAuth",  "HTTP basic-auth on /admin endpoint",     8, c.enableAdminAuth);
  push("ufw",        "ufw default-deny inbound firewall",     5, c.enableUfw);
  push("fail2ban",   "fail2ban brute-force protection",       4, c.enableFail2ban);
  push("wireguard",  "Validator P2P over WireGuard private subnet", 10, c.enableWireguard);
  push("blocklist",  "nginx admin/wallet method blocklist",   4, !!c.adminMethodBlocklist);
  push("backupDest", "Off-site backup destination configured", 10, c.backupDest !== "none");
  push("backupHourly","Hourly DB snapshot enabled",           5, c.enableHourlySnapshot);
  push("backupRetention", "Backup retention ≥ 30 days",       4, c.backupRetentionDays >= 30);
  const monitoringChannels = (c.alertSlackWebhook ? 1 : 0) + (c.alertPagerdutyKey ? 1 : 0) + (c.alertEmail ? 1 : 0);
  push("alertChannel", "Alert channel wired (Slack / PagerDuty / email)", 12, monitoringChannels >= 1);
  push("alertRedundant", "Two independent alert channels for redundancy",  5, monitoringChannels >= 2);
  push("thresholds", "Sensible alert thresholds (peers/sync/disk)",        5, c.thresholdPeerMin >= 3 && c.thresholdSyncLagSec <= 60 && c.thresholdDiskPct <= 85);

  const total = items.reduce((s, i) => s + i.got, 0);
  return { total, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost estimator (USD/month). Conservative bare-metal/cloud reference prices.
// ─────────────────────────────────────────────────────────────────────────────

function estimateMonthlyCostUsd(c: DeployConfig): { total: number; breakdown: { item: string; usd: number }[] } {
  const breakdown: { item: string; usd: number }[] = [];
  const validatorUsd = 280; // 32-core / 128 GB / 4 TB NVMe — bare-metal reference
  const rpcUsd = 140;       // 16-core / 64 GB / 2 TB NVMe
  const backupUsd = c.backupDest === "s3" ? 25 : c.backupDest === "r2" ? 15 : 0;
  const wgUsd = c.enableWireguard ? 5 : 0; // tiny VPN concentrator
  const monitoringUsd = 20;

  if (c.validatorCount > 0) breakdown.push({ item: `${c.validatorCount} × validator node`, usd: validatorUsd * c.validatorCount });
  if (c.publicRpcCount > 0) breakdown.push({ item: `${c.publicRpcCount} × public RPC node`, usd: rpcUsd * c.publicRpcCount });
  if (backupUsd > 0)        breakdown.push({ item: `Off-site backup (${c.backupDest.toUpperCase()})`, usd: backupUsd });
  if (wgUsd > 0)            breakdown.push({ item: "WireGuard concentrator", usd: wgUsd });
  breakdown.push({ item: "Prometheus + Grafana + Alertmanager", usd: monitoringUsd });

  const total = breakdown.reduce((s, b) => s + b.usd, 0);
  return { total, breakdown };
}

// ─────────────────────────────────────────────────────────────────────────────
// File generators
// ─────────────────────────────────────────────────────────────────────────────

function genSystemdUnit(c: DeployConfig): string {
  return `# /etc/systemd/system/${c.chainName}-node.service
# Generated by Zebvix Production Deployment Workbench
# Service name matches the chain-builder bundle convention: <chain>-node.service
[Unit]
Description=${c.chainName} Zebvix L1 node (production)
Documentation=https://github.com/zebvix
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${c.chainName}
Group=${c.chainName}
WorkingDirectory=/var/lib/${c.chainName}
Environment=RUST_LOG=info
Environment=RUST_BACKTRACE=1
ExecStart=/usr/local/bin/${c.chainName}-node start \\
  --home    /var/lib/${c.chainName} \\
  --rpc     127.0.0.1:${c.rpcPort} \\
  --p2p-port ${c.p2pPort} \\
  --metrics 127.0.0.1:${c.metricsPort}
Restart=always
RestartSec=5
StartLimitInterval=300
StartLimitBurst=10

# ── resource limits ────────────────────────────────────────────────────────
LimitNOFILE=1048576
LimitNPROC=65535

# ── sandboxing (systemd-analyze security ${c.chainName}-node.service) ──────────
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
ProtectProc=invisible
ProcSubset=pid
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources
ReadWritePaths=/var/lib/${c.chainName} /var/log/${c.chainName}

# ── logs ──────────────────────────────────────────────────────────────────
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${c.chainName}

[Install]
WantedBy=multi-user.target
`;
}

function genNginxConf(c: DeployConfig): string {
  // WebSocket location: same hardening as the public /, since JSON-RPC over WS
  // is fully equivalent to JSON-RPC over HTTP for the upstream node.
  // Without this, a client could `ws://.../ws` -> {"method":"admin_..."} and
  // bypass the public-HTTP method blocklist entirely.
  const wsBlock = `
  # WebSocket upgrade for eth_subscribe et al.
  # IMPORTANT: applies the SAME admin/wallet/debug method blocklist as
  # location / — otherwise WS becomes an authz-bypass for those methods.
  location /ws {
    if ($request_body ~* "\\"method\\"\\s*:\\s*\\"(${c.adminMethodBlocklist})") {
      return 403 "${c.chainName}-rpc: admin/wallet methods are not permitted on the public WS endpoint";
    }
    limit_req zone=${c.chainName}_rpc burst=80 nodelay;
    proxy_pass http://127.0.0.1:${c.rpcPort};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }
`;
  // Admin endpoint gated by HTTP basic auth (htpasswd). Stock nginx ships with
  // auth_basic out of the box (unlike auth_jwt which needs nginx-plus or a
  // third-party module). install-production.sh provisions the htpasswd file
  // and prints the one-time generated password.
  const adminAuthBlock = c.enableAdminAuth ? `
  # ── Admin namespace, basic-auth-gated ──────────────────────────────────
  # Provisioned by install-production.sh — prints the password once.
  # Rotate with:  sudo htpasswd -B /etc/nginx/htpasswd/${c.chainName}.htpasswd admin
  location /admin {
    auth_basic           "${c.chainName} admin";
    auth_basic_user_file /etc/nginx/htpasswd/${c.chainName}.htpasswd;
    proxy_pass http://127.0.0.1:${c.rpcPort};
    proxy_set_header Host $host;
  }
` : "";
  return `# /etc/nginx/sites-available/${c.chainName}-rpc.conf
# Generated by Zebvix Production Deployment Workbench
# Symlink to sites-enabled and reload:
#   sudo ln -s /etc/nginx/sites-available/${c.chainName}-rpc.conf /etc/nginx/sites-enabled/
#   sudo nginx -t && sudo systemctl reload nginx

limit_req_zone $binary_remote_addr zone=${c.chainName}_rpc:20m rate=50r/s;
limit_conn_zone $binary_remote_addr zone=${c.chainName}_conn:10m;

# HTTP → HTTPS redirect
server {
  listen 80;
  listen [::]:80;
  server_name ${c.rpcDomain};
  location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
  location / { return 301 https://$host$request_uri; }
}

server {
  listen      443 ssl http2;
  listen [::]:443 ssl http2;
  server_name ${c.rpcDomain};

  # ── TLS (Let's Encrypt — provisioned by install-production.sh) ──────────
  ssl_certificate     /etc/letsencrypt/live/${c.rpcDomain}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${c.rpcDomain}/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_ciphers         ECDHE+AESGCM:ECDHE+CHACHA20:!aNULL:!MD5:!DSS;
  ssl_prefer_server_ciphers on;
  ssl_session_cache   shared:SSL:10m;
  ssl_session_timeout 1d;
  ssl_stapling        on;
  ssl_stapling_verify on;

  # ── Security headers ────────────────────────────────────────────────────
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options    "nosniff" always;
  add_header X-Frame-Options           "DENY" always;
  add_header Referrer-Policy           "no-referrer" always;
  add_header Access-Control-Allow-Origin  "${c.corsOrigins}" always;
  add_header Access-Control-Allow-Methods "POST, OPTIONS" always;
  add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;

  client_max_body_size 1m;
  client_body_timeout  10s;
  send_timeout         30s;

${adminAuthBlock}
  # ── Public JSON-RPC ────────────────────────────────────────────────────
  # Admin/wallet/debug methods are blocked HERE only — the basic-auth-gated
  # /admin location below intentionally bypasses this so operators can still
  # call those methods after authenticating.
  location / {
    if ($request_method = OPTIONS) { return 204; }
    if ($request_body ~* "\\"method\\"\\s*:\\s*\\"(${c.adminMethodBlocklist})") {
      return 403 "${c.chainName}-rpc: admin/wallet methods are not permitted on the public endpoint";
    }
    limit_req  zone=${c.chainName}_rpc burst=120 nodelay;
    limit_conn ${c.chainName}_conn 64;
    proxy_pass http://127.0.0.1:${c.rpcPort};
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 30s;
    proxy_connect_timeout 5s;
  }
${wsBlock}
  # ── Health probe (open, cheap) ─────────────────────────────────────────
  location = /healthz {
    access_log off;
    proxy_pass http://127.0.0.1:${c.rpcPort};
    proxy_set_header Content-Type application/json;
    proxy_method POST;
    proxy_set_body '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}';
  }
}
`;
}

function genPrometheusYml(c: DeployConfig): string {
  const validatorTargets = Array.from({ length: c.validatorCount }, (_, i) =>
    `        - 'validator-${String(i + 1).padStart(2, "0")}.${c.rpcDomain.split(".").slice(1).join(".")}:${c.metricsPort}'`,
  ).join("\n");
  const rpcTargets = c.publicRpcCount > 0
    ? Array.from({ length: c.publicRpcCount }, (_, i) =>
        `        - 'rpc-${String(i + 1).padStart(2, "0")}.${c.rpcDomain.split(".").slice(1).join(".")}:${c.metricsPort}'`,
      ).join("\n")
    : "        # (no public RPC nodes configured)";
  return `# /etc/prometheus/prometheus.yml
# Generated by Zebvix Production Deployment Workbench
global:
  scrape_interval:     15s
  evaluation_interval: 15s
  external_labels:
    chain:  ${c.chainName}
    region: ${c.region || "unspecified"}

rule_files:
  - /etc/prometheus/rules/*.yml

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['127.0.0.1:9093']

scrape_configs:
  - job_name: ${c.chainName}-validators
    metrics_path: /metrics
    scheme: http
    static_configs:
      - targets:
${validatorTargets}
        labels:
          role: validator

  - job_name: ${c.chainName}-rpc
    metrics_path: /metrics
    scheme: http
    static_configs:
      - targets:
${rpcTargets}
        labels:
          role: public-rpc

  - job_name: node_exporter
    static_configs:
      - targets: ['127.0.0.1:9100']
`;
}

function genAlertsYml(c: DeployConfig): string {
  return `# /etc/prometheus/rules/${c.chainName}-alerts.yml
# Generated by Zebvix Production Deployment Workbench
groups:
  - name: ${c.chainName}-consensus
    interval: 15s
    rules:
      - alert: ${c.chainName}_ChainHeadStalled
        expr: time() - ${c.chainName}_chain_head_timestamp_seconds > ${c.thresholdSyncLagSec}
        for: 1m
        labels: { severity: critical, chain: ${c.chainName} }
        annotations:
          summary: "Chain head not advancing for >${c.thresholdSyncLagSec}s on {{ $labels.instance }}"
          runbook: "https://${c.rpcDomain}/runbook#chain-head-stalled"

      - alert: ${c.chainName}_PeerCountLow
        expr: ${c.chainName}_p2p_peers < ${c.thresholdPeerMin}
        for: 2m
        labels: { severity: warning, chain: ${c.chainName} }
        annotations:
          summary: "Peer count {{ $value }} < ${c.thresholdPeerMin} on {{ $labels.instance }}"
          runbook: "https://${c.rpcDomain}/runbook#peer-drop"

      - alert: ${c.chainName}_ValidatorMissedBlocks
        expr: increase(${c.chainName}_validator_missed_blocks_total[5m]) > 5
        for: 5m
        labels: { severity: warning, chain: ${c.chainName}, role: validator }
        annotations:
          summary: "{{ $labels.instance }} missed >5 blocks in 5 min"

  - name: ${c.chainName}-host
    interval: 30s
    rules:
      - alert: ${c.chainName}_DiskSpaceCritical
        expr: 100 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes * 100) > ${c.thresholdDiskPct}
        for: 5m
        labels: { severity: critical, chain: ${c.chainName} }
        annotations:
          summary: "Disk usage {{ $value | printf \\"%.0f\\" }}% > ${c.thresholdDiskPct}% on {{ $labels.instance }}"
          runbook: "https://${c.rpcDomain}/runbook#disk-full"

      - alert: ${c.chainName}_ProcessFlapping
        expr: changes(process_start_time_seconds{job=~"${c.chainName}-.+"}[1h]) > 3
        for: 5m
        labels: { severity: warning, chain: ${c.chainName} }
        annotations:
          summary: "${c.chainName}-node restarted >3× in last hour on {{ $labels.instance }}"

      - alert: ${c.chainName}_RpcErrorRateHigh
        expr: sum(rate(${c.chainName}_rpc_requests_total{code!~"2.."}[5m])) by (instance) / sum(rate(${c.chainName}_rpc_requests_total[5m])) by (instance) > 0.05
        for: 10m
        labels: { severity: warning, chain: ${c.chainName} }
        annotations:
          summary: "RPC error rate >5% on {{ $labels.instance }}"
`;
}

function genAlertmanagerYml(c: DeployConfig): string {
  // Single composite "default" receiver fans out every alert to every
  // configured channel (slack + email + pagerduty). This is provably correct
  // (Alertmanager evaluates each *_configs entry independently) and avoids
  // the route-tree footgun where the first matching child route would swallow
  // an alert before sibling channels saw it.
  //
  // Operators who want severity-based routing (e.g. PagerDuty for criticals
  // only) can split this into matched child routes after install — see the
  // commented example block at the bottom of this file.
  const blocks: string[] = [];
  if (c.alertSlackWebhook) {
    blocks.push(`    slack_configs:
      - api_url: ${yamlStr(c.alertSlackWebhook)}
        channel: ${yamlStr("#" + c.chainName + "-alerts")}
        send_resolved: true
        title:  '[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}'
        text:   '{{ range .Alerts }}{{ .Annotations.summary }}\\n{{ end }}'`);
  }
  if (c.alertEmail) {
    blocks.push(`    email_configs:
      - to: ${yamlStr(c.alertEmail)}
        from: ${yamlStr("alerts@" + c.rpcDomain)}
        smarthost: smtp.example.com:587
        require_tls: true
        send_resolved: true`);
  }
  if (c.alertPagerdutyKey) {
    blocks.push(`    pagerduty_configs:
      - service_key: ${yamlStr(c.alertPagerdutyKey)}
        send_resolved: true
        severity: '{{ .CommonLabels.severity }}'`);
  }
  const defaultReceiverBody = blocks.length > 0
    ? blocks.join("\n")
    : `    # No channel configured — alerts go to /dev/null until you wire one.
    # Edit this block, then: sudo systemctl reload alertmanager`;

  return `# /etc/alertmanager/alertmanager.yml
# Generated by Zebvix Production Deployment Workbench
global:
  resolve_timeout: 5m

route:
  group_by: [alertname, chain, severity]
  group_wait:      10s
  group_interval:  1m
  repeat_interval: 4h
  receiver: default

receivers:
  - name: default
${defaultReceiverBody}

inhibit_rules:
  - source_matchers: [severity="critical"]
    target_matchers: [severity="warning"]
    equal: [chain, alertname, instance]

# ─── Severity-based routing example (uncomment + edit if you split channels) ─
# Replace the simple \`receiver: default\` above with:
#
# route:
#   group_by: [alertname, chain, severity]
#   receiver: default
#   routes:
#     - matchers: [severity="critical"]
#       receiver: pagerduty-critical
#       continue: true     # keep falling through so default also fires
#
# receivers:
#   - name: default        # slack + email
#     ...
#   - name: pagerduty-critical
#     pagerduty_configs:
#       - service_key: ...
`;
}

function genWireguardConf(c: DeployConfig): string {
  const baseIp = c.wireguardCidr.split("/")[0].split(".").slice(0, 3).join(".");
  const peers = Array.from({ length: c.validatorCount }, (_, i) =>
    `# Validator ${i + 1}
[Peer]
PublicKey = REPLACE_WITH_VALIDATOR_${i + 1}_PUBKEY
AllowedIPs = ${baseIp}.${i + 10}/32
PersistentKeepalive = 25
`).join("\n");
  return `# /etc/wireguard/wg0.conf — TEMPLATE
# Generated by Zebvix Production Deployment Workbench
#
# Generate per-host private/public keypairs:
#   wg genkey | tee /etc/wireguard/private.key | wg pubkey > /etc/wireguard/public.key
#   chmod 600 /etc/wireguard/private.key
#
# Replace the REPLACE_WITH_* placeholders below with each peer's public key.

[Interface]
Address    = ${baseIp}.1/24
ListenPort = 51820
PrivateKey = REPLACE_WITH_THIS_HOST_PRIVATE_KEY
SaveConfig = false

# All ${c.validatorCount} validator peers — they reach each other only over wg0,
# so the public ${c.p2pPort}/tcp can be firewalled off from the public internet.
${peers}
`;
}

function genBackupSh(c: DeployConfig): string {
  const dest = c.backupDest;
  const bucket = c.backupBucket;
  const remote = dest === "s3" ? `s3:s3.amazonaws.com/${bucket}`
               : dest === "r2" ? `s3:<R2_ENDPOINT>/${bucket}`
               : dest === "local" ? bucket
               : "";
  return `#!/usr/bin/env bash
# /usr/local/bin/${c.chainName}-backup.sh
# Generated by Zebvix Production Deployment Workbench
#
# Strategy:
#   - hourly:  rsync DB to a sibling NVMe volume (zero-copy snapshot)
#   - daily:   restic encrypted snapshot to ${dest.toUpperCase()} with ${c.backupRetentionDays}-day retention
#
# Cron entries (edited by install-production.sh):
#   ${c.enableHourlySnapshot ? "0 * * * *" : "# (hourly snapshot disabled)"}  ${c.chainName} ${c.enableHourlySnapshot ? `/usr/local/bin/${c.chainName}-backup.sh hourly` : ""}
#   30 3 * * *                                                                 ${c.chainName} /usr/local/bin/${c.chainName}-backup.sh daily

set -euo pipefail

CHAIN_NAME=${escSh(c.chainName)}
DATA_DIR="/var/lib/$CHAIN_NAME"
SNAPSHOT_DIR="/var/lib/$CHAIN_NAME-snapshot"
RETENTION_DAYS=${c.backupRetentionDays}
RESTIC_REPO=${escSh(remote || "/var/backups/" + c.chainName)}
RESTIC_PASSWORD_FILE="/etc/${c.chainName}/restic.password"

mode=\${1:-daily}

case "$mode" in
  hourly)
    ${c.enableHourlySnapshot ? `mkdir -p "$SNAPSHOT_DIR"
    # Hot-rsync — RocksDB tolerates this because it's append-only / immutable SSTs.
    rsync -aH --delete --numeric-ids "$DATA_DIR/" "$SNAPSHOT_DIR/"
    echo "[\\$(date -Is)] hourly snapshot complete: $SNAPSHOT_DIR"` : `echo "hourly snapshot disabled at bundle generation; nothing to do"
    exit 0`}
    ;;
  daily)
    ${dest === "none" ? `echo "no off-site backup destination configured; nothing to do"
    exit 0` : `if [[ ! -f "$RESTIC_PASSWORD_FILE" ]]; then
      echo "ERROR: $RESTIC_PASSWORD_FILE missing — initialise with:" >&2
      echo "  openssl rand -base64 32 > $RESTIC_PASSWORD_FILE && chmod 600 $RESTIC_PASSWORD_FILE" >&2
      echo "  restic -r $RESTIC_REPO --password-file $RESTIC_PASSWORD_FILE init" >&2
      exit 1
    fi
    export RESTIC_PASSWORD_FILE
    # Use the hourly snapshot if present, else the live DB.
    SRC="$SNAPSHOT_DIR"
    [[ -d "$SRC" ]] || SRC="$DATA_DIR"
    restic -r "$RESTIC_REPO" backup --tag "$CHAIN_NAME" --tag daily "$SRC"
    restic -r "$RESTIC_REPO" forget --keep-daily $RETENTION_DAYS --prune
    echo "[\\$(date -Is)] daily backup pushed to $RESTIC_REPO; pruned to last $RETENTION_DAYS days"`}
    ;;
  restore)
    SNAPSHOT_ID=\${2:-latest}
    TARGET=\${3:-/var/restore}
    mkdir -p "$TARGET"
    restic -r "$RESTIC_REPO" --password-file "$RESTIC_PASSWORD_FILE" restore "$SNAPSHOT_ID" --target "$TARGET"
    echo "Restored $SNAPSHOT_ID into $TARGET"
    echo "Stop the service, swap directories, then 'systemctl start \${CHAIN_NAME}-node'."
    ;;
  *)
    echo "usage: $0 {hourly|daily|restore [snapshot-id] [target-dir]}" >&2
    exit 2
    ;;
esac
`;
}

function genHealthcheckSh(c: DeployConfig): string {
  return `#!/usr/bin/env bash
# /usr/local/bin/${c.chainName}-healthcheck.sh
# Generated by Zebvix Production Deployment Workbench
# Exit 0 = healthy, non-zero = degraded; use as a Kubernetes liveness or load-balancer probe.

set -euo pipefail
RPC=\${RPC:-http://127.0.0.1:${c.rpcPort}}
PEER_MIN=\${PEER_MIN:-${c.thresholdPeerMin}}

post() { curl -fsS --max-time 3 "$RPC" -H 'content-type: application/json' -d "$1"; }

cid=\$(post '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | jq -r .result || true)
[[ -z "$cid" || "$cid" == "null" ]] && { echo "FAIL: eth_chainId did not return"; exit 1; }

bn=\$(post '{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}' | jq -r .result || true)
[[ -z "$bn" || "$bn" == "null" ]] && { echo "FAIL: eth_blockNumber did not return"; exit 1; }

peers_hex=\$(post '{"jsonrpc":"2.0","id":3,"method":"net_peerCount","params":[]}' | jq -r .result || echo "0x0")
peers=\$((peers_hex))
if (( peers < PEER_MIN )); then
  echo "FAIL: peers=$peers < min=$PEER_MIN"
  exit 1
fi

echo "OK: chainId=$cid block=$bn peers=$peers"
`;
}

function genInstallProductionSh(c: DeployConfig, baseUrl: string): string {
  const wgBlock = c.enableWireguard ? `
# ── 4. WireGuard (validator P2P private subnet) ─────────────────────────────
step "Installing WireGuard"
apt-get install -y wireguard
install -m 0600 "$BUNDLE_DIR/wireguard/wg0.conf.template" /etc/wireguard/wg0.conf.template
echo "  ✓ Template installed at /etc/wireguard/wg0.conf.template"
echo "    Generate keys (per host) and edit /etc/wireguard/wg0.conf, then:"
echo "      sudo systemctl enable --now wg-quick@wg0"
` : "";
  const fail2banBlock = c.enableFail2ban ? `
step "Installing fail2ban"
apt-get install -y fail2ban
systemctl enable --now fail2ban
` : "";
  const ufwBlock = c.enableUfw ? `
step "Configuring ufw (default deny inbound)"
apt-get install -y ufw
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp        comment 'ssh'
ufw allow 80/tcp        comment 'http (acme challenge)'
ufw allow 443/tcp       comment 'https rpc'
${c.enableWireguard ? "ufw allow 51820/udp     comment 'wireguard'" : `ufw allow ${c.p2pPort}/tcp comment 'p2p (PUBLIC — consider WireGuard instead)'`}
ufw --force enable
ufw status verbose
` : "";
  const backupCronBlock = c.backupDest !== "none" ? `
step "Wiring backup cron"
install -m 0755 "$BUNDLE_DIR/backup/backup.sh" /usr/local/bin/${c.chainName}-backup.sh
cat > /etc/cron.d/${c.chainName}-backup <<'CRON'
# Generated by Zebvix Production Deployment Workbench
${c.enableHourlySnapshot ? `0 * * * *   ${c.chainName}   /usr/local/bin/${c.chainName}-backup.sh hourly  >> /var/log/${c.chainName}/backup.log 2>&1` : `# hourly snapshot disabled`}
30 3 * * *  ${c.chainName}   /usr/local/bin/${c.chainName}-backup.sh daily   >> /var/log/${c.chainName}/backup.log 2>&1
CRON
chmod 0644 /etc/cron.d/${c.chainName}-backup
echo "  ✓ Cron installed; restic password file expected at /etc/${c.chainName}/restic.password"
` : "";
  return `#!/usr/bin/env bash
# install-production.sh — orchestrate ${c.chainName} mainnet deployment
# Generated by Zebvix Production Deployment Workbench
#
# Layered on top of the chain-builder install.sh: assumes /usr/local/bin/${c.chainName}-node
# already exists. This script wires nginx + TLS + Prometheus + Alertmanager
# + (optional) WireGuard + (optional) backup cron.
#
# Re-runnable; idempotent for system-package installs and config writes.

set -euo pipefail

CHAIN_NAME=${escSh(c.chainName)}
RPC_DOMAIN=${escSh(c.rpcDomain)}
ADMIN_EMAIL=${escSh(c.adminEmail)}
RPC_PORT=${c.rpcPort}
P2P_PORT=${c.p2pPort}
METRICS_PORT=${c.metricsPort}
BUNDLE_DIR="\$( cd "\$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
WORKBENCH_BASE_URL=${escSh(baseUrl)}

if [[ \$EUID -ne 0 ]]; then
  echo "Please run as root:  sudo bash install-production.sh" >&2
  exit 1
fi

step() { echo; echo "==> $*"; }

# ── 0. Sanity check: chain binary exists ──────────────────────────────────
if [[ ! -x "/usr/local/bin/$CHAIN_NAME-node" ]]; then
  echo "ERROR: /usr/local/bin/$CHAIN_NAME-node not found." >&2
  echo "       Run the chain-builder install.sh from your bundle first," >&2
  echo "       or set CHAIN_NAME if the binary is named differently." >&2
  exit 1
fi
echo "==> Found /usr/local/bin/$CHAIN_NAME-node — continuing."

# ── 1. System packages ─────────────────────────────────────────────────────
step "Installing system packages"
apt-get update -y
apt-get install -y --no-install-recommends \\
  curl jq nginx certbot python3-certbot-nginx apache2-utils \\
  prometheus alertmanager prometheus-node-exporter \\
  restic cron logrotate ca-certificates

# ── 2. Migrate any legacy service name (pre-${c.chainName}-node convention) ─
if systemctl list-unit-files | grep -q "^${c.chainName}\\.service"; then
  step "Migrating legacy ${c.chainName}.service → ${c.chainName}-node.service"
  systemctl disable --now "${c.chainName}.service" || true
  rm -f "/etc/systemd/system/${c.chainName}.service"
  systemctl daemon-reload
fi

# ── 3. Hardened systemd unit ───────────────────────────────────────────────
step "Installing hardened systemd unit"
install -m 0644 "$BUNDLE_DIR/systemd/${c.chainName}-node.service" /etc/systemd/system/${c.chainName}-node.service
systemctl daemon-reload
systemctl enable ${c.chainName}-node.service
echo "  ✓ Run 'systemctl restart ${c.chainName}-node' once nginx + TLS are in place."

# ── 4. nginx vhost — TWO-STAGE BOOTSTRAP ───────────────────────────────────
# Stage A: install an HTTP-only stub vhost so nginx can start AND serve the
#          ACME challenge before any TLS cert exists.
# Stage B: after certbot has issued the cert, swap in the full TLS vhost.
# This is the only safe sequence on a fresh box.
step "Stage A: bootstrap HTTP-only vhost (for ACME challenge)"
mkdir -p /var/www/letsencrypt
# Disable the stock default site so it doesn't shadow our server_name.
rm -f /etc/nginx/sites-enabled/default
cat > /etc/nginx/sites-available/${c.chainName}-rpc-bootstrap.conf <<NGINX_BOOTSTRAP
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name $RPC_DOMAIN;
  location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
  location / { return 200 "${c.chainName} bootstrap — issuing TLS cert"; add_header Content-Type text/plain; }
}
NGINX_BOOTSTRAP
ln -sf /etc/nginx/sites-available/${c.chainName}-rpc-bootstrap.conf \\
       /etc/nginx/sites-enabled/${c.chainName}-rpc-bootstrap.conf
# Make sure no half-installed real vhost is in sites-enabled yet.
rm -f /etc/nginx/sites-enabled/${c.chainName}-rpc.conf
nginx -t
systemctl reload nginx || systemctl restart nginx

step "Stage A: provisioning TLS certificate via Let's Encrypt"
if [[ ! -d "/etc/letsencrypt/live/$RPC_DOMAIN" ]]; then
  certbot certonly --webroot -w /var/www/letsencrypt \\
    --non-interactive --agree-tos --email "$ADMIN_EMAIL" \\
    -d "$RPC_DOMAIN"
else
  echo "  ✓ Certificate already present for $RPC_DOMAIN — skipping issuance"
fi

${c.enableAdminAuth ? `step "Stage B: provisioning htpasswd for /admin endpoint"
mkdir -p /etc/nginx/htpasswd
HTPASSWD_FILE="/etc/nginx/htpasswd/${c.chainName}.htpasswd"
if [[ ! -f "$HTPASSWD_FILE" ]]; then
  ADMIN_PW=\$(openssl rand -base64 24 | tr -d '/=+' | cut -c1-24)
  htpasswd -bcB "$HTPASSWD_FILE" admin "$ADMIN_PW"
  chmod 0640 "$HTPASSWD_FILE"
  chown root:www-data "$HTPASSWD_FILE" 2>/dev/null || true
  echo
  echo "  ╔═══════════════════════════════════════════════════════════════════╗"
  echo "  ║  /admin basic-auth credentials (printed ONCE — save them now):    ║"
  echo "  ║    user: admin                                                    ║"
  echo "  ║    pass: $ADMIN_PW                                ║"
  echo "  ║  Rotate with: htpasswd -B $HTPASSWD_FILE admin    ║"
  echo "  ╚═══════════════════════════════════════════════════════════════════╝"
  echo
else
  echo "  ✓ htpasswd already present at $HTPASSWD_FILE — leaving as-is"
fi
` : ""}
step "Stage B: installing full TLS vhost"
install -m 0644 "$BUNDLE_DIR/nginx/${c.chainName}-rpc.conf" /etc/nginx/sites-available/${c.chainName}-rpc.conf
ln -sf /etc/nginx/sites-available/${c.chainName}-rpc.conf /etc/nginx/sites-enabled/${c.chainName}-rpc.conf
rm -f /etc/nginx/sites-enabled/${c.chainName}-rpc-bootstrap.conf
nginx -t
systemctl reload nginx
${wgBlock}${fail2banBlock}${ufwBlock}
# ── 5. Prometheus + Alertmanager ───────────────────────────────────────────
step "Wiring Prometheus + Alertmanager"
install -m 0644 "$BUNDLE_DIR/prometheus/prometheus.yml"     /etc/prometheus/prometheus.yml
install -d -m 0755 /etc/prometheus/rules
install -m 0644 "$BUNDLE_DIR/prometheus/rules/${c.chainName}-alerts.yml" /etc/prometheus/rules/${c.chainName}-alerts.yml
install -m 0644 "$BUNDLE_DIR/alertmanager/alertmanager.yml" /etc/alertmanager/alertmanager.yml
systemctl restart prometheus alertmanager prometheus-node-exporter
${backupCronBlock}
# ── 6. Healthcheck + cert renewal cron ─────────────────────────────────────
step "Installing healthcheck script + cert renewal hook"
install -m 0755 "$BUNDLE_DIR/healthcheck.sh" /usr/local/bin/${c.chainName}-healthcheck.sh
echo "0 3 * * *  root  certbot renew --quiet --post-hook 'systemctl reload nginx'" \\
  > /etc/cron.d/${c.chainName}-certbot-renew
chmod 0644 /etc/cron.d/${c.chainName}-certbot-renew

# ── 7. Start node + final probe ────────────────────────────────────────────
step "Starting ${c.chainName} node"
systemctl restart ${c.chainName}-node.service
sleep 5
if /usr/local/bin/${c.chainName}-healthcheck.sh; then
  echo
  echo "  ✓ Production deployment complete."
  echo "    Public RPC:  https://$RPC_DOMAIN"
  echo "    Metrics:     http://127.0.0.1:$METRICS_PORT/metrics"
  echo "    Prometheus:  http://127.0.0.1:9090"
  echo "    Alertmgr:    http://127.0.0.1:9093"
  echo
  echo "    Next: see runbook.md in this bundle."
else
  echo "  ✗ Healthcheck failed — inspect:  journalctl -u ${c.chainName}-node -n 200" >&2
  exit 1
fi
`;
}

function genRunbook(c: DeployConfig): string {
  return `# ${c.chainName} — Production Operations Runbook

Generated by Zebvix Production Deployment Workbench.
Region: **${c.region || "unspecified"}** · Domain: **${c.rpcDomain}** · Validators: **${c.validatorCount}** · Public RPC: **${c.publicRpcCount}**

---

## 1. Common operations

\`\`\`bash
# live logs
sudo journalctl -u ${c.chainName}-node -f

# health probe
/usr/local/bin/${c.chainName}-healthcheck.sh

# restart node
sudo systemctl restart ${c.chainName}-node

# reload nginx after editing the vhost
sudo nginx -t && sudo systemctl reload nginx

# inspect prometheus alerts
curl -s http://127.0.0.1:9090/api/v1/alerts | jq

# trigger a manual daily backup
sudo -u ${c.chainName} /usr/local/bin/${c.chainName}-backup.sh daily
\`\`\`

## 2. Incident playbooks

### 2.1 Chain head stalled (\`${c.chainName}_ChainHeadStalled\`)

1. \`journalctl -u ${c.chainName}-node -n 500\` — look for panics / disk-full / consensus error.
2. Check peer count: \`curl -s http://127.0.0.1:${c.rpcPort} -d '{"jsonrpc":"2.0","id":1,"method":"net_peerCount"}'\`
3. If isolated: restart with \`systemctl restart ${c.chainName}-node\` and verify peers ≥ ${c.thresholdPeerMin} within 60 s.
4. If peer count is healthy but height stuck: dump consensus state — likely a fork; coordinate with other validators.

### 2.2 Peer drop (\`${c.chainName}_PeerCountLow\`)

1. Check \`/etc/wireguard/wg0\` (if WireGuard enabled): \`wg show\`
2. Check P2P port reachability: \`ss -ltnp | grep ${c.p2pPort}\`
3. Confirm bootstrap peers are reachable from the node.

### 2.3 Disk full (\`${c.chainName}_DiskSpaceCritical\`)

1. \`du -sh /var/lib/${c.chainName}/* | sort -h\` — identify largest subdir.
2. Trigger a snapshot prune if you run an archive node.
3. If repeated, scale to a larger NVMe and \`rsync --delete\` the data dir.

### 2.4 Restore from off-site backup

\`\`\`bash
sudo systemctl stop ${c.chainName}-node
sudo -u ${c.chainName} /usr/local/bin/${c.chainName}-backup.sh restore latest /var/restore
sudo rsync -aH --delete /var/restore/ /var/lib/${c.chainName}/
sudo systemctl start ${c.chainName}-node
\`\`\`

## 3. Pre-launch checklist

- [ ] \`certbot certificates\` shows ${c.rpcDomain} valid for >30 days
- [ ] \`systemctl status ${c.chainName}-node\` is \`active (running)\`
- [ ] \`/usr/local/bin/${c.chainName}-healthcheck.sh\` exits 0
- [ ] Prometheus targets all UP at \`http://127.0.0.1:9090/targets\`
- [ ] At least one alert channel firing in test mode
- [ ] Cold restore drill completed within last 90 days
- [ ] Runbook URL (this file) committed to your team wiki

## 4. Contacts

- Operations on-call: ${c.alertEmail || "_(set alertEmail when regenerating the bundle)_"}
- Slack alerts:       ${c.alertSlackWebhook ? "#" + c.chainName + "-alerts" : "_(not configured)_"}
- PagerDuty service:  ${c.alertPagerdutyKey ? "configured" : "_(not configured)_"}
`;
}

function genReadme(c: DeployConfig, score: number): string {
  return `# ${c.chainName} Production Deployment Bundle

Generated by **Zebvix Production Deployment Workbench**.
Production-readiness score: **${score} / 100**.

## Architecture

\`\`\`
                     ┌────────────────────┐
                     │   Public Internet  │
                     └─────────┬──────────┘
                               │ HTTPS / 443
                  ┌────────────▼────────────┐
                  │  nginx (TLS, rate-limit │
                  │  admin-method blocklist)│
                  └────────────┬────────────┘
                               │ 127.0.0.1:${c.rpcPort}
              ┌────────────────▼─────────────────┐
              │  ${c.chainName}-node  (systemd unit, hardened)  │
              │  metrics → 127.0.0.1:${c.metricsPort}/metrics              │
              └────────────────┬─────────────────┘
                               │ ${c.enableWireguard ? "wg0 (WireGuard)" : `${c.p2pPort}/tcp (PUBLIC — consider WireGuard)`}
                ┌──────────────▼──────────────┐
                │ ${String(c.validatorCount).padStart(2, " ")} × validator + ${String(c.publicRpcCount).padStart(2, " ")} × public RPC │
                └─────────────────────────────┘
\`\`\`

## Files in this bundle

| Path                                        | Purpose                                              |
|---------------------------------------------|------------------------------------------------------|
| \`install-production.sh\`                     | One-shot orchestrator (idempotent)                   |
| \`systemd/${c.chainName}-node.service\`            | Hardened systemd unit (sandboxed, NoNewPrivs, …)     |
| \`nginx/${c.chainName}-rpc.conf\`             | TLS reverse proxy, rate-limit, admin-method blocklist |
| \`prometheus/prometheus.yml\`                 | Scrape config (validators + RPC + node-exporter)     |
| \`prometheus/rules/${c.chainName}-alerts.yml\`| Alerting rules (consensus, peers, disk, RPC errors)  |
| \`alertmanager/alertmanager.yml\`             | Routing → ${[c.alertSlackWebhook && "Slack", c.alertPagerdutyKey && "PagerDuty", c.alertEmail && "email"].filter(Boolean).join(" + ") || "(no channel — wire one!)"} |
${c.enableWireguard ? `| \`wireguard/wg0.conf.template\`               | Validator P2P over a private ${c.wireguardCidr} subnet |\n` : ""}${c.backupDest !== "none" ? `| \`backup/backup.sh\`                          | rsync (hourly) + restic (daily, ${c.backupRetentionDays}d retention) → ${c.backupDest.toUpperCase()} |\n` : ""}| \`healthcheck.sh\`                            | eth_chainId + eth_blockNumber + net_peerCount probe  |
| \`runbook.md\`                                | Ops runbook with incident playbooks + restore steps  |

## One-command install

\`\`\`bash
tar -xzf ${c.chainName}-prod.tar.gz
cd ${c.chainName}-prod
sudo bash install-production.sh
\`\`\`

The orchestrator is idempotent — re-running it patches drift in nginx / Prometheus / Alertmanager configs without touching chain data.

## Verifying production-readiness

After install, verify externally:

\`\`\`bash
# TLS + rate-limit
curl -sS https://${c.rpcDomain} -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

# admin method should be blocked at the edge
curl -sS https://${c.rpcDomain} -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"admin_addPeer","params":[]}'
# expect: HTTP 403
\`\`\`

## License

MIT — your chain, your rules.
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle file map
// ─────────────────────────────────────────────────────────────────────────────

function buildFiles(c: DeployConfig, baseUrl: string, score: number): Record<string, string> {
  const files: Record<string, string> = {
    "README.md": genReadme(c, score),
    "install-production.sh": genInstallProductionSh(c, baseUrl),
    [`systemd/${c.chainName}-node.service`]: genSystemdUnit(c),
    [`nginx/${c.chainName}-rpc.conf`]: genNginxConf(c),
    "prometheus/prometheus.yml": genPrometheusYml(c),
    [`prometheus/rules/${c.chainName}-alerts.yml`]: genAlertsYml(c),
    "alertmanager/alertmanager.yml": genAlertmanagerYml(c),
    "healthcheck.sh": genHealthcheckSh(c),
    "runbook.md": genRunbook(c),
  };
  if (c.enableWireguard) {
    files["wireguard/wg0.conf.template"] = genWireguardConf(c);
  }
  if (c.backupDest !== "none") {
    files["backup/backup.sh"] = genBackupSh(c);
  }
  return files;
}

function resolveBaseUrl(req: any): string {
  const env = process.env.PUBLIC_API_BASE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  const replitDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (replitDomain) return `https://${replitDomain.replace(/\/+$/, "")}`;
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol || "http";
  const host = req.get("host") || "localhost";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

productionDeployRouter.post("/production-deploy/preview", (req, res) => {
  const v = validate(req.body);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }
  const cfg = v.value;
  const baseUrl = resolveBaseUrl(req);
  const score = computeScore(cfg);
  const cost = estimateMonthlyCostUsd(cfg);
  const files = buildFiles(cfg, baseUrl, score.total);
  const totalBytes = Object.values(files).reduce((s, v) => s + v.length, 0);
  const installHash = crypto.createHash("sha256").update(files["install-production.sh"] || "").digest("hex");
  res.json({
    config: cfg,
    baseUrl,
    files,
    score,
    cost,
    summary: {
      installHash,
      totalBytes,
      fileCount: Object.keys(files).length,
    },
  });
});

productionDeployRouter.post("/production-deploy/generate", (req, res) => {
  const v = validate(req.body);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }
  const cfg = v.value;
  const baseUrl = resolveBaseUrl(req);
  const score = computeScore(cfg);
  const files = buildFiles(cfg, baseUrl, score.total);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `proddeploy-${cfg.chainName}-`));
  const root = path.join(tmp, `${cfg.chainName}-prod`);
  fs.mkdirSync(root, { recursive: true });

  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
      if (rel.endsWith(".sh")) fs.chmodSync(full, 0o755);
    }

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${cfg.chainName}-prod.tar.gz"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Production-Score", String(score.total));

    const tar = spawn("tar", ["-czf", "-", "-C", tmp, `${cfg.chainName}-prod`], { stdio: ["ignore", "pipe", "pipe"] });
    tar.stdout.pipe(res);
    tar.stderr.on("data", (d) => console.error("[proddeploy tar]", d.toString()));
    tar.on("error", (e) => {
      console.error("[proddeploy spawn]", e);
      if (!res.headersSent) res.status(500).end();
    });
    tar.on("exit", (code) => {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      if (code !== 0 && !res.writableEnded) res.end();
    });
  } catch (err: any) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    if (!res.headersSent) res.status(500).json({ error: String(err?.message || err) });
  }
});

export default productionDeployRouter;
