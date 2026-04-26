import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
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
  Send,
  Smartphone,
  Unlink,
} from "lucide-react";
import { useWallet } from "@/contexts/wallet-context";
import { useToast } from "@/hooks/use-toast";
import { rpc, weiHexToZbx, shortAddr } from "@/lib/zbx-rpc";
import { isVaultNotReady } from "@/lib/web-wallet";
import { LivePulse } from "./live-pulse";

/**
 * Top-bar wallet picker — visible on every page via Shell.
 * Shows active address + balance + dropdown to switch / create / import.
 */
export function WalletPicker() {
  const {
    wallets,
    active,
    localActive,
    remote,
    isRemote,
    setActive,
    addGenerated,
    disconnectRemote,
    vaultReady,
    vaultState,
  } = useWallet();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  /**
   * Centralised mint helper that respects the encrypted-by-default policy.
   * If the vault isn't ready, SPA-navigate to the wallet page where the
   * Manage tab's gate dialog will provision an encrypted vault. SPA
   * navigation is essential — a hard reload (window.location.assign)
   * would wipe the toast we just queued and give the user no feedback.
   */
  const mintOrRedirect = () => {
    if (!vaultReady) {
      const dest =
        vaultState === "missing"
          ? "/wallet?tab=manage&gate=create"
          : "/wallet";
      toast({
        title:
          vaultState === "missing"
            ? "Set a wallet password first"
            : "Unlock your wallet vault",
        description:
          vaultState === "missing"
            ? "Encryption is on by default — opening the wallet page so you can set a password."
            : "Opening the wallet page so you can unlock your encrypted vault.",
      });
      navigate(dest);
      return;
    }
    try {
      addGenerated();
    } catch (e) {
      // Defensive race-condition catch: between the `vaultReady` snapshot
      // we read above and the actual storage write, the vault could have
      // been locked (e.g. another tab calling lockVault). Detect that
      // typed VAULT_NOT_READY error and redirect to the gate flow rather
      // than showing a confusing generic failure toast.
      if (isVaultNotReady(e)) {
        toast({
          title: "Set a wallet password first",
          description:
            "Encryption is on by default — opening the wallet page so you can set a password.",
        });
        navigate("/wallet?tab=manage&gate=create");
        return;
      }
      toast({
        title: "Wallet creation failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };
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
          onClick={mintOrRedirect}
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
        className={`inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:border-primary/40 ${
          isRemote ? "border-cyan-500/50 ring-1 ring-cyan-500/20" : "border-border"
        }`}
        data-testid="topbar-wallet-picker"
      >
        <span className="flex items-center gap-1.5">
          <LivePulse />
          {isRemote ? (
            <Smartphone className="h-3.5 w-3.5 text-cyan-300" />
          ) : (
            <Wallet className="h-3.5 w-3.5 text-primary" />
          )}
        </span>
        {isRemote && (
          <span className="hidden md:inline rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-cyan-300">
            Mobile
          </span>
        )}
        <span className="font-mono">{shortAddr(active.address)}</span>
        <span className="hidden text-primary sm:inline">{bal} ZBX</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
          <div
            className={`border-b border-border p-3 ${
              isRemote
                ? "bg-gradient-to-br from-cyan-500/15 to-transparent"
                : "bg-gradient-to-br from-primary/10 to-transparent"
            }`}
          >
            <div
              className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest ${
                isRemote ? "text-cyan-300" : "text-primary/80"
              }`}
            >
              {isRemote ? (
                <>
                  <Smartphone className="h-3 w-3" /> Connected Mobile Wallet
                </>
              ) : (
                "Active Wallet"
              )}
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
              <span
                className={`font-mono text-2xl font-bold tabular-nums ${
                  isRemote ? "text-cyan-300" : "text-primary"
                }`}
              >
                {bal}
              </span>
              <span className="text-xs text-muted-foreground">ZBX</span>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {active.label}
              {isRemote && remote ? (
                <>
                  {" · "}
                  signs on mobile · session{" "}
                  <span className="font-mono">{remote.sessionId.slice(0, 8)}</span>
                </>
              ) : null}
            </div>

            {isRemote ? (
              /* Remote (mobile-paired) — show disconnect, hide private key. */
              <div className="mt-3 border-t border-border/60 pt-2 space-y-2">
                <div className="flex items-start gap-1.5 rounded bg-cyan-500/10 p-2 text-[11px] text-cyan-100">
                  <Smartphone className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    Every transaction, swap and transfer on this dashboard
                    will use this mobile wallet. Approvals happen on your
                    phone — keys never leave the device.
                  </span>
                </div>
                <button
                  onClick={() => {
                    disconnectRemote();
                    setOpen(false);
                    toast({ title: "Mobile wallet disconnected" });
                  }}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-border bg-card/50 px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:border-red-500/40 hover:text-red-300"
                  data-testid="button-disconnect-mobile"
                >
                  <Unlink className="h-3 w-3" />
                  Disconnect mobile wallet
                </button>
              </div>
            ) : (
              /* Local hot wallet — private key reveal flow (existing). */
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
                        Anyone with screen access to your private key can drain
                        this wallet. Auto-hides after 30 seconds.
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
                {revealKey && active.kind === "local" && (
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
                      EVM-compatible — works in MetaMask, Phantom (EVM), Rabby.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto">
            {wallets.length > 0 && (
              <>
                <div className="flex items-center justify-between px-3 pt-2">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Local hot wallets
                  </div>
                  {isRemote && (
                    <div className="text-[9px] text-muted-foreground italic">
                      paused while mobile is connected
                    </div>
                  )}
                </div>
                {wallets.map((w) => {
                  const isLocalActive =
                    !isRemote &&
                    localActive?.address.toLowerCase() === w.address.toLowerCase();
                  return (
                    <button
                      key={w.address}
                      onClick={() => {
                        setActive(w.address);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-muted ${
                        isRemote ? "opacity-60" : ""
                      }`}
                    >
                      {isLocalActive ? (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <span className="h-3.5 w-3.5" />
                      )}
                      <span className="flex-1 truncate font-mono">
                        {shortAddr(w.address)}
                      </span>
                      <span className="text-muted-foreground">{w.label}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1 border-t border-border p-2">
            <Link href="/wallet?tab=send">
              <button
                onClick={() => setOpen(false)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
              >
                <Send className="h-3.5 w-3.5" />
                Send
              </button>
            </Link>
            <button
              onClick={() => {
                setOpen(false);
                mintOrRedirect();
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
