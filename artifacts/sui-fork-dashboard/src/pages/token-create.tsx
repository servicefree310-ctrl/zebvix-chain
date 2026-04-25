import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Coins,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Wallet as WalletIcon,
  Flame,
  Copy,
  ExternalLink,
  Sparkles,
  Search,
} from "lucide-react";
import { useWallet } from "@/contexts/wallet-context";
import { useToast } from "@/hooks/use-toast";
import { rpc, weiHexToZbx, shortAddr, pollReceipt } from "@/lib/zbx-rpc";
import {
  baseToDisplay,
  displayToBase,
  getTokenBySymbol,
  listTokens,
  sendTokenCreate,
  TOKEN_CREATION_BURN_WEI,
  TOKEN_MAX_DECIMALS,
  TOKEN_NAME_MAX_LEN,
  TOKEN_SYMBOL_MAX_LEN,
  TOKEN_SYMBOL_MIN_LEN,
  type TokenInfo,
} from "@/lib/tokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FEE_ZBX = "0.002";
const TOTAL_COST_ZBX = "0.002"; // gas-only (no burn)
const REFRESH_MS = 20_000;

type SymbolStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken"; existing: TokenInfo }
  | { kind: "invalid"; reason: string }
  | { kind: "error"; message: string };

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "broadcast"; hash: string }
  | { kind: "confirmed"; hash: string; tokenId: number; info: TokenInfo | null }
  | { kind: "error"; message: string };

