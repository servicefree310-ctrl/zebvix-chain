# Zebvix Bridge — VPS Deployment Package

Single-VPS deployment of the bridge relayer + 5 validator signers, alongside
your existing `zebvix-node` chain. Production-grade systemd units, hardened,
with proper key isolation.

## What this is

```
              ┌─────────────────────────────────────────────────┐
              │ VPS (your existing zebvix-node host)            │
              │                                                  │
              │  zebvix-node (port 8545)                         │
              │       ▲                                          │
              │       │ http://127.0.0.1:8545                    │
              │       │                                          │
              │  zbx-relayer.service (port 8765)                 │
              │       │                                          │
              │       │ http://127.0.0.1:9001..9005              │
              │       ▼                                          │
              │  zbx-signer@1..5.service (loopback only)         │
              │                                                  │
              └─────────────────────────────────────────────────┘
                          │
                          ▼  https://bsc-dataseed.binance.org
                       BSC mainnet (ZebvixBridge contract)
```

## Files

```
lib/bridge-deployment/
├─ README.md               ← this file
├─ genkeys.sh              ← run on YOUR LAPTOP, never on VPS
├─ install-vps.sh          ← run on VPS as root (one-shot installer)
├─ systemd/
│  ├─ zbx-relayer.service
│  └─ zbx-signer@.service
└─ env-templates/
   ├─ relayer.env.template
   └─ signer.env.template
```

## Step-by-step

### 1. Generate validator keys (LAPTOP, offline-ish)

On your laptop (not the VPS, not Replit, not anything connected to a chain):

```bash
N=5 bash lib/bridge-deployment/genkeys.sh > validators.json
```

Output is a JSON array of `{index, address, private_key, mnemonic}`. Two
files to make from this:

- `validators.public.txt` — comma-separated **addresses only**:
  ```
  0xVAL1,0xVAL2,0xVAL3,0xVAL4,0xVAL5
  ```
  Send this to whoever runs the deploy (you / me).
- `validators.json` — the full file with private keys. Encrypt and store
  in a password manager + offline backup. NEVER paste into chat / git /
  Slack. NEVER copy to the VPS in plaintext (use `scp` over SSH).

### 2. Deploy a Gnosis Safe on BSC mainnet

Go to https://app.safe.global → Create new Safe on BNB Smart Chain.
Recommended: 3-of-5 multisig with hardware-wallet owners. Note the Safe
address (e.g. `0xSAFE…`). This will own the bridge.

### 3. Deploy the BSC contracts

