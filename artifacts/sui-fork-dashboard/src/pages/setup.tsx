import React from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server, Cpu, HardDrive, Network, ShieldCheck, Terminal, Package, Wrench, Download, Boxes, Zap, AlertTriangle, CheckCircle2 } from "lucide-react";

function StatRow({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      <Icon className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-sm font-mono font-semibold text-foreground">{value}</span>
        </div>
        {hint && <p className="text-xs text-muted-foreground/80 mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card className="border-l-4 border-l-primary/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
            {n}
          </div>
          <CardTitle className="text-lg">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export default function Setup() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Badge variant="outline" className="border-primary/40 text-primary">Operator Guide</Badge>
          <Badge variant="outline" className="text-muted-foreground">Live</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">
          Environment Setup
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Prepare a Linux server to build, run, and operate a Zebvix L1 node. Zebvix is a
          self-contained Rust codebase — there is no upstream chain to fork and no SDK to import.
          You pull the source tarball, compile one binary, and run it under <code className="text-xs bg-muted px-1.5 py-0.5 rounded">systemd</code>.
        </p>
      </div>

      {/* Quick facts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
              <Boxes className="w-3.5 h-3.5" /> Codebase
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-foreground">zebvix-node</div>
            <p className="text-xs text-muted-foreground mt-1">Single Rust binary · ~2 MB stripped · Edition 2021 · MIT</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
              <Network className="w-3.5 h-3.5" /> Network
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-foreground">chain_id 7878</div>
            <p className="text-xs text-muted-foreground mt-1">JSON-RPC :8545 · libp2p gossip :30333 · secp256k1 keys</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
              <Zap className="w-3.5 h-3.5" /> Build time
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-foreground">~90 sec</div>
            <p className="text-xs text-muted-foreground mt-1">Release build on a 4 vCPU VPS · ~150 MB target dir</p>
          </CardContent>
        </Card>
      </div>

      {/* Hardware & OS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="w-4 h-4 text-primary" /> Hardware (Validator / Full Node)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatRow icon={Cpu} label="CPU" value="4 vCPU" hint="2 vCPU acceptable for follower nodes" />
            <StatRow icon={HardDrive} label="RAM" value="8 GB" hint="4 GB minimum for follower; 16 GB recommended for archive" />
            <StatRow icon={HardDrive} label="Storage" value="100 GB SSD" hint="NVMe preferred; ~120 KB per block at full load" />
            <StatRow icon={Network} label="Bandwidth" value="100 Mbps · static IP" hint="Inbound 8545 (RPC) + 30333 (P2P) must be open" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="w-4 h-4 text-primary" /> Operating System
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatRow icon={CheckCircle2} label="Ubuntu" value="22.04 / 24.04 LTS" hint="Reference platform — VPS srv1266996 runs 24.04" />
            <StatRow icon={CheckCircle2} label="Debian" value="12 (bookworm)" hint="Tested working" />
            <StatRow icon={CheckCircle2} label="Other glibc Linux" value="kernel ≥ 5.15" hint="RHEL/Fedora/Arch — adapt apt commands to your package manager" />
            <StatRow icon={AlertTriangle} label="Not supported" value="Alpine / musl" hint="rocksdb + secp256k1 expect glibc; cross-compile only" />
          </CardContent>
        </Card>
      </div>

      {/* Steps */}
      <div className="space-y-5">
        <h2 className="text-2xl font-bold text-foreground">Step-by-step</h2>

        <Step n={1} title="Install the Rust toolchain">
          <p className="text-sm text-muted-foreground">
            Zebvix is pinned to <strong>edition 2021</strong> and uses any recent stable Rust
            (1.75+ is known good — current stable channel works fine). Install via <code className="text-xs bg-muted px-1 rounded">rustup</code> so updates are painless.
          </p>
          <CodeBlock
            language="bash"
            code={`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup default stable
rustup update
rustc --version    # expect: rustc 1.7x.y (stable)`}
          />
        </Step>

        <Step n={2} title="Install system dependencies">
          <p className="text-sm text-muted-foreground">
            These are the actual native libraries Zebvix's dependency tree needs at link time.
            <code className="text-xs bg-muted px-1 rounded">libclang</code> is mandatory because{" "}
            <code className="text-xs bg-muted px-1 rounded">rocksdb</code>'s build script uses bindgen to generate C++ bindings.
          </p>
          <CodeBlock
            language="bash"
            code={`# Ubuntu / Debian
sudo apt-get update
sudo apt-get install -y \\
    build-essential pkg-config cmake git curl ca-certificates \\
    libssl-dev libclang-dev clang llvm-dev \\
    libsnappy-dev liblz4-dev zlib1g-dev libzstd-dev`}
          />
          <div className="text-xs text-muted-foreground space-y-1 pt-1">
            <p><strong className="text-foreground">Why each one:</strong></p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li><code className="bg-muted px-1 rounded">libssl-dev</code> — TLS for outbound HTTPS (telemetry, etc.)</li>
              <li><code className="bg-muted px-1 rounded">libclang-dev / clang / llvm-dev</code> — rocksdb bindgen</li>
              <li><code className="bg-muted px-1 rounded">cmake</code> — secp256k1 / libp2p native sub-builds</li>
              <li><code className="bg-muted px-1 rounded">libsnappy / liblz4 / zlib / zstd</code> — rocksdb compression backends (Zebvix enables <code className="bg-muted px-1 rounded">lz4</code>)</li>
            </ul>
          </div>
        </Step>

        <Step n={3} title="Get the Zebvix source">
          <p className="text-sm text-muted-foreground">
            Zebvix does <strong>not</strong> live on a public Git remote yet — the source ships as a
            tarball from the dashboard's download endpoint. This is the same artifact used to deploy
            VPS <code className="text-xs bg-muted px-1 rounded">srv1266996</code>.
          </p>
          <CodeBlock
            language="bash"
            code={`# Pick a working directory
sudo mkdir -p /home/zebvix-chain
sudo chown $USER:$USER /home/zebvix-chain
cd /home/zebvix-chain

# Pull the latest source bundle
DASH_URL="https://7f6c353a-ec2a-4fe7-81e1-631c9fb77a3e-00-1a0ca41r86kcx.worf.replit.dev"
curl -fsSL "$DASH_URL/api/download/newchain" -o newchain.tgz
ls -la newchain.tgz       # ~190 KB

# Extract in place (overwrites src/ + Cargo.toml — safe; no DB/keys touched)
tar -xzf newchain.tgz
rm newchain.tgz

# Sanity check
head -3 Cargo.toml        # expect: name = "zebvix-node"`}
          />
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90 flex gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Backup before re-extract:</strong> always snapshot the existing <code className="bg-amber-950/40 px-1 rounded">src/</code> + <code className="bg-amber-950/40 px-1 rounded">Cargo.toml</code> to <code className="bg-amber-950/40 px-1 rounded">.backups/</code> before pulling a new tarball, so a bad release can be rolled back instantly. The on-disk DB at <code className="bg-amber-950/40 px-1 rounded">~/.zebvix/</code> is untouched by source updates.
            </span>
          </div>
        </Step>

        <Step n={4} title="Compile the node binary">
          <p className="text-sm text-muted-foreground">
            One <code className="text-xs bg-muted px-1 rounded">cargo build</code> produces a single
            self-contained binary. The first build downloads ~250 crates and takes 6–10 minutes;
            incremental rebuilds after a source update finish in under 2 minutes.
          </p>
          <CodeBlock
            language="bash"
            code={`# Default build (consensus + state + RPC + P2P + zSwap AMM + governance)
cargo build --release

# OR: build with the native ZVM enabled (Cancun-fork interpreter + eth_* RPC
# + Zebvix precompiles 0x80-0x83). Production VPS uses this profile.
cargo build --release --features zvm

# Output:
ls -lh target/release/zebvix-node
./target/release/zebvix-node --version`}
          />
        </Step>

        <Step n={5} title="Symlink the binary system-wide">
          <p className="text-sm text-muted-foreground">
            Put <code className="text-xs bg-muted px-1 rounded">zebvix-node</code> on{" "}
            <code className="text-xs bg-muted px-1 rounded">$PATH</code> so the systemd unit and
            CLI helpers don't need an absolute path inside the build directory.
          </p>
          <CodeBlock
            language="bash"
            code={`sudo ln -sfn /home/zebvix-chain/target/release/zebvix-node /usr/local/bin/zebvix-node
which zebvix-node           # /usr/local/bin/zebvix-node
zebvix-node --help | head -20`}
          />
        </Step>

        <Step n={6} title="Generate a key and initialize the node home">
          <p className="text-sm text-muted-foreground">
            Initialization is a two-step CLI flow. First generate a secp256k1 keypair to a file,
            then point <code className="text-xs bg-muted px-1 rounded">init</code> at that file —
            the address derived from the key becomes this node's identity (and, if it is later
            registered through governance, its proposer address).
          </p>
          <CodeBlock
            language="bash"
            code={`# 6a. Generate a secp256k1 keypair to disk
sudo mkdir -p /root/.zebvix
zebvix-node keygen --out /root/.zebvix/validator.key
# Address    : 0xab12...   <- node identity
# Public Key : 0x04...
# Saved key  : /root/.zebvix/validator.key

sudo chmod 600 /root/.zebvix/validator.key   # owner read/write only

# 6b. Initialize the chain home (writes genesis.json + node.json + data/)
zebvix-node init \\
    --home /root/.zebvix \\
    --validator-key /root/.zebvix/validator.key

# Output you should see:
# ✅ Initialized Zebvix chain at /root/.zebvix
#    chain_id          : 7878
#    validator address : 0xab12...
#    genesis           : /root/.zebvix/genesis.json
#    data dir          : /root/.zebvix/data

ls /root/.zebvix
# data/   genesis.json   node.json   validator.key`}
          />
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              <strong className="text-foreground">Founder vs follower:</strong> the very first node
              of the network bootstraps as the founder validator and (by default) receives the
              9,990,000 ZBX Foundation pre-mine into its address — pass{" "}
              <code className="bg-muted px-1 rounded">--no-default-premine</code> on subsequent
              nodes (or just align their <code className="bg-muted px-1 rounded">genesis.json</code>{" "}
              with the founder's). Joining an existing chain means copying the founder's{" "}
              <code className="bg-muted px-1 rounded">genesis.json</code> into your{" "}
              <code className="bg-muted px-1 rounded">--home</code> after running{" "}
              <code className="bg-muted px-1 rounded">init</code>; new validators are then activated
              through the two-tier governance flow on the Validator Setup page.
            </p>
            <p>
              <strong className="text-foreground">Back up the key:</strong>{" "}
              <code className="bg-muted px-1 rounded">/root/.zebvix/validator.key</code> is the only
              copy — losing it means losing this node's identity and (for validators) the slot
              plus any pending rewards. Store an encrypted copy offline before going further.
            </p>
          </div>
        </Step>

        <Step n={7} title="Install the systemd unit">
          <p className="text-sm text-muted-foreground">
            Run the node as a managed service so it survives reboots, restarts on crash, and writes
            logs to the journal. This is the exact unit running on{" "}
            <code className="text-xs bg-muted px-1 rounded">srv1266996</code> today.
          </p>
          <CodeBlock
            language="ini"
            code={`# /etc/systemd/system/zebvix.service
[Unit]
Description=Zebvix L1 Blockchain Node
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/zebvix-chain
ExecStart=/usr/local/bin/zebvix-node start \\
    --home /root/.zebvix \\
    --rpc 0.0.0.0:8545 \\
    --p2p-port 30333 \\
    --no-mdns
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target`}
          />
          <p className="text-xs text-muted-foreground">
            This is the unit deployed on{" "}
            <code className="bg-muted px-1 rounded">srv1266996</code> verbatim. Optional hardening
            you can add: <code className="bg-muted px-1 rounded">LimitNOFILE=65536</code> (raise the
            file-descriptor cap if you're aggregating many P2P peers) and{" "}
            <code className="bg-muted px-1 rounded">Environment=RUST_LOG=info,zebvix_node=debug</code>{" "}
            (more verbose logs while debugging — drop back to <code className="bg-muted px-1 rounded">info</code> in steady state).
          </p>
          <CodeBlock
            language="bash"
            code={`sudo systemctl daemon-reload
sudo systemctl enable --now zebvix.service
sudo systemctl status zebvix.service --no-pager
journalctl -u zebvix.service -f -n 50      # live logs`}
          />
        </Step>

        <Step n={8} title="Pick a node profile and open the firewall">
          <p className="text-sm text-muted-foreground">
            Decide whether this box is a <strong>validator</strong> (consensus, never expose RPC to
            the world) or a <strong>public RPC node</strong> (serves wallets and dapps). The
            firewall + <code className="text-xs bg-muted px-1 rounded">--rpc</code> bind address
            differ.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">Validator profile (locked-down)</span>
              </div>
              <CodeBlock
                language="bash"
                code={`# In the unit, change ExecStart's --rpc to:
#   --rpc 127.0.0.1:8545
# Then only open the P2P port.
sudo ufw allow 30333/tcp comment 'Zebvix libp2p gossip'
sudo ufw deny  8545/tcp
sudo ufw status numbered`}
              />
              <p className="text-xs text-muted-foreground mt-2">
                RPC reachable only from <code className="bg-muted px-1 rounded">localhost</code> (your
                CLI tools / monitoring). The validator key never sees an internet-facing service.
              </p>
            </div>

            <div className="rounded-md border border-border/60 bg-muted/30 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Network className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">Public RPC profile</span>
              </div>
              <CodeBlock
                language="bash"
                code={`# Default unit (--rpc 0.0.0.0:8545) is fine.
sudo ufw allow 8545/tcp  comment 'Zebvix JSON-RPC'
sudo ufw allow 30333/tcp comment 'Zebvix libp2p gossip'
sudo ufw status numbered`}
              />
              <p className="text-xs text-muted-foreground mt-2">
                For production, front <code className="bg-muted px-1 rounded">:8545</code> with nginx
                + TLS + per-IP rate-limiting; the in-process server is HTTP only and has no auth.
              </p>
            </div>
          </div>
        </Step>

        <Step n={9} title="Verify the node is healthy">
          <p className="text-sm text-muted-foreground">
            Hit the node directly and confirm chain ID, head height, and staking parameters before
            considering setup complete.
          </p>
          <CodeBlock
            language="bash"
            code={`# 1) Chain ID — must be 7878
curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# {"jsonrpc":"2.0","id":1,"result":"0x1ec6"}        # 0x1ec6 = 7878

# 2) Head block — should advance every ~5–6 seconds
curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"zbx_blockNumber","params":[]}'

# 3) Staking parameters — confirm 100 ZBX self-bond / 10 ZBX delegation
curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"zbx_getStaking","params":[]}'

# 4) Total supply (founder premine + foundation + mined - burned)
curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"zbx_supply","params":[]}'`}
          />
        </Step>
      </div>

      {/* Update flow */}
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="w-4 h-4 text-primary" /> Updating an existing node
          </CardTitle>
          <CardDescription>
            The day-2 flow once Steps 1–9 have been done at least once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock
            language="bash"
            code={`cd /home/zebvix-chain

# 1. Snapshot current source (DB at ~/.zebvix is left alone)
mkdir -p .backups
tar -czf .backups/zebvix-chain-$(date +%Y%m%d-%H%M%S).tgz src/ Cargo.toml

# 2. Pull fresh tarball
curl -fsSL "$DASH_URL/api/download/newchain" -o newchain.tgz
tar -xzf newchain.tgz && rm newchain.tgz

# 3. Rebuild (incremental — usually 60–120 sec)
cargo build --release --features zvm

# 4. Restart the service (graceful, no DB wipe)
sudo systemctl restart zebvix.service
sudo journalctl -u zebvix.service -n 20 --no-pager

# 5. Confirm chain resumed at the previous tip
curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"zbx_blockNumber","params":[]}'`}
          />
        </CardContent>
      </Card>

      {/* Troubleshooting */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="w-4 h-4 text-primary" /> Troubleshooting
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-semibold text-foreground">
              Build fails: <code className="bg-muted px-1 rounded">could not find libclang</code>
            </p>
            <p className="text-muted-foreground mt-1">
              <code className="bg-muted px-1 rounded">rocksdb</code>'s bindgen needs libclang. Install <code className="bg-muted px-1 rounded">libclang-dev</code> (Ubuntu/Debian) or set{" "}
              <code className="bg-muted px-1 rounded">LIBCLANG_PATH=/usr/lib/llvm-14/lib</code>.
            </p>
          </div>
          <div>
            <p className="font-semibold text-foreground">
              Service starts but no blocks are produced
            </p>
            <p className="text-muted-foreground mt-1">
              Validator key missing or not registered. Check{" "}
              <code className="bg-muted px-1 rounded">~/.zebvix/keystore/validator.json</code>{" "}
              exists and that <code className="bg-muted px-1 rounded">zbx_listValidators</code>{" "}
              includes your address. Follower nodes that are not validators will sync but never
              propose — that's expected.
            </p>
          </div>
          <div>
            <p className="font-semibold text-foreground">
              <code className="bg-muted px-1 rounded">connection refused</code> on :8545
            </p>
            <p className="text-muted-foreground mt-1">
              Either the service crashed (check{" "}
              <code className="bg-muted px-1 rounded">journalctl -u zebvix.service -n 200</code>) or
              the firewall is blocking the port. The unit binds to{" "}
              <code className="bg-muted px-1 rounded">0.0.0.0:8545</code>, so a remote{" "}
              <code className="bg-muted px-1 rounded">curl</code> failure is almost always{" "}
              <code className="bg-muted px-1 rounded">ufw</code>.
            </p>
          </div>
          <div>
            <p className="font-semibold text-foreground">
              Disk fills up after weeks of running
            </p>
            <p className="text-muted-foreground mt-1">
              RocksDB compacts automatically, but the journal and old{" "}
              <code className="bg-muted px-1 rounded">.backups/</code> tarballs accumulate. Trim the
              journal with <code className="bg-muted px-1 rounded">journalctl --vacuum-time=14d</code>{" "}
              and rotate backups (keep last 5).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <span>
          <strong className="text-foreground">Reference deployment:</strong> VPS{" "}
          <code className="bg-muted px-1 rounded">srv1266996</code> at{" "}
          <code className="bg-muted px-1 rounded">93.127.213.192:8545</code> runs this exact stack —
          Ubuntu 24.04, Rust stable, <code className="bg-muted px-1 rounded">--features zvm</code>{" "}
          build, <code className="bg-muted px-1 rounded">/home/zebvix-chain</code> source,{" "}
          <code className="bg-muted px-1 rounded">/root/.zebvix</code> data, systemd unit{" "}
          <code className="bg-muted px-1 rounded">zebvix.service</code>. Mirror it and you are
          interoperable with the founder node from block one.
        </span>
      </div>
    </div>
  );
}
