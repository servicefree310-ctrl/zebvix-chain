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
  Network,
  Radio,
  Layers,
  Plug,
  Workflow,
  ShieldCheck,
  Server,
  Eye,
  AlertTriangle,
  Hash,
  Clock,
  Zap,
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

export default function NetworkPage() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-primary border-primary/40">
            P2P Layer
          </Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
            Live
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Network Configuration
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Zebvix runs a custom <strong>libp2p 0.54</strong> stack with TCP + Noise +
          Yamux, four chain-id–namespaced gossipsub topics, and a request-response
          block-sync protocol. This page documents the real wire protocol, ports,
          and CLI flags shipped in <code className="text-sm bg-muted px-1.5 py-0.5 rounded">zebvix-chain/src/p2p.rs</code>.
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={Network}
          label="Stack"
          value="libp2p 0.54"
          sub="TCP · Noise · Yamux"
        />
        <StatTile
          icon={Plug}
          label="P2P Port"
          value="30333"
          sub="TCP, --p2p-port (default)"
        />
        <StatTile
          icon={Radio}
          label="Gossipsub Topics"
          value="4"
          sub="blocks · txs · heartbeat · votes"
        />
        <StatTile
          icon={Workflow}
          label="Sync Batch"
          value="256"
          sub="blocks/req · 15s timeout"
        />
      </div>

      {/* Network stack */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            Network Stack
          </CardTitle>
          <CardDescription>
            Built deterministically inside{" "}
            <code className="text-xs bg-muted px-1 rounded">spawn_p2p()</code> in{" "}
            <code className="text-xs bg-muted px-1 rounded">p2p.rs</code>. Every node
            uses the same protocol identifiers — no version negotiation, no fallbacks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border border-border rounded-md overflow-hidden bg-card/40">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="text-foreground w-40">Layer</TableHead>
                  <TableHead className="text-foreground w-56">Implementation</TableHead>
                  <TableHead className="text-foreground">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">Transport</TableCell>
                  <TableCell className="font-mono text-xs">tcp::Config + nodelay</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Plain TCP on the configured <code className="text-xs bg-muted px-1 rounded">--p2p-port</code> (default 30333). No QUIC, no WebSockets.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">Encryption</TableCell>
                  <TableCell className="font-mono text-xs">noise::Config (XX)</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Noise XX handshake. Mandatory — no plaintext peers.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">Multiplexer</TableCell>
                  <TableCell className="font-mono text-xs">yamux::Config</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    All sub-protocols (gossipsub, sync) share one TCP connection per peer.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">Identity</TableCell>
                  <TableCell className="font-mono text-xs">ed25519 (libp2p auto)</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    libp2p generates a fresh ed25519 keypair per node start (<code className="text-xs bg-muted px-1 rounded">SwarmBuilder::with_new_identity</code>). The resulting <strong>peer-id</strong> is shown in startup logs and prefixed <code className="text-xs bg-muted px-1 rounded">12D3KooW…</code>. <em>This is independent of the secp256k1 validator key</em> — chain identity ≠ network identity.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">Pub-sub</TableCell>
                  <TableCell className="font-mono text-xs">gossipsub::Behaviour</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Heartbeat interval 2 s, <code className="text-xs bg-muted px-1 rounded">ValidationMode::Strict</code> (every published msg must be signed by its source peer-id), 1 MiB max transmit size, <code className="text-xs bg-muted px-1 rounded">DefaultHasher</code> message-id for dedupe.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">Discovery</TableCell>
                  <TableCell className="font-mono text-xs">mdns::tokio::Behaviour</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Multicast DNS for same-LAN auto-discovery. Disable with <code className="text-xs bg-muted px-1 rounded">--no-mdns</code> on production VPS (no benefit across the public internet).
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">Sync</TableCell>
                  <TableCell className="font-mono text-xs">request_response::cbor</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Protocol id <code className="text-xs bg-muted px-1 rounded">/zebvix/sync/1.0.0</code>. CBOR-encoded <code className="text-xs bg-muted px-1 rounded">SyncReq&#123; from, to &#125;</code> → <code className="text-xs bg-muted px-1 rounded">SyncResp&#123; blocks &#125;</code>. 15 s timeout per request.
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-semibold text-primary">Idle timeout</TableCell>
                  <TableCell className="font-mono text-xs">60 s</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Idle connections are dropped after 60 s; they re-handshake on the next gossip event or sync request.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Topics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-primary" />
            Gossipsub Topics
          </CardTitle>
          <CardDescription>
            All topics are namespaced by chain-id <code className="text-xs bg-muted px-1 rounded">7878</code> so a fork or testnet on a different chain-id will silently ignore Zebvix mainnet traffic and vice-versa. Topic strings are constructed in{" "}
            <code className="text-xs bg-muted px-1 rounded">topic_blocks() / topic_txs() / topic_heartbeat() / topic_votes()</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border border-border rounded-md overflow-hidden bg-card/40">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="text-foreground">Topic</TableHead>
                  <TableHead className="text-foreground w-44">Payload</TableHead>
                  <TableHead className="text-foreground w-40">Cadence</TableHead>
                  <TableHead className="text-foreground">Purpose</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zebvix/7878/blocks/v1</TableCell>
                  <TableCell className="font-mono text-xs">bincode(Block)</TableCell>
                  <TableCell className="text-sm">~ every 5 s</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Producer broadcasts every block it mints. Followers also re-gossip on apply (gossipsub mesh forwards). Out-of-order arrivals (height &gt; tip+1) trigger a sync request.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zebvix/7878/txs/v1</TableCell>
                  <TableCell className="font-mono text-xs">bincode(SignedTx)</TableCell>
                  <TableCell className="text-sm">on submit</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <code className="text-xs bg-muted px-1 rounded">zbx_sendTransaction</code> immediately gossips the tx so every mempool sees it before the next block — clients don't have to send to the producer directly.
                  </TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zebvix/7878/heartbeat/v1</TableCell>
                  <TableCell className="font-mono text-xs">bincode(&#123; tip:u64 &#125;)</TableCell>
                  <TableCell className="text-sm">every 8 s</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Each node announces its current tip height. If a peer's tip exceeds ours, we open a sync request for the gap — this is the primary catch-up trigger after restarts.
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">zebvix/7878/votes/v1</TableCell>
                  <TableCell className="font-mono text-xs">bincode(Vote)</TableCell>
                  <TableCell className="text-sm">2 / new block</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <strong>Live</strong> — every registered validator auto-signs a{" "}
                    <code className="text-xs bg-muted px-1 rounded">Prevote</code> and a{" "}
                    <code className="text-xs bg-muted px-1 rounded">Precommit</code> for each new tip and gossips both into the shared <code className="text-xs bg-muted px-1 rounded">VotePool</code>. Currently observational (drives <code className="text-xs bg-muted px-1 rounded">zbx_voteStats</code> for monitoring); a future release will use these to drive actual finalization in multi-proposer consensus.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Sync protocol */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="w-5 h-5 text-primary" />
            Block-Sync Protocol
          </CardTitle>
          <CardDescription>
            request-response with CBOR codec — used for catch-up after downtime,
            late-joining nodes, and out-of-order block recovery. Triggered automatically;
            no operator action required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-border rounded-lg p-4 bg-card/40">
              <div className="font-semibold text-sm text-primary mb-2">SyncReq</div>
              <CodeBlock
                language="rust"
                code={`struct SyncReq {
    from: u64,
    to:   u64,   // capped at from + 255
}`}
              />
            </div>
            <div className="border border-border rounded-lg p-4 bg-card/40">
              <div className="font-semibold text-sm text-primary mb-2">SyncResp</div>
              <CodeBlock
                language="rust"
                code={`struct SyncResp {
    // ascending height order, may be partial / empty
    blocks: Vec<Vec<u8>>, // bincode(Block)
}`}
              />
            </div>
          </div>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong className="text-foreground">Trigger 1 — out-of-order gossip:</strong> we receive a block with{" "}
              <code className="text-xs bg-muted px-1 rounded">height &gt; tip + 1</code>. We send a SyncReq for{" "}
              <code className="text-xs bg-muted px-1 rounded">[tip+1 .. height-1]</code> to the propagation source.
            </p>
            <p>
              <strong className="text-foreground">Trigger 2 — heartbeat lag:</strong> a peer's heartbeat reports{" "}
              <code className="text-xs bg-muted px-1 rounded">tip &gt; ours</code>. We send a SyncReq for the gap.
            </p>
            <p>
              <strong className="text-foreground">Constraints:</strong> <code className="text-xs bg-muted px-1 rounded">SYNC_BATCH_MAX = 256</code> blocks per request,{" "}
              15 s timeout, one in-flight request per peer (tracked in{" "}
              <code className="text-xs bg-muted px-1 rounded">syncing_with: HashSet&lt;PeerId&gt;</code>). Responses are
              fed back into the inbound channel so blocks are applied sequentially by the
              main consumer.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Node roles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" />
            Node Roles
          </CardTitle>
          <CardDescription>
            Three real run-modes shipped today. Role is decided purely by CLI flags
            on <code className="text-xs bg-muted px-1 rounded">zebvix-node start</code> — there is no separate binary.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="border border-emerald-500/30 rounded-lg p-4 bg-emerald-500/5">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
                  Founder Validator
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                The single bootstrap block-producer (deterministic key from{" "}
                <code className="text-xs bg-muted px-1 rounded">FOUNDER_PUBKEY_HEX</code>).
                Mines every 5 sec, broadcasts on <code className="text-xs bg-muted px-1 rounded">blocks/v1</code>.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                <li><strong>Recommended hardening:</strong> override the default <code className="text-xs bg-muted px-0.5 rounded">--rpc 0.0.0.0:8545</code> to <code className="text-xs bg-muted px-0.5 rounded">127.0.0.1:8545</code></li>
                <li>P2P public on tcp/30333</li>
                <li>Backups + monitoring required</li>
              </ul>
            </div>
            <div className="border border-blue-500/30 rounded-lg p-4 bg-blue-500/5">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40">
                  Follower
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Started with <code className="text-xs bg-muted px-1 rounded">--follower</code>.
                Receives blocks via P2P, applies them, but never produces. Used for
                redundancy + sync source for new joiners.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                <li>Same disk + RocksDB layout as validator</li>
                <li>Local key irrelevant for consensus</li>
                <li>Multi-proposer mode arrives in a future release</li>
              </ul>
            </div>
            <div className="border border-amber-500/30 rounded-lg p-4 bg-amber-500/5">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40">
                  Public RPC
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                A follower whose JSON-RPC is exposed to the internet for wallets,
                explorers, and dApps. Started with{" "}
                <code className="text-xs bg-muted px-1 rounded">--rpc 0.0.0.0:8545</code> (or behind nginx + TLS).
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                <li>Add reverse proxy + rate-limit</li>
                <li>Disable mDNS (<code className="text-xs bg-muted px-0.5 rounded">--no-mdns</code>)</li>
                <li>Never holds the founder key</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ports + firewall */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Ports &amp; Firewall
          </CardTitle>
          <CardDescription>
            Real ports used by the binary today. Anything not listed here is{" "}
            <em>not</em> opened by Zebvix — there is no separate WebSocket port, no
            metrics port, no admin port.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border border-border rounded-md overflow-hidden bg-card/40">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="text-foreground w-28">Port</TableHead>
                  <TableHead className="text-foreground w-24">Proto</TableHead>
                  <TableHead className="text-foreground">Service</TableHead>
                  <TableHead className="text-foreground">Validator</TableHead>
                  <TableHead className="text-foreground">Public RPC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono">30333</TableCell>
                  <TableCell className="font-mono text-xs">TCP</TableCell>
                  <TableCell>libp2p (gossipsub + sync)</TableCell>
                  <TableCell className="text-emerald-400">Open · public</TableCell>
                  <TableCell className="text-emerald-400">Open · public</TableCell>
                </TableRow>
                <TableRow className="border-b border-border hover:bg-muted/30">
                  <TableCell className="font-mono">8545</TableCell>
                  <TableCell className="font-mono text-xs">TCP</TableCell>
                  <TableCell>JSON-RPC (Ethereum + zbx_*)</TableCell>
                  <TableCell className="text-rose-400">Loopback (override default 0.0.0.0)</TableCell>
                  <TableCell className="text-amber-400">0.0.0.0 (default) behind nginx + TLS</TableCell>
                </TableRow>
                <TableRow className="hover:bg-muted/30">
                  <TableCell className="font-mono">5353</TableCell>
                  <TableCell className="font-mono text-xs">UDP</TableCell>
                  <TableCell>mDNS (LAN discovery)</TableCell>
                  <TableCell className="text-muted-foreground">LAN only · disable on VPS</TableCell>
                  <TableCell className="text-muted-foreground">LAN only · disable on VPS</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 border-l-4 border-l-amber-500/50 bg-amber-500/5 p-3 rounded text-xs text-muted-foreground flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <span>
              On the founder VPS (srv1266996, 93.127.213.192) the JSON-RPC{" "}
              <strong>must</strong> stay on <code className="text-xs bg-muted px-1 rounded">127.0.0.1:8545</code> — exposing it publicly leaks the producer's identity and lets attackers fingerprint mempool. Use a separate public-RPC node for client traffic.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Start commands */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Start-Command Recipes
          </CardTitle>
          <CardDescription>
            Real argument shapes from <code className="text-xs bg-muted px-1 rounded">main.rs::Commands::Start</code>. Defaults shown for clarity — omit them in production systemd units.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
                Founder Validator
              </Badge>
              <span className="text-xs text-muted-foreground">srv1266996 · production</span>
            </div>
            <CodeBlock
              language="bash"
              code={`zebvix-node start \\
    --home /root/.zebvix \\
    --rpc 127.0.0.1:8545 \\
    --p2p-port 30333 \\
    --no-mdns`}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40">
                Follower
              </Badge>
              <span className="text-xs text-muted-foreground">joins via founder multiaddr</span>
            </div>
            <CodeBlock
              language="bash"
              code={`zebvix-node start \\
    --home /root/.zebvix \\
    --rpc 127.0.0.1:8545 \\
    --p2p-port 30333 \\
    --follower \\
    --no-mdns \\
    --peer /ip4/93.127.213.192/tcp/30333/p2p/<FOUNDER_PEER_ID>`}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40">
                Public RPC
              </Badge>
              <span className="text-xs text-muted-foreground">put nginx + TLS in front of 8545</span>
            </div>
            <CodeBlock
              language="bash"
              code={`zebvix-node start \\
    --home /root/.zebvix \\
    --rpc 0.0.0.0:8545 \\
    --p2p-port 30333 \\
    --follower \\
    --no-mdns \\
    --peer /ip4/93.127.213.192/tcp/30333/p2p/<FOUNDER_PEER_ID>`}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-muted-foreground border-muted">
                Single-node (legacy / dev)
              </Badge>
            </div>
            <CodeBlock
              language="bash"
              code={`zebvix-node start \\
    --home ./.zebvix \\
    --rpc 127.0.0.1:8545 \\
    --no-p2p`}
            />
            <p className="text-xs text-muted-foreground">
              <code className="text-xs bg-muted px-1 rounded">--no-p2p</code> skips
              the swarm entirely — useful for local replays and unit tests, never for
              the live chain.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Multiaddr + peer-id */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="w-5 h-5 text-primary" />
            Multiaddr Format &amp; Finding the Peer-ID
          </CardTitle>
          <CardDescription>
            Bootstrap peers passed via <code className="text-xs bg-muted px-1 rounded">--peer</code> use the standard
            libp2p multiaddr — NOT a URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CodeBlock
            language="text"
            code={`/ip4/<ipv4>/tcp/<port>/p2p/<peer_id>

example:
/ip4/93.127.213.192/tcp/30333/p2p/12D3KooWGn8XyAbCdEf...QwR`}
          />
          <p className="text-sm text-muted-foreground">
            The peer-id is logged on every node start. Grep the journal for the{" "}
            <code className="text-xs bg-muted px-1 rounded">🌐 p2p listening</code>{" "}
            line:
          </p>
          <CodeBlock
            language="bash"
            code={`# On the founder VPS:
journalctl -u zebvix-node --no-pager | grep '🌐 p2p listening' | tail -1

# Sample output:
# 🌐 p2p listening on /ip4/0.0.0.0/tcp/30333/p2p/12D3KooW...

# Replace 0.0.0.0 with the public IP and share that whole multiaddr
# with anyone who wants to peer.`}
          />
          <div className="border-l-4 border-l-amber-500/50 bg-amber-500/5 p-3 rounded text-xs text-muted-foreground flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <span>
              The peer-id comes from a fresh ed25519 keypair generated by{" "}
              <code className="text-xs bg-muted px-1 rounded">SwarmBuilder::with_new_identity()</code>{" "}
              <strong>on every node start</strong> — restart the systemd unit and the
              peer-id rotates. Operators who need a stable identity (e.g. for hard-coded
              bootstrap multiaddrs) must pin one via{" "}
              <code className="text-xs bg-muted px-1 rounded">with_existing_identity</code> backed by a key file on disk;
              that's on the operator hardening roadmap.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Verify */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-primary" />
            Verify the Network is Healthy
          </CardTitle>
          <CardDescription>
            Three log lines + one RPC call confirm gossip is flowing and the node is
            in sync.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Log signatures to grep for (default <code className="text-xs bg-muted px-1 rounded">RUST_LOG=zebvix_node=info</code>)
            </div>
            <CodeBlock
              language="bash"
              code={`journalctl -u zebvix-node -f | grep -E '🌐|🔗|✅ p2p|📦 p2p|⏬'

# 🌐 p2p listening on /ip4/.../tcp/30333/p2p/12D3KooW...    ← stack came up
# 🔗 p2p dialing /ip4/.../tcp/30333/p2p/12D3KooW...          ← bootstrap dial
# ✅ p2p connected: 12D3KooW...                              ← peer handshake OK
# 📦 p2p applied block #6042 (3 txs)                         ← state updated
# ⏬ heartbeat: 12D3KooW... tip=6100 (we=6042); requesting [6043..=6100]
#                                                             ← catch-up triggered`}
            />
            <p className="text-xs text-muted-foreground mt-2">
              For deeper visibility (every gossip arrival — individual tx / vote / block receipts logged as <code className="text-xs bg-muted px-1 rounded">📥 p2p &lt;kind&gt; from &lt;peer&gt;</code>{" "}
              and outbound publishes as <code className="text-xs bg-muted px-1 rounded">📤 p2p published</code>) raise the filter:
            </p>
            <CodeBlock
              language="bash"
              code={`# One-off:
RUST_LOG=zebvix_node=debug zebvix-node start ...

# Permanent in systemd unit:
# Environment="RUST_LOG=zebvix_node=debug"`}
            />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground mb-2">
              Tip-height check (RPC)
            </div>
            <CodeBlock
              language="bash"
              code={`# Compare two peers — heights should match within 1-2 blocks at most.
for host in 127.0.0.1 93.127.213.192; do
  echo -n "$host  tip = "
  curl -s -X POST http://$host:8545 -H 'Content-Type: application/json' \\
       --data '{"jsonrpc":"2.0","id":1,"method":"zbx_blockNumber","params":[]}' \\
    | jq -r .result
done`}
            />
          </div>
          <div className="text-xs text-muted-foreground italic">
            If a follower's tip stays stuck while the founder advances, check (1) the{" "}
            <code className="text-xs bg-muted px-1 rounded">--peer</code> multiaddr
            is reachable (<code className="text-xs bg-muted px-1 rounded">nc -zv 93.127.213.192 30333</code>),
            (2) outbound TCP/30333 isn't egress-blocked, and (3) chain-id matches —
            mismatched chain-ids subscribe to different gossipsub topic strings and
            silently never see each other.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
