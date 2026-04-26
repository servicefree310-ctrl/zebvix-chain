import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  TerminalSquare,
  FileJson,
  Users,
  Network,
  Coins,
  Settings,
  CheckSquare,
  Menu,
  Rocket,
  PlayCircle,
  Search,
  Wallet,
  Droplets,
  ArrowLeftRight,
  TrendingUp,
  ArrowUpDown,
  ArrowDownUp,
  Map,
  Paintbrush,
  ListChecks,
  Calculator,
  Layers,
  FileCode2,
  Download,
  Code2,
  Sparkles,
  GitBranch,
  Activity,
  Shield,
  AtSign,
  Smartphone,
  Cpu,
  Vote,
  Terminal,
  UserPlus,
  KeyRound,
  Info,
  Lock,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Zap,
  Radio,
  Star,
  X,
  Package,
  Hammer,
} from "lucide-react";
import { useChecklist } from "@/hooks/useChecklist";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

// ─────────────────────────────────────────────────────────────────────────────
// Nav data — `badge` is optional and renders as a small pill next to the label.
// Keep this list flat (no nesting) so the search filter stays trivial.
// ─────────────────────────────────────────────────────────────────────────────
type NavBadge = "LIVE" | "NEW" | "PRO";
type NavLink = {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: NavBadge;
  external?: boolean;
};

const CORE_NAV: NavLink[] = [
  { href: "/", label: "Overview", icon: BookOpen },
  { href: "/chain-builder", label: "Build Your Own Chain", icon: Hammer, badge: "NEW" },
  { href: "/docs", label: "Documentation", icon: BookOpen },
  { href: "/quick-start", label: "Quick Start Script", icon: PlayCircle },
  { href: "/setup", label: "Environment Setup", icon: TerminalSquare },
  { href: "/genesis", label: "Genesis Config", icon: FileJson },
  { href: "/validators", label: "Validator Setup", icon: Users },
  { href: "/network", label: "Network Config", icon: Network },
  { href: "/tokenomics", label: "Tokenomics", icon: Coins },
  { href: "/smart-contracts", label: "Smart Contracts", icon: FileCode2, badge: "LIVE" },
  { href: "/customization", label: "Customization", icon: Settings },
  { href: "/checklist", label: "Launch Checklist", icon: CheckSquare },
  { href: "/production", label: "Production Chain", icon: Rocket },
  { href: "/sdk", label: "Developer SDK (zebvix.js)", icon: Package, badge: "NEW" },
];

const LIVE_NAV: NavLink[] = [
  { href: "/live-chain", label: "Live Chain Status", icon: Activity, badge: "LIVE" },
  { href: "/wallet", label: "ZBX Wallet (Send / MetaMask)", icon: Wallet, badge: "LIVE" },
  { href: "/import-wallet", label: "Import Address (Key / Mnemonic)", icon: KeyRound },
  { href: "/payid-register", label: "Register Pay-ID", icon: UserPlus },
  { href: "/payid-resolver", label: "Pay-ID Resolver", icon: AtSign },
  { href: "/balance-lookup", label: "Balance Lookup", icon: Wallet },
  { href: "/block-explorer", label: "Block Explorer", icon: Search },
  { href: "/rpc-playground", label: "RPC Playground", icon: Terminal },
  { href: "/zvm-explorer", label: "ZVM Explorer", icon: Cpu, badge: "LIVE" },
  { href: "/pool-explorer", label: "Pool / AMM", icon: Droplets },
  { href: "/multisig-explorer", label: "Multisig Explorer", icon: Shield },
  { href: "/connect-wallet", label: "Connect Mobile Wallet", icon: Smartphone },
  { href: "/api/mobile/", label: "Mobile Wallet (Flutter)", icon: Smartphone, external: true, badge: "NEW" },
  { href: "/swap", label: "Swap (Buy / Sell)", icon: ArrowUpDown },
  { href: "/governance", label: "Governance", icon: Vote },
];

