#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-vps.sh — install bridge-relayer + 5 bridge-signers on a single VPS.
#
# RUN THIS ON THE VPS AS ROOT (or via sudo). Assumes:
#   - The Zebvix repo is cloned at $REPO (default: /opt/zebvix).
#   - You have a working internet connection (to fetch Node.js + pnpm).
#
# What this does:
#   1. Installs Node.js 20 LTS + pnpm if missing.
#   2. Runs pnpm install --filter @workspace/bridge-relayer --filter @workspace/bridge-signer.
#   3. Creates /etc/zbx-bridge/ for env files.
#   4. Creates /var/lib/zbx-bridge/ for sqlite state.
#   5. Installs systemd units (zbx-relayer + zbx-signer@1..5).
#   6. Reloads systemd. Does NOT start anything yet (you must fill env files first).
#
# After this script:
#   - Edit /etc/zbx-bridge/relayer.env       (relayer secrets)
#   - Edit /etc/zbx-bridge/signer-1.env      (validator 1 key)
#   - Edit /etc/zbx-bridge/signer-2.env      (validator 2 key)
#   - …signer-3.env, signer-4.env, signer-5.env
#   - systemctl enable --now zbx-relayer zbx-signer@1 zbx-signer@2 zbx-signer@3 zbx-signer@4 zbx-signer@5
#   - journalctl -u zbx-relayer -f
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="${REPO:-/opt/zebvix}"
NODE_VERSION="20"
# How many signer instances to provision env files for. Default 5 (matches a
# 3-of-5 validator setup). Set VALIDATOR_COUNT=1 for a 1-of-1 bootstrap.
VALIDATOR_COUNT="${VALIDATOR_COUNT:-5}"

if [ "$EUID" -ne 0 ]; then
  echo "Run as root (sudo bash $0)" >&2
  exit 1
fi

if [ ! -d "$REPO/lib/bridge-relayer" ] || [ ! -d "$REPO/lib/bridge-signer" ]; then
  echo "Repo not found at $REPO (expected $REPO/lib/bridge-relayer)." >&2
  echo "Set REPO=/path/to/cloned/repo and rerun." >&2
  exit 1
fi

echo "→ Step 1/6: Node.js $NODE_VERSION + pnpm"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
fi
if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm@9
fi
node -v
pnpm -v

echo "→ Step 2/6: Install dependencies (filtered)"
cd "$REPO"
pnpm install \
  --filter @workspace/bridge-relayer... \
  --filter @workspace/bridge-signer... \
  --frozen-lockfile=false

echo "→ Step 3/6: Typecheck both packages"
pnpm --filter @workspace/bridge-relayer run typecheck
pnpm --filter @workspace/bridge-signer  run typecheck

echo "→ Step 4/6: System users + dirs"
id zbx-bridge >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin zbx-bridge
mkdir -p /etc/zbx-bridge /var/lib/zbx-bridge
chown -R zbx-bridge:zbx-bridge /var/lib/zbx-bridge
chmod 750 /etc/zbx-bridge

echo "→ Step 5/6: Env file templates (VALIDATOR_COUNT=$VALIDATOR_COUNT)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Generate ONE shared bearer token for relayer ↔ signer auth (mandatory hardening).
# Reuse if any env file already exists with one (idempotent re-runs).
AUTH_TOKEN=""
if [ -f /etc/zbx-bridge/relayer.env ] && grep -q "^SIGNER_AUTH_TOKEN=" /etc/zbx-bridge/relayer.env; then
  AUTH_TOKEN="$(grep "^SIGNER_AUTH_TOKEN=" /etc/zbx-bridge/relayer.env | cut -d= -f2-)"
fi
if [ -z "$AUTH_TOKEN" ] || [ "$AUTH_TOKEN" = "__AUTH_TOKEN__" ]; then
  AUTH_TOKEN="$(openssl rand -hex 32)"
fi

# Build the list of env files to create: relayer + signer-1..N
ENV_FILES=("relayer.env")
for i in $(seq 1 "$VALIDATOR_COUNT"); do
  ENV_FILES+=("signer-$i.env")
done

for f in "${ENV_FILES[@]}"; do
  if [ ! -f "/etc/zbx-bridge/$f" ]; then
    base="${f%.env}"
    if [ "$base" = "relayer" ]; then
      cp "$SCRIPT_DIR/env-templates/relayer.env.template" "/etc/zbx-bridge/$f"
      sed -i "s|__AUTH_TOKEN__|$AUTH_TOKEN|g" "/etc/zbx-bridge/$f"
    else
      cp "$SCRIPT_DIR/env-templates/signer.env.template" "/etc/zbx-bridge/$f"
      idx="${base#signer-}"
      sed -i "s|__SIGNER_INDEX__|$idx|g; s|__PORT__|$((9000 + idx))|g; s|__AUTH_TOKEN__|$AUTH_TOKEN|g" "/etc/zbx-bridge/$f"
    fi
    chown zbx-bridge:zbx-bridge "/etc/zbx-bridge/$f"
    chmod 600 "/etc/zbx-bridge/$f"
    echo "  ✓ created /etc/zbx-bridge/$f"
  else
    echo "  • /etc/zbx-bridge/$f already exists, leaving it alone"
  fi
done

echo "→ Step 6/6: Systemd units"
# These ALWAYS overwrite — units are repo-tracked source of truth.
# To customise on a specific host without losing changes on next install,
# use systemd drop-ins instead:
#   sudo systemctl edit zbx-relayer        # creates /etc/systemd/system/zbx-relayer.service.d/override.conf
sed "s|__REPO__|$REPO|g" "$SCRIPT_DIR/systemd/zbx-relayer.service" \
  > /etc/systemd/system/zbx-relayer.service
sed "s|__REPO__|$REPO|g" "$SCRIPT_DIR/systemd/zbx-signer@.service" \
  > /etc/systemd/system/zbx-signer@.service
systemctl daemon-reload
echo "  ✓ installed zbx-relayer.service + zbx-signer@.service"
echo "  ✓ shared SIGNER_AUTH_TOKEN auto-generated and injected"

# Build dynamic instructions based on VALIDATOR_COUNT
SIGNER_LIST=""
SIGNER_HEALTH=""
SIGNER_NANO=""
SIGNER_ENABLE=""
for i in $(seq 1 "$VALIDATOR_COUNT"); do
  SIGNER_LIST+=" zbx-signer@$i"
  SIGNER_HEALTH+="       curl -s http://127.0.0.1:$((9000 + i))/health | jq   # validator $i"$'\n'
  SIGNER_NANO+="       nano /etc/zbx-bridge/signer-$i.env"$'\n'
  SIGNER_ENABLE+=" zbx-signer@$i"
done

cat <<EOF

─────────────────────────────────────────────────────────────────────────────
Install complete. NEXT STEPS ($VALIDATOR_COUNT validator(s) provisioned):

  1. Fill env files (use 'nano' or your editor of choice):
       nano /etc/zbx-bridge/relayer.env
$SIGNER_NANO
  2. Start the services:
       systemctl enable --now zbx-relayer$SIGNER_ENABLE

  3. Watch logs:
       journalctl -u zbx-relayer -f
       journalctl -u zbx-signer@1 -f

  4. Health checks (from VPS shell):
       curl -s http://127.0.0.1:8765/health | jq
$SIGNER_HEALTH
  5. SECURITY: BIND_HOST=127.0.0.1 in each signer.env keeps them off the
     public internet. The auto-generated SIGNER_AUTH_TOKEN gives a second
     defense-in-depth layer even on a misconfigured firewall.
─────────────────────────────────────────────────────────────────────────────
EOF
