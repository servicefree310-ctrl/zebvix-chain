import React, { useState } from "react";
import { rpc, weiHexToZbx } from "@/lib/zbx-rpc";
import { Search, Wallet, Lock, TrendingUp, AlertCircle } from "lucide-react";

interface DelegationsRes {
  total_value_wei?: string;
  delegations?: Array<{ validator: string; value_wei: string; shares: string }>;
}

interface LockedRes {
  locked_wei?: string;
  released_wei?: string;
  unlock_per_block_wei?: string;
  unlock_at_height?: number;
}

export default function BalanceLookup() {
  const [addr, setAddr] = useState("0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<{
    liquid: string;
    delegations: DelegationsRes | null;
    locked: LockedRes | null;
    nonce: string;
    payId: string | null;
    zusd: string;
  } | null>(null);

  async function lookup() {
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const [bal, delegations, locked, nonce, payId, zusd] = await Promise.all([
        rpc<string>("zbx_getBalance", [addr]).catch(() => "0x0"),
        rpc<DelegationsRes>("zbx_getDelegationsByDelegator", [addr]).catch(() => null),
        rpc<LockedRes>("zbx_getLockedRewards", [addr]).catch(() => null),
        rpc<string>("zbx_getNonce", [addr]).catch(() => "0x0"),
        rpc<{ pay_id?: string; name?: string }>("zbx_getPayIdOf", [addr])
          .then((r) => r?.pay_id ?? null)
          .catch(() => null),
        rpc<string>("zbx_getZusdBalance", [addr]).catch(() => "0x0"),
      ]);
      setData({ liquid: bal, delegations, locked, nonce, payId, zusd });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function totalZbx(): string {
    if (!data) return "0";
    try {
      const liquid = BigInt(data.liquid);
      const staked = data.delegations?.total_value_wei
        ? BigInt(data.delegations.total_value_wei)
        : 0n;
      const locked = data.locked?.locked_wei ? BigInt(data.locked.locked_wei) : 0n;
      return weiHexToZbx(liquid + staked + locked);
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

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            <BalCard icon={Wallet} label="Liquid ZBX" wei={data.liquid} color="text-blue-400" />
            <BalCard
              icon={TrendingUp}
              label="Staked"
              wei={data.delegations?.total_value_wei ?? "0"}
              color="text-green-400"
            />
            <BalCard
              icon={Lock}
              label="Locked Rewards"
              wei={data.locked?.locked_wei ?? "0"}
              color="text-yellow-400"
            />
            <BalCard icon={Wallet} label="zUSD" wei={data.zusd} color="text-purple-400" />
          </div>

          {data.delegations?.delegations && data.delegations.delegations.length > 0 && (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="p-3 border-b border-border bg-muted/30 text-sm font-semibold">
                Delegations ({data.delegations.delegations.length})
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-medium">Validator</th>
                    <th className="text-right p-2 font-medium">Value (ZBX)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.delegations.delegations.map((d) => (
                    <tr key={d.validator} className="border-t border-border">
                      <td className="p-2 font-mono">{d.validator}</td>
                      <td className="p-2 text-right font-mono text-green-400">{weiHexToZbx(d.value_wei)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.locked && (data.locked.released_wei || data.locked.unlock_per_block_wei) && (
            <div className="p-4 rounded-lg border border-border bg-card">
              <h3 className="text-sm font-semibold mb-3">Reward Drip Info</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {data.locked.unlock_per_block_wei && (
                  <div>
                    <div className="text-xs text-muted-foreground">Per-block unlock</div>
                    <div className="font-mono text-primary">{weiHexToZbx(data.locked.unlock_per_block_wei)} ZBX</div>
                  </div>
                )}
                {data.locked.released_wei && (
                  <div>
                    <div className="text-xs text-muted-foreground">Released so far</div>
                    <div className="font-mono">{weiHexToZbx(data.locked.released_wei)} ZBX</div>
                  </div>
                )}
                {data.locked.unlock_at_height !== undefined && (
                  <div>
                    <div className="text-xs text-muted-foreground">Fully unlocked at</div>
                    <div className="font-mono">#{data.locked.unlock_at_height}</div>
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
