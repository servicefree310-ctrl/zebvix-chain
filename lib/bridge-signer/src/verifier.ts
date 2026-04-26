import type { Logger } from "pino";
import type { MintRequest } from "./eip712.ts";

interface ZebvixBridgeOutEvent {
  seq: number;
  asset_id: string;
  native_symbol: string;
  from: string;
  dest_address: string;
  amount: string;
  height: number;
  tx_hash: string;
}

async function zebvixRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
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

function stripHex(h: string): string {
  return h.toLowerCase().replace(/^0x/, "");
}

/**
 * Independently verify on Zebvix L1 that:
 *   1. A BridgeOut event exists with this exact source_tx_hash
 *   2. It belongs to the configured ZBX asset id (no cross-asset confusion)
 *   3. recipient + amount + sourceBlockHeight all match the mint request
 *
 * If ANY of these fails, the signer refuses to sign — protecting the bridge
 * from a malicious relayer trying to mint extra wZBX.
 */
export async function verifyAgainstZebvix(
  zebvixRpcUrl: string,
  expectedAssetId: string,
  expectedZebvixChainId: bigint,
  req: MintRequest,
  log: Logger,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (req.sourceChainId !== expectedZebvixChainId) {
    return { ok: false, reason: `wrong source chain id ${req.sourceChainId} != ${expectedZebvixChainId}` };
  }

  const res = await zebvixRpc<{ returned: number; total: number; events: ZebvixBridgeOutEvent[] }>(
    zebvixRpcUrl,
    "zbx_recentBridgeOutEvents",
    [500],
  );

  const wantHash = stripHex(req.sourceTxHash);
  const match = (res.events ?? []).find((e) => stripHex(e.tx_hash) === wantHash);
  if (!match) {
    return {
      ok: false,
      reason: `source_tx_hash ${req.sourceTxHash} not found in recent BridgeOut events`,
    };
  }

  if (String(match.asset_id) !== expectedAssetId) {
    return {
      ok: false,
      reason: `asset_id mismatch: chain=${match.asset_id} expected=${expectedAssetId}`,
    };
  }

  if (BigInt(match.height) !== req.sourceBlockHeight) {
    return {
      ok: false,
      reason: `block height mismatch: chain=${match.height} req=${req.sourceBlockHeight}`,
    };
  }

  if (BigInt(match.amount) !== req.amount) {
    return {
      ok: false,
      reason: `amount mismatch: chain=${match.amount} req=${req.amount.toString()}`,
    };
  }

  // dest_address from chain may not have 0x prefix; normalize and compare.
  const chainDest = stripHex(match.dest_address);
  const reqDest = stripHex(req.recipient);
  if (chainDest !== reqDest) {
    return {
      ok: false,
      reason: `recipient mismatch: chain=0x${chainDest} req=${req.recipient}`,
    };
  }

  log.debug({ source: req.sourceTxHash }, "verified against zebvix");
  return { ok: true };
}
