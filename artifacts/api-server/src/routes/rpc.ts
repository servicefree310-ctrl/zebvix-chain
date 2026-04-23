import { Router } from "express";

const rpcRouter = Router();

const VPS_RPC_URL =
  process.env["ZEBVIX_VPS_RPC"] ?? "http://93.127.213.192:8545";

const ALLOWED_METHODS = new Set<string>([
  "zbx_chainInfo",
  "zbx_blockNumber",
  "zbx_getBlock",
  "zbx_getBlockByHeight",
  "zbx_getBalance",
  "zbx_getNonce",
  "zbx_getTransaction",
  "zbx_getTransactionReceipt",
  "zbx_feeBounds",
  "zbx_voteStats",
  "zbx_listValidators",
  "zbx_getValidator",
  "zbx_getStaked",
  "zbx_getLockedRewards",
  "zbx_getDailyDrip",
  "zbx_getAdmin",
  "zbx_getPool",
  "zbx_getZUsdBalance",
  "zbx_getLpBalance",
  "zbx_lookupPayId",
  "zbx_getPayIdOf",
  "zbx_payIdCount",
  "zbx_getMultisig",
  "zbx_getMultisigProposal",
  "zbx_getMultisigProposals",
  "zbx_listMultisigsByOwner",
  "zbx_multisigCount",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "rpc_methods",
]);

interface RateBucket {
  count: number;
  resetAt: number;
}
const rateMap = new Map<string, RateBucket>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQS = 120;

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const b = rateMap.get(ip);
  if (!b || b.resetAt < now) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (b.count >= RATE_MAX_REQS) return false;
  b.count++;
  return true;
}

rpcRouter.get("/rpc/info", (_req, res) => {
  res.json({
    upstream: VPS_RPC_URL,
    rate_limit_per_min: RATE_MAX_REQS,
    allowed_methods: Array.from(ALLOWED_METHODS).sort(),
  });
});

rpcRouter.post("/rpc", async (req, res) => {
  const ip = (req.ip ?? "unknown").toString();
  if (!rateLimit(ip)) {
    res.status(429).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: { code: -32005, message: "rate limit exceeded (120 req/min)" },
    });
    return;
  }

  const body = req.body;
  if (!body || typeof body.method !== "string") {
    res.status(400).json({
      jsonrpc: "2.0",
      id: body?.id ?? null,
      error: { code: -32600, message: "invalid request" },
    });
    return;
  }

  if (!ALLOWED_METHODS.has(body.method)) {
    res.status(403).json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: {
        code: -32601,
        message: `method '${body.method}' not whitelisted on this proxy (read-only)`,
      },
    });
    return;
  }

  const upstream: { jsonrpc: string; id: unknown; method: string; params: unknown } = {
    jsonrpc: "2.0",
    id: body.id ?? 1,
    method: body.method,
    params: body.params ?? [],
  };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const r = await fetch(VPS_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(upstream),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: {
        code: -32000,
        message: `upstream RPC unreachable: ${msg}`,
        data: { upstream: VPS_RPC_URL },
      },
    });
  }
});

export default rpcRouter;
