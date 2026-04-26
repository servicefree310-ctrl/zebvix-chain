// Tiny shared Zebvix JSON-RPC client used by relayer watchers / submitters.

export interface ZebvixBridgeOutEvent {
  seq: number;
  asset_id: string;
  native_symbol: string;
  from: string;
  dest_address: string;
  amount: string;
  height: number;
  ts?: number;
  tx_hash: string;
}

export async function zebvixRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!res.ok) throw new Error(`zebvix ${method} HTTP ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`zebvix ${method}: ${j.error.message}`);
  return j.result as T;
}

/**
 * Fetch the recommended fee floor in wei from `zbx_feeBounds` (NOT
 * `zbx_estimateGas` — that endpoint exposes a single `fee_wei` snapshot,
 * but the chain's apply-time fee floor lives in fee bounds).
 *
 * Throws on missing/zero fee — submitting a tx with `fee=0` is silently
 * rejected on apply, which would loop the relayer forever marking burns
 * as failed.
 */
export async function getZebvixFeeWei(rpcUrl: string): Promise<bigint> {
  const r = (await zebvixRpc<unknown>(rpcUrl, "zbx_feeBounds", [])) as {
    recommended_fee_wei?: string | number;
    min_fee_wei?: string | number;
  };
  if (r && typeof r === "object") {
    const rec = r.recommended_fee_wei;
    if (rec !== undefined) {
      const v = BigInt(rec);
      if (v > 0n) return v;
    }
    const mn = r.min_fee_wei;
    if (mn !== undefined) {
      const v = BigInt(mn);
      if (v > 0n) return v;
    }
  }
  throw new Error(
    `zbx_feeBounds did not return a usable fee (got ${JSON.stringify(r)})`,
  );
}

/** Get the next nonce for an address (decimal number). */
export async function getZebvixNonce(rpcUrl: string, address: string): Promise<number> {
  const r = await zebvixRpc<unknown>(rpcUrl, "zbx_getNonce", [address]);
  if (typeof r === "number") return r;
  if (typeof r === "string") return Number.parseInt(r, 10);
  if (typeof r === "object" && r !== null) {
    const obj = r as { nonce?: number | string };
    if (typeof obj.nonce === "number") return obj.nonce;
    if (typeof obj.nonce === "string") return Number.parseInt(obj.nonce, 10);
  }
  throw new Error(`unexpected zbx_getNonce result: ${JSON.stringify(r)}`);
}