This step needs your funded `BSC_DEPLOYER_PRIVATE_KEY` (≥ 0.02 BNB) and the
addresses from steps 1 + 2. It can run from any machine with BSC
mainnet access (including Replit's shell). See `../bsc-contracts/DEPLOY.md`
section "Mainnet deploy".

After the deploy you'll have `WrappedZBX` + `ZebvixBridge` addresses and
the bridge deploy block — record these, you need them for the env files.

### 4. Run the VPS installer

SSH into the VPS as root (or use sudo). The repo must be cloned at
`/opt/zebvix` (override with `REPO=/your/path`):

```bash
cd /opt/zebvix
git pull            # or however you sync the repo
sudo bash lib/bridge-deployment/install-vps.sh
```

The script:
- installs Node.js 20 + pnpm if missing
- runs `pnpm install` filtered to relayer + signer
- typechecks both
- creates `zbx-bridge` system user
- creates `/etc/zbx-bridge/` (env files, chmod 600) and `/var/lib/zbx-bridge/` (sqlite)
- installs the two systemd units (`zbx-relayer.service`, `zbx-signer@.service`)

### 5. Fill the env files

```bash
sudo nano /etc/zbx-bridge/relayer.env
sudo nano /etc/zbx-bridge/signer-1.env
sudo nano /etc/zbx-bridge/signer-2.env
sudo nano /etc/zbx-bridge/signer-3.env
sudo nano /etc/zbx-bridge/signer-4.env
sudo nano /etc/zbx-bridge/signer-5.env
```

Replace every `___FILL___` placeholder with the right value:

| Placeholder | Source |
|---|---|
| `___FILL_ZEBVIX_ADMIN_PRIVATE_KEY___` (relayer.env) | The genesis admin key for `0x40907000…0315`, only on this VPS |
| `___FILL_RELAYER_BSC_PRIVATE_KEY___` (relayer.env) | Funded BSC EOA you generated for the relayer |
| `___FILL_AFTER_DEPLOY___` (3 places) | From `lib/bsc-contracts/deployments/bsc/addresses.json` |
| `___FILL_VALIDATOR_PRIVATE_KEY_INDEX_N___` (signer-N.env) | Entry `index: N` from your `validators.json` |

### 6. Start the services

```bash
sudo systemctl enable --now zbx-relayer
sudo systemctl enable --now zbx-signer@1 zbx-signer@2 zbx-signer@3 zbx-signer@4 zbx-signer@5
```

### 7. Verify

```bash
# Relayer
curl -s http://127.0.0.1:8765/health | jq
# Each signer
for i in 1 2 3 4 5; do
  echo "── signer $i ──"
  curl -s http://127.0.0.1:$((9000 + i))/health | jq
done
# Logs
journalctl -u zbx-relayer -f
journalctl -u 'zbx-signer@*' -f
```

If `/health` returns the validator address that matches your
`validators.public.txt`, the signer is correctly configured.

### 8. Wire the dashboard

In Replit, set these env vars on the api-server (already prepared as a
follow-up step — the agent will set them after deploy):

```
BSC_CHAIN_ID=56
BSC_PUBLIC_RPC=https://bsc-dataseed.binance.org
BSC_EXPLORER=https://bscscan.com
BSC_WZBX_ADDRESS=0x…           # from deployments
BSC_BRIDGE_ADDRESS=0x…         # from deployments
BRIDGE_RELAYER_URL=http://93.127.213.192:8765   # if relayer is exposed publicly
```

If the relayer stays on `127.0.0.1` only (recommended), the dashboard
relayer-status indicator will be red — that's fine for production. Open
port 8765 only if you want public health visibility, behind a reverse
proxy with auth.

## Operations

| Action | Command |
|---|---|
| Restart relayer | `sudo systemctl restart zbx-relayer` |
| Restart one signer | `sudo systemctl restart zbx-signer@3` |
| Stop everything | `sudo systemctl stop zbx-relayer 'zbx-signer@*'` |
| Tail relayer log | `journalctl -u zbx-relayer -f` |
| Tail all signer logs | `journalctl -u 'zbx-signer@*' -f` |
| Disable a validator | Stop its signer + Safe-execute `removeValidator(0x…)` |
| Pause bridge | Safe-execute `pause()` on ZebvixBridge |

## Security checklist (do this BEFORE any real funds flow)

- [ ] All 5 `validators.json` private keys are stored offline and encrypted.
- [ ] `chmod 600` on every `/etc/zbx-bridge/*.env` — verify with `ls -la /etc/zbx-bridge`.
- [ ] `zbx-bridge` system user owns both `/etc/zbx-bridge/` and `/var/lib/zbx-bridge/`.
- [ ] Firewall blocks inbound 8765, 9001-9005 from the public internet
      (`ufw status` or `iptables -L`).
- [ ] BSC Bridge `owner()` is the Gnosis Safe — verified on BscScan.
- [ ] wZBX `MINTER_ROLE` is held only by the bridge contract — verified on BscScan.
- [ ] Relayer EOA has minimum BNB (refill with a tx, not a key swap).
- [ ] Pause-recovery drill: Safe executes `pause()`, mints revert, then `unpause()`.
- [ ] Monitoring: alert if any signer `/health` is down for > 60s.
