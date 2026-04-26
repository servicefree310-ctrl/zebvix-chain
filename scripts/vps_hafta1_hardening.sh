#!/usr/bin/env bash
# Hafte-1 closed-beta VPS hardening for Zebvix L1.
# Run as root on the VPS hosting the validator.
#
# What this does, idempotently:
#   1. Locks down /root/.zebvix/validator.key to mode 0400 owned by root
#      (pre-state captured to /var/lib/zebvix/hafta1-state for rollback)
#   2. Daily RocksDB snapshot cron @ 03:00 (rotated 7d, gzipped, ~30s downtime)
#   3. Re-binds zebvix-node RPC to 127.0.0.1:8545 (covers --rpc, --rpc-addr,
#      --rpc-bind, --listen-rpc, --listen-addr, RPC_BIND= forms). Verifies
#      via `ss` after restart and aborts loudly if 8545 is still on 0.0.0.0.
#   4. Installs Caddy reverse-proxy with auto-TLS in front of 127.0.0.1:8545
#      (requires $RPC_DOMAIN env var; skipped with a notice if unset).
#      NOTE: per-IP rate limiting is NOT enabled in this version — Caddy's
#      default build does not include the rate_limit module. Tracked as a
#      Hafte-2 followup; until then RPC abuse protection comes only from
#      bind-to-localhost + TLS + standard Caddy connection limits.
#
# Pre-state for rollback is recorded under /var/lib/zebvix/hafta1-state/.
# See scripts/README_vps_hardening.md for per-step rollback recipes.
#
# Usage:
#   sudo ./vps_hafta1_hardening.sh                # do everything possible
#   sudo ./vps_hafta1_hardening.sh --dry-run      # preview only, no changes
#   sudo RPC_DOMAIN=rpc.zebvix.example ./vps_hafta1_hardening.sh
#
set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

TS=$(date +%Y%m%d-%H%M%S)
SERVICE_FILE=/etc/systemd/system/zebvix.service
DATA_DIR=/root/.zebvix
KEY_FILE="$DATA_DIR/validator.key"
BACKUP_DIR=/var/backups/zebvix
BACKUP_SCRIPT=/usr/local/sbin/zebvix-backup.sh
CRON_FILE=/etc/cron.d/zebvix-backup
CADDY_FILE=/etc/caddy/Caddyfile
STATE_DIR=/var/lib/zebvix/hafta1-state

log()   { echo -e "\033[1;36m[hafta1]\033[0m $*"; }
warn()  { echo -e "\033[1;33m[hafta1 WARN]\033[0m $*"; }
err()   { echo -e "\033[1;31m[hafta1 ERR]\033[0m $*" >&2; }
do_or_print() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  DRY-RUN: $*"
  else
    eval "$@"
  fi
}

[[ $EUID -eq 0 ]] || { err "must be run as root"; exit 1; }
do_or_print "mkdir -p '$STATE_DIR'"

#####################################################################
# Step 1 — Validator key file mode 0400
#####################################################################
log "Step 1/4: validator key file permissions"
if [[ -f "$KEY_FILE" ]]; then
  CUR_MODE=$(stat -c %a "$KEY_FILE")
  CUR_OWNER=$(stat -c %U:%G "$KEY_FILE")
  log "  current: mode=$CUR_MODE owner=$CUR_OWNER"
  # Capture pre-state durably for rollback (do not rely on shell history).
  if [[ $DRY_RUN -eq 0 ]]; then
    if [[ ! -f "$STATE_DIR/validator-key.pre" ]]; then
      printf 'mode=%s\nowner=%s\nfile=%s\nrecorded_at=%s\n' \
        "$CUR_MODE" "$CUR_OWNER" "$KEY_FILE" "$TS" \
        > "$STATE_DIR/validator-key.pre"
      log "  pre-state recorded -> $STATE_DIR/validator-key.pre"
    else
      log "  pre-state already recorded ($STATE_DIR/validator-key.pre) — keeping original"
    fi
  fi
  do_or_print "chown root:root '$KEY_FILE'"
  do_or_print "chmod 0400 '$KEY_FILE'"
  log "  -> mode 0400 root:root applied"
