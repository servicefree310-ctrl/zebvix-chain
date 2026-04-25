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
            Phase C.2 · LIVE
          </Badge>
          <Badge
            variant="outline"
            className="text-blue-400 border-blue-500/40"
          >
            Cancun fork
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Smart Contracts (ZVM)
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Zebvix ships a Cancun-targeted Ethereum Virtual Machine (Phase C.2 preview — useful subset, not yet 100% mainnet-equivalent) compiled into
          the same binary as the chain runtime. Solidity 0.8+ contracts, Hardhat,
          Foundry, MetaMask, and OpenZeppelin libraries work zero-config for the supported opcode + precompile subset; the
          chain looks like an Ethereum L1 on the wire, with chain-id{" "}
          <code className="text-sm bg-muted px-1.5 py-0.5 rounded">7878</code> and
          ZBX as the gas token.
        </p>

        <div className="border-l-4 border-l-amber-500/50 bg-amber-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">
              Phase C.2 status &amp; current limitations
            </div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                ZVM tx are dispatched via{" "}
                <code className="text-xs bg-muted px-1 rounded">eth_sendRawTransaction</code>{" "}
                directly into <code className="text-xs bg-muted px-1 rounded">zvm::execute()</code> — they live in their own envelope (<code className="text-xs bg-muted px-1 rounded">ZvmTxEnvelope</code>), not the native <code className="text-xs bg-muted px-1 rounded">TxKind</code>.
              </li>
              <li>
                <code className="text-xs bg-muted px-1 rounded">eth_getTransactionByHash</code> and{" "}
                <code className="text-xs bg-muted px-1 rounded">eth_getTransactionReceipt</code>{" "}
                are wired (Phase C.2.1) for <strong>native ZBX tx</strong> — they resolve any hash present in the recent-tx ring buffer (rolling window of 1000 txs) into a synthetic Ethereum-shape JSON (status=<code className="text-xs bg-muted px-1 rounded">0x1</code> by construction since failed txs are never indexed, gas=21000, type=0x0, v/r/s=0). <strong>ZVM (Solidity) tx are NOT yet indexed</strong> in the ring buffer, and <code className="text-xs bg-muted px-1 rounded">eth_getLogs</code> still returns <code className="text-xs bg-muted px-1 rounded">[]</code> for ZVM tx — <code className="text-xs bg-muted px-1 rounded">eth_sendRawTransaction</code> doesn't yet call <code className="text-xs bg-muted px-1 rounded">store_logs</code>, and emitted log entries carry <code className="text-xs bg-muted px-1 rounded">tx_hash = 0x00</code>. Full ZVM coverage (log persistence + canonical tx-hash stamping + ZVM receipts) lands in C.3.
              </li>
              <li>
                <code className="text-xs bg-muted px-1 rounded">eth_getBlockByNumber</code>{" "}
                returns a tip-only stub <code className="text-xs bg-muted px-1 rounded">{"{ number, timestamp, gasLimit, baseFeePerGas, miner, transactions: [] }"}</code>. Full historical projection also C.3.
              </li>
              <li>
                Unprotected legacy tx (no EIP-155 chain-id) are rejected outright — every modern wallet is fine.
              </li>
              <li>
                EIP-2929/3529 warm/cold access split not yet modelled — every state access charged at a fixed single-tier cost (no access-list cache). Standard precompiles only <code className="text-xs bg-muted px-1 rounded">0x01–0x05</code> dispatched: <code className="text-xs bg-muted px-1 rounded">0x03 RIPEMD160</code> is a gas-correct zero-output stub, <code className="text-xs bg-muted px-1 rounded">0x05 MODEXP</code> is a fixed-200-gas placeholder (no EIP-2565 dynamic pricing); <code className="text-xs bg-muted px-1 rounded">0x06–0x09</code> (alt_bn128, blake2f) deferred — zk-SNARK verifier contracts won't run yet.
              </li>
              <li>
                Custom Zebvix precompiles <code className="text-xs bg-muted px-1 rounded">0x80–0x83</code> currently return deterministic preview values for gas estimation and ABI shape stability — <strong>their native side-effects (bridge transfer, AMM swap, multisig proposal, Pay-ID lookup) are NOT yet committed on the <code className="text-xs bg-muted px-1 rounded">eth_sendRawTransaction</code> path</strong>; production calls must use the existing <code className="text-xs bg-muted px-1 rounded">zbx_*</code> RPC namespace. The post-frame intent-capture wiring is the remaining C.2 work.
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
                    │  ├─ precompile detect (0x01–0x05 dispatched, 0x06–0x09 deferred; 0x80–0x83 preview-only)
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
            Per-opcode gas costs follow the standard Ethereum schedule for the implemented subset (Cancun base costs); the EIP-2929/3529 warm/cold access split and EIP-2565 MODEXP dynamic pricing are not yet modelled, so audit gas profiles will read as conservative-but-uniform until C.3.
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
                    Cancun additions wired: <code className="text-xs bg-muted px-1 rounded">PUSH0</code> (EIP-3855),
                    transient storage <code className="text-xs bg-muted px-1 rounded">TLOAD/TSTORE</code> (EIP-1153),
                    <code className="text-xs bg-muted px-1 rounded">MCOPY</code> (EIP-5656),
                    <code className="text-xs bg-muted px-1 rounded">BLOBHASH</code> stub (EIP-4844 — returns 0).{" "}
                    <code className="text-xs bg-muted px-1 rounded">SELFDESTRUCT</code> (0xff) is rejected — frame reverts with{" "}
                    <code className="text-xs bg-muted px-1 rounded">"SELFDESTRUCT disabled (post-Cancun deprecation)"</code> (zvm_interp.rs:547).
                    <strong> Not yet implemented in the dispatch table:</strong> signed-arithmetic <code className="text-xs bg-muted px-1 rounded">SDIV</code> (0x05), <code className="text-xs bg-muted px-1 rounded">SMOD</code> (0x07), signed comparisons <code className="text-xs bg-muted px-1 rounded">SLT</code>/<code className="text-xs bg-muted px-1 rounded">SGT</code> (0x12/0x13), <code className="text-xs bg-muted px-1 rounded">SAR</code> (0x1d), <code className="text-xs bg-muted px-1 rounded">EXTCODECOPY</code> (0x3c), <code className="text-xs bg-muted px-1 rounded">RETURNDATACOPY</code> (0x3e). Contracts that emit these (e.g. heavy signed <code className="text-xs bg-muted px-1 rounded">int256</code> arithmetic, <code className="text-xs bg-muted px-1 rounded">try/catch</code> with returndata copy) will revert with unknown-opcode — the remaining opcode coverage is the next chunk of C.2.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">
                    Per-opcode gas
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Yellow-paper Cancun values for arithmetic / memory / storage opcodes. <strong>Caveat:</strong> EIP-2929/3529 warm/cold access split is not yet modelled — there is no access-list cache, so every <code className="text-xs bg-muted px-1 rounded">SLOAD</code>, <code className="text-xs bg-muted px-1 rounded">BALANCE</code>, <code className="text-xs bg-muted px-1 rounded">EXTCODE*</code>, and <code className="text-xs bg-muted px-1 rounded">CALL*</code> is charged at a single fixed cost (<code className="text-xs bg-muted px-1 rounded">G_SLOAD=2100</code>, <code className="text-xs bg-muted px-1 rounded">G_BALANCE/G_EXTCODE/G_CALL=2600</code>). Real warm/cold pricing lands later in Phase C.2.
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
                    EIP-3529 cap (<code className="text-xs bg-muted px-1 rounded">gas_used / 5</code>, 20 %) is the target. <strong>Today the interpreter only accumulates SSTORE clear refunds</strong> — the cap is applied later by the (still-deferred) gas-settlement path in C.3, alongside monetary debit/refund of ZBX wei. So the value is tracked but not yet enforced on-chain.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">
                    Block gas limit
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Compiled-in <code className="text-xs bg-muted px-1 rounded">DEFAULT_BLOCK_GAS_LIMIT = 30_000_000</code> (zvm.rs); the value is read directly inside <code className="text-xs bg-muted px-1 rounded">ZvmRpcCtx::zvm_context()</code> on every tx. Phase D ships the <code className="text-xs bg-muted px-1 rounded">ParamChange</code> proposal API for <code className="text-xs bg-muted px-1 rounded">block_gas_limit</code>, but the runtime read of the new value is wired in C.3 — until then the compiled default is what executes.
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
            intrinsic-gas check → execute → journal → emit logs. Monetary gas debit / refund of ZBX wei is wired in C.3 — today the ZVM enforces only the intrinsic-gas ceiling and value movement.
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
                    Routed by the <code className="text-xs bg-muted px-1 rounded">rpc.rs</code> arm against the native ZBX account ledger (<code className="text-xs bg-muted px-1 rounded">CF_ACCOUNTS</code>). <strong>Caveat:</strong> ZVM-side balance changes are journaled into <code className="text-xs bg-muted px-1 rounded">CF_ZVM</code> via <code className="text-xs bg-muted px-1 rounded">apply_journal</code> and not synced back to <code className="text-xs bg-muted px-1 rounded">CF_ACCOUNTS</code> — so after ZVM activity the two ledgers can diverge for the same secp256k1 address (cross-domain settlement is C.3 work).
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
                    Live base-fee from the AMM-pegged window; blob base fee is a constant <code className="text-xs bg-muted px-1 rounded">"0x1"</code> stub (no blob market). Each pair shares one handler.
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
                    Wired to <code className="text-xs bg-muted px-1 rounded">CF_LOGS</code> (key = <code className="text-xs bg-muted px-1 rounded">(block_height, log_index)</code>, range scan + in-memory address/topic filter). <strong>Caveat:</strong> the <code className="text-xs bg-muted px-1 rounded">eth_sendRawTransaction</code> path does <em>not</em> currently call <code className="text-xs bg-muted px-1 rounded">store_logs</code>, so ZVM tx produce no log entries to query today. The persistence wire-up + canonical tx-hash stamping land in C.3.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_getTransactionByHash · zbx_getZvmTransaction</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">LIVE (native)</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Phase C.2.1 — resolves any tx hash present in the recent-tx ring buffer (rolling cap of 1000 native ZBX tx) into a synthetic Ethereum-shape JSON object: <code className="text-xs bg-muted px-1 rounded">{"{ hash, blockHash, blockNumber, transactionIndex, from, to, value, gas: 0x5208, gasPrice: 0x0, nonce, input: 0x, type: 0x0, chainId: 0x1ec6, v: 0x0, r: 0x0, s: 0x0 }"}</code>. Hash→seq mapping is maintained as a side-index in CF_META under <code className="text-xs bg-muted px-1 rounded">rtx/h/{"<32-byte hash>"}</code>; cascade-deleted on ring eviction. Returns <code className="text-xs bg-muted px-1 rounded">null</code> when the hash is outside the rolling window OR the tx is a ZVM (Solidity) tx — ZVM tx are not yet indexed (C.3).
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_getTransactionReceipt · zbx_getZvmReceipt</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">LIVE (native)</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Phase C.2.1 — for any native ZBX tx hash present in the ring buffer, returns a synthetic receipt: <code className="text-xs bg-muted px-1 rounded">{"{ status: 0x1, transactionHash, transactionIndex, blockHash, blockNumber, from, to, cumulativeGasUsed: 0x5208, gasUsed: 0x5208, contractAddress: null, logs: [], logsBloom: 0x00…(256), type: 0x0, effectiveGasPrice: 0x0 }"}</code>. <strong>status=0x1 by construction</strong> — failed native txs are never indexed in the ring buffer (only successful applies are pushed). Aliased as <code className="text-xs bg-muted px-1 rounded">zbx_getZvmReceipt</code> (legacy <code className="text-xs bg-muted px-1 rounded">zbx_getEvmReceipt</code> still accepted). Real ZVM receipts (with on-execution gasUsed, contractAddress, logs[]) ship in C.3 together with log persistence + ZVM-tx ring-buffer indexing.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">eth_getBlockByNumber</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-amber-400 border-amber-500/40">--features zvm</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    C.2 stub — returns tip-only object{" "}
                    <code className="text-xs bg-muted px-1 rounded">{"{ number, timestamp, gasLimit, baseFeePerGas, miner, transactions: [] }"}</code>. Full historical block projection (with embedded txs, hex hashes, gasUsed) lands alongside the receipts table in C.3.
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_getBlockByNumber</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-emerald-400 border-emerald-500/40">always-on</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Returns the full Zebvix block body (header + native txs + multisig events + Pay-ID intents). Use this for explorer UIs; the ZVM-flavoured stub above is purely for wallet compatibility.
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
            Solidity contracts can call them like any other contract — gas costs
            are hard-coded and deterministic. <strong>Phase C.2 status:</strong> the precompile dispatchers currently return deterministic preview / stand-in values so contracts can gas-estimate and ABI-decode the return shape. <strong>The actual native side-effects (bridge transfer, AMM settlement, multisig registration, Pay-ID lookup) are NOT yet committed on the <code className="text-xs bg-muted px-1 rounded">eth_sendRawTransaction</code> path</strong> — the post-frame intent-capture hook into <code className="text-xs bg-muted px-1 rounded">state::apply_tx</code> is the remaining C.2 work. Native module RPCs (<code className="text-xs bg-muted px-1 rounded">zbx_bridge*</code>, <code className="text-xs bg-muted px-1 rounded">zbx_pool*</code>, <code className="text-xs bg-muted px-1 rounded">zbx_multisig*</code>) continue to be the production path today.
            Source:{" "}
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
                    Initiate a cross-chain transfer to a registered foreign asset (BEP-20 / ERC-20). Calldata = (asset_id, dest_chain, recipient). <strong>Preview:</strong> returns deterministic (nonce, evt_hash); the actual outbound bridge entry is <em>not</em> recorded today via this path — use the <code className="text-xs bg-muted px-1 rounded">zbx_bridgeOut</code> native RPC for production transfers.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">0x81</TableCell>
                  <TableCell className="font-mono text-xs">payid_resolve</TableCell>
                  <TableCell className="font-mono text-xs">state.rs</TableCell>
                  <TableCell className="font-mono text-xs">2,500</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Resolve a Pay-ID alias (e.g. <code className="text-xs bg-muted px-1 rounded">"alice"</code>) to its 20-byte ZVM address. <strong>Preview:</strong> currently returns 32 zero bytes — the registry lookup is not wired into the ZVM frame yet, so callers receive <code className="text-xs bg-muted px-1 rounded">address(0)</code> regardless of the input. Use <code className="text-xs bg-muted px-1 rounded">zbx_payidResolve</code> off-chain until the C.2 wire-up lands.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">0x82</TableCell>
                  <TableCell className="font-mono text-xs">amm_swap</TableCell>
                  <TableCell className="font-mono text-xs">pool.rs</TableCell>
                  <TableCell className="font-mono text-xs">50,000</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Swap against the native ZBX↔zUSD AMM pool. Calldata = (direction, amount_in, min_out). <strong>Preview:</strong> returns a deterministic <code className="text-xs bg-muted px-1 rounded">amount_in × 95 / 100</code> placeholder; <em>no</em> tokens are actually moved on this path. Use the <code className="text-xs bg-muted px-1 rounded">zbx_poolSwap</code> RPC for real swaps.
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">0x83</TableCell>
                  <TableCell className="font-mono text-xs">multisig_propose</TableCell>
                  <TableCell className="font-mono text-xs">multisig.rs</TableCell>
                  <TableCell className="font-mono text-xs">30,000</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Submit a proposal to a registered multisig vault. Calldata = (vault, op_bytes). <strong>Preview:</strong> returns a deterministic <code className="text-xs bg-muted px-1 rounded">proposal_id = u64::from_be_bytes(keccak256(op)[..8])</code> — <em>no</em> proposal is registered yet on this path. Use <code className="text-xs bg-muted px-1 rounded">zbx_multisigPropose</code> to actually create proposals until C.2 wire-up lands.
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
                <code className="text-xs bg-muted px-1 rounded">0x03 RIPEMD160</code> — gas-correct stub returning zero (rarely used by modern dApps; full impl deferred).
              </li>
              <li>
                <code className="text-xs bg-muted px-1 rounded">0x04 IDENTITY</code> — full memcpy.
              </li>
              <li>
                <code className="text-xs bg-muted px-1 rounded">0x05 MODEXP</code> — fixed-minimum-cost (200 gas) placeholder returning zero; EIP-2565 dynamic-cost formula and real big-int math both deferred to later C.2.
              </li>
              <li>
                <code className="text-xs bg-muted px-1 rounded">0x06–0x09</code> (alt_bn128 add/mul/pairing, blake2f) — <strong>not yet dispatched</strong>; deferred to later in Phase C.2. Contracts that depend on them (e.g. zk-SNARK verifiers) will not deploy correctly today.
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

