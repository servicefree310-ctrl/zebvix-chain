import { JsonRpcProvider, Network } from "ethers";
import { ZEBVIX_MAINNET, type ZebvixChainInfo } from "./chain.js";
import type {
  Address,
  Hex,
  BlockInfo,
  SupplyInfo,
  ProposalsListResp,
  ProposalSummary,
  FeatureFlagsListResp,
  FeatureFlag,
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

export interface ZebvixProviderOptions {
  rpcUrl?: string;
  chain?: ZebvixChainInfo;
}

/**
 * ZebvixProvider — ethers.JsonRpcProvider extended with native zbx_* methods.
 *
 * All standard ethers methods (getBalance, getBlockNumber, etc.) work because
 * Zebvix exposes the full eth_, net_ and web3_ namespaces. The extra zbx_ methods
 * give you typed access to Zebvix-native data (proposals, multisigs, AMM, bridge,
 * staking, Pay-ID) that has no EVM equivalent.
 */
export class ZebvixProvider extends JsonRpcProvider {
  readonly chainInfo: ZebvixChainInfo;

  constructor(opts: ZebvixProviderOptions | string = {}) {
    const o: ZebvixProviderOptions =
      typeof opts === "string" ? { rpcUrl: opts } : opts;
    const chain = o.chain ?? ZEBVIX_MAINNET;
    const url = o.rpcUrl ?? chain.rpcUrl;
    const network = Network.from({ name: chain.name, chainId: chain.id });
    // staticNetwork prevents ethers from probing eth_chainId on every call
    super(url, network, { staticNetwork: network });
    this.chainInfo = chain;
  }

  // ── Identity ─────────────────────────────────────────────────────────
  async getClientVersion(): Promise<string> {
    return this.send("web3_clientVersion", []);
  }
  async getZbxClientVersion(): Promise<string> {
    return this.send("zbx_clientVersion", []);
  }
  async getZbxChainInfo(): Promise<unknown> {
    return this.send("zbx_chainInfo", []);
  }
  async getZbxNetVersion(): Promise<string> {
    return this.send("zbx_netVersion", []);
  }
  async getSyncing(): Promise<unknown> {
    return this.send("zbx_syncing", []);
  }

  // ── Block / Tx ───────────────────────────────────────────────────────
  async getZbxBlockNumber(): Promise<BlockInfo> {
    return this.send("zbx_blockNumber", []);
  }
  async getZbxBlockByNumber(height: number): Promise<unknown> {
    return this.send("zbx_getBlockByNumber", [height]);
  }
  async recentTxs(limit = 50): Promise<unknown> {
    return this.send("zbx_recentTxs", [limit]);
  }
  async zbxCall(
    callObj: unknown,
    blockTag: "latest" | number = "latest",
  ): Promise<Hex> {
    return this.send("zbx_call", [callObj, blockTag]);
  }
  async zbxEstimateGas(callObj: unknown): Promise<bigint> {
    const hex = await this.send("zbx_estimateGas", [callObj]);
    return BigInt(hex);
  }

  // ── Account ──────────────────────────────────────────────────────────
  async getZbxBalance(
    address: Address,
    blockTag: "latest" | number = "latest",
  ): Promise<bigint> {
    const hex: string = await this.send("zbx_getBalance", [address, blockTag]);
    return BigInt(hex);
  }
  async getZbxNonce(address: Address): Promise<bigint> {
    const hex: string = await this.send("zbx_getNonce", [address]);
    return BigInt(hex);
  }
  async getZbxCode(address: Address): Promise<Hex> {
    return this.send("zbx_getCode", [address]);
  }
  async getZbxStorageAt(address: Address, slot: Hex | bigint): Promise<Hex> {
    const slotHex =
      typeof slot === "bigint" ? (`0x${slot.toString(16)}` as Hex) : slot;
    return this.send("zbx_getStorageAt", [address, slotHex]);
  }
  async getZbxAccounts(): Promise<Address[]> {
    return this.send("zbx_accounts", []);
  }

  /** Send a request that may legitimately return null when the record doesn't exist. */
  protected async sendNullable<T>(
    method: string,
    params: unknown[],
  ): Promise<T | null> {
    try {
      return (await this.send(method, params)) as T;
    } catch (e) {
      if (isNotFoundRpcError(e)) return null;
      throw e;
    }
  }

  // ── Pay-ID ───────────────────────────────────────────────────────────
  async lookupPayId(payId: string): Promise<PayIdRecord | null> {
    return this.sendNullable<PayIdRecord>("zbx_lookupPayId", [payId]);
  }
  async getPayIdOf(address: Address): Promise<PayIdRecord | null> {
    return this.sendNullable<PayIdRecord>("zbx_getPayIdOf", [address]);
  }
  async getPayIdCount(): Promise<CountResp> {
    return this.send("zbx_payIdCount", []);
  }

  // ── Governance / Proposals ───────────────────────────────────────────
  async listProposals(limit = 50): Promise<ProposalsListResp> {
    return this.send("zbx_proposalsList", [limit]);
  }
  async getProposal(id: number): Promise<ProposalSummary | null> {
    return this.sendNullable<ProposalSummary>("zbx_proposalGet", [id]);
  }
  async checkProposer(address: Address): Promise<ProposerCheckResp> {
    return this.send("zbx_proposerCheck", [address]);
  }
  async hasVoted(proposalId: number, voter: Address): Promise<boolean> {
    return this.send("zbx_proposalHasVoted", [proposalId, voter]);
  }
  async shadowExecProposal(id: number): Promise<unknown> {
    return this.send("zbx_proposalShadowExec", [id]);
  }
  async listFeatureFlags(): Promise<FeatureFlagsListResp> {
    return this.send("zbx_featureFlagsList", []);
  }
  async getFeatureFlag(key: string): Promise<FeatureFlag | null> {
    return this.sendNullable<FeatureFlag>("zbx_featureFlagGet", [key]);
  }
  async getVoteStats(): Promise<unknown> {
    return this.send("zbx_voteStats", []);
  }
  async getGovernor(): Promise<unknown> {
    return this.send("zbx_getGovernor", []);
  }
  async getAdmin(): Promise<unknown> {
    return this.send("zbx_getAdmin", []);
  }

  // ── Multisig ─────────────────────────────────────────────────────────
  async getMultisig(address: Address): Promise<MultisigInfo | null> {
    return this.sendNullable<MultisigInfo>("zbx_getMultisig", [address]);
  }
  async getMultisigProposal(
    multisig: Address,
    proposalId: number,
  ): Promise<unknown> {
    return this.send("zbx_getMultisigProposal", [multisig, proposalId]);
  }
  async getMultisigProposals(multisig: Address): Promise<unknown> {
    return this.send("zbx_getMultisigProposals", [multisig]);
  }
  async listMultisigsByOwner(owner: Address): Promise<Address[]> {
    return this.send("zbx_listMultisigsByOwner", [owner]);
  }
  async getMultisigCount(): Promise<CountResp> {
    return this.send("zbx_multisigCount", []);
  }

  // ── AMM / Pool ───────────────────────────────────────────────────────
  async getPool(): Promise<unknown> {
    return this.send("zbx_getPool", []);
  }
  async getPoolStats(window = 200): Promise<unknown> {
    return this.send("zbx_poolStats", [window]);
  }
  async swapQuote(
    direction: SwapDirection,
    amountInWei: bigint | string,
  ): Promise<SwapQuote> {
    return this.send("zbx_swapQuote", [
      direction,
      typeof amountInWei === "bigint" ? amountInWei.toString() : amountInWei,
    ]);
  }
  async recentSwaps(limit = 10): Promise<{ swaps: RecentSwap[] }> {
    return this.send("zbx_recentSwaps", [limit]);
  }
  async getLpBalance(address: Address): Promise<bigint> {
    const hex: string = await this.send("zbx_getLpBalance", [address]);
    return BigInt(hex);
  }
  async getZusdBalance(address: Address): Promise<bigint> {
    const hex: string = await this.send("zbx_getZusdBalance", [address]);
    return BigInt(hex);
  }
  async toZusd(zbxWei: bigint | string): Promise<bigint> {
    const r: string = await this.send("zbx_to_zusd", [
      typeof zbxWei === "bigint" ? zbxWei.toString() : zbxWei,
    ]);
    return BigInt(r);
  }

  // ── Bridge ───────────────────────────────────────────────────────────
  async listBridgeNetworks(): Promise<BridgeNetworksResp> {
    return this.send("zbx_listBridgeNetworks", []);
  }
  async getBridgeNetwork(id: number): Promise<BridgeNetwork | null> {
    return this.sendNullable<BridgeNetwork>("zbx_getBridgeNetwork", [id]);
  }
  async listBridgeAssets(): Promise<unknown> {
    return this.send("zbx_listBridgeAssets", []);
  }
  async getBridgeAsset(id: number): Promise<unknown> {
    return this.send("zbx_getBridgeAsset", [id]);
  }
  async getBridgeStats(): Promise<unknown> {
    return this.send("zbx_bridgeStats", []);
  }
  async isBridgeClaimUsed(claim: Hex): Promise<boolean> {
    return this.send("zbx_isBridgeClaimUsed", [claim]);
  }
  async recentBridgeOutEvents(limit = 10): Promise<unknown> {
    return this.send("zbx_recentBridgeOutEvents", [limit]);
  }

  // ── Staking ──────────────────────────────────────────────────────────
  async getStaking(): Promise<unknown> {
    return this.send("zbx_getStaking", []);
  }
  async getStakingValidator(address: Address): Promise<unknown> {
    return this.send("zbx_getStakingValidator", [address]);
  }
  async listValidators(): Promise<unknown> {
    return this.send("zbx_listValidators", []);
  }
  async getValidator(address: Address): Promise<unknown> {
    return this.send("zbx_getValidator", [address]);
  }
  async getDelegation(
    delegator: Address,
    validator: Address,
  ): Promise<unknown> {
    return this.send("zbx_getDelegation", [delegator, validator]);
  }
  async getDelegationsByDelegator(delegator: Address): Promise<unknown> {
    return this.send("zbx_getDelegationsByDelegator", [delegator]);
  }
  async getLockedRewards(address: Address): Promise<unknown> {
    return this.send("zbx_getLockedRewards", [address]);
  }

  // ── Supply / Stats / Price ───────────────────────────────────────────
  async getSupply(): Promise<SupplyInfo> {
    return this.send("zbx_supply", []);
  }
  async getReserveWei(): Promise<bigint> {
    const r = await this.send("zbx_reserve_wei", []);
    return BigInt(r);
  }
  async getUsdPrice(): Promise<unknown> {
    return this.send("zbx_usd", []);
  }
  async getPriceUSD(): Promise<unknown> {
    return this.send("zbx_getPriceUSD", []);
  }
  async getBurnStats(): Promise<unknown> {
    return this.send("zbx_getBurnStats", []);
  }

  // ── Mempool ──────────────────────────────────────────────────────────
  async getMempoolPending(limit = 100): Promise<unknown> {
    return this.send("zbx_mempoolPending", [limit]);
  }
  async getMempoolStatus(): Promise<MempoolStatus> {
    return this.send("zbx_mempoolStatus", []);
  }

  // ── Fees ─────────────────────────────────────────────────────────────
  async getZbxGasPrice(): Promise<bigint> {
    const hex: string = await this.send("zbx_gasPrice", []);
    return BigInt(hex);
  }
  async getBlobBaseFee(): Promise<bigint> {
    const hex: string = await this.send("zbx_blobBaseFee", []);
    return BigInt(hex);
  }
  async getFeeBounds(): Promise<FeeBounds> {
    return this.send("zbx_feeBounds", []);
  }
  async getZbxFeeHistory(
    blockCount: number,
    newestBlock: "latest" | number = "latest",
    rewardPercentiles: number[] = [],
  ): Promise<unknown> {
    return this.send("zbx_feeHistory", [
      blockCount,
      newestBlock,
      rewardPercentiles,
    ]);
  }

  // ── Logs ─────────────────────────────────────────────────────────────
  async getZbxLogs(filter: unknown): Promise<unknown> {
    return this.send("zbx_getLogs", [filter]);
  }

  // ── Tx submission ────────────────────────────────────────────────────
  /**
   * Submit a hex-encoded native Zebvix transaction (TxEnvelope bincode).
   * For standard EVM transactions, use `sendRawEvmTransaction()` or
   * `wallet.sendTransaction()` (inherited from ethers.Wallet).
   */
  async sendRawZbxTransaction(hexTx: Hex | string): Promise<Hex> {
    return this.send("zbx_sendRawTransaction", [hexTx]);
  }
  /** EVM-format raw transaction submit (RLP-encoded). */
  async sendRawEvmTransaction(hexTx: Hex | string): Promise<Hex> {
    return this.send("zbx_sendRawEvmTransaction", [hexTx]);
  }
  async getEvmReceipt(txHash: Hex): Promise<unknown> {
    return this.send("zbx_getEvmReceipt", [txHash]);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────
function isNotFoundRpcError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  // ethers v6 wraps node errors; the inner code lives at err.error.code
  const inner = (e as { error?: { code?: number; message?: string } }).error;
  if (inner?.code === -32004) return true;
  const msg = (e as Error).message ?? "";
  return /no Pay-ID|not found|does not exist/i.test(msg);
}
