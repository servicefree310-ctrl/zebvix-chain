import React from "react";
import { CodeBlock } from "@/components/ui/code-block";

export default function Home() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground mb-4">
          Zebvix Chain Fork Dashboard
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          A precision reference manual for engineering teams building the Zebvix (ZBX) custom L1 blockchain on top of the Sui codebase.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="p-6 rounded-lg bg-card border border-border">
          <h3 className="text-lg font-semibold mb-2 text-primary">Move VM</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Object-centric smart contract execution environment. Secure, fast, and designed for parallel execution of independent Zebvix (ZBX) transactions.
          </p>
        </div>
        <div className="p-6 rounded-lg bg-card border border-border">
          <h3 className="text-lg font-semibold mb-2 text-primary">Mysticeti Consensus</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Zebvix's cutting-edge BFT consensus engine. Achieves sub-second latency and high throughput for shared-object transactions.
          </p>
        </div>
        <div className="p-6 rounded-lg bg-card border border-border">
          <h3 className="text-lg font-semibold mb-2 text-primary">Object Model</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Everything is an object. Owned objects bypass consensus entirely (Fast Path), enabling massive linear scalability on the Zebvix network.
          </p>
        </div>
        <div className="p-6 rounded-lg bg-card border border-border">
          <h3 className="text-lg font-semibold mb-2 text-primary">Validators</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Permissionless delegated Proof-of-Stake (dPoS) network. Zebvix validators process ZBX transactions and participate in consensus.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2">Prerequisites</h2>
        <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
          <li><strong className="text-foreground font-medium">OS:</strong> Linux (Ubuntu 20.04/22.04 recommended) or macOS</li>
          <li><strong className="text-foreground font-medium">Rust:</strong> v1.75.0 or higher</li>
          <li><strong className="text-foreground font-medium">Git:</strong> Latest version</li>
          <li><strong className="text-foreground font-medium">Hardware (Validator):</strong> 24+ cores, 128GB RAM, 2TB+ NVMe SSD</li>
        </ul>
      </div>

      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2">Quick Start — Zebvix Fork</h2>
        <p className="text-muted-foreground">Clone the Sui repository (base for Zebvix), rename it, and build the node binary to get started.</p>
        <CodeBlock 
          language="bash"
          code={`git clone https://github.com/MystenLabs/sui.git zebvix
cd zebvix
# Rename remotes for your fork
git remote rename origin upstream
cargo build --release -p sui-node`}
        />
      </div>

      <div className="p-5 rounded-lg bg-primary/5 border border-primary/20">
        <h3 className="font-semibold text-primary mb-1">Chain Identity</h3>
        <div className="flex gap-8 mt-2 text-sm">
          <div>
            <span className="text-muted-foreground">Chain Name: </span>
            <span className="font-mono text-foreground font-semibold">Zebvix</span>
          </div>
          <div>
            <span className="text-muted-foreground">Token Symbol: </span>
            <span className="font-mono text-foreground font-semibold">ZBX</span>
          </div>
          <div>
            <span className="text-muted-foreground">Chain ID: </span>
            <span className="font-mono text-foreground font-semibold">zebvix-mainnet-1</span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-2xl font-semibold border-b border-border pb-2">One-Command Server Setup</h2>
        <p className="text-muted-foreground text-sm">
          Run this single command on your Ubuntu 22.04 server. It will automatically install Rust, clone Sui, apply all Zebvix rebranding, build the binary, create config files, and set up the systemd service.
        </p>
        <CodeBlock
          language="bash"
          code={`# On your Ubuntu 22.04 server — run as root or sudo
curl -sSL https://raw.githubusercontent.com/your-org/zebvix/main/zebvix-setup.sh | sudo bash

# Or download and review first (recommended):
wget https://raw.githubusercontent.com/your-org/zebvix/main/zebvix-setup.sh
chmod +x zebvix-setup.sh
sudo ./zebvix-setup.sh`}
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {[
            { step: "01", label: "Installs Rust & deps" },
            { step: "02", label: "Clones & renames fork" },
            { step: "03", label: "Builds zebvix-node" },
            { step: "04", label: "Creates configs & service" },
          ].map(({ step, label }) => (
            <div key={step} className="p-3 rounded-md bg-card border border-border text-center">
              <div className="text-xl font-bold font-mono text-primary">{step}</div>
              <div className="text-xs text-muted-foreground mt-1">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
