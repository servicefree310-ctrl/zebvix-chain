import express from "express";
import pino from "pino";
import { Wallet } from "ethers";
import { z } from "zod";
import { loadConfig } from "./config.ts";
import { buildDomain, MINT_REQUEST_TYPES, type MintRequest } from "./eip712.ts";
import { verifyAgainstZebvix } from "./verifier.ts";

const SignReqSchema = z.object({
  sourceTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount: z.string().regex(/^\d+$/),
  sourceChainId: z.string().regex(/^\d+$/),
  sourceBlockHeight: z.string().regex(/^\d+$/),
});

async function main() {
  const cfg = loadConfig();
  const log = pino({
    level: cfg.LOG_LEVEL,
    transport:
      cfg.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });

  const key = cfg.VALIDATOR_KEY.startsWith("0x") ? cfg.VALIDATOR_KEY : "0x" + cfg.VALIDATOR_KEY;
  const wallet = new Wallet(key);
  const validatorAddress = wallet.address;
  const startedAt = Date.now();

  log.info(
    {
      validator_address: validatorAddress,
      bsc_chain_id: cfg.BSC_CHAIN_ID,
      bridge: cfg.BSC_BRIDGE_ADDRESS,
      zebvix_rpc: cfg.ZEBVIX_RPC,
      asset_id: cfg.ZEBVIX_ZBX_ASSET_ID,
      auth: cfg.AUTH_TOKEN ? "token-required" : "open",
    },
    "validator signer starting",
  );

  const domain = buildDomain(cfg.BSC_CHAIN_ID, cfg.BSC_BRIDGE_ADDRESS);
  const app = express();
  app.use(express.json({ limit: "16kb" }));

  // Auth middleware (optional but recommended in prod).
  app.use((req, res, next) => {
    if (!cfg.AUTH_TOKEN) return next();
    const provided = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (provided !== cfg.AUTH_TOKEN) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      validator_address: validatorAddress,
      bsc_chain_id: cfg.BSC_CHAIN_ID,
      bridge: cfg.BSC_BRIDGE_ADDRESS,
      uptime_ms: Date.now() - startedAt,
    });
  });

  app.post("/sign-mint", async (req, res) => {
    try {
      const parsed = SignReqSchema.parse(req.body);
      const mintReq: MintRequest = {
        sourceTxHash: parsed.sourceTxHash,
        recipient: parsed.recipient,
        amount: BigInt(parsed.amount),
        sourceChainId: BigInt(parsed.sourceChainId),
        sourceBlockHeight: BigInt(parsed.sourceBlockHeight),
      };

      // Independent verification — the whole point of an honest validator.
      const v = await verifyAgainstZebvix(
        cfg.ZEBVIX_RPC,
        cfg.ZEBVIX_ZBX_ASSET_ID,
        BigInt(cfg.ZEBVIX_CHAIN_ID),
        mintReq,
        log,
      );
      if (!v.ok) {
        log.warn({ reason: v.reason, source: mintReq.sourceTxHash }, "REFUSED to sign — verification failed");
        return res.status(422).json({ error: `verification failed: ${v.reason}` });
      }

      // ethers v6 typed-data signing.
      const signature = await wallet.signTypedData(domain, MINT_REQUEST_TYPES, {
        sourceTxHash: mintReq.sourceTxHash,
        recipient: mintReq.recipient,
        amount: mintReq.amount,
        sourceChainId: mintReq.sourceChainId,
        sourceBlockHeight: mintReq.sourceBlockHeight,
      });

      log.info({ source: mintReq.sourceTxHash, recipient: mintReq.recipient }, "signed mint request");
      res.json({
        signer: validatorAddress,
        signature,
        signedAt: Date.now(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, "/sign-mint error");
      res.status(400).json({ error: msg });
    }
  });

  app.listen(cfg.PORT, () =>
    log.info({ port: cfg.PORT, validator: validatorAddress }, "validator signer listening"),
  );
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", e);
  process.exit(1);
});
