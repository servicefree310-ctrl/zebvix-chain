// Helper for verifying on-chain payments against the Zebvix L1 RPC.
import { logger } from "./logger";

const VPS_RPC_URL =
  process.env["ZEBVIX_VPS_RPC"] ?? "http://93.127.213.192:8545";

interface RpcResp {
  result?: unknown;
  error?: { message?: string };
}

async function rpcCall(method: string, params: unknown[] = []): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const r = await fetch(VPS_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const j = (await r.json()) as RpcResp;
    if (j.error) throw new Error(j.error.message ?? "rpc_error");
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

export interface VerifyPaymentArgs {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  asset: string; // zbx | zusd | bnb
  amount: string; // decimal string
  chainId: number;
}

export interface VerifyResult {
  status: "confirmed" | "pending" | "failed";
  reason?: string;
}

// Best-effort on-chain verification. The Zebvix L1 RPC exposes
// zbx_getEvmTransaction and zbx_getEvmReceipt for native EVM tx lookups, plus
// zbx_chainId for sanity-checking. We accept the payment as confirmed if the
// receipt status is success and the tx came from the claimed sender.
//
// For MVP we don't fail hard if the upstream is unreachable — we return
// `pending` so the owner can re-poll. Webhooks/cron can promote to confirmed
// later.
export async function verifyPayment(args: VerifyPaymentArgs): Promise<VerifyResult> {
  try {
    let receipt: unknown;
    try {
      receipt = await rpcCall("zbx_getEvmReceipt", [args.txHash]);
    } catch {
      // Fall back to standard JSON-RPC method name.
      receipt = await rpcCall("eth_getTransactionReceipt", [args.txHash]);
    }
    if (!receipt || typeof receipt !== "object") {
      return { status: "pending", reason: "receipt_not_found" };
    }
    const r = receipt as Record<string, unknown>;
    const status = r.status;
    // EVM receipts: status "0x1" means success, "0x0" means failed.
    if (status === "0x0" || status === 0) {
      return { status: "failed", reason: "tx_reverted" };
    }
    if (status !== "0x1" && status !== 1) {
      return { status: "pending", reason: "no_status_yet" };
    }

    let tx: unknown;
    try {
      tx = await rpcCall("zbx_getEvmTransaction", [args.txHash]);
    } catch {
      tx = await rpcCall("eth_getTransactionByHash", [args.txHash]);
    }
    if (tx && typeof tx === "object") {
      const t = tx as Record<string, unknown>;
      const from =
        typeof t.from === "string" ? t.from.toLowerCase() : "";
      if (from && from !== args.fromAddress.toLowerCase()) {
        return {
          status: "failed",
          reason: "from_address_mismatch",
        };
      }
    }
    return { status: "confirmed" };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), txHash: args.txHash },
      "payment_verification_pending",
    );
    return { status: "pending", reason: "rpc_unreachable" };
  }
}
