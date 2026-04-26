import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  findBySymbol,
  listTokens,
  lookupOnChain,
  registerToken,
} from "../lib/token-registry";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const RegisterBody = z.object({
  chain: z.string().min(2).max(20),
  symbol: z.string().min(1).max(16).regex(/^[A-Za-z0-9._-]+$/),
  contract: z.string().min(2).max(80),
  decimals: z.number().int().min(0).max(36),
  name: z.string().min(1).max(64).optional(),
});

const SUPPORTED = new Set([
  "zebvix",
  "bsc",
  "ethereum",
  "polygon",
  "arbitrum",
]);

function isChain(c: string): boolean {
  return SUPPORTED.has(c.toLowerCase());
}

router.get("/tokens/:chain", (req, res) => {
  const chain = req.params.chain;
  if (!isChain(chain)) {
    res.status(400).json({ error: "unsupported chain" });
    return;
  }
  res.json({ chain: chain.toLowerCase(), tokens: listTokens(chain) });
});

// Zebvix unique-symbol resolver.
router.get("/tokens/zebvix/by-symbol/:symbol", (req, res) => {
  const sym = (req.params.symbol ?? "").trim();
  if (!sym) {
    res.status(400).json({ error: "missing symbol" });
    return;
  }
  const t = findBySymbol("zebvix", sym);
  if (!t) {
    res.status(404).json({ error: `Symbol '${sym.toUpperCase()}' not registered on Zebvix` });
    return;
  }
  res.json(t);
});

// On-chain lookup of an ERC20-like token (read symbol/name/decimals).
router.get("/tokens/lookup/:chain/:contract", async (req, res) => {
  const { chain, contract } = req.params;
  if (!isChain(chain)) {
    res.status(400).json({ error: "unsupported chain" });
    return;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract ?? "")) {
    res.status(400).json({ error: "invalid contract address" });
    return;
  }
  try {
    const info = await lookupOnChain(chain, contract);
    if (!info.symbol || info.decimals === 0 && !info.name) {
      res.status(404).json({ error: "no ERC20-like token found at that contract" });
      return;
    }
    res.json({ chain: chain.toLowerCase(), contract, ...info });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "lookup failed";
    logger.warn({ err, chain, contract }, "tokens.lookup failed");
    res.status(502).json({ error: msg });
  }
});

router.post("/tokens/register", (req, res) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_body",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return;
  }
  const body = parsed.data;
  if (!isChain(body.chain)) {
    res.status(400).json({ error: "unsupported chain" });
    return;
  }
  // EVM-style chains require a 0x-address; zebvix accepts symbol-style ids.
  if (body.chain.toLowerCase() !== "zebvix" && !/^0x[0-9a-fA-F]{40}$/.test(body.contract)) {
    res.status(400).json({ error: "contract must be a 0x address on EVM chains" });
    return;
  }
  const r = registerToken({
    chain: body.chain,
    symbol: body.symbol,
    contract: body.contract,
    decimals: Number(body.decimals),
    name: body.name,
  });
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  res.json(r.token);
});

export default router;