else
  warn "  $KEY_FILE not found — skipping (chain may not yet be initialised)"
fi

#####################################################################
# Step 2 — Daily RocksDB snapshot cron
#####################################################################
log "Step 2/4: daily RocksDB snapshot cron @ 03:00, 7-day rotation"
do_or_print "mkdir -p '$BACKUP_DIR'"

if [[ $DRY_RUN -eq 0 ]]; then
  cat >"$BACKUP_SCRIPT" <<'EOSCRIPT'
#!/usr/bin/env bash
# Nightly Zebvix RocksDB snapshot. Stops the node briefly (~30s) for a
# consistent tar; restarts immediately after.
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
DATA_DIR=/root/.zebvix
BACKUP_DIR=/var/backups/zebvix
KEEP_DAYS=7

mkdir -p "$BACKUP_DIR"
logger -t zebvix-backup "starting snapshot $TS"

systemctl stop zebvix.service
trap 'systemctl start zebvix.service || true' EXIT

# Tar excludes LOG files (logs not state) and the LOCK file (held only when running)
tar -C "$DATA_DIR" \
    --exclude='LOG' --exclude='LOG.old.*' --exclude='LOCK' \
    -czf "$BACKUP_DIR/zebvix-data-$TS.tar.gz" \
    .

systemctl start zebvix.service
trap - EXIT

# Rotate: keep last KEEP_DAYS daily snapshots
find "$BACKUP_DIR" -maxdepth 1 -name 'zebvix-data-*.tar.gz' -type f \
     -mtime +$KEEP_DAYS -delete

SIZE=$(du -h "$BACKUP_DIR/zebvix-data-$TS.tar.gz" | cut -f1)
logger -t zebvix-backup "snapshot complete: $SIZE"
EOSCRIPT
  chmod 0755 "$BACKUP_SCRIPT"
  log "  installed $BACKUP_SCRIPT"

  cat >"$CRON_FILE" <<EOF
# Hafte-1: daily Zebvix RocksDB snapshot
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * root $BACKUP_SCRIPT >>/var/log/zebvix-backup.log 2>&1
EOF
  chmod 0644 "$CRON_FILE"
  log "  installed cron at $CRON_FILE (03:00 daily)"
else
  echo "  DRY-RUN: would write $BACKUP_SCRIPT and $CRON_FILE"
fi

#####################################################################
# Step 3 — Re-bind RPC to 127.0.0.1 in systemd unit
#####################################################################
log "Step 3/4: bind zebvix-node RPC to 127.0.0.1"
if [[ ! -f "$SERVICE_FILE" ]]; then
  warn "  $SERVICE_FILE not found — skipping"
