import { Router } from "express";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const sdkScaffoldRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// SDK Scaffold Workbench API
//
// Generates a production-quality starter project that depends on the
// @zebvix/zebvix.js SDK (ethers v6 wrapper).  Output bundle:
//
//   <project-name>/
//     package.json           lockfile-aware deps + scripts for the chosen PM
//     tsconfig.json          (TypeScript only) strict, ESM, NodeNext
//     README.md              quickstart + per-module commentary
//     .env.example           rpc URL + optional private key placeholder
//     .gitignore             node_modules / dist / .env
//     src/main.ts            entry that runs every selected module
//     src/zebvix.ts          provider/wallet bootstrap, env-aware
//     src/modules/*.ts       one file per opt-in feature module
//     tests/sanity.test.ts   (optional) vitest live + offline smoke tests
//     .github/workflows/ci.yml (optional) typecheck + test on PR
//     Dockerfile             (optional) multi-stage runtime image
//     LICENSE                generated for MIT / Apache-2.0
//
// Server also returns:
//   - a 0-100 SDK Project Quality score
//   - the resolved dependency tree (deps + devDeps) for transparency
//   - a per-module total LOC count
// ─────────────────────────────────────────────────────────────────────────────

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
type Language = "typescript" | "javascript";
type Runtime = "node" | "bun";
type EnvStrategy = "dotenv" | "process";
type License = "MIT" | "Apache-2.0" | "UNLICENSED";

type ModuleKey =
  | "blockExplorer"
  | "walletOps"
  | "governance"
  | "amm"
  | "bridge"
  | "staking"
  | "payid"
  | "mempool";

interface ScaffoldConfig {
  projectName: string;
  description: string;
  authorName: string;
  packageManager: PackageManager;
  language: Language;
  runtime: Runtime;
  rpcUrl: string;
  chainId: number;
  modules: Record<ModuleKey, boolean>;
  envStrategy: EnvStrategy;
  includeTests: boolean;
  includeCi: boolean;
  includeDockerfile: boolean;
  license: License;
}

const NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;
const DESC_RE = /^[\x20-\x7E]{0,160}$/;
const AUTHOR_RE = /^[\x20-\x7E]{0,80}$/;
const RPC_URL_RE = /^https?:\/\/[a-z0-9.\-]{1,253}(?::\d{1,5})?(?:\/[\w\-./]*)?$/i;

const ALLOWED_PM = new Set<PackageManager>(["pnpm", "npm", "yarn", "bun"]);
const ALLOWED_LANG = new Set<Language>(["typescript", "javascript"]);
const ALLOWED_RUNTIME = new Set<Runtime>(["node", "bun"]);
const ALLOWED_ENV = new Set<EnvStrategy>(["dotenv", "process"]);
const ALLOWED_LICENSE = new Set<License>(["MIT", "Apache-2.0", "UNLICENSED"]);

const ALL_MODULES: ModuleKey[] = [
  "blockExplorer",
  "walletOps",
  "governance",
  "amm",
  "bridge",
  "staking",
  "payid",
  "mempool",
];

const SDK_VERSION = "^0.1.0-alpha.1";
const ETHERS_VERSION = "^6.13.4";
const VITEST_VERSION = "^2.1.4";
const TSX_VERSION = "^4.19.2";
const TS_VERSION = "^5.6.3";
const DOTENV_VERSION = "^16.4.5";
const NODE_TYPES_VERSION = "^22.9.0";

