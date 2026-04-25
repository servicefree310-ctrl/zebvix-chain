import { Wallet, type Provider } from "ethers";
import { ZebvixProvider } from "./provider.js";
import type { Address, PayIdRecord } from "./types.js";

/**
 * ZebvixWallet — ethers.Wallet extended with helpers that call native
 * zbx_* RPC methods through a ZebvixProvider.
 *
 * Standard ZVM operations (sendTransaction, signMessage, signTypedData, etc.)
 * are inherited unchanged from ethers.Wallet — same wire format as Ethereum,
 * so any tool that speaks EVM speaks Zebvix.
 */
export class ZebvixWallet extends Wallet {
  constructor(privateKey: string, provider?: Provider | null) {
    super(privateKey, provider ?? null);
  }

  /** Create a fresh random wallet, optionally connected to a provider. */
  static fromRandom(provider?: ZebvixProvider): ZebvixWallet {
    const w = Wallet.createRandom();
    return new ZebvixWallet(w.privateKey, provider);
  }

  /**
   * Override ethers.Wallet.connect() to preserve the ZebvixWallet subclass
   * (so helper methods remain accessible after reconnecting).
   */
  override connect(provider: Provider | null): ZebvixWallet {
    return new ZebvixWallet(this.privateKey, provider);
  }

  private get zbx(): ZebvixProvider {
    const p = this.provider;
    if (!p) throw new Error("ZebvixWallet: not connected to a provider");
    if (!(p instanceof ZebvixProvider)) {
      throw new Error(
        "ZebvixWallet: provider is not a ZebvixProvider — cannot call zbx_* methods",
      );
    }
    return p;
  }

  /** Native ZBX balance (wei) via zbx_getBalance. */
  async getZbxBalance(): Promise<bigint> {
    return this.zbx.getZbxBalance(this.address as Address);
  }

  /** Account nonce via zbx_getNonce. */
  async getZbxNonce(): Promise<bigint> {
    return this.zbx.getZbxNonce(this.address as Address);
  }

  /** Pay-ID assigned to this wallet (or null). */
  async getMyPayId(): Promise<PayIdRecord | null> {
    return this.zbx.getPayIdOf(this.address as Address);
  }

  /** ZUSD balance (wei). */
  async getZusdBalance(): Promise<bigint> {
    return this.zbx.getZusdBalance(this.address as Address);
  }

  /** AMM LP token balance (wei). */
  async getLpBalance(): Promise<bigint> {
    return this.zbx.getLpBalance(this.address as Address);
  }

  /** All multisig wallets owned by this address. */
  async listMyMultisigs(): Promise<Address[]> {
    return this.zbx.listMultisigsByOwner(this.address as Address);
  }
}
