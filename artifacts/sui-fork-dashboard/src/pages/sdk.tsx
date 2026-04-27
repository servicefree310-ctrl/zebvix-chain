import React, { useEffect, useMemo, useRef, useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Package,
  Code2,
  Boxes,
  Wallet,
  Network,
  Shield,
  ArrowLeftRight,
  Vote,
  AtSign,
  Coins,
  Activity,
  TrendingUp,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  Zap,
  Layers,
  Cpu,
  BookOpen,
  Sparkles,
  Wrench,
  Settings2,
  Gauge,
  Loader2,
  Download,
  Copy,
  Bug,
  ServerCog,
  FlaskConical,
  GitBranch,
  Container,
  ScrollText,
  Hash,
  KeyRound,
  Globe,
  FileCode,
  CircleSlash2,
} from "lucide-react";

const API_BASE = (import.meta as any).env?.BASE_URL?.replace(/\/+$/, "") || "";

// ─────────────────────────────────────────────────────────────────────────────
// Scaffold Workbench types — kept in lock-step with backend ScaffoldConfig
// ─────────────────────────────────────────────────────────────────────────────

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
type Language = "typescript" | "javascript";
type Runtime = "node" | "bun";
type EnvStrategy = "dotenv" | "process";
type LicenseChoice = "MIT" | "Apache-2.0" | "UNLICENSED";

interface ScaffoldModules {
  blockExplorer: boolean;
  walletOps:     boolean;
  governance:    boolean;
  amm:           boolean;
  bridge:        boolean;
  staking:       boolean;
  payid:         boolean;
  mempool:       boolean;
}

interface ScaffoldConfig {
  projectName:       string;
  description:       string;
  authorName:        string;
  packageManager:    PackageManager;
  language:          Language;
  runtime:           Runtime;
  rpcUrl:            string;
  chainId:           number;
  modules:           ScaffoldModules;
  envStrategy:       EnvStrategy;
  includeTests:      boolean;
  includeCi:         boolean;
  includeDockerfile: boolean;
  license:           LicenseChoice;
}

interface ScoreItem { key: string; label: string; got: number; weight: number; }
interface PreviewResponse {
  files: Record<string, string>;
  deps: { runtime: Record<string, string>; dev: Record<string, string> };
  score: { items: ScoreItem[]; total: number; max: number };
  summary: { fileCount: number; totalBytes: number; totalLoc: number; installHash: string };
}

const DEFAULT_CFG: ScaffoldConfig = {
  projectName:       "my-zbx-app",
  description:       "My Zebvix dapp",
  authorName:        "",
  packageManager:    "pnpm",
  language:          "typescript",
  runtime:           "node",
  rpcUrl:            "http://93.127.213.192:8545",
  chainId:           7878,
  modules: {
    blockExplorer: true,
    walletOps:     true,
    governance:    true,
    amm:           true,
    bridge:        false,
    staking:       true,
    payid:         true,
    mempool:       false,
  },
  envStrategy:       "dotenv",
  includeTests:      true,
  includeCi:         true,
  includeDockerfile: true,
  license:           "MIT",
};

const MODULE_META: Array<{ key: keyof ScaffoldModules; label: string; hint: string; icon: React.ElementType }> = [
  { key: "blockExplorer", label: "Block & tx explorer",  hint: "zbx_blockNumber, recentTxs, getZbxLogs",            icon: Boxes },
  { key: "walletOps",     label: "Wallet operations",    hint: "ZebvixWallet — balance, nonce, sendTransaction",   icon: Wallet },
  { key: "governance",    label: "Governance",           hint: "listProposals, vote, getProposalState",            icon: Vote },
  { key: "amm",           label: "Native AMM",           hint: "swapQuote, addLiquidity, getPool",                 icon: ArrowLeftRight },
  { key: "bridge",        label: "Cross-chain bridge",   hint: "lockAsset, claim, listSupportedChains",            icon: Network },
  { key: "staking",       label: "Validator staking",    hint: "delegate, undelegate, claimRewards, validators",   icon: Shield },
  { key: "payid",         label: "Pay-ID resolver",      hint: "resolvePayId, registerPayId, listOwnedPayIds",     icon: AtSign },
  { key: "mempool",       label: "Mempool inspector",    hint: "getPendingTransactions, watchPending",             icon: Activity },
];

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card/60">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide mb-2">
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
      <div className="text-2xl font-mono font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}

type RpcGroup = {
  icon: React.ElementType;
  title: string;
  accent: string;
  blurb: string;
  methods: string[];
};

