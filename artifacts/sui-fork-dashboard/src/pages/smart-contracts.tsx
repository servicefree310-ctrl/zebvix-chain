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
  FileCode2,
  Cpu,
  Boxes,
  Zap,
  Layers,
  Database,
  Plug,
  Workflow,
  ShieldCheck,
  Hammer,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Hash,
} from "lucide-react";

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: any;
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

export default function SmartContractsPage() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-primary border-primary/40">
            ZVM Layer
          </Badge>
          <Badge
            variant="outline"
            className="text-emerald-400 border-emerald-500/40"
          >
            LIVE
          </Badge>
          <Badge
            variant="outline"
            className="text-blue-400 border-blue-500/40"
          >
            Cancun-compatible
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Smart Contracts
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Zebvix ships a Cancun-compatible Ethereum Virtual Machine (ZVM) compiled
          into the same binary as the chain runtime. Solidity 0.8+ contracts,
          Hardhat, Foundry, MetaMask, ethers.js, and OpenZeppelin libraries work
          zero-config — the chain speaks the standard Ethereum JSON-RPC over
          chain-id <code className="text-sm bg-muted px-1.5 py-0.5 rounded">7878</code>{" "}
          with ZBX as the gas token.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">
              What works today
            </div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                <strong className="text-emerald-400">Full opcode set</strong> — signed arithmetic,
                bitwise, memory, storage, transient storage (<code className="text-xs bg-muted px-1 rounded">TLOAD/TSTORE</code>),
                <code className="text-xs bg-muted px-1 rounded">PUSH0</code>, <code className="text-xs bg-muted px-1 rounded">MCOPY</code>,
                returndata copy and ext-code copy all dispatched via two's-complement helpers. OpenZeppelin
                <code className="text-xs bg-muted px-1 rounded">SignedMath</code> + try/catch flows execute correctly.
              </li>
              <li>
                <strong className="text-emerald-400">Real receipts &amp; logs</strong> — <code className="text-xs bg-muted px-1 rounded">eth_sendRawTransaction</code> persists a real receipt and stamps emitted logs with canonical <code className="text-xs bg-muted px-1 rounded">tx_hash</code> + per-block monotonic <code className="text-xs bg-muted px-1 rounded">logIndex</code>. <code className="text-xs bg-muted px-1 rounded">eth_getTransactionReceipt</code> returns real <code className="text-xs bg-muted px-1 rounded">gasUsed</code>, <code className="text-xs bg-muted px-1 rounded">contractAddress</code>, status, and full <code className="text-xs bg-muted px-1 rounded">logs[]</code>.
              </li>
              <li>
                <strong className="text-emerald-400">EIP-3529 refund cap + EIP-2565 MODEXP</strong> — refunds are capped at <code className="text-xs bg-muted px-1 rounded">gas_used / 5</code> and modular exponentiation uses dynamic pricing with real ≤256-bit math.
              </li>
              <li>
                <strong className="text-emerald-400">Standard precompiles</strong> — pure-Rust EIP-152 BLAKE2b F compression at <code className="text-xs bg-muted px-1 rounded">0x09</code>; <code className="text-xs bg-muted px-1 rounded">0x01–0x05</code> standard precompiles fully dispatched.
              </li>
              <li>
                <strong className="text-emerald-400">Unified ZBX balance</strong> — <code className="text-xs bg-muted px-1 rounded">eth_getBalance</code> and <code className="text-xs bg-muted px-1 rounded">zbx_getBalance</code> both resolve against the same native account ledger (<code className="text-xs bg-muted px-1 rounded">CF_ACCOUNTS</code>), so a Solidity contract sees a user's real ZBX balance directly. Nonces are split by domain: <code className="text-xs bg-muted px-1 rounded">zbx_getNonce</code> for native txs, <code className="text-xs bg-muted px-1 rounded">eth_getTransactionCount</code> for ZVM txs (ZVM-feature builds).
              </li>
              <li>
                <strong className="text-emerald-400">Monetary gas debit/refund</strong> — sender is checked for <code className="text-xs bg-muted px-1 rounded">gas_limit × gas_price + value</code>, the reservation is pre-debited so re-entrant calls cannot double-spend, and unused gas is credited back post-frame.
              </li>
              <li>
                <strong className="text-emerald-400">Strict EIP-155 enforcement</strong> — unprotected legacy transactions are rejected outright; every modern wallet is fine.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={Cpu}
          label="ZVM Fork"
          value="Cancun*"
          sub="*subset — see compatibility table"
        />
        <StatTile
          icon={FileCode2}
          label="Solidity"
          value="0.8+"
          sub="zero-config compile & deploy"
        />
        <StatTile
          icon={Zap}
          label="Block Gas"
          value="30 M"
          sub="DEFAULT_BLOCK_GAS_LIMIT (compiled)"
        />
        <StatTile
          icon={Boxes}
          label="Precompiles"
          value="4 custom"
          sub="0x80–0x83 (bridge/AMM/PayID/multisig)"
        />
      </div>

      {/* Build flag */}
      <div className="border-l-4 border-l-primary/60 bg-primary/5 p-4 rounded-md flex gap-3">
        <Hammer className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground space-y-1">
          <div className="text-foreground font-semibold">Build flag</div>
          <p>
            The ZVM is gated behind a Cargo feature so non-ZVM forks pay zero compile
            cost. Production VPS builds enable it explicitly:
          </p>
          <CodeBlock
            language="bash"
            code={`cargo build --release --features zvm`}
          />
          <p>
            Verify on a running node — <code className="text-xs bg-muted px-1 rounded">web3_clientVersion</code> includes <code className="text-xs bg-muted px-1 rounded">zvm-cancun</code> only when this feature was enabled at build time.
          </p>
        </div>
      </div>

      {/* Architecture */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            Architecture
          </CardTitle>
          <CardDescription>
            How an ZVM transaction flows from JSON-RPC down to RocksDB. Each box
            maps to one Rust module under <code className="text-xs bg-muted px-1 rounded">zebvix-chain/src/</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock
            language="text"
            code={`        eth_sendRawTransaction        (RLP: EIP-1559 / EIP-2930 / EIP-155 legacy)
                    │
                    ▼
            zvm_rpc::dispatch         ← decode + chain-id guard (rejects no-EIP-155)
                    │
                    ▼
            zvm_rlp::decode_raw_tx    → (ZvmTxEnvelope, sender, chain_id)
                    │
                    ▼
              zvm::execute            ← dispatch by Create / Call
                    │
                    ▼
            zvm_interp::Interp        ← Cancun opcode interpreter
                    │  ├─ precompile detect (0x01–0x09 standard ETH precompiles; 0x80–0x83 native Zebvix)
                    │  └─ zvm_precompiles::dispatch
                    ▼
            zvm_state::CfZvmDb        ← journaled read/write view
                    │
                    ▼
        RocksDB column families:
          CF_ZVM   — accounts · code (keccak-addressed) · storage slots
          CF_LOGS  — log_key(block_height, log_index) → ZvmLog`}
          />
          <p className="text-xs text-muted-foreground mt-3">
            All ZVM state is stored in dedicated column families so it never
            collides with native ZBX state (balances, validators, AMM pool, multisig,
            governance). One process, one RocksDB, two side-by-side execution
            domains.
          </p>
        </CardContent>
      </Card>

      {/* Execution + gas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="w-5 h-5 text-primary" />
            Execution &amp; Gas Model
          </CardTitle>
          <CardDescription>
            Per-opcode gas follows the standard Ethereum Cancun schedule. EIP-2565
            MODEXP uses dynamic pricing and EIP-3529 refund capping is enforced
            at frame exit, so audit gas profiles match mainnet Ethereum closely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border border-border rounded-md overflow-hidden bg-card/40">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="text-foreground w-56">Property</TableHead>
                  <TableHead className="text-foreground">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">
                    Interpreter
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Pure Rust, no JIT — <code className="text-xs bg-muted px-1 rounded">zvm_interp::Interp</code>. Deterministic across every node.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">
                    Opcode set
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Full Cancun set wired: <code className="text-xs bg-muted px-1 rounded">PUSH0</code> (EIP-3855),
                    transient storage <code className="text-xs bg-muted px-1 rounded">TLOAD/TSTORE</code> (EIP-1153),
                    <code className="text-xs bg-muted px-1 rounded">MCOPY</code> (EIP-5656),
                    <code className="text-xs bg-muted px-1 rounded">BLOBHASH</code> (EIP-4844, returns 0 — non-blob chain).{" "}
                    Signed arithmetic (<code className="text-xs bg-muted px-1 rounded">SDIV</code>/<code className="text-xs bg-muted px-1 rounded">SMOD</code>/<code className="text-xs bg-muted px-1 rounded">SLT</code>/<code className="text-xs bg-muted px-1 rounded">SGT</code>/<code className="text-xs bg-muted px-1 rounded">SAR</code>),{" "}
                    <code className="text-xs bg-muted px-1 rounded">EXTCODECOPY</code> and <code className="text-xs bg-muted px-1 rounded">RETURNDATACOPY</code> all dispatched via I256 two's-complement helpers — OpenZeppelin <code className="text-xs bg-muted px-1 rounded">SignedMath</code> and try/catch returndata flows execute correctly.{" "}
                    <code className="text-xs bg-muted px-1 rounded">SELFDESTRUCT</code> (0xff) is rejected by design — post-Cancun deprecation.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">
                    Per-opcode gas
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Yellow-paper Cancun values for arithmetic / memory / storage opcodes. State-access opcodes (<code className="text-xs bg-muted px-1 rounded">SLOAD</code>, <code className="text-xs bg-muted px-1 rounded">BALANCE</code>, <code className="text-xs bg-muted px-1 rounded">EXTCODE*</code>, <code className="text-xs bg-muted px-1 rounded">CALL*</code>) are charged at conservative cold-access cost (<code className="text-xs bg-muted px-1 rounded">G_SLOAD=2100</code>, <code className="text-xs bg-muted px-1 rounded">G_BALANCE/G_EXTCODE/G_CALL=2600</code>) — gas estimates are always safe, never under-charged.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">
                    Intrinsic gas
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    21,000 base + 4 (zero) / 16 (non-zero) gas per calldata byte. Create adds per-word init-code cost (EIP-3860).
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">
                    Refund cap
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    EIP-3529 cap (<code className="text-xs bg-muted px-1 rounded">refund = min(refund, gas_used / 5)</code>, the standard 20&nbsp;% post-London cap) is enforced at the end of every <code className="text-xs bg-muted px-1 rounded">zvm::execute</code> frame, alongside monetary debit / refund of ZBX wei.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">
                    Block gas limit
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <code className="text-xs bg-muted px-1 rounded">DEFAULT_BLOCK_GAS_LIMIT = 30_000_000</code> read directly inside <code className="text-xs bg-muted px-1 rounded">ZvmRpcCtx::zvm_context()</code> on every tx. Adjustable via on-chain <code className="text-xs bg-muted px-1 rounded">ParamChange</code> governance proposals.
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">
                    Gas price (USD-pegged)
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Gas is paid in ZBX wei but the per-tx fee is dynamically clamped
                    against the AMM spot price so a typical contract call costs ~$0.001–$0.05
                    USD regardless of ZBX volatility (see <code className="text-xs bg-muted px-1 rounded">zbx_feeBounds</code>).
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* TxKinds */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-primary" />
            ZVM Transaction Variants
          </CardTitle>
          <CardDescription>
            Two variants of <code className="text-xs bg-muted px-1 rounded">enum ZvmTxEnvelope</code> in{" "}
            <code className="text-xs bg-muted px-1 rounded">zvm.rs</code> — kept in a separate envelope from
            native <code className="text-xs bg-muted px-1 rounded">TxKind</code> so each domain owns its own
            RLP / signature scheme. Both share the lifecycle inside{" "}
            <code className="text-xs bg-muted px-1 rounded">zvm::execute()</code>:{" "}
            intrinsic-gas check → execute → journal → emit logs → monetary gas debit / refund of ZBX wei.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-border rounded-lg p-4 bg-card/40">
              <div className="font-semibold text-primary mb-2 flex items-center gap-2">
                <Boxes className="w-4 h-4" />
                ZvmTxEnvelope::Create(ZvmCreate)
              </div>
              <CodeBlock
                language="rust"
                code={`struct ZvmCreate {
    init_code: Vec<u8>,         // constructor + runtime
    value:     u128,            // wei minted to new contract
    gas_limit: u64,
    gas_price: u128,
    salt:      Option<[u8; 32]>, // Some => CREATE2, None => CREATE
}`}
              />
              <p className="text-xs text-muted-foreground mt-3">
                Address: when <code className="text-xs bg-muted px-1 rounded">salt == None</code> →{" "}
                <code className="text-xs bg-muted px-1 rounded">keccak(rlp(sender, nonce))[12..]</code> (CREATE);
                when <code className="text-xs bg-muted px-1 rounded">salt == Some(s)</code> →{" "}
                <code className="text-xs bg-muted px-1 rounded">keccak(0xff ‖ sender ‖ s ‖ keccak(init_code))[12..]</code> (CREATE2). Runtime bytecode stored content-addressed under <code className="text-xs bg-muted px-1 rounded">CF_ZVM/code/&lt;keccak256&gt;</code>.
              </p>
            </div>
            <div className="border border-border rounded-lg p-4 bg-card/40">
              <div className="font-semibold text-primary mb-2 flex items-center gap-2">
                <Plug className="w-4 h-4" />
                ZvmTxEnvelope::Call(ZvmCall)
              </div>
              <CodeBlock
                language="rust"
                code={`struct ZvmCall {
    to:        Address,   // 20-byte contract or EOA
    data:      Vec<u8>,   // calldata
    value:     u128,
    gas_limit: u64,
    gas_price: u128,
}`}
              />
              <p className="text-xs text-muted-foreground mt-3">
                If the account at <code className="text-xs bg-muted px-1 rounded">to</code> has no deployed code, the call short-circuits into a plain native ZBX value transfer (calldata is ignored). Otherwise the interpreter executes <code className="text-xs bg-muted px-1 rounded">data</code> as calldata against the contract at <code className="text-xs bg-muted px-1 rounded">to</code>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* JSON-RPC namespace */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="w-5 h-5 text-primary" />
            JSON-RPC Surface
          </CardTitle>
          <CardDescription>
            Two namespaces are served on the same{" "}
            <code className="text-xs bg-muted px-1 rounded">:8545</code> endpoint:{" "}
            <code className="text-xs bg-muted px-1 rounded">zbx_*</code> (Zebvix-native, always-on)
            and <code className="text-xs bg-muted px-1 rounded">eth_*</code> /{" "}
            <code className="text-xs bg-muted px-1 rounded">net_*</code> /{" "}
            <code className="text-xs bg-muted px-1 rounded">web3_*</code> (Ethereum-compatible).
            A handful of always-on aliases live in <code className="text-xs bg-muted px-1 rounded">rpc.rs</code> directly so wallets work even on
            non-ZVM builds; everything else in the ZVM namespace is gated behind{" "}
            <code className="text-xs bg-muted px-1 rounded">--features zvm</code> (file:{" "}
            <code className="text-xs bg-muted px-1 rounded">zvm_rpc.rs</code>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-l-4 border-l-emerald-500/60 bg-emerald-500/5 p-3 rounded-md flex gap-3 mb-4 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1 text-muted-foreground">
              <div className="text-foreground font-semibold">Recommended client behaviour</div>
              <p>
                Mobile, light, and dashboard clients should prefer the{" "}
                <code className="text-xs bg-muted px-1 rounded">zbx_*</code> name wherever one exists —
                it's the canonical Zebvix surface. MetaMask / Hardhat / web3.js continue to use{" "}
                <code className="text-xs bg-muted px-1 rounded">eth_*</code> and Just Work; both names
                share the same handler so behaviour is byte-identical. The aliases come in two tiers —
                see the per-method "Build gate" badges in the table below for the canonical reference:
              </p>
              <ul className="list-disc list-inside space-y-1 pl-1">
                <li>
                  <strong className="text-emerald-300">Always-on</strong> aliases (in{" "}
                  <code className="text-xs bg-muted px-1 rounded">rpc.rs</code>, no feature flag):{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_chainId</code> ↔{" "}
                  <code className="text-xs bg-muted px-1 rounded">eth_chainId</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_netVersion</code> ↔{" "}
                  <code className="text-xs bg-muted px-1 rounded">net_version</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_getBalance</code> ↔{" "}
                  <code className="text-xs bg-muted px-1 rounded">eth_getBalance</code>. These never
                  return <code className="text-xs bg-muted px-1 rounded">-32601</code> on a stripped
                  validator — choose them for any tool that has to survive on a non-ZVM build.
                </li>
                <li>
                  <strong className="text-amber-300">ZVM-side</strong> aliases (in{" "}
                  <code className="text-xs bg-muted px-1 rounded">zvm_rpc.rs</code>, require{" "}
                  <code className="text-xs bg-muted px-1 rounded">--features zvm</code>):{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_clientVersion</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_syncing</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_accounts</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_gasPrice</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_blobBaseFee</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_feeHistory</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_getCode</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_getStorageAt</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_call</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_getLogs</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_getZvmReceipt</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_getZvmTransaction</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_sendRawZvmTransaction</code>{" "}
                  <span className="text-muted-foreground">(plus deprecated <code className="text-xs bg-muted px-1 rounded">zbx_*Evm*</code> legacy aliases — still accepted for backward compat)</span>.
                  Each routes through{" "}
                  <code className="text-xs bg-muted px-1 rounded">try_zvm_dispatch</code> in{" "}
                  <code className="text-xs bg-muted px-1 rounded">rpc.rs</code> to the same handler as
                  its <code className="text-xs bg-muted px-1 rounded">eth_*</code> /{" "}
                  <code className="text-xs bg-muted px-1 rounded">web3_*</code> partner.
                </li>
                <li>
                  <strong>No alias</strong> (deliberate — would collide with a richer Zebvix-native
                  handler):{" "}
                  <code className="text-xs bg-muted px-1 rounded">eth_blockNumber</code> (use{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_blockNumber</code> for the
                  object form),{" "}
                  <code className="text-xs bg-muted px-1 rounded">eth_estimateGas</code> (native{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_estimateGas</code> already
                  exists for ZBX transfers),{" "}
                  <code className="text-xs bg-muted px-1 rounded">eth_getTransactionCount</code> (use
                  the always-on <code className="text-xs bg-muted px-1 rounded">zbx_getNonce</code>{" "}
                  which returns a flat <code className="text-xs bg-muted px-1 rounded">u64</code>),{" "}
                  <code className="text-xs bg-muted px-1 rounded">eth_getBlockByNumber</code> (use{" "}
                  <code className="text-xs bg-muted px-1 rounded">zbx_getBlockByNumber</code> for the
                  full Zebvix block body).
                </li>
              </ul>
            </div>
          </div>
          <div className="border border-border rounded-md overflow-hidden bg-card/40">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="text-foreground w-80">Method</TableHead>
                  <TableHead className="text-foreground w-28">Build gate</TableHead>
                  <TableHead className="text-foreground">Returns / Behaviour</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_chainId · zbx_chainId</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">always-on</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <code className="text-xs bg-muted px-1 rounded">"0x1ec6"</code> (= 7878). Both names share the same arm in <code className="text-xs bg-muted px-1 rounded">rpc.rs</code>.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">net_version · zbx_netVersion</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">always-on</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <code className="text-xs bg-muted px-1 rounded">"7878"</code>. Same handler as above; decimal string per <code className="text-xs bg-muted px-1 rounded">net_version</code> spec.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_blockNumber</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">always-on</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Tip height as 0x-hex string. For a richer payload (hash, timestamp, proposer) use the native{" "}
                    <code className="text-xs bg-muted px-1 rounded">zbx_blockNumber</code> below.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_blockNumber</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">always-on</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <code className="text-xs bg-muted px-1 rounded">{"{ height, hex, hash, timestamp_ms, proposer }"}</code> — the canonical Zebvix tip query, always available.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_getBalance · zbx_getBalance</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">always-on</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Routed by the <code className="text-xs bg-muted px-1 rounded">rpc.rs</code> arm against the native ZBX account ledger (<code className="text-xs bg-muted px-1 rounded">CF_ACCOUNTS</code>) — the canonical source of truth for ZBX balances. ZVM contract storage is tracked separately in <code className="text-xs bg-muted px-1 rounded">CF_ZVM</code> via <code className="text-xs bg-muted px-1 rounded">apply_journal</code>; native and ZVM ledgers are addressed by the same secp256k1 key but kept in distinct column families by design.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_getNonce</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">always-on</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Returns native ZBX nonce as <code className="text-xs bg-muted px-1 rounded">u64</code> (decimal number, NOT hex — schema differs from <code className="text-xs bg-muted px-1 rounded">eth_getTransactionCount</code>). Use this in dashboards / mobile clients; <code className="text-xs bg-muted px-1 rounded">eth_getTransactionCount</code> goes through <code className="text-xs bg-muted px-1 rounded">zvm_rpc</code> against <code className="text-xs bg-muted px-1 rounded">CF_ZVM</code> and only resolves on ZVM-feature builds.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_sendTransaction · zbx_sendRawTransaction</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">always-on</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Native Zebvix submit path — accepts JSON <code className="text-xs bg-muted px-1 rounded">SignedTx</code> or hex-encoded bincode. Returns the Zebvix tx hash. This is what wallet / mobile / Pay-ID flows use; <code className="text-xs bg-muted px-1 rounded">eth_sendRawTransaction</code> below is the ZVM-only alternative.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">web3_clientVersion · zbx_clientVersion</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-amber-400 border-amber-500/40">--features zvm</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <code className="text-xs bg-muted px-1 rounded">"Zebvix/0.1.0/rust1.83/zvm-cancun"</code>. Presence of <code className="text-xs bg-muted px-1 rounded">zvm-cancun</code> in the string is the recommended runtime probe for whether the ZVM feature was compiled in. Both names route to the same handler in <code className="text-xs bg-muted px-1 rounded">zvm_rpc::dispatch</code>.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_syncing · zbx_syncing &nbsp;·&nbsp; eth_accounts · zbx_accounts</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-amber-400 border-amber-500/40">--features zvm</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <code className="text-xs bg-muted px-1 rounded">false</code>, <code className="text-xs bg-muted px-1 rounded">[]</code> — node never holds wallet keys. Each pair shares one handler.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_gasPrice · zbx_gasPrice &nbsp;·&nbsp; eth_blobBaseFee · zbx_blobBaseFee &nbsp;·&nbsp; eth_feeHistory · zbx_feeHistory</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-amber-400 border-amber-500/40">--features zvm</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Live base-fee from the AMM-pegged window; blob base fee is a constant <code className="text-xs bg-muted px-1 rounded">"0x1"</code> (Zebvix is a non-blob chain). Each pair shares one handler.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_getTransactionCount &nbsp;·&nbsp; eth_getCode · zbx_getCode &nbsp;·&nbsp; eth_getStorageAt · zbx_getStorageAt</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-amber-400 border-amber-500/40">--features zvm</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Served by <code className="text-xs bg-muted px-1 rounded">zvm_rpc::dispatch</code> over <code className="text-xs bg-muted px-1 rounded">CF_ZVM</code> (account.nonce, code, slots). <code className="text-xs bg-muted px-1 rounded">eth_getTransactionCount</code> is intentionally <strong>not</strong> aliased to <code className="text-xs bg-muted px-1 rounded">zbx_getNonce</code> — the latter is an <strong>always-on</strong> native method in <code className="text-xs bg-muted px-1 rounded">rpc.rs</code> that returns a flat <code className="text-xs bg-muted px-1 rounded">u64</code> (different shape from the <code className="text-xs bg-muted px-1 rounded">"0x…"</code> hex quantity here), so use <code className="text-xs bg-muted px-1 rounded">zbx_getNonce</code> on stripped builds and either name on ZVM builds.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_call · zbx_call &nbsp;·&nbsp; eth_estimateGas</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-amber-400 border-amber-500/40">--features zvm</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Execute against tip state without committing — ideal for view functions and pre-flight gas estimates. <code className="text-xs bg-muted px-1 rounded">eth_estimateGas</code> is intentionally <strong>not</strong> aliased — <code className="text-xs bg-muted px-1 rounded">zbx_estimateGas</code> is a separate native method in <code className="text-xs bg-muted px-1 rounded">rpc.rs</code> for native ZBX transfers and would collide.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_sendRawTransaction · zbx_sendRawZvmTransaction</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-amber-400 border-amber-500/40">--features zvm</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Accepts EIP-1559 (type-2), EIP-2930 (type-1), and <strong>EIP-155-protected legacy</strong> RLP envelopes; <strong>rejects</strong> unprotected legacy tx (no chain-id) to prevent cross-chain replay. Decoded into <code className="text-xs bg-muted px-1 rounded">ZvmTxEnvelope::Create</code> or <code className="text-xs bg-muted px-1 rounded">::Call</code> and executed; returns the canonical Ethereum-spec tx hash. The <code className="text-xs bg-muted px-1 rounded">zbx_sendRawZvmTransaction</code> alias exists so a Zebvix-namespace-only client can submit RLP without referencing the <code className="text-xs bg-muted px-1 rounded">eth_*</code> family — distinct from the always-on native <code className="text-xs bg-muted px-1 rounded">zbx_sendRawTransaction</code> which takes hex-encoded bincode, not RLP. Legacy <code className="text-xs bg-muted px-1 rounded">zbx_sendRawEvmTransaction</code> still accepted as a deprecated alias.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_getLogs · zbx_getLogs</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-amber-400 border-amber-500/40">--features zvm</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Wired to <code className="text-xs bg-muted px-1 rounded">CF_LOGS</code> (key = <code className="text-xs bg-muted px-1 rounded">(block_height, log_index)</code>, range scan + in-memory address/topic filter). Every <code className="text-xs bg-muted px-1 rounded">eth_sendRawTransaction</code> persists emitted logs with canonical tx-hash + per-block monotonic <code className="text-xs bg-muted px-1 rounded">logIndex</code>.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_getTransactionByHash · zbx_getZvmTransaction</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">LIVE (native)</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Resolves any tx hash present in the recent-tx ring buffer (rolling cap of 1000 native ZBX tx) into a standard Ethereum-shape JSON object: <code className="text-xs bg-muted px-1 rounded">{"{ hash, blockHash, blockNumber, transactionIndex, from, to, value, gas, gasPrice, nonce, input, type, chainId, v, r, s }"}</code>. Hash→seq mapping is maintained as a side-index in <code className="text-xs bg-muted px-1 rounded">CF_META</code> with cascade-delete on ring eviction. Returns <code className="text-xs bg-muted px-1 rounded">null</code> when the hash is outside the rolling window.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_getTransactionReceipt · zbx_getZvmReceipt</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">LIVE (native)</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Returns a real receipt — <code className="text-xs bg-muted px-1 rounded">{"{ status, transactionHash, transactionIndex, blockHash, blockNumber, from, to, cumulativeGasUsed, gasUsed, contractAddress, logs[], logsBloom, type, effectiveGasPrice }"}</code> — sourced from the persisted <code className="text-xs bg-muted px-1 rounded">ZvmReceipt</code> in <code className="text-xs bg-muted px-1 rounded">CF_LOGS</code> for ZVM tx, and from the recent-tx ring buffer for native ZBX tx. Aliased as <code className="text-xs bg-muted px-1 rounded">zbx_getZvmReceipt</code>.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_getBlockByNumber</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-amber-400 border-amber-500/40">--features zvm</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Returns the standard Ethereum block envelope{" "}
                    <code className="text-xs bg-muted px-1 rounded">{"{ number, timestamp, gasLimit, baseFeePerGas, miner, transactions[] }"}</code>{" "}
                    for any height — for the full Zebvix-native body (multisig events, Pay-ID intents) use <code className="text-xs bg-muted px-1 rounded">zbx_getBlockByNumber</code>.
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_getBlockByNumber</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">always-on</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Returns the full Zebvix-native block body (header + native txs + multisig events + Pay-ID intents). Use this for explorer UIs and indexers; the <code className="text-xs bg-muted px-1 rounded">eth_*</code> variant above is for EVM-wallet compatibility.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Custom precompiles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Custom Zebvix Precompiles
          </CardTitle>
          <CardDescription>
            Native chain features (bridge, AMM, Pay-ID, multisig) exposed as ZVM
            precompiles at addresses <code className="text-xs bg-muted px-1 rounded">0x80</code>–<code className="text-xs bg-muted px-1 rounded">0x83</code>.
            Solidity contracts call them like any other contract — gas costs
            are hard-coded and deterministic. For settlement-critical paths the
            dedicated native RPCs (<code className="text-xs bg-muted px-1 rounded">zbx_bridge*</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">zbx_pool*</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">zbx_multisig*</code>) remain the recommended production interface
            for explorer + back-end integrations. Source:{" "}
            <code className="text-xs bg-muted px-1 rounded">zvm_precompiles::dispatch</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">zvm_rpc::eth_sendRawTransaction</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border border-border rounded-md overflow-hidden bg-card/40">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="text-foreground w-24">Address</TableHead>
                  <TableHead className="text-foreground w-44">Name</TableHead>
                  <TableHead className="text-foreground w-32">Source module</TableHead>
                  <TableHead className="text-foreground w-24">Gas</TableHead>
                  <TableHead className="text-foreground">Purpose</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">0x80</TableCell>
                  <TableCell className="font-mono text-xs">bridge_out</TableCell>
                  <TableCell className="font-mono text-xs">bridge.rs</TableCell>
                  <TableCell className="font-mono text-xs">35,000</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Initiate a cross-chain transfer to a registered foreign asset (BEP-20 / ERC-20). Calldata = (asset_id, dest_chain, recipient). Returns deterministic (nonce, evt_hash). For production cross-chain transfers prefer the <code className="text-xs bg-muted px-1 rounded">zbx_bridgeOut</code> native RPC.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">0x81</TableCell>
                  <TableCell className="font-mono text-xs">payid_resolve</TableCell>
                  <TableCell className="font-mono text-xs">state.rs</TableCell>
                  <TableCell className="font-mono text-xs">2,500</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Resolve a Pay-ID alias (e.g. <code className="text-xs bg-muted px-1 rounded">"alice"</code>) to its 20-byte ZVM address. For high-throughput off-chain lookups use <code className="text-xs bg-muted px-1 rounded">zbx_payidResolve</code>.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">0x82</TableCell>
                  <TableCell className="font-mono text-xs">amm_swap</TableCell>
                  <TableCell className="font-mono text-xs">pool.rs</TableCell>
                  <TableCell className="font-mono text-xs">50,000</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Swap against the native ZBX↔zUSD AMM pool. Calldata = (direction, amount_in, min_out). For real settlement, the recommended production path is the <code className="text-xs bg-muted px-1 rounded">zbx_poolSwap</code> native RPC.
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">0x83</TableCell>
                  <TableCell className="font-mono text-xs">multisig_propose</TableCell>
                  <TableCell className="font-mono text-xs">multisig.rs</TableCell>
                  <TableCell className="font-mono text-xs">30,000</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Submit a proposal to a registered multisig vault. Calldata = (vault, op_bytes). For production registration the recommended path is the <code className="text-xs bg-muted px-1 rounded">zbx_multisigPropose</code> native RPC.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="text-xs text-muted-foreground border border-amber-500/30 bg-amber-500/5 rounded p-3 space-y-1">
            <div className="text-foreground font-semibold">
              Standard Ethereum precompiles — current coverage
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              <li>
                <code className="text-xs bg-muted px-1 rounded">0x01 ECRECOVER</code> — full secp256k1 sig recovery (used by EIP-712, ERC-2612 permit).
              </li>
              <li>
                <code className="text-xs bg-muted px-1 rounded">0x02 SHA256</code> — full.
              </li>
              <li>
                <code className="text-xs bg-muted px-1 rounded">0x03 RIPEMD160</code> — gas-correct (rarely used by modern dApps).
              </li>
              <li>
                <code className="text-xs bg-muted px-1 rounded">0x04 IDENTITY</code> — full memcpy.
              </li>
              <li>
                <code className="text-xs bg-muted px-1 rounded">0x05 MODEXP</code> — full EIP-2565 dynamic-cost pricing with real ≤256-bit modular exponentiation.
              </li>
              <li>
                <code className="text-xs bg-muted px-1 rounded">0x09 BLAKE2F</code> — full pure-Rust EIP-152 BLAKE2b F compression. <code className="text-xs bg-muted px-1 rounded">0x06–0x08</code> alt_bn128 add/mul/pairing are gas-priced per EIP-1108 (zk-SNARK verifier contracts gas-estimate correctly).
              </li>
            </ul>
          </div>

          <div>
            <div className="text-sm font-semibold text-foreground mb-2">
              Solidity example — calling 0x82 (AMM swap)
            </div>
            <CodeBlock
              language="solidity"
              code={`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IZebvixAmm {
    // sell_token: 0 = ZBX, 1 = zUSD
    function swap(uint8 sell_token, uint256 amount_in, uint256 min_out)
        external
        returns (uint256 amount_out);
}

contract DexAggregator {
    IZebvixAmm constant AMM = IZebvixAmm(address(0x82));

    function sellZbxForZusd(uint256 zbxIn, uint256 minOut)
        external
        returns (uint256 zusdOut)
    {
        zusdOut = AMM.swap(0, zbxIn, minOut);
    }
}`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Connect from clients */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Connect Toolchains
          </CardTitle>
          <CardDescription>
            Public RPC for the live chain:{" "}
            <code className="text-xs bg-muted px-1 rounded">http://93.127.213.192:8545</code>.
            Same endpoint serves Hardhat, Foundry, MetaMask, ethers, viem, and any
            EIP-155 wallet — no Zebvix-specific SDK required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* MetaMask */}
          <div className="space-y-2">
            <div className="font-semibold text-sm text-primary flex items-center gap-2">
              <Plug className="w-4 h-4" /> MetaMask · custom network
            </div>
            <div className="border border-border rounded-md overflow-hidden bg-card/40">
              <Table>
                <TableBody>
                  <TableRow className="border-b border-border hover:bg-muted/30">
                    <TableCell className="text-sm text-muted-foreground w-44">Network name</TableCell>
                    <TableCell className="font-mono text-sm">Zebvix Mainnet</TableCell>
                  </TableRow>
                  <TableRow className="border-b border-border hover:bg-muted/30">
                    <TableCell className="text-sm text-muted-foreground">RPC URL</TableCell>
                    <TableCell className="font-mono text-sm">http://93.127.213.192:8545</TableCell>
                  </TableRow>
                  <TableRow className="border-b border-border hover:bg-muted/30">
                    <TableCell className="text-sm text-muted-foreground">Chain ID</TableCell>
                    <TableCell className="font-mono text-sm">7878</TableCell>
                  </TableRow>
                  <TableRow className="border-b border-border hover:bg-muted/30">
                    <TableCell className="text-sm text-muted-foreground">Currency symbol</TableCell>
                    <TableCell className="font-mono text-sm">ZBX</TableCell>
                  </TableRow>
                  <TableRow className="hover:bg-muted/30">
                    <TableCell className="text-sm text-muted-foreground">Decimals</TableCell>
                    <TableCell className="font-mono text-sm">18</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Hardhat */}
          <div className="space-y-2">
            <div className="font-semibold text-sm text-primary flex items-center gap-2">
              <Hammer className="w-4 h-4" /> Hardhat · hardhat.config.js
            </div>
            <CodeBlock
              language="javascript"
              code={`require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: "0.8.24",
  networks: {
    zebvix: {
      url: "http://93.127.213.192:8545",
      chainId: 7878,
      accounts: [process.env.DEPLOYER_PK],
    },
  },
};`}
            />
            <CodeBlock
              language="bash"
              code={`# Deploy
npx hardhat run scripts/deploy.js --network zebvix

# Read state on the deployed contract
npx hardhat console --network zebvix
> const c = await ethers.getContractAt("MyToken", "0x...")
> await c.totalSupply()

# Read receipt + logs for any tx
> const rcpt = await ethers.provider.getTransactionReceipt(txHash)
> rcpt.logs
> await c.balanceOf("0x...")`}
            />
          </div>

          {/* Foundry */}
          <div className="space-y-2">
            <div className="font-semibold text-sm text-primary flex items-center gap-2">
              <Hammer className="w-4 h-4" /> Foundry · foundry.toml + forge create
            </div>
            <CodeBlock
              language="toml"
              code={`[profile.default]
solc = "0.8.24"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
zebvix = "http://93.127.213.192:8545"`}
            />
            <CodeBlock
              language="bash"
              code={`# Deploy
forge create src/MyToken.sol:MyToken \\
    --rpc-url zebvix \\
    --private-key $DEPLOYER_PK \\
    --constructor-args "MyToken" "MTK" 1000000

# Read state
cast call <contract> "balanceOf(address)(uint256)" <addr> --rpc-url zebvix

# Send tx
cast send <contract> "transfer(address,uint256)" <to> 100 \\
    --private-key $DEPLOYER_PK --rpc-url zebvix`}
            />
          </div>

          {/* ethers / viem */}
          <div className="space-y-2">
            <div className="font-semibold text-sm text-primary flex items-center gap-2">
              <FileCode2 className="w-4 h-4" /> ethers v6 · provider
            </div>
            <CodeBlock
              language="javascript"
              code={`import { JsonRpcProvider, Wallet, Contract } from "ethers";

const provider = new JsonRpcProvider("http://93.127.213.192:8545", {
  chainId: 7878,
  name: "zebvix",
});

const signer = new Wallet(process.env.PK, provider);
const tx = await signer.sendTransaction({
  to: "0x...",
  value: 1_000_000_000_000_000_000n,  // 1 ZBX in wei
});
console.log("hash:", tx.hash);`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Storage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            On-Disk Storage
          </CardTitle>
          <CardDescription>
            Two RocksDB column families dedicated to ZVM state. Both live inside
            the same <code className="text-xs bg-muted px-1 rounded">--home/data</code> directory as native Zebvix state.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-border rounded-lg p-4 bg-card/40">
              <div className="font-semibold text-primary mb-2">CF_ZVM</div>
              <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
                <li>
                  <code className="text-xs bg-muted px-1 rounded">acct/&lt;addr&gt;</code> →{" "}
                  <code className="text-xs bg-muted px-1 rounded">ZvmAccount &#123; nonce, balance, code_hash, storage_root &#125;</code>
                </li>
                <li>
                  <code className="text-xs bg-muted px-1 rounded">code/&lt;keccak256&gt;</code> → raw runtime bytecode (content-addressed, deduplicated across deployments)
                </li>
                <li>
                  <code className="text-xs bg-muted px-1 rounded">slot/&lt;addr&gt;/&lt;key&gt;</code> → 32-byte storage value
                </li>
              </ul>
            </div>
            <div className="border border-border rounded-lg p-4 bg-card/40">
              <div className="font-semibold text-primary mb-2">CF_LOGS</div>
              <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
                <li>
                  Key:{" "}
                  <code className="text-xs bg-muted px-1 rounded">log_key(block_height, log_index)</code> — block-ordered, contiguous on disk.
                </li>
                <li>
                  <code className="text-xs bg-muted px-1 rounded">iter_logs(from, to)</code> performs a single bounded RocksDB range scan; <code className="text-xs bg-muted px-1 rounded">eth_getLogs</code> then applies address &amp; topic filters in memory before returning. Topic indexing (a secondary key on <code className="text-xs bg-muted px-1 rounded">topic0..topic3</code>) is a future optimisation, not the current model.
                </li>
                <li>
                  <strong>Producers wired:</strong> the ZVM tx path (<code className="text-xs bg-muted px-1 rounded">eth_sendRawTransaction</code>) calls <code className="text-xs bg-muted px-1 rounded">store_logs</code> on every committed frame, stamping the canonical tx hash and a per-block monotonic <code className="text-xs bg-muted px-1 rounded">logIndex</code>. <code className="text-xs bg-muted px-1 rounded">eth_getLogs</code> returns the resulting entries verbatim.
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Governance hooks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            Governance Hooks
          </CardTitle>
          <CardDescription>
            ZVM-related parameters and feature flags are governance-mutable
            on-chain — submit a proposal, ride out the 14-day shadow window,
            then a 76-day vote, and changes take effect with no hard fork.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="border border-border rounded-md p-3 bg-card/40">
            <div className="text-foreground font-semibold mb-1">
              <code className="text-xs bg-muted px-1 rounded">ParamChange</code> · block_gas_limit
            </div>
            <p>
              Validators can submit{" "}
              <code className="text-xs bg-muted px-1 rounded">
                Proposal &#123; kind: ParamChange, key: "block_gas_limit", value: "60000000" &#125;
              </code>
              ; once activated, the new value is read from <code className="text-xs bg-muted px-1 rounded">CF_META</code>{" "}
              by <code className="text-xs bg-muted px-1 rounded">ZvmContext</code> on every subsequent ZVM tx.
            </p>
          </div>
          <div className="border border-border rounded-md p-3 bg-card/40">
            <div className="text-foreground font-semibold mb-1">
              <code className="text-xs bg-muted px-1 rounded">contract_whitelist</code>
            </div>
            <p>
              Optional governance gate that allows the community to restrict
              access to high-power native precompiles
              (<code className="text-xs bg-muted px-1 rounded">0x80</code>–<code className="text-xs bg-muted px-1 rounded">0x83</code>)
              to a vetted set of contracts. Off by default — the chain is fully permissionless out of the box.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
