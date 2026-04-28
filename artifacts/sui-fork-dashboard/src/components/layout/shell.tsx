import React from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { Footer } from "./footer";
import { SystemBanner } from "./system-banner";
import { TestnetBanner } from "./testnet-banner";
import { MaintenanceGate } from "./maintenance-gate";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <MaintenanceGate>
      <div className="min-h-screen flex flex-col md:flex-row bg-background text-foreground dark">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <TestnetBanner />
          <SystemBanner />
          <Topbar />
          <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-8">
            {children}
          </div>
          <Footer />
        </main>
      </div>
    </MaintenanceGate>
  );
}
