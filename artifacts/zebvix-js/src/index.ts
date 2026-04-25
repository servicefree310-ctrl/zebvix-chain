// ── Chain & precompiles ────────────────────────────────────────────────
export { ZEBVIX_MAINNET, type ZebvixChainInfo } from "./chain.js";
export {
  PRECOMPILES,
  type PrecompileName,
  type PrecompileAddress,
} from "./precompiles.js";

// ── Units ──────────────────────────────────────────────────────────────
export {
  ZBX_DECIMALS,
  GWEI_DECIMALS,
  parseZBX,
  formatZBX,
  parseGwei,
  formatGwei,
} from "./units.js";

// ── Types ──────────────────────────────────────────────────────────────
export type {
  Address,
  Hex,
  BlockInfo,
  SupplyInfo,
  ProposalStatus,
  ProposalKindJson,
  ProposalSummary,
  ProposalsListResp,
  FeatureFlag,
  FeatureFlagsListResp,
  ProposerCheckResp,
  PayIdRecord,
  MultisigInfo,
  SwapDirection,
  SwapQuote,
  RecentSwap,
  BridgeNetwork,
  BridgeNetworksResp,
  CountResp,
  MempoolStatus,
  FeeBounds,
} from "./types.js";

// ── Provider & Wallet ──────────────────────────────────────────────────
export { ZebvixProvider, type ZebvixProviderOptions } from "./provider.js";
export { ZebvixWallet } from "./wallet.js";

// ── Convenient ethers re-exports ───────────────────────────────────────
export {
  Contract,
  Interface,
  isAddress,
  getAddress,
  hexlify,
  toUtf8Bytes,
  toUtf8String,
  keccak256,
  type ContractRunner,
  type Signer,
} from "ethers";
