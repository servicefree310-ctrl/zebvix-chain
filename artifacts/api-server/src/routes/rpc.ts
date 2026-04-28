import { Router, type Request, type Response } from "express";
import { getEffectiveRpcUrl } from "../lib/admin-settings";

const rpcRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Upstream URLs.  Mainnet is the existing, admin-overridable URL.  Testnet is
// a *separate* binary on the same VPS at port 18545 (chain_id 78787) — there's
// deliberately no admin override path for testnet because it's a developer
// playground, not a production endpoint.  Both routes share the SAME allowlist
// + rate-limit so we never accidentally drift the surface area.
// ─────────────────────────────────────────────────────────────────────────────
const VPS_RPC_URL =
  process.env["ZEBVIX_VPS_RPC"] ?? "http://93.127.213.192:8545";

const VPS_TESTNET_RPC_URL =
  process.env["ZEBVIX_TESTNET_RPC"] ?? "http://93.127.213.192:18545";

const ALLOWED_METHODS = new Set<string>([
  "zbx_chainInfo",
  "zbx_blockNumber",
  "zbx_getBlockByNumber",
  "zbx_getBalance",
  "zbx_getNonce",
  "zbx_feeBounds",
  "zbx_voteStats",
  "zbx_listValidators",
  "zbx_getValidator",
  "zbx_getStaking",
  "zbx_getStakingValidator",
  "zbx_getDelegation",
  "zbx_getDelegationsByDelegator",
  "zbx_getLockedRewards",
  "zbx_getBurnStats",
  "zbx_getAdmin",
  "zbx_getGovernor",
  "zbx_getPool",
  "zbx_getPriceUSD",
  "zbx_supply",
  "zbx_estimateGas",
  "zbx_getZusdBalance",
  "zbx_getLpBalance",
  "zbx_lookupPayId",
  "zbx_getPayIdOf",
  "zbx_payIdCount",
  "zbx_getMultisig",
  "zbx_getMultisigProposal",
  "zbx_getMultisigProposals",
  "zbx_listMultisigsByOwner",
  "zbx_multisigCount",
  "zbx_sendRawTransaction",
  "zbx_mempoolStatus",
  "zbx_mempoolPending",
  "zbx_recentTxs",
  "zbx_swapQuote",
  "zbx_recentSwaps",
  "zbx_poolStats",
  // ── Native zbx_* scalar identity / fee aliases ─────────────────────
  "zbx_chainId",
  "zbx_netVersion",
  "zbx_clientVersion",
  "zbx_gasPrice",
  "zbx_syncing",
  "zbx_getCode",
  // ── Phase B.3.3 — Slashing evidence (read-only) ────────────────────
  "zbx_listEvidence",
  // ── Phase C.2 — Native ZVM tx/receipt (canonical + legacy aliases) ─
  "zbx_getZvmTransaction",
  "zbx_getZvmReceipt",
  "zbx_getEvmTransaction",
  "zbx_getEvmReceipt",
  // ── User-launched fungible tokens (read-only) ─────────────────────
  "zbx_listTokens",
  "zbx_tokenInfo",
  "zbx_tokenInfoBySymbol",
  "zbx_tokenBalanceOf",
  "zbx_tokenCount",
  // ── Phase G — On-chain token metadata (read-only) ─────────────────
  "zbx_getTokenMetadata",
  // ── Phase F — Per-token AMM pools (read-only) ─────────────────────
  "zbx_listTokenPools",
  "zbx_getTokenPool",
  "zbx_tokenPoolCount",
  "zbx_tokenSwapQuote",
  "zbx_getTokenLpBalance",
  "zbx_tokenPoolStats",
  // ── Phase H — Pool address derivation (read-only) ─────────────────
  "zbx_getTokenPoolByAddress",
  "zbx_isPoolAddress",
  // ── Phase H.1 — Typed tx-by-hash w/ TxKind payload decoding ────────
  "zbx_getTxByHash",
  // ── Bridge (read-only) — lock vault + asset registry + events ─────
  "zbx_bridgeStats",
  "zbx_listBridgeNetworks",
  "zbx_getBridgeNetwork",
  "zbx_listBridgeAssets",
  "zbx_getBridgeAsset",
  "zbx_recentBridgeOutEvents",
  "zbx_getBridgeOutBySeq",
  "zbx_isBridgeClaimUsed",
  // ── Phase D — On-chain governance (read-only) ──────────────────────
  "zbx_proposalsList",
  "zbx_proposalGet",
  "zbx_proposerCheck",
  "zbx_proposalHasVoted",
  "zbx_proposalShadowExec",
  "zbx_featureFlagsList",
  "zbx_featureFlagGet",
  // ── Phase C.2 native EVM JSON-RPC (Cancun) ──────────────────────────
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionReceipt",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getLogs",
  "eth_syncing",
  "eth_accounts",
  "eth_coinbase",
  "eth_mining",
  "eth_hashrate",
  "eth_protocolVersion",
  "eth_sendRawTransaction",
  "net_version",
  "net_listening",
  "net_peerCount",
  "web3_clientVersion",
  "web3_sha3",
  "rpc_methods",
]);

