import React, { useEffect, useState } from "react";
import { rpc, weiHexToZbx } from "@/lib/zbx-rpc";
import { AtSign, Search, ArrowRight, AlertCircle } from "lucide-react";

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
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    rpc<{ total: number }>("zbx_payIdCount")
      .then((r) => setCount(r.total))
      .catch((e) => setErr(e.message));
  }, []);

  async function lookupForward() {
    setErr(null);
    setForwardRes(null);
    try {
      const rec = await rpc<PayIdRecord>("zbx_lookupPayId", [forwardQ.trim()]);
      const addr = rec?.address;
      const bal = addr
        ? await rpc<string>("zbx_getBalance", [addr]).catch(() => "0x0")
        : "0x0";
      setForwardRes({ rec, bal });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function lookupReverse() {
    setErr(null);
    setReverseRes(null);
    try {
      const rec = await rpc<PayIdRecord>("zbx_getPayIdOf", [reverseQ.trim()]);
      const bal = await rpc<string>("zbx_getBalance", [reverseQ.trim()]).catch(() => "0x0");
      setReverseRes({ rec, bal });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2 flex items-center gap-2">
          <AtSign className="h-7 w-7 text-primary" />
          Pay-ID Resolver
        </h1>
        <p className="text-sm text-muted-foreground">
          Forward (name → address) and reverse (address → name) Pay-ID lookups.
        </p>
      </div>

      <div className="p-4 rounded-lg border border-border bg-card inline-block">
        <div className="text-xs text-muted-foreground">Total Registered Pay-IDs</div>
        <div className="text-3xl font-bold text-primary tabular-nums">{count ?? "—"}</div>
      </div>

      {err && (
        <div className="p-3 rounded-md border border-red-500/40 bg-red-500/5 text-sm flex gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <code className="text-xs">{err}</code>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Forward */}
        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            Pay-ID <ArrowRight className="h-4 w-4" /> Address
          </h2>
          <div className="flex gap-2">
            <input
              value={forwardQ}
              onChange={(e) => setForwardQ(e.target.value)}
              placeholder="alice@zebvix"
              className="flex-1 px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              onKeyDown={(e) => e.key === "Enter" && lookupForward()}
            />
            <button
              onClick={lookupForward}
              disabled={!forwardQ.trim()}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50 hover:bg-primary/90"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>
          {forwardRes && (
            <div className="space-y-2 text-xs pt-2 border-t border-border">
              {forwardRes.rec?.address ? (
                <>
                  <div>
                    <div className="text-muted-foreground">Address</div>
                    <code className="text-primary font-mono break-all">{forwardRes.rec.address}</code>
                  </div>
                  {forwardRes.rec.name && (
                    <div>
                      <div className="text-muted-foreground">Name</div>
                      <div className="font-medium">{forwardRes.rec.name}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-muted-foreground">Balance</div>
                    <div className="font-mono text-green-400">{weiHexToZbx(forwardRes.bal)} ZBX</div>
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">Not registered</div>
              )}
            </div>
          )}
        </div>

        {/* Reverse */}
        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            Address <ArrowRight className="h-4 w-4" /> Pay-ID
          </h2>
          <div className="flex gap-2">
            <input
              value={reverseQ}
              onChange={(e) => setReverseQ(e.target.value.trim())}
              placeholder="0x..."
              className="flex-1 px-3 py-2 rounded-md bg-background border border-border font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary"
              onKeyDown={(e) => e.key === "Enter" && lookupReverse()}
            />
            <button
              onClick={lookupReverse}
              disabled={!reverseQ.trim()}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50 hover:bg-primary/90"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>
          {reverseRes && (
            <div className="space-y-2 text-xs pt-2 border-t border-border">
              {reverseRes.rec?.pay_id ? (
                <>
                  <div>
                    <div className="text-muted-foreground">Pay-ID</div>
                    <code className="text-primary font-semibold text-base">{reverseRes.rec.pay_id}</code>
                  </div>
                  {reverseRes.rec.name && (
                    <div>
                      <div className="text-muted-foreground">Name</div>
                      <div className="font-medium">{reverseRes.rec.name}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-muted-foreground">Balance</div>
                    <div className="font-mono text-green-400">{weiHexToZbx(reverseRes.bal)} ZBX</div>
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">No Pay-ID registered for this address</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
