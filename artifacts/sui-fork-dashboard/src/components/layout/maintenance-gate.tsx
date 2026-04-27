import React from "react";
import { useLocation } from "wouter";
import { Wrench } from "lucide-react";
import { useBrandConfig, useSystemConfig } from "@/lib/use-brand-config";

// Full-page overlay that hides the dashboard when the admin enables
// maintenance mode. The /admin route is always exempt so the admin can turn
// the gate back off without needing to edit the database directly.
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const sys = useSystemConfig();
  const brand = useBrandConfig();
  const [location] = useLocation();

  const isAdminRoute = location === "/admin" || location.startsWith("/admin/");
  if (!sys.maintenanceMode || isAdminRoute) return <>{children}</>;

  const message =
    (sys.maintenanceMessage ?? "").trim() || "We'll be back shortly.";

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
          <Wrench className="h-8 w-8 text-amber-300" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {brand.brandName || "Dashboard"} is in maintenance
          </h1>
          <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
            {message}
          </p>
        </div>
        <div className="text-xs text-muted-foreground/60">
          Chain {brand.chainName} · ID {brand.chainId}
        </div>
        <a
          href="/admin"
          className="inline-block text-xs text-muted-foreground hover:text-foreground underline"
          data-testid="link-admin-from-maintenance"
        >
          Admin sign-in
        </a>
      </div>
    </div>
  );
}