interface RateBucket {
  count: number;
  resetAt: number;
}
// Two independent rate-limit buckets so a chatty testnet client can't starve
// mainnet readers (and vice-versa).  Both are still per-IP.
const rateMap = new Map<string, RateBucket>();
const rateMapTestnet = new Map<string, RateBucket>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQS = 600;

function rateLimit(map: Map<string, RateBucket>, ip: string): boolean {
  const now = Date.now();
  const b = map.get(ip);
  if (!b || b.resetAt < now) {
    map.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (b.count >= RATE_MAX_REQS) return false;
  b.count++;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// /api/rpc/info — public surface description (does NOT leak the resolved
// upstream URL since admins can override it with a private endpoint).
// ─────────────────────────────────────────────────────────────────────────────
rpcRouter.get("/rpc/info", async (_req, res) => {
  let configured = false;
  try {
    const url = await getEffectiveRpcUrl();
    configured = Boolean(url);
  } catch {
    configured = Boolean(VPS_RPC_URL);
  }
  res.json({
    upstream_configured: configured,
    rate_limit_per_min: RATE_MAX_REQS,
    allowed_methods: Array.from(ALLOWED_METHODS).sort(),
    networks: ["mainnet", "testnet"],
    testnet_configured: Boolean(VPS_TESTNET_RPC_URL),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared proxy handler — same allowlist, same validation, different upstream.
// `network` is purely cosmetic (used in error messages + the rate-limit map
// selection).  `resolveUpstream()` returns the actual URL to call.
// ─────────────────────────────────────────────────────────────────────────────
async function handleProxy(
  req: Request,
  res: Response,
  opts: {
    network: "mainnet" | "testnet";
    rateMap: Map<string, RateBucket>;
    resolveUpstream: () => Promise<string>;
  },
): Promise<void> {
  const ip = (req.ip ?? "unknown").toString();
  if (!rateLimit(opts.rateMap, ip)) {
    res.status(429).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: {
        code: -32005,
        message: `rate limit exceeded (${RATE_MAX_REQS} req/min on ${opts.network})`,
      },
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
  if (body.method.length > 64) {
    res.status(400).json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32600, message: "invalid method" },
    });
    return;
  }
  if (
    body.params !== undefined &&
    !Array.isArray(body.params) &&
    typeof body.params !== "object"
  ) {
    res.status(400).json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32602, message: "invalid params" },
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

  const upstream = {
    jsonrpc: "2.0",
    id: body.id ?? 1,
    method: body.method,
    params: body.params ?? [],
  };

  let upstreamUrl: string;
  try {
    upstreamUrl = await opts.resolveUpstream();
  } catch {
    upstreamUrl =
      opts.network === "testnet" ? VPS_TESTNET_RPC_URL : VPS_RPC_URL;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const r = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(upstream),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch (err) {
    const aborted =
      err instanceof Error &&
      (err.name === "AbortError" || /abort/i.test(err.message));
    res.status(502).json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: {
        code: -32000,
        message: aborted
          ? `upstream RPC timeout (${opts.network})`
          : `upstream RPC unreachable (${opts.network})`,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mainnet route (existing behavior, untouched contract — admin can override
// the upstream URL via /api/admin/settings).
// ─────────────────────────────────────────────────────────────────────────────
rpcRouter.post("/rpc", async (req, res) => {
  await handleProxy(req, res, {
    network: "mainnet",
    rateMap,
    resolveUpstream: getEffectiveRpcUrl,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Testnet route — chain_id 78787, port 18545.  No admin override; the URL is
// either the env var ZEBVIX_TESTNET_RPC or the hard-coded VPS default.
// ─────────────────────────────────────────────────────────────────────────────
rpcRouter.post("/rpc-testnet", async (req, res) => {
  await handleProxy(req, res, {
    network: "testnet",
    rateMap: rateMapTestnet,
    resolveUpstream: async () => VPS_TESTNET_RPC_URL,
  });
});

export default rpcRouter;