const RPC_GROUPS: RpcGroup[] = [
  {
    icon: Activity,
    title: "Identity & Sync",
    accent: "text-emerald-400 border-emerald-500/40",
    blurb:
      "Discover what node you're talking to, chain id, and whether the node is caught up to the tip.",
    methods: [
      "getClientVersion",
      "getZbxClientVersion",
      "getZbxChainInfo",
      "getZbxNetVersion",
      "getSyncing",
    ],
  },
  {
    icon: Boxes,
    title: "Block & Transaction",
    accent: "text-primary border-primary/40",
    blurb:
      "Read blocks, recent txs, simulate calls, estimate gas. Parity with eth_* but typed for ZBX semantics.",
    methods: [
      "getZbxBlockNumber",
      "getZbxBlockByNumber",
      "recentTxs",
      "zbxCall",
      "zbxEstimateGas",
      "sendRawZbxTransaction",
      "sendRawZvmTransaction",
      "getZvmReceipt",
    ],
  },
  {
    icon: Wallet,
    title: "Accounts",
    accent: "text-amber-400 border-amber-500/40",
    blurb:
      "Native ZBX balance, nonce, contract code & storage. Both eth_* and zbx_* resolve against the same ledger.",
    methods: [
      "getZbxBalance",
      "getZbxNonce",
      "getZbxCode",
      "getZbxStorageAt",
      "getZbxAccounts",
    ],
  },
  {
    icon: AtSign,
    title: "Pay-ID",
    accent: "text-cyan-400 border-cyan-500/40",
    blurb:
      "Human-readable on-chain usernames mapped to addresses. Resolve in either direction.",
    methods: ["lookupPayId", "getPayIdOf", "getPayIdCount"],
  },
  {
    icon: Vote,
    title: "Governance",
    accent: "text-violet-400 border-violet-500/40",
    blurb:
      "Token-weighted proposals, voting, runtime feature flags, shadow-execution preview before a real vote.",
    methods: [
      "listProposals",
      "getProposal",
      "checkProposer",
      "hasVoted",
      "shadowExecProposal",
      "listFeatureFlags",
      "getFeatureFlag",
      "getVoteStats",
      "getGovernor",
      "getAdmin",
    ],
  },
  {
    icon: Shield,
    title: "Multisig",
    accent: "text-rose-400 border-rose-500/40",
    blurb: "M-of-N native wallets with on-chain proposals — no smart-contract overhead.",
    methods: [
      "getMultisig",
      "getMultisigProposal",
      "getMultisigProposals",
      "listMultisigsByOwner",
      "getMultisigCount",
    ],
  },
  {
    icon: Coins,
    title: "AMM / Pool",
    accent: "text-emerald-400 border-emerald-500/40",
    blurb:
      "Native ZBX↔zUSD pool — quote a swap, fetch reserves, recent swaps, LP balances.",
    methods: [
      "getPool",
      "getPoolStats",
      "swapQuote",
      "recentSwaps",
      "getLpBalance",
      "getZusdBalance",
      "toZusd",
    ],
  },
  {
    icon: ArrowLeftRight,
    title: "Bridge",
    accent: "text-amber-400 border-amber-500/40",
    blurb: "Lock-and-mint / burn-and-release across networks. Multi-asset, claim-tracked.",
    methods: [
      "listBridgeNetworks",
      "getBridgeNetwork",
      "listBridgeAssets",
      "getBridgeAsset",
      "getBridgeStats",
      "isBridgeClaimUsed",
      "recentBridgeOutEvents",
    ],
  },
  {
    icon: TrendingUp,
    title: "Staking",
    accent: "text-primary border-primary/40",
    blurb: "Validators, delegations, locked + unlocked rewards.",
    methods: [
      "getStaking",
      "getStakingValidator",
      "listValidators",
      "getValidator",
      "getDelegation",
      "getDelegationsByDelegator",
      "getLockedRewards",
    ],
  },
  {
    icon: Activity,
    title: "Stats",
    accent: "text-blue-400 border-blue-500/40",
    blurb: "Total supply, native reserve, USD price, burn stats.",
    methods: [
      "getSupply",
      "getReserveWei",
      "getUsdPrice",
      "getPriceUSD",
      "getBurnStats",
    ],
  },
  {
    icon: Layers,
    title: "Mempool",
    accent: "text-cyan-400 border-cyan-500/40",
    blurb: "What's pending, queue depth, simple inspection.",
    methods: ["getMempoolPending", "getMempoolStatus"],
  },
  {
    icon: Zap,
    title: "Fees",
    accent: "text-amber-400 border-amber-500/40",
    blurb: "Current gas price, blob base fee (EIP-4844), fee history, on-chain bounds.",
    methods: ["getZbxGasPrice", "getBlobBaseFee", "getFeeBounds", "getZbxFeeHistory"],
  },
  {
    icon: FileCode2,
    title: "Logs",
    accent: "text-violet-400 border-violet-500/40",
    blurb: "Filter contract events the same way you would with eth_getLogs.",
    methods: ["getZbxLogs"],
  },
];

