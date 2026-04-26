/**
 * BSC-side bridge interactions.
 *
 * Read-only calls go through the configured public BSC RPC via fetch+JSON-RPC.
 * Write calls (burnToZebvix + ERC20.approve) are submitted via the user's
 * injected wallet (MetaMask) using EIP-1193 `window.ethereum.request`.
 *
 * No ethers dependency — keccak256 from @noble/hashes is enough for our
 * single-method ABI encoding (function selectors + balanceOf + allowance).
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { EthProvider } from "./metamask";

// ── Types ────────────────────────────────────────────────────────────────

export interface BscBridgeConfig {
  bsc_chain_id: number;
  bsc_chain_name: string;
  bsc_rpc_url: string;
  bsc_explorer: string;
  wzbx_address: string;
  bridge_address: string;
  relayer_url: string;
  zebvix_foreign_network_id: number;
  zebvix_zbx_asset_id: string;
}

export interface RelayerStatus {
  ok: boolean;
  configured: boolean;
  error?: string;
  relayer_address?: string;
  bsc?: {
    chain_id: number;
    bridge: string;
    wzbx: string;
    head_block: number;
    threshold: number;
  };
  signers?: { count: number; endpoints: string[] };
  stats?: {
    zebvix?: Record<string, number>;
    bsc?: Record<string, number>;
  };
  cursors?: Record<string, number>;
}

// `window.ethereum` global is declared in `./metamask.ts`.

// ── Helpers ───────────────────────────────────────────────────────────────

function toHex(buf: Uint8Array): string {
  let h = "";
  for (const b of buf) h += b.toString(16).padStart(2, "0");
  return h;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Keccak256 hex (no 0x). */
function keccakHex(s: string): string {
  return toHex(keccak_256(utf8(s)));
}

/** First 4 bytes of keccak256(signature) — the function selector. */
function selector(sig: string): string {
  return "0x" + keccakHex(sig).slice(0, 8);
}

/** Pad an address (without 0x) to 32 bytes. */
function padAddr(addr: string): string {
  const a = addr.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(a)) throw new Error(`bad address: ${addr}`);
  return "000000000000000000000000" + a;
}

/** Pad a uint256 (bigint) to 32 bytes hex. */
function padU256(n: bigint): string {
  if (n < 0n) throw new Error("negative uint");
  return n.toString(16).padStart(64, "0");
}

/** Encode a dynamic `string` per ABI (offset + length + padded bytes). */
function encodeStringAt(s: string, offset: number): { head: string; tail: string } {
  const bytes = utf8(s);
  const lenWord = padU256(BigInt(bytes.length));
  const dataHex = toHex(bytes);
  const padTo = Math.ceil(dataHex.length / 64) * 64;
  const padded = dataHex + "0".repeat(padTo - dataHex.length);
  return {
    head: padU256(BigInt(offset)),
    tail: lenWord + padded,
  };
}

// ── BSC RPC ───────────────────────────────────────────────────────────────

