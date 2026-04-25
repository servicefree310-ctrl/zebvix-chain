import React, { useEffect, useMemo, useState } from "react";
import { rpc, weiHexToZbx, shortAddr, ZbxRpcError } from "@/lib/zbx-rpc";
import {
  Shield, Users, Search, Clock, CheckCircle2, XCircle, AlertCircle,
  Copy, Check, ArrowRight, Hash, Key, FileSignature, Zap, Ban,
  Plus, Send, ThumbsUp, Undo2, Play, ChevronRight, Info, Layers,
  Terminal, Code2, ExternalLink, Activity,
} from "lucide-react";

interface Multisig {
  address: string;
  owners: string[];
  threshold: number;
  created_height: number;
  proposal_seq: number;
  balance_wei?: string;
}

interface ProposalAction {
  kind: "Transfer";
  to: string;
  amount_wei: string;
}

interface Proposal {
  multisig: string;
  id: number;
  proposer: string;
  approvals: string[];
  threshold: number;
  created_height: number;
  expiry_height: number;
  executed: boolean;
  expired: boolean;
  action_human: string;
  action?: ProposalAction;
}

const MIN_OWNERS = 2;
const MAX_OWNERS = 10;
const DEFAULT_EXPIRY_BLOCKS = 17_280;
const MAX_EXPIRY_BLOCKS = 1_000_000;
const BLOCK_TIME_SECS = 5;

function blocksToHuman(blocks: number): string {
  const secs = blocks * BLOCK_TIME_SECS;
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `~${mins}m`;
  const hrs = mins / 60;
  if (hrs < 48) return `~${hrs.toFixed(hrs < 10 ? 1 : 0)}h`;
  const days = hrs / 24;
  return `~${days.toFixed(days < 10 ? 1 : 0)}d`;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {/* ignore */}
      }}
      className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function StatusPill({ proposal }: { proposal: Proposal }) {
  if (proposal.executed) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        <CheckCircle2 className="h-3 w-3" /> Executed
      </span>
    );
  }
  if (proposal.expired) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/15 text-rose-300 border border-rose-500/30">
        <Ban className="h-3 w-3" /> Expired
      </span>
    );
  }
  if (proposal.approvals.length >= proposal.threshold) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
        <Zap className="h-3 w-3" /> Ready to Execute
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-sky-500/15 text-sky-300 border border-sky-500/30">
      <Clock className="h-3 w-3" /> Pending Approvals
    </span>
  );
}