export default function SdkPage() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">
            Developer SDK
          </Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
            v0.1.0-alpha.1
          </Badge>
          <Badge variant="outline" className="text-blue-400 border-blue-500/40">
            TypeScript
          </Badge>
          <Badge variant="outline" className="text-violet-400 border-violet-500/40">
            ethers v6
          </Badge>
          <Badge variant="outline" className="text-amber-400 border-amber-500/40">
            MIT
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Package className="w-7 h-7 text-primary" />
          zebvix.js
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          The official TypeScript SDK for the Zebvix L1 blockchain — a thin, type-safe
          wrapper around <code className="text-sm bg-muted px-1.5 py-0.5 rounded">ethers.js v6</code>{" "}
          that exposes Zebvix-native <code className="text-sm bg-muted px-1.5 py-0.5 rounded">zbx_*</code>{" "}
          RPC methods alongside the standard Ethereum-spec namespace. The execution layer
          (ZVM) is Cancun-EVM-bytecode compatible, so MetaMask, Hardhat, Foundry,
          ethers and viem all work zero-config.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">Why use this SDK?</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                <strong className="text-emerald-400">Drop-in ethers compatibility</strong>{" "}
                — <code className="text-xs bg-muted px-1 rounded">ZebvixProvider</code> extends{" "}
                <code className="text-xs bg-muted px-1 rounded">JsonRpcProvider</code>,{" "}
                <code className="text-xs bg-muted px-1 rounded">ZebvixWallet</code> extends{" "}
                <code className="text-xs bg-muted px-1 rounded">Wallet</code>. Every standard ZVM operation works unchanged.
              </li>
              <li>
                <strong className="text-emerald-400">Native zbx_* access</strong> — typed
                wrappers for 60+ Zebvix-specific RPC methods (governance, multisig, AMM, bridge, staking, Pay-ID).
              </li>
              <li>
                <strong className="text-emerald-400">Built-in chain config</strong> —{" "}
                <code className="text-xs bg-muted px-1 rounded">ZEBVIX_MAINNET</code> constant ships
                chain ID, RPC URL, precompile addresses.
              </li>
              <li>
                <strong className="text-emerald-400">Tiny surface</strong> — exactly one
                runtime dependency (<code className="text-xs bg-muted px-1 rounded">ethers ^6.13</code>).
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={Cpu}
          label="RPC Methods"
          value="69"
          sub="native zbx_* (typed)"
        />
        <StatTile
          icon={Code2}
          label="Lines of Code"
          value="733"
          sub="across 7 source files"
        />
        <StatTile
          icon={Boxes}
          label="Dependencies"
          value="1"
          sub="ethers ^6.13"
        />
        <StatTile
          icon={Network}
          label="Chain ID"
          value="7878"
          sub="0x1ec6 — ZBX gas"
        />
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* SCAFFOLD WORKBENCH — interactive starter project generator         */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <ScaffoldWorkbench />

      {/* Install */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            Install
          </CardTitle>
          <CardDescription>
            Add the SDK and ethers v6 to your project. Works in Node 18+ and modern
            browsers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CodeBlock language="bash" code={`pnpm add @zebvix/zebvix.js ethers`} />
          <CodeBlock language="bash" code={`# or with npm\nnpm install @zebvix/zebvix.js ethers`} />
          <div className="border-l-4 border-l-amber-500/50 bg-amber-500/5 p-3 rounded-md flex gap-3 text-xs">
            <BookOpen className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-muted-foreground">
              <strong className="text-foreground">Inside this monorepo</strong> the package
              is exposed as <code className="text-xs bg-muted px-1 rounded">@workspace/zebvix-js</code>{" "}
              for local development. The npm-published name will be{" "}
              <code className="text-xs bg-muted px-1 rounded">@zebvix/zebvix.js</code>.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quickstart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Quickstart
          </CardTitle>
          <CardDescription>
            Read the chain head, list governance proposals, send a transfer — under 20
            lines.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CodeBlock
            language="typescript"
            code={`import {
  ZebvixProvider,
  ZebvixWallet,
  parseZBX,
  formatZBX,
} from "@zebvix/zebvix.js";

const provider = new ZebvixProvider();
// equivalent to: new ZebvixProvider({ rpcUrl: "http://93.127.213.192:8545" })

// Native zbx_* RPC
const tip = await provider.getZbxBlockNumber();
console.log(\`Block #\${tip.height}\`);

const proposals = await provider.listProposals(10);
const flags    = await provider.listFeatureFlags();
const pool     = await provider.getPool();

// Wallet
const wallet = new ZebvixWallet(process.env.ZBX_PRIVATE_KEY!, provider);
console.log("Balance:", formatZBX(await wallet.getZbxBalance()), "ZBX");

// Standard ZVM transfer (inherited from ethers.Wallet — same wire format
// as Ethereum, so any wallet/library that speaks EVM speaks Zebvix).
const tx = await wallet.sendTransaction({
  to: "0xRecipient...",
  value: parseZBX("1.5"),
});
await tx.wait();

const receipt = await provider.getTransactionReceipt(tx.hash);
console.log("Status:", receipt?.status, "Block:", receipt?.blockNumber);`}
          />
        </CardContent>
      </Card>

      {/* Constants & units */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="w-4 h-4 text-primary" />
              Chain constants
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Export</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-xs">ZEBVIX_MAINNET</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    ZebvixChainInfo
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    Chain ID 7878, ZBX symbol, 18 decimals, RPC URL
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">PRECOMPILES</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    const
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    Built-in addresses 0x80 – 0x83
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">ZBX_DECIMALS</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    18
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    Native token decimals
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="w-4 h-4 text-primary" />
              Unit helpers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock
              language="typescript"
              code={`parseZBX("1.5")
// → 1500000000000000000n

formatZBX(1500000000000000000n)
// → "1.5"

parseGwei("20")
// → 20000000000n

formatGwei(20000000000n)
// → "20.0"`}
            />
          </CardContent>
        </Card>
      </div>

      {/* Wallet helpers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            ZebvixWallet helpers
          </CardTitle>
          <CardDescription>
            Everything from <code className="text-xs bg-muted px-1 rounded">ethers.Wallet</code>{" "}
            (sendTransaction, signMessage, signTypedData, connect, …) plus these Zebvix-native shortcuts:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock
            language="typescript"
            code={`wallet.getZbxBalance()      // → bigint  (native ZBX)
wallet.getZbxNonce()        // → bigint  (native nonce)
wallet.getZusdBalance()     // → bigint  (zUSD on AMM)
wallet.getLpBalance()       // → bigint  (ZBX/zUSD LP shares)
wallet.getMyPayId()         // → PayIdRecord | null
wallet.listMyMultisigs()    // → Address[]`}
          />
        </CardContent>
      </Card>

      {/* RPC method groups */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground">
          ZebvixProvider — full method reference
        </h2>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Every <code className="text-xs bg-muted px-1 rounded">zbx_*</code> namespace method gets
          a typed wrapper. Standard <code className="text-xs bg-muted px-1 rounded">eth_*</code>,{" "}
          <code className="text-xs bg-muted px-1 rounded">net_*</code> and{" "}
          <code className="text-xs bg-muted px-1 rounded">web3_*</code> calls are inherited from
          <code className="text-xs bg-muted px-1 rounded">JsonRpcProvider</code> — use them
          directly when you want EVM-spec semantics.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {RPC_GROUPS.map((g) => (
          <Card key={g.title}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <g.icon className={`w-4 h-4 ${g.accent.split(" ")[0]}`} />
                  {g.title}
                </CardTitle>
                <Badge variant="outline" className={g.accent}>
                  {g.methods.length} {g.methods.length === 1 ? "method" : "methods"}
                </Badge>
              </div>
              <CardDescription className="text-xs pt-1">{g.blurb}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {g.methods.map((m) => (
                  <code
                    key={m}
                    className="text-[11px] font-mono bg-muted/60 border border-border/40 px-1.5 py-0.5 rounded"
                  >
                    {m}
                  </code>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Network table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            Networks
          </CardTitle>
          <CardDescription>
            Default endpoint shipped in the SDK. Override with{" "}
            <code className="text-xs bg-muted px-1 rounded">{`new ZebvixProvider({ rpcUrl })`}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Network</TableHead>
                <TableHead>Chain ID</TableHead>
                <TableHead>RPC</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-semibold">Mainnet</TableCell>
                <TableCell className="font-mono text-xs">
                  7878 <span className="text-muted-foreground">(0x1ec6)</span>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  http://93.127.213.192:8545
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
                    LIVE
                  </Badge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Examples */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-primary" />
            Common recipes
          </CardTitle>
          <CardDescription>
            Real snippets you can paste into a Node script.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <div className="text-sm font-semibold text-foreground mb-2">
              Resolve a Pay-ID to an address
            </div>
            <CodeBlock
              language="typescript"
              code={`const record = await provider.lookupPayId("rajesh");
if (record) {
  console.log(record.address); // 0x...
}`}
            />
          </div>

          <div>
            <div className="text-sm font-semibold text-foreground mb-2">
              Quote a swap on the native AMM
            </div>
            <CodeBlock
              language="typescript"
              code={`import { PRECOMPILES } from "@zebvix/zebvix.js";

const quote = await provider.swapQuote(
  "zbx_to_zusd",
  parseZBX("100"),
);
console.log("You will receive ~", quote.amountOut, "(wei zUSD)");

// AMM precompile lives at 0x82 — call it from a Solidity contract
// or build the calldata yourself, then send via wallet.sendTransaction.
console.log("AMM precompile:", PRECOMPILES.ammSwap);
// → 0x0000000000000000000000000000000000000082`}
            />
          </div>

          <div>
            <div className="text-sm font-semibold text-foreground mb-2">
              Watch governance proposals in real time
            </div>
            <CodeBlock
              language="typescript"
              code={`setInterval(async () => {
  const { proposals } = await provider.listProposals(5);
  const stats = await provider.getVoteStats();
  for (const p of proposals) {
    if (p.status === "active") {
      console.log(\`Proposal #\${p.id} — \${p.status}\`, stats);
    }
  }
}, 6_000);`}
            />
          </div>

          <div>
            <div className="text-sm font-semibold text-foreground mb-2">
              Inspect a validator and your delegations
            </div>
            <CodeBlock
              language="typescript"
              code={`const validators = await provider.listValidators();
const top = validators[0];

const v = await provider.getValidator(top.address);
console.log("Self-stake:", v.selfStake, "Delegated:", v.totalDelegated);

const myDelegations =
  await provider.getDelegationsByDelegator(wallet.address);
console.log(myDelegations);`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Compatibility */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Compatibility
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Works zero-config?</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["MetaMask", "Yes", "Add network with chain ID 7878 + RPC URL"],
                ["Hardhat", "Yes", "Use the Mainnet RPC as a network — Solidity 0.8+ deploys"],
                ["Foundry (forge / cast)", "Yes", "--rpc-url http://93.127.213.192:8545"],
                ["ethers v6", "Yes", "Use ZebvixProvider for typed zbx_* extras"],
                ["viem", "Yes", "Define a custom chain object with id 7878"],
                ["wagmi", "Yes", "Pass the same custom chain to createConfig"],
                ["OpenZeppelin", "Yes", "Standard contracts (ERC20/721/1155, AccessControl, ProxyAdmin) all execute"],
              ].map(([tool, works, notes]) => (
                <TableRow key={tool}>
                  <TableCell className="font-semibold">{tool}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="text-emerald-400 border-emerald-500/40"
                    >
                      {works}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Resources */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Resources
          </CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3">
          <a
            href="/rpc-playground"
            className="border border-border rounded-lg p-3 hover:border-primary/60 hover:bg-primary/5 transition-colors flex items-start gap-3"
          >
            <Activity className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-foreground">RPC Playground</div>
              <div className="text-xs text-muted-foreground">
                Try every <code className="text-[10px] bg-muted px-1 rounded">zbx_*</code> method live in the browser
              </div>
            </div>
          </a>
          <a
            href="/smart-contracts"
            className="border border-border rounded-lg p-3 hover:border-primary/60 hover:bg-primary/5 transition-colors flex items-start gap-3"
          >
            <FileCode2 className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-foreground">Smart Contracts (ZVM)</div>
              <div className="text-xs text-muted-foreground">
                Deploy Solidity 0.8+ with Hardhat / Foundry — same wire format as Ethereum
              </div>
            </div>
          </a>
          <a
            href="/downloads"
            className="border border-border rounded-lg p-3 hover:border-primary/60 hover:bg-primary/5 transition-colors flex items-start gap-3"
          >
            <Package className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-foreground">Chain Downloads</div>
              <div className="text-xs text-muted-foreground">
                Pre-built node binaries + genesis snapshots
              </div>
            </div>
          </a>
          <a
            href="/docs"
            className="border border-border rounded-lg p-3 hover:border-primary/60 hover:bg-primary/5 transition-colors flex items-start gap-3"
          >
            <BookOpen className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-foreground">Full Documentation</div>
              <div className="text-xs text-muted-foreground">
                Architecture, RPC reference, governance model
              </div>
            </div>
          </a>
        </CardContent>
      </Card>

      {/* Footer note */}
      <div className="border border-border/60 rounded-lg p-4 bg-muted/10 text-xs text-muted-foreground flex items-start gap-3">
        <ExternalLink className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <div>
            <strong className="text-foreground">License:</strong> MIT —
            free for commercial and personal use, no attribution required.
          </div>
          <div>
            <strong className="text-foreground">Issues / contributions:</strong>{" "}
            open a ticket on the source repo (link coming when the public mirror is published).
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ScaffoldWorkbench — interactive zebvix.js starter project generator
// ─────────────────────────────────────────────────────────────────────────────

function ScaffoldWorkbench() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<ScaffoldConfig>(DEFAULT_CFG);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [activeFile, setActiveFile] = useState<string>("package.json");
  const [copied, setCopied] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced preview fetch — re-runs every time cfg changes.
  // Each invocation aborts any in-flight request *and* uses a monotonic
  // sequence number so a slow earlier response can never overwrite the
  // state produced by a newer config snapshot.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const mySeq = ++reqSeqRef.current;

      setPreviewing(true);
      setPreviewError(null);
      try {
        const res = await fetch(`${API_BASE}/api/sdk-scaffold/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cfg),
          signal: controller.signal,
        });
        if (mySeq !== reqSeqRef.current) return; // a newer request already started
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          if (mySeq !== reqSeqRef.current) return;
          setPreviewError(String(err?.error || `HTTP ${res.status}`));
          setPreview(null);
          return;
        }
        const data: PreviewResponse = await res.json();
        if (mySeq !== reqSeqRef.current) return;
        setPreview(data);
        // Snap activeFile to a sensible default when files change
        const fileNames = Object.keys(data.files);
        if (!fileNames.includes(activeFile)) {
          setActiveFile(fileNames.includes("package.json") ? "package.json" : (fileNames[0] || ""));
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        if (mySeq !== reqSeqRef.current) return;
        setPreviewError(String(e?.message || e));
        setPreview(null);
      } finally {
        if (mySeq === reqSeqRef.current) setPreviewing(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  async function downloadBundle() {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/sdk-scaffold/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: "Generate failed",
          description: String(err?.error || `HTTP ${res.status}`),
          variant: "destructive",
        });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${cfg.projectName}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: "Bundle generated",
        description: `${cfg.projectName}.tar.gz — extract, install, and run.`,
      });
    } catch (e: any) {
      toast({ title: "Generate failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  function copyFile(name: string, body: string) {
    void navigator.clipboard.writeText(body);
    setCopied(name);
    setTimeout(() => setCopied((c) => (c === name ? null : c)), 1400);
  }

  function downloadFile(name: string, body: string) {
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name.split("/").pop() || name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const update = <K extends keyof ScaffoldConfig>(key: K, value: ScaffoldConfig[K]) =>
    setCfg((prev) => ({ ...prev, [key]: value }));

  const updateModule = (key: keyof ScaffoldModules, value: boolean) =>
    setCfg((prev) => ({ ...prev, modules: { ...prev.modules, [key]: value } }));

  const fileList = useMemo(() => Object.keys(preview?.files || {}), [preview]);
  const score = preview?.score?.total ?? 0;
  const scoreColor = score >= 85 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-rose-400";
  const scoreRing  = score >= 85 ? "stroke-emerald-400" : score >= 60 ? "stroke-amber-400" : "stroke-rose-400";

  const enabledModuleCount = useMemo(
    () => Object.values(cfg.modules).filter(Boolean).length,
    [cfg.modules],
  );

  const langForFile = (f: string): string => {
    if (f.endsWith(".ts"))                      return "typescript";
    if (f.endsWith(".js") || f.endsWith(".mjs")) return "javascript";
    if (f.endsWith(".json"))                    return "json";
    if (f.endsWith(".yml") || f.endsWith(".yaml")) return "yaml";
    if (f.endsWith(".md"))                      return "markdown";
    if (f.endsWith("Dockerfile") || f.endsWith(".dockerfile")) return "dockerfile";
    if (f === ".env.example" || f.endsWith(".env"))            return "bash";
    if (f === ".gitignore")                     return "bash";
    if (f === "LICENSE")                        return "text";
    return "text";
  };

  return (
    <section className="space-y-3" data-testid="scaffold-workbench">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest">
          <Sparkles className="h-3 w-3" />
          Interactive
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Wrench className="h-5 w-5 text-primary" />
          Scaffold Workbench
        </h2>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Pick the modules you need, choose your runtime, and generate a production-ready
          starter that wires {" "}<code className="text-xs bg-muted px-1 rounded">@zebvix/zebvix.js</code>{" "}
          into a typed Node project — package manifest, tsconfig, README, env template,
          per-module entry files, optional vitest, GitHub Actions CI, and a multi-stage
          Dockerfile. The right column scores readiness live.
          {" "}<span className="text-emerald-400">No secrets are sent</span> — only public
          config flows through, and your private key stays local in {" "}
          <code className="text-xs bg-muted px-1 rounded">.env</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-4">
        {/* ─── LEFT: configuration cards ─────────────────────────────────── */}
        <div className="space-y-4">
          <ConfigCard icon={Package} title="Project metadata">
            <Field label="Project name (slug)" hint="lowercase a-z 0-9 -, 2-41 chars, must start with a letter">
              <input
                data-testid="input-projectName"
                value={cfg.projectName}
                onChange={(e) => update("projectName", e.target.value)}
                className="sw-input"
              />
            </Field>
            <Field label="Description" hint="one-line summary, used in package.json + README">
              <input
                data-testid="input-description"
                value={cfg.description}
                onChange={(e) => update("description", e.target.value)}
                className="sw-input"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Author name" hint="optional — package.json author field">
                <input
                  data-testid="input-authorName"
                  value={cfg.authorName}
                  onChange={(e) => update("authorName", e.target.value)}
                  className="sw-input"
                  placeholder="e.g. Rajesh Kumar"
                />
              </Field>
              <Field label="License" hint="package.json + LICENSE file">
                <select
                  data-testid="select-license"
                  value={cfg.license}
                  onChange={(e) => update("license", e.target.value as LicenseChoice)}
                  className="sw-input"
                >
                  <option value="MIT">MIT</option>
                  <option value="Apache-2.0">Apache-2.0</option>
                  <option value="UNLICENSED">UNLICENSED (private)</option>
                </select>
              </Field>
            </div>
          </ConfigCard>

          <ConfigCard icon={Settings2} title="Runtime & language">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Package manager">
                <select
                  data-testid="select-packageManager"
                  value={cfg.packageManager}
                  onChange={(e) => update("packageManager", e.target.value as PackageManager)}
                  className="sw-input"
                >
                  <option value="pnpm">pnpm</option>
                  <option value="npm">npm</option>
                  <option value="yarn">yarn</option>
                  <option value="bun">bun</option>
                </select>
              </Field>
              <Field label="Language">
                <select
                  data-testid="select-language"
                  value={cfg.language}
                  onChange={(e) => update("language", e.target.value as Language)}
                  className="sw-input"
                >
                  <option value="typescript">TypeScript</option>
                  <option value="javascript">JavaScript</option>
                </select>
              </Field>
              <Field label="Runtime">
                <select
                  data-testid="select-runtime"
                  value={cfg.runtime}
                  onChange={(e) => update("runtime", e.target.value as Runtime)}
                  className="sw-input"
                >
                  <option value="node">Node 18+</option>
                  <option value="bun">Bun 1.x</option>
                </select>
              </Field>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              TypeScript scores higher than JavaScript (full type-safety end-to-end). Node + pnpm is
              the recommended combination — Bun runs the same code without a build step.
            </p>
          </ConfigCard>

          <ConfigCard icon={Globe} title="Network & secrets">
            <div className="grid grid-cols-[1fr_140px] gap-3">
              <Field label="RPC URL" icon={Network} hint="must be http(s)://host[:port][/path]">
                <input
                  data-testid="input-rpcUrl"
                  value={cfg.rpcUrl}
                  onChange={(e) => update("rpcUrl", e.target.value)}
                  className="sw-input font-mono text-xs"
                />
              </Field>
              <Field label="Chain ID" icon={Hash} hint="default 7878 (0x1ec6)">
                <input
                  data-testid="input-chainId"
                  type="number" min={1} max={2147483647}
                  value={cfg.chainId}
                  onChange={(e) => update("chainId", Number(e.target.value))}
                  className="sw-input"
                />
              </Field>
            </div>
            <Field label="Secret strategy" icon={KeyRound} hint="how the starter loads ZBX_PRIVATE_KEY">
              <div className="grid grid-cols-2 gap-2">
                <Toggle
                  label="dotenv (.env file)"
                  hint="recommended — auto-loads via dotenv/config"
                  checked={cfg.envStrategy === "dotenv"}
                  onChange={() => update("envStrategy", "dotenv")}
                  testId="toggle-env-dotenv"
                  compact
                />
                <Toggle
                  label="process.env only"
                  hint="zero deps — set vars before running"
                  checked={cfg.envStrategy === "process"}
                  onChange={() => update("envStrategy", "process")}
                  testId="toggle-env-process"
                  compact
                />
              </div>
            </Field>
          </ConfigCard>

          <ConfigCard icon={Boxes} title={`SDK modules (${enabledModuleCount}/8 enabled)`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {MODULE_META.map((m) => (
                <Toggle
                  key={m.key}
                  label={m.label}
                  hint={m.hint}
                  checked={cfg.modules[m.key]}
                  onChange={(v) => updateModule(m.key, v)}
                  testId={`toggle-module-${m.key}`}
                />
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Each enabled module generates one file under{" "}
              <code className="text-[10px] bg-muted px-1 rounded">src/modules/</code> and is wired
              into <code className="text-[10px] bg-muted px-1 rounded">src/main</code>. Pick at
              least three to maximise the readiness score.
            </p>
          </ConfigCard>

          <ConfigCard icon={ServerCog} title="Tooling">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Toggle
                label="Vitest sanity test"
                hint="src/zebvix import + addr smoke test"
                checked={cfg.includeTests}
                onChange={(v) => update("includeTests", v)}
                testId="toggle-tests"
              />
              <Toggle
                label="GitHub Actions CI"
                hint="typecheck + test on push / PR"
                checked={cfg.includeCi}
                onChange={(v) => update("includeCi", v)}
                testId="toggle-ci"
              />
              <Toggle
                label="Multi-stage Dockerfile"
                hint="alpine deps + build + runtime"
                checked={cfg.includeDockerfile}
                onChange={(v) => update("includeDockerfile", v)}
                testId="toggle-dockerfile"
              />
            </div>
          </ConfigCard>
        </div>

        {/* ─── RIGHT: readiness + summary + download ───────────────────── */}
        <aside className="space-y-4 xl:sticky xl:top-4 self-start">
          <div className="rounded-xl border border-border/60 bg-card/40 p-5" data-testid="readiness-card">
            <header className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Gauge className="h-3.5 w-3.5" /> Project readiness
              </h3>
              {previewing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </header>
            <div className="flex items-center gap-5">
              <ScoreGauge score={score} colorClass={scoreColor} ringClass={scoreRing} />
              <div className="space-y-1.5 flex-1 min-w-0">
                {(preview?.score?.items || []).slice(0, 6).map((it) => (
                  <div key={it.key} className="flex items-center gap-2 text-xs">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${it.got === it.weight ? "bg-emerald-400" : it.got > 0 ? "bg-amber-400" : "bg-rose-400"}`} />
                    <span className="text-foreground/80 truncate">{it.label}</span>
                    <span className="ml-auto text-muted-foreground tabular-nums">{it.got}/{it.weight}</span>
                  </div>
                ))}
              </div>
            </div>
            {preview?.score?.items && preview.score.items.length > 6 && (
              <details className="mt-3" data-testid="readiness-more">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">
                  Show all {preview.score.items.length} criteria
                </summary>
                <div className="mt-2 space-y-1.5">
                  {preview.score.items.slice(6).map((it) => (
                    <div key={it.key} className="flex items-center gap-2 text-xs">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${it.got === it.weight ? "bg-emerald-400" : it.got > 0 ? "bg-amber-400" : "bg-rose-400"}`} />
                      <span className="text-foreground/80 truncate">{it.label}</span>
                      <span className="ml-auto text-muted-foreground tabular-nums">{it.got}/{it.weight}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          <div className="rounded-xl border border-border/60 bg-card/40 p-5" data-testid="deps-card">
            <header className="flex items-center gap-2 mb-3">
              <Boxes className="h-3.5 w-3.5 text-primary" />
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Dependencies</h3>
            </header>
            <div className="space-y-3 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mb-1">runtime</div>
                <ul className="space-y-1">
                  {Object.entries(preview?.deps?.runtime || {}).map(([n, v]) => (
                    <li key={n} className="flex justify-between gap-2 font-mono">
                      <span className="text-foreground/85 truncate">{n}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">{v}</span>
                    </li>
                  ))}
                  {(!preview || Object.keys(preview.deps.runtime).length === 0) && (
                    <li className="text-muted-foreground italic">—</li>
                  )}
                </ul>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mb-1">dev</div>
                <ul className="space-y-1">
                  {Object.entries(preview?.deps?.dev || {}).map(([n, v]) => (
                    <li key={n} className="flex justify-between gap-2 font-mono">
                      <span className="text-foreground/85 truncate">{n}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">{v}</span>
                    </li>
                  ))}
                  {(!preview || Object.keys(preview.deps.dev).length === 0) && (
                    <li className="text-muted-foreground italic">—</li>
                  )}
                </ul>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-card/40 p-5">
            <header className="flex items-center gap-2 mb-3">
              <FileCode className="h-3.5 w-3.5 text-primary" />
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Bundle summary</h3>
            </header>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-muted-foreground">Files</dt>
              <dd className="text-right font-semibold text-foreground tabular-nums" data-testid="summary-fileCount">
                {preview?.summary.fileCount ?? "—"}
              </dd>
              <dt className="text-muted-foreground">Lines of code</dt>
              <dd className="text-right font-semibold text-foreground tabular-nums" data-testid="summary-totalLoc">
                {preview?.summary.totalLoc ?? "—"}
              </dd>
              <dt className="text-muted-foreground">Total size</dt>
              <dd className="text-right font-semibold text-foreground tabular-nums">
                {preview ? `${(preview.summary.totalBytes / 1024).toFixed(1)} KB` : "—"}
              </dd>
              <dt className="text-muted-foreground">bundle hash</dt>
              <dd className="text-right font-mono text-[10px] text-foreground/80 truncate" title={preview?.summary.installHash}>
                {preview ? preview.summary.installHash.slice(0, 12) + "…" : "—"}
              </dd>
            </dl>
            <button
              onClick={downloadBundle}
              disabled={generating || !!previewError || !preview}
              data-testid="button-download-bundle"
              className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground font-semibold text-sm py-2.5 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {generating ? "Packaging…" : `Download ${cfg.projectName}.tar.gz`}
            </button>
            {previewError && (
              <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 flex items-start gap-2" data-testid="preview-error">
                <Bug className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span className="break-words">{previewError}</span>
              </div>
            )}
            {!preview && !previewError && !previewing && (
              <div className="mt-3 text-[10px] text-muted-foreground/70 text-center italic">
                Adjust any field to generate a preview…
              </div>
            )}
          </div>

          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-emerald-300 font-semibold mb-1">After download</div>
                <ol className="list-decimal pl-4 space-y-0.5 text-foreground/80">
                  <li><code className="text-[10px] bg-muted px-1 rounded">tar -xzf {cfg.projectName}.tar.gz && cd {cfg.projectName}</code></li>
                  <li><code className="text-[10px] bg-muted px-1 rounded">{cfg.packageManager} install</code></li>
                  <li>Copy <code className="text-[10px] bg-muted px-1 rounded">.env.example</code> → <code className="text-[10px] bg-muted px-1 rounded">.env</code> and set <code className="text-[10px] bg-muted px-1 rounded">ZBX_PRIVATE_KEY</code></li>
                  <li><code className="text-[10px] bg-muted px-1 rounded">{cfg.packageManager} run start</code></li>
                </ol>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* File preview tabs */}
      {preview && fileList.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden mt-3" data-testid="file-preview">
          <div className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-3 py-2">
            <FileCode2 className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Live bundle preview</span>
            <span className="text-[10px] text-muted-foreground ml-2">{fileList.length} files</span>
          </div>
          <div className="flex flex-wrap gap-1 border-b border-border/40 bg-muted/10 px-2 py-2 max-h-32 overflow-y-auto">
            {fileList.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFile(f)}
                data-testid={`tab-file-${f.replace(/[^a-zA-Z0-9]/g, "-")}`}
                className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                  activeFile === f
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-background/40">
            <span className="text-xs font-mono text-muted-foreground">{activeFile}</span>
            <div className="flex gap-1">
              <button
                onClick={() => copyFile(activeFile, preview.files[activeFile] || "")}
                data-testid="button-copy-file"
                className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                {copied === activeFile ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {copied === activeFile ? "Copied" : "Copy"}
              </button>
              <button
                onClick={() => downloadFile(activeFile, preview.files[activeFile] || "")}
                data-testid="button-download-file"
                className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <Download className="h-3 w-3" /> File
              </button>
            </div>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <CodeBlock language={langForFile(activeFile)} code={preview.files[activeFile] || ""} />
          </div>
        </div>
      )}

      <style>{`
        .sw-input {
          width: 100%;
          background: hsl(var(--background) / 0.6);
          border: 1px solid hsl(var(--border) / 0.6);
          border-radius: 0.375rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.8125rem;
          color: hsl(var(--foreground));
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .sw-input:focus {
          outline: none;
          border-color: hsl(var(--primary) / 0.6);
          box-shadow: 0 0 0 3px hsl(var(--primary) / 0.15);
        }
      `}</style>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Workbench sub-components (local — kept inside this file to avoid leaking
// styling beyond the SDK page).
// ─────────────────────────────────────────────────────────────────────────────

function ConfigCard({
  icon: Icon, title, children,
}: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-3">
      <header className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </header>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label, hint, icon: Icon, children,
}: { label: string; hint?: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
        <span className="text-xs font-medium text-foreground/85">{label}</span>
      </div>
      {children}
      {hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
    </label>
  );
}

function Toggle({
  label, hint, checked, onChange, testId, compact,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; testId?: string; compact?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-pressed={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={`w-full flex items-start gap-3 rounded-md border px-3 ${compact ? "py-2" : "py-2.5"} text-left transition-colors ${
        checked
          ? "border-primary/40 bg-primary/5"
          : "border-border/60 bg-background/40 hover:bg-muted/30"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex h-4 w-7 rounded-full transition-colors shrink-0 ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-background border border-border/60 shadow-sm transition-transform ${
            checked ? "translate-x-3" : "translate-x-0"
          }`}
        />
      </span>
      <span className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </span>
    </button>
  );
}

function ScoreGauge({ score, colorClass, ringClass }: { score: number; colorClass: string; ringClass: string }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <div className="relative h-24 w-24 shrink-0" data-testid="score-gauge">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} className="fill-none stroke-border/40" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={r}
          className={`fill-none ${ringClass} transition-all duration-500`}
          strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={`text-2xl font-bold tabular-nums ${colorClass}`}>{score}</div>
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground">/ 100</div>
      </div>
    </div>
  );
}
