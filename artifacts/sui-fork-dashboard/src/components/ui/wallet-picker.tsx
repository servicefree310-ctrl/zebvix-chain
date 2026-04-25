import React, { useEffect, useRef, useState } from "react";
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
  Eye,
  EyeOff,
  AlertTriangle,
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
  const [revealKey, setRevealKey] = useState(false);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-hide private key 30s after reveal — limits over-the-shoulder exposure.
  useEffect(() => {
    if (!revealKey) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRevealKey(false), 30000);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [revealKey]);

  // Reset reveal/confirm state whenever the dropdown closes or active wallet changes.
  useEffect(() => {
    if (!open) {
      setRevealKey(false);
      setConfirmReveal(false);
    }
  }, [open, active?.address]);

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

  const copyPrivateKey = () => {
    if (!active) return;
    navigator.clipboard
      .writeText(active.privateKey)
      .then(() => {
        toast({
          title: "Private key copied",
          description: "Paste into your wallet manager. Never share it.",
        });
      })
      .catch(() => {
        toast({
          title: "Copy failed",
          description: "Browser blocked clipboard. Select & copy manually.",
          variant: "destructive",
        });
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
                title="Copy address"
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

            {/* ── Private key reveal — gated behind a confirm step + 30s auto-hide. */}
            <div className="mt-3 border-t border-border/60 pt-2">
              {!confirmReveal && !revealKey && (
                <button
                  onClick={() => setConfirmReveal(true)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-border bg-card/50 px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                >
                  <Eye className="h-3 w-3" />
                  Show / copy private key
                </button>
              )}
              {confirmReveal && !revealKey && (
                <div className="space-y-2">
                  <div className="flex items-start gap-1.5 rounded bg-amber-500/10 p-2 text-[11px] text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      Bhai, private key dikhane se anyone with screen access
                      apka wallet drain kar sakta hai. Auto-hide after 30s.
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={() => setConfirmReveal(false)}
                      className="rounded border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setRevealKey(true);
                        setConfirmReveal(false);
                      }}
                      className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90"
                    >
                      Reveal
                    </button>
                  </div>
                </div>
              )}
              {revealKey && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-amber-300">
                    <span>Private Key (32 bytes hex)</span>
                    <button
                      onClick={() => setRevealKey(false)}
                      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Hide"
                    >
                      <EyeOff className="h-3 w-3" />
                      Hide
                    </button>
                  </div>
                  <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/5 p-2">
                    <code className="flex-1 break-all font-mono text-[10px] leading-tight text-amber-100">
                      {active.privateKey}
                    </code>
                    <button
                      onClick={copyPrivateKey}
                      className="shrink-0 rounded bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground transition hover:bg-primary/90"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    EVM-compatible · works in MetaMask, Phantom (EVM), Rabby.
                  </div>
                </div>
              )}
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
