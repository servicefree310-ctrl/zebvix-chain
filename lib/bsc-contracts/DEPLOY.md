# BSC ↔ Zebvix Bridge — Deployment Runbook

This is the step-by-step guide for getting the BSC side of the bridge from
zero to mainnet. Read it end-to-end before starting.

## Architecture summary

```
                ┌──────────────────────────┐
   user ────►   │ Zebvix L1 (chain 7878)   │   user signs locally
                │  TxKind::Bridge::OutLock │
                │  → escrow vault          │
                └──────────┬───────────────┘
                           │ BridgeOutEvent
                           ▼
            ┌──────────────────────────────┐
            │ bridge-relayer (off-chain)    │
            │  - polls zbx_recentBridgeOut  │
            │  - asks each bridge-signer    │
            │    for an EIP-712 sig         │
            │  - aggregates M-of-N          │
            │  - submits mintFromZebvix     │
            └──────────┬───────────────────┘
                       │ M signatures
                       ▼
            ┌──────────────────────────────┐
            │ ZebvixBridge (BSC contract)   │
            │  verifies M unique validator  │
            │  sigs + replay protection,    │
            │  calls wZBX.mint(recipient)   │
            └──────────┬───────────────────┘
                       ▼
                user receives wZBX (BEP-20)
```

Reverse direction (BSC → Zebvix): user calls `burnToZebvix` on the bridge
contract, the relayer detects the `BurnToZebvix` event after BSC
confirmations and submits `zbx_submitBridgeIn` to release the native ZBX.

## Trust model

- **wZBX (BEP-20)** — only `MINTER_ROLE` (= the bridge contract) can mint.
  Admin/pauser is the governance Safe.
- **ZebvixBridge** — `mintFromZebvix` requires M-of-N validator signatures
  (EIP-712), unique per validator, and rejects already-consumed source-tx
  hashes. Owner = governance Safe (a Gnosis Safe multisig).
- **Validator signers** — each runs in isolation with its own private key.
  Each independently verifies the source Zebvix BridgeOut tx exists and
  matches recipient/amount before signing — so a malicious relayer
  cannot trick honest validators into signing fake mints.

## Prerequisites

Before you start:

1. **Validator keypairs** — generate N (e.g. 5) BSC EOA keypairs. Each one
   must run on isolated infrastructure (separate VPS, separate cloud
   account, separate humans-with-access). Funded with a tiny amount of BNB
   for occasional ops; *never* hold the bridge's funds.
2. **Relayer EOA** — one BSC EOA, funded with enough BNB to cover gas for
   `mintFromZebvix` txs (each is ~150-300k gas depending on signature
   count). Holds NO authority — the bridge only checks signatures, not
   `msg.sender`.
3. **Governance Safe** — deploy a Gnosis Safe on BSC for ownership of the
   bridge. Recommended: 3-of-5 with separate operators. Required for
   mainnet; for testnet you can temporarily use a deployer EOA.
4. **Deployer EOA** — funded with BNB. This is the address that submits
   the contract creation txs.
5. **Zebvix RPC URL** — should already be reachable (e.g. dashboard's
   `/api/rpc` proxy or direct VPS).
6. **ZBX bridge asset id** — the `asset_id` returned by
   `zbx_listBridgeAssets` on Zebvix for the ZBX-on-BSC pairing. If it
   doesn't exist yet, register the BSC network and the ZBX/BSC asset on
   the Zebvix side first.

## 1. Compile + test contracts

```bash
cd lib/bsc-contracts
pnpm install
pnpm run compile
pnpm run test            # 22 tests, ~3s
```

All tests must pass before going further.

## 2. Deploy to BSC testnet

Set required env vars:

```bash
export BSC_DEPLOYER_PRIVATE_KEY=0x...         # funded with tBNB
export BSC_TESTNET_RPC=https://data-seed-prebsc-1-s1.binance.org:8545
export BRIDGE_OWNER=0x...                      # Safe address (or deployer for testnet)
export BRIDGE_VALIDATORS=0xVAL1,0xVAL2,0xVAL3,0xVAL4,0xVAL5
export BRIDGE_THRESHOLD=3                      # 3-of-5
export ZEBVIX_CHAIN_ID=7878
# Optional: export WZBX_ADMIN=$BRIDGE_OWNER (defaults to BRIDGE_OWNER)

pnpm exec hardhat run --network bscTestnet scripts/deploy.ts
```

