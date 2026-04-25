import React from "react";
import { LivePulse } from "./live-pulse";

interface PageHeaderProps {
  icon?: React.ElementType;
  title: string;
  subtitle?: string;
  badge?: string;
  live?: boolean;
  right?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  badge,
  live = false,
  right,
  className = "",
}: PageHeaderProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6 ${className}`}
    >
      <div className="pointer-events-none absolute -top-12 -right-12 h-44 w-44 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {Icon && (
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
                <Icon className="h-5 w-5" />
              </span>
            )}
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            {badge && (
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-primary">
                {badge}
              </span>
            )}
            {live && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-emerald-300">
                <LivePulse />
                Live
              </span>
            )}
          </div>
          {subtitle && (
            <p className="max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </div>
  );
}
