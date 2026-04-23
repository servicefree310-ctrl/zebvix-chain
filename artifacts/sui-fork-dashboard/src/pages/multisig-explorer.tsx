import React, { useEffect, useState } from "react";
import { rpc, weiHexToZbx, shortAddr } from "@/lib/zbx-rpc";
import { Shield, Users, Search, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface Multisig {
  address: string;
  owners: string[];
  threshold: number;
  created_height: number;
  balance_wei?: string;
  proposal_count?: number;
}

interface Proposal {
  id: number;
  proposer: string;
  to: string;
  amount_wei: string;
  approvals: string[];
  expires_at_height: number;
  executed: boolean;
}

export default function MultisigExplorer() {
  const [count, setCount] = useState<number | null>(null);
  const [ownerAddr, setOwnerAddr] = useState("0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc");
  const [list, setList] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Multisig | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    rpc<{ total: number }>("zbx_multisigCount")
      .then((r) => setCount(r.total))
      .catch((e) => setErr(e.message));
  }, []);

  async function findByOwner() {
    setLoading(true);
    setErr(null);
    setList(null);
    setSelected(null);
    setProposals([]);
    try {
      const r = await rpc<string[]>("zbx_listMultisigsByOwner", [ownerAddr]);
      setList(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadMultisig(addr: string) {
    setLoading(true);
    setErr(null);
    setSelected(null);
    setProposals([]);
    try {
      const [info, balRaw, props] = await Promise.all([
        rpc<Multisig>("zbx_getMultisig", [addr]),
        rpc<string>("zbx_getBalance", [addr]).catch(() => "0x0"),
        rpc<Proposal[]>("zbx_getMultisigProposals", [addr]).catch(() => []),
      ]);
      setSelected({ ...info, balance_wei: balRaw });
      setProposals(props);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2 flex items-center gap-2">
          <Shield className="h-7 w-7 text-primary" />
          Multisig Explorer
        </h1>
        <p className="text-sm text-muted-foreground">
          Browse on-chain M-of-N multisig wallets, owners, balances, and proposal status.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <div className="p-4 rounded-lg border border-border bg-card">
          <div className="text-xs text-muted-foreground">Total Multisigs On-Chain</div>
          <div className="text-3xl font-bold text-primary tabular-nums">{count ?? "—"}</div>
        </div>
        <div className="md:col-span-2 p-4 rounded-lg border border-border bg-card space-y-2">
          <label className="text-xs text-muted-foreground">Find multisigs by owner address</label>
          <div className="flex gap-2">
            <input
              value={ownerAddr}
              onChange={(e) => setOwnerAddr(e.target.value.trim())}
              placeholder="0x..."
              className="flex-1 px-3 py-2 rounded-md bg-background border border-border font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary"
              onKeyDown={(e) => e.key === "Enter" && findByOwner()}
            />
            <button
              onClick={findByOwner}
              disabled={loading || !ownerAddr}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 hover:bg-primary/90 flex items-center gap-1"
            >
              <Search className="h-3.5 w-3.5" /> Find
            </button>
          </div>
        </div>
      </div>

      {err && (
        <div className="p-3 rounded-md border border-red-500/40 bg-red-500/5 text-sm flex gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <code className="text-xs">{err}</code>
        </div>
      )}

      {list && list.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="p-3 border-b border-border bg-muted/30 text-sm font-semibold">
            Owned Multisigs ({list.length}) — click to inspect
          </div>
          <ul className="divide-y divide-border">
            {list.map((a) => (
              <li key={a}>
                <button
                  onClick={() => loadMultisig(a)}
                  className="w-full text-left p-3 hover:bg-muted/30 font-mono text-xs flex items-center justify-between"
                >
                  <span>{a}</span>
                  <span className="text-primary text-[10px]">inspect →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {list && list.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-6">
          No multisigs owned by this address.
        </div>
      )}

      {selected && (
        <div className="space-y-4">
          <div className="p-5 rounded-lg border-2 border-primary/30 bg-primary/5 space-y-2">
            <div className="text-xs text-muted-foreground">MULTISIG ADDRESS</div>
            <code className="text-sm font-mono break-all text-foreground">{selected.address}</code>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
              <KV label="Balance" val={`${weiHexToZbx(selected.balance_wei ?? "0x0")} ZBX`} />
              <KV label="Threshold" val={`${selected.threshold} of ${selected.owners.length}`} />
              <KV label="Created at" val={`#${selected.created_height}`} />
              <KV label="Proposals" val={proposals.length.toString()} />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="p-3 border-b border-border bg-muted/30 text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Owners ({selected.owners.length})
            </div>
            <ul className="divide-y divide-border">
              {selected.owners.map((o, i) => (
                <li key={o} className="p-3 font-mono text-xs flex items-center gap-2">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="p-3 border-b border-border bg-muted/30 text-sm font-semibold">
              Proposals ({proposals.length})
            </div>
            {proposals.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">No proposals yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {proposals.map((p) => {
                  const ready = p.approvals.length >= selected.threshold;
                  const status = p.executed ? "EXECUTED" : ready ? "READY" : "PENDING";
                  const Icon = p.executed ? CheckCircle2 : ready ? Clock : XCircle;
                  const color = p.executed ? "text-green-400" : ready ? "text-yellow-400" : "text-muted-foreground";
                  return (
                    <li key={p.id} className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 ${color}`} />
                          <span className="text-xs font-semibold">#{p.id}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full bg-muted ${color}`}>{status}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {p.approvals.length}/{selected.threshold} approvals · expires #{p.expires_at_height}
                        </span>
                      </div>
                      <div className="text-xs">
                        Transfer <span className="font-mono text-primary">{weiHexToZbx(p.amount_wei)} ZBX</span> →{" "}
                        <span className="font-mono">{shortAddr(p.to, 8, 6)}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        proposer: <span className="font-mono">{shortAddr(p.proposer, 8, 6)}</span>
                      </div>
                      {p.approvals.length > 0 && (
                        <details className="text-[10px]">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">approvers ▾</summary>
                          <ul className="mt-1 ml-4 font-mono space-y-0.5">
                            {p.approvals.map((a) => <li key={a}>• {a}</li>)}
                          </ul>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ label, val }: { label: string; val: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold">{val}</div>
    </div>
  );
}