export default function TokenCreatePage() {
  const { active } = useWallet();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [decimals, setDecimals] = useState<number>(18);
  const [supply, setSupply] = useState("1000000");
  const [feeZbx] = useState(FEE_ZBX);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [symbolStatus, setSymbolStatus] = useState<SymbolStatus>({ kind: "idle" });
  const [balanceZbx, setBalanceZbx] = useState<string>("—");
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);

  // Live balance + recent token list.
  const refreshLists = useCallback(async () => {
    setTokensLoading(true);
    try {
      const [list, bal] = await Promise.all([
        listTokens(0, 25),
        active?.address
          ? rpc<string>("zbx_getBalance", [active.address]).catch(() => "0x0")
          : Promise.resolve(null),
      ]);
      setTokens(list?.tokens ?? []);
      if (bal !== null) setBalanceZbx(weiHexToZbx(bal));
      else setBalanceZbx("—");
    } catch {
      // surfaced inline via the empty-state row
    } finally {
      setTokensLoading(false);
    }
  }, [active?.address]);

  useEffect(() => {
    refreshLists();
    const t = setInterval(refreshLists, REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshLists]);

  // Debounced symbol availability check.
  const symRef = useRef(0);
  useEffect(() => {
    // Bump epoch on EVERY change so any in-flight async response from a
    // previous symbol value is silently discarded (race-safe).
    const myEpoch = ++symRef.current;
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setSymbolStatus({ kind: "idle" });
      return;
    }
    if (sym.length < TOKEN_SYMBOL_MIN_LEN || sym.length > TOKEN_SYMBOL_MAX_LEN) {
      setSymbolStatus({
        kind: "invalid",
        reason: `Length must be ${TOKEN_SYMBOL_MIN_LEN}..${TOKEN_SYMBOL_MAX_LEN} chars`,
      });
      return;
    }
    if (!/^[A-Z0-9]+$/.test(sym)) {
      setSymbolStatus({
        kind: "invalid",
        reason: "Only uppercase A-Z and digits 0-9 allowed",
      });
      return;
    }
    setSymbolStatus({ kind: "checking" });
    const t = setTimeout(async () => {
      try {
        const existing = await getTokenBySymbol(sym);
        if (myEpoch !== symRef.current) return;
        if (existing) setSymbolStatus({ kind: "taken", existing });
        else setSymbolStatus({ kind: "available" });
      } catch (e) {
        if (myEpoch !== symRef.current) return;
        setSymbolStatus({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [symbol]);

  // Live preview: convert display supply → base units (or capture parse error).
  const supplyPreview = useMemo(() => {
    if (!supply.trim()) return { ok: false as const, error: "Required" };
    try {
      const base = displayToBase(supply, decimals);
      if (base === 0n) return { ok: false as const, error: "Must be > 0" };
      return { ok: true as const, base };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [supply, decimals]);

  const nameError = useMemo(() => {
    const n = name.trim();
    if (!n) return "Required";
    if (n.length > TOKEN_NAME_MAX_LEN) return `Max ${TOKEN_NAME_MAX_LEN} chars`;
    return null;
  }, [name]);

  const decimalsError = useMemo(() => {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > TOKEN_MAX_DECIMALS) {
      return `Must be 0..${TOKEN_MAX_DECIMALS}`;
    }
    return null;
  }, [decimals]);

  const balanceWei = useMemo(() => {
    if (!balanceZbx || balanceZbx === "—") return null;
    try {
      return BigInt(Math.floor(parseFloat(balanceZbx.replace(/,/g, "")) * 1e18));
    } catch {
      return null;
    }
  }, [balanceZbx]);

  // Need a small gas buffer (~0.01 ZBX) above the standard 0.002 fee so
  // intermittent fee bumps don't cause an avoidable rejection.
  const insufficient =
    balanceWei !== null &&
    balanceWei < TOKEN_CREATION_BURN_WEI + 10_000_000_000_000_000n;

  const inFlight =
    status.kind === "submitting" || status.kind === "broadcast";

  const ready =
    !!active &&
    !nameError &&
    !decimalsError &&
    supplyPreview.ok &&
    symbolStatus.kind === "available" &&
    !inFlight &&
    !insufficient;

  const submit = async () => {
    if (!active) return;
    setStatus({ kind: "submitting" });
    try {
      const sym = symbol.trim().toUpperCase();
      const r = await sendTokenCreate({
        privateKeyHex: active.privateKey,
        name: name.trim(),
        symbol: sym,
        decimals,
        initialSupplyDisplay: supply,
        feeZbx,
      });
      const hash = r.hash;
      if (!hash) throw new Error("Empty tx hash from RPC");
      setStatus({ kind: "broadcast", hash });
      toast({ title: "Token-create broadcast", description: hash });
      // Wait for the tx to be included, then look up the new token by symbol
      // to surface its assigned id.
      pollReceipt(hash, { intervalMs: 3000, timeoutMs: 60_000 })
        .then(async (receipt) => {
          if (receipt === null) {
            // Timed out waiting for inclusion. Do one final symbol lookup
            // in case the tx landed but the receipt poll missed it.
            const fallback = await getTokenBySymbol(sym);
            if (fallback) {
              setStatus({
                kind: "confirmed",
                hash,
                tokenId: fallback.id,
                info: fallback,
              });
              refreshLists();
              return;
            }
            setStatus({
              kind: "error",
              message:
                `Timed out after 60s waiting for confirmation. ` +
                `Tx ${hash.slice(0, 10)}… may still land — check the block explorer.`,
            });
            toast({
              title: "Confirmation timeout",
              description: "Tx broadcast par hai. Block explorer me dekho.",
              variant: "destructive",
            });
            return;
          }
          const info = await getTokenBySymbol(sym);
          if (info) {
            setStatus({
              kind: "confirmed",
              hash,
              tokenId: info.id,
              info,
            });
            toast({
              title: `Token #${info.id} created`,
              description: `${info.symbol} — ${baseToDisplay(info.total_supply, info.decimals)} supply`,
            });
            refreshLists();
          } else {
            // Receipt arrived but token not visible yet — try again briefly.
            setTimeout(() => {
              getTokenBySymbol(sym)
                .then((info2) => {
                  if (info2) {
                    setStatus({
                      kind: "confirmed",
                      hash,
                      tokenId: info2.id,
                      info: info2,
                    });
                    refreshLists();
                  } else {
                    setStatus({
                      kind: "error",
                      message:
                        `Tx confirmed but token symbol "${sym}" not visible on chain. ` +
                        `RPC may be lagging — refresh in a moment.`,
                    });
                  }
                })
                .catch((err) => {
                  setStatus({
                    kind: "error",
                    message:
                      `Tx confirmed but token lookup failed: ` +
                      (err instanceof Error ? err.message : String(err)),
                  });
                });
            }, 2000);
          }
        })
        .catch((err) => {
          setStatus({
            kind: "error",
            message: `Receipt poll failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ kind: "error", message: msg });
      toast({
        title: "Token-create failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const reset = () => {
    setName("");
    setSymbol("");
    setDecimals(18);
    setSupply("1000000");
    setStatus({ kind: "idle" });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-1 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Create Your Own Token
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Bhai, koi bhi user permissionless apna fungible token chain par
            launch kar sakta hai. Sirf standard gas fee lagti hai — koi extra
            burn nahi. Symbol globally unique hota hai (case-insensitive).
            Mint authority sirf creator ke paas rehti hai — kabhi transfer /
            freeze nahi ho sakti.
          </p>
        </div>
      </header>

      <CostPanel />

      {!active ? (
        <NoWalletNotice />
      ) : (
        <WalletPanel
          address={active.address}
          balanceZbx={balanceZbx}
          insufficient={insufficient}
        />
      )}

      <div className="rounded-lg border border-border bg-card p-5 space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <Field
            label="Token Name"
            hint={`1..${TOKEN_NAME_MAX_LEN} chars · displayed in explorers`}
            error={name ? nameError : null}
          >
            <Input
              data-testid="input-name"
              placeholder="My Awesome Token"
              maxLength={TOKEN_NAME_MAX_LEN}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field
            label="Ticker / Symbol"
            hint={`${TOKEN_SYMBOL_MIN_LEN}..${TOKEN_SYMBOL_MAX_LEN} chars · uppercase A-Z, 0-9`}
            error={null}
          >
            <Input
              data-testid="input-symbol"
              placeholder="MYTOK"
              maxLength={TOKEN_SYMBOL_MAX_LEN}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="font-mono"
            />
            <SymbolHint status={symbolStatus} />
          </Field>

          <Field
            label="Decimals"
            hint={`0..${TOKEN_MAX_DECIMALS} · 18 = same as ZBX/ETH (recommended)`}
            error={decimalsError}
          >
            <Input
              data-testid="input-decimals"
              type="number"
              min={0}
              max={TOKEN_MAX_DECIMALS}
              step={1}
              value={decimals}
              onChange={(e) => setDecimals(Number(e.target.value))}
            />
          </Field>

          <Field
            label="Initial Supply (whole tokens)"
            hint={`Goes to your wallet. Will be scaled by 10^${decimals} on chain.`}
            error={supply ? supplyPreview.ok ? null : supplyPreview.error : null}
          >
            <Input
              data-testid="input-supply"
              type="text"
              inputMode="decimal"
              placeholder="1000000"
              value={supply}
              onChange={(e) => setSupply(e.target.value)}
            />
            {supplyPreview.ok && (
              <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                = {supplyPreview.base.toString()} base units
              </p>
            )}
          </Field>
        </div>

        <PreviewCard
          name={name.trim() || "Untitled Token"}
          symbol={symbol.trim().toUpperCase() || "TOK"}
          decimals={decimals}
          supplyDisplay={supply || "0"}
          creator={active?.address ?? "(no wallet)"}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground">
            Total cost:{" "}
            <span className="text-foreground font-semibold tabular-nums">
              {TOTAL_COST_ZBX} ZBX
            </span>{" "}
            (gas only — no burn)
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={reset} disabled={inFlight}>
              Reset
            </Button>
            <Button
              data-testid="button-create-token"
              onClick={submit}
              disabled={!ready}
            >
              {status.kind === "submitting" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Submitting…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  Create Token
                </>
              )}
            </Button>
          </div>
        </div>

        <StatusBox status={status} onReset={reset} />
      </div>

      <RecentTokens
        tokens={tokens}
        loading={tokensLoading}
        myAddress={active?.address ?? null}
        onRefresh={refreshLists}
      />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function CostPanel() {
  return (
    <div className="grid md:grid-cols-3 gap-3">
      <StatCard icon={Coins} label="Network Fee" value={`${FEE_ZBX} ZBX`} sub="standard gas fee only" />
      <StatCard icon={Flame} label="Creation Burn" value="None" sub="zero extra burn — gas-only" />
      <StatCard icon={CheckCircle2} label="Permissionless" value="Anyone" sub="no admin / governor gate" />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {label}
      </div>
      <div className="text-xl font-bold text-foreground tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function NoWalletNotice() {
  return (
    <div className="rounded-lg border border-border bg-card p-5 text-sm flex items-center gap-3">
      <WalletIcon className="h-5 w-5 text-primary" />
      <div>
        <div className="font-semibold">No wallet connected</div>
        <div className="text-muted-foreground text-xs mt-0.5">
          Bhai, top-right wallet picker se wallet add karo (sirf ~0.01 ZBX
          gas hona chahiye token launch karne ke liye).
        </div>
      </div>
    </div>
  );
}

function WalletPanel({
  address,
  balanceZbx,
  insufficient,
}: {
  address: string;
  balanceZbx: string;
  insufficient: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3 ${
        insufficient
          ? "border-destructive/40 bg-destructive/5"
          : "border-primary/30 bg-gradient-to-br from-primary/5 to-transparent"
      }`}
    >
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-widest text-primary/80">
          Your wallet
        </div>
        <div className="font-mono text-sm text-foreground mt-0.5 break-all">{address}</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase text-muted-foreground">Balance</div>
        <div
          className={`text-lg font-semibold tabular-nums ${
            insufficient ? "text-destructive" : ""
          }`}
        >
          {balanceZbx} ZBX
        </div>
        {insufficient && (
          <div className="text-[11px] text-destructive mt-0.5 flex items-center gap-1 justify-end">
            <AlertTriangle className="h-3 w-3" />
            Need ~0.01 ZBX gas
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
      {error ? (
        <p className="mt-1 text-[11px] text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function SymbolHint({ status }: { status: SymbolStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "checking") {
    return (
      <p className="mt-1 text-[11px] text-muted-foreground flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking availability…
      </p>
    );
  }
  if (status.kind === "available") {
    return (
      <p className="mt-1 text-[11px] text-emerald-500 flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Available
      </p>
    );
  }
  if (status.kind === "taken") {
    return (
      <p className="mt-1 text-[11px] text-destructive flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Already taken (token #{status.existing.id} · {status.existing.name})
      </p>
    );
  }
  if (status.kind === "invalid") {
    return (
      <p className="mt-1 text-[11px] text-destructive flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        {status.reason}
      </p>
    );
  }
  return (
    <p className="mt-1 text-[11px] text-destructive flex items-center gap-1">
      <AlertTriangle className="h-3 w-3" />
      {status.message}
    </p>
  );
}

function PreviewCard({
  name,
  symbol,
  decimals,
  supplyDisplay,
  creator,
}: {
  name: string;
  symbol: string;
  decimals: number;
  supplyDisplay: string;
  creator: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
        Live preview
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xl font-bold text-foreground truncate">
            {name}
            <span className="ml-2 text-sm text-primary font-mono">{symbol}</span>
          </div>
          <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
            creator {shortAddr(creator)} · decimals {decimals}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-muted-foreground">Initial Supply</div>
          <div className="text-lg font-semibold tabular-nums text-primary">
            {supplyDisplay} {symbol}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBox({ status, onReset }: { status: Status; onReset: () => void }) {
  const { toast } = useToast();
  if (status.kind === "idle" || status.kind === "submitting") return null;

  if (status.kind === "broadcast") {
    return (
      <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
        <div className="flex items-center gap-2 text-primary font-semibold">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Waiting for confirmation…
        </div>
        <HashRow hash={status.hash} />
      </div>
    );
  }

  if (status.kind === "confirmed") {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2 text-emerald-500 font-semibold">
          <CheckCircle2 className="h-4 w-4" />
          Token created — id #{status.tokenId}
        </div>
        {status.info && (
          <div className="grid sm:grid-cols-2 gap-2 text-xs">
            <Row label="Name" value={status.info.name} />
            <Row label="Symbol" value={status.info.symbol} mono />
            <Row label="Decimals" value={status.info.decimals.toString()} />
            <Row
              label="Total supply"
              value={`${baseToDisplay(status.info.total_supply, status.info.decimals)} ${status.info.symbol}`}
            />
            <Row label="Created at block" value={`#${status.info.created_at_height}`} />
            <Row label="Token ID" value={`#${status.info.id}`} mono />
          </div>
        )}
        <HashRow hash={status.hash} />
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="outline" onClick={onReset}>
            Create another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
      <div className="flex items-center gap-2 text-destructive font-semibold">
        <AlertTriangle className="h-3.5 w-3.5" />
        Failed
      </div>
      <p className="mt-1 text-destructive break-words">{status.message}</p>
    </div>
  );

  function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className={mono ? "font-mono" : "font-medium"}>{value}</span>
      </div>
    );
  }

  function HashRow({ hash }: { hash: string }) {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-mono break-all">
        <span className="text-muted-foreground">{hash}</span>
        <div className="flex gap-1 flex-none">
          <button
            onClick={() => {
              navigator.clipboard.writeText(hash).catch(() => {});
              toast({ title: "Hash copied" });
            }}
            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:border-primary/50"
          >
            <Copy className="h-3 w-3" />
          </button>
          <a
            href={`/block-explorer?q=${hash}`}
            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:border-primary/50"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    );
  }
}

function RecentTokens({
  tokens,
  loading,
  myAddress,
  onRefresh,
}: {
  tokens: TokenInfo[];
  loading: boolean;
  myAddress: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-4 py-3 flex items-center gap-2">
        <Search className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Recent Tokens on Chain</h2>
        <span className="text-xs text-muted-foreground">
          {tokens.length > 0 ? `showing ${tokens.length}` : ""}
        </span>
        <button
          onClick={onRefresh}
          className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:border-primary/50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">ID</th>
              <th className="text-left px-4 py-2 font-medium">Symbol</th>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-right px-4 py-2 font-medium">Decimals</th>
              <th className="text-right px-4 py-2 font-medium">Supply</th>
              <th className="text-left px-4 py-2 font-medium">Creator</th>
            </tr>
          </thead>
          <tbody>
            {loading && tokens.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Loading tokens…
                </td>
              </tr>
            ) : tokens.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No user-created tokens yet — be the first.
                </td>
              </tr>
            ) : (
              tokens.map((t) => {
                const mine = myAddress &&
                  t.creator.toLowerCase() === myAddress.toLowerCase();
                return (
                  <tr key={t.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono text-xs">#{t.id}</td>
                    <td className="px-4 py-2 font-mono text-primary">{t.symbol}</td>
                    <td className="px-4 py-2">
                      {t.name}
                      {mine && (
                        <span className="ml-2 text-[10px] uppercase text-emerald-500 border border-emerald-500/40 rounded px-1">
                          you
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{t.decimals}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {baseToDisplay(t.total_supply, t.decimals, 2)} {t.symbol}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {shortAddr(t.creator)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