Output is written to `deployments/bscTestnet/addresses.json`. Note the
`WrappedZBX` and `ZebvixBridge` addresses.

If `WZBX_ADMIN` is the same as the deployer, the script grants
`MINTER_ROLE` automatically. If it's the Safe, you'll see a manual
instruction printed — execute the `grantRole` call from the Safe before
the bridge can mint.

### Verify on BscScan

```bash
export BSCSCAN_API_KEY=...
pnpm exec hardhat run --network bscTestnet scripts/verify.ts
```

## 3. Run the validator signers (one per validator)

For each validator, on its dedicated host:

```bash
cd lib/bridge-signer
pnpm install
export PORT=9001
export VALIDATOR_KEY=0x...                          # this validator's key
export BSC_CHAIN_ID=97                              # 97 testnet, 56 mainnet
export BSC_BRIDGE_ADDRESS=0x...                     # from deployments file
export ZEBVIX_RPC=https://...                       # Zebvix RPC the signer will independently verify against
export ZEBVIX_CHAIN_ID=7878
export ZEBVIX_ZBX_ASSET_ID=...                      # the ZBX/BSC asset id
export AUTH_TOKEN=$(openssl rand -hex 16)           # share this with relayer config below
export NODE_ENV=production
pnpm run start
```

Test it:

```bash
curl -s http://localhost:9001/health
# { "ok": true, "validator_address": "0x...", "bsc_chain_id": 97, ... }
```

Repeat for each of the N validators. Use a different `PORT` and
`VALIDATOR_KEY` per host. Place each behind TLS (e.g. caddy) and a
firewall that only allows the relayer's IP.

## 4. Run the relayer

```bash
cd lib/bridge-relayer
pnpm install
export PORT=8765
export ZEBVIX_RPC=https://...
export ZEBVIX_CHAIN_ID=7878
export ZEBVIX_ZBX_ASSET_ID=...                      # same as signers
export ZEBVIX_POLL_MS=8000
export BSC_RPC=https://data-seed-prebsc-1-s1.binance.org:8545  # or mainnet
export BSC_CHAIN_ID=97                              # 97 testnet, 56 mainnet
export BSC_BRIDGE_ADDRESS=0x...                     # from deployments
export BSC_WZBX_ADDRESS=0x...                       # from deployments
export BSC_RELAYER_KEY=0x...                        # relayer EOA, funded with BNB
export BSC_BURN_CONFIRMATIONS=15
export BSC_START_BLOCK=...                          # the bridge contract's deploy block
export SIGNER_ENDPOINTS=https://val1.example:9001,https://val2.example:9001,https://val3.example:9001,https://val4.example:9001,https://val5.example:9001
export SIGNER_TIMEOUT_MS=15000
export DB_PATH=/var/lib/zbx-relayer/relayer.sqlite
export NODE_ENV=production
pnpm run start
```

Test it:

```bash
curl -s http://localhost:8765/health | jq
# {
#   "ok": true,
#   "relayer_address": "0x...",
#   "bsc": {
#     "chain_id": 97, "bridge": "0x...", "wzbx": "0x...",
#     "head_block": ..., "threshold": 3
#   },
#   "signers": { "count": 5, "endpoints": [...] },
#   "stats": { "zebvix": {...}, "bsc": {...} }
# }
```

If the relayer can't reach a signer, you'll see a clear log line with
the failing endpoint URL — fix the firewall/TLS and the relayer recovers
on the next tick.

## 5. Wire the dashboard

In the api-server's environment (Replit secrets or .env):

```
BSC_CHAIN_ID=97
BSC_CHAIN_NAME=BNB Smart Chain Testnet
BSC_PUBLIC_RPC=https://data-seed-prebsc-1-s1.binance.org:8545
BSC_EXPLORER=https://testnet.bscscan.com
BSC_WZBX_ADDRESS=0x...
BSC_BRIDGE_ADDRESS=0x...
BRIDGE_RELAYER_URL=http://relayer-host:8765
ZEBVIX_ZBX_ASSET_ID=...
```