const ADDON_NAV: NavLink[] = [
  { href: "/phase-tracker", label: "Phase Tracker", icon: ListChecks },
  { href: "/economic-design", label: "Economic Designer", icon: Calculator },
  { href: "/implementation", label: "Implementation Roadmap", icon: Map },
  { href: "/rebranding", label: "Rebranding Guide", icon: Paintbrush },
  { href: "/zbx-tokenomics", label: "ZBX Tokenomics Design", icon: Coins },
  { href: "/faucet", label: "Testnet Faucet", icon: Droplets },
  { href: "/bridge", label: "Cross-Chain Bridge", icon: ArrowLeftRight },
  { href: "/bridge-live", label: "Bridge — Lock & Send", icon: Lock, badge: "LIVE" },
  { href: "/staking", label: "Staking Dashboard", icon: TrendingUp },
  { href: "/token-create", label: "Create Your Token", icon: Sparkles, badge: "NEW" },
  { href: "/token-trade", label: "Token Trade (AMM)", icon: ArrowDownUp },
  { href: "/token-liquidity", label: "Token Liquidity", icon: Droplets },
  { href: "/token-metadata", label: "Token Metadata", icon: Info },
  { href: "/dex", label: "DEX / Swap", icon: ArrowUpDown },
  { href: "/fabric-layer", label: "Zebvix Fabric Layer", icon: Layers },
  { href: "/code-review", label: "Code Review — What Changed", icon: FileCode2 },
  { href: "/chain-code", label: "Chain Source Code", icon: Code2 },
  { href: "/chain-status", label: "Chain Features", icon: Sparkles },
  { href: "/consensus-roadmap", label: "Consensus Roadmap (DAG-BFT)", icon: GitBranch },
  { href: "/downloads", label: "Downloads", icon: Download },
];

const SECTIONS: {
  id: string;
  title: string;
  icon: React.ElementType;
  accent: string;
  items: NavLink[];
}[] = [
  { id: "core", title: "Build & Configure", icon: Settings, accent: "text-primary", items: CORE_NAV },
  { id: "live", title: "Live VPS RPC", icon: Radio, accent: "text-emerald-400", items: LIVE_NAV },
  { id: "addons", title: "Add-ons & Tools", icon: Sparkles, accent: "text-violet-400", items: ADDON_NAV },
];

// ─────────────────────────────────────────────────────────────────────────────
// Live chain status — reuses the same `/api/chain/status` endpoint that the
// topbar polls so we never double up on RPC traffic.
// ─────────────────────────────────────────────────────────────────────────────
type ChainStatus = {
  height?: number | string;
  peers?: number;
  chainId?: number | string;
  network?: string;
  ok?: boolean;
};

