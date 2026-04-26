import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const VPS_RPC_URL =
  process.env["ZEBVIX_VPS_RPC"] ?? "http://93.127.213.192:8545";

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

interface ChainStatus {
  ok: boolean;
  chainId?: string;
  network?: string;
  height?: string;
  peers?: number;
  upstream: string;
  ts: number;
  error?: string;
}

let cache: { at: number; payload: ChainStatus } | null = null;
const CACHE_MS = 5_000;

async function rpcCall(method: string, params: unknown[] = []): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4_000);
  try {
    const r = await fetch(VPS_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
    if (j.error) throw new Error(j.error.message ?? "rpc_error");
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

router.get("/chain/status", async (_req, res) => {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    res.json(cache.payload);
    return;
  }
  const payload: ChainStatus = {
    ok: false,
    upstream: VPS_RPC_URL,
    ts: Date.now(),
  };
  try {
    // chain id, height, peers — best-effort; tolerate per-call failures.
    const [chainId, height, peers] = await Promise.allSettled([
      rpcCall("eth_chainId"),
      rpcCall("eth_blockNumber"),
      rpcCall("net_peerCount"),
    ]);
    if (chainId.status === "fulfilled" && typeof chainId.value === "string") {
      payload.chainId = String(parseInt(chainId.value, 16));
      payload.network = "Zebvix L1";
    }
    if (height.status === "fulfilled" && typeof height.value === "string") {
      payload.height = String(parseInt(height.value, 16));
    }
    if (peers.status === "fulfilled" && typeof peers.value === "string") {
      payload.peers = parseInt(peers.value, 16);
    }
    payload.ok = !!payload.height;
  } catch (err) {
    payload.error = err instanceof Error ? err.message : String(err);
  }
  cache = { at: Date.now(), payload };
  res.json(payload);
});

export default router;
