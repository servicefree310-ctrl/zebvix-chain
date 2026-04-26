import { ethers, Contract, JsonRpcProvider, Wallet } from "ethers";

const BRIDGE_ABI = [
  "function mintFromZebvix(tuple(bytes32 sourceTxHash, address recipient, uint256 amount, uint256 sourceChainId, uint64 sourceBlockHeight) req, bytes[] signatures)",
  "function consumed(bytes32) view returns (bool)",
  "function threshold() view returns (uint256)",
  "function validators() view returns (address[])",
  "function isValidator(address) view returns (bool)",
  "function paused() view returns (bool)",
  "function burnSeq() view returns (uint64)",
  "function hashMintRequest(tuple(bytes32 sourceTxHash, address recipient, uint256 amount, uint256 sourceChainId, uint64 sourceBlockHeight) req) view returns (bytes32)",
  "event MintFromZebvix(bytes32 indexed sourceTxHash, address indexed recipient, uint256 amount, uint256 sourceBlockHeight, uint256 signatureCount)",
  "event BurnToZebvix(uint64 indexed seq, address indexed burner, string zebvixAddress, uint256 amount, uint256 timestamp)",
];

export interface BscClientOpts {
  rpcUrl: string;
  bridgeAddress: string;
  relayerKey: string;
  confirmTimeoutMs: number;
}

export class BscClient {
  readonly provider: JsonRpcProvider;
  readonly wallet: Wallet;
  readonly bridge: Contract;
  private readonly opts: BscClientOpts;

  constructor(opts: BscClientOpts) {
    this.opts = opts;
    this.provider = new JsonRpcProvider(opts.rpcUrl);
    const key = opts.relayerKey.startsWith("0x")
      ? opts.relayerKey
      : "0x" + opts.relayerKey;
    this.wallet = new Wallet(key, this.provider);
    this.bridge = new Contract(opts.bridgeAddress, BRIDGE_ABI, this.wallet);
  }

  get address(): string {
    return this.wallet.address;
  }

  async chainId(): Promise<number> {
    return Number((await this.provider.getNetwork()).chainId);
  }

  async balanceBnb(): Promise<bigint> {
    return this.provider.getBalance(this.wallet.address);
  }

  async threshold(): Promise<number> {
    return Number(await this.bridge.threshold());
  }

  async isConsumed(sourceTxHash: string): Promise<boolean> {
    return this.bridge.consumed(sourceTxHash);
  }

  async submitMint(
    req: {
      sourceTxHash: string;
      recipient: string;
      amount: bigint;
      sourceChainId: bigint;
      sourceBlockHeight: bigint;
    },
    signatures: string[],
  ): Promise<{ hash: string; block: number }> {
    const tx = await this.bridge.mintFromZebvix(req, signatures);
    const receipt = await Promise.race([
      tx.wait(1),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("mint tx confirm timeout")), this.opts.confirmTimeoutMs),
      ),
    ]);
    if (!receipt) throw new Error("mint tx receipt null");
    return { hash: tx.hash, block: receipt.blockNumber };
  }

  /** Fetch BurnToZebvix events between fromBlock and toBlock (inclusive). */
  async fetchBurns(fromBlock: number, toBlock: number) {
    const filter = this.bridge.filters.BurnToZebvix();
    const logs = await this.bridge.queryFilter(filter, fromBlock, toBlock);
    return logs.map((l) => {
      const ev = l as ethers.EventLog;
      const args = ev.args;
      return {
        bsc_tx_hash: ev.transactionHash,
        bsc_log_index: ev.index,
        bsc_block: ev.blockNumber,
        burn_seq: Number(args[0]),
        burner: args[1] as string,
        zebvix_address: args[2] as string,
        amount: (args[3] as bigint).toString(),
        timestamp: Number(args[4]),
      };
    });
  }

  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }
}
