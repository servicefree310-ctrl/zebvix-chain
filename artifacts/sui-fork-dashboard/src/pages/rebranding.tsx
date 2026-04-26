import React, { useState } from "react";
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Brush, Check, Zap, Layers, Code2 } from "lucide-react";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const CATEGORIES = [
  {
    label: "KARO — Safe to Rebrand",
    description: "Yeh sab user-facing hain — Zebvix brand yahaan zaroori hai",
    color: "text-emerald-400",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/5",
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />,
    items: [
      {
        title: "Binary / Executable name",
        where: "Cargo.toml [[bin]] section",
        status: "Already done",
        from: "sui-node",
        to: "zebvix-node",
        note: "Users is binary ko run karte hain — Zebvix naam zaroor aana chahiye",
        code: `# Cargo.toml mein (already done):\n[[bin]]\nname = "zebvix-node"   ← YEH\npath = "src/main.rs"`,
      },
      {
        title: "Config directory",
        where: "~/.sui/ → ~/.zebvix/",
        status: "Already done",
        from: ".sui",
        to: ".zebvix",
        note: "Jab user apne machine pe node chalayega, config folder Zebvix ka dikhega",
        code: `# Already renamed in code:\nSUI_CONFIG_DIR → ZEBVIX_CONFIG_DIR\n~/.sui/         → ~/.zebvix/\nkeystore file   → zebvix.keystore`,
      },
      {
        title: "Token symbol (user-visible)",
        where: "gas_coin.rs constants",
        status: "Already done",
        from: "SUI",
        to: "ZBX",
        note: "Wallet mein, explorer mein — sab jagah ZBX dikhega",
        code: `// gas_coin.rs (already done):\npub const MIST_PER_ZBX: u64 = 1_000_000_000;\npub const TOTAL_SUPPLY_ZBX: u64 = 150_000_000;`,
      },
      {
        title: "Chain ID / Network identifier",
        where: "genesis.yaml → chain_id",
        status: "Do in Phase 1",
        from: "sui-mainnet",
        to: "zebvix-mainnet-1",
        note: "RPC se jab bhi chain query hogi — yeh name return hoga",
        code: `# genesis.yaml mein:\nchain_id: "zebvix-mainnet-1"\n\n# Test:\ncurl localhost:9000 -d '{"method":"sui_getChainIdentifier"}'\n# Returns: "zebvix-mainnet-1"`,
      },
      {
        title: "Node info / version string",
        where: "crates/sui-node/src/main.rs",
        status: "Optional but good",
        from: "Sui Node v1.69.2",
        to: "Zebvix Node v1.0.0",
        note: "Node start hone pe terminal mein version dikhta hai",
        code: `# main.rs mein find karo:\ngrep -n "Sui Node\\|sui-node" crates/sui-node/src/main.rs\n\n# Replace:\nsed -i 's/Sui Node/Zebvix Node/g' crates/sui-node/src/main.rs`,
      },
      {
        title: "Systemd service name",
        where: "/etc/systemd/system/",
        status: "Do in Phase 4",
        from: "sui-node.service",
        to: "zebvix-node.service",
        note: "Server pe service ka naam — Zebvix ka brand",
        code: `# Service file:\n/etc/systemd/system/zebvix-node.service\nDescription=Zebvix Node — Zebvix Technologies Pvt Ltd`,
      },
      {
        title: "Log file names",
        where: "Wherever logs are written",
        status: "Already in our setup",
        from: "sui-node.log",
        to: "zebvix-node.log",
        note: "~/zebvix-data/logs/ mein sab Zebvix naam se",
        code: `~/zebvix-data/logs/build.log\n~/zebvix-data/logs/zebvix-node.log\n~/zebvix-data/logs/consensus.log`,
      },
    ],
  },
  {
    label: "SOCH KE KARO — Optional / Careful",
    description: "Technically possible hai lekin consequences hain — carefully decide karo",
    color: "text-amber-400",
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
    icon: <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />,
    items: [
      {
        title: "JSON-RPC method names (sui_* → zebvix_*)",
        where: "crates/sui-json-rpc/",
        status: "Break wallet compatibility",
        from: "sui_getBalance, sui_transfer...",
        to: "zebvix_getBalance, zebvix_transfer...",
        note: "Agar rename karoge toh standard Sui wallets (Suiet, Martian) kaam nahi karenge. Custom wallet banani padegi. Recommend: mat karo pehle phase mein.",
        code: `# Agar karna hai future mein:\ngrep -rl '"sui_' crates/sui-json-rpc/src/ | head -10\n# ~50+ methods hain — bada kaam hai\n# Custom wallet banane ke baad hi karo`,
      },
      {
        title: "Move module paths (0x2::sui::*)",
        where: "sui-framework packages",
        status: "On-chain contracts break",
        from: "use sui::coin::Coin",
        to: "use zebvix::coin::Coin",
        note: "Sare deployed Move contracts break ho jayenge. Recommend: ecosystem ready hone ke baad karna.",
        code: `# crates/sui-framework/packages/ mein:\nsui-framework/     ← 0x2\nsui-system/        ← 0x3  \nmove-stdlib/       ← 0x1\n\n# Rename bahut complex hai — baad mein karna`,
      },
      {
        title: "Internal Rust constant names (MIST_PER_SUI etc.)",
        where: "crates/sui-types/src/*.rs",
        status: "Already done, careful with grep",
        from: "MIST_PER_SUI, TOTAL_SUPPLY_SUI",
        to: "MIST_PER_ZBX, TOTAL_SUPPLY_ZBX",
        note: "Humne yeh pehle se kar diya — but agar aur files miss rahi hain toh build fail hoga",
        code: `# Check karo koi SUI constants miss toh nahi:\ngrep -rn "MIST_PER_SUI\\|TOTAL_SUPPLY_SUI" crates/ --include="*.rs"\n# Koi result nahi aana chahiye`,
      },
    ],
  },
  {
    label: "MAT KARO — Will Break Build/Network",
    description: "Yeh internal implementation details hain — rename karne se build fail ya network broken ho jayega",
    color: "text-rose-400",
    border: "border-rose-500/30",
    bg: "bg-rose-500/5",
    icon: <XCircle className="h-5 w-5 text-rose-400 shrink-0" />,
    items: [
      {
        title: "Cargo package names (sui-node, sui-types etc.)",
        where: "Every crate's Cargo.toml [package].name",
        status: "Build completely breaks",
        from: 'name = "sui-types"',
        to: 'name = "zebvix-types" — MAT KARO',
        note: "800+ crates ek doosre ko package name se reference karte hain. Rename karo toh sab dependency links toot jayenge.",
        code: `# YEH MAT KARO:\n# crates/sui-types/Cargo.toml\nname = "sui-types"  ← ISKO CHHODDO\n\n# Sirf binary name change karo (Cargo.toml [[bin]])\n# Package name alag cheez hai`,
      },
      {
        title: "Rust module/crate names in code (use sui_types::*)",
        where: "Thousands of files across codebase",
        status: "Thousands of compile errors",
        from: "use sui_types::base_types::*",
        to: "use zebvix_types::*— MAT KARO",
        note: "50,000+ lines of code mein ye pattern hai. Yeh internal implementation — users nahi dekhte.",
        code: `# Count karo kitni jagah hai:\ngrep -r "use sui_types\\|use sui_core\\|use sui_node" crates/ | wc -l\n# ~5000+ lines — karna impossible hai cleanly`,
      },
      {
        title: "P2P protocol identifiers / libp2p keys",
        where: "crates/anemo/ or network config",
        status: "Nodes connect nahi kar paayenge",
        from: "sui/1.0.0 protocol",
        to: "zebvix/1.0.0 — network breaks",
        note: "Agar protocol ID change kiya toh 2 nodes ek doosre ko recognize nahi karenge. Multi-node testnet fail ho jayega.",
        code: `# Network protocol — CHHODO:\ngrep -r "sui/1\\." crates/anemo/ --include="*.rs" | head -5\n# Isko rename mat karna`,
      },
      {
        title: "RocksDB column family names",
        where: "crates/typed-store/ storage layer",
        status: "Existing database unreadable",
        from: '"sui_object_store"',
        to: '"zebvix_object_store" — MAT KARO',
        note: "Database ek baar bana aur agar column names change kiye toh purana data read nahi hoga. Fresh start bhi permanent damage.",
        code: `# Database schema — CHHODO:\ngrep -r "column_family\\|cf_name" crates/typed-store/ | head -5`,
      },
    ],
  },
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

function CategorySection({ cat }: { cat: typeof CATEGORIES[0] }) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className={`rounded-lg border ${cat.border} ${cat.bg}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex-1">
          <div className={`font-bold text-base ${cat.color}`}>{cat.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{cat.description}</div>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-2">
          {cat.items.map((item, i) => (
            <div key={i} className="bg-background/60 rounded-lg border border-border/50 overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === i ? null : i)}
                className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
              >
                {cat.icon}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-semibold text-foreground">{item.title}</span>
                    <Badge variant="outline" className="text-[10px] font-mono py-0">{item.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate">{item.where}</div>
                  <div className="flex items-center gap-2 mt-1.5 text-xs flex-wrap">
                    <span className="line-through text-muted-foreground font-mono">{item.from}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className={`font-mono font-semibold ${cat.color}`}>{item.to}</span>
                  </div>
                </div>
                {expanded === i ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />}
              </button>
              {expanded === i && (
                <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-3">
                  <p className="text-xs text-muted-foreground">{item.note}</p>
                  <CodeBlock language="bash" code={item.code} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Rebranding() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">
            Guide
          </Badge>
          <Badge variant="outline" className="text-amber-400 border-amber-500/40">
            Operations
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Brush className="w-7 h-7 text-primary" />
          Rebranding Guide
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Kahan Zebvix brand lagao, kahan nahi — clear breakdown with exact files aur commands.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">The Golden Rule</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                <strong className="text-emerald-400">User jo dekhta hai</strong> → Zebvix brand lagao.
              </li>
              <li>
                <strong className="text-emerald-400">Compiler/runtime jo dekhta hai</strong> → Mat chhuo.
              </li>
              <li>
                Binary name, token symbol, chain ID = <strong className="text-emerald-400">Zebvix</strong>.
              </li>
              <li>
                Cargo packages, Rust modules, DB schema = <strong className="text-emerald-400">Internal</strong>.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={CheckCircle2}
          label="Safe"
          value="7"
          sub="User-facing items"
        />
        <StatTile
          icon={AlertCircle}
          label="Careful"
          value="3"
          sub="Optional changes"
        />
        <StatTile
          icon={XCircle}
          label="Do Not Touch"
          value="4"
          sub="Internal names"
        />
        <StatTile
          icon={Check}
          label="Status"
          value="Ready"
          sub="Pre-configured"
        />
      </div>

      <div className="space-y-4">
        {CATEGORIES.map((cat, i) => (
          <CategorySection key={i} cat={cat} />
        ))}
      </div>

      {/* Quick status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="w-5 h-5 text-primary" />
            Abhi tak kya kiya ja chuka hai
          </CardTitle>
          <CardDescription>
            Current status of rebranding efforts in the codebase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { done: true, text: "Binary: zebvix-node (Cargo.toml [[bin]] section)" },
              { done: true, text: "Config dir: .sui → .zebvix" },
              { done: true, text: "Token: SUI → ZBX (MIST_PER_ZBX, TOTAL_SUPPLY_ZBX)" },
              { done: false, text: "Chain ID: genesis.yaml mein zebvix-mainnet-1 (Phase 1 mein)" },
              { done: false, text: "Node version string: main.rs mein Zebvix Node" },
              { done: false, text: "Systemd service: zebvix-node.service (Phase 4 mein)" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                {item.done
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  : <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                }
                <span className={`text-sm ${item.done ? "text-foreground" : "text-muted-foreground"}`}>{item.text}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