# Read state on the deployed contract (works today)
npx hardhat console --network zebvix
> const c = await ethers.getContractAt("MyToken", "0x...")
> await c.totalSupply()

# NOTE (Phase C.2): both getTransactionReceipt and getLogs are non-functional
# for ZVM tx until C.3 wires log persistence and the receipts table.
# Verify a write succeeded by re-reading state instead:
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
                  <strong>C.2 gap:</strong> <code className="text-xs bg-muted px-1 rounded">store_logs</code> is defined in <code className="text-xs bg-muted px-1 rounded">zvm_state.rs</code> but currently has <em>no call sites</em> — neither the ZVM tx path (<code className="text-xs bg-muted px-1 rounded">eth_sendRawTransaction</code>) nor any native module writes into <code className="text-xs bg-muted px-1 rounded">CF_LOGS</code> today, so <code className="text-xs bg-muted px-1 rounded">eth_getLogs</code> always returns an empty array. C.3 wires the producers (ZVM frame return + native modules) to <code className="text-xs bg-muted px-1 rounded">store_logs</code>, stamps the canonical tx hash, and ships the receipts table on top.
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
            Phase D Governance Hooks
          </CardTitle>
          <CardDescription>
            ZVM-related feature flags are governance-mutable today — but the runtime <em>enforcement</em> hooks are landing incrementally in Phase C.3. This section documents the proposal API, not yet a live policy gate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="border border-border rounded-md p-3 bg-card/40">
            <div className="text-foreground font-semibold mb-1">
              <code className="text-xs bg-muted px-1 rounded">ParamChange</code> · block_gas_limit
            </div>
            <p>
              <strong>Proposal API live, runtime read deferred to C.3.</strong> Validators can pass <code className="text-xs bg-muted px-1 rounded">Proposal &#123; kind: ParamChange, key: "block_gas_limit", value: "60000000" &#125;</code> and the new value lands in <code className="text-xs bg-muted px-1 rounded">CF_META</code> under <code className="text-xs bg-muted px-1 rounded">ff/block_gas_limit</code>, but ZVM execution currently always reads the <code className="text-xs bg-muted px-1 rounded">DEFAULT_BLOCK_GAS_LIMIT = 30_000_000</code> constant — wiring the flag into <code className="text-xs bg-muted px-1 rounded">ZvmContext</code> is the C.3 task.
            </p>
          </div>
          <div className="border border-border rounded-md p-3 bg-card/40">
            <div className="text-foreground font-semibold mb-1">
              <code className="text-xs bg-muted px-1 rounded">contract_whitelist</code>
            </div>
            <p>
              <strong>Flag + label only today; no enforcement.</strong> Community-voted proposals (<code className="text-xs bg-muted px-1 rounded">ProposalOp::Submit/Vote</code>) flip a feature flag and tag the contract with metadata, but the interpreter and precompile dispatchers do <em>not</em> currently consult that whitelist — there is no privileged-precompile gate yet. The intended use (restricting access to high-power native precompiles) lands once the post-frame intent-capture path is wired in C.2/C.3.
            </p>
          </div>
          <div className="border-l-4 border-l-amber-500/50 bg-amber-500/5 p-3 rounded text-xs flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <span>
              Until the C.3 runtime hooks land, do not rely on either flag for policy: the proposal will pass and persist, but execution will continue against the compiled-in defaults.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
