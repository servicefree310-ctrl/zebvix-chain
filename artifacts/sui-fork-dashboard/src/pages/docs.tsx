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
} from "lucide-react";

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
    accent: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30",
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
    accent: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/30",
    items: [
      { href: "/wallet", label: "ZBX Wallet (Send / MetaMask)" },
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
    accent: "from-violet-500/20 to-violet-500/5 border-violet-500/30",
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
    accent: "from-amber-500/20 to-amber-500/5 border-amber-500/30",
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
    accent: "from-pink-500/20 to-pink-500/5 border-pink-500/30",
    items: [
      { href: "/bridge", label: "Cross-Chain Bridge" },
      { href: "/bridge-live", label: "Bridge — Lock & Send (Live)" },
    ],
  },
  {
    title: "Mobile Wallet",
    desc: "Flutter wallet, deep-linked dApp connect, and QR sign.",
    icon: Smartphone,
    accent: "from-blue-500/20 to-blue-500/5 border-blue-500/30",
    items: [
      { href: "/api/mobile/", label: "Open Mobile Wallet (Web Build)", external: true },
      { href: "/connect-wallet", label: "Connect Mobile Wallet (QR)" },
    ],
  },
  {
    title: "API & RPC",
    desc: "REST + JSON-RPC endpoints, status, and downloads.",
    icon: Terminal,
    accent: "from-teal-500/20 to-teal-500/5 border-teal-500/30",
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
    accent: "from-rose-500/20 to-rose-500/5 border-rose-500/30",
    items: [
      { href: "/multisig-explorer", label: "Multisig Explorer" },
      { href: "/governance", label: "Governance (Phase D)" },
      { href: "/chain-status", label: "Chain Features & Hardening" },
    ],
  },
  {
    title: "Tokenomics & Economy",
    desc: "Supply, emission, and economic design tools.",
    icon: Coins,
    accent: "from-yellow-500/20 to-yellow-500/5 border-yellow-500/30",
    items: [
      { href: "/tokenomics", label: "Tokenomics" },
      { href: "/zbx-tokenomics", label: "ZBX Tokenomics Design" },
      { href: "/economic-design", label: "Economic Designer" },
      { href: "/staking", label: "Staking Dashboard" },
    ],
  },
];

export default function DocsPage() {
  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary/80 mb-2">
          <BookOpen className="h-3.5 w-3.5" />
          <span>Documentation</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
          Zebvix Developer Docs
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Everything you need to operate, integrate, and extend the Zebvix L1 chain —
          from spinning up a validator to wiring the mobile wallet into your dApp.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-border/60 bg-card/50 px-3 py-1.5 text-[11px] font-mono text-muted-foreground">
          <Activity className="h-3.5 w-3.5 text-emerald-400" />
          mainnet · chain 7878 · 93.127.213.192
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.title}
              className={`rounded-xl border bg-gradient-to-br ${s.accent} p-5 hover:shadow-lg hover:shadow-primary/5 transition-shadow`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="h-8 w-8 rounded-lg bg-background/60 border border-border/60 flex items-center justify-center">
                  <Icon className="h-4 w-4 text-foreground" />
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  {s.title}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{s.desc}</p>
              <ul className="space-y-1.5">
                {s.items.map((it) =>
                  it.external ? (
                    <li key={it.href}>
                      <a
                        href={it.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-foreground/90 hover:text-primary transition-colors"
                      >
                        <span>{it.label}</span>
                        <ExternalLink className="h-3 w-3 opacity-60" />
                      </a>
                    </li>
                  ) : (
                    <li key={it.href}>
                      <Link href={it.href}>
                        <span className="text-sm text-foreground/90 hover:text-primary transition-colors cursor-pointer">
                          {it.label}
                        </span>
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-10 rounded-xl border border-border/60 bg-card/50 p-6">
        <div className="flex items-start gap-3">
          <Search className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <h3 className="text-base font-semibold mb-1">Can't find what you need?</h3>
            <p className="text-sm text-muted-foreground">
              Use the sidebar — every page in the dashboard is also a doc.
              Live state (heights, balances, prices) is fetched directly from the
              VPS RPC, so what you see here is what's running on the chain.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
