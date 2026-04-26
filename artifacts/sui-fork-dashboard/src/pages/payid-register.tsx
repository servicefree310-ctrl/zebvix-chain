import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  AtSign,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Wallet as WalletIcon,
  Sparkles,
  ArrowRight,
  ExternalLink,
  Copy,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionCard, Stat } from "@/components/ui/section-card";
import { useWallet } from "@/contexts/wallet-context";
import { isVaultNotReady } from "@/lib/web-wallet";
import { useToast } from "@/hooks/use-toast";
import {
  validatePayIdInput,
  validatePayIdName,
  lookupPayIdForward,
  payIdCount,
  registerPayId,
  lookupPayIdReverse,
} from "@/lib/payid";
import { rpc, weiHexToZbx, shortAddr, pollReceipt } from "@/lib/zbx-rpc";

type AvailState = "idle" | "checking" | "available" | "taken" | "invalid" | "error";

export default function PayIdRegister() {
  const { active, addGenerated, vaultReady, vaultState } = useWallet();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  /**
   * Mints a fresh wallet for users who landed here without one — but
   * only after the encrypted vault is ready. Otherwise we SPA-navigate
   * (NOT window.location.assign — that would discard the just-queued
   * toast) to /wallet so the gate dialog can collect a password.
   */
  function generateOrRedirect() {
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
      // Race-defense: vault could have been locked in another tab
      // between the `vaultReady` snapshot and this storage write.
      // Re-run the redirect path instead of showing a generic error.
      if (isVaultNotReady(e)) {
        generateOrRedirect();
        return;
      }
      toast({
        title: "Wallet creation failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [avail, setAvail] = useState<AvailState>("idle");
  const [reason, setReason] = useState<string>("");

  const [bal, setBal] = useState<string>("—");
  const [total, setTotal] = useState<number | null>(null);
  const [existingPayId, setExistingPayId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<"pending" | "confirmed" | "reverted" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const idCheck = useMemo(() => validatePayIdInput(handle), [handle]);
  const nameCheck = useMemo(() => validatePayIdName(name || " "), [name]);

  // Live availability check (debounced).
  useEffect(() => {
    if (!handle.trim()) {
      setAvail("idle");
      setReason("");
      return;
    }
    if (!idCheck.ok || !idCheck.canonical) {
      setAvail("invalid");
      setReason(idCheck.reason ?? "invalid");
      return;
    }
    setAvail("checking");
    setReason("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const rec = await lookupPayIdForward(idCheck.canonical!);
        setAvail(!rec?.address ? "available" : "taken");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Chain RPC returns an error like "pay-id '...' not registered" /
        // "not found" when the handle is free — that's exactly the case
        // we want; treat it as available, not as a network failure.
        if (/not\s*(registered|found)|unknown|does\s*not\s*exist/i.test(msg)) {
          setAvail("available");
        } else {
          setAvail("error");
          setReason(`network error: ${msg}`);
        }
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [handle, idCheck]);

  // Pull active wallet balance + global counters.
  useEffect(() => {
    let cancelled = false;
    payIdCount().then((n) => !cancelled && setTotal(n));
    if (active) {
      rpc<string>("zbx_getBalance", [active.address])
        .then((b) => !cancelled && setBal(weiHexToZbx(b)))
        .catch(() => !cancelled && setBal("—"));
      lookupPayIdReverse(active.address).then(
        (rec) => !cancelled && setExistingPayId(rec?.pay_id ?? null),
      );
    } else {
      setBal("—");
      setExistingPayId(null);
    }
    return () => {
      cancelled = true;
    };
  }, [active, txStatus]);

  const canonical = idCheck.canonical;
  const canSubmit =
    !submitting &&
    !!active &&
    !existingPayId &&
    avail === "available" &&
    nameCheck.ok;

  async function onSubmit() {
    if (!active) return;
    if (!canonical) return;
    if (active.kind === "remote") {
      setErr("Mobile wallet connected — Pay-ID registration must be approved on your phone. Disconnect from the topbar to register from a stored key.");
      return;
    }
    setErr(null);
    setSubmitting(true);
    setTxHash(null);
    setTxStatus(null);
    try {
      const r = await registerPayId({
        privateKeyHex: active.privateKey,
        payId: canonical,
        name: name.trim(),
      });
      setTxHash(r.hash);
      setTxStatus("pending");
      toast({
        title: "Submitted",
        description: `Pay-ID ${r.payId} broadcast`,
      });
      const receipt = await pollReceipt(r.hash, {
        intervalMs: 3000,
        timeoutMs: 60_000,
      });
      if (!receipt) {
        setErr("Tx broadcast but no receipt within 60s. Check explorer.");
        setTxStatus(null);
      } else if (receipt.status === "0x1") {
        setTxStatus("confirmed");
        toast({
          title: "Pay-ID registered",
          description: canonical,
        });
        // Refresh existing pay-id check.
        const rec = await lookupPayIdReverse(active.address);
        setExistingPayId(rec?.pay_id ?? null);
      } else {
        setTxStatus("reverted");
        setErr("Tx mined but reverted on-chain (handle may have been taken in same block).");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">
            On-chain
          </Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
            Live
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <UserPlusIcon className="w-7 h-7 text-primary" />
            Register Pay-ID
          </h1>
          <Link href="/payid-resolver">
            <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary/40">
              <AtSign className="h-3.5 w-3.5 text-primary" />
              Resolver
              <ArrowRight className="h-3 w-3 opacity-60" />
            </button>
          </Link>
        </div>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Claim a permanent human-readable handle (<code className="text-sm bg-muted px-1.5 py-0.5 rounded font-mono">handle@zbx</code>) for your address. One Pay-ID per address — once set, it cannot be changed or transferred.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">What this does</div>
            <p>
              Registers a Pay-ID via <code className="text-xs bg-muted px-1 rounded font-mono">TxKind::RegisterPayId</code>. Costs <code className="text-xs font-mono text-emerald-400">0.002 ZBX</code> network fee. The handle is globally unique and case-insensitive.
            </p>
          </div>
        </div>
      </div>

      {/* Counters */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total Registered" value={total ?? "—"} accent="primary" icon={AtSign} />
        <Stat label="Network Fee" value="0.002" hint="ZBX (one-time)" />
        <Stat label="Mutability" value="Permanent" hint="One Pay-ID per address" accent="warn" />
      </div>

      {/* Wallet selector */}
      {!active ? (
        <SectionCard title="Connect a wallet" icon={WalletIcon} tone="warn">
          <p className="mb-3 text-sm text-muted-foreground">
            You need an active wallet with at least <span className="font-mono text-foreground">0.002 ZBX</span> for the network fee. Generate a fresh wallet (test) or import your existing address.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={generateOrRedirect}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Sparkles className="h-4 w-4" />
              Generate test wallet
            </button>
            <Link href="/import-wallet">
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-primary/40">
                Import existing
              </button>
            </Link>
          </div>
        </SectionCard>
      ) : existingPayId ? (
        <SectionCard title="Already registered" icon={CheckCircle2} tone="success">
          <p className="mb-2 text-sm text-muted-foreground">
            This address already has a permanent Pay-ID:
          </p>
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <AtSign className="h-5 w-5 text-emerald-300" />
            <code className="flex-1 truncate font-mono text-base font-semibold text-emerald-300">
              {existingPayId}
            </code>
            <button
              onClick={() => copy(existingPayId)}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            To register a different Pay-ID, switch to another wallet using the picker top-right.
          </p>
        </SectionCard>
      ) : (
        <SectionCard
          title="Register a new Pay-ID"
          subtitle={`Active wallet · ${active.label} · ${shortAddr(active.address)} · ${bal} ZBX`}
          icon={UserPlusIcon}
          tone="primary"
        >
          <div className="space-y-4">
            {/* Handle input */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Handle
              </label>
              <div className="relative">
                <input
                  value={handle}
                  onChange={(e) => {
                    // Strip any user-typed "@zbx" / trailing "@" so the static
                    // suffix on the right is the only one shown.
                    const cleaned = e.target.value
                      .toLowerCase()
                      .replace(/@zbx.*$/g, "")
                      .replace(/@+$/g, "")
                      .replace(/[^a-z0-9_]/g, "");
                    setHandle(cleaned);
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text") ?? "";
                    if (/@zbx/i.test(text)) {
                      e.preventDefault();
                      const cleaned = text
                        .toLowerCase()
                        .replace(/@zbx.*$/g, "")
                        .replace(/[^a-z0-9_]/g, "");
                      setHandle(cleaned);
                    }
                  }}
                  placeholder="alice"
                  maxLength={25}
                  spellCheck={false}
                  autoCapitalize="off"
                  className="w-full rounded-md border border-border bg-background py-2.5 pl-3 pr-28 font-mono text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                  @zbx
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-xs">
                {avail === "checking" && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> checking…
                  </span>
                )}
                {avail === "available" && (
                  <span className="flex items-center gap-1 text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {canonical} is available
                  </span>
                )}
                {avail === "taken" && (
                  <span className="flex items-center gap-1 text-red-400">
                    <XCircle className="h-3.5 w-3.5" /> {canonical} is already taken
                  </span>
                )}
                {avail === "invalid" && (
                  <span className="flex items-center gap-1 text-amber-300">
                    <AlertCircle className="h-3.5 w-3.5" /> {reason}
                  </span>
                )}
                {avail === "error" && (
                  <span className="flex items-center gap-1 text-red-400">
                    <AlertCircle className="h-3.5 w-3.5" /> {reason || "could not check"}
                  </span>
                )}
                {avail === "idle" && (
                  <span className="text-muted-foreground">
                    3–25 chars · lowercase letters, digits, underscore
                  </span>
                )}
              </div>
            </div>

            {/* Name input */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Display name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alice K."
                maxLength={50}
                className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {name.length}/50 · shown to people resolving your Pay-ID
              </div>
            </div>

            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
              <div className="flex gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <strong className="font-semibold">Permanent.</strong> Once your Pay-ID is registered, it cannot be changed, transferred, or deleted. You will receive funds at this handle forever from this address.
                </div>
              </div>
            </div>

            <button
              onClick={onSubmit}
              disabled={!canSubmit}
              className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {txStatus === "pending" ? "Waiting for confirmation…" : "Broadcasting…"}
                </span>
              ) : (
                <>Register {canonical ?? "handle@zbx"} · 0.002 ZBX</>
              )}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Tx result */}
      {txHash && (
        <SectionCard
          title={
            txStatus === "confirmed"
              ? "Confirmed on-chain"
              : txStatus === "reverted"
              ? "Reverted"
              : "Pending"
          }
          icon={
            txStatus === "confirmed"
              ? CheckCircle2
              : txStatus === "reverted"
              ? XCircle
              : Loader2
          }
          tone={
            txStatus === "confirmed"
              ? "success"
              : txStatus === "reverted"
              ? "danger"
              : "primary"
          }
        >
          <div className="space-y-3 text-xs">
            <div>
              <div className="text-muted-foreground">Transaction hash</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate font-mono text-foreground">{txHash}</code>
                <button
                  onClick={() => copy(txHash)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <Link href={`/block-explorer?q=${txHash}`}>
                  <button className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1.5 font-medium text-foreground hover:border-primary/40">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </button>
                </Link>
              </div>
            </div>
            {txStatus === "confirmed" && canonical && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-emerald-200">
                People can now send you ZBX at <code className="font-mono font-semibold">{canonical}</code> — try it in the{" "}
                <Link href="/payid-resolver">
                  <span className="underline">resolver</span>
                </Link>
                .
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <code className="break-all text-xs">{err}</code>
        </div>
      )}
    </div>
  );
}

// Local UserPlus icon — just delegate to lucide.
function UserPlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  );
}
