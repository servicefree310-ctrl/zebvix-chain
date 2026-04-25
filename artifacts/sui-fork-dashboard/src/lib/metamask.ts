// Thin wrapper around `window.ethereum` (MetaMask / EIP-1193 providers) for
// the Zebvix dashboard. Keeps all the chain-add / chain-switch / send-tx
// boilerplate in one place so the wallet UI stays small.
//
// Zebvix mainnet identity (matches `eth_chainId` on the live VPS):
//   chainId  = 0x1ec6 (7878 decimal)
//   currency = ZBX, 18 decimals
//   RPC      = the dashboard origin proxied through `/api/rpc`
//
// We point MetaMask at the dashboard's own origin so users don't have to know
// the VPS IP — the api-server already proxies allowlisted methods through.

export const ZEBVIX_CHAIN_ID_HEX = "0x1ec6";
export const ZEBVIX_CHAIN_ID_NUM = 7878;
export const ZEBVIX_CHAIN_NAME = "Zebvix Mainnet";
export const ZEBVIX_NATIVE_SYMBOL = "ZBX";
export const ZEBVIX_NATIVE_DECIMALS = 18;

export interface EthProvider {
  isMetaMask?: boolean;
  request<T = unknown>(args: { method: string; params?: unknown[] | object }): Promise<T>;
  on?(event: string, cb: (...a: unknown[]) => void): void;
  removeListener?(event: string, cb: (...a: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: EthProvider;
  }
}

export function hasEthProvider(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

export function getEthProvider(): EthProvider {
  if (!hasEthProvider()) {
    throw new Error("No EVM wallet detected. Install MetaMask first.");
  }
  return window.ethereum as EthProvider;
}

export async function requestAccounts(): Promise<string[]> {
  const eth = getEthProvider();
  const accounts = await eth.request<string[]>({ method: "eth_requestAccounts" });
  return Array.isArray(accounts) ? accounts.map((a) => a.toLowerCase()) : [];
}

export async function getCurrentChainIdHex(): Promise<string> {
  const eth = getEthProvider();
  const id = await eth.request<string>({ method: "eth_chainId" });
  return typeof id === "string" ? id.toLowerCase() : "0x0";
}

/** Build the RPC URL the dashboard exposes (proxied to the VPS). Browser-only. */
export function dashboardRpcUrl(): string {
  if (typeof window === "undefined") return "";
  // Vite serves the dashboard with `BASE_URL` like "/" or "/sui-fork-dashboard/".
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  const trimmed = base.replace(/\/+$/, "");
  return `${window.location.origin}${trimmed}/api/rpc`;
}

/** Idempotent: switch MetaMask to Zebvix; if it isn't added, add it first. */
export async function switchOrAddZebvixChain(): Promise<void> {
  const eth = getEthProvider();
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ZEBVIX_CHAIN_ID_HEX }],
    });
    return;
  } catch (e: unknown) {
    // 4902 = chain not added yet → fall through and add it.
    const code = (e as { code?: number })?.code;
    if (code !== 4902 && code !== -32603) throw e;
  }

  await eth.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: ZEBVIX_CHAIN_ID_HEX,
        chainName: ZEBVIX_CHAIN_NAME,
        nativeCurrency: {
          name: ZEBVIX_NATIVE_SYMBOL,
          symbol: ZEBVIX_NATIVE_SYMBOL,
          decimals: ZEBVIX_NATIVE_DECIMALS,
        },
        rpcUrls: [dashboardRpcUrl()],
        // No public block-explorer URL yet; the dashboard's own
        // `/block-explorer` page can be linked manually if needed.
        blockExplorerUrls: [],
      },
    ],
  });
}

export interface MmTxRequest {
  from: string;
  to: string;
  /** Decimal ZBX amount as a user-entered string (e.g. "0.25"). */
  valueZbx: string;
  /** Optional 0x-prefixed calldata (Solidity tx). */
  data?: string;
  /** Optional gas limit override (decimal). */
  gas?: string;
}

/** Convert a ZBX decimal string to a `0x...` wei hex string MetaMask expects. */
export function zbxToWeiHex(zbx: string): string {
  const s = zbx.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid amount "${zbx}"`);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 18) throw new Error("max 18 decimal places");
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  const wei = BigInt(whole) * 10n ** 18n + BigInt(padded || "0");
  return "0x" + wei.toString(16);
}

export async function sendMmTransaction(req: MmTxRequest): Promise<string> {
  const eth = getEthProvider();
  const params: Record<string, string> = {
    from: req.from,
    to: req.to,
    value: zbxToWeiHex(req.valueZbx || "0"),
  };
  if (req.data && req.data !== "0x") params["data"] = req.data;
  if (req.gas) {
    const g = BigInt(req.gas);
    params["gas"] = "0x" + g.toString(16);
  }
  const hash = await eth.request<string>({
    method: "eth_sendTransaction",
    params: [params],
  });
  return hash;
}

/** Subscribe to provider events. Returns an unsubscribe fn. */
export function onProviderEvents(handlers: {
  onAccounts?: (accounts: string[]) => void;
  onChain?: (chainIdHex: string) => void;
}): () => void {
  if (!hasEthProvider() || !window.ethereum?.on) return () => undefined;
  const eth = window.ethereum;
  const ah = (a: unknown) => handlers.onAccounts?.((a as string[]) ?? []);
  const ch = (c: unknown) => handlers.onChain?.(((c as string) ?? "").toLowerCase());
  eth.on?.("accountsChanged", ah);
  eth.on?.("chainChanged", ch);
  return () => {
    eth.removeListener?.("accountsChanged", ah);
    eth.removeListener?.("chainChanged", ch);
  };
}
