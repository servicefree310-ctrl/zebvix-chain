import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// dist/lib at runtime → ../../data/tokens.json
const DATA_DIR = path.resolve(__dirname, "../../data");
const STORE_FILE = path.join(DATA_DIR, "tokens.json");

export interface TokenInfo {
  chain: string;
  symbol: string;
  contract: string;
  decimals: number;
  name?: string;
  addedAt: number;
}

interface Store {
  tokens: TokenInfo[];
}

const SUPPORTED_CHAINS = new Set([
  "zebvix",
  "bsc",
  "ethereum",
  "polygon",
  "arbitrum",
]);

let store: Store = { tokens: [] };
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tokens)) {
        store = parsed as Store;
      }
    }
  } catch (err) {
    logger.warn({ err }, "token-registry: failed to load store, starting empty");
  }
}

function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    logger.warn({ err }, "token-registry: persist failed");
  }
}

export function listTokens(chain: string): TokenInfo[] {
  ensureLoaded();
  return store.tokens.filter(
    (t) => t.chain.toLowerCase() === chain.toLowerCase(),
  );
}

export function findBySymbol(chain: string, symbol: string): TokenInfo | null {
  ensureLoaded();
  const c = chain.toLowerCase();
  const s = symbol.toLowerCase();
  return (
    store.tokens.find(
      (t) => t.chain.toLowerCase() === c && t.symbol.toLowerCase() === s,
    ) ?? null
  );
}

export function findByContract(
  chain: string,
  contract: string,
): TokenInfo | null {
  ensureLoaded();
  const c = chain.toLowerCase();
  const a = contract.toLowerCase();
  return (
    store.tokens.find(
      (t) =>
        t.chain.toLowerCase() === c && t.contract.toLowerCase() === a,
    ) ?? null
  );
}

export interface RegisterInput {
  chain: string;
  symbol: string;
  contract: string;
  decimals: number;
  name?: string;
}

export type RegisterResult =
  | { ok: true; token: TokenInfo }
  | { ok: false; error: string; status: number };

export function registerToken(input: RegisterInput): RegisterResult {
  ensureLoaded();
  const chain = input.chain.toLowerCase().trim();
  if (!SUPPORTED_CHAINS.has(chain)) {
    return { ok: false, error: "unsupported chain", status: 400 };
  }
  const symbol = (input.symbol ?? "").trim();
  const contract = (input.contract ?? "").trim();
  const decimals = Number(input.decimals);
  if (!symbol || symbol.length > 16) {
    return { ok: false, error: "invalid symbol", status: 400 };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
    return { ok: false, error: "invalid contract address", status: 400 };
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return { ok: false, error: "invalid decimals", status: 400 };
  }
  // Zebvix: one symbol = one token (uniqueness on symbol).
  if (chain === "zebvix") {
    const existing = findBySymbol(chain, symbol);
    if (existing && existing.contract.toLowerCase() !== contract.toLowerCase()) {
      return {
        ok: false,
        error: `Symbol '${symbol.toUpperCase()}' already registered on Zebvix`,
        status: 409,
      };
    }
  }
  // Other chains: dedupe on (chain, contract).
  const dup = findByContract(chain, contract);
  if (dup) {
    return { ok: true, token: dup };
  }
  const token: TokenInfo = {
    chain,
    symbol: symbol.toUpperCase(),
    contract,
    decimals,
    name: input.name?.trim() || symbol.toUpperCase(),
    addedAt: Date.now(),
  };
  store.tokens.push(token);
  persist();
  return { ok: true, token };
}

// ── On-chain token lookup via JSON-RPC eth_call ──────────────────────────────

const RPC_URLS: Record<string, string> = {
  zebvix: "http://93.127.213.192:8545",
  bsc: "https://bsc-dataseed.binance.org",
  ethereum: "https://eth.llamarpc.com",
  polygon: "https://polygon-rpc.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",
};

// keccak256("symbol()")[0..4] = 0x95d89b41
// keccak256("name()")[0..4]   = 0x06fdde03
// keccak256("decimals()")[0..4] = 0x313ce567
const SEL_SYMBOL = "0x95d89b41";
const SEL_NAME = "0x06fdde03";
const SEL_DECIMALS = "0x313ce567";

async function ethCall(
  rpcUrl: string,
  to: string,
  data: string,
): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  if (!res.ok) throw new Error(`rpc http ${res.status}`);
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result ?? "0x";
}

function decodeStringResult(hex: string): string {
  if (!hex || hex === "0x") return "";
  const stripped = hex.slice(2);
  // ABI-encoded string: offset(32) + length(32) + data
  if (stripped.length >= 128) {
    const lenHex = stripped.slice(64, 128);
    const len = parseInt(lenHex, 16);
    if (Number.isFinite(len) && len > 0 && len < 256) {
      const dataHex = stripped.slice(128, 128 + len * 2);
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16);
      }
      return new TextDecoder().decode(bytes).replace(/\0+$/, "");
    }
  }
  // Fallback: bytes32 fixed-length string.
  const fixed = stripped.padEnd(64, "0").slice(0, 64);
  let out = "";
  for (let i = 0; i < 32; i++) {
    const code = parseInt(fixed.slice(i * 2, i * 2 + 2), 16);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function decodeUintResult(hex: string): number {
  if (!hex || hex === "0x") return 0;
  const n = BigInt(hex);
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export async function lookupOnChain(
  chain: string,
  contract: string,
): Promise<{ symbol: string; name: string; decimals: number }> {
  const c = chain.toLowerCase();
  const rpc = RPC_URLS[c];
  if (!rpc) throw new Error(`unsupported chain: ${chain}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
    throw new Error("invalid contract");
  }
  const [symbolHex, nameHex, decHex] = await Promise.all([
    ethCall(rpc, contract, SEL_SYMBOL),
    ethCall(rpc, contract, SEL_NAME),
    ethCall(rpc, contract, SEL_DECIMALS),
  ]);
  return {
    symbol: decodeStringResult(symbolHex),
    name: decodeStringResult(nameHex),
    decimals: decodeUintResult(decHex),
  };
}
