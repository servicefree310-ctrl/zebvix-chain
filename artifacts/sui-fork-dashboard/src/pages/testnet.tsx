// ─────────────────────────────────────────────────────────────────────────────
// /testnet — dedicated testnet info & live-status page.
//
// Renders a side-by-side view of MAINNET vs TESTNET telemetry (chain id,
// block height, peers) using direct rpcOn() calls so the user can verify
// both networks are live regardless of which one they have selected.  Also
// surfaces the testnet RPC URL, MetaMask add-network params, and dev-tool
// integration snippets so developers can wire up Hardhat / Foundry / ethers
// against the testnet in a single click.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FlaskConical,
  Globe2,
  Copy,
  Check,
  ExternalLink,
  Wallet,
  Code2,
  Activity,
} from "lucide-react";
import { rpcOn } from "@/lib/zbx-rpc";
import {
  useNetwork,
  setNetwork,
  MAINNET_META,
  TESTNET_META,
  type NetworkMeta,
  type ZbxNetwork,
} from "@/lib/use-network";

interface NetSnapshot {
  height: number | null;
  chainId: number | null;
  peers: number | null;
  ok: boolean;
  ts: number;
}

function hexInt(s: unknown): number | null {
  if (typeof s !== "string") return null;
  try {
    const n = parseInt(s, 16);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function snapshot(net: ZbxNetwork): Promise<NetSnapshot> {
  const [h, c, p] = await Promise.all([
    rpcOn<string>(net, "eth_blockNumber").catch(() => null),
    rpcOn<string>(net, "eth_chainId").catch(() => null),
    rpcOn<string>(net, "net_peerCount").catch(() => null),
  ]);
  return {
    height: hexInt(h),
    chainId: hexInt(c),
    peers: hexInt(p),
    ok: hexInt(h) !== null && hexInt(c) !== null,
    ts: Date.now(),
  };
}

function useNetSnapshot(net: ZbxNetwork) {
  return useQuery({
    queryKey: ["testnet-page-snapshot", net],
    queryFn: () => snapshot(net),
    refetchInterval: 4_000,
    staleTime: 3_000,
  });
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard blocked — best effort */
        }
      }}
      className="inline-flex items-center gap-1 rounded border border-border/60 bg-card/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest hover:bg-card transition"
      data-testid={`copy-${label ?? "btn"}`}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function NetCard({ meta, snap }: { meta: NetworkMeta; snap: NetSnapshot | undefined }) {
  const live = snap?.ok ?? false;
  const heightStr = snap?.height != null ? snap.height.toLocaleString() : "—";
  const peersStr = snap?.peers != null ? String(snap.peers) : "—";
  const cidLive = snap?.chainId ?? null;
  const cidMatches = cidLive === meta.chainId;
  return (
    <div
      className={`rounded-xl border p-5 flex flex-col gap-4 ${
        meta.isTestnet
          ? "border-red-500/40 bg-red-500/5"
          : "border-emerald-500/30 bg-emerald-500/5"
      }`}
      data-testid={`netcard-${meta.id}`}
    >
      <div className="flex items-center gap-2">
        {meta.isTestnet ? (
          <FlaskConical className="h-5 w-5 text-red-300" />
        ) : (
          <Globe2 className="h-5 w-5 text-emerald-300" />
        )}
        <div>
          <div className="text-sm font-bold uppercase tracking-widest">
            {meta.label}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            chain {meta.chainId} · {meta.chainIdHex}
          </div>
        </div>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
            live
              ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
              : "border-amber-500/40 text-amber-300 bg-amber-500/10"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              live ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
            }`}
          />
          {live ? "Live" : "Connecting"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Height</div>
          <div className="text-2xl font-mono text-foreground" data-testid={`height-${meta.id}`}>
            {heightStr}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Chain ID</div>
          <div className="text-2xl font-mono text-foreground">
            {cidLive ?? meta.chainId}
          </div>
          {cidLive != null && !cidMatches && (
            <div className="text-[9px] uppercase tracking-widest text-amber-400">
              ⚠ mismatch
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Peers</div>
          <div className="text-2xl font-mono text-foreground">{peersStr}</div>
        </div>
      </div>

      <div className="rounded-md border border-border/40 bg-background/40 p-3 text-xs space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground uppercase tracking-widest text-[10px]">RPC</span>
          <CopyBtn text={meta.rpcUrl} label={`rpc-${meta.id}`} />
        </div>
        <div className="font-mono text-foreground break-all">{meta.rpcUrl}</div>
        <div className="text-[11px] text-muted-foreground pt-1">{meta.hint}</div>
      </div>
    </div>
  );
}

function MetaMaskAddButton({ meta }: { meta: NetworkMeta }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function add() {
    const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
    if (!eth) {
      setMsg("MetaMask not detected — install or open it in this browser first");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: meta.chainIdHex,
            chainName: `Zebvix ${meta.label} (${meta.chainId})`,
            rpcUrls: [meta.rpcUrl],
            nativeCurrency: { name: meta.symbol, symbol: meta.symbol, decimals: meta.decimals },
            blockExplorerUrls: [],
          },
        ],
      });
      setMsg(`✓ ${meta.label} added to MetaMask`);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setMsg(`Failed: ${m}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={add}
        disabled={busy}
        className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-widest transition ${
          meta.isTestnet
            ? "bg-red-500/20 text-red-100 border border-red-500/40 hover:bg-red-500/30"
            : "bg-emerald-500/20 text-emerald-100 border border-emerald-500/40 hover:bg-emerald-500/30"
        } disabled:opacity-50`}
        data-testid={`add-metamask-${meta.id}`}
      >
        <Wallet className="h-3.5 w-3.5" />
        {busy ? "Requesting…" : `Add ${meta.label} to MetaMask`}
      </button>
      {msg ? (
        <div className="text-[11px] text-muted-foreground" data-testid={`add-result-${meta.id}`}>
          {msg}
        </div>
      ) : null}
    </div>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-card/40">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {language}
        </span>
        <CopyBtn text={code} label={language} />
      </div>
      <pre className="p-3 text-[11px] leading-relaxed font-mono text-foreground/90 overflow-x-auto whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

export default function TestnetPage() {
  const cur = useNetwork();
  const main = useNetSnapshot("mainnet");
  const test = useNetSnapshot("testnet");

  // Auto-switch to testnet when this page is opened, so the rest of the
  // dashboard immediately reflects testnet data when the user navigates away.
  // We do NOT auto-switch on first mount if they're already on testnet.
  useEffect(() => {
    if (cur !== "testnet") {
      // Soft notice only — we don't force-switch because that would reload the
      // page mid-render.  The user can hit the big button below.
    }
  }, [cur]);

  const lastTestUpdate = useMemo(
    () => (test.data?.ts ? new Date(test.data.ts).toLocaleTimeString() : "—"),
    [test.data?.ts],
  );

  const meta = TESTNET_META;
  const ethersSnippet = `import { JsonRpcProvider } from "ethers";

const provider = new JsonRpcProvider("${meta.rpcUrl}");
const block = await provider.getBlockNumber();
console.log("Zebvix testnet block:", block);
`;
  const foundrySnippet = `# Read latest block on Zebvix testnet
cast block-number --rpc-url ${meta.rpcUrl}

# Send a signed tx (chain_id = ${meta.chainId})
cast send 0xRecipient --value 1ether \\
    --rpc-url ${meta.rpcUrl} \\
    --chain ${meta.chainId} \\
    --private-key $TESTNET_PRIVATE_KEY
`;
  const curlSnippet = `curl -s ${meta.rpcUrl} \\
    -H 'content-type: application/json' \\
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# expect: {"jsonrpc":"2.0","id":1,"result":"0x<height>"}
`;
  const hardhatSnippet = `// hardhat.config.ts
export default {
  networks: {
    "zebvix-testnet": {
      url: "${meta.rpcUrl}",
      chainId: ${meta.chainId},
      accounts: [process.env.TESTNET_PRIVATE_KEY!],
    },
  },
};
`;

  return (
    <div className="space-y-8" data-testid="testnet-page">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-red-200">
          <FlaskConical className="h-3.5 w-3.5" />
          Zebvix Testnet — chain {TESTNET_META.chainId}
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Developer testnet — live, parallel, and disposable
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          A full second instance of the Zebvix L1 binary (chain_id 78787) runs alongside mainnet on the
          same VPS. Cross-chain replay protection is enforced at the mempool, apply_tx, and pre-marker
          apply_block stages — a tx signed for one chain can never execute on the other. Use this network
          for integration testing, dApp development, and protocol experimentation. Tokens have <span className="font-semibold text-red-200">zero economic value</span>.
        </p>
      </header>

      {/* Currently selected network — big button to flip the entire dashboard */}
      <section className="rounded-xl border border-border/60 bg-card/60 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Dashboard is currently viewing
          </div>
          <div className="text-lg font-bold flex items-center gap-2 mt-1">
            {cur === "testnet" ? (
              <>
                <FlaskConical className="h-5 w-5 text-red-300" />
                <span className="text-red-200">Testnet</span>
                <span className="text-xs font-mono text-muted-foreground">chain {TESTNET_META.chainId}</span>
              </>
            ) : (
              <>
                <Globe2 className="h-5 w-5 text-emerald-300" />
                <span className="text-emerald-200">Mainnet</span>
                <span className="text-xs font-mono text-muted-foreground">chain {MAINNET_META.chainId}</span>
              </>
            )}
          </div>
        </div>
        {cur !== "testnet" ? (
          <button
            type="button"
            onClick={() => setNetwork("testnet")}
            className="inline-flex items-center gap-2 rounded-md bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-100 px-4 py-2 text-sm font-semibold uppercase tracking-widest transition"
            data-testid="switch-to-testnet"
          >
            <FlaskConical className="h-4 w-4" />
            Switch dashboard to testnet
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setNetwork("mainnet")}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-100 px-4 py-2 text-sm font-semibold uppercase tracking-widest transition"
            data-testid="switch-to-mainnet"
          >
            <Globe2 className="h-4 w-4" />
            Back to mainnet
          </button>
        )}
      </section>

      {/* Side-by-side live status — always shows BOTH networks regardless of selection */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2">
            <Activity className="h-4 w-4" /> Live cross-network telemetry
          </h2>
          <div className="text-[10px] text-muted-foreground">
            auto-refresh 4s · last testnet poll {lastTestUpdate}
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <NetCard meta={MAINNET_META} snap={main.data} />
          <NetCard meta={TESTNET_META} snap={test.data} />
        </div>
        <div className="text-[11px] text-muted-foreground">
          Both readings come from the same dashboard process via two independent proxy endpoints
          (<span className="font-mono">/api/rpc</span> and{" "}
          <span className="font-mono">/api/rpc-testnet</span>). If one panel is "Connecting" while the
          other is "Live", that's the upstream node — not the dashboard.
        </div>
      </section>

      {/* MetaMask + connect details */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-foreground inline-flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" /> Add to MetaMask
          </h3>
          <p className="text-xs text-muted-foreground">
            One-click adds the testnet (or mainnet) RPC + chain id + native currency to MetaMask.
            Requires the extension to be installed and unlocked in this browser.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MetaMaskAddButton meta={MAINNET_META} />
            <MetaMaskAddButton meta={TESTNET_META} />
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-foreground inline-flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-primary" /> Manual config
          </h3>
          <dl className="text-xs space-y-1.5 font-mono">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Network name</dt>
              <dd>Zebvix Testnet</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">RPC URL</dt>
              <dd className="text-right break-all">{TESTNET_META.rpcUrl}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Chain ID</dt>
              <dd>{TESTNET_META.chainId} ({TESTNET_META.chainIdHex})</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Currency symbol</dt>
              <dd>{TESTNET_META.symbol}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Decimals</dt>
              <dd>{TESTNET_META.decimals}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Block time</dt>
              <dd>~5s</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Dev integration snippets */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-widest text-foreground inline-flex items-center gap-2">
          <Code2 className="h-4 w-4 text-primary" /> Dev integration snippets
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <CodeBlock language="ethers v6" code={ethersSnippet} />
          <CodeBlock language="foundry (cast)" code={foundrySnippet} />
          <CodeBlock language="hardhat.config.ts" code={hardhatSnippet} />
          <CodeBlock language="curl" code={curlSnippet} />
        </div>
      </section>

      {/* Safety call-out */}
      <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 text-xs text-amber-100 space-y-2">
        <div className="font-bold uppercase tracking-widest text-amber-200">
          Cross-chain replay safety
        </div>
        <p>
          Both networks share the same validator address (<span className="font-mono">0x40907…0315</span>),
          but the chain validates <span className="font-mono">chainId</span> at three independent points
          (mempool admission, <span className="font-mono">apply_tx</span>, and a pre-marker check inside
          <span className="font-mono"> apply_block</span>). A signed tx for chain {MAINNET_META.chainId} cannot
          land on chain {TESTNET_META.chainId} — and vice-versa — even if an attacker re-broadcasts the same bytes.
          Mainnet is therefore unaffected by anything you do here.
        </p>
      </section>
    </div>
  );
}
