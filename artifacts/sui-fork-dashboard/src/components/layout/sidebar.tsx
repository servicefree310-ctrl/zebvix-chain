import React from "react";
import { Link, useLocation } from "wouter";
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
  Lock
} from "lucide-react";
import { useChecklist } from "@/hooks/useChecklist";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const CORE_NAV = [
  { href: "/", label: "Overview", icon: BookOpen },
  { href: "/quick-start", label: "Quick Start Script", icon: PlayCircle },
  { href: "/setup", label: "Environment Setup", icon: TerminalSquare },
  { href: "/genesis", label: "Genesis Config", icon: FileJson },
  { href: "/validators", label: "Validator Setup", icon: Users },
  { href: "/network", label: "Network Config", icon: Network },
  { href: "/tokenomics", label: "Tokenomics", icon: Coins },
  { href: "/smart-contracts", label: "Smart Contracts (ZVM)", icon: FileCode2 },
  { href: "/customization", label: "Customization", icon: Settings },
  { href: "/checklist", label: "Launch Checklist", icon: CheckSquare },
  { href: "/production", label: "Production Chain", icon: Rocket },
];

const LIVE_NAV = [
  { href: "/live-chain", label: "Live Chain Status", icon: Activity },
  { href: "/wallet", label: "ZBX Wallet (Send / MetaMask)", icon: Wallet },
  { href: "/import-wallet", label: "Import Address (Key / Mnemonic)", icon: KeyRound },
  { href: "/payid-register", label: "Register Pay-ID", icon: UserPlus },
  { href: "/payid-resolver", label: "Pay-ID Resolver", icon: AtSign },
  { href: "/balance-lookup", label: "Balance Lookup", icon: Wallet },
  { href: "/block-explorer", label: "Block Explorer", icon: Search },
  { href: "/rpc-playground", label: "RPC Playground", icon: Terminal },
  { href: "/zvm-explorer", label: "ZVM Explorer (C.2)", icon: Cpu },
  { href: "/pool-explorer", label: "Pool / AMM", icon: Droplets },
  { href: "/multisig-explorer", label: "Multisig Explorer", icon: Shield },
  { href: "/connect-wallet", label: "Connect Mobile Wallet", icon: Smartphone },
  { href: "/api/mobile/", label: "Mobile Wallet (Flutter)", icon: Smartphone, external: true },
  { href: "/swap", label: "Swap (Buy / Sell)", icon: ArrowUpDown },
  { href: "/governance", label: "Governance (Phase D)", icon: Vote },
];

const ADDON_NAV = [
  { href: "/phase-tracker", label: "Phase Tracker", icon: ListChecks },
  { href: "/economic-design", label: "Economic Designer", icon: Calculator },
  { href: "/implementation", label: "Implementation Roadmap", icon: Map },
  { href: "/rebranding", label: "Rebranding Guide", icon: Paintbrush },
  { href: "/zbx-tokenomics", label: "ZBX Tokenomics Design", icon: Coins },
  { href: "/faucet", label: "Testnet Faucet", icon: Droplets },
  { href: "/bridge", label: "Cross-Chain Bridge", icon: ArrowLeftRight },
  { href: "/bridge-live", label: "Bridge — Lock & Send (Live)", icon: Lock },
  { href: "/staking", label: "Staking Dashboard", icon: TrendingUp },
  { href: "/token-create", label: "Create Your Token", icon: Sparkles },
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

export function Sidebar() {
  const [location] = useLocation();
  const { progress } = useChecklist();

  const NavItem = ({
    href,
    label,
    icon: Icon,
    external,
  }: {
    href: string;
    label: string;
    icon: React.ElementType;
    external?: boolean;
  }) => {
    const isActive = !external && location === href;
    const inner = (
      <div
        className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer
          ${isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
    );
    if (external) {
      // Open in a new tab. Inside Replit's preview iframe, programmatic
      // top-frame navigation to a different path is blocked by the sandbox,
      // so we rely on a real anchor + target="_blank" (with user gesture)
      // and fall back to window.open if the click handler runs.
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`link-${href.replace(/[^a-z0-9]/gi, "-")}`}
          onClick={(e) => {
            // Let the browser handle target="_blank" by default. If for some
            // reason that's blocked, manually open a new window.
            try {
              const w = window.open(href, "_blank", "noopener,noreferrer");
              if (w) {
                e.preventDefault();
              }
            } catch {
              // ignore — anchor default will kick in
            }
          }}
        >
          {inner}
        </a>
      );
    }
    return <Link href={href}>{inner}</Link>;
  };

  const NavLinks = () => (
    <nav className="space-y-0.5">
      {CORE_NAV.map((item) => <NavItem key={item.href} {...item} />)}
      <div className="pt-3 pb-1 px-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-green-500/80">● Live (VPS RPC)</span>
      </div>
      {LIVE_NAV.map((item) => <NavItem key={item.href} {...item} />)}
      <div className="pt-3 pb-1 px-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-primary/60">Addons</span>
      </div>
      {ADDON_NAV.map((item) => <NavItem key={item.href} {...item} />)}
    </nav>
  );

  const ProgressWidget = () => (
    <div className="p-4 mt-6 bg-card border border-border rounded-lg shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">Launch Readiness</span>
        <span className="text-xs font-mono text-primary">{progress}%</span>
      </div>
      <Progress value={progress} className="h-1.5" />
    </div>
  );

  return (
    <>
      {/* Mobile Sidebar */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <div className="w-2.5 h-2.5 bg-background rounded-sm" />
            </div>
            <span className="font-semibold text-foreground tracking-tight">Zebvix</span>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono pl-8 tracking-wide">Zebvix Technologies Pvt Ltd</p>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-4 bg-background border-r border-border">
            <div className="mb-6 px-2">
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-0.5">
                  <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
                    <div className="w-2.5 h-2.5 bg-background rounded-sm" />
                  </div>
                  <span className="font-semibold text-foreground tracking-tight">Zebvix</span>
                </div>
                <p className="text-[10px] text-muted-foreground font-mono pl-8 tracking-wide">Zebvix Technologies Pvt Ltd</p>
              </div>
              <NavLinks />
              <ProgressWidget />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden md:flex flex-col w-64 border-r border-border bg-card/50 h-screen sticky top-0 overflow-y-auto">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center shadow-[0_0_15px_rgba(34,197,94,0.35)]">
              <div className="w-3 h-3 bg-background rounded-sm" />
            </div>
            <span className="font-bold text-lg text-foreground tracking-tight">Zebvix</span>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono pl-9 mb-5 tracking-wide">Zebvix Technologies Pvt Ltd</p>
          <NavLinks />
          <ProgressWidget />
        </div>
      </div>
    </>
  );
}
