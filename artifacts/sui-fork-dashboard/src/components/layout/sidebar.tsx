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
  Rocket
} from "lucide-react";
import { useChecklist } from "@/hooks/useChecklist";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: BookOpen },
  { href: "/setup", label: "Environment Setup", icon: TerminalSquare },
  { href: "/genesis", label: "Genesis Config", icon: FileJson },
  { href: "/validators", label: "Validator Setup", icon: Users },
  { href: "/network", label: "Network Config", icon: Network },
  { href: "/tokenomics", label: "Tokenomics", icon: Coins },
  { href: "/customization", label: "Customization", icon: Settings },
  { href: "/checklist", label: "Launch Checklist", icon: CheckSquare },
  { href: "/production", label: "Production Chain", icon: Rocket },
];

export function Sidebar() {
  const [location] = useLocation();
  const { progress } = useChecklist();

  const NavLinks = () => (
    <nav className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const isActive = location === item.href;
        const Icon = item.icon;
        
        return (
          <Link key={item.href} href={item.href}>
            <div
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer
                ${isActive 
                  ? "bg-primary/10 text-primary" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </div>
          </Link>
        );
      })}
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
            <span className="font-semibold text-foreground tracking-tight">Zebvix Dev</span>
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
                  <span className="font-semibold text-foreground tracking-tight">Zebvix Dev</span>
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
      <div className="hidden md:flex flex-col w-64 border-r border-border bg-card/50 h-screen sticky top-0">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center shadow-[0_0_15px_rgba(34,197,94,0.35)]">
              <div className="w-3 h-3 bg-background rounded-sm" />
            </div>
            <span className="font-bold text-lg text-foreground tracking-tight">Zebvix Dev</span>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono pl-9 mb-5 tracking-wide">Zebvix Technologies Pvt Ltd</p>
          <NavLinks />
          <ProgressWidget />
        </div>
      </div>
    </>
  );
}