async function bscCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!res.ok) throw new Error(`BSC RPC HTTP ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(`BSC RPC ${method}: ${j.error.message}`);
  return j.result;
}

/** ERC20.balanceOf(account). Returns base-units bigint (18 decimals for wZBX). */
export async function bscErc20Balance(
  rpcUrl: string,
  token: string,
  account: string,
): Promise<bigint> {
  const data = selector("balanceOf(address)") + padAddr(account);
  const result = (await bscCall(rpcUrl, "eth_call", [
    { to: token, data },
    "latest",
  ])) as string;
  if (!result || result === "0x") return 0n;
  return BigInt(result);
}

/** ERC20.allowance(owner, spender). */
export async function bscErc20Allowance(
  rpcUrl: string,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const data = selector("allowance(address,address)") + padAddr(owner) + padAddr(spender);
  const result = (await bscCall(rpcUrl, "eth_call", [
    { to: token, data },
    "latest",
  ])) as string;
  if (!result || result === "0x") return 0n;
  return BigInt(result);
}

// ── ABI calldata builders ─────────────────────────────────────────────────

export function buildErc20ApproveData(spender: string, amount: bigint): string {
  return selector("approve(address,uint256)") + padAddr(spender) + padU256(amount);
}

/** burnToZebvix(string zebvixAddress, uint256 amount). */
export function buildBurnToZebvixData(zebvixAddress: string, amount: bigint): string {
  // Two args: (string, uint256). string is dynamic → head holds offset, tail holds (len|data).
  // Head section is 2 * 32 bytes.
  const HEAD_BYTES = 64;
  const enc = encodeStringAt(zebvixAddress, HEAD_BYTES);
  const head1 = enc.head;
  const head2 = padU256(amount);
  return selector("burnToZebvix(string,uint256)") + head1 + head2 + enc.tail;
}

// ── MetaMask helpers ──────────────────────────────────────────────────────

export async function requireMetaMask(): Promise<EthProvider> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask (or another EIP-1193 wallet) not detected.");
  }
  return window.ethereum;
}

/** Returns the currently selected account on the user's wallet (lowercased). */
export async function getMetaMaskAccount(): Promise<string | null> {
  if (typeof window === "undefined" || !window.ethereum) return null;
  try {
    const accs = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
    return accs[0]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export async function connectMetaMask(): Promise<string> {
  const eth = await requireMetaMask();
  const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!accs[0]) throw new Error("no account selected in wallet");
  return accs[0].toLowerCase();
}

/** Switch (or add+switch) to the BSC chain in the user's wallet. */
export async function ensureBscNetwork(cfg: BscBridgeConfig): Promise<void> {
  const eth = await requireMetaMask();
  const hexChainId = "0x" + cfg.bsc_chain_id.toString(16);
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    // 4902 = chain not added yet — try wallet_addEthereumChain.
    if (code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexChainId,
            chainName: cfg.bsc_chain_name,
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: [cfg.bsc_rpc_url],
            blockExplorerUrls: [cfg.bsc_explorer],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

/** Add wZBX as a tracked asset in the user's wallet via wallet_watchAsset. */
export async function watchWzbx(cfg: BscBridgeConfig): Promise<boolean> {
  const eth = await requireMetaMask();
  if (!cfg.wzbx_address) throw new Error("wZBX address not configured yet.");
  const ok = (await eth.request({
    method: "wallet_watchAsset",
    params: [
      {
        type: "ERC20",
        options: {
          address: cfg.wzbx_address,
          symbol: "wZBX",
          decimals: 18,
        },
      },
    ] as unknown[],
  })) as boolean;
  return ok;
}

/**
 * Submit an ERC20.approve(bridge, amount) tx via MetaMask. Returns the tx hash.
 */
export async function approveWzbx(
  cfg: BscBridgeConfig,
  from: string,
  amount: bigint,
): Promise<string> {
  const eth = await requireMetaMask();
  const data = buildErc20ApproveData(cfg.bridge_address, amount);
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: cfg.wzbx_address, data, value: "0x0" }],
  })) as string;
  return hash;
}

/**
 * Submit ZebvixBridge.burnToZebvix(zebvixAddress, amount) via MetaMask.
 */
export async function burnToZebvix(
  cfg: BscBridgeConfig,
  from: string,
  zebvixAddress: string,
  amount: bigint,
): Promise<string> {
  const eth = await requireMetaMask();
  const data = buildBurnToZebvixData(zebvixAddress, amount);
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: cfg.bridge_address, data, value: "0x0" }],
  })) as string;
  return hash;
}

// ── Format helpers ────────────────────────────────────────────────────────

export function fmtUnits18(raw: bigint, maxDecimals = 6): string {
  const scale = 10n ** 18n;
  const whole = raw / scale;
  const frac = raw % scale;
  const fracStr = (frac + scale).toString().slice(1).slice(0, maxDecimals);
  const trimmed = fracStr.replace(/0+$/, "");
  return trimmed ? `${whole.toString()}.${trimmed}` : whole.toString();
}

export function parseUnits18(s: string): bigint {
  const t = s.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error("amount must be a decimal number");
  const [whole, frac = ""] = t.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(fracPadded || "0");
}
