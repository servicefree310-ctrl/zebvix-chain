import React from "react";
import { Sidebar } from "./sidebar";
import { WalletPicker } from "@/components/ui/wallet-picker";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background text-foreground dark">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border/60 bg-background/85 px-4 py-2.5 backdrop-blur md:px-8">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            <span className="hidden sm:inline">Zebvix L1</span>
            <span className="hidden font-mono text-primary/70 sm:inline">·</span>
            <span className="hidden font-mono text-primary/70 sm:inline">chain 7878</span>
            <span className="hidden font-mono text-primary/70 sm:inline">·</span>
            <span className="hidden font-mono text-emerald-300/80 sm:inline">93.127.213.192</span>
          </div>
          <WalletPicker />
        </div>
        <div className="max-w-5xl mx-auto p-6 md:p-8 pb-24">
          {children}
        </div>
      </main>
    </div>
  );
}