async function fetchChainStatus(): Promise<ChainStatus | null> {
  try {
    const r = await fetch("/api/chain/status", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as ChainStatus;
  } catch {
    return null;
  }
}

function useLiveChain() {
  return useQuery({
    queryKey: ["sidebar-chain-status"],
    queryFn: fetchChainStatus,
    refetchInterval: 5_000,
    staleTime: 4_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status pill colours.
// ─────────────────────────────────────────────────────────────────────────────
function badgeClass(b: NavBadge): string {
  switch (b) {
    case "LIVE": return "border-emerald-500/40 text-emerald-300 bg-emerald-500/10";
    case "NEW":  return "border-sky-500/40 text-sky-300 bg-sky-500/10";
    case "PRO":  return "border-violet-500/40 text-violet-300 bg-violet-500/10";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persisted UI state hooks — collapsed sections + rail mode survive reloads.
// ─────────────────────────────────────────────────────────────────────────────
function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setVal(v);
    try {
      window.localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // localStorage unavailable (private mode etc.) — just keep in-memory.
    }
  };
  return [val, set];
}

// ─────────────────────────────────────────────────────────────────────────────
// FAVOURITES — quick-access pinned items, persisted to localStorage.
// ─────────────────────────────────────────────────────────────────────────────
function useFavourites() {
  const [favs, setFavs] = useLocalState<string[]>("zbx-sidebar-favs", [
    "/", "/wallet", "/live-chain", "/smart-contracts",
  ]);
  const toggle = (href: string) => {
    if (favs.includes(href)) setFavs(favs.filter((h) => h !== href));
    else setFavs([...favs, href]);
  };
  return { favs, toggle };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main sidebar component.
// ─────────────────────────────────────────────────────────────────────────────
export function Sidebar() {
  const [location] = useLocation();
  const { progress } = useChecklist();
  const { data: chain } = useLiveChain();
  const [collapsed, setCollapsed] = useLocalState<Record<string, boolean>>(
    "zbx-sidebar-collapsed",
    { core: false, live: false, addons: true }, // addons collapsed by default
  );
  const [rail, setRail] = useLocalState<boolean>("zbx-sidebar-rail", false);
  const [query, setQuery] = useState("");
  const { favs, toggle: toggleFav } = useFavourites();

  // Cmd/Ctrl+K to focus search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const el = document.getElementById("zbx-sidebar-search") as HTMLInputElement | null;
        el?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const allItems = useMemo(
    () => SECTIONS.flatMap((s) => s.items.map((i) => ({ ...i, section: s.id }))),
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return allItems.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.href.toLowerCase().includes(q),
    );
  }, [query, allItems]);

  const favItems = useMemo(
    () => allItems.filter((i) => favs.includes(i.href)),
    [allItems, favs],
  );

  const live = !!chain && chain.ok !== false;
  const height =
    typeof chain?.height === "number" || typeof chain?.height === "string"
      ? String(chain.height)
      : null;
  const peers = typeof chain?.peers === "number" ? chain.peers : null;

  // **Architect-fix (critical):** all sub-components are inlined below as
  // helper functions returning JSX (NOT React component types). This
  // prevents a new component identity on every Sidebar render, which would
  // unmount/remount the search input + lose focus on every keystroke.
  // We render with `{renderBody()}` so React reconciles the JSX in-place.

  const renderNavItem = (
    item: NavLink,
    opts: { keyPrefix?: string; showFavStar?: boolean } = {},
  ) => {
    const { href, label, icon: Icon, external, badge } = item;
    const showFavStar = opts.showFavStar !== false;
    const isActive = !external && location === href;
    const isFav = favs.includes(href);

    const inner = (
      <div
        className={`group flex items-center gap-3 rounded-md text-sm font-medium transition-all cursor-pointer relative
          ${rail ? "px-2 py-2 justify-center" : "px-3 py-2"}
          ${
            isActive
              ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_rgba(34,197,94,0.25)]"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        title={rail ? label : undefined}
        aria-label={rail ? label : undefined}
      >
        {isActive && !rail && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
        )}
        <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
        {!rail && (
          <>
            <span className="truncate flex-1">{label}</span>
            {badge && (
              <span
                className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${badgeClass(badge)}`}
              >
                {badge}
              </span>
            )}
            {showFavStar && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleFav(href);
                }}
                className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted ${
                  isFav ? "opacity-100 text-amber-400" : "text-muted-foreground"
                }`}
                aria-label={isFav ? `Unpin ${label}` : `Pin ${label} to favourites`}
              >
                <Star className={`h-3 w-3 ${isFav ? "fill-current" : ""}`} />
              </button>
            )}
          </>
        )}
        {rail && badge && (
          <span
            className={`absolute top-1 right-1 h-1.5 w-1.5 rounded-full ${
              badge === "LIVE" ? "bg-emerald-400" :
              badge === "NEW"  ? "bg-sky-400" :
              "bg-violet-400"
            }`}
            aria-hidden="true"
          />
        )}
      </div>
    );

    const key = `${opts.keyPrefix ?? "nav"}-${href}`;

    if (external) {
      return (
        <a
          key={key}
          href={href}
          target="_blank" rel="noopener noreferrer"
          data-testid={`link-${href.replace(/[^a-z0-9]/gi, "-")}`}
          aria-label={label}
          onClick={(e) => {
            try {
              const w = window.open(href, "_blank", "noopener,noreferrer");
              if (w) e.preventDefault();
            } catch {
              // ignore — anchor default will kick in
            }
          }}
        >
          {inner}
        </a>
      );
    }
    return (
      <Link key={key} href={href}>
        {inner}
      </Link>
    );
  };

  const renderLiveCard = () => {
    if (rail) return null;
    return (
      <div
        className={`mb-3 rounded-lg border p-3 transition-colors ${
          live
            ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5"
            : "border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-amber-500/5"
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                live ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
              }`}
            />
            <span className={live ? "text-emerald-300" : "text-amber-300"}>
              {live ? "VPS Online" : "Connecting"}
            </span>
          </span>
          <Zap className={`h-3 w-3 ${live ? "text-emerald-400/60" : "text-amber-400/60"}`} />
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
          <div className="flex flex-col">
            <span className="text-muted-foreground/60 uppercase tracking-wider text-[9px]">Block</span>
            <span className="text-foreground/90 truncate">{height ? `#${height}` : "—"}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground/60 uppercase tracking-wider text-[9px]">Peers</span>
            <span className="text-foreground/90">{peers ?? "—"}</span>
          </div>
          <div className="flex flex-col col-span-2">
            <span className="text-muted-foreground/60 uppercase tracking-wider text-[9px]">Chain</span>
            <span className="text-foreground/90">ZBX · 7878 · Cancun</span>
          </div>
        </div>
      </div>
    );
  };

  const renderSearchBox = () => {
    if (rail) return null;
    return (
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
        <input
          id="zbx-sidebar-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search..."
          aria-label="Search navigation"
          className="w-full bg-muted/30 border border-border/50 rounded-md pl-8 pr-12 py-1.5 text-xs text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:bg-muted/50 transition-colors"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground"
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        ) : (
          <kbd
            aria-hidden="true"
            className="hidden lg:flex absolute right-2 top-1/2 -translate-y-1/2 items-center gap-0.5 text-[9px] font-mono text-muted-foreground/50 border border-border/50 rounded px-1 py-0.5"
          >
            ⌘K
          </kbd>
        )}
      </div>
    );
  };

  const renderSection = (s: (typeof SECTIONS)[number]) => {
    const Icon = s.icon;
    const isCollapsed = !!collapsed[s.id];
    const toggle = () => setCollapsed({ ...collapsed, [s.id]: !isCollapsed });
    if (rail) {
      return (
        <div key={s.id} className="space-y-0.5">
          {s.items.map((item) => renderNavItem(item, { keyPrefix: s.id, showFavStar: false }))}
        </div>
      );
    }
    return (
      <div key={s.id} className="mb-1">
        <button
          type="button"
          onClick={toggle}
          className="w-full flex items-center justify-between gap-2 px-3 py-1.5 mt-2 mb-0.5 rounded-md hover:bg-muted/30 transition-colors group"
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${s.title} section`}
        >
          <span className="flex items-center gap-1.5">
            <Icon className={`h-3 w-3 ${s.accent}`} />
            <span className={`text-[10px] font-bold uppercase tracking-widest ${s.accent} opacity-90`}>
              {s.title}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground/40">{s.items.length}</span>
          </span>
          <ChevronDown
            className={`h-3 w-3 text-muted-foreground/60 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
          />
        </button>
        <div
          className={`overflow-hidden transition-all duration-200 ${
            isCollapsed ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100"
          }`}
        >
          <div className="space-y-0.5">
            {s.items.map((item) => renderNavItem(item, { keyPrefix: s.id }))}
          </div>
        </div>
      </div>
    );
  };

  const renderSearchResults = (results: NavLink[]) => {
    if (results.length === 0) {
      return (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground/70">
          <Search className="h-4 w-4 mx-auto mb-2 opacity-40" aria-hidden="true" />
          No matches for "{query}"
        </div>
      );
    }
    return (
      <div className="space-y-0.5">
        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          {results.length} result{results.length === 1 ? "" : "s"}
        </div>
        {results.map((item) => renderNavItem(item, { keyPrefix: "search" }))}
      </div>
    );
  };

  const renderFavStrip = () => {
    if (rail || filtered || favItems.length === 0) return null;
    return (
      <div className="mb-1">
        <div className="flex items-center gap-1.5 px-3 py-1.5 mt-1">
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80">
            Pinned
          </span>
          <span className="text-[10px] font-mono text-muted-foreground/40">{favItems.length}</span>
        </div>
        <div className="space-y-0.5">
          {favItems.map((item) => renderNavItem(item, { keyPrefix: "fav" }))}
        </div>
      </div>
    );
  };

  const renderProgressWidget = () => {
    if (rail) return null;
    return (
      <div className="mt-4 p-3 bg-card/60 border border-border/60 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Rocket className="h-3 w-3" aria-hidden="true" />
            Launch Readiness
          </span>
          <span className="text-xs font-mono text-primary font-semibold">{progress}%</span>
        </div>
        <Progress value={progress} className="h-1" />
        <Link href="/checklist">
          <span
            className="block mt-2 text-[10px] text-muted-foreground hover:text-primary cursor-pointer transition-colors"
            role="link"
          >
            View checklist →
          </span>
        </Link>
      </div>
    );
  };

  const renderBrand = (compact: boolean) => (
    <div className={`mb-4 ${compact ? "flex justify-center" : ""}`}>
      <div className={`flex items-center gap-2 ${compact ? "" : "mb-0.5"}`}>
        <div
          className="w-7 h-7 rounded bg-primary flex items-center justify-center shadow-[0_0_15px_rgba(34,197,94,0.35)] shrink-0"
          aria-hidden="true"
        >
          <div className="w-3 h-3 bg-background rounded-sm" />
        </div>
        {!compact && (
          <span className="font-bold text-lg text-foreground tracking-tight">Zebvix</span>
        )}
      </div>
      {!compact && (
        <p className="text-[10px] text-muted-foreground font-mono pl-9 tracking-wide">
          Zebvix Technologies Pvt Ltd
        </p>
      )}
    </div>
  );

  const renderBody = () => (
    <>
      {renderBrand(rail)}
      {renderLiveCard()}
      {renderSearchBox()}
      {filtered ? (
        renderSearchResults(filtered)
      ) : (
        <>
          {renderFavStrip()}
          <nav className="space-y-1" aria-label="Primary navigation">
            {SECTIONS.map(renderSection)}
          </nav>
        </>
      )}
      {renderProgressWidget()}
    </>
  );

  // ───────────────────────────────────────────────────────────────────────
  // Render — mobile sheet + desktop sticky rail.
  // ───────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Mobile header bar with hamburger */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <div className="w-2.5 h-2.5 bg-background rounded-sm" />
            </div>
            <span className="font-semibold text-foreground tracking-tight">
              Zebvix
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono pl-8 tracking-wide">
            Zebvix Technologies Pvt Ltd
          </p>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-72 p-4 bg-background border-r border-border overflow-y-auto"
          >
            {renderBody()}
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop sticky sidebar */}
      <div
        className={`hidden md:flex flex-col border-r border-border bg-card/40 backdrop-blur h-screen sticky top-0 overflow-y-auto transition-[width] duration-200 ${
          rail ? "w-16" : "w-72"
        }`}
      >
        <div className={`flex-1 ${rail ? "p-2" : "p-3"}`}>
          {renderBody()}
        </div>
        {/* Rail toggle — pinned to bottom */}
        <button
          type="button"
          onClick={() => setRail(!rail)}
          className={`flex items-center gap-2 border-t border-border/60 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors ${
            rail ? "justify-center" : ""
          }`}
          title={rail ? "Expand sidebar" : "Collapse to rail"}
        >
          {rail ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </>
  );
}