Restart the api-server. The `/bridge-live` page now shows the BSC side
panel with contract addresses, "Add wZBX to MetaMask", live wZBX
balance, and the burn-back form.

## 6. End-to-end testnet verification

1. Open `/bridge-live` in the dashboard, connect Zebvix wallet (browser).
2. Submit a small BridgeOut (e.g. 1 ZBX). The tx is signed locally.
3. Watch the relayer log — it should detect the event within ~10s, ask
   each signer for a signature, collect M sigs, and submit `mintFromZebvix`.
4. Open BscScan with the relayer tx hash; should show wZBX minted to
   your destination address.
5. Connect MetaMask in the BSC side panel. Click "Add wZBX". Your
   testnet balance shows the minted amount.
6. Use the burn-back form to send wZBX back to your Zebvix address.
   First click approves the bridge, second click burns. The BSC tx hash
   is shown immediately.

## 6.5. Mainnet deploy — chosen path: 3-of-5 validators + Gnosis Safe + single-VPS relayer/signers

This section is the canonical sequence for the production deploy decided
in this project: **mainnet, 3-of-5 multisig, Safe-owned bridge, all
relayer/signers on the existing zebvix-node VPS**.

### Step A — generate 5 validator keypairs (LAPTOP, offline)

On your local machine (NOT the VPS, NOT Replit):

```bash
N=5 bash lib/bridge-deployment/genkeys.sh > validators.json
chmod 600 validators.json
```

Encrypt + back up `validators.json`. Extract the 5 public addresses (you'll
need them in step C):

```bash
node -e 'JSON.parse(require("fs").readFileSync("validators.json")).forEach(v => console.log(v.address))'
```

### Step B — deploy a Gnosis Safe on BSC mainnet

Open https://app.safe.global, switch to BNB Smart Chain, create a new
Safe (recommended: 3-of-5 owners with hardware wallets, separate from
the validator keys). Note the Safe address (`0xSAFE…`).

### Step C — provide the deploy inputs

The agent will request these from you:

- **`BSC_DEPLOYER_PRIVATE_KEY`** — funded BSC EOA (≥ 0.02 BNB), one-time
  use, can be rotated immediately after deploy (Replit secret).
- **`BRIDGE_OWNER`** — the Safe address from step B (env var, not secret).
- **`BRIDGE_VALIDATORS`** — the 5 validator addresses from step A,
  comma-separated (env var, not secret).

### Step D — agent runs the mainnet deploy

```bash
export BRIDGE_THRESHOLD=3
export ZEBVIX_CHAIN_ID=7878
export WZBX_ADMIN=$BRIDGE_OWNER          # Safe also owns wZBX
pnpm --filter @workspace/bsc-contracts exec hardhat run --network bsc scripts/deploy.ts
```

⚠️ Because `WZBX_ADMIN` = Safe ≠ deployer, the script will print a manual
`grantRole(MINTER_ROLE, bridgeAddress)` call. **You must execute this
from the Safe** before any mints can land. Do this via the Safe UI as
the first transaction.

Output lands at `lib/bsc-contracts/deployments/bsc/addresses.json`.
Record:

- `WrappedZBX` address → goes into `BSC_WZBX_ADDRESS`
- `ZebvixBridge` address → goes into `BSC_BRIDGE_ADDRESS`
- Deploy block → goes into `BSC_START_BLOCK` on the VPS relayer

### Step E — agent wires the dashboard

Sets in api-server (Replit shared env):

```
BSC_WZBX_ADDRESS=0x…
BSC_BRIDGE_ADDRESS=0x…
```

Restarts api-server. The /bridge-live page now shows real wZBX +
ZebvixBridge addresses with BscScan links.

### Step F — VPS install (on your zebvix-node host)

Follow `lib/bridge-deployment/README.md` from step 4 onward. Summary:

```bash
ssh root@93.127.213.192
cd /opt/zebvix          # or wherever you cloned the repo
git pull
sudo bash lib/bridge-deployment/install-vps.sh
# Edit /etc/zbx-bridge/relayer.env + signer-1..5.env (fill placeholders)
sudo systemctl enable --now zbx-relayer zbx-signer@{1,2,3,4,5}
```

