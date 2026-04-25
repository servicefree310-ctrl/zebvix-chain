import React from "react";

interface SectionCardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ElementType;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  tone?: "default" | "primary" | "warn" | "danger" | "success";
}

const toneRing: Record<NonNullable<SectionCardProps["tone"]>, string> = {
  default: "border-border",
  primary: "border-primary/30 ring-1 ring-primary/10",
  warn: "border-amber-500/40 ring-1 ring-amber-500/10",
  danger: "border-red-500/40 ring-1 ring-red-500/10",
  success: "border-emerald-500/40 ring-1 ring-emerald-500/10",
};

export function SectionCard({
  title,
  subtitle,
  icon: Icon,
  right,
  children,
  className = "",
  bodyClassName = "",
  tone = "default",
}: SectionCardProps) {
  return (
    <div className={`rounded-xl border bg-card/60 backdrop-blur-sm shadow-sm ${toneRing[tone]} ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && (
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {Icon && <Icon className="h-4 w-4 text-primary" />}
                <span className="truncate">{title}</span>
              </div>
            )}
            {subtitle && (
              <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
            )}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      )}
      <div className={`p-4 sm:p-5 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ElementType;
  accent?: "default" | "primary" | "success" | "warn" | "danger";
  className?: string;
}

const accentText: Record<NonNullable<StatProps["accent"]>, string> = {
  default: "text-foreground",
  primary: "text-primary",
  success: "text-emerald-300",
  warn: "text-amber-300",
  danger: "text-red-400",
};

export function Stat({ label, value, hint, icon: Icon, accent = "default", className = "" }: StatProps) {
  return (
    <div className={`rounded-lg border border-border/70 bg-card/70 p-4 ${className}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className="h-4 w-4 text-primary/70" />}
      </div>
      <div className={`font-mono text-2xl font-bold tabular-nums ${accentText[accent]}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
