import React, { useMemo, useState } from "react";
import {
  Play,
  Copy,
  Loader2,
  ChevronRight,
  Check,
  X,
  Trash2,
  Search,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const RPC_PATH = "/api/rpc";

interface MethodSpec {
  name: string;
  group: "ZBX core" | "ZBX bridge / staking / multisig / payid" | "ZBX governance" | "ETH-spec" | "NET / WEB3";
  desc: string;
  example: string;            // JSON params array as a string, e.g. "[]" or '["0xabc...","latest"]'
}

const METHODS: MethodSpec[] = [
  // ── ZBX core ────────────────────────────────────────────────────
  { name: "zbx_chainId",         group: "ZBX core", desc: "Returns chain id (0x1ec6 = 7878).", example: "[]" },
  { name: "zbx_chainInfo",       group: "ZBX core", desc: "Chain identity + tip summary.", example: "[]" },
  { name: "zbx_clientVersion",   group: "ZBX core", desc: 'web3-style client version string ("Zebvix/0.1.0/rust1.83/zvm-cancun").', example: "[]" },
  { name: "zbx_blockNumber",     group: "ZBX core", desc: "Latest block height + hash + proposer + ts.", example: "[]" },
  { name: "zbx_getBlockByNumber",group: "ZBX core", desc: "Native block JSON (header + txs).", example: "[0]" },
  { name: "zbx_getBalance",      group: "ZBX core", desc: "Wei balance for an address (hex string).", example: '["0x40907000ac0a1a73e4cd89889b4d7ee8980c0315"]' },
  { name: "zbx_getNonce",        group: "ZBX core", desc: "Next u64 nonce for an address.", example: '["0x40907000ac0a1a73e4cd89889b4d7ee8980c0315"]' },
  { name: "zbx_getCode",         group: "ZBX core", desc: 'Contract bytecode (returns "0x" for EOAs).', example: '["0x40907000ac0a1a73e4cd89889b4d7ee8980c0315"]' },
  { name: "zbx_supply",          group: "ZBX core", desc: "Native token supply breakdown (minted, burned, pool, premine, max).", example: "[]" },
  { name: "zbx_listValidators",  group: "ZBX core", desc: "All active validators + voting power + quorum.", example: "[]" },
  { name: "zbx_getValidator",    group: "ZBX core", desc: "Single validator record.", example: '["0x40907000ac0a1a73e4cd89889b4d7ee8980c0315"]' },
  { name: "zbx_getStakingValidator", group: "ZBX core", desc: "Staking-side detail (commission, jailed flag, total stake).", example: '["0x40907000ac0a1a73e4cd89889b4d7ee8980c0315"]' },
  { name: "zbx_listEvidence",    group: "ZBX core", desc: "Slashing evidence ring (latest first; pass limit).", example: "[10]" },
  { name: "zbx_mempoolStatus",   group: "ZBX core", desc: "Mempool size + fee summary.", example: "[]" },
  { name: "zbx_mempoolPending",  group: "ZBX core", desc: "List of pending tx hashes.", example: "[]" },
  { name: "zbx_feeBounds",       group: "ZBX core", desc: "Min / median / max gas pricing.", example: "[]" },
  { name: "zbx_estimateGas",     group: "ZBX core", desc: "Estimate gas for a tx envelope.", example: '[{"from":"0x40907000ac0a1a73e4cd89889b4d7ee8980c0315","to":"0x0000000000000000000000000000000000000001","value":"0x0"}]' },
  { name: "zbx_getZvmTransaction", group: "ZBX core", desc: "Native ZVM tx by hash.", example: '["0x0000000000000000000000000000000000000000000000000000000000000000"]' },
  { name: "zbx_getZvmReceipt",     group: "ZBX core", desc: "Native ZVM receipt by hash.", example: '["0x0000000000000000000000000000000000000000000000000000000000000000"]' },
  { name: "zbx_getEvmReceipt",     group: "ZBX core", desc: "Legacy alias kept for back-compat (routes to Zvm receipt).", example: '["0x0000000000000000000000000000000000000000000000000000000000000000"]' },

  // ── ZBX bridge / staking / multisig / payid ────────────────────
  { name: "zbx_listBridgeNetworks", group: "ZBX bridge / staking / multisig / payid", desc: "All registered bridge target networks.", example: "[]" },
  { name: "zbx_listBridgeAssets",   group: "ZBX bridge / staking / multisig / payid", desc: "All bridge-mintable assets.", example: "[]" },
  { name: "zbx_bridgeStats",        group: "ZBX bridge / staking / multisig / payid", desc: "Aggregate inflow/outflow stats.", example: "[]" },
  { name: "zbx_getStaking",         group: "ZBX bridge / staking / multisig / payid", desc: "Global staking-pool stats.", example: "[]" },
  { name: "zbx_getDelegation",      group: "ZBX bridge / staking / multisig / payid", desc: "Delegation record (delegator + validator).", example: '["0x0000000000000000000000000000000000000000","0x0000000000000000000000000000000000000000"]' },
  { name: "zbx_multisigCount",      group: "ZBX bridge / staking / multisig / payid", desc: "Total deployed multisigs.", example: "[]" },
  { name: "zbx_payIdCount",         group: "ZBX bridge / staking / multisig / payid", desc: "Registered Pay-ID names.", example: "[]" },
  { name: "zbx_lookupPayId",        group: "ZBX bridge / staking / multisig / payid", desc: "Resolve a Pay-ID name to address.", example: '["alice"]' },

  // ── ZBX governance ─────────────────────────────────────────────
  { name: "zbx_proposalsList",     group: "ZBX governance", desc: "Active proposals (limit param).", example: "[50]" },
  { name: "zbx_proposalGet",       group: "ZBX governance", desc: "Single proposal by id.", example: "[1]" },
  { name: "zbx_featureFlagsList",  group: "ZBX governance", desc: "All on-chain feature flags.", example: "[]" },

  // ── ETH-spec ───────────────────────────────────────────────────
  { name: "eth_chainId",          group: "ETH-spec", desc: "Wallet-facing chain id.", example: "[]" },
  { name: "eth_blockNumber",      group: "ETH-spec", desc: "Tip block number (hex).", example: "[]" },
  { name: "eth_getBalance",       group: "ETH-spec", desc: "Wei balance (ETH-spec param order).", example: '["0x40907000ac0a1a73e4cd89889b4d7ee8980c0315","latest"]' },
  { name: "eth_getTransactionCount", group: "ETH-spec", desc: "Nonce-style tx count.", example: '["0x40907000ac0a1a73e4cd89889b4d7ee8980c0315","latest"]' },
  { name: "eth_gasPrice",         group: "ETH-spec", desc: "Suggested gas price (wei hex).", example: "[]" },
  { name: "eth_feeHistory",       group: "ETH-spec", desc: "EIP-1559 fee history window.", example: '["0x4","latest",[25,50,75]]' },
  { name: "eth_estimateGas",      group: "ETH-spec", desc: "Estimate gas for a tx call.", example: '[{"from":"0x40907000ac0a1a73e4cd89889b4d7ee8980c0315","to":"0x0000000000000000000000000000000000000001","value":"0x0"}]' },
  { name: "eth_call",             group: "ETH-spec", desc: "Read-only contract call.", example: '[{"to":"0x0000000000000000000000000000000000000000","data":"0x"},"latest"]' },
  { name: "eth_getBlockByNumber", group: "ETH-spec", desc: "Block JSON (false = hashes only, true = full txs).", example: '["latest",false]' },
  { name: "eth_getBlockByHash",   group: "ETH-spec", desc: "Block by hash.", example: '["0x0000000000000000000000000000000000000000000000000000000000000000",false]' },
  { name: "eth_getTransactionByHash",   group: "ETH-spec", desc: "Tx by hash.", example: '["0x0000000000000000000000000000000000000000000000000000000000000000"]' },
  { name: "eth_getTransactionReceipt",  group: "ETH-spec", desc: "Receipt by hash (status / gasUsed / logs).", example: '["0x0000000000000000000000000000000000000000000000000000000000000000"]' },
  { name: "eth_getCode",          group: "ETH-spec", desc: "Contract bytecode at latest block.", example: '["0x40907000ac0a1a73e4cd89889b4d7ee8980c0315","latest"]' },
  { name: "eth_getStorageAt",     group: "ETH-spec", desc: "Storage slot read.", example: '["0x40907000ac0a1a73e4cd89889b4d7ee8980c0315","0x0","latest"]' },
  { name: "eth_getLogs",          group: "ETH-spec", desc: "Log filter.", example: '[{"fromBlock":"latest","toBlock":"latest"}]' },
  { name: "eth_syncing",          group: "ETH-spec", desc: "Sync status (false when caught up).", example: "[]" },

  // ── NET / WEB3 ─────────────────────────────────────────────────
  { name: "net_version",          group: "NET / WEB3", desc: "Decimal chain id.", example: "[]" },
  { name: "net_listening",        group: "NET / WEB3", desc: "Listening for peers (boolean).", example: "[]" },
  { name: "net_peerCount",        group: "NET / WEB3", desc: "Connected peer count (hex).", example: "[]" },
  { name: "web3_clientVersion",   group: "NET / WEB3", desc: "Full version string.", example: "[]" },
  { name: "web3_sha3",            group: "NET / WEB3", desc: "keccak-256 of the input bytes.", example: '["0x68656c6c6f"]' },
];

const GROUP_ORDER: MethodSpec["group"][] = [
  "ZBX core",
  "ETH-spec",
  "NET / WEB3",
  "ZBX bridge / staking / multisig / payid",
  "ZBX governance",
];

interface CallRecord {
  ts: number;
  method: string;
  params: string;
  status: "ok" | "err";
  durationMs: number;
  body: string;             // pretty JSON
}

export default function RpcPlayground() {
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<MethodSpec>(METHODS[0]);
  const [params, setParams] = useState<string>(METHODS[0].example);
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<{ ok: boolean; body: string; ms: number } | null>(null);
  const [history, setHistory] = useState<CallRecord[]>([]);

  const grouped = useMemo(() => {
    const out = new Map<MethodSpec["group"], MethodSpec[]>();
    for (const g of GROUP_ORDER) out.set(g, []);
    for (const m of METHODS) {
      if (filter && !m.name.toLowerCase().includes(filter.toLowerCase()) && !m.desc.toLowerCase().includes(filter.toLowerCase())) {
        continue;
      }
      out.get(m.group)?.push(m);
    }
    return out;
  }, [filter]);

  const pick = (m: MethodSpec) => {
    setPicked(m);
    setParams(m.example);
    setResponse(null);
  };

  const exec = async () => {
    let parsed: unknown[] = [];
    try {
      const v = JSON.parse(params || "[]");
      if (!Array.isArray(v)) throw new Error("Params must be a JSON array.");
      parsed = v;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Invalid params JSON", description: msg, variant: "destructive" });
      return;
    }
    setBusy(true);
    const ts = Date.now();
    try {
      const r = await fetch(RPC_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: picked.name, params: parsed }),
      });
      const body = await r.json();
      const ms = Date.now() - ts;
      const ok = !body.error;
      const pretty = JSON.stringify(body, null, 2);
      setResponse({ ok, body: pretty, ms });
      const okRec: CallRecord = { ts, method: picked.name, params, status: ok ? "ok" : "err", durationMs: ms, body: pretty };
      setHistory((h) => [okRec, ...h].slice(0, 10));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const ms = Date.now() - ts;
      setResponse({ ok: false, body: JSON.stringify({ error: { message: msg } }, null, 2), ms });
      const errRec: CallRecord = { ts, method: picked.name, params, status: "err", durationMs: ms, body: msg };
      setHistory((h) => [errRec, ...h].slice(0, 10));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">RPC Playground</h1>
        <p className="text-lg text-muted-foreground">
          Try every JSON-RPC method exposed by the Zebvix proxy. Pick a method on the
          left, edit the JSON params, hit Execute. Calls hit the same <code className="text-xs">/api/rpc</code>
          endpoint the dashboard uses.
        </p>
      </div>

      <div className="grid md:grid-cols-[280px_1fr] gap-4">
        {/* Method list */}
        <Card className="p-3 space-y-3 max-h-[80vh] overflow-y-auto">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter methods…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-8 text-xs h-8"
              data-testid="input-rpc-filter"
            />
          </div>
          {GROUP_ORDER.map((g) => {
            const items = grouped.get(g) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={g} className="space-y-1">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold pt-1">{g}</div>
                {items.map((m) => {
                  const active = picked.name === m.name;
                  return (
                    <button
                      key={m.name}
                      onClick={() => pick(m)}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-xs transition ${
                        active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/40"
                      }`}
                      data-testid={`btn-method-${m.name}`}
                    >
                      <code className="font-mono truncate">{m.name}</code>
                      {active && <ChevronRight className="h-3 w-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </Card>

        {/* Editor + response */}
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <code className="font-mono text-sm text-primary">{picked.name}</code>
                <p className="text-xs text-muted-foreground mt-0.5">{picked.desc}</p>
              </div>
              <Badge variant="outline" className="text-[10px]">{picked.group}</Badge>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Params (JSON array)</div>
              <textarea
                value={params}
                onChange={(e) => setParams(e.target.value)}
                rows={Math.max(3, Math.min(10, params.split("\n").length))}
                className="w-full px-2 py-1.5 rounded-md border border-border bg-card text-foreground font-mono text-xs"
                data-testid="textarea-rpc-params"
              />
              <div className="text-[10px] text-muted-foreground mt-1">
                Tip: pre-filled example params usually work as-is. For tx/block lookups, swap in a real hash.
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <Button onClick={exec} disabled={busy} data-testid="button-rpc-execute">
                {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}
                Execute
              </Button>
              <Button variant="outline" onClick={() => setParams(picked.example)}>Reset params</Button>
              {response && (
                <span className="text-xs text-muted-foreground">
                  {response.ms} ms · {response.ok ? "ok" : "error"}
                </span>
              )}
            </div>
          </Card>

          {response && (
            <Card className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  Response
                  {response.ok
                    ? <span className="text-emerald-400 inline-flex items-center gap-1"><Check className="h-3 w-3" /> success</span>
                    : <span className="text-red-400 inline-flex items-center gap-1"><X className="h-3 w-3" /> error</span>}
                </div>
                <Button size="sm" variant="ghost"
                  onClick={() => { navigator.clipboard.writeText(response.body); toast({ title: "Copied" }); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <pre className={`text-[11px] font-mono p-3 rounded-md overflow-auto max-h-96 ${
                response.ok ? "bg-muted/40" : "bg-red-500/5 border border-red-500/30"
              }`} data-testid="text-rpc-response">{response.body}</pre>
            </Card>
          )}

          {history.length > 0 && (
            <Card className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Recent calls</div>
                <Button size="sm" variant="ghost" onClick={() => setHistory([])}>
                  <Trash2 className="h-3 w-3 mr-1.5" /> Clear
                </Button>
              </div>
              <div className="space-y-1">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const m = METHODS.find((m) => m.name === h.method);
                      if (m) { setPicked(m); }
                      setParams(h.params);
                      setResponse({ ok: h.status === "ok", body: h.body, ms: h.durationMs });
                    }}
                    className="w-full flex items-center justify-between gap-2 px-2 py-1 text-xs text-left rounded hover:bg-muted/40"
                  >
                    <code className="font-mono">{h.method}</code>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{h.durationMs}ms</span>
                      <span className={h.status === "ok" ? "text-emerald-400" : "text-red-400"}>{h.status}</span>
                      <span>{new Date(h.ts).toLocaleTimeString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
