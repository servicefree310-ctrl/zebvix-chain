import { Router } from "express";
import { getEffectiveRpcUrl } from "../lib/admin-settings";

const rpcRouter = Router();

// Default upstream — used by the rate-limit info endpoint and as the ultimate
// fallback if both the admin override and the env var are missing. The actual
// proxied call resolves the URL per-request through getEffectiveRpcUrl() which
// is cached for 5 seconds so admin changes take effect almost immediately
// without slamming the database on every RPC call.
const VPS_RPC_URL =
  process.env["ZEBVIX_VPS_RPC"] ?? "http://93.127.213.192:8545";

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
  "zbx_supply",
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
  // Surfaces the SEMANTIC fields (e.g. TokenPoolCreate seed amounts,
  // TokenTransfer recipient, TokenPoolSwap direction+amount_in) that the
  // legacy `eth_getTransactionByHash` mapping flattens to `value: 0`.
  // Read-only, scoped to the recent-tx ring window (~1000 txs).
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
  // Read-side
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
  // Write-side (signed raw txs only — node still validates chain id, sig, gas, nonce)
  "eth_sendRawTransaction",
  // net_*
  "net_version",
  "net_listening",
  "net_peerCount",
  // web3_*
  "web3_clientVersion",
  "web3_sha3",
  "rpc_methods",
]);

interface RateBucket {
  count: number;
  resetAt: number;
}
const rateMap = new Map<string, RateBucket>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQS = 600;

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

// Public info endpoint. We DO NOT leak the resolved upstream URL because the
// admin can override it with a private hostname/IP that should not be
// disclosed publicly. Anyone holding the admin token can read the real value
// from /api/admin/settings.
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
  });
});

rpcRouter.post("/rpc", async (req, res) => {
  const ip = (req.ip ?? "unknown").toString();
  if (!rateLimit(ip)) {
    res.status(429).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: { code: -32005, message: "rate limit exceeded (600 req/min)" },
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
  // Reject excessively large param payloads early (express.json() already
  // caps body size to 256kb; this is a softer per-call sanity bound).
  if (body.method.length > 64) {
    res.status(400).json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32600, message: "invalid method" },
    });
    return;
  }
  if (body.params !== undefined && !Array.isArray(body.params) && typeof body.params !== "object") {
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

  const upstream: { jsonrpc: string; id: unknown; method: string; params: unknown } = {
    jsonrpc: "2.0",
    id: body.id ?? 1,
    method: body.method,
    params: body.params ?? [],
  };

  let upstreamUrl = VPS_RPC_URL;
  try {
    upstreamUrl = await getEffectiveRpcUrl();
  } catch {
    // keep the env default if the settings cache miss + DB read both fail
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
    // Don't leak the upstream URL or internal stack traces; just signal that
    // the RPC backend is unreachable + whether it was a timeout.
    const aborted =
      err instanceof Error &&
      (err.name === "AbortError" || /abort/i.test(err.message));
    res.status(502).json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: {
        code: -32000,
        message: aborted
          ? "upstream RPC timeout"
          : "upstream RPC unreachable",
      },
    });
  }
});

export default rpcRouter;
