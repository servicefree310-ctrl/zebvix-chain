import React, { useState } from "react";
import { rpc, weiHexToZbx } from "@/lib/zbx-rpc";
import { Search, Wallet, Lock, TrendingUp, AlertCircle } from "lucide-react";

interface DripInfo {
  daily_drip_wei?: string;
  released_total_wei?: string;
}

export default function BalanceLookup() {
  const [addr, setAddr] = useState("0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<{
    liquid: string;
    staked: string;
    locked: string;
    drip: DripInfo | null;
    nonce: string;
    payId: string | null;
  } | null>(null);

  async function lookup() {
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const [bal, staked, locked, drip, nonce, payId] = await Promise.all([
        rpc<string>("zbx_getBalance", [addr]).catch(() => "0x0"),
        rpc<string>("zbx_getStaked", [addr]).catch(() => "0x0"),
        rpc<string>("zbx_getLockedRewards", [addr]).catch(() => "0x0"),
        rpc<DripInfo>("zbx_getDailyDrip", [addr]).catch(() => null),
        rpc<string>("zbx_getNonce", [addr]).catch(() => "0x0"),
        rpc<{ pay_id?: string; name?: string }>("zbx_getPayIdOf", [addr])
          .then((r) => r?.pay_id ?? null)
          .catch(() => null),
      ]);
      setData({ liquid: bal, staked, locked, drip, nonce, payId });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function totalZbx(): string {
    if (!data) return "0";
    try {
      const t = BigInt(data.liquid) + BigInt(data.staked) + BigInt(data.locked);
      return weiHexToZbx(t);
    } catch {
      return "—";
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2 flex items-center gap-2">
          <Wallet className="h-7 w-7 text-primary" />
          Balance Lookup
        </h1>
        <p className="text-sm text-muted-foreground">
          Aggregate live balances: liquid + staked + locked rewards + daily drip + Pay-ID.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value.trim())}
          placeholder="0x... or paste any Zebvix address"
          className="flex-1 px-3 py-2 rounded-md bg-background border border-border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          onKeyDown={(e) => e.key === "Enter" && lookup()}
        />
        <button
          onClick={lookup}
          disabled={loading || !addr}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm disabled:opacity-50 hover:bg-primary/90 flex items-center gap-2"
        >
          <Search className="h-4 w-4" />
          {loading ? "…" : "Lookup"}
        </button>
      </div>

      {err && (
        <div className="p-3 rounded-md border border-red-500/40 bg-red-500/5 text-sm flex gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <code className="text-xs">{err}</code>
        </div>
      )}

      {data && (
        <>
          <div className="p-5 rounded-lg border-2 border-primary/30 bg-primary/5">
            <div className="text-xs text-muted-foreground mb-1">GRAND TOTAL</div>
            <div className="text-4xl font-bold text-primary tabular-nums">{totalZbx()} <span className="text-lg text-muted-foreground">ZBX</span></div>
            {data.payId && (
              <div className="mt-2 text-sm">
                Pay-ID: <code className="text-primary font-semibold">{data.payId}</code>
              </div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              Nonce: <code>{parseInt(data.nonce, 16) || 0}</code>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <BalCard icon={Wallet} label="Liquid" wei={data.liquid} color="text-blue-400" />
            <BalCard icon={TrendingUp} label="Staked" wei={data.staked} color="text-green-400" />
            <BalCard icon={Lock} label="Locked Rewards" wei={data.locked} color="text-yellow-400" />
          </div>

          {data.drip && (data.drip.daily_drip_wei || data.drip.released_total_wei) && (
            <div className="p-4 rounded-lg border border-border bg-card">
              <h3 className="text-sm font-semibold mb-3">Reward Drip</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {data.drip.daily_drip_wei && (
                  <div>
                    <div className="text-xs text-muted-foreground">Daily drip</div>
                    <div className="font-mono text-primary">{weiHexToZbx(data.drip.daily_drip_wei)} ZBX/day</div>
                  </div>
                )}
                {data.drip.released_total_wei && (
                  <div>
                    <div className="text-xs text-muted-foreground">Released so far</div>
                    <div className="font-mono">{weiHexToZbx(data.drip.released_total_wei)} ZBX</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BalCard({ icon: Icon, label, wei, color }: { icon: React.ElementType; label: string; wei: string; color: string }) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{weiHexToZbx(wei)}</div>
      <div className="text-xs text-muted-foreground mt-0.5">ZBX</div>
    </div>
  );
}