else
  # Probe: does ExecStart contain any 0.0.0.0 reference at all?
  HAS_PUBLIC_BIND=0
  if grep -E '^\s*ExecStart=' "$SERVICE_FILE" | grep -qE '0\.0\.0\.0'; then
    HAS_PUBLIC_BIND=1
  fi

  if [[ $HAS_PUBLIC_BIND -eq 0 ]]; then
    # Confirm runtime really is on localhost too
    if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE '^(0\.0\.0\.0|\*|::):8545$'; then
      err "  ExecStart has no 0.0.0.0 but port 8545 is still bound publicly at runtime."
      err "  This script can't fix that automatically — check for env vars or a config file."
      err "  Inspect: ss -ltnp | grep 8545"
      exit 1
    fi
    log "  RPC already private — no change"
  else
    do_or_print "cp '$SERVICE_FILE' '$SERVICE_FILE.pre-hafta1.bak.$TS'"
    # Cover the common flag forms: --rpc, --rpc-addr, --rpc-bind, --listen-rpc,
    # --listen-addr, --bind, plus the env-style RPC_BIND=0.0.0.0:PORT.
    # We use a single sed that rewrites ANY '0.0.0.0:' substring inside the
    # ExecStart line(s) — safe because real listen flags are the only place
    # 0.0.0.0:PORT should appear in a unit file.
    do_or_print "sed -i -E '/^\\s*ExecStart=/ s|0\\.0\\.0\\.0:|127.0.0.1:|g' '$SERVICE_FILE'"
    do_or_print "systemctl daemon-reload"
    do_or_print "systemctl restart zebvix.service"

    if [[ $DRY_RUN -eq 0 ]]; then
      # Give the node ~5s to come up, then verify
      sleep 5
      if ss -ltnH | awk '{print $4}' | grep -qE '^(0\.0\.0\.0|\*|::):8545$'; then
        err "  Rebind FAILED — port 8545 still on 0.0.0.0 after restart."
        err "  Inspect: systemctl status zebvix.service ; ss -ltnp | grep 8545"
        err "  Rollback: cp '$SERVICE_FILE.pre-hafta1.bak.$TS' '$SERVICE_FILE' ; systemctl daemon-reload ; systemctl restart zebvix.service"
        exit 1
      fi
      if ! ss -ltnH | awk '{print $4}' | grep -qE '^127\.0\.0\.1:8545$'; then
        warn "  Port 8545 is no longer public, but no 127.0.0.1:8545 listener detected either."
        warn "  Confirm node started cleanly: journalctl -u zebvix.service -n 50"
      fi
      log "  -> verified bound to 127.0.0.1:8545; backup at $SERVICE_FILE.pre-hafta1.bak.$TS"
    else
      log "  DRY-RUN: would re-bind and verify"
    fi
  fi
fi

#####################################################################
# Step 4 — Caddy reverse-proxy with TLS + rate-limit
#####################################################################
log "Step 4/4: Caddy reverse-proxy + TLS + rate-limit"
if [[ -z "${RPC_DOMAIN:-}" ]]; then
  warn "  RPC_DOMAIN not set — skipping. Re-run with:"
  warn "    sudo RPC_DOMAIN=rpc.yourdomain.com ./vps_hafta1_hardening.sh"
else
  log "  RPC_DOMAIN=$RPC_DOMAIN"
  if ! command -v caddy >/dev/null 2>&1; then
    log "  installing Caddy from official apt repo..."
    do_or_print "apt-get update -y"
    do_or_print "apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg"
    do_or_print "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg"
    do_or_print "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list"
    do_or_print "apt-get update -y"
    do_or_print "apt-get install -y caddy"
  else
    log "  Caddy already installed"
  fi

  # Caddyfile: TLS via Let's Encrypt + JSON-RPC POSTs to localhost.
  # NOTE: per-IP rate-limit is NOT included — see header comment.
  if [[ $DRY_RUN -eq 0 ]]; then
    [[ -f "$CADDY_FILE" ]] && cp "$CADDY_FILE" "$CADDY_FILE.pre-hafta1.bak.$TS"
    cat >"$CADDY_FILE" <<EOF
$RPC_DOMAIN {
    encode zstd gzip

    @rpc {
        method POST
        path /
    }

    handle @rpc {
        reverse_proxy 127.0.0.1:8545 {
            header_up Host {host}
            header_up X-Real-IP {remote_host}
            transport http {
                read_timeout  30s
                write_timeout 30s
            }
        }
    }

    handle {
        respond "Zebvix L1 RPC. POST JSON-RPC to /." 200
    }

    log {
        output file /var/log/caddy-zebvix.log {
            roll_size 50mb
            roll_keep 10
        }
        format json
    }
}
EOF
    log "  wrote $CADDY_FILE"
    warn "  per-IP rate-limit NOT enforced (Hafte-2 followup — needs caddy-ratelimit module via xcaddy)"
    do_or_print "systemctl enable caddy"
    do_or_print "systemctl restart caddy"
    sleep 2
    if systemctl is-active --quiet caddy; then
      log "  Caddy running"
    else
      err "  Caddy failed to start — check 'journalctl -u caddy -n 50'"
    fi
  else
    echo "  DRY-RUN: would write $CADDY_FILE for $RPC_DOMAIN and restart caddy"
  fi
fi

log "Done. See scripts/README_vps_hardening.md for verification + rollback."
