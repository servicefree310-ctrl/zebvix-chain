const RPC_PATH = "/api/rpc";

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class ZbxRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(e: RpcError) {
    super(e.message);
    this.code = e.code;
    this.data = e.data;
  }
}

export async function rpc<T = unknown>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const r = await fetch(RPC_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await r.json()) as { result?: T; error?: RpcError };
  if (json.error) throw new ZbxRpcError(json.error);
  return json.result as T;
}

// Convert hex wei string ("0x...") to ZBX decimal string with up to 6 places
export function weiHexToZbx(hex: string | number | bigint): string {
  let n: bigint;
  try {
    n = typeof hex === "bigint" ? hex : BigInt(hex);
  } catch {
    return "0";
  }
  const denom = 10n ** 18n;
  const whole = n / denom;
  const frac = n % denom;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, "0").slice(0, 6);
  const trimmed = fracStr.replace(/0+$/, "");
  return trimmed.length ? `${whole}.${trimmed}` : whole.toString();
}

export function shortAddr(a: string, head = 6, tail = 4): string {
  if (!a || a.length < head + tail + 2) return a;
  return `${a.slice(0, 2 + head)}…${a.slice(-tail)}`;
}

// Convert wei (hex/string/bigint) to USD using a price-per-ZBX (number)
export function weiToUsd(
  wei: string | number | bigint,
  pricePerZbx: number,
): number {
  let n: bigint;
  try {
    n = typeof wei === "bigint" ? wei : BigInt(wei);
  } catch {
    return 0;
  }
  // Use string conversion to keep precision for large numbers
  const denom = 10n ** 18n;
  const whole = Number(n / denom);
  const frac = Number(n % denom) / Number(denom);
  return (whole + frac) * pricePerZbx;
}

export function fmtUsd(n: number): string {
  if (!isFinite(n)) return "$0.00";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}
