# zebvix.js

Official TypeScript SDK for the **Zebvix L1 blockchain** — a thin, type-safe wrapper around `ethers.js v6` that exposes Zebvix-native `zbx_*` RPC methods alongside the standard Ethereum-spec (`eth_*` / `net_*` / `web3_*`) namespace. The Zebvix execution layer (ZVM) is Cancun-EVM-bytecode compatible, so MetaMask, Hardhat, Foundry, ethers and viem all work zero-config.

## Why use this SDK?

- **Drop-in `ethers.js` compatibility** — `ZebvixProvider` extends `JsonRpcProvider`, `ZebvixWallet` extends `Wallet`. All standard ZVM operations work unchanged.
- **Native `zbx_*` access** — typed wrappers for 60+ Zebvix-specific RPC methods (governance, multisig, AMM, bridge, staking, Pay-ID).
- **Built-in chain config** — `ZEBVIX_MAINNET` constant with chain ID, RPC URL, precompile addresses.
- **Tiny surface area** — only depends on `ethers ^6.13`.

## Install

```bash
pnpm add @zebvix/zebvix.js ethers
# or
npm install @zebvix/zebvix.js ethers
```

## Quickstart

```ts
import { ZebvixProvider, ZebvixWallet, parseZBX, formatZBX } from "@zebvix/zebvix.js";

const provider = new ZebvixProvider();
// equivalent to: new ZebvixProvider({ rpcUrl: "http://93.127.213.192:8545" })

// Native zbx_* RPC
const tip = await provider.getZbxBlockNumber();
console.log(`Block #${tip.height}`);

const proposals = await provider.listProposals(10);
const flags = await provider.listFeatureFlags();
const pool = await provider.getPool();

// Wallet
const wallet = new ZebvixWallet(process.env.ZBX_PRIVATE_KEY!, provider);
console.log("Balance:", formatZBX(await wallet.getZbxBalance()), "ZBX");

// Standard ZVM transfer (inherited from ethers.Wallet — same wire format
// as Ethereum, so any wallet/library that speaks EVM speaks Zebvix).
const tx = await wallet.sendTransaction({
  to: "0xRecipient...",
  value: parseZBX("1.5"),
});
await tx.wait();

// Look up the tx + receipt by hash — uses standard eth_getTransactionByHash /
// eth_getTransactionReceipt under the hood (added in Phase C.2.1). Native
// recent-tx ring buffer also exposed via provider.recentTxs(limit).
const txInfo = await provider.getTransaction(tx.hash);
const receipt = await provider.getTransactionReceipt(tx.hash);
console.log("Status:", receipt?.status, "Block:", receipt?.blockNumber);
```

## API surface

### Chain constants

| Export             | Type             | Description                                     |
| ------------------ | ---------------- | ----------------------------------------------- |
| `ZEBVIX_MAINNET`   | `ZebvixChainInfo`| Chain ID 7878, ZBX symbol, 18 decimals, RPC URL |
| `PRECOMPILES`      | `const`          | Built-in addresses 0x80 – 0x83                  |
| `ZBX_DECIMALS`     | `18`             | Native token decimals                           |

### Units

```ts
parseZBX("1.5")        // → 1500000000000000000n
formatZBX(1500000000000000000n)  // → "1.5"
parseGwei("20")        // → 20000000000n
formatGwei(20000000000n)         // → "20.0"
```

### `ZebvixProvider` — full method list

**Identity:** `getClientVersion`, `getZbxClientVersion`, `getZbxChainInfo`, `getZbxNetVersion`, `getSyncing`

**Block / Tx:** `getZbxBlockNumber`, `getZbxBlockByNumber`, `recentTxs`, `zbxCall`, `zbxEstimateGas`

**Account:** `getZbxBalance`, `getZbxNonce`, `getZbxCode`, `getZbxStorageAt`, `getZbxAccounts`

**Pay-ID:** `lookupPayId`, `getPayIdOf`, `getPayIdCount`

**Governance:** `listProposals`, `getProposal`, `checkProposer`, `hasVoted`, `shadowExecProposal`, `listFeatureFlags`, `getFeatureFlag`, `getVoteStats`, `getGovernor`, `getAdmin`

**Multisig:** `getMultisig`, `getMultisigProposal`, `getMultisigProposals`, `listMultisigsByOwner`, `getMultisigCount`

**AMM / Pool:** `getPool`, `getPoolStats`, `swapQuote`, `recentSwaps`, `getLpBalance`, `getZusdBalance`, `toZusd`

**Bridge:** `listBridgeNetworks`, `getBridgeNetwork`, `listBridgeAssets`, `getBridgeAsset`, `getBridgeStats`, `isBridgeClaimUsed`, `recentBridgeOutEvents`

**Staking:** `getStaking`, `getStakingValidator`, `listValidators`, `getValidator`, `getDelegation`, `getDelegationsByDelegator`, `getLockedRewards`

**Stats:** `getSupply`, `getReserveWei`, `getUsdPrice`, `getPriceUSD`, `getBurnStats`

**Mempool:** `getMempoolPending`, `getMempoolStatus`

**Fees:** `getZbxGasPrice`, `getBlobBaseFee`, `getFeeBounds`, `getZbxFeeHistory`

**Logs:** `getZbxLogs`

**Tx submit:** `sendRawZbxTransaction` (native bincode path), `sendRawZvmTransaction` (RLP path — same wire format as `eth_sendRawTransaction`), `getZvmReceipt` (alias for `eth_getTransactionReceipt`)

### `ZebvixWallet` helpers

```ts
wallet.getZbxBalance()      // → bigint
wallet.getZbxNonce()        // → bigint
wallet.getZusdBalance()     // → bigint
wallet.getLpBalance()       // → bigint
wallet.getMyPayId()         // → PayIdRecord | null
wallet.listMyMultisigs()    // → Address[]
```

Plus everything from `ethers.Wallet` (`sendTransaction`, `signMessage`, `signTypedData`, `connect`, etc.).

## Network

| Network | Chain ID  | RPC                              |
| ------- | --------- | -------------------------------- |
| Mainnet | 7878 (`0x1ec6`) | `http://93.127.213.192:8545` |

## License

MIT
