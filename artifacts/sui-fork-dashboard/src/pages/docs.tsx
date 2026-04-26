import React from "react";
import { Link } from "wouter";
import {
  BookOpen,
  Wallet,
  FileCode2,
  ArrowLeftRight,
  Smartphone,
  Terminal,
  Shield,
  Coins,
  Activity,
  Search,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  Layers,
  Cpu,
  Hash
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type DocLink = { href: string; label: string; external?: boolean };
type DocCard = {
  title: string;
  desc: string;
  icon: React.ElementType;
  accent: string;
  items: DocLink[];
};

const SECTIONS: DocCard[] = [
  {
    title: "Getting Started",
    desc: "Spin up a node, configure genesis, and join the live chain.",
    icon: Sparkles,
    accent: "text-emerald-400 border-emerald-500/40",
    items: [
      { href: "/quick-start", label: "Quick Start Script" },
      { href: "/setup", label: "Environment Setup" },
      { href: "/genesis", label: "Genesis Config" },
      { href: "/validators", label: "Validator Setup" },
      { href: "/network", label: "Network Config" },
    ],
  },
  {
    title: "Wallet & Identity",
    desc: "ZBX wallet, Pay-ID, address import, and balances.",
    icon: Wallet,
    accent: "text-cyan-400 border-cyan-500/40",
    items: [
      { href: "/wallet", label: "ZBX Wallet (Send / Receive)" },
      { href: "/import-wallet", label: "Import Address (Key / Mnemonic)" },
      { href: "/payid-register", label: "Register Pay-ID" },
      { href: "/payid-resolver", label: "Pay-ID Resolver" },
      { href: "/balance-lookup", label: "Balance Lookup" },
    ],
  },
  {
    title: "Smart Contracts",
    desc: "ZVM contracts, sources, and transparent code review.",
    icon: FileCode2,
    accent: "text-violet-400 border-violet-500/40",
    items: [
      { href: "/smart-contracts", label: "Smart Contracts (ZVM)" },
      { href: "/zvm-explorer", label: "ZVM Explorer" },
      { href: "/chain-code", label: "Chain Source Code" },
      { href: "/code-review", label: "What Changed" },
    ],
  },
  {
    title: "DEX, Swap & Liquidity",
    desc: "AMM pools, swaps, and token lifecycle tools.",
    icon: ArrowLeftRight,
    accent: "text-amber-400 border-amber-500/40",
    items: [
      { href: "/swap", label: "Swap (Buy / Sell)" },
      { href: "/dex", label: "DEX / Swap Aggregator" },
      { href: "/pool-explorer", label: "Pool / AMM" },
      { href: "/token-create", label: "Create Your Token" },
      { href: "/token-trade", label: "Token Trade (AMM)" },
      { href: "/token-liquidity", label: "Token Liquidity" },
    ],
  },
  {
    title: "Bridge",
    desc: "Cross-chain lock & send between Zebvix L1 and BSC/EVM.",
    icon: ArrowLeftRight,
    accent: "text-pink-400 border-pink-500/40",
    items: [
      { href: "/bridge", label: "Cross-Chain Bridge" },
      { href: "/bridge-live", label: "Bridge — Lock & Send (Live)" },
    ],
  },
  {
    title: "Mobile Wallet",
    desc: "Flutter wallet, deep-linked dApp connect, and QR sign.",
    icon: Smartphone,
    accent: "text-blue-400 border-blue-500/40",
    items: [
      { href: "/api/mobile/", label: "Open Mobile Wallet (Web Build)", external: true },
      { href: "/connect-wallet", label: "Connect Mobile Wallet (QR)" },
    ],
  },
  {
    title: "API & RPC",
    desc: "REST + JSON-RPC endpoints, status, and downloads.",
    icon: Terminal,
    accent: "text-teal-400 border-teal-500/40",
    items: [
      { href: "/rpc-playground", label: "RPC Playground" },
      { href: "/live-chain", label: "Live Chain Status", },
      { href: "/block-explorer", label: "Block Explorer" },
      { href: "/downloads", label: "Downloads" },
    ],
  },
  {
    title: "Security",
    desc: "Hardening, multisig, and governance controls.",
    icon: Shield,
    accent: "text-rose-400 border-rose-500/40",
    items: [
      { href: "/multisig-explorer", label: "Multisig Explorer" },
      { href: "/governance", label: "Governance" },
      { href: "/chain-status", label: "Chain Features & Hardening" },
    ],
  },
  {
    title: "Tokenomics & Economy",
    desc: "Supply, emission, and economic design tools.",
    icon: Coins,
    accent: "text-yellow-400 border-yellow-500/40",
    items: [
      { href: "/tokenomics", label: "Tokenomics" },
      { href: "/zbx-tokenomics", label: "ZBX Tokenomics Design" },
      { href: "/economic-design", label: "Economic Designer" },
      { href: "/staking", label: "Staking Dashboard" },
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

export default function DocsPage() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">
            Documentation
          </Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
            LIVE
          </Badge>
          <Badge variant="outline" className="text-blue-400 border-blue-500/40">
            Hub
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-primary" />
          Zebvix Developer Docs
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Everything you need to operate, integrate, and extend the Zebvix L1 chain — from spinning up a validator to wiring the mobile wallet into your dApp.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">Live Network Data</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                <strong className="text-emerald-400">Real-time status</strong> fetched directly from the RPC
              </li>
              <li>
                <strong className="text-emerald-400">Mainnet 7878</strong> active and running
              </li>
              <li>
                <strong className="text-emerald-400">Interactive examples</strong> across all doc pages
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={Layers}
          label="Categories"
          value="9"
          sub="Sections"
        />
        <StatTile
          icon={FileCode2}
          label="Topics"
          value="38"
          sub="Articles"
        />
        <StatTile
          icon={Activity}
          label="Network"
          value="Mainnet"
          sub="Live data"
        />
        <StatTile
          icon={Hash}
          label="Chain ID"
          value="7878"
          sub="0x1ec6"
        />
      </div>

      {/* Docs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.title}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className={`w-4 h-4 ${s.accent.split(" ")[0]}`} />
                    {s.title}
                  </CardTitle>
                </div>
                <CardDescription className="text-xs">
                  {s.desc}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {s.items.map((it) =>
                    it.external ? (
                      <li key={it.href}>
                        <a
                          href={it.href}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
                        >
                          <span>{it.label}</span>
                          <ExternalLink className="h-3 w-3 opacity-60" />
                        </a>
                      </li>
                    ) : (
                      <li key={it.href}>
                        <Link href={it.href}>
                          <span className="text-sm text-muted-foreground hover:text-primary transition-colors cursor-pointer block">
                            {it.label}
                          </span>
                        </Link>
                      </li>
                    ),
                  )}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Search Hint */}
      <div className="border-l-4 border-l-primary/50 bg-primary/5 p-4 rounded-md flex gap-3 text-sm">
        <Search className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-foreground">Can't find what you need?</div>
          <div className="text-muted-foreground">
            Use the sidebar — every page in the dashboard is also a doc.
            Live state (heights, balances, prices) is fetched directly from the
            VPS RPC, so what you see here is what's running on the chain.
          </div>
        </div>
      </div>
    </div>
  );
}
