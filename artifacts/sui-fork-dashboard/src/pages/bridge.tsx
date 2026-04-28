import { useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { MobileConnectModal } from "@/components/wallet-connect/MobileConnectModal";
import { Smartphone } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Database,
  Workflow,
  ShieldCheck,
  Plug,
  Server,
  KeyRound,
  Network,
  ChevronDown,
  ChevronRight,
  BookOpen,
} from "lucide-react";
// Smartphone imported above
import UnifiedBridge from "@/components/bridge/UnifiedBridge";

export default function Bridge() {
  const [showDocs, setShowDocs] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Badge variant="outline" className="text-emerald-400 border-emerald-400/40">
            Phase B.12 · LIVE
          </Badge>
          <Badge variant="outline" className="text-primary border-primary/40">
            Lock-and-mint / Burn-and-release
          </Badge>
          <Badge variant="outline" className="text-amber-400 border-amber-400/40">
            Bidirectional · ZBX ↔ wZBX
          </Badge>
        </div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
            Cross-Chain Bridge
          </h1>
          <Button
            onClick={() => setMobileOpen(true)}
            variant="outline"
            className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
            data-testid="button-connect-mobile"
          >
            <Smartphone className="w-4 h-4 mr-2" />
            Connect Mobile Wallet
          </Button>
        </div>
        <MobileConnectModal open={mobileOpen} onClose={() => setMobileOpen(false)} />
        <p className="text-base text-muted-foreground max-w-3xl">
          Move ZBX between Zebvix L1 and BNB Smart Chain in either direction —
          all signed in this browser using your active wallet (no MetaMask
          required, since the same secp256k1 key works on both chains via
          ETH-standard address derivation). The relayer aggregates validator
          signatures off-chain and pays destination-side gas.
        </p>
      </div>

      {/* ── THE BRIDGE WIDGET ─────────────────────────────────── */}
      <UnifiedBridge />

      {/* ── Protocol details (collapsible) ───────────────────── */}
      <div>
        <Button
          variant="outline"
          onClick={() => setShowDocs((s) => !s)}
          className="w-full justify-between h-auto py-3"
        >
          <span className="inline-flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <span className="font-semibold">Protocol details</span>
            <span className="text-xs text-muted-foreground font-normal">
              architecture, on-chain ops, JSON-RPC, CLI, oracle service
            </span>
          </span>
          {showDocs ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </div>

      {showDocs && (
        <div className="space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
          {/* ── Trust-model callout ─────────────────────────────── */}
          <div className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/5 text-sm space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-400">
              <AlertTriangle className="h-4 w-4" /> Trust model &amp; current limitations (Phase B.12)
            </div>
            <ul className="list-disc list-inside text-muted-foreground space-y-1.5 pl-1">
              <li>
                <strong>Single oracle key, governance-bound (MVP).</strong> Today, one governor
                key (queryable via{" "}
                <code className="text-xs bg-muted px-1 rounded">zbx_getAdmin</code>) acts as the
                bridge oracle and is the only signer authorised to submit{" "}
                <code className="text-xs bg-muted px-1 rounded">RegisterNetwork</code>,{" "}
                <code className="text-xs bg-muted px-1 rounded">RegisterAsset</code>,{" "}
                <code className="text-xs bg-muted px-1 rounded">SetNetworkActive</code>,{" "}
                <code className="text-xs bg-muted px-1 rounded">SetAssetActive</code>, and{" "}
                <code className="text-xs bg-muted px-1 rounded">BridgeIn</code>. <strong>
                Compromise of that key would allow a full drain of the lock vault.</strong>{" "}
                The roadmap replaces this single signer with an M-of-N multisig oracle
                committee, then with an SPV / light-client inclusion proof so the chain
                verifies foreign deposits autonomously.
              </li>
              <li>
                <strong>No on-chain proof of foreign deposit (MVP).</strong> The chain currently
                trusts whatever{" "}
                <code className="text-xs bg-muted px-1 rounded">source_tx_hash</code> the
                governor submits — replay protection is the only on-chain safety rail (each
                32-byte hash can be claimed exactly once). SPV proof verification is the
                roadmap target that removes this trust assumption.
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

          {/* ── Architecture diagram ──────────────────────────── */}
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
║  USER                                              GOVERNOR (= oracle key, MVP)  ║
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
║   └─ emit   "bridge-out: seq=N..."                   └─ mark   claim used (b/c)  ║
║                                                                                  ║
╚════════════╤══════════════════════════════════════════════╤══════════════════════╝
             │                                              │
             │ zbx_recentBridgeOutEvents (poll)             │ zbx_isBridgeClaimUsed
             ▼                                              ▲ (idempotency check)
  ┌─────────────────────────────────────────────────────────────────────────┐
  │            OFF-CHAIN ORACLE SERVICE  (governor runs this — MVP)         │
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

          {/* ── BridgeOp variants ─────────────────────────────── */}
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
                      <TableCell><Badge variant="outline" className="text-amber-400 border-amber-400/40">governor</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Adds a foreign network to the registry. <code className="text-xs bg-muted px-1 rounded">id</code> is the foreign chain-id (56 = BSC, 1 = ETH, 137 = Polygon, …); <code className="text-xs bg-muted px-1 rounded">kind</code> ∈ {"{Evm, Other}"}; name validated (≤ 32 ASCII alnum + <code className="text-xs bg-muted px-1 rounded">- _ space</code>). Stored at <code className="text-xs bg-muted px-1 rounded">b/n/&lt;be4 id&gt;</code>. Rejected if id already exists. Network starts <code className="text-xs bg-muted px-1 rounded">active = true</code>.
                      </TableCell>
                    </TableRow>
                    <TableRow className="border-b border-border hover:bg-muted/30">
                      <TableCell className="font-mono text-xs">SetNetworkActive {"{ id, active }"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-amber-400 border-amber-400/40">governor</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Kill-switch for outbound traffic on a whole network. When <code className="text-xs bg-muted px-1 rounded">active = false</code>, all <code className="text-xs bg-muted px-1 rounded">BridgeOut</code> txs referencing assets on that network are rejected with a fee-only refund. <strong>Note:</strong> <code className="text-xs bg-muted px-1 rounded">BridgeIn</code> in <code className="text-xs bg-muted px-1 rounded">state.rs</code> only checks <em>asset</em>-level active flag, not network-level — so to fully pause a network in both directions, also call <code className="text-xs bg-muted px-1 rounded">SetAssetActive</code> for each of its assets.
                      </TableCell>
                    </TableRow>
                    <TableRow className="border-b border-border hover:bg-muted/30">
                      <TableCell className="font-mono text-xs">RegisterAsset {"{ network_id, native, contract, decimals }"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-amber-400 border-amber-400/40">governor</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Maps a Zebvix-native asset (<code className="text-xs bg-muted px-1 rounded">NativeAsset::{"{Zbx, Zusd}"}</code>) to a foreign-chain token. For ZVM kinds, <code className="text-xs bg-muted px-1 rounded">contract</code> must be 40 hex chars (the <code className="text-xs bg-muted px-1 rounded">0x</code> prefix is optional — the validator strips it before length/hex check). Allocates a fresh <code className="text-xs bg-muted px-1 rounded">asset_id = (network_id &lt;&lt; 32) | local_seq</code> — globally unique across networks.
                      </TableCell>
                    </TableRow>
                    <TableRow className="border-b border-border hover:bg-muted/30">
                      <TableCell className="font-mono text-xs">SetAssetActive {"{ asset_id, active }"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-amber-400 border-amber-400/40">governor</Badge></TableCell>
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
                      <TableCell><Badge variant="outline" className="text-amber-400 border-amber-400/40">governor</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Releases <code className="text-xs bg-muted px-1 rounded">amount</code> from the lock vault back to <code className="text-xs bg-muted px-1 rounded">recipient</code>. <strong>Replay-protected:</strong> rejected if <code className="text-xs bg-muted px-1 rounded">b/c/&lt;source_tx_hash&gt;</code> marker already exists. Also rejected if locked balance &lt; release amount (under-collateralisation guard).
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ── Storage layout ────────────────────────────────── */}
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

          {/* ── JSON-RPC table ────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="w-5 h-5 text-primary" />
                Bridge JSON-RPC namespace · <code className="text-xs bg-muted px-1.5 py-0.5 rounded">zbx_*</code>
              </CardTitle>
              <CardDescription>
                All bridge reads are exposed via the native <code className="text-xs bg-muted px-1 rounded">zbx_*</code> namespace on port 8545 (rpc.rs).
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
                        No params. Returns <code className="text-xs bg-muted px-1 rounded">{"{ networks_count, assets_count, active_networks, active_assets, locked_zbx_wei (string), locked_zusd (string), out_events_total, claims_used, lock_address }"}</code>.
                      </TableCell>
                    </TableRow>
                    <TableRow className="border-b border-border hover:bg-muted/30">
                      <TableCell className="font-mono text-xs">zbx_listBridgeNetworks</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        No params. Returns <code className="text-xs bg-muted px-1 rounded">{"{ count, networks: [...] }"}</code>.
                      </TableCell>
                    </TableRow>
                    <TableRow className="border-b border-border hover:bg-muted/30">
                      <TableCell className="font-mono text-xs">zbx_listBridgeAssets</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Params: <code className="text-xs bg-muted px-1 rounded">[network_id?: u32]</code>.
                      </TableCell>
                    </TableRow>
                    <TableRow className="border-b border-border hover:bg-muted/30">
                      <TableCell className="font-mono text-xs">zbx_recentBridgeOutEvents</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Params: <code className="text-xs bg-muted px-1 rounded">[limit?: u64]</code> (default 50, max 500). Oracle's primary work-queue.
                      </TableCell>
                    </TableRow>
                    <TableRow className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs">zbx_isBridgeClaimUsed</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Params: <code className="text-xs bg-muted px-1 rounded">[source_tx_hash]</code>. Idempotency check.
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ── CLI workflows ─────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                Operator workflows · <code className="text-xs bg-muted px-1.5 py-0.5 rounded">zebvix-node bridge-*</code>
              </CardTitle>
              <CardDescription>
                Governor-gated commands must be signed with the governor keyfile (queryable via <code className="text-xs bg-muted px-1 rounded">zbx_getAdmin</code> — name kept for RPC compatibility); user commands can use any wallet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm font-semibold mb-2">1 · Governor: bootstrap registry (one-time per network)</div>
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
  --contract 0xf7AA4bF2e80742411AD3AD3B8f70885E12C8dc09 --decimals 18 \\
  --rpc-url http://127.0.0.1:8545`}
                />
              </div>

              <div>
                <div className="text-sm font-semibold mb-2">2 · User: bridge ZBX out (Zebvix → BSC)</div>
                <CodeBlock
                  language="bash"
                  code={`# Lock 100 ZBX on Zebvix; relayer mints 100 wZBX on BSC to your dest addr.
# asset_id 240518168576 = (56 << 32) | 0  ← first asset registered on BSC
zebvix-node bridge-out \\
  --signer-key /root/wallet.key \\
  --asset-id 240518168576 \\
  --dest 0xAabbccDDeeff0011223344556677889900aabbcc \\
  --amount "100" \\
  --rpc-url http://127.0.0.1:8545`}
                />
              </div>

              <div>
                <div className="text-sm font-semibold mb-2">3 · Governor / oracle: bridge ZBX in (BSC → Zebvix)</div>
                <CodeBlock
                  language="bash"
                  code={`# Foreign-side flow:
#   user burns wZBX on BSC, getting tx hash 0x...
# Relayer observes that BSC tx, then submits BridgeIn to release native ZBX:

zebvix-node bridge-in \\
  --signer-key /root/admin.key \\
  --asset-id 240518168576 \\
  --source-tx-hash 0xDEADBEEF... \\
  --recipient 0x... \\
  --amount "50" \\
  --rpc-url http://127.0.0.1:8545`}
                />
              </div>
            </CardContent>
          </Card>

          {/* ── Off-chain oracle responsibilities ────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5 text-primary" />
                The off-chain relayer service
              </CardTitle>
              <CardDescription>
                The chain ships the on-chain primitive only. The relayer (lib/bridge-relayer) does the off-chain work.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CodeBlock
                language="text"
                code={`Loop forever (every 5–10s):

(A) Outbound: Zebvix → Foreign chain
    1. last_seq = read from relayer's local SQLite
    2. resp = zbx_recentBridgeOutEvents(limit = 500)
    3. for event in resp.events where event.seq > last_seq:
         asset = zbx_getBridgeAsset(event.asset_id)
         scaled_amount = rescale(event.amount,
                                 from = native_decimals (ZBX=18, zUSD=6),
                                 to   = asset.decimals)
         request signatures from each validator's signer service (M-of-N quorum)
         submit aggregated mintFromZebvix(req, sigs[]) to BSC bridge contract
         record event.seq → tx_hash in local KV

(B) Inbound: Foreign chain → Zebvix
    1. for evm_log in poll(BSC ZebvixBridge contract, "BurnToZebvix"):
         if zbx_isBridgeClaimUsed(evm_log.tx_hash).claimed:
             continue
         submit BridgeIn { asset_id, source_tx_hash = evm_log.tx_hash,
                           recipient = evm_log.zebvix_recipient,
                           amount    = evm_log.amount }
         (chain enforces no-double-credit via b/c/<src_tx> marker)`}
              />
            </CardContent>
          </Card>

          {/* ── Future hardening ──────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                Future hardening (post-MVP)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                <li>
                  <strong className="text-foreground">Multisig oracle committee.</strong> Replace the single-governor gate on{" "}
                  <code className="text-xs bg-muted px-1 rounded">BridgeIn</code> with an N-of-M signature aggregate.
                </li>
                <li>
                  <strong className="text-foreground">SPV / light-client proof.</strong> Replace the governor signature on{" "}
                  <code className="text-xs bg-muted px-1 rounded">BridgeIn</code> with an inclusion proof against the foreign chain&apos;s header chain.
                </li>
                <li>
                  <strong className="text-foreground">Fee market on outbound.</strong> Per-asset bridge fee parameter so the relayer&apos;s gas costs on the foreign chain can be reimbursed from user volume.
                </li>
                <li>
                  <strong className="text-foreground">Per-block bridge-out throttle.</strong> Cap how many <code className="text-xs bg-muted px-1 rounded">BridgeOut</code> tx can land per block to bound the ring-buffer eviction risk.
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
