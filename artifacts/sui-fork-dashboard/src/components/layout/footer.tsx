import React from "react";
import { Link } from "wouter";
import {
  BookOpen,
  Activity,
  Download,
  Smartphone,
  Github,
  Shield,
  ExternalLink,
} from "lucide-react";
import { useBrandConfig } from "@/lib/use-brand-config";
import { useNetwork, networkMeta } from "@/lib/use-network";

const VERSION = "v1.0.0";
const YEAR = new Date().getFullYear();

type LinkDef = {
  href: string;
  label: string;
  icon?: React.ElementType;
  external?: boolean;
};

const NETWORK: LinkDef[] = [
  { href: "/live-chain", label: "Live Chain Status", icon: Activity },
  { href: "/block-explorer", label: "Block Explorer" },
  { href: "/rpc-playground", label: "RPC Playground" },
  { href: "/production", label: "Production Chain" },
];

const RESOURCES: LinkDef[] = [
  { href: "/docs", label: "Documentation", icon: BookOpen },
  { href: "/downloads", label: "Downloads", icon: Download },
  { href: "/api/mobile/", label: "Mobile Wallet", icon: Smartphone, external: true },
  { href: "/code-review", label: "What Changed", icon: Github },
];

const LEGAL: LinkDef[] = [
  { href: "/customization", label: "Customization" },
  { href: "/checklist", label: "Launch Checklist" },
  { href: "/chain-status", label: "Security & Features", icon: Shield },
];

function Col({ title, items }: { title: string; items: LinkDef[] }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        {title}
      </h4>
      <ul className="space-y-2 text-sm">
        {items.map((it) => {
          const Icon = it.icon;
          const inner = (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
              {Icon ? <Icon className="h-3.5 w-3.5 opacity-70" /> : null}
              <span>{it.label}</span>
              {it.external ? <ExternalLink className="h-3 w-3 opacity-60" /> : null}
            </span>
          );
          if (it.external) {
            return (
              <li key={it.href}>
                <a href={it.href} target="_blank" rel="noopener noreferrer">
                  {inner}
                </a>
              </li>
            );
          }
          return (
            <li key={it.href}>
              <Link href={it.href}>{inner}</Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Footer() {
  const footerNet = useNetwork();
  const netMeta = networkMeta(footerNet);
  return <FooterInner netMeta={netMeta} />;
}

function FooterInner({ netMeta }: { netMeta: ReturnType<typeof networkMeta> }) {
  const brand = useBrandConfig();
  return (
    <footer className="mt-16 border-t border-border/60 bg-card/30">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded bg-primary flex items-center justify-center shadow-[0_0_15px_rgba(34,197,94,0.35)]">
                <div className="w-2.5 h-2.5 bg-background rounded-sm" />
              </div>
              <span className="font-bold text-foreground" data-testid="footer-brand-name">
                {brand.brandName}
              </span>
            </div>
            <p
              className="text-xs text-muted-foreground leading-relaxed mb-3"
              data-testid="footer-brand-tagline"
            >
              {brand.brandTagline}
            </p>
            <div className="text-[11px] font-mono text-muted-foreground space-y-0.5">
              <div>
                Chain ID{" "}
                <span className="text-primary/80" data-testid="footer-chain-id">
                  {brand.chainId}
                </span>
              </div>
              <div>
                Build <span className="text-primary/80">{VERSION}</span>
              </div>
              {brand.brandDomain && (
                <div>
                  Domain{" "}
                  <span className="text-primary/80" data-testid="footer-brand-domain">
                    {brand.brandDomain}
                  </span>
                </div>
              )}
            </div>
          </div>
          <Col title="Network" items={NETWORK} />
          <Col title="Resources" items={RESOURCES} />
          <Col title="Operations" items={LEGAL} />
        </div>
        <div className="mt-8 pt-6 border-t border-border/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <div>
            © {YEAR} {brand.brandName} Technologies. All rights reserved.
          </div>
          <div className="flex items-center gap-3 font-mono">
            <span className="inline-flex items-center gap-1.5" data-testid="footer-network">
              <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${netMeta.isTestnet ? "bg-amber-400" : "bg-emerald-400"}`} />
              {netMeta.label.toLowerCase()} · {netMeta.rpcUrl.replace(/^https?:\/\//, "").replace(/:[0-9]+$/, "")} · chain {netMeta.chainId}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
