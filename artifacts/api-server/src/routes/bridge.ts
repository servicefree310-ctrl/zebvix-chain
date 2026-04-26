import { Router, type Request, type Response } from "express";

const bridgeRouter = Router();

/**
 * GET /api/bridge/bsc-config
 * Public read of BSC bridge contract addresses + chain id, sourced from env.
 * Empty strings if unset (i.e. before mainnet deploy) — UI shows a warning.
 */
bridgeRouter.get("/bridge/bsc-config", (_req, res) => {
  const cfg = {
    bsc_chain_id: Number(process.env["BSC_CHAIN_ID"] ?? "56"),
    bsc_chain_name: process.env["BSC_CHAIN_NAME"] ?? "BNB Smart Chain",
    bsc_rpc_url: process.env["BSC_PUBLIC_RPC"] ?? "https://bsc-dataseed.binance.org",
    bsc_explorer: process.env["BSC_EXPLORER"] ?? "https://bscscan.com",
    wzbx_address: process.env["BSC_WZBX_ADDRESS"] ?? "",
    bridge_address: process.env["BSC_BRIDGE_ADDRESS"] ?? "",
    relayer_url: process.env["BRIDGE_RELAYER_URL"] ?? "",
    /** Foreign network id used in the Zebvix-side bridge registry for BSC.
     *  Hard-coded to 56 (BSC mainnet) — UI uses this to filter assets. */
    zebvix_foreign_network_id: 56,
    /** ZBX asset id on Zebvix targeting BSC. Operator must set this after
     *  registering ZBX/BSC in the bridge registry on the Zebvix L1. */
    zebvix_zbx_asset_id: process.env["ZEBVIX_ZBX_ASSET_ID"] ?? "",
  };
  res.json(cfg);
});

/**
 * GET /api/bridge/relayer-status
 * Proxies the relayer's /health endpoint. Returns ok=false (with details)
 * on any error so the dashboard can show a red indicator without crashing.
 */
bridgeRouter.get("/bridge/relayer-status", async (_req: Request, res: Response) => {
  const url = process.env["BRIDGE_RELAYER_URL"];
  if (!url) {
    res.json({
      ok: false,
      configured: false,
      error: "BRIDGE_RELAYER_URL not set",
    });
    return;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const r = await fetch(url.replace(/\/$/, "") + "/health", {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      res.json({
        ok: false,
        configured: true,
        error: `relayer returned ${r.status}`,
      });
      return;
    }
    const body = (await r.json()) as Record<string, unknown>;
    res.json({ ok: true, configured: true, ...body });
  } catch (err) {
    res.json({
      ok: false,
      configured: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default bridgeRouter;
