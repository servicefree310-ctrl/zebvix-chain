# @workspace/bsc-contracts

Solidity contracts for the Zebvix ↔ BSC cross-chain bridge.

## Contracts

- **`WrappedZBX.sol`** — BEP-20 wrapped ZBX on BSC. 18 decimals. Mint restricted to the bridge contract via `MINTER_ROLE`. Holders may burn their own balance.
- **`ZebvixBridge.sol`** — Holds the validator set (M-of-N), threshold, and source-tx-hash replay protection. Verifies EIP-712 signatures on every mint. Owner is intended to be a Gnosis Safe multisig (governance: add/remove validators, change threshold, pause).

## Quickstart

```bash
pnpm --filter @workspace/bsc-contracts run compile
pnpm --filter @workspace/bsc-contracts run test
pnpm --filter @workspace/bsc-contracts run deploy:testnet
```

See [DEPLOY.md](./DEPLOY.md) for the full production deployment runbook.

## Trust model

- **Outbound (BSC → Zebvix)**: user burns wZBX → relayer detects `BurnToZebvix` event → submits `zbx_submitBridgeIn` (Zebvix admin attestation today; multisig oracle on roadmap).
- **Inbound (Zebvix → BSC)**: user locks ZBX on Zebvix → relayer collects M-of-N validator signatures over EIP-712 typed `MintRequest` → submits one aggregated `mintFromZebvix` tx to BSC.

A single compromised validator key cannot mint. M validators must independently sign the same `(sourceTxHash, recipient, amount)` tuple. The `consumed` mapping prevents replay.

Governance (rotate validators, change threshold, pause) requires the Gnosis Safe owner — typically a separate M-of-N Safe wallet with the project's principals as signers.
