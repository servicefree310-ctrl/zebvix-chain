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
  ArrowLeftRight,
  Lock,
  Layers,
  AlertTriangle,
  Database,
  Workflow,
  ShieldCheck,
  Coins,
  Network,
  Plug,
  Server,
  KeyRound,
} from "lucide-react";
import BscSidePanel from "@/components/bridge/BscSidePanel";

export default function Bridge() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Badge variant="outline" className="text-emerald-400 border-emerald-400/40">
            Phase B.12 · LIVE
          </Badge>
          <Badge variant="outline" className="text-amber-400 border-amber-400/40">
            Single-trusted-oracle MVP
          </Badge>
          <Badge variant="outline" className="text-primary border-primary/40">
            Lock-and-mint / Burn-and-release
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">
          Cross-Chain Bridge
        </h1>
        <p className="text-lg text-muted-foreground">
          Zebvix ships a <strong>native Rust bridge module</strong> (
          <code className="text-xs bg-muted px-1 rounded">zebvix-chain/src/bridge.rs</code>)
          that lets ZBX and zUSD move to and from foreign chains (BSC, Ethereum, Polygon, …)
          using an admin-extensible registry of networks &amp; per-asset mappings. The chain
          itself only does two things: <strong>lock + emit event</strong> on the way out,
          and <strong>credit + mark-claim-used</strong> on the way in. Everything between
          (proof-of-foreign-deposit, wrapped-token mint on the destination chain) is the
          job of an <strong>off-chain oracle service</strong> run by the bridge admin.
        </p>
      </div>

      {/* ── Stat tiles ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: ArrowLeftRight, label: "Direction", value: "ZBX/zUSD ↔ ZVM" },
          { icon: Lock, label: "Lock vault", value: "0x7a627264670…" },
          { icon: Layers, label: "Networks", value: "Admin-registered" },
          { icon: Coins, label: "Native assets", value: "ZBX (18d) · zUSD (6d)" },
        ].map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="p-4 rounded-lg bg-card border border-border"
          >
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Icon className="h-4 w-4 text-primary" />
              {label}
            </div>
            <div className="text-base font-semibold mt-1 font-mono truncate">
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Trust-model callout ────────────────────────────────── */}
      <div className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/5 text-sm space-y-2">
        <div className="flex items-center gap-2 font-semibold text-amber-400">
          <AlertTriangle className="h-4 w-4" /> Trust model &amp; current limitations (Phase B.12)
        </div>
        <ul className="list-disc list-inside text-muted-foreground space-y-1.5 pl-1">
          <li>
            <strong>Single trusted oracle.</strong> The chain admin (current{" "}
            <code className="text-xs bg-muted px-1 rounded">zbx_getAdmin</code>) IS the
            oracle: only that key can submit{" "}
            <code className="text-xs bg-muted px-1 rounded">RegisterNetwork</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">RegisterAsset</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">SetNetworkActive</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">SetAssetActive</code>, and{" "}
            <code className="text-xs bg-muted px-1 rounded">BridgeIn</code>. <strong>
            Admin-key compromise = full bridge drain.</strong> Hardening (multisig oracle
            committee, then SPV / light-client proof) is on the roadmap but not yet wired.
          </li>
          <li>
            <strong>No on-chain proof of foreign deposit.</strong> The chain trusts whatever{" "}
            <code className="text-xs bg-muted px-1 rounded">source_tx_hash</code> the
            admin submits — replay protection is the only safety rail (each 32-byte hash
            can be claimed exactly once).
          </li>
          <li>
            <strong>Outbound event ring buffer.</strong>{" "}
            <code className="text-xs bg-muted px-1 rounded">MAX_OUT_EVENTS = 4096</code>{" "}
            (bridge.rs:42). Older{" "}
            <code className="text-xs bg-muted px-1 rounded">BridgeOutEvent</code>s are
            evicted after that. The off-chain oracle MUST poll faster than this rolls over
            or it will miss work.
          </li>
          <li>
            <strong>Wrapped-token decimals stored, not scaled.</strong> The chain records{" "}
            <code className="text-xs bg-muted px-1 rounded">BridgeAsset.decimals</code> as
            a hint — both sides must agree off-chain.{" "}
            <code className="text-xs bg-muted px-1 rounded">body.amount</code> is always
            in Zebvix-native units (wei for ZBX, micro for zUSD); the oracle is responsible
            for re-scaling to the wrapped-token's decimals on the destination chain.
          </li>
          <li>
            <strong>No fee market on bridge tx.</strong> Bridge ops pay the standard
            Zebvix gas fee but there is no per-asset bridging fee, no liquidity
            provider, no slippage. Liquidity is 1:1 backed by the lock vault.
          </li>
        </ul>
      </div>

      {/* ── Live wZBX → ZBX conversion (BSC side) ──────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Badge variant="outline" className="text-emerald-400 border-emerald-400/40">
            Live · Mainnet
          </Badge>
          <Badge variant="outline" className="text-primary border-primary/40">
            wZBX → ZBX (BSC → Zebvix)
          </Badge>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">
          Convert wZBX back to ZBX
        </h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
          Burn your wrapped ZBX (BEP-20) on BNB Smart Chain via MetaMask. The
          relayer detects the burn after 15 BSC confirmations (~45 sec) and
          unlocks native ZBX on Zebvix L1 to whatever recipient address you
          specify below. Recipient can be any Zebvix address — it does not have
          to be your burner wallet.
        </p>
        <BscSidePanel />
      </div>

      {/* ── Architecture diagram ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="w-5 h-5 text-primary" />
            Architecture · 2-leg flow
          </CardTitle>
          <CardDescription>
            Both directions cross the chain boundary at exactly one point: the on-chain{" "}
            <code className="text-xs bg-muted px-1 rounded">BridgeOp</code> dispatch in{" "}
            <code className="text-xs bg-muted px-1 rounded">state.rs::apply_tx</code>. Everything
            else lives off-chain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock
            language="text"
            code={`╔═══════════════════════════ Zebvix L1 (chain_id 7878) ═══════════════════════════╗
║                                                                                  ║
║  USER                                              ADMIN (= oracle key)          ║
║   │                                                  │                           ║
║   │ zebvix-node bridge-out                           │ zebvix-node bridge-in     ║
║   │ --asset-id  --dest 0x...                         │ --asset-id --source-tx-hash║
║   │ --amount  ZBX/zUSD                               │ --recipient --amount      ║
║   ▼                                                  ▼                           ║
║   TxKind::Bridge(BridgeOut{..})       TxKind::Bridge(BridgeIn{..})               ║
║   │                                                  │                           ║
║   ▼                                                  ▼                           ║
║   state.rs::apply_tx                                                             ║
║   ├─ debit  user.balance / user.zusd                 ├─ check claim NOT used     ║
║   ├─ credit BRIDGE_LOCK_ADDRESS                      ├─ debit  lock vault        ║
║   ├─ bump   bridge_locked_zbx / _zusd                ├─ credit recipient         ║
║   ├─ append BridgeOutEvent (seq++)                   ├─ decrement bridge_locked  ║
║   └─ emit   "🌉 bridge-out: seq=N..."                └─ mark   claim used (b/c)  ║
║                                                                                  ║
╚════════════╤══════════════════════════════════════════════╤══════════════════════╝
             │                                              │
             │ zbx_recentBridgeOutEvents (poll)             │ zbx_isBridgeClaimUsed
             ▼                                              ▲ (idempotency check)
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                  OFF-CHAIN ORACLE SERVICE  (admin runs this)            │
  │                                                                         │
  │   1. Poll zbx_recentBridgeOutEvents every N seconds                     │
  │   2. For each new event:  scale amount by BridgeAsset.decimals          │
  │                            mint wrapped token on destination chain       │
  │   3. Watch destination chain for incoming deposits to bridge vault      │
  │   4. For each foreign deposit: submit BridgeIn { source_tx_hash, .. }   │
  │      (replay protection — chain rejects duplicate hash)                 │
  └────────────────┬─────────────────────────────────────┬──────────────────┘
                   │                                     │
                   ▼                                     ▲
        ┌──────────────────────┐              ┌──────────────────────┐
        │  Foreign ZVM chain   │              │  Foreign ZVM chain   │
        │  e.g. BSC chain_id=56│              │  vault contract      │
        │  ERC-20/BEP-20 mint  │              │  user deposits here  │
        └──────────────────────┘              └──────────────────────┘`}
          />
        </CardContent>
      </Card>

      {/* ── BridgeOp variants ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="w-5 h-5 text-primary" />
            On-chain operations · <code className="text-xs bg-muted px-1.5 py-0.5 rounded">enum BridgeOp</code>
          </CardTitle>
          <CardDescription>
            All six variants are carried by{" "}
            <code className="text-xs bg-muted px-1 rounded">TxKind::Bridge(BridgeOp)</code>.
            Variant order is consensus-critical (bincode u32 LE tag) — never reorder
            without a migration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border border-border rounded-md overflow-hidden bg-card/40">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="text-foreground w-44">Variant</TableHead>
                  <TableHead className="text-foreground w-24">Auth</TableHead>
                  <TableHead className="text-foreground">Effect (state.rs)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">RegisterNetwork {"{ id, name, kind }"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-amber-400 border-amber-400/40">admin</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Adds a foreign network to the registry. <code className="text-xs bg-muted px-1 rounded">id</code> is the foreign chain-id (56 = BSC, 1 = ETH, 137 = Polygon, …); <code className="text-xs bg-muted px-1 rounded">kind</code> ∈ {"{Evm, Other}"}; name validated (≤ 32 ASCII alnum + <code className="text-xs bg-muted px-1 rounded">- _ space</code>). Stored at <code className="text-xs bg-muted px-1 rounded">b/n/&lt;be4 id&gt;</code>. Rejected if id already exists. Network starts <code className="text-xs bg-muted px-1 rounded">active = true</code>.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">SetNetworkActive {"{ id, active }"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-amber-400 border-amber-400/40">admin</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      Kill-switch for outbound traffic on a whole network. When <code className="text-xs bg-muted px-1 rounded">active = false</code>, all <code className="text-xs bg-muted px-1 rounded">BridgeOut</code> txs referencing assets on that network are rejected with a fee-only refund. <strong>Note:</strong> <code className="text-xs bg-muted px-1 rounded">BridgeIn</code> in <code className="text-xs bg-muted px-1 rounded">state.rs</code> only checks <em>asset</em>-level active flag, not network-level — so to fully pause a network in both directions, also call <code className="text-xs bg-muted px-1 rounded">SetAssetActive</code> for each of its assets.
                    </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">RegisterAsset {"{ network_id, native, contract, decimals }"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-amber-400 border-amber-400/40">admin</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Maps a Zebvix-native asset (<code className="text-xs bg-muted px-1 rounded">NativeAsset::{"{Zbx, Zusd}"}</code>) to a foreign-chain token. For ZVM kinds, <code className="text-xs bg-muted px-1 rounded">contract</code> must be 40 hex chars (the <code className="text-xs bg-muted px-1 rounded">0x</code> prefix is optional — the validator strips it before length/hex check). Allocates a fresh <code className="text-xs bg-muted px-1 rounded">asset_id = (network_id &lt;&lt; 32) | local_seq</code> — globally unique across networks.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">SetAssetActive {"{ asset_id, active }"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-amber-400 border-amber-400/40">admin</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Per-asset kill-switch (e.g. pause ZBX→BSC during a bug investigation while leaving zUSD→BSC live).
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">BridgeOut {"{ asset_id, dest_address }"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-emerald-400 border-emerald-400/40">user</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Locks <code className="text-xs bg-muted px-1 rounded">tx.body.amount</code> (wei for ZBX, micro for zUSD) into <code className="text-xs bg-muted px-1 rounded">BRIDGE_LOCK_ADDRESS</code> (<code className="text-xs bg-muted px-1 rounded">0x7a62726467…</code> = ASCII "zbrdg"), bumps <code className="text-xs bg-muted px-1 rounded">bridge_locked_zbx</code> / <code className="text-xs bg-muted px-1 rounded">_zusd</code> counter, and appends a <code className="text-xs bg-muted px-1 rounded">BridgeOutEvent</code> (seq++) to the 4096-cap ring. <code className="text-xs bg-muted px-1 rounded">dest_address</code> is validated per network kind (ZVM = 40 hex chars, optional <code className="text-xs bg-muted px-1 rounded">0x</code> prefix; ≤ 128 chars total).
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">BridgeIn {"{ asset_id, source_tx_hash, recipient, amount }"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-amber-400 border-amber-400/40">admin</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Releases <code className="text-xs bg-muted px-1 rounded">amount</code> from the lock vault back to <code className="text-xs bg-muted px-1 rounded">recipient</code>. <strong>Replay-protected:</strong> rejected if <code className="text-xs bg-muted px-1 rounded">b/c/&lt;source_tx_hash&gt;</code> marker already exists. Also rejected if locked balance &lt; release amount (under-collateralisation guard).
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Storage layout ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            Storage layout · <code className="text-xs bg-muted px-1.5 py-0.5 rounded">CF_META</code> key prefixes
          </CardTitle>
          <CardDescription>
            All bridge state lives in the <code className="text-xs bg-muted px-1 rounded">CF_META</code> column family under the <code className="text-xs bg-muted px-1 rounded">b/</code> prefix — no dedicated bridge column family. Big-endian encoding throughout for monotonic key ordering.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border border-border rounded-md overflow-hidden bg-card/40">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="text-foreground w-56">Key prefix</TableHead>
                  <TableHead className="text-foreground">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">b/n/&lt;be4 network_id&gt;</TableCell>
                  <TableCell className="text-sm text-muted-foreground">bincode(<code className="text-xs bg-muted px-1 rounded">BridgeNetwork {"{ id, name, kind, active, registered_height }"}</code>)</TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">b/a/&lt;be8 asset_id&gt;</TableCell>
                  <TableCell className="text-sm text-muted-foreground">bincode(<code className="text-xs bg-muted px-1 rounded">BridgeAsset {"{ asset_id, network_id, native, contract, decimals, active, registered_height }"}</code>)</TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">b/c/&lt;32B src_tx&gt;</TableCell>
                  <TableCell className="text-sm text-muted-foreground">1-byte marker — claim used (replay protection for <code className="text-xs bg-muted px-1 rounded">BridgeIn</code>).</TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">b/e/&lt;be8 seq&gt;</TableCell>
                  <TableCell className="text-sm text-muted-foreground">bincode(<code className="text-xs bg-muted px-1 rounded">BridgeOutEvent</code>) — capped at <code className="text-xs bg-muted px-1 rounded">MAX_OUT_EVENTS = 4096</code>; oldest evicted on append.</TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">b/m/seq</TableCell>
                  <TableCell className="text-sm text-muted-foreground">be8 — next outbound event sequence number (monotonic).</TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">b/m/lz</TableCell>
                  <TableCell className="text-sm text-muted-foreground">be16 (u128) — total ZBX wei currently locked across all networks.</TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">b/m/lu</TableCell>
                  <TableCell className="text-sm text-muted-foreground">be16 (u128) — total zUSD micro-units currently locked.</TableCell>
                </TableRow>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">b/m/aid/&lt;be4 net_id&gt;</TableCell>
                  <TableCell className="text-sm text-muted-foreground">be4 — next per-network local asset sequence (each network owns its own 32-bit id space).</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 text-xs text-muted-foreground space-y-1.5 leading-relaxed">
            <div>
              <strong className="text-foreground">Lock vault account.</strong>{" "}
              <code className="text-xs bg-muted px-1 rounded">BRIDGE_LOCK_ADDRESS_HEX = "0x7a62726467000000000000000000000000000000"</code>{" "}
              (<code className="text-xs bg-muted px-1 rounded">tokenomics.rs:198</code>) — derived from ASCII "zbrdg" + zero-padding, so anyone can derive it deterministically. Its <code className="text-xs bg-muted px-1 rounded">.balance</code> mirrors <code className="text-xs bg-muted px-1 rounded">b/m/lz</code> and <code className="text-xs bg-muted px-1 rounded">.zusd</code> mirrors <code className="text-xs bg-muted px-1 rounded">b/m/lu</code> at all times.
            </div>
            <div>
              <strong className="text-foreground">Asset id encoding.</strong>{" "}
              <code className="text-xs bg-muted px-1 rounded">asset_id = (network_id as u64) &lt;&lt; 32 | local_seq as u64</code>. Trivially reverse with <code className="text-xs bg-muted px-1 rounded">BridgeAsset::network_id_of(id)</code> / <code className="text-xs bg-muted px-1 rounded">::local_seq_of(id)</code>. Each network has its own independent 32-bit id space, so collisions across BSC / ETH / Polygon are impossible by construction.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── JSON-RPC table ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            Bridge JSON-RPC namespace · <code className="text-xs bg-muted px-1.5 py-0.5 rounded">zbx_*</code>
          </CardTitle>
          <CardDescription>
            All bridge reads are exposed via the native <code className="text-xs bg-muted px-1 rounded">zbx_*</code> namespace on port 8545 (rpc.rs). Off-chain oracles consume these; the dashboard&apos;s Live Chain page reads <code className="text-xs bg-muted px-1 rounded">zbx_bridgeStats</code> + <code className="text-xs bg-muted px-1 rounded">zbx_recentBridgeOutEvents</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border border-border rounded-md overflow-hidden bg-card/40">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="text-foreground w-64">Method</TableHead>
                  <TableHead className="text-foreground">Params · Returns</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_bridgeStats</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    No params. Returns <code className="text-xs bg-muted px-1 rounded">{"{ networks_count, assets_count, active_networks, active_assets, locked_zbx_wei (string), locked_zusd (string), out_events_total, claims_used, lock_address }"}</code>. The single high-level TVL view.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_listBridgeNetworks</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    No params. Returns <code className="text-xs bg-muted px-1 rounded">{"{ count, networks: [{ id, name, kind, active, registered_height }] }"}</code>.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_getBridgeNetwork</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Params: <code className="text-xs bg-muted px-1 rounded">[id: u32]</code>. Returns the single network or RPC error <code className="text-xs bg-muted px-1 rounded">-32004</code>.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_listBridgeAssets</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Params: <code className="text-xs bg-muted px-1 rounded">[network_id?: u32]</code> (optional filter). Returns <code className="text-xs bg-muted px-1 rounded">{"{ count, assets: [...] }"}</code>. Each asset includes <code className="text-xs bg-muted px-1 rounded">native</code> symbol, <code className="text-xs bg-muted px-1 rounded">native_decimals</code>, foreign <code className="text-xs bg-muted px-1 rounded">contract</code>, foreign-side <code className="text-xs bg-muted px-1 rounded">decimals</code>.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_getBridgeAsset</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Params: <code className="text-xs bg-muted px-1 rounded">[asset_id: u64-as-string-or-number]</code>. Returns the single asset or RPC error <code className="text-xs bg-muted px-1 rounded">-32004</code>.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_recentBridgeOutEvents</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Params: <code className="text-xs bg-muted px-1 rounded">[limit?: u64]</code> (default 50, capped at 500). Returns <code className="text-xs bg-muted px-1 rounded">{"{ returned, total, events: [{ seq, asset_id, native_symbol, from, dest_address, amount (string), height, tx_hash }] }"}</code>. <strong>This is the oracle&apos;s primary work-queue.</strong>
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zbx_isBridgeClaimUsed</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Params: <code className="text-xs bg-muted px-1 rounded">[source_tx_hash: 0x… 64 hex chars]</code>. Returns <code className="text-xs bg-muted px-1 rounded">{"{ source_tx_hash, claimed: bool }"}</code>. Oracle uses this for idempotency before submitting <code className="text-xs bg-muted px-1 rounded">BridgeIn</code>.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── CLI workflows ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            Operator workflows · <code className="text-xs bg-muted px-1.5 py-0.5 rounded">zebvix-node bridge-*</code>
          </CardTitle>
          <CardDescription>
            All bridge ops are reachable via flat CLI subcommands defined in <code className="text-xs bg-muted px-1 rounded">main.rs</code> (clap converts the <code className="text-xs bg-muted px-1 rounded">BridgeRegisterNetwork</code>, <code className="text-xs bg-muted px-1 rounded">BridgeOut</code>, … enum variants to kebab-case <code className="text-xs bg-muted px-1 rounded">bridge-register-network</code>, <code className="text-xs bg-muted px-1 rounded">bridge-out</code>, …). Admin-gated commands must be signed with the admin keyfile (queryable via <code className="text-xs bg-muted px-1 rounded">zbx_getAdmin</code>); user commands use any wallet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm font-semibold mb-2">1 · Admin: bootstrap registry (one-time per network)</div>
            <CodeBlock
              language="bash"
              code={`# Register BSC (chain-id 56) as a bridgeable ZVM destination
zebvix-node bridge-register-network \\
  --signer-key /root/admin.key \\
  --id 56 --name "BSC" --kind evm \\
  --rpc-url http://127.0.0.1:8545

# Map ZBX → BEP-20 wZBX contract on BSC (decimals match: 18)
zebvix-node bridge-register-asset \\
  --signer-key /root/admin.key \\
  --network-id 56 --native ZBX \\
  --contract 0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c --decimals 18 \\
  --rpc-url http://127.0.0.1:8545

# Map zUSD → ERC-20 zUSD (decimals=6 to match Zebvix-native zUSD)
zebvix-node bridge-register-asset \\
  --signer-key /root/admin.key \\
  --network-id 56 --native zUSD \\
  --contract 0x... --decimals 6 \\
  --rpc-url http://127.0.0.1:8545

# Verify
zebvix-node bridge-networks --rpc-url http://127.0.0.1:8545
zebvix-node bridge-assets   --rpc-url http://127.0.0.1:8545
zebvix-node bridge-stats    --rpc-url http://127.0.0.1:8545`}
            />
          </div>

          <div>
            <div className="text-sm font-semibold mb-2">2 · User: bridge ZBX out (Zebvix → BSC)</div>
            <CodeBlock
              language="bash"
              code={`# Lock 100 ZBX on Zebvix; oracle will mint 100 wZBX on BSC to your dest addr.
# asset_id 240518168576 = (56 << 32) | 0  ← first asset registered on BSC
zebvix-node bridge-out \\
  --signer-key /root/wallet.key \\
  --asset-id 240518168576 \\
  --dest 0xAabbccDDeeff0011223344556677889900aabbcc \\
  --amount "100" \\
  --rpc-url http://127.0.0.1:8545

# Logs on the validator:
#   🌉 bridge-out: seq=42 asset=240518168576 100000000000000000000 ZBX
#                  from 0x... → network 56 dest 0xAabb...bbcc

# The oracle then picks this up via:
curl -s http://127.0.0.1:8545 -d '{
  "jsonrpc":"2.0","id":1,"method":"zbx_recentBridgeOutEvents","params":[10]
}' | jq .result.events`}
            />
          </div>

          <div>
            <div className="text-sm font-semibold mb-2">3 · Admin / oracle: bridge ZBX in (BSC → Zebvix)</div>
            <CodeBlock
              language="bash"
              code={`# Foreign-side flow:
#   user transfers 50 wZBX → bridge vault on BSC, getting tx hash 0xDEADBEEF...
# Oracle observes that BSC tx, then submits BridgeIn to release native ZBX:

zebvix-node bridge-in \\
  --signer-key /root/admin.key \\
  --asset-id 240518168576 \\
  --source-tx-hash 0xDEADBEEFCAFEBABE0123456789abcdef0123456789abcdef0123456789abcdef \\
  --recipient 0x40907000...0c0315 \\
  --amount "50" \\
  --rpc-url http://127.0.0.1:8545

# Validator log:
#   🌉 bridge-in: asset=240518168576 50000000000000000000 ZBX → 0x4090... (src 0xdeadbeefcafebabe…)

# Try to replay the same source_tx_hash:
zebvix-node bridge-in --source-tx-hash 0xDEADBEEF... ...
# → "bridge-in: source tx 0xdeadbeef… already claimed (replay protection)"`}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Off-chain oracle responsibilities ─────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" />
            The off-chain oracle service (operator-supplied)
          </CardTitle>
          <CardDescription>
            The chain ships the on-chain primitive only. To go live with a usable bridge UX you must run a long-lived service that does the four steps below. There is no reference oracle in this repo today — write your own (Node, Rust, Python, …) or contract one out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock
            language="text"
            code={`Loop forever (every 5–10s):

(A) Outbound: Zebvix → Foreign chain
    1. last_seq = read from oracle's local KV
    2. resp = zbx_recentBridgeOutEvents(limit = 500)
    3. for event in resp.events where event.seq > last_seq:
         asset = zbx_getBridgeAsset(event.asset_id)
         scaled_amount = rescale(event.amount,
                                 from = native_decimals (ZBX=18, zUSD=6),
                                 to   = asset.decimals)            // foreign-side
         tx_hash = mint_wrapped_token_on_foreign_chain(
                     contract  = asset.contract,
                     recipient = event.dest_address,
                     amount    = scaled_amount)
         oracle's_local_KV[event.seq] = tx_hash
       last_seq = max(event.seq)

(B) Inbound: Foreign chain → Zebvix
    1. for evm_log in poll(foreign_vault_contract, "Deposit"):
         if zbx_isBridgeClaimUsed(evm_log.tx_hash).claimed:
             continue                                              // already credited
         scaled_amount = rescale(evm_log.amount,
                                 from = asset.decimals,            // foreign-side
                                 to   = native_decimals)            // ZBX=18, zUSD=6
         submit BridgeIn { asset_id, source_tx_hash = evm_log.tx_hash,
                           recipient = evm_log.zebvix_recipient,
                           amount    = scaled_amount }
         (the chain enforces the no-double-credit guard via b/c/<src_tx> marker)`}
          />
          <div className="mt-4 text-xs text-muted-foreground space-y-1.5 leading-relaxed">
            <div>
              <strong className="text-foreground">Why "every 5–10s, limit=500"?</strong> The on-chain ring buffer is{" "}
              <code className="text-xs bg-muted px-1 rounded">MAX_OUT_EVENTS = 4096</code>. At 5s blocks and a single bridge-out per block, the oldest evicts after ~5.7 hours. Polling at &lt; 1 hr intervals with limit ≥ 100 is comfortably safe. <strong>If the oracle goes down longer than the ring half-life, restart from{" "}
              <code className="text-xs bg-muted px-1 rounded">total - returned</code> + your local last-processed-seq; older missed events must be reconstructed from chain history (block scan).</strong>
            </div>
            <div>
              <strong className="text-foreground">Why a foreign vault contract on the inbound leg?</strong> Because the chain has no way to verify a foreign deposit on its own. The standard pattern is to deploy an admin-owned ERC-20 receiver contract on the foreign chain that emits a parseable <code className="text-xs bg-muted px-1 rounded">Deposit(zebvix_recipient, amount)</code> event. The oracle reads those events and submits the corresponding <code className="text-xs bg-muted px-1 rounded">BridgeIn</code>. The chain&apos;s only safety check on the admin&apos;s claim is: replay protection + locked-balance solvency.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Future hardening ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Future hardening (post-MVP)
          </CardTitle>
          <CardDescription>
            Phase B.12 deliberately ships the simplest possible primitive so the rest of the chain can integrate it. The trust model upgrades below are tracked but not yet wired.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>
              <strong className="text-foreground">Multisig oracle committee.</strong> Replace the single-admin gate on{" "}
              <code className="text-xs bg-muted px-1 rounded">BridgeIn</code> with an N-of-M signature aggregate (re-using the <code className="text-xs bg-muted px-1 rounded">multisig.rs</code> module that already exists for treasury ops). Eliminates single-key-compromise as a drain vector.
            </li>
            <li>
              <strong className="text-foreground">SPV / light-client proof.</strong> Replace admin signature on{" "}
              <code className="text-xs bg-muted px-1 rounded">BridgeIn</code> with an inclusion proof against the foreign chain&apos;s header chain (admin only signs the header batches). Eliminates the trusted-oracle layer entirely for inbound transfers.
            </li>
            <li>
              <strong className="text-foreground">Fee market on outbound.</strong> Per-asset bridge fee parameter (set via Phase D <code className="text-xs bg-muted px-1 rounded">ParamChange</code> proposal) so the oracle&apos;s gas costs on the foreign chain can be reimbursed from user volume rather than admin treasury.
            </li>
            <li>
              <strong className="text-foreground">Per-block bridge-out throttle.</strong> Cap how many <code className="text-xs bg-muted px-1 rounded">BridgeOut</code> tx can land per block to bound the ring-buffer eviction risk (not strictly needed at current chain volume, but cheap insurance).
            </li>
            <li>
              <strong className="text-foreground">ZVM-side <code className="text-xs bg-muted px-1 rounded">0x80</code> precompile wiring.</strong> The chain reserves precompile address <code className="text-xs bg-muted px-1 rounded">0x80</code> for in-ZVM bridge calls (Phase C.2 returns a deterministic preview value but does NOT commit the side-effect on <code className="text-xs bg-muted px-1 rounded">eth_sendRawTransaction</code> path). Wiring the post-frame intent capture so Solidity contracts can call <code className="text-xs bg-muted px-1 rounded">bridge_out(asset_id, dest)</code> natively is C.2 finishing work — see Smart Contracts (ZVM) page.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
