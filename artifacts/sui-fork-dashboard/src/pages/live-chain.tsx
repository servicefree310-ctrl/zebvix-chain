import React, { useEffect, useState } from "react";
import { rpc, weiHexToZbx, shortAddr } from "@/lib/zbx-rpc";
import { Activity, Box, Users, DollarSign, Zap, AlertCircle } from "lucide-react";

interface BlockInfo {
  hash: string;
  height: number;
  proposer: string;
  timestamp_ms: number;
}

interface FeeBounds {
  min_fee_wei: string;
  max_fee_wei: string;
  recommended_fee_wei: string;
  min_usd?: number;
  max_usd?: number;
  source?: string;
}

interface VoteStats {
  height?: number;
  votes?: number;
  voting_power?: number;
  quorum?: number;
}

interface ValidatorInfo {
  validators?: Array<{ address: string; voting_power: number }>;
  total_voting_power?: number;
  quorum?: number;
}

export default function LiveChain() {
  const [tip, setTip] = useState<BlockInfo | null>(null);
  const [recent, setRecent] = useState<BlockInfo[]>([]);
  const [fee, setFee] = useState<FeeBounds | null>(null);
  const [votes, setVotes] = useState<VoteStats | null>(null);
  const [vals, setVals] = useState<ValidatorInfo | null>(null);
  const [msCount, setMsCount] = useState<number | null>(null);
  const [payIdCount, setPayIdCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;

    async function tick() {
      try {
        const [tipRes, feeRes] = await Promise.all([
          rpc<BlockInfo>("zbx_blockNumber"),
          rpc<FeeBounds>("zbx_feeBounds").catch(() => null),
        ]);
        if (!mounted) return;
        setTip(tipRes);
        if (feeRes) setFee(feeRes);
        setErr(null);

        // Fetch last 10 blocks
        const heights: number[] = [];
        for (let i = 0; i < 10; i++) {
          const h = tipRes.height - i;
          if (h >= 0) heights.push(h);
        }
        const blocks = await Promise.all(
          heights.map(async (h) => {
            try {
              const r = await rpc<any>("zbx_getBlockByNumber", [h]);
              if (!r) return null;
              const hdr = r.header ?? r;
              return {
                hash: r.hash ?? hdr.hash ?? `h${h}`,
                height: hdr.height ?? h,
                proposer: hdr.proposer ?? "",
                timestamp_ms: hdr.timestamp_ms ?? 0,
              } as BlockInfo;
            } catch {
              return null;
            }
          }),
        );
        if (mounted) setRecent(blocks.filter((b): b is BlockInfo => !!b));

        // Less critical, parallel
        Promise.all([
          rpc<VoteStats>("zbx_voteStats").catch(() => null),
          rpc<ValidatorInfo>("zbx_listValidators").catch(() => null),
          rpc<{ total: number }>("zbx_multisigCount").catch(() => null),
          rpc<{ total: number }>("zbx_payIdCount").catch(() => null),
        ]).then(([v, va, ms, pid]) => {
          if (!mounted) return;
          if (v) setVotes(v);
          if (va) setVals(va);
          if (ms) setMsCount(ms.total);
          if (pid) setPayIdCount(pid.total);
        });
      } catch (e) {
        if (mounted) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    tick();
    timer = window.setInterval(tick, 5000);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2 flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            Live Chain Status
          </h1>
          <p className="text-sm text-muted-foreground">
            Real-time RPC view of the Zebvix mainnet — auto-refresh every 5s.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${err ? "bg-red-500" : "bg-green-500 animate-pulse"}`} />
          <span className="text-muted-foreground">
            {err ? "RPC unreachable" : loading ? "loading..." : "live"}
          </span>
        </div>
      </div>

      {err && (
        <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/5 text-sm flex gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-red-500 mb-1">RPC error</div>
            <code className="text-xs text-muted-foreground break-all">{err}</code>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Box} label="Block Height" value={tip ? `#${tip.height.toLocaleString()}` : "—"} />
        <Stat icon={Users} label="Validators" value={vals?.validators?.length ?? "—"} sub={vals?.quorum ? `quorum ${vals.quorum}` : undefined} />
        <Stat icon={Zap} label="Multisig Wallets" value={msCount ?? "—"} />
        <Stat icon={DollarSign} label="Pay-IDs" value={payIdCount ?? "—"} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            Live Fee (USD-pegged)
          </h2>
          {fee ? (
            <div className="space-y-1.5 text-xs">
              <Row label="Min" val={`${weiHexToZbx(fee.min_fee_wei)} ZBX${fee.min_usd ? ` ($${fee.min_usd})` : ""}`} />
              <Row label="Recommended" val={`${weiHexToZbx(fee.recommended_fee_wei)} ZBX`} highlight />
              <Row label="Max" val={`${weiHexToZbx(fee.max_fee_wei)} ZBX${fee.max_usd ? ` ($${fee.max_usd})` : ""}`} />
              {fee.source && <Row label="Source" val={fee.source} />}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">loading…</div>
          )}
        </div>

        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Vote Stats (Tendermint B.2)
          </h2>
          {votes ? (
            <div className="space-y-1.5 text-xs">
              {votes.height !== undefined && <Row label="Height" val={`#${votes.height}`} />}
              {votes.votes !== undefined && <Row label="Votes" val={votes.votes.toString()} />}
              {votes.voting_power !== undefined && <Row label="Voting power" val={votes.voting_power.toString()} highlight />}
              {votes.quorum !== undefined && <Row label="Quorum" val={votes.quorum.toString()} />}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">no vote data</div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/30">
          <h2 className="text-sm font-semibold">Recent Blocks (last 10)</h2>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-muted/20 text-muted-foreground">
            <tr>
              <th className="text-left p-2 font-medium">Height</th>
              <th className="text-left p-2 font-medium">Proposer</th>
              <th className="text-left p-2 font-medium">Hash</th>
              <th className="text-right p-2 font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 && (
              <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">loading…</td></tr>
            )}
            {recent.map((b) => (
              <tr key={b.hash} className="border-t border-border hover:bg-muted/20">
                <td className="p-2 font-mono text-primary">#{b.height}</td>
                <td className="p-2 font-mono text-muted-foreground">{shortAddr(b.proposer)}</td>
                <td className="p-2 font-mono text-muted-foreground">{shortAddr(b.hash, 8, 6)}</td>
                <td className="p-2 text-right text-muted-foreground">{ageStr(b.timestamp_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {vals && vals.validators && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="p-3 border-b border-border bg-muted/30">
            <h2 className="text-sm font-semibold">Validator Set ({vals.validators.length})</h2>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/20 text-muted-foreground">
              <tr>
                <th className="text-left p-2 font-medium">#</th>
                <th className="text-left p-2 font-medium">Address</th>
                <th className="text-right p-2 font-medium">Voting Power</th>
              </tr>
            </thead>
            <tbody>
              {vals.validators.map((v, i) => (
                <tr key={v.address} className="border-t border-border hover:bg-muted/20">
                  <td className="p-2">{i + 1}</td>
                  <td className="p-2 font-mono">{v.address}</td>
                  <td className="p-2 text-right font-mono text-primary">{v.voting_power}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, val, highlight }: { label: string; val: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${highlight ? "text-primary font-semibold" : ""}`}>{val}</span>
    </div>
  );
}

function ageStr(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "future";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
