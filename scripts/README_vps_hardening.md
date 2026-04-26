# VPS Hafte-1 hardening — operator guide

This applies the Hafte-1 closed-beta hardening to the VPS running the Zebvix
validator (`/etc/systemd/system/zebvix.service`).

**Run from the VPS, as root.** Do not run from your laptop.

```bash
# 1. Copy the script over
scp scripts/vps_hafta1_hardening.sh root@srv1266996.hstgr.cloud:/tmp/

# 2. SSH in, dry-run first to see what will change
ssh root@srv1266996.hstgr.cloud
chmod +x /tmp/vps_hafta1_hardening.sh
/tmp/vps_hafta1_hardening.sh --dry-run

# 3. If happy, run for real (replace domain with one whose A-record points to this VPS)
RPC_DOMAIN=rpc.zebvix.example /tmp/vps_hafta1_hardening.sh
```

## What changes

| Step | File / object | Backup / rollback record |
|---|---|---|
| 1 | `/root/.zebvix/validator.key` mode → `0400 root:root` | pre-state captured to `/var/lib/zebvix/hafta1-state/validator-key.pre` |
| 2 | `/usr/local/sbin/zebvix-backup.sh` (new) + `/etc/cron.d/zebvix-backup` (new) | n/a (new files) |
| 3 | `/etc/systemd/system/zebvix.service` rewrite of any `0.0.0.0:` inside `ExecStart=` lines → `127.0.0.1:` | yes, `.pre-hafta1.bak.<ts>` sibling. Script verifies via `ss` after restart and aborts loudly if 8545 is still public. |
| 4 | `/etc/caddy/Caddyfile` (new or replaced) | yes, `.pre-hafta1.bak.<ts>` if existed |

### Honest scope notes

- **No per-IP rate limit yet.** Default Caddy build does not include the
  `rate_limit` module. Step 4 ships **TLS + bind-to-localhost + standard Caddy
  connection limits only**. To enforce 30 req/min/IP, build Caddy with
  `xcaddy build --with github.com/mholt/caddy-ratelimit` and add a `rate_limit`
  block — tracked as a Hafte-2 followup.
- **Step 3 verification is mandatory.** The script runs `ss` after restart and
  exits non-zero if port 8545 is still on `0.0.0.0` — but you must still confirm
  externally with `curl -m 5 http://<vps-ip>:8545/` returning connection refused.
- **Backup is stop-tar-restart**, ~30s downtime nightly. Acceptable for a
  single-validator closed beta. Mainnet should switch to RocksDB native
  checkpoint API or a follower node taking the snapshot.

## Verification after run

```bash
# Step 1: key file lockdown
stat -c '%a %U:%G %n' /root/.zebvix/validator.key
# expected: 400 root:root /root/.zebvix/validator.key

# Step 2: backups
ls -lh /var/backups/zebvix/
# Empty until 03:00; trigger immediately to test:
sudo /usr/local/sbin/zebvix-backup.sh
ls -lh /var/backups/zebvix/

# Step 3: RPC bound to localhost only
ss -ltnp | grep 8545
# expected: 127.0.0.1:8545 (NOT 0.0.0.0:8545 or :::8545)

# Step 3 sanity: external RPC from your laptop should now FAIL
curl -m 5 http://srv1266996.hstgr.cloud:8545/ -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}' -H 'content-type: application/json'
# expected: connection refused / timeout

# Step 4: TLS RPC works
curl https://rpc.zebvix.example/ -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}' -H 'content-type: application/json'
# expected: {"jsonrpc":"2.0","id":1,"result":"0x..."}
```

## Per-step rollback

### Step 1 — key file mode
Pre-state was captured to `/var/lib/zebvix/hafta1-state/validator-key.pre`.
```bash
cat /var/lib/zebvix/hafta1-state/validator-key.pre
# mode=600
# owner=root:root
# file=/root/.zebvix/validator.key
# recorded_at=<TS>

# Reapply original mode + owner from that file:
source <(awk -F= '/^(mode|owner)=/{print $1"=\""$2"\""}' /var/lib/zebvix/hafta1-state/validator-key.pre)
chown "$owner" /root/.zebvix/validator.key
chmod  "$mode" /root/.zebvix/validator.key
```

### Step 2 — backup cron
```bash
rm /etc/cron.d/zebvix-backup
rm /usr/local/sbin/zebvix-backup.sh
```
Existing snapshots in `/var/backups/zebvix/` are kept until you delete them.

### Step 3 — RPC binding
```bash
# Find the backup
ls /etc/systemd/system/zebvix.service.pre-hafta1.bak.*
# Restore
cp /etc/systemd/system/zebvix.service.pre-hafta1.bak.<TIMESTAMP> /etc/systemd/system/zebvix.service
systemctl daemon-reload
systemctl restart zebvix.service
```

### Step 4 — Caddy
```bash
systemctl stop caddy
systemctl disable caddy
# Restore previous Caddyfile if there was one:
cp /etc/caddy/Caddyfile.pre-hafta1.bak.<TIMESTAMP> /etc/caddy/Caddyfile  # if exists
# Or remove entirely:
apt-get remove caddy
```

## After the script — wallet RPC URL

Once Step 4 is live and `https://$RPC_DOMAIN/` responds, update
`mobile/zebvix_wallet/lib/core/chains.dart`:

```dart
static const zebvix = ChainConfig(
  ...
  rpcUrl: 'https://rpc.zebvix.example',  // was http://93.127.213.192:8545
  explorerUrl: 'https://rpc.zebvix.example',
  ...
);
```

Then rebuild + redistribute the wallet APK.

## Known limitations (Hafte-1 scope)

- Backup uses a 30-second `systemctl stop` window — fine for a single-validator
  closed beta; for mainnet swap to RocksDB native checkpoint API or a follower
  node taking the snapshot.
- Caddy rate-limit module is not installed by default. Install separately if
  needed: `caddy add-package github.com/mholt/caddy-ratelimit`.
- Single-node, no remote signer — see `HARDENING_TODO.md` C1/C3 for the path
  to multi-validator + HSM signing.
