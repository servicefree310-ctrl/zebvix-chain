import React from "react";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";

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
