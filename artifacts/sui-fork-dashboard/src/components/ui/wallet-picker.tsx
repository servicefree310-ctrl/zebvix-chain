import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Wallet,
  ChevronDown,
  Plus,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Sparkles,
} from "lucide-react";
import { useWallet } from "@/contexts/wallet-context";
import { useToast } from "@/hooks/use-toast";
import { rpc, weiHexToZbx, shortAddr } from "@/lib/zbx-rpc";
import { LivePulse } from "./live-pulse";

/**
 * Top-bar wallet picker — visible on every page via Shell.
 * Shows active address + balance + dropdown to switch / create / import.
 */
export function WalletPicker() {
  const { wallets, active, setActive, addGenerated } = useWallet();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [bal, setBal] = useState<string>("—");

  useEffect(() => {
    if (!active) {
      setBal("—");
      return;
    }
    let cancelled = false;
    const tick = () => {
      rpc<string>("zbx_getBalance", [active.address])
        .then((b) => {
          if (!cancelled) setBal(weiHexToZbx(b));
        })
        .catch(() => {
          if (!cancelled) setBal("—");
        });
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("[data-wallet-picker]")) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied", description: shortAddr(text) });
    });
  };

  if (!active) {
    return (
      <div className="flex items-center gap-2" data-wallet-picker>
        <button
          onClick={() => addGenerated()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Create Wallet
        </button>
        <Link href="/wallet">
          <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary/50">
            <KeyRound className="h-3.5 w-3.5" />
            Import
          </button>
        </Link>
      </div>
    );
  }

  return (
    <div className="relative" data-wallet-picker>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:border-primary/40"
      >
        <span className="flex items-center gap-1.5">
          <LivePulse />
          <Wallet className="h-3.5 w-3.5 text-primary" />
        </span>
        <span className="font-mono">{shortAddr(active.address)}</span>
        <span className="hidden text-primary sm:inline">{bal} ZBX</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
          <div className="border-b border-border bg-gradient-to-br from-primary/10 to-transparent p-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-primary/80">
              Active Wallet
            </div>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate font-mono text-xs text-foreground">
                {active.address}
              </code>
              <button
                onClick={() => copy(active.address)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Copy"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tabular-nums text-primary">
                {bal}
              </span>
              <span className="text-xs text-muted-foreground">ZBX</span>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {active.label}
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto">
            {wallets.length > 1 && (
              <>
                <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Switch
                </div>
                {wallets.map((w) => (
                  <button
                    key={w.address}
                    onClick={() => {
                      setActive(w.address);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-muted"
                  >
                    {w.address.toLowerCase() === active.address.toLowerCase() ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <span className="h-3.5 w-3.5" />
                    )}
                    <span className="flex-1 truncate font-mono">
                      {shortAddr(w.address)}
                    </span>
                    <span className="text-muted-foreground">{w.label}</span>
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1 border-t border-border p-2">
            <button
              onClick={() => {
                addGenerated();
                setOpen(false);
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded bg-primary/10 px-2 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/20"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
            <Link href="/wallet">
              <button
                onClick={() => setOpen(false)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground transition hover:border-primary/40"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Manage
              </button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
