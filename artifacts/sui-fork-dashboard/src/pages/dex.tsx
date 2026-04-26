import React from "react";
import { Link } from "wouter";
import {
  ArrowUpDown, Layers, Droplets, Sparkles, BarChart3, ShieldCheck,
  ChevronRight, Coins, Activity, Wallet, CheckCircle2, Zap
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

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

export default function Dex() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">
            DeFi
          </Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
            LIVE
          </Badge>
          <Badge variant="outline" className="text-blue-400 border-blue-500/40">
            AMM
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Activity className="w-7 h-7 text-primary" />
          Zebvix Decentralized Exchange
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Swap, pool, and trade tokens directly on the Zebvix L1 — no custodian, no intermediary. Every order settles on-chain with a constant-product AMM, and reserves are publicly auditable.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">DEX Capabilities</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                <strong className="text-emerald-400">Native pairs</strong> supported directly at the protocol level.
              </li>
              <li>
                <strong className="text-emerald-400">0.3% Trading Fee</strong> automatically compounds for LPs.
              </li>
              <li>
                <strong className="text-emerald-400">Instant Settlement</strong> with ZVM finality.
              </li>
            </ul>
          </div>
        </div>
        
        <div className="mt-4 flex flex-wrap items-center gap-3 pt-2">
          <Link href="/swap">
            <span className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer transition-colors">
              <ArrowUpDown className="h-4 w-4" />
              Open Swap
            </span>
          </Link>
          <Link href="/pool-explorer">
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 cursor-pointer transition-colors">
              <Droplets className="h-4 w-4 text-muted-foreground" />
              Explore Pools
            </span>
          </Link>
          <Link href="/wallet">
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 cursor-pointer transition-colors">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              Connect Wallet
            </span>
          </Link>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={ArrowUpDown}
          label="Swap Engine"
          value="AMM"
          sub="Constant-product"
        />
        <StatTile
          icon={Zap}
          label="Trading Fee"
          value="0.3%"
          sub="Auto-compounding"
        />
        <StatTile
          icon={ShieldCheck}
          label="Security"
          value="Audited"
          sub="Locked reserves"
        />
        <StatTile
          icon={Layers}
          label="Liquidity"
          value="Open"
          sub="Permissionless LP"
        />
      </div>

      {/* Feature pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {FEATURES.map(({ icon: Icon, label, desc }) => (
          <Card key={label}>
            <CardHeader className="pb-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-2">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-sm">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Action grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            DEX Shortcuts
          </CardTitle>
          <CardDescription>
            Direct links to all trading and liquidity features on chain 7878.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ROUTES.map((r) => {
              const Icon = r.icon;
              return (
                <Link key={r.href} href={r.href}>
                  <span className="group block rounded-xl border border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card/60 p-4 cursor-pointer transition-colors h-full">
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
        </CardContent>
      </Card>

      {/* Footer note */}
      <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-4 rounded-md flex gap-3 text-sm">
        <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-emerald-200">Reserves are public.</div>
          <div className="text-muted-foreground">
            The pool address has no admin key — its balances and trade history are queryable through any
            Zebvix RPC endpoint or directly via{" "}
            <Link href="/pool-explorer">
              <span className="text-emerald-400 hover:underline cursor-pointer">Pool Explorer</span>
            </Link>
            . Liquidity providers receive LP receipts pro-rata to their share of the pool.
          </div>
        </div>
      </div>
    </div>
  );
}
