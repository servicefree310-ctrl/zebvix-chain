import express from "express";
import pino from "pino";
import { loadConfig } from "./config.ts";
import { RelayerDB } from "./db.ts";
import { BscClient } from "./bsc-client.ts";
import { ZebvixWatcher } from "./zebvix-watcher.ts";
import { BscWatcher } from "./bsc-watcher.ts";

async function main() {
  const cfg = loadConfig();
  const log = pino({
    level: cfg.LOG_LEVEL,
    transport:
      cfg.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });

  log.info(
    {
      zebvix_rpc: cfg.ZEBVIX_RPC,
      bsc_rpc: cfg.BSC_RPC,
      bridge: cfg.BSC_BRIDGE_ADDRESS,
      wzbx: cfg.BSC_WZBX_ADDRESS,
      signers: cfg.signerEndpoints.length,
    },
    "starting zebvix↔bsc relayer",
  );

  const db = new RelayerDB(cfg.DB_PATH);
  const bsc = new BscClient({
    rpcUrl: cfg.BSC_RPC,
    bridgeAddress: cfg.BSC_BRIDGE_ADDRESS,
    relayerKey: cfg.BSC_RELAYER_KEY,
    confirmTimeoutMs: cfg.BSC_CONFIRM_TIMEOUT_MS,
  });

  // Sanity checks at startup — fail fast on misconfiguration.
  const onChainChainId = await bsc.chainId();
  if (onChainChainId !== cfg.BSC_CHAIN_ID) {
    throw new Error(
      `BSC chain id mismatch: configured=${cfg.BSC_CHAIN_ID} on-chain=${onChainChainId}`,
    );
  }
  const threshold = await bsc.threshold();
  if (threshold > cfg.signerEndpoints.length) {
    log.warn(
      { threshold, configured_signers: cfg.signerEndpoints.length },
      "fewer signer endpoints than threshold — relayer cannot mint until more signers are reachable",
    );
  }
  const bnb = await bsc.balanceBnb();
  log.info(
    { relayer_addr: bsc.address, bnb: bnb.toString(), threshold, validators_required: threshold },
    "bsc client ready",
  );

  const zwatcher = new ZebvixWatcher(cfg, db, bsc, log.child({ module: "zebvix" }));
  const bwatcher = new BscWatcher(cfg, db, bsc, log.child({ module: "bsc" }));
  zwatcher.start();
  bwatcher.start();

  // ── HTTP /health for monitoring ─────────────────────────────────────────
  const app = express();
  app.get("/health", async (_req, res) => {
    try {
      const head = await bsc.getBlockNumber();
      res.json({
        ok: true,
        relayer_address: bsc.address,
        bsc: {
          chain_id: cfg.BSC_CHAIN_ID,
          bridge: cfg.BSC_BRIDGE_ADDRESS,
          wzbx: cfg.BSC_WZBX_ADDRESS,
          head_block: head,
          threshold,
        },
        zebvix: {
          rpc: cfg.ZEBVIX_RPC,
          chain_id: cfg.ZEBVIX_CHAIN_ID,
          asset_id: cfg.ZEBVIX_ZBX_ASSET_ID,
        },
        signers: { count: cfg.signerEndpoints.length, endpoints: cfg.signerEndpoints },
        stats: db.stats(),
        cursors: {
          bsc_burn_cursor: db.getCursor("bsc_burn_cursor"),
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.listen(cfg.PORT, () => log.info({ port: cfg.PORT }, "/health listening"));

  const shutdown = (sig: string) => {
    log.info({ sig }, "shutting down");
    zwatcher.stop();
    bwatcher.stop();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", e);
  process.exit(1);
});
