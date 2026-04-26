import React from "react";
import { Link } from "wouter";
import {
  ArrowUpDown, Layers, Droplets, Sparkles, BarChart3, ShieldCheck,
  ChevronRight, Coins, Activity, Wallet,
} from "lucide-react";

const FEATURES = [
  { icon: ArrowUpDown, label: "Instant Swap",       desc: "Native ZBX ↔ zUSD with millisecond confirmation."     },
  { icon: Layers,      label: "Liquidity Pools",    desc: "Constant-product AMM — anyone can provide liquidity." },
  { icon: BarChart3,   label: "Live Pricing",       desc: "On-chain spot price feeds the wallet + dApps."        },
  { icon: ShieldCheck, label: "Audited Contracts",  desc: "Reserves locked at genesis; no privileged withdraw."  },
];

const ROUTES: { href: string; icon: React.ElementType; title: string; desc: string; }[] = [
  { href: "/swap",            icon: ArrowUpDown, title: "Swap (Buy / Sell)",   desc: "Trade ZBX ↔ zUSD with real-time slippage." },
  { href: "/pool-explorer",   icon: Droplets,    title: "Pool / AMM",          desc: "View live reserves, price, and fees." },
  { href: "/token-create",    icon: Sparkles,    title: "Create Your Token",   desc: "Mint a new token on Zebvix in one click." },
  { href: "/token-trade",     icon: ArrowUpDown, title: "Token Trade",         desc: "Trade any pair via the AMM router." },
  { href: "/token-liquidity", icon: Layers,      title: "Add Liquidity",       desc: "Earn fees by depositing token pairs." },
  { href: "/token-metadata",  icon: Coins,       title: "Token Metadata",      desc: "Set logo, decimals, supply for your token." },
];

export default function Dex() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <header>
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-[10px] font-bold uppercase tracking-widest mb-3">
          <Activity className="h-3 w-3" />
          DEX Live
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-2">
          Zebvix Decentralized Exchange
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-3xl">
          Swap, pool, and trade tokens directly on the Zebvix L1 — no custodian, no intermediary.
          Every order settles on-chain with a constant-product AMM, and reserves are publicly auditable.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link href="/swap">
            <span className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer transition-colors">
              <ArrowUpDown className="h-4 w-4" />
              Open Swap
            </span>
          </Link>
          <Link href="/pool-explorer">
            <span className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-4 py-2 text-sm font-medium text-foreground hover:bg-card cursor-pointer transition-colors">
              <Droplets className="h-4 w-4" />
              Explore Pools
            </span>
          </Link>
          <Link href="/wallet">
            <span className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-4 py-2 text-sm font-medium text-foreground hover:bg-card cursor-pointer transition-colors">
              <Wallet className="h-4 w-4" />
              Connect Wallet
            </span>
          </Link>
        </div>
      </header>

      {/* Feature pills */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {FEATURES.map(({ icon: Icon, label, desc }) => (
          <div
            key={label}
            className="rounded-xl border border-border/60 bg-gradient-to-br from-card/60 to-card/20 backdrop-blur p-4"
          >
            <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div className="text-sm font-semibold text-foreground">{label}</div>
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</div>
          </div>
        ))}
      </section>

      {/* AMM mechanics card */}
      <section className="rounded-xl border border-border/60 bg-card/40 backdrop-blur p-5">
        <header className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            How the AMM works
          </h2>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          {[
            { t: "Constant-Product Curve", d: "Reserves obey x · y = k. Any swap shifts the price along the curve." },
            { t: "0.3% Trading Fee",       d: "Collected from each swap; auto-compounded into LP value." },
            { t: "Permissionless LPs",     d: "Anyone can add or remove liquidity at any time." },
          ].map((x) => (
            <div key={x.t} className="rounded-lg border border-border/40 bg-background/40 p-3">
              <div className="text-sm font-semibold text-foreground">{x.t}</div>
              <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{x.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Action grid */}
      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            DEX shortcuts
          </h2>
          <span className="text-[10px] font-mono text-muted-foreground/60">
            All flows live on chain 7878
          </span>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {ROUTES.map((r) => {
            const Icon = r.icon;
            return (
              <Link key={r.href} href={r.href}>
                <span className="group block rounded-xl border border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card/60 p-4 cursor-pointer transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                          {r.title}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{r.desc}</div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1 group-hover:text-primary transition-colors" />
                  </div>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Footer note */}
      <section className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 p-5 text-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-emerald-300">Reserves are public.</div>
            <div className="text-foreground/80">
              The pool address has no admin key — its balances and trade history are queryable through any
              Zebvix RPC endpoint or directly via{" "}
              <Link href="/pool-explorer">
                <span className="text-emerald-300 hover:underline cursor-pointer">Pool Explorer</span>
              </Link>
              . Liquidity providers receive LP receipts pro-rata to their share of the pool.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