### Step G — Safe-execute the post-deploy txs

From the Safe UI, send these in order:

1. `wZBX.grantRole(MINTER_ROLE, bridgeAddress)` — enables minting
2. (Optional, recommended) `wZBX.revokeRole(DEFAULT_ADMIN_ROLE, deployer)`
   — drops deployer from any wZBX authority. Safe keeps admin role.

### Step H — end-to-end mainnet smoke test

1. Lock 1 ZBX on Zebvix via `/bridge-live` form (small amount).
2. Watch relayer log on VPS — should detect within ~10s, collect 3 sigs,
   submit `mintFromZebvix`.
3. Check BscScan tx hash printed by the relayer; confirm `Transfer`
   event minting wZBX to the recipient.
4. Connect MetaMask in the dashboard's BSC side panel, "Add wZBX",
   confirm balance.
5. Burn 0.5 wZBX back to your Zebvix address. Watch relayer log —
   `BurnToZebvix` event detected after 15 confirmations, then
   `zbx_submitBridgeIn` released native ZBX.

If any step hangs > 5 min, check the relayer log for the failing
endpoint / RPC, fix, restart. The relayer is idempotent and resumes
where it left off.

## 7. Mainnet promotion checklist

Do NOT skip any of these for mainnet:

- [ ] Deploy a fresh Gnosis Safe (3-of-5 minimum, hardware wallets).
- [ ] Generate fresh validator keypairs on isolated infrastructure
      (separate operators, separate cloud accounts).
- [ ] Each validator signer runs behind TLS with `AUTH_TOKEN` set.
- [ ] Run the testnet flow for ≥1 week with multiple validators
      intentionally taken offline to verify M-of-N degradation works.
- [ ] Audit the deployed contract bytecode against a fresh local build
      (`hardhat verify` + manual byte comparison).
- [ ] Set `BRIDGE_OWNER=` to the Safe address before deploying.
- [ ] Set `WZBX_ADMIN=` to the Safe address as well (so the deployer
      EOA never holds wZBX admin powers).
- [ ] After deploy, verify on BscScan that wZBX `MINTER_ROLE` is held
      ONLY by the bridge contract, and `DEFAULT_ADMIN_ROLE` is held
      ONLY by the Safe.
- [ ] Verify `ZebvixBridge.owner()` is the Safe.
- [ ] Verify `ZebvixBridge.validators()` returns the expected N
      addresses and `threshold()` is M.
- [ ] Pause-recovery drill: have governance pause the bridge, confirm
      mints/burns revert with `EnforcedPause`, then unpause.
- [ ] Set up monitoring/alerts on the relayer `/health` endpoint and on
      each signer's `/health` endpoint.
- [ ] Document an incident-response runbook (which Safe signers to
      page, how to rotate a compromised validator, how to pause).

## 8. Governance operations (Safe-signed)

All of these are `onlyOwner` calls on `ZebvixBridge`. Submit them as Safe
transactions from your governance multisig.

- **Add validator**: `addValidator(0xNewValidatorAddress)`
- **Remove validator**: `removeValidator(0xOldValidatorAddress)`
  (cannot drop count below `threshold`)
- **Change threshold**: `setThreshold(newM)` (must be ≤ validator count)
- **Pause / unpause**: `pause()` / `unpause()`
- **Rotate bridge contract**: deploy a new `ZebvixBridge`, then on wZBX
  call `grantMinter(newBridge)` and `revokeMinter(oldBridge)`. Update
  api-server env to point at the new bridge.

## Files reference

- `contracts/WrappedZBX.sol` — BEP-20 wZBX
- `contracts/ZebvixBridge.sol` — multisig bridge
- `scripts/deploy.ts` — deploys both + grants MINTER_ROLE if possible
- `scripts/verify.ts` — verifies both on BscScan
- `test/ZebvixBridge.test.ts` + `test/WrappedZBX.test.ts` — full suite
- `lib/bridge-relayer/` — off-chain orchestrator
- `lib/bridge-signer/` — per-validator signing daemon
- `artifacts/sui-fork-dashboard/src/components/bridge/BscSidePanel.tsx` — UI
