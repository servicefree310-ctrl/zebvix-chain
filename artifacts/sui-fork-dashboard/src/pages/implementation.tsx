import React, { useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { CheckCircle2, Circle, ChevronDown, ChevronRight } from "lucide-react";

const phases = [
  {
    id: "P1",
    title: "Phase 1 — Genesis Config",
    subtitle: "No rebuild needed • Do this after first build completes",
    color: "text-green-400",
    borderColor: "border-green-500/30",
    bgColor: "bg-green-500/5",
    steps: [
      {
        title: "Create genesis.yaml with all Zebvix parameters",
        file: "/root/zebvix-data/genesis/genesis.yaml",
        description: "Supply, block time, validator stake, fee splits — sab yahan set hoga",
        code: `cat > /root/zebvix-data/genesis/genesis.yaml << 'EOF'
---
chain_id: "zebvix-mainnet-1"
epoch_duration_ms: 86400000
protocol_version: 1

# Block time: 0.4 seconds
consensus_config:
  max_round_delay_ms: 400
  round_timeout_ms: 400

# Reference gas price
reference_gas_price: 1000

# Validator requirements
min_validator_stake_mist: 10000000000000   # 10,000 ZBX minimum stake
max_validator_count: 100

# Initial supply: 2,000,000 ZBX
initial_stake_subsidy_amount: 2000000000000000

# Pre-allocations
token_distribution_schedule:
  - recipient: "0xFOUNDER_TREASURY_ADDRESS"
    amount_mist: 600000000000000    # 600,000 ZBX (30%)
  - recipient: "0xCHAIN_POOL_ADDRESS"
    amount_mist: 800000000000000    # 800,000 ZBX (40%)
  - recipient: "0xTEAM_VESTING_ADDRESS"
    amount_mist: 400000000000000    # 400,000 ZBX (20%)
  - recipient: "0xECOSYSTEM_ADDRESS"
    amount_mist: 200000000000000    # 200,000 ZBX (10%)

validators: []
EOF
echo "genesis.yaml created ✅"`,
      },
    ],
  },
  {
    id: "P2",
    title: "Phase 2 — Rust Code Changes",
    subtitle: "Requires rebuild after changes • Do in order",
    color: "text-yellow-400",
    borderColor: "border-yellow-500/30",
    bgColor: "bg-yellow-500/5",
    steps: [
      {
        title: "Step 2.1 — Hard Cap: 150 Million ZBX (gas_coin.rs)",
        file: "crates/sui-types/src/gas_coin.rs",
        description: "Maximum supply cap — no new ZBX can ever be minted beyond 150M",
        code: `cd ~/zebvix-node

# Add hard cap constants to gas_coin.rs
cat >> crates/sui-types/src/gas_coin.rs << 'EOF'

// ── Zebvix Custom Supply Constants ──────────────────────────
pub const GENESIS_SUPPLY_ZBX: u64     = 2_000_000;
pub const GENESIS_SUPPLY_MIST: u64    = GENESIS_SUPPLY_ZBX * MIST_PER_ZBX;

pub const MAX_TOTAL_SUPPLY_ZBX: u64   = 150_000_000;
pub const MAX_TOTAL_SUPPLY_MIST: u64  = MAX_TOTAL_SUPPLY_ZBX * MIST_PER_ZBX;

pub const FIRST_HALVING_ZBX: u64      = 50_000_000;
pub const SECOND_HALVING_ZBX: u64     = 100_000_000;

pub const INITIAL_BLOCK_REWARD_MIST: u64 = 100_000_000; // 0.1 ZBX/block
EOF

echo "Hard cap constants added ✅"`,
      },
      {
        title: "Step 2.2 — EVM-Style 20-Byte Addresses (base_types.rs)",
        file: "crates/sui-types/src/base_types.rs",
        description: "Makes addresses look like Ethereum: 0x742d35Cc... (40 hex chars, 20 bytes)",
        code: `cd ~/zebvix-node

# Check current address length
grep -n "SUI_ADDRESS_LENGTH" crates/sui-types/src/base_types.rs | head -3

# Change from 32 bytes to 20 bytes (EVM-compatible)
sed -i 's/pub const SUI_ADDRESS_LENGTH: usize = 32/pub const SUI_ADDRESS_LENGTH: usize = 20/' \\
    crates/sui-types/src/base_types.rs

# Verify
grep "SUI_ADDRESS_LENGTH" crates/sui-types/src/base_types.rs | head -2
echo "EVM address length set to 20 bytes ✅"`,
      },
      {
        title: "Step 2.3 — Halving Logic in Reward Module",
        file: "crates/sui-types/src/sui_system_state/sui_system_state_inner_v2.rs",
        description: "Halving at 50M and 100M minted — affects validators, node runners, delegators",
        code: `cd ~/zebvix-node

# Find the reward/staking subsidy file
grep -rl "stake_subsidy\|staking_reward\|epoch_reward" crates/ --include="*.rs" | head -5

# Add halving function — append to sui-types/src/gas_coin.rs for now
cat >> crates/sui-types/src/gas_coin.rs << 'EOF'

/// Returns reward multiplier based on total minted supply
/// 100 = full rate, 50 = half, 25 = quarter, 0 = cap reached
pub fn get_halving_multiplier(total_minted_zbx: u64) -> u64 {
    if total_minted_zbx >= MAX_TOTAL_SUPPLY_ZBX {
        0   // Hard cap — no more block rewards
    } else if total_minted_zbx >= SECOND_HALVING_ZBX {
        25  // After 2nd halving: 0.025 ZBX/block, 250 ZBX max/epoch
    } else if total_minted_zbx >= FIRST_HALVING_ZBX {
        50  // After 1st halving: 0.05 ZBX/block, 500 ZBX max/epoch
    } else {
        100 // Genesis phase: 0.1 ZBX/block, 1000 ZBX max/epoch
    }
}

pub fn adjusted_block_reward(total_minted_zbx: u64) -> u64 {
    (INITIAL_BLOCK_REWARD_MIST * get_halving_multiplier(total_minted_zbx)) / 100
}
EOF

echo "Halving logic added ✅"`,
      },
      {
        title: "Step 2.4 — Node Bond: 100 ZBX Mandatory Collateral for Node Runners",
        file: "crates/sui-framework/packages/zebvix/sources/staking_pool.move",
        description: "Har node runner ko 100 ZBX node bond lock karna padega — gas fee 22% share ke liye eligible hone ke liye",
        code: `# staking_pool.move mein ye changes pehle se included hain patches archive mein
# Manual verify karo:

grep "NODE_BOND_MIST" ~/zebvix-node/crates/sui-framework/packages/zebvix/sources/staking_pool.move

# Expected output:
# const NODE_BOND_MIST: u64 = 100_000_000_000; // 100 ZBX — mandatory node collateral

# stake() call — 100 ZBX bond alag coin se dena padega
# Example PTB (programmable transaction):
#   let stake_coin = split(your_wallet, 10_000 * 1_000_000_000);  // 10,000 ZBX
#   let bond_coin  = split(your_wallet,    100 * 1_000_000_000);  //    100 ZBX
#   staking_pool::stake(pool, stake_coin, bond_coin, node_wallet_addr, ctx);

# unstake() → returns TWO coins
#   let (stake_back, bond_back) = staking_pool::unstake(pool, stake_obj, ctx);
#   # bond_back = 100 ZBX returned after exit

echo "Node bond logic verify karo ✅"`,
      },
      {
        title: "Step 2.5 — Gas Fee Split: 22% Node / 30% Validators / 20% Delegators / 18% Treasury / 10% Burn",
        file: "crates/sui-types/src/sui_system_state/",
        description: "Gas fee ko teen parts mein baanto — validators, treasury, aur burn",
        code: `cd ~/zebvix-node

# Find gas distribution file
grep -rl "gas_fee\|gas_revenue\|storage_fund" crates/ --include="*.rs" | \\
  grep -i "system_state\|epoch\|config" | head -5

# Add fee split constants
cat >> crates/sui-types/src/gas_coin.rs << 'EOF'

// ── Gas Fee Split Constants (total = 10000 bps = 100%) ──────
pub const GAS_NODE_BPS: u64       = 2200;  // 22% → node runners (jo node chalate hain)
pub const GAS_VALIDATOR_BPS: u64  = 3000;  // 30% → validators (staking reward)
pub const GAS_DELEGATOR_BPS: u64  = 2000;  // 20% → delegators
pub const GAS_TREASURY_BPS: u64   = 1800;  // 18% → founder treasury
pub const GAS_BURN_BPS: u64       = 1000;  // 10% → burned forever 🔥
// 2200 + 3000 + 2000 + 1800 + 1000 = 10000 ✓

// Validator max reward per epoch (halving applies)
pub const VALIDATOR_MAX_REWARD_MIST: u64 = 1_000_000_000_000; // 1,000 ZBX

// Node runner reward per day (halving applies)
pub const NODE_RUNNER_DAILY_MIST: u64    = 5_000_000_000;     // 5 ZBX
pub const NODE_RUNNER_POOL_CAP_MIST: u64 = 4_000_000_000_000; // 4,000 ZBX/day cap
EOF

echo "Gas fee constants added ✅"`,
      },
      {
        title: "Step 2.6 — Rebuild After All Rust Changes",
        file: "",
        description: "Ek baar saare changes karne ke baad — single rebuild",
        code: `cd ~/zebvix-node
source "$HOME/.cargo/env"

# Rebuild (incremental — sirf changed files recompile honge, ~30-60 min)
nohup cargo build --release -p sui-node --bin zebvix-node \\
  > ~/zebvix-data/logs/build2.log 2>&1 &

echo "Rebuild started: PID $!"
echo ""
echo "Monitor: tail -f ~/zebvix-data/logs/build2.log"`,
      },
    ],
  },
  {
    id: "P3",
    title: "Phase 3 — Keypairs & Genesis Blob",
    subtitle: "After binary is ready • One-time setup",
    color: "text-blue-400",
    borderColor: "border-blue-500/30",
    bgColor: "bg-blue-500/5",
    steps: [
      {
        title: "Step 3.1 — Generate Validator Keypairs",
        file: "",
        description: "4 keypairs chahiye har validator ke liye — protocol, network, worker, account",
        code: `# Binary location after build
BINARY="/root/zebvix-node/target/release/zebvix-node"

# Generate keypairs
$BINARY keytool generate ed25519   # Account key
$BINARY keytool generate ed25519   # Network key
$BINARY keytool generate bls12381  # Protocol/consensus key
$BINARY keytool generate ed25519   # Worker key

# Keys save honge: ~/.zebvix/zebvix.keystore
cat ~/.zebvix/zebvix.keystore`,
      },
      {
        title: "Step 3.2 — Fill validator.yaml with Your Keys",
        file: "/root/zebvix-data/validator.yaml",
        description: "Generated keys ko config mein paste karo",
        code: `cat > /root/zebvix-data/validator.yaml << 'EOF'
---
protocol-key-pair:
  value: "REPLACE_WITH_BLS12381_KEY"
network-key-pair:
  value: "REPLACE_WITH_ED25519_KEY"
worker-key-pair:
  value: "REPLACE_WITH_ED25519_KEY"
account-key-pair:
  value: "REPLACE_WITH_ED25519_KEY"

db-path: "/root/zebvix-data/db"
network-address: "/ip4/0.0.0.0/tcp/8080/http"
metrics-address: "0.0.0.0:9184"
admin-interface-port: 1337
json-rpc-address: "0.0.0.0:9000"

consensus-config:
  address: "/ip4/127.0.0.1/tcp/8083/http"
  db-path: "/root/zebvix-data/consensus_db"

genesis:
  genesis-file-location: "/root/zebvix-data/genesis/genesis.blob"
EOF`,
      },
      {
        title: "Step 3.3 — Build Genesis Blob",
        file: "",
        description: "genesis.yaml se binary genesis.blob create hota hai — chain ka starting point",
        code: `BINARY="/root/zebvix-node/target/release/zebvix-node"

$BINARY genesis \\
  --from-config /root/zebvix-data/genesis/genesis.yaml \\
  --working-dir /root/zebvix-data/genesis/

ls -lh /root/zebvix-data/genesis/
# genesis.blob hona chahiye wahan`,
      },
    ],
  },
  {
    id: "P4",
    title: "Phase 4 — Start Node & Systemd",
    subtitle: "Chain live ho jayegi!",
    color: "text-primary",
    borderColor: "border-primary/30",
    bgColor: "bg-primary/5",
    steps: [
      {
        title: "Step 4.1 — Copy Binary & Create Service",
        file: "/etc/systemd/system/zebvix-node.service",
        description: "Node ko system service ke roop mein register karo — auto-restart milega",
        code: `# Copy binary
cp /root/zebvix-node/target/release/zebvix-node /usr/local/bin/zebvix-node
chmod +x /usr/local/bin/zebvix-node

# Create systemd service
cat > /etc/systemd/system/zebvix-node.service << 'EOF'
[Unit]
Description=Zebvix Node — Zebvix Technologies Pvt Ltd
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/zebvix-node --config-path /root/zebvix-data/validator.yaml
Restart=always
RestartSec=10
LimitNOFILE=1000000
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo "Service created ✅"`,
      },
      {
        title: "Step 4.2 — Start Zebvix Chain! 🚀",
        file: "",
        description: "Yeh command chalate hi Zebvix chain live ho jayegi",
        code: `# Start the node
systemctl enable --now zebvix-node

# Check status
systemctl status zebvix-node

# Live logs
journalctl -u zebvix-node -f

# Test RPC
curl -X POST http://localhost:9000 \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"sui_getChainIdentifier","id":1}'
# Should return: "zebvix-mainnet-1"`,
      },
    ],
  },
  {
    id: "P5",
    title: "Phase 5 — Move Smart Contracts",
    subtitle: "No rebuild needed • Deploy after chain is live",
    color: "text-purple-400",
    borderColor: "border-purple-500/30",
    bgColor: "bg-purple-500/5",
    steps: [
      {
        title: "Step 5.1 — Install Move CLI (Sui CLI)",
        file: "",
        description: "Move contracts deploy karne ke liye CLI chahiye",
        code: `# Sui CLI already built — symlink banao
ln -sf /usr/local/bin/zebvix-node /usr/local/bin/zebvix-cli

# Configure CLI to use your local node
zebvix-cli client new-env --alias zebvix --rpc http://localhost:9000
zebvix-cli client switch --env zebvix

# Check connection
zebvix-cli client chain-identifier`,
      },
      {
        title: "Step 5.2 — Deploy Node Runner Rewards Contract",
        file: "contracts/node_rewards/",
        description: "5 ZBX/day per node, 4000 ZBX/day pool cap — Move contract",
        code: `mkdir -p ~/zebvix-contracts/node_rewards/sources

cat > ~/zebvix-contracts/node_rewards/Move.toml << 'EOF'
[package]
name = "node_rewards"
version = "0.0.1"

[addresses]
node_rewards = "0x0"

[dependencies]
Sui = { local = "/root/zebvix-node/crates/sui-framework/packages/sui-framework" }
EOF

# Copy node_rewards.move from dashboard code
# Then publish:
cd ~/zebvix-contracts/node_rewards
zebvix-cli client publish --gas-budget 100000000 --json`,
      },
      {
        title: "Step 5.3 — Deploy Multisig Treasury Contract",
        file: "contracts/multisig/",
        description: "Founder treasury ke liye 2-of-3 multisig",
        code: `mkdir -p ~/zebvix-contracts/multisig/sources
# Copy multisig.move from dashboard code
# Publish:
cd ~/zebvix-contracts/multisig
zebvix-cli client publish --gas-budget 100000000 --json

# Note down Package ID from output — ye important hai!`,
      },
    ],
  },
];

function PhaseSection({ phase }: { phase: typeof phases[0] }) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className={`rounded-lg border ${phase.borderColor} ${phase.bgColor} overflow-hidden`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/5 transition-colors"
      >
        <span className={`font-bold font-mono text-sm ${phase.color}`}>{phase.id}</span>
        <div className="flex-1">
          <div className={`font-semibold text-foreground`}>{phase.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{phase.subtitle}</div>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3">
          {phase.steps.map((step, i) => (
            <div key={i} className="bg-background/50 rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === i ? null : i)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
              >
                {expanded === i
                  ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">{step.title}</div>
                  {step.file && (
                    <div className="text-xs font-mono text-muted-foreground mt-0.5">{step.file}</div>
                  )}
                </div>
                {expanded === i
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                }
              </button>
              {expanded === i && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                  <CodeBlock language="bash" code={step.code} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Implementation() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">Implementation Roadmap</h1>
        <p className="text-lg text-muted-foreground">
          Step-by-step guide — har feature ko sahi order mein implement karo. Exact file paths aur commands sab yahan hain.
        </p>
      </div>

      {/* Timeline overview */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          { id: "P1", label: "Genesis Config", color: "bg-green-500" },
          { id: "→", label: "", color: "" },
          { id: "P2", label: "Rust Changes", color: "bg-yellow-500" },
          { id: "→", label: "", color: "" },
          { id: "P3", label: "Keys & Genesis", color: "bg-blue-500" },
          { id: "→", label: "", color: "" },
          { id: "P4", label: "Start Chain 🚀", color: "bg-primary" },
          { id: "→", label: "", color: "" },
          { id: "P5", label: "Move Contracts", color: "bg-purple-500" },
        ].map(({ id, label, color }, i) => (
          id === "→"
            ? <div key={i} className="text-muted-foreground self-center">→</div>
            : (
              <div key={i} className="flex flex-col items-center gap-1 shrink-0">
                <div className={`w-8 h-8 rounded-full ${color} flex items-center justify-center text-xs font-bold text-background`}>
                  {id.replace("P", "")}
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">{label}</div>
              </div>
            )
        ))}
      </div>

      {/* Phase sections */}
      <div className="space-y-4">
        {phases.map(phase => (
          <PhaseSection key={phase.id} phase={phase} />
        ))}
      </div>

      {/* Final note */}
      <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 text-sm">
        <div className="font-semibold text-primary mb-1">Important Order</div>
        <div className="text-muted-foreground text-xs space-y-1">
          <div>• P1 aur P2 ke saare Rust changes pehle karo — phir <strong className="text-foreground">ek baar rebuild</strong></div>
          <div>• P3 tabhi karo jab binary ready ho (<code className="text-primary">target/release/zebvix-node</code> exist kare)</div>
          <div>• P4 tabhi karo jab <code className="text-primary">genesis.blob</code> ban jaye</div>
          <div>• P5 tabhi karo jab chain chal rahi ho aur RPC respond kar raha ho</div>
        </div>
      </div>
    </div>
  );
}
