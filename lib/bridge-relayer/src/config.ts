import { z } from "zod";

const Schema = z.object({
  // ── HTTP server ────────────────────────────────────────────────────────
  PORT: z.coerce.number().int().positive().default(8765),
  // ── Zebvix L1 ──────────────────────────────────────────────────────────
  ZEBVIX_RPC: z.string().url(),
  ZEBVIX_CHAIN_ID: z.coerce.number().int().positive().default(7878),
  /** Polling interval for zbx_recentBridgeOutEvents (ms). */
  ZEBVIX_POLL_MS: z.coerce.number().int().min(1000).default(8_000),
  /** ZBX asset id to bridge to BSC (foreign network 56 = BSC). Get from /bridge-live. */
  ZEBVIX_ZBX_ASSET_ID: z.string().regex(/^\d+$/),
  /** Admin private key for submitting zbx_submitBridgeIn (BSC→Zebvix leg).
   *  This is a Zebvix-side admin key, NOT a BSC validator key. */
  ZEBVIX_ADMIN_KEY: z.string().regex(/^0x?[0-9a-fA-F]{64}$/).optional(),

  // ── BSC ────────────────────────────────────────────────────────────────
  BSC_RPC: z.string().url(),
  BSC_CHAIN_ID: z.coerce.number().int().positive().default(56),
  BSC_BRIDGE_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  BSC_WZBX_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Relayer's own EOA on BSC. Used to submit aggregated mintFromZebvix txs.
   *  Must be funded with BNB for gas, but holds NO authority — bridge contract
   *  only checks signatures, not msg.sender. */
  BSC_RELAYER_KEY: z.string().regex(/^0x?[0-9a-fA-F]{64}$/),
  /** How long to wait for BSC tx confirmation (ms). */
  BSC_CONFIRM_TIMEOUT_MS: z.coerce.number().int().default(120_000),
  /** Block confirmations to wait for BurnToZebvix events before relaying. */
  BSC_BURN_CONFIRMATIONS: z.coerce.number().int().min(1).default(15),
  /** Block to start watching BSC events from. Set this to the bridge deploy block. */
  BSC_START_BLOCK: z.coerce.number().int().nonnegative().default(0),

  // ── Validator signers ──────────────────────────────────────────────────
  /** Comma-separated list of validator signer endpoints, e.g.
   *  "http://val1.example:9001,http://val2.example:9001,…". Order doesn't
   *  matter; relayer queries all in parallel and accepts the first M. */
  SIGNER_ENDPOINTS: z.string().min(1),
  /** Per-request signer timeout (ms). */
  SIGNER_TIMEOUT_MS: z.coerce.number().int().default(15_000),

  // ── State ──────────────────────────────────────────────────────────────
  DB_PATH: z.string().default("./data/relayer.sqlite"),

  // ── Logging ────────────────────────────────────────────────────────────
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type RelayerConfig = z.infer<typeof Schema> & {
  signerEndpoints: string[];
};

let cached: RelayerConfig | null = null;

export function loadConfig(): RelayerConfig {
  if (cached) return cached;
  const parsed = Schema.parse(process.env);
  const signerEndpoints = parsed.SIGNER_ENDPOINTS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (signerEndpoints.length === 0) {
    throw new Error("SIGNER_ENDPOINTS must contain at least one URL");
  }
  cached = { ...parsed, signerEndpoints };
  return cached;
}