function intInRange(v: any, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function validate(cfg: any): { ok: true; value: ScaffoldConfig } | { ok: false; error: string } {
  if (!cfg || typeof cfg !== "object") return { ok: false, error: "body must be a JSON object" };

  const projectName = String(cfg.projectName || "").toLowerCase().trim();
  if (!NAME_RE.test(projectName))
    return { ok: false, error: "projectName: 2-41 chars, lowercase a-z 0-9 -, must start with a letter" };

  const description = String(cfg.description ?? "").trim();
  if (!DESC_RE.test(description))
    return { ok: false, error: "description: ASCII printable only, max 160 chars" };

  const authorName = String(cfg.authorName ?? "").trim();
  if (!AUTHOR_RE.test(authorName))
    return { ok: false, error: "authorName: ASCII printable only, max 80 chars" };

  const packageManager = cfg.packageManager as PackageManager;
  if (!ALLOWED_PM.has(packageManager))
    return { ok: false, error: "packageManager: must be one of pnpm | npm | yarn | bun" };

  const language = cfg.language as Language;
  if (!ALLOWED_LANG.has(language))
    return { ok: false, error: "language: must be typescript or javascript" };

  const runtime = cfg.runtime as Runtime;
  if (!ALLOWED_RUNTIME.has(runtime))
    return { ok: false, error: "runtime: must be node or bun" };

  const rpcUrl = String(cfg.rpcUrl || "").trim();
  if (!RPC_URL_RE.test(rpcUrl))
    return { ok: false, error: "rpcUrl: must be http(s)://host[:port][/path]" };

  const chainId = intInRange(cfg.chainId, 1, 2_147_483_647);
  if (chainId === null) return { ok: false, error: "chainId: integer 1..2147483647" };

  const modulesIn = cfg.modules ?? {};
  const modules = {} as Record<ModuleKey, boolean>;
  for (const k of ALL_MODULES) modules[k] = Boolean(modulesIn[k]);

  const envStrategy = cfg.envStrategy as EnvStrategy;
  if (!ALLOWED_ENV.has(envStrategy))
    return { ok: false, error: "envStrategy: must be dotenv or process" };

  const license = cfg.license as License;
  if (!ALLOWED_LICENSE.has(license))
    return { ok: false, error: "license: MIT | Apache-2.0 | UNLICENSED" };

  return {
    ok: true,
    value: {
      projectName,
      description,
      authorName,
      packageManager,
      language,
      runtime,
      rpcUrl,
      chainId,
      modules,
      envStrategy,
      includeTests: Boolean(cfg.includeTests),
      includeCi: Boolean(cfg.includeCi),
      includeDockerfile: Boolean(cfg.includeDockerfile),
      license,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality score (0-100)
// ─────────────────────────────────────────────────────────────────────────────

interface ScoreItem { key: string; label: string; got: number; weight: number; }
interface Score { items: ScoreItem[]; total: number; max: number; }

function computeScore(c: ScaffoldConfig): Score {
  const items: ScoreItem[] = [];
  const push = (key: string, label: string, got: number, weight: number) =>
    items.push({ key, label, got, weight });

  push("name",    "Valid npm-style project name",                    NAME_RE.test(c.projectName) ? 5 : 0, 5);
  push("ts",      "TypeScript (typed surface, IDE intellisense)",     c.language === "typescript" ? 15 : 0, 15);

  const pickedCount = ALL_MODULES.filter((k) => c.modules[k]).length;
  // 5 points for first module, +2 per additional, capped at 15.
  const moduleScore = pickedCount === 0 ? 0 : Math.min(15, 5 + (pickedCount - 1) * 2);
  push("modules", `≥1 SDK module wired (${pickedCount}/8 picked)`,    moduleScore, 15);

  push("env",     "Secrets via .env (dotenv) instead of inline",      c.envStrategy === "dotenv" ? 10 : 0, 10);
  push("tests",   "Vitest sanity test scaffold",                       c.includeTests ? 15 : 0, 15);
  push("ci",      "GitHub Actions CI on PR (typecheck + test)",       c.includeCi ? 10 : 0, 10);
  push("docker",  "Multi-stage Dockerfile for runtime image",          c.includeDockerfile ? 10 : 0, 10);
  push("license", "Real OSS license (MIT / Apache-2.0)",              c.license !== "UNLICENSED" ? 5 : 0, 5);
  push("author",  "package.json author populated",                    c.authorName.length > 0 ? 5 : 0, 5);
  push("network", "Mainnet RPC (default endpoint)",                    c.chainId === 7878 ? 10 : 0, 10);

  const total = items.reduce((s, i) => s + i.got, 0);
  const max = items.reduce((s, i) => s + i.weight, 0);
  return { items, total, max };
}

// ─────────────────────────────────────────────────────────────────────────────
// File generators
// ─────────────────────────────────────────────────────────────────────────────

function ext(c: ScaffoldConfig): "ts" | "js" {
  return c.language === "typescript" ? "ts" : "js";
}

function jsonStringify(obj: any): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

function genPackageJson(c: ScaffoldConfig): string {
  const isTs = c.language === "typescript";
  const isBun = c.runtime === "bun";

  const deps: Record<string, string> = {
    "@zebvix/zebvix.js": SDK_VERSION,
    ethers: ETHERS_VERSION,
  };
  if (c.envStrategy === "dotenv") deps.dotenv = DOTENV_VERSION;

  const devDeps: Record<string, string> = {};
  if (isTs) {
    devDeps.typescript = TS_VERSION;
    devDeps["@types/node"] = NODE_TYPES_VERSION;
    if (!isBun) devDeps.tsx = TSX_VERSION;
  }
  if (c.includeTests) devDeps.vitest = VITEST_VERSION;

  const runner = isBun ? "bun run" : isTs ? "tsx" : "node";
  const entry = `src/main.${ext(c)}`;

  const scripts: Record<string, string> = {
    start: `${runner} ${entry}`,
    dev: `${runner} --watch ${entry}`,
  };
  if (isTs) scripts.typecheck = "tsc --noEmit";
  if (isTs) scripts.build = "tsc -p tsconfig.json";
  if (c.includeTests) scripts.test = "vitest run";
  if (c.includeTests) scripts["test:watch"] = "vitest";

  const pkg: any = {
    name: c.projectName,
    version: "0.1.0",
    private: true,
    type: "module",
    description: c.description || `Zebvix SDK starter — ${c.projectName}`,
    license: c.license,
    engines: isBun ? { bun: ">=1.1.0" } : { node: ">=18.17.0" },
    scripts,
    dependencies: deps,
    devDependencies: devDeps,
  };
  if (c.authorName) pkg.author = c.authorName;
  pkg.keywords = ["zebvix", "zbx", "blockchain", "ethers", "sdk", "starter"];
  return jsonStringify(pkg);
}

function genTsconfig(_c: ScaffoldConfig): string {
  return jsonStringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022"],
      strict: true,
      noUncheckedIndexedAccess: true,
      noFallthroughCasesInSwitch: true,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
      skipLibCheck: true,
      outDir: "dist",
      rootDir: "src",
      declaration: true,
      sourceMap: true,
    },
    include: ["src/**/*"],
    exclude: ["node_modules", "dist", "tests"],
  });
}

function genGitignore(c: ScaffoldConfig): string {
  return `# dependencies
node_modules/
${c.runtime === "bun" ? "bun.lockb\n" : ""}# build artefacts
dist/
*.tsbuildinfo

# secrets
.env
.env.local
.env.*.local

# editor / OS
.vscode/
.idea/
.DS_Store
Thumbs.db

# logs
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*
`;
}

function genEnvExample(c: ScaffoldConfig): string {
  const lines: string[] = [
    "# ─── Zebvix RPC ──────────────────────────────────────────────────────",
    "# Public Mainnet endpoint (override only if you run your own node).",
    `ZBX_RPC_URL=${c.rpcUrl}`,
    `ZBX_CHAIN_ID=${c.chainId}`,
    "",
  ];
  if (c.modules.walletOps) {
    lines.push(
      "# ─── Wallet (REQUIRED for walletOps module) ──────────────────────────",
      "# WARNING: never commit a real key.  This file is .env.example —",
      "# copy it to .env (which is git-ignored) and paste the actual key there.",
      "ZBX_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000",
      "",
    );
  }
  return lines.join("\n");
}

// ─── per-module sample code ─────────────────────────────────────────────────

interface ModuleSpec {
  key: ModuleKey;
  fileName: string;
  exportFn: string;
  title: string;
  blurb: string;
  body: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module body generators — language-aware (TS-typed vs plain JS) AND
// type-correct against the current public surface of @zebvix/zebvix.js.
// All field names use the SDK's actual snake_case shapes (amount_out_wei,
// chain_id, total, count, etc.) so generated TS bundles pass `tsc --noEmit`
// in a strict project and generated JS bundles run on plain Node 18+.
// ─────────────────────────────────────────────────────────────────────────────

const t = (isTs: boolean, s: string): string => (isTs ? s : "");

function bodyBlockExplorer(c: ScaffoldConfig): string {
  const isTs = c.language === "typescript";
  return `${t(isTs, `import type { ZebvixProvider } from "@zebvix/zebvix.js";\n\n`)}${t(isTs, `interface BlockShape { hash: string; transactionCount?: number }\ninterface TxShape    { hash: string; from?: string; to?: string | null }\n\n`)}export async function runBlockExplorer(provider${t(isTs, ": ZebvixProvider")}) {
  const tip = await provider.getZbxBlockNumber();
  console.log(\`[block-explorer] tip block #\${tip.height}  proposer=\${tip.proposer}\`);

  const block = await provider.getZbxBlockByNumber(tip.height)${t(isTs, " as BlockShape | null")};
  console.log(\`[block-explorer] hash=\${block?.hash ?? "?"} txs=\${block?.transactionCount ?? "?"}\`);

  const recent = await provider.recentTxs(5)${t(isTs, " as TxShape[]")};
  console.log(\`[block-explorer] last \${recent.length} txs:\`);
  for (const tx of recent) console.log("  -", tx.hash, "→", tx.to ?? "(contract create)");
}
`;
}

function bodyWalletOps(c: ScaffoldConfig): string {
  const isTs = c.language === "typescript";
  return `import { ZebvixWallet, formatZBX } from "@zebvix/zebvix.js";
${t(isTs, `import type { ZebvixProvider } from "@zebvix/zebvix.js";\n\n`)}export async function runWalletOps(provider${t(isTs, ": ZebvixProvider")}) {
  const pk = process.env.ZBX_PRIVATE_KEY;
  if (!pk) {
    console.warn("[wallet-ops] ZBX_PRIVATE_KEY not set — skipping wallet checks");
    return;
  }
  const wallet = new ZebvixWallet(pk, provider);
  const [balance, nonce] = await Promise.all([
    wallet.getZbxBalance(),
    wallet.getZbxNonce(),
  ]);
  console.log(\`[wallet-ops] address=\${wallet.address}\`);
  console.log(\`[wallet-ops] balance=\${formatZBX(balance)} ZBX  nonce=\${nonce}\`);

  // Example transfer (commented out — uncomment to actually broadcast).
  // const tx = await wallet.sendTransaction({
  //   to:    "0xRecipient000000000000000000000000000000",
  //   value: parseZBX("0.001"),
  // });
  // const receipt = await tx.wait();
  // console.log("[wallet-ops] receipt status:", receipt?.status);
}
`;
}

function bodyGovernance(c: ScaffoldConfig): string {
  const isTs = c.language === "typescript";
  return `${t(isTs, `import type { ZebvixProvider } from "@zebvix/zebvix.js";\n\n`)}export async function runGovernance(provider${t(isTs, ": ZebvixProvider")}) {
  const [list, flags, stats] = await Promise.all([
    provider.listProposals(10),
    provider.listFeatureFlags(),
    provider.getVoteStats(),
  ]);
  console.log(\`[governance] \${list.proposals.length}/\${list.count} proposals fetched (tip=\${list.tip_height})\`);
  for (const p of list.proposals.slice(0, 3)) {
    const kind = typeof p.kind === "string" ? p.kind : Object.keys(p.kind)[0];
    console.log(\`  #\${p.id} \${p.status.padEnd(10)} \${kind}\`);
  }
  console.log(\`[governance] feature flags: \${flags.count} (\${flags.flags.length} returned)\`);
  console.log(\`[governance] vote stats:\`, stats);
}
`;
}

function bodyAmm(c: ScaffoldConfig): string {
  const isTs = c.language === "typescript";
  return `import { parseZBX, formatZBX } from "@zebvix/zebvix.js";
${t(isTs, `import type { ZebvixProvider } from "@zebvix/zebvix.js";\n\n`)}export async function runAmm(provider${t(isTs, ": ZebvixProvider")}) {
  const pool  = await provider.getPool();
  const stats = await provider.getPoolStats();
  console.log("[amm] pool:",  pool);
  console.log("[amm] stats:", stats);

  const oneZbxIn = parseZBX("1");
  const quote = await provider.swapQuote("zbx_to_zusd", oneZbxIn);
  console.log(\`[amm] 1 ZBX -> ~\${formatZBX(BigInt(quote.amount_out_wei))} zUSD  (price=\${quote.price})\`);
}
`;
}

function bodyBridge(c: ScaffoldConfig): string {
  const isTs = c.language === "typescript";
  return `${t(isTs, `import type { ZebvixProvider } from "@zebvix/zebvix.js";\n\n`)}export async function runBridge(provider${t(isTs, ": ZebvixProvider")}) {
  const list  = await provider.listBridgeNetworks();
  const stats = await provider.getBridgeStats();
  console.log(\`[bridge] \${list.networks.length}/\${list.count} networks supported\`);
  for (const n of list.networks.slice(0, 3)) {
    console.log(\`  - \${n.name.padEnd(12)} kind=\${n.kind.padEnd(8)} chain_id=\${n.chain_id ?? "?"}  active=\${n.active}\`);
  }
  console.log("[bridge] stats:", stats);
}
`;
}

function bodyStaking(c: ScaffoldConfig): string {
  const isTs = c.language === "typescript";
  return `${t(isTs, `import type { ZebvixProvider } from "@zebvix/zebvix.js";\n\n`)}${t(isTs, `interface ValidatorShape { address: string; self_stake_wei?: string; total_delegated_wei?: string }\n\n`)}export async function runStaking(provider${t(isTs, ": ZebvixProvider")}) {
  const validators = (await provider.listValidators())${t(isTs, " as ValidatorShape[]")};
  console.log(\`[staking] \${validators.length} validators returned\`);
  for (const v of validators.slice(0, 5)) {
    console.log(\`  \${v.address}  self=\${v.self_stake_wei ?? "?"}  delegated=\${v.total_delegated_wei ?? "?"}\`);
  }
  const staking = await provider.getStaking();
  console.log("[staking] global:", staking);
}
`;
}

function bodyPayid(c: ScaffoldConfig): string {
  const isTs = c.language === "typescript";
  return `${t(isTs, `import type { ZebvixProvider } from "@zebvix/zebvix.js";\n\n`)}export async function runPayId(provider${t(isTs, ": ZebvixProvider")}) {
  const count = await provider.getPayIdCount();
  console.log(\`[pay-id] \${count.total} Pay-IDs registered on chain\`);

  // Resolve the proposer of the current tip block — gives a concrete on-chain
  // address to look up without needing any user-supplied input.
  const tip    = await provider.getZbxBlockNumber();
  const record = await provider.getPayIdOf(tip.proposer);
  if (record) {
    console.log(\`[pay-id] tip proposer \${tip.proposer} -> \${record.pay_id}\`);
  } else {
    console.log(\`[pay-id] tip proposer \${tip.proposer} has no Pay-ID registered\`);
  }
}
`;
}

function bodyMempool(c: ScaffoldConfig): string {
  const isTs = c.language === "typescript";
  return `${t(isTs, `import type { ZebvixProvider } from "@zebvix/zebvix.js";\n\n`)}${t(isTs, `interface PendingTx { hash: string; from?: string; to?: string | null }\n\n`)}export async function runMempool(provider${t(isTs, ": ZebvixProvider")}) {
  const status = await provider.getMempoolStatus();
  console.log(\`[mempool] pending=\${status.pending_count}  queued=\${status.queued_count}\`);

  const pending = (await provider.getMempoolPending(50))${t(isTs, " as PendingTx[]")};
  console.log(\`[mempool] \${pending.length} pending tx(s) in this snapshot\`);
  for (const tx of pending.slice(0, 3)) {
    console.log(\`  - hash=\${tx.hash} from=\${tx.from ?? "?"} to=\${tx.to ?? "(create)"}\`);
  }
}
`;
}

function moduleSpecs(c: ScaffoldConfig): ModuleSpec[] {
  const specs: ModuleSpec[] = [];
  const e = ext(c);
  if (c.modules.blockExplorer) specs.push({
    key: "blockExplorer", fileName: `block-explorer.${e}`, exportFn: "runBlockExplorer",
    title: "Block & tx explorer", blurb: "Tip block, recent txs, decode a block.",
    body: bodyBlockExplorer(c),
  });
  if (c.modules.walletOps) specs.push({
    key: "walletOps", fileName: `wallet-ops.${e}`, exportFn: "runWalletOps",
    title: "Wallet operations", blurb: "Native ZBX balance, nonce, sample transfer (commented).",
    body: bodyWalletOps(c),
  });
  if (c.modules.governance) specs.push({
    key: "governance", fileName: `governance.${e}`, exportFn: "runGovernance",
    title: "Governance", blurb: "Proposals, feature flags, vote stats.",
    body: bodyGovernance(c),
  });
  if (c.modules.amm) specs.push({
    key: "amm", fileName: `amm.${e}`, exportFn: "runAmm",
    title: "Native AMM", blurb: "Pool reserves, stats, swap quote ZBX->zUSD.",
    body: bodyAmm(c),
  });
  if (c.modules.bridge) specs.push({
    key: "bridge", fileName: `bridge.${e}`, exportFn: "runBridge",
    title: "Cross-chain bridge", blurb: "List networks, fetch stats.",
    body: bodyBridge(c),
  });
  if (c.modules.staking) specs.push({
    key: "staking", fileName: `staking.${e}`, exportFn: "runStaking",
    title: "Validator staking", blurb: "Validator set + global staking metrics.",
    body: bodyStaking(c),
  });
  if (c.modules.payid) specs.push({
    key: "payid", fileName: `payid.${e}`, exportFn: "runPayId",
    title: "Pay-ID resolver", blurb: "Look up a username -> address.",
    body: bodyPayid(c),
  });
  if (c.modules.mempool) specs.push({
    key: "mempool", fileName: `mempool.${e}`, exportFn: "runMempool",
    title: "Mempool inspector", blurb: "Pending tx queue snapshot.",
    body: bodyMempool(c),
  });
  return specs;
}

function genZebvixBootstrap(c: ScaffoldConfig): string {
  const isTs = c.language === "typescript";
  const dotenvLine = c.envStrategy === "dotenv"
    ? `import "dotenv/config";\n`
    : "";

  if (isTs) {
    return `${dotenvLine}import { ZebvixProvider } from "@zebvix/zebvix.js";

// Centralised bootstrap.  All modules import \`getProvider()\` from here so
// you can swap RPC URL / chainId in exactly one place (or via env vars).

interface BootOpts { rpcUrl: string; chainId: number; }

const DEFAULT_OPTS: BootOpts = {
  rpcUrl:  process.env.ZBX_RPC_URL  ?? "${c.rpcUrl}",
  chainId: Number(process.env.ZBX_CHAIN_ID ?? ${c.chainId}),
};

let _shared: ZebvixProvider | null = null;

export function getProvider(overrides: Partial<BootOpts> = {}): ZebvixProvider {
  if (_shared && Object.keys(overrides).length === 0) return _shared;
  const opts: BootOpts = { ...DEFAULT_OPTS, ...overrides };
  const p = new ZebvixProvider({ rpcUrl: opts.rpcUrl });
  if (Object.keys(overrides).length === 0) _shared = p;
  return p;
}

export const RPC_URL: string  = DEFAULT_OPTS.rpcUrl;
export const CHAIN_ID: number = DEFAULT_OPTS.chainId;

export type { ZebvixProvider } from "@zebvix/zebvix.js";
`;
  }
  return `${dotenvLine}import { ZebvixProvider } from "@zebvix/zebvix.js";

// Centralised bootstrap.  All modules import \`getProvider()\` from here so
// you can swap RPC URL / chainId in exactly one place (or via env vars).

const DEFAULT_OPTS = {
  rpcUrl:  process.env.ZBX_RPC_URL  ?? "${c.rpcUrl}",
  chainId: Number(process.env.ZBX_CHAIN_ID ?? ${c.chainId}),
};

let _shared = null;

export function getProvider(overrides = {}) {
  if (_shared && Object.keys(overrides).length === 0) return _shared;
  const opts = { ...DEFAULT_OPTS, ...overrides };
  const p = new ZebvixProvider({ rpcUrl: opts.rpcUrl });
  if (Object.keys(overrides).length === 0) _shared = p;
  return p;
}

export const RPC_URL  = DEFAULT_OPTS.rpcUrl;
export const CHAIN_ID = DEFAULT_OPTS.chainId;
`;
}

function genMainEntry(c: ScaffoldConfig): string {
  const specs = moduleSpecs(c);
  const isTs = c.language === "typescript";
  const imports: string[] = [`import { getProvider, RPC_URL } from "./zebvix.js";`];
  for (const s of specs) {
    imports.push(`import { ${s.exportFn} } from "./modules/${s.fileName.replace(/\.(ts|js)$/, ".js")}";`);
  }
  const calls = specs.map((s) =>
    `  await section(${JSON.stringify(s.title)}, () => ${s.exportFn}(provider));`,
  ).join("\n");

  // Language-aware param/return annotations so the generated entry passes the
  // user's own \`tsc --noEmit\` (which we wire as `pnpm typecheck` in CI).
  const sectionSig = isTs
    ? `async function section(title: string, fn: () => Promise<unknown>): Promise<void>`
    : `async function section(title, fn)`;
  const errMsg = isTs
    ? `(err as Error)?.message ?? err`
    : `err && err.message ? err.message : err`;
  const fatalSig = isTs ? `(err: unknown)` : `(err)`;

  return `${imports.join("\n")}

${sectionSig} {
  console.log(\`\\n── \${title} ───────────────────────────────────────────\`);
  try {
    await fn();
  } catch (err) {
    console.error(\`  ! \${title} failed:\`, ${errMsg});
  }
}

async function main()${isTs ? ": Promise<void>" : ""} {
  const provider = getProvider();
  console.log("Zebvix SDK starter — ${c.projectName}");
  console.log("RPC:", RPC_URL);
${calls || "  console.log('No SDK modules selected — pick at least one in the workbench.');"}
  console.log("\\nDone.");
}

main().catch(${fatalSig} => {
  console.error("fatal:", err);
  process.exit(1);
});
`;
}

function genReadme(c: ScaffoldConfig, score: number, modules: ModuleSpec[]): string {
  const pm = c.packageManager;
  const installCmd = pm === "bun"  ? "bun install"
                   : pm === "yarn" ? "yarn"
                   : pm === "npm"  ? "npm install"
                   : "pnpm install";
  const runCmd = pm === "bun"  ? "bun run start"
                : pm === "yarn" ? "yarn start"
                : pm === "npm"  ? "npm start"
                : "pnpm start";
  const moduleList = modules.length === 0
    ? "_(no modules selected — re-generate from the workbench with at least one box ticked)_"
    : modules.map((m) => `- **${m.title}** (\`src/modules/${m.fileName}\`) — ${m.blurb}`).join("\n");
  return `# ${c.projectName}

${c.description || `Zebvix SDK starter project (quality score ${score}/100).`}

Generated by the Zebvix SDK Scaffold Workbench.  Stack:

- ${c.language === "typescript" ? "**TypeScript** (strict, ESM, NodeNext)" : "**JavaScript** (ESM)"}
- **Runtime**: ${c.runtime === "bun" ? "Bun ≥ 1.1" : "Node ≥ 18.17"}
- **Package manager**: ${pm}
- **License**: ${c.license}

## Install

\`\`\`bash
${installCmd}
cp .env.example .env
# edit .env — set your private key only if the wallet-ops module is enabled
\`\`\`

## Run

\`\`\`bash
${runCmd}
\`\`\`

This runs every selected module sequentially and prints a section header for
each one.  Failures in one module do not abort the others.

## Modules included

${moduleList}

## Project layout

\`\`\`
${c.projectName}/
  package.json
${c.language === "typescript" ? "  tsconfig.json\n" : ""}  .env.example
  .gitignore
  src/
    main.${ext(c)}            entry — runs every module
    zebvix.${ext(c)}          getProvider() bootstrap
    modules/
${modules.map((m) => `      ${m.fileName}`).join("\n") || "      (none yet — pick modules in the workbench)"}
${c.includeTests ? `  tests/
    sanity.test.${ext(c)}     vitest smoke tests (offline + live)
` : ""}${c.includeCi ? `  .github/workflows/ci.yml
` : ""}${c.includeDockerfile ? `  Dockerfile
` : ""}\`\`\`

## Connecting to a different network

Override via env:

\`\`\`bash
export ZBX_RPC_URL=https://my-private-node.example.io
export ZBX_CHAIN_ID=7878
${runCmd}
\`\`\`

…or programmatically:

\`\`\`${ext(c)}
import { getProvider } from "./src/zebvix.${ext(c) === "ts" ? "js" : "js"}";
const provider = getProvider({ rpcUrl: "https://my-node.io" });
\`\`\`

## Going further

- **/rpc-playground** on the dashboard exposes every \`zbx_*\` method live.
- **/sdk** (this workbench) regenerates this scaffold with different choices.
- The full SDK reference lives in the \`@zebvix/zebvix.js\` README.

## License

${c.license === "UNLICENSED"
  ? "UNLICENSED — proprietary."
  : `${c.license} — see the \`LICENSE\` file.`}
`;
}

function genVitest(c: ScaffoldConfig): string {
  const e = ext(c);
  return `import { describe, it, expect } from "vitest";
import { getProvider, RPC_URL, CHAIN_ID } from "../src/zebvix.${e === "ts" ? "js" : "js"}";

describe("zebvix.${e === "ts" ? "ts" : "js"} starter — offline sanity", () => {
  it("exports a numeric chainId", () => {
    expect(typeof CHAIN_ID).toBe("number");
    expect(CHAIN_ID).toBeGreaterThan(0);
  });
  it("exports a non-empty rpcUrl", () => {
    expect(typeof RPC_URL).toBe("string");
    expect(RPC_URL.length).toBeGreaterThan(0);
  });
  it("getProvider() returns a singleton on default opts", () => {
    const a = getProvider();
    const b = getProvider();
    expect(a).toBe(b);
  });
});

describe("zebvix.${e === "ts" ? "ts" : "js"} starter — live RPC (skipped if RPC unreachable)", () => {
  it("can fetch the tip block (best-effort)", async () => {
    const provider = getProvider();
    try {
      const tip = await provider.getZbxBlockNumber();
      expect(tip.height).toBeGreaterThan(0n);
    } catch (err) {
      console.warn("  (live test skipped — RPC unreachable:", String(err), ")");
    }
  }, 10_000);
});
`;
}

function genCi(c: ScaffoldConfig): string {
  const pm = c.packageManager;

  // Bun gets its own setup-bun action and bypasses setup-node entirely.
  if (pm === "bun") {
    return `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.1"
      - run: bun install --frozen-lockfile
${c.language === "typescript" ? `      - run: bun run typecheck\n` : ""}${c.includeTests ? `      - run: bun run test\n` : ""}`;
  }

  const cache = pm === "yarn" ? "yarn" : pm === "pnpm" ? "pnpm" : "npm";
  const installStep = pm === "yarn"
    ? "yarn install --frozen-lockfile"
    : pm === "npm"
      ? "npm ci"
      : "pnpm install --frozen-lockfile";
  const setupPm = pm === "pnpm"
    ? `      - uses: pnpm/action-setup@v4
        with:
          version: 9
`
    : pm === "yarn"
      ? `      - run: corepack enable
`
      : "";
  return `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${setupPm}      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "${cache}"
      - run: ${installStep}
${c.language === "typescript" ? `      - run: ${pm} run typecheck\n` : ""}${c.includeTests ? `      - run: ${pm} run test\n` : ""}`;
}

function genDockerfile(c: ScaffoldConfig): string {
  const isTs = c.language === "typescript";
  const isBun = c.runtime === "bun";
  if (isBun) {
    return `# syntax=docker/dockerfile:1
FROM oven/bun:1.1-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN bun install --no-save

FROM oven/bun:1.1-alpine AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER bun
ENV NODE_ENV=production
CMD ["bun", "run", "src/main.${ext(c)}"]
`;
  }
  if (!isTs) {
    return `# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node
ENV NODE_ENV=production
CMD ["node", "src/main.js"]
`;
  }
  // TypeScript -> compile to dist, run from dist
  return `# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx tsc -p tsconfig.json

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/main.js"]
`;
}

function genLicense(c: ScaffoldConfig): string | null {
  const year = new Date().getFullYear();
  const holder = c.authorName || c.projectName;
  if (c.license === "MIT") {
    return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
`;
  }
  if (c.license === "Apache-2.0") {
    return `Copyright ${year} ${holder}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle assembly
// ─────────────────────────────────────────────────────────────────────────────

function buildFiles(c: ScaffoldConfig, score: number): Record<string, string> {
  const out: Record<string, string> = {};
  const e = ext(c);
  const specs = moduleSpecs(c);

  out["package.json"] = genPackageJson(c);
  if (c.language === "typescript") out["tsconfig.json"] = genTsconfig(c);
  out["README.md"] = genReadme(c, score, specs);
  out[".env.example"] = genEnvExample(c);
  out[".gitignore"] = genGitignore(c);
  out[`src/zebvix.${e}`] = genZebvixBootstrap(c);
  out[`src/main.${e}`] = genMainEntry(c);

  for (const s of specs) {
    out[`src/modules/${s.fileName}`] = s.body;
  }
  if (c.includeTests) out[`tests/sanity.test.${e}`] = genVitest(c);
  if (c.includeCi)    out[".github/workflows/ci.yml"] = genCi(c);
  if (c.includeDockerfile) out["Dockerfile"] = genDockerfile(c);
  const lic = genLicense(c);
  if (lic) out["LICENSE"] = lic;

  return out;
}

function depsSummary(c: ScaffoldConfig): { runtime: Record<string, string>; dev: Record<string, string> } {
  const runtime: Record<string, string> = {
    "@zebvix/zebvix.js": SDK_VERSION,
    ethers: ETHERS_VERSION,
  };
  if (c.envStrategy === "dotenv") runtime.dotenv = DOTENV_VERSION;

  const dev: Record<string, string> = {};
  if (c.language === "typescript") {
    dev.typescript = TS_VERSION;
    dev["@types/node"] = NODE_TYPES_VERSION;
    if (c.runtime !== "bun") dev.tsx = TSX_VERSION;
  }
  if (c.includeTests) dev.vitest = VITEST_VERSION;
  return { runtime, dev };
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

sdkScaffoldRouter.post("/sdk-scaffold/preview", (req, res) => {
  const v = validate(req.body);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }
  const cfg = v.value;
  const score = computeScore(cfg);
  const files = buildFiles(cfg, score.total);
  const totalBytes = Object.values(files).reduce((s, c) => s + c.length, 0);
  const totalLoc = Object.values(files).reduce((s, c) => s + c.split("\n").length, 0);
  const fileCount = Object.keys(files).length;
  const moduleLoc: Record<string, number> = {};
  for (const s of moduleSpecs(cfg)) moduleLoc[s.key] = s.body.split("\n").length;
  const installHash = crypto.createHash("sha256")
    .update(files["package.json"] || "")
    .digest("hex");

  res.json({
    config: cfg,
    files,
    score,
    deps: depsSummary(cfg),
    summary: {
      installHash,
      totalBytes,
      totalLoc,
      fileCount,
      moduleLoc,
    },
  });
});

sdkScaffoldRouter.post("/sdk-scaffold/generate", (req, res) => {
  const v = validate(req.body);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }
  const cfg = v.value;
  const score = computeScore(cfg);
  const files = buildFiles(cfg, score.total);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `sdkscaffold-${cfg.projectName}-`));
  const root = path.join(tmp, cfg.projectName);
  fs.mkdirSync(root, { recursive: true });

  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${cfg.projectName}.tar.gz"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Sdk-Score", String(score.total));

    const tar = spawn("tar", ["-czf", "-", "-C", tmp, cfg.projectName], { stdio: ["ignore", "pipe", "pipe"] });
    tar.stdout.pipe(res);
    tar.stderr.on("data", (d) => console.error("[sdkscaffold tar]", d.toString()));
    tar.on("error", (e) => {
      console.error("[sdkscaffold spawn]", e);
      if (!res.headersSent) res.status(500).end();
    });
    tar.on("exit", (code) => {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      if (code !== 0 && !res.writableEnded) res.end();
    });
  } catch (err: any) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    if (!res.headersSent) res.status(500).json({ error: String(err?.message || err) });
  }
});

export default sdkScaffoldRouter;
