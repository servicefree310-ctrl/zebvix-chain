import React, { useEffect, useState } from "react";
import {
  listProposals,
  getProposal,
  checkProposer,
  listFeatureFlags,
  shadowExec,
  blocksToHuman,
  shortAddr,
  type ProposalSummary,
  type ProposalsListResp,
  type FeatureFlag,
  type ProposerCheckResp,
} from "@/lib/zbx-rpc";
import {
  Vote,
  Search,
  Flag,
  Beaker,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";

function StatusPill({ status }: { status: ProposalSummary["status"] }) {
  const map: Record<string, string> = {
    Testing: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    Voting: "bg-blue-500/15 text-blue-500 border-blue-500/30",
    Approved: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
    Rejected: "bg-rose-500/15 text-rose-500 border-rose-500/30",
    Activated: "bg-violet-500/15 text-violet-500 border-violet-500/30",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-mono border ${
        map[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {status}
    </span>
  );
}

function KindBadge({ kind }: { kind: ProposalSummary["kind"] }) {
  const label =
    kind.type === "feature_flag"
      ? `flag · ${kind.key} → ${kind.enabled ? "on" : "off"}`
      : kind.type === "param_change"
      ? `param · ${kind.param} = ${kind.new_value}`
      : kind.type === "contract_whitelist"
      ? `whitelist · ${kind.label}`
      : "text-only signal";
  return (
    <span className="text-[11px] font-mono text-muted-foreground">{label}</span>
  );
}

export default function GovernancePage() {
  const [data, setData] = useState<ProposalsListResp | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ProposalSummary | null>(null);
  const [shadow, setShadow] = useState<unknown | null>(null);
  const [shadowLoading, setShadowLoading] = useState(false);

  // Proposer-check widget
  const [checkAddr, setCheckAddr] = useState("");
  const [checkResult, setCheckResult] = useState<ProposerCheckResp | null>(null);
  const [checkErr, setCheckErr] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setErr(null);
    try {
      const [props, ff] = await Promise.all([
        listProposals(50),
        listFeatureFlags(),
      ]);
      setData(props);
      setFlags(ff.flags);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    const t = setInterval(reload, 12_000);
    return () => clearInterval(t);
  }, []);

  async function openProposal(id: number) {
    setShadow(null);
    try {
      const p = await getProposal(id);
      setSelected(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function runShadow() {
    if (!selected) return;
    setShadowLoading(true);
    try {
      const r = await shadowExec(selected.id);
      setShadow(r);
    } catch (e) {
      setShadow({ ok: false, reason: e instanceof Error ? e.message : String(e) });
    } finally {
      setShadowLoading(false);
    }
  }

  async function runProposerCheck() {
    setCheckErr(null);
    setCheckResult(null);
    try {
      const r = await checkProposer(checkAddr.trim());
      setCheckResult(r);
    } catch (e) {
      setCheckErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Vote className="h-6 w-6 text-primary" />
            On-chain Governance
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Forkless governance — Phase D. Wallets holding ≥ 1 000 ZBX can submit
            a proposal. Each goes through a 14-day shadow-execution test, then a
            76-day vote (90 days total). 1 wallet = 1 vote, voters only pay gas.
            ≥ 90% positive + ≥ 5 quorum auto-activates the change with no hard
            fork.
          </p>
        </div>
        <button
          onClick={reload}
          className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted/50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {err && (
        <div className="border border-rose-500/30 bg-rose-500/10 text-rose-300 rounded-md p-3 text-sm font-mono">
          {err}
        </div>
      )}

      {data && (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Tip height" value={data.tip_height.toLocaleString()} />
          <Stat label="Proposals" value={data.count.toString()} />
          <Stat
            label="Min proposer balance"
            value="1,000 ZBX"
          />
          <Stat
            label="Pass threshold"
            value={`${(data.pass_threshold_bps / 100).toFixed(0)}% +${data.min_quorum_votes}q`}
          />
          <Stat
            label="Lifecycle"
            value={`${data.test_phase_blocks / 14_400}d test → ${
              data.vote_phase_blocks / 14_400
            }d vote`}
          />
        </section>
      )}

      <section className="border border-border rounded-lg p-4 bg-card/50">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Eligibility check (pre-flight before submitting)
        </h2>
        <div className="flex gap-2 flex-wrap">
          <input
            value={checkAddr}
            onChange={(e) => setCheckAddr(e.target.value)}
            placeholder="0x… proposer address"
            className="flex-1 min-w-[280px] px-3 py-1.5 text-sm rounded-md bg-background border border-border font-mono"
          />
          <button
            onClick={runProposerCheck}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90"
          >
            <Search className="inline h-4 w-4 mr-1" />
            Check
          </button>
        </div>
        {checkErr && (
          <div className="mt-2 text-rose-400 text-xs font-mono">{checkErr}</div>
        )}
        {checkResult && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Stat label="Balance" value={`${checkResult.balance_zbx} ZBX`} />
            <Stat
              label="Min balance"
              value={`${checkResult.min_proposer_balance_zbx} ZBX`}
            />
            <Stat
              label="Active proposals"
              value={`${checkResult.active_proposals} / ${checkResult.max_active_proposals}`}
            />
            <Stat
              label="Can submit?"
              value={checkResult.can_submit ? "yes" : "no"}
              tone={checkResult.can_submit ? "good" : "bad"}
            />
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <Vote className="h-4 w-4" />
            Proposals
          </h2>
          {(data?.proposals ?? []).length === 0 && !loading && (
            <div className="border border-dashed border-border rounded-md p-6 text-sm text-muted-foreground text-center">
              No on-chain proposals yet. Be the first — submit via the CLI:
              <pre className="mt-2 text-xs bg-muted/30 rounded p-2 overflow-x-auto text-left">
{`zebvix-node propose \\
  --signer-key ./prop.key \\
  --kind feature_flag --key zswap_v2_enabled --enabled true \\
  --title "Enable zswap v2" \\
  --description "Migrates AMM to constant-product v2 curves."`}
              </pre>
            </div>
          )}
          {(data?.proposals ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => openProposal(p.id)}
              className={`w-full text-left border border-border rounded-lg p-3 hover:border-primary/50 transition-colors ${
                selected?.id === p.id ? "border-primary bg-primary/5" : ""
              }`}
            >
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-muted-foreground">
                      #{p.id}
                    </span>
                    <StatusPill status={p.status} />
                  </div>
                  <div className="font-medium truncate">{p.title}</div>
                  <div className="mt-1">
                    <KindBadge kind={p.kind} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    by {shortAddr(p.proposer)}
                  </div>
                </div>
                <div className="text-right text-xs space-y-0.5 flex-shrink-0">
                  <div className="font-mono">
                    <span className="text-emerald-400">{p.yes_votes}</span> /{" "}
                    <span className="text-rose-400">{p.no_votes}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {(p.pass_pct_bps / 100).toFixed(1)}% yes
                  </div>
                  {p.status === "Testing" && (
                    <div className="text-amber-400 flex items-center justify-end gap-1">
                      <Clock className="h-3 w-3" />
                      vote in {blocksToHuman(p.blocks_until_voting)}
                    </div>
                  )}
                  {p.status === "Voting" && (
                    <div className="text-blue-400 flex items-center justify-end gap-1">
                      <Clock className="h-3 w-3" />
                      closes in {blocksToHuman(p.blocks_until_close)}
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        <aside className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <Flag className="h-4 w-4" />
            Activated feature flags
          </h2>
          <div className="border border-border rounded-lg divide-y divide-border">
            {(flags ?? []).length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">
                No feature flags activated yet.
              </div>
            )}
            {(flags ?? []).map((f) => (
              <div key={f.key} className="p-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-xs">{f.key}</span>
                  {f.enabled ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-rose-400" />
                  )}
                </div>
                <div className="text-xs font-mono text-muted-foreground mt-0.5">
                  value = {f.value}
                </div>
                {f.contract_label && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {f.contract_label}{" "}
                    {f.contract_address && (
                      <span className="font-mono">
                        ({shortAddr(f.contract_address)})
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
      </section>

      {selected && (
        <section className="border border-primary/30 rounded-lg p-4 bg-primary/5 space-y-3">
          <header className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-muted-foreground">
                  Proposal #{selected.id}
                </span>
                <StatusPill status={selected.status} />
              </div>
              <h3 className="text-lg font-semibold">{selected.title}</h3>
              <div className="mt-1">
                <KindBadge kind={selected.kind} />
              </div>
            </div>
            <button
              onClick={() => {
                setSelected(null);
                setShadow(null);
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </header>

          <p className="text-sm whitespace-pre-wrap text-foreground/80">
            {selected.description}
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Stat label="Yes votes" value={selected.yes_votes.toString()} tone="good" />
            <Stat label="No votes" value={selected.no_votes.toString()} tone="bad" />
            <Stat label="Pass %" value={`${(selected.pass_pct_bps / 100).toFixed(2)}%`} />
            <Stat label="Test runs" value={`${selected.test_runs}`} />
            <Stat label="Voting starts at h" value={selected.voting_starts_at_height.toLocaleString()} />
            <Stat label="Voting ends at h" value={selected.voting_ends_at_height.toLocaleString()} />
            <Stat label="Activated at h" value={selected.activated_at_height?.toLocaleString() ?? "—"} />
            <Stat label="Proposer" value={shortAddr(selected.proposer)} />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={runShadow}
              disabled={shadowLoading}
              className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted/50"
            >
              <Beaker className="inline h-4 w-4 mr-1" />
              {shadowLoading ? "Running…" : "Run shadow execution"}
            </button>
          </div>

          {!!shadow && (
            <pre className="text-xs bg-background/60 rounded p-3 overflow-x-auto border border-border">
              {JSON.stringify(shadow, null, 2)}
            </pre>
          )}

          <div className="border-t border-border pt-3 mt-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              How to vote
            </div>
            {selected.status !== "Voting" ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                {selected.status === "Testing"
                  ? `Voting opens in ${blocksToHuman(selected.blocks_until_voting)}.`
                  : "Voting is closed for this proposal."}
              </div>
            ) : (
              <pre className="text-xs bg-muted/30 rounded p-2 overflow-x-auto">
{`zebvix-node vote \\
  --signer-key ./mywallet.key \\
  --proposal-id ${selected.id} \\
  --yes        # or pass --no-yes for a NO vote
# Voter pays only gas (~$0.002). 1 wallet = 1 vote, no re-vote.`}
              </pre>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-400"
      : tone === "bad"
      ? "text-rose-400"
      : "text-foreground";
  return (
    <div className="border border-border rounded-md p-2 bg-background/40">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-sm font-mono mt-0.5 ${toneCls}`}>{value}</div>
    </div>
  );
}
