import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  AtSign,
  Search,
  ArrowRight,
  AlertCircle,
  UserPlus,
  Copy,
  CheckCircle2,
  Wallet as WalletIcon,
  Hash,
} from "lucide-react";
import { rpc, weiHexToZbx, shortAddr } from "@/lib/zbx-rpc";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Stat } from "@/components/ui/section-card";
import { useToast } from "@/hooks/use-toast";

interface PayIdRecord {
  pay_id?: string;
  address?: string;
  name?: string;
}

export default function PayIdResolver() {
  const [count, setCount] = useState<number | null>(null);
  const [forwardQ, setForwardQ] = useState("");
  const [reverseQ, setReverseQ] = useState("");
  const [forwardRes, setForwardRes] = useState<{ rec: PayIdRecord; bal: string } | null>(null);
  const [reverseRes, setReverseRes] = useState<{ rec: PayIdRecord; bal: string } | null>(null);
  const [forwardLoading, setForwardLoading] = useState(false);
  const [reverseLoading, setReverseLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      rpc<{ total: number }>("zbx_payIdCount")
        .then((r) => !cancelled && setCount(r.total))
        .catch((e) => !cancelled && setErr(e.message));
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function lookupForward() {
    if (!forwardQ.trim()) return;
    setErr(null);
    setForwardRes(null);
    setForwardLoading(true);
    try {
      const q = forwardQ.trim().toLowerCase();
      const canon = q.endsWith("@zbx") ? q : `${q}@zbx`;
      const rec = await rpc<PayIdRecord>("zbx_lookupPayId", [canon]);
      const addr = rec?.address;
      const bal = addr
        ? await rpc<string>("zbx_getBalance", [addr]).catch(() => "0x0")
        : "0x0";
      setForwardRes({ rec, bal });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setForwardLoading(false);
    }
  }

  async function lookupReverse() {
    if (!reverseQ.trim()) return;
    setErr(null);
    setReverseRes(null);
    setReverseLoading(true);
    try {
      const rec = await rpc<PayIdRecord>("zbx_getPayIdOf", [reverseQ.trim()]);
      const bal = await rpc<string>("zbx_getBalance", [reverseQ.trim()]).catch(() => "0x0");
      setReverseRes({ rec, bal });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReverseLoading(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        icon={AtSign}
        title="Pay-ID Resolver"
        subtitle="Resolve handle@zbx to an address (forward) or look up which Pay-ID belongs to an address (reverse). Powered by zbx_lookupPayId / zbx_getPayIdOf."
        badge="Live RPC"
        live
        right={
          <Link href="/payid-register">
            <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90">
              <UserPlus className="h-3.5 w-3.5" />
              Register Pay-ID
              <ArrowRight className="h-3 w-3 opacity-70" />
            </button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total Registered" value={count ?? "—"} accent="primary" icon={AtSign} />
        <Stat label="Format" value="<handle>@zbx" hint="3–25 chars, [a-z0-9_]" />
        <Stat label="Mutability" value="Permanent" hint="One per address" accent="warn" />
      </div>

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <code className="break-all text-xs">{err}</code>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Forward: name → address */}
        <SectionCard
          title="Pay-ID → Address"
          subtitle="Enter handle (with or without @zbx)"
          icon={Search}
          tone="primary"
        >
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  value={forwardQ}
                  onChange={(e) => setForwardQ(e.target.value.toLowerCase())}
                  placeholder="alice"
                  className="w-full rounded-md border border-border bg-background py-2 pl-3 pr-16 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  onKeyDown={(e) => e.key === "Enter" && lookupForward()}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                  @zbx
                </span>
              </div>
              <button
                onClick={lookupForward}
                disabled={!forwardQ.trim() || forwardLoading}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
            {forwardRes && (
              <div className="space-y-2 rounded-md border border-border/60 bg-card/40 p-3 text-xs">
                {forwardRes.rec?.address ? (
                  <>
                    <ResultRow
                      label="Address"
                      value={
                        <code className="font-mono break-all text-primary">
                          {forwardRes.rec.address}
                        </code>
                      }
                      onCopy={() => copy(forwardRes.rec.address!)}
                    />
                    {forwardRes.rec.name && (
                      <ResultRow
                        label="Display name"
                        value={<span className="font-medium">{forwardRes.rec.name}</span>}
                      />
                    )}
                    <ResultRow
                      label="Balance"
                      value={
                        <span className="font-mono text-emerald-300">
                          {weiHexToZbx(forwardRes.bal)} ZBX
                        </span>
                      }
                    />
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <AlertCircle className="h-4 w-4 text-amber-300" />
                    Not registered
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionCard>

        {/* Reverse: address → name */}
        <SectionCard
          title="Address → Pay-ID"
          subtitle="Reverse lookup any 0x address"
          icon={Hash}
        >
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={reverseQ}
                onChange={(e) => setReverseQ(e.target.value.trim())}
                placeholder="0x..."
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                onKeyDown={(e) => e.key === "Enter" && lookupReverse()}
              />
              <button
                onClick={lookupReverse}
                disabled={!reverseQ.trim() || reverseLoading}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
            {reverseRes && (
              <div className="space-y-2 rounded-md border border-border/60 bg-card/40 p-3 text-xs">
                {reverseRes.rec?.pay_id ? (
                  <>
                    <ResultRow
                      label="Pay-ID"
                      value={
                        <code className="font-mono text-base font-semibold text-primary">
                          {reverseRes.rec.pay_id}
                        </code>
                      }
                      onCopy={() => copy(reverseRes.rec.pay_id!)}
                    />
                    {reverseRes.rec.name && (
                      <ResultRow
                        label="Display name"
                        value={<span className="font-medium">{reverseRes.rec.name}</span>}
                      />
                    )}
                    <ResultRow
                      label="Balance"
                      value={
                        <span className="font-mono text-emerald-300">
                          {weiHexToZbx(reverseRes.bal)} ZBX
                        </span>
                      }
                    />
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <AlertCircle className="h-4 w-4 text-amber-300" />
                      No Pay-ID registered for {shortAddr(reverseQ)}
                    </div>
                    <Link href="/payid-register">
                      <button className="inline-flex items-center gap-1.5 text-xs text-primary underline">
                        Register one for this address
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="What is a Pay-ID?" icon={CheckCircle2}>
        <ul className="list-inside list-disc space-y-1.5 text-sm text-muted-foreground">
          <li>
            Human-readable alias for a Zebvix address — e.g. <code className="font-mono text-foreground">alice@zbx</code> instead of a 42-char hex.
          </li>
          <li>
            Stored on-chain via <code className="font-mono text-foreground">TxKind::RegisterPayId</code>. Forward lookup
            <code className="ml-1 mr-1 font-mono text-foreground">zbx_lookupPayId</code> resolves to address; reverse
            <code className="ml-1 font-mono text-foreground">zbx_getPayIdOf</code> resolves to handle.
          </li>
          <li>
            <strong className="text-foreground">Permanent and unique</strong> — one Pay-ID per address; once claimed, cannot be transferred or reissued. Globally case-insensitive.
          </li>
          <li>
            One-time fee: <code className="font-mono text-foreground">0.002 ZBX</code> tx fee. No rent / renewal.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}

function ResultRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: React.ReactNode;
  onCopy?: () => void;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">{value}</div>
        {onCopy && (
          <button
            onClick={onCopy}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