export default function MultisigExplorer() {
  const [count, setCount] = useState<number | null>(null);
  const [tipHeight, setTipHeight] = useState<number | null>(null);
  const [mode, setMode] = useState<"owner" | "address">("owner");
  const [ownerAddr, setOwnerAddr] = useState("");
  const [directAddr, setDirectAddr] = useState("");
  const [list, setList] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Multisig | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedProposal, setExpandedProposal] = useState<number | null>(null);

  // Mount: pull total count + tip height for "expires in N blocks" context.
  useEffect(() => {
    rpc<{ total: number }>("zbx_multisigCount")
      .then((r) => setCount(r.total))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
    rpc<{ height: number }>("zbx_blockNumber")
      .then((r) => setTipHeight(r.height))
      .catch(() => {/* non-fatal */});
  }, []);

  // Re-poll tip every 10s so countdowns stay fresh.
  useEffect(() => {
    const t = setInterval(() => {
      rpc<{ height: number }>("zbx_blockNumber")
        .then((r) => setTipHeight(r.height))
        .catch(() => {/* ignore */});
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  async function findByOwner() {
    setLoading(true); setErr(null); setList(null); setSelected(null); setProposals([]);
    try {
      const r = await rpc<string[]>("zbx_listMultisigsByOwner", [ownerAddr.trim()]);
      setList(r);
      if (r.length === 1) await loadMultisig(r[0]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  async function loadDirect() {
    setLoading(true); setErr(null); setList(null);
    try {
      await loadMultisig(directAddr.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  async function loadMultisig(addr: string) {
    setSelected(null); setProposals([]); setExpandedProposal(null);
    try {
      const [info, balRaw, props] = await Promise.all([
        rpc<Multisig>("zbx_getMultisig", [addr]),
        rpc<string>("zbx_getBalance", [addr]).catch(() => "0x0"),
        rpc<Proposal[]>("zbx_getMultisigProposals", [addr]).catch(() => []),
      ]);
      setSelected({ ...info, balance_wei: balRaw });
      // Sort newest first
      setProposals([...props].sort((a, b) => b.id - a.id));
    } catch (e) {
      if (e instanceof ZbxRpcError) setErr(`${e.message} (code ${e.code})`);
      else setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadFullProposal(pid: number) {
    if (!selected) return;
    try {
      const full = await rpc<Proposal>("zbx_getMultisigProposal", [selected.address, pid]);
      setProposals((prev) => prev.map((p) => (p.id === pid ? { ...p, ...full } : p)));
      setExpandedProposal(pid);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  // Aggregate proposal stats for the selected multisig.
  const stats = useMemo(() => {
    if (!proposals.length) return { pending: 0, ready: 0, executed: 0, expired: 0 };
    let pending = 0, ready = 0, executed = 0, expired = 0;
    for (const p of proposals) {
      if (p.executed) executed++;
      else if (p.expired) expired++;
      else if (p.approvals.length >= p.threshold) ready++;
      else pending++;
    }
    return { pending, ready, executed, expired };
  }, [proposals]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)", backgroundSize: "24px 24px" }} />
        <div className="relative flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Phase B.8 · LIVE
              </span>
              <span className="text-[10px] font-medium text-muted-foreground">v1 · Transfer-only actions</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2 flex items-center gap-2">
              <Shield className="h-7 w-7 text-primary" />
              Multisig Explorer
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              On-chain M-of-N wallets with no private key. Funds move only when ≥ M of N owners
              co-sign a proposal. Address derived deterministically from{" "}
              <code className="text-[11px] bg-muted/50 px-1.5 py-0.5 rounded">keccak256("ZBX_MULTISIG_v1" ‖ sorted_owners ‖ threshold ‖ salt ‖ creator)[12..32]</code>.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Multisigs</div>
            <div className="text-4xl font-bold text-primary tabular-nums leading-none">{count ?? "—"}</div>
            <div className="text-[10px] text-muted-foreground">
              {tipHeight !== null ? <>chain tip <code className="font-mono">#{tipHeight.toLocaleString()}</code></> : "tip unknown"}
            </div>
          </div>
        </div>
      </div>

      {/* PROTOCOL CONSTANTS */}
      <div className="grid md:grid-cols-4 gap-3">
        <ConstCard icon={Users} label="Owner range" value={`${MIN_OWNERS}–${MAX_OWNERS}`} hint="MIN_OWNERS / MAX_OWNERS" />
        <ConstCard icon={Key} label="Threshold M" value={`1 ≤ M ≤ N`} hint="must be ≤ owner count" />
        <ConstCard icon={Clock} label="Default expiry" value={`${DEFAULT_EXPIRY_BLOCKS.toLocaleString()} blk`} hint={`${blocksToHuman(DEFAULT_EXPIRY_BLOCKS)} @ 5s blocks`} />
        <ConstCard icon={Activity} label="Max expiry" value={`${MAX_EXPIRY_BLOCKS.toLocaleString()} blk`} hint={`${blocksToHuman(MAX_EXPIRY_BLOCKS)} hard cap`} />
      </div>

      {/* LIFECYCLE DIAGRAM */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Proposal Lifecycle</h2>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">5 ops via TxKind::Multisig</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <LifecycleStep n={1} icon={Plus} label="Create" desc="anyone" detail="register owners + threshold + salt" color="violet" />
          <LifecycleStep n={2} icon={Send} label="Propose" desc="any owner" detail="action + expiry; proposer = 1st approval" color="sky" />
          <LifecycleStep n={3} icon={ThumbsUp} label="Approve" desc="other owners" detail="idempotent; sorted dedup" color="emerald" />
          <LifecycleStep n={4} icon={Undo2} label="Revoke" desc="owner only" detail="pull approval pre-execution" color="amber" muted />
          <LifecycleStep n={5} icon={Play} label="Execute" desc="any owner" detail="when approvals ≥ threshold && not expired" color="rose" />
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground flex items-start gap-2">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            v1 actions only support <code className="font-mono text-foreground">Transfer {"{"} to, amount {"}"}</code>.
            Future variants can wrap any <code className="font-mono text-foreground">TxKind</code> per multisig.rs:38.
            The multisig account is debited at execute time — not at proposal time.
          </span>
        </div>
      </div>

      {/* LOOKUP */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex border-b border-border">
          <button
            onClick={() => setMode("owner")}
            className={`flex-1 px-4 py-3 text-xs font-semibold uppercase tracking-wider transition-colors ${mode === "owner" ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:bg-muted/40"}`}
          >
            <Users className="h-3.5 w-3.5 inline mr-1.5" /> Find by Owner
          </button>
          <button
            onClick={() => setMode("address")}
            className={`flex-1 px-4 py-3 text-xs font-semibold uppercase tracking-wider transition-colors ${mode === "address" ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:bg-muted/40"}`}
          >
            <Hash className="h-3.5 w-3.5 inline mr-1.5" /> Inspect Multisig Directly
          </button>
        </div>
        <div className="p-4">
          {mode === "owner" ? (
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Owner address</label>
              <div className="flex gap-2">
                <input
                  value={ownerAddr}
                  onChange={(e) => setOwnerAddr(e.target.value)}
                  placeholder="0x… (any owner)"
                  className="flex-1 px-3 py-2.5 rounded-md bg-background border border-border font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  onKeyDown={(e) => e.key === "Enter" && ownerAddr.trim() && findByOwner()}
                />
                <button
                  onClick={findByOwner}
                  disabled={loading || !ownerAddr.trim()}
                  className="px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 flex items-center gap-1.5 transition-colors"
                >
                  <Search className="h-3.5 w-3.5" /> {loading ? "Searching…" : "Find"}
                </button>
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                RPC: zbx_listMultisigsByOwner(address)
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Multisig address</label>
              <div className="flex gap-2">
                <input
                  value={directAddr}
                  onChange={(e) => setDirectAddr(e.target.value)}
                  placeholder="0x… (multisig wallet)"
                  className="flex-1 px-3 py-2.5 rounded-md bg-background border border-border font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  onKeyDown={(e) => e.key === "Enter" && directAddr.trim() && loadDirect()}
                />
                <button
                  onClick={loadDirect}
                  disabled={loading || !directAddr.trim()}
                  className="px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 flex items-center gap-1.5 transition-colors"
                >
                  <Search className="h-3.5 w-3.5" /> {loading ? "Loading…" : "Inspect"}
                </button>
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                RPC: zbx_getMultisig + zbx_getBalance + zbx_getMultisigProposals
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ERROR */}
      {err && (
        <div className="p-3 rounded-md border border-rose-500/40 bg-rose-500/5 text-sm flex gap-2">
          <AlertCircle className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
          <code className="text-xs break-all">{err}</code>
        </div>
      )}

      {/* OWNER RESULT LIST */}
      {list && list.length > 0 && !selected && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-3 border-b border-border bg-muted/30 text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Owned Multisigs
            <span className="text-[10px] font-mono text-muted-foreground">({list.length})</span>
          </div>
          <ul className="divide-y divide-border">
            {list.map((a) => (
              <li key={a}>
                <button
                  onClick={() => loadMultisig(a)}
                  className="w-full text-left p-3 hover:bg-muted/30 font-mono text-xs flex items-center justify-between transition-colors group"
                >
                  <span>{a}</span>
                  <span className="text-primary text-[10px] flex items-center gap-1 opacity-60 group-hover:opacity-100">
                    inspect <ChevronRight className="h-3 w-3" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {list && list.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-6 rounded-lg border border-dashed border-border">
          No multisigs owned by this address.
        </div>
      )}

      {/* SELECTED MULTISIG */}
      {selected && (
        <div className="space-y-4">
          {/* HEADER CARD */}
          <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-[250px]">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Multisig Wallet</div>
                <div className="flex items-center gap-2">
                  <code className="text-base font-mono break-all text-foreground">{selected.address}</code>
                  <CopyBtn text={selected.address} />
                </div>
              </div>
              <div className="flex flex-col items-end">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Threshold</div>
                <div className="text-3xl font-bold text-primary tabular-nums leading-none">
                  {selected.threshold} <span className="text-muted-foreground/60 text-xl">/</span> {selected.owners.length}
                </div>
                <div className="text-[10px] text-muted-foreground">M of N</div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-border/50">
              <KV label="Balance" val={`${weiHexToZbx(selected.balance_wei ?? "0x0")} ZBX`} accent />
              <KV label="Created at" val={`#${selected.created_height.toLocaleString()}`} />
              <KV label="Next proposal id" val={`#${selected.proposal_seq}`} hint="monotonic counter" />
              <KV label="Total proposals" val={proposals.length.toString()} />
            </div>

            {proposals.length > 0 && (
              <div className="grid grid-cols-4 gap-2 pt-3 border-t border-border/50">
                <StatCount label="Pending" n={stats.pending} color="sky" />
                <StatCount label="Ready" n={stats.ready} color="amber" />
                <StatCount label="Executed" n={stats.executed} color="emerald" />
                <StatCount label="Expired" n={stats.expired} color="rose" />
              </div>
            )}
          </div>

          {/* OWNERS */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-3 border-b border-border bg-muted/30 text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Owners
              <span className="text-[10px] font-mono text-muted-foreground">({selected.owners.length} · sorted ascending)</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-px bg-border/60">
              {selected.owners.map((o, i) => (
                <div key={o} className="p-3 bg-card font-mono text-xs flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground tabular-nums w-6">#{(i + 1).toString().padStart(2, "0")}</span>
                  <span className="flex-1 break-all">{o}</span>
                  <CopyBtn text={o} />
                </div>
              ))}
            </div>
          </div>

          {/* PROPOSALS */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-3 border-b border-border bg-muted/30 text-sm font-semibold flex items-center gap-2">
              <FileSignature className="h-4 w-4 text-primary" /> Proposals
              <span className="text-[10px] font-mono text-muted-foreground">({proposals.length}, newest first)</span>
            </div>
            {proposals.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No proposals yet. Use{" "}
                <code className="font-mono bg-muted/50 px-1.5 py-0.5 rounded">zebvix-node multisig-propose</code>{" "}
                to submit one.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {proposals.map((p) => {
                  const pct = Math.min(100, (p.approvals.length / p.threshold) * 100);
                  const blocksLeft = tipHeight !== null ? p.expiry_height - tipHeight : null;
                  const isExpanded = expandedProposal === p.id;
                  return (
                    <li key={p.id} className="p-4 space-y-3 hover:bg-muted/10 transition-colors">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-foreground">#{p.id}</span>
                          <StatusPill proposal={p} />
                          <span className="text-[10px] text-muted-foreground font-mono">
                            created #{p.created_height.toLocaleString()}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          expires #{p.expiry_height.toLocaleString()}
                          {blocksLeft !== null && !p.executed && (
                            <span className={`ml-2 ${blocksLeft <= 0 ? "text-rose-400" : blocksLeft < 1000 ? "text-amber-400" : ""}`}>
                              ({blocksLeft <= 0 ? "expired" : `${blocksLeft.toLocaleString()} blk · ${blocksToHuman(blocksLeft)}`})
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-foreground bg-muted/30 rounded-md px-3 py-2 font-mono break-all">
                        {p.action_human}
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                          <span className="uppercase tracking-wider">Approvals</span>
                          <span className="font-mono">
                            {p.approvals.length} / {p.threshold}
                            {p.approvals.length >= p.threshold && <span className="text-amber-300 ml-1">✓ threshold met</span>}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                          <div
                            className={`h-full transition-all ${p.executed ? "bg-emerald-400" : p.expired ? "bg-rose-400" : p.approvals.length >= p.threshold ? "bg-amber-400" : "bg-sky-400"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="text-[10px] text-muted-foreground">
                          proposer:{" "}
                          <code className="font-mono text-foreground">{shortAddr(p.proposer, 8, 6)}</code>
                          <CopyBtn text={p.proposer} />
                        </div>
                        <button
                          onClick={() => isExpanded ? setExpandedProposal(null) : loadFullProposal(p.id)}
                          className="text-[10px] text-primary hover:text-primary/80 font-semibold uppercase tracking-wider flex items-center gap-1"
                        >
                          {isExpanded ? "Collapse" : "Details"} <ChevronRight className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="space-y-3 pt-3 border-t border-border/50 animate-in fade-in slide-in-from-top-1 duration-200">
                          {p.action && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Action kind</div>
                                <div className="font-mono font-semibold text-foreground">{p.action.kind}</div>
                              </div>
                              <div className="sm:col-span-2">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Recipient</div>
                                <div className="font-mono text-foreground break-all flex items-center gap-1">
                                  {p.action.to} <CopyBtn text={p.action.to} />
                                </div>
                              </div>
                              <div className="sm:col-span-3">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount</div>
                                <div className="font-mono font-semibold text-primary text-base">
                                  {weiHexToZbx("0x" + BigInt(p.action.amount_wei).toString(16))} ZBX
                                </div>
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  {p.action.amount_wei} wei
                                </div>
                              </div>
                            </div>
                          )}
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                              Approvers ({p.approvals.length})
                            </div>
                            {p.approvals.length === 0 ? (
                              <div className="text-[11px] text-muted-foreground italic">none yet</div>
                            ) : (
                              <ul className="space-y-1">
                                {p.approvals.map((a) => (
                                  <li key={a} className="font-mono text-[11px] flex items-center gap-2">
                                    <ThumbsUp className="h-3 w-3 text-emerald-400 shrink-0" />
                                    <span className="break-all">{a}</span>
                                    <CopyBtn text={a} />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* CLI REFERENCE */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/30 text-sm font-semibold flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary" /> CLI Operations
          <span className="text-[10px] font-mono text-muted-foreground">zebvix-node (main.rs)</span>
        </div>
        <div className="grid md:grid-cols-2 gap-px bg-border/60">
          <CliCmd cmd="multisig-create" desc="Register an M-of-N wallet" args="--signer-key K --owners 0x..,0x.. --threshold 2 [--salt N]" />
          <CliCmd cmd="multisig-propose" desc="Submit transfer proposal (auto-approves)" args="--signer-key K --multisig 0x.. --to 0x.. --amount 1.5 [--expiry-blocks N]" />
          <CliCmd cmd="multisig-approve" desc="Add your approval" args="--signer-key K --multisig 0x.. --proposal-id N" />
          <CliCmd cmd="multisig-revoke" desc="Pull your approval pre-execution" args="--signer-key K --multisig 0x.. --proposal-id N" />
          <CliCmd cmd="multisig-execute" desc="Finalize when approvals ≥ threshold" args="--signer-key K --multisig 0x.. --proposal-id N" />
          <CliCmd cmd="multisig-info" desc="Show wallet config + balance" args="--address 0x.. [--rpc-url URL]" />
          <CliCmd cmd="multisig-proposals" desc="List all proposals on a wallet" args="--address 0x.. [--rpc-url URL]" />
          <CliCmd cmd="multisig-list" desc="Find wallets owned by an address" args="--owner 0x.. [--rpc-url URL]" />
        </div>
      </div>

      {/* RPC REFERENCE */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/30 text-sm font-semibold flex items-center gap-2">
          <Code2 className="h-4 w-4 text-primary" /> JSON-RPC Methods
          <span className="text-[10px] font-mono text-muted-foreground">rpc.rs:1232–1320</span>
        </div>
        <div className="divide-y divide-border text-xs">
          <RpcRow method="zbx_multisigCount" params="[]" returns="{ total: number }" />
          <RpcRow method="zbx_listMultisigsByOwner" params="[address]" returns="string[] (multisig addresses)" />
          <RpcRow method="zbx_getMultisig" params="[address]" returns="{ address, owners[], threshold, created_height, proposal_seq }" />
          <RpcRow method="zbx_getMultisigProposals" params="[address]" returns="Proposal[] without action body" />
          <RpcRow method="zbx_getMultisigProposal" params="[address, id]" returns="Proposal with full action object" />
        </div>
      </div>

      {/* STORAGE & DERIVATION */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Hash className="h-4 w-4 text-primary" /> Address Derivation
          </div>
          <pre className="text-[10px] font-mono bg-muted/30 p-3 rounded overflow-x-auto leading-relaxed">
{`addr = keccak256(
    "ZBX_MULTISIG_v1"
    || sorted_owners       (concat 20-byte addrs)
    || [threshold]         (1 byte)
    || salt.to_le_bytes()  (8 bytes)
    || creator             (20 bytes)
)[12..32]                  // last 20 bytes`}
          </pre>
          <div className="text-[10px] text-muted-foreground mt-2">
            Same inputs → same address. Idempotent re-create blocked at state level.
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-primary" /> Storage Layout
          </div>
          <div className="space-y-2 text-[11px]">
            <StorageRow prefix="ms/<addr20>" desc="MultisigAccount (owners, threshold, seq)" />
            <StorageRow prefix="mspr/<addr20><id_be8>" desc="MultisigProposal (action, approvals, expiry)" />
            <StorageRow prefix="mso/<owner20><addr20>" desc="1-byte membership marker (reverse index)" />
          </div>
          <div className="text-[10px] text-muted-foreground mt-3">
            All prefix-keyed in <code className="font-mono">CF_META</code> column family.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── helpers ───────────── */

function KV({ label, val, accent, hint }: { label: string; val: string; accent?: boolean; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-semibold ${accent ? "text-primary text-base" : ""}`}>{val}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ConstCard({ icon: Icon, label, value, hint }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; hint: string }) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="font-mono text-sm font-bold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{hint}</div>
    </div>
  );
}

function StatCount({ label, n, color }: { label: string; n: number; color: "sky" | "amber" | "emerald" | "rose" }) {
  const colorMap = {
    sky: "text-sky-300 border-sky-500/30 bg-sky-500/5",
    amber: "text-amber-300 border-amber-500/30 bg-amber-500/5",
    emerald: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
    rose: "text-rose-300 border-rose-500/30 bg-rose-500/5",
  };
  return (
    <div className={`p-2 rounded-md border ${colorMap[color]}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-lg font-bold tabular-nums leading-tight">{n}</div>
    </div>
  );
}

function LifecycleStep({
  n, icon: Icon, label, desc, detail, color, muted,
}: {
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  label: string; desc: string; detail: string;
  color: "violet" | "sky" | "emerald" | "amber" | "rose";
  muted?: boolean;
}) {
  const colorMap = {
    violet: "text-violet-300 bg-violet-500/10 border-violet-500/30",
    sky: "text-sky-300 bg-sky-500/10 border-sky-500/30",
    emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    amber: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    rose: "text-rose-300 bg-rose-500/10 border-rose-500/30",
  };
  return (
    <div className={`relative p-3 rounded-lg border ${colorMap[color]} ${muted ? "opacity-70 border-dashed" : ""}`}>
      <div className="flex items-center justify-between mb-1.5">
        <Icon className="h-4 w-4" />
        <span className="text-[9px] font-mono opacity-60">step {n}</span>
      </div>
      <div className="text-sm font-bold">{label}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{desc}</div>
      <div className="text-[10px] text-foreground/70 mt-1 leading-snug">{detail}</div>
    </div>
  );
}

function CliCmd({ cmd, desc, args }: { cmd: string; desc: string; args: string }) {
  return (
    <div className="bg-card p-3 space-y-1">
      <div className="flex items-center justify-between">
        <code className="text-xs font-mono font-bold text-primary">zebvix-node {cmd}</code>
        <CopyBtn text={`zebvix-node ${cmd} ${args}`} />
      </div>
      <div className="text-[11px] text-muted-foreground">{desc}</div>
      <div className="text-[10px] font-mono text-foreground/60 break-all">{args}</div>
    </div>
  );
}

function RpcRow({ method, params, returns }: { method: string; params: string; returns: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 p-3 hover:bg-muted/20">
      <code className="md:col-span-4 text-xs font-mono text-primary font-semibold break-all">{method}</code>
      <code className="md:col-span-3 text-[11px] font-mono text-muted-foreground">{params}</code>
      <code className="md:col-span-5 text-[11px] font-mono text-foreground/80 break-all">{returns}</code>
    </div>
  );
}

function StorageRow({ prefix, desc }: { prefix: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="text-[10px] font-mono bg-muted/40 px-1.5 py-0.5 rounded text-foreground shrink-0">{prefix}</code>
      <span className="text-muted-foreground text-[10px] leading-relaxed">{desc}</span>
    </div>
  );
}
