import { z } from "zod";

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(9001),
  /** Validator's BSC private key — used to sign EIP-712 mint requests.
   *  Keep on isolated infrastructure. NEVER share with the relayer. */
  VALIDATOR_KEY: z.string().regex(/^0x?[0-9a-fA-F]{64}$/),
  /** BSC chain id (56 mainnet / 97 testnet) — embedded in EIP-712 domain. */
  BSC_CHAIN_ID: z.coerce.number().int().positive().default(56),
  /** ZebvixBridge contract address on BSC — embedded in EIP-712 domain. */
  BSC_BRIDGE_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Zebvix L1 chain id (default 7878). */
  ZEBVIX_CHAIN_ID: z.coerce.number().int().positive().default(7878),
  /** Zebvix RPC URL — used to independently verify the source BridgeOut tx
   *  EXISTS and matches the recipient/amount in the mint request. This is
   *  what makes the validator a TRUE attestor and not just a rubber stamp. */
  ZEBVIX_RPC: z.string().url(),
  /** ZBX asset id this signer attests for (must match relayer config). */
  ZEBVIX_ZBX_ASSET_ID: z.string().regex(/^\d+$/),
  /** Optional API key required for /sign-mint. Recommended in production. */
  AUTH_TOKEN: z.string().min(16).optional(),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type SignerConfig = z.infer<typeof Schema>;

let cached: SignerConfig | null = null;
export function loadConfig(): SignerConfig {
  if (cached) return cached;
  cached = Schema.parse(process.env);
  return cached;
}
