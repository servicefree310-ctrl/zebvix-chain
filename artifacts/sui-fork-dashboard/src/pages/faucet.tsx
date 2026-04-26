import React, { useState } from "react";
import { Link } from "wouter";
import {
  Droplets, Clock, ShieldCheck, Wallet, ArrowRight, Check, Copy,
  ExternalLink, Sparkles, Zap, AlertTriangle,
} from "lucide-react";

const FAUCET_ENDPOINT = "https://faucet.zebvix.io";

const STEPS = [
  { icon: Wallet,     title: "1. Get an address",  desc: "Open the wallet and copy your ZBX address." },
  { icon: ArrowRight, title: "2. Request tokens",  desc: "Paste the address below and submit." },
  { icon: Sparkles,   title: "3. Test on testnet", desc: "Tokens arrive in ~10 seconds — go build." },
];

const RULES = [
  { icon: Clock,       label: "Cooldown",  desc: "1 request per address every 24 hours." },
  { icon: ShieldCheck, label: "Anti-abuse", desc: "Per-IP and per-address rate limits." },
  { icon: Droplets,    label: "Drip size", desc: "1.0 test ZBX per request." },
];

function isHexAddr(v: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(v.trim());
}

export default function Faucet() {
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; txHash?: string } | null>(null);

  const submit = async () => {
    setResult(null);
    if (!isHexAddr(addr)) {
      setResult({ ok: false, msg: "Address must be a 0x-prefixed 40-character hex string." });
      return;
    }
    setBusy(true);
    try {
      // Best-effort call — the faucet endpoint is environment-dependent.
      // Falls back to an instructional message if the endpoint is unreachable.
      const r = await fetch(`${FAUCET_ENDPOINT}/drip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr.trim(), amount: "1.0" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json().catch(() => ({} as any));
      setResult({
        ok: true,
        msg: "1.0 test ZBX is on its way to your address.",
        txHash: j.txHash || j.hash || undefined,
      });
    } catch {
      setResult({
        ok: false,
        msg: "Faucet endpoint unreachable from here. Use the wallet's built-in faucet button or a community-run faucet.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <header>
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-300 text-[10px] font-bold uppercase tracking-widest mb-3">
          <Droplets className="h-3 w-3" />
          Testnet Faucet
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-2">
          Get Free Test ZBX
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-3xl">
          Paste your wallet address to receive test ZBX on the Zebvix testnet — perfect for trying swaps,
          deploying contracts, and integrating dApps without spending real value.
        </p>
      </header>

      {/* Drip card */}
      <section className="rounded-xl border border-border/60 bg-gradient-to-br from-card/60 to-card/20 backdrop-blur p-6">
        <header className="flex items-center gap-2 mb-4">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Request 1.0 test ZBX
          </h2>
        </header>
        <div className="flex flex-col md:flex-row gap-2">
          <input
            type="text"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="0x... (40-char ZBX address)"
            className="flex-1 rounded-md border border-border/60 bg-background px-3 py-2.5 text-sm font-mono text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:bg-background/90 transition-colors"
            data-testid="faucet-address-input"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            data-testid="faucet-submit"
          >
            <Droplets className="h-4 w-4" />
            {busy ? "Sending…" : "Send 1.0 ZBX"}
          </button>
        </div>

        {result && (
          <div
            className={`mt-3 rounded-lg border px-3 py-2.5 text-sm flex items-start gap-2 ${
              result.ok
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
                : "border-amber-500/30 bg-amber-500/5 text-amber-200"
            }`}
            data-testid="faucet-result"
          >
            {result.ok ? (
              <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            )}
            <div className="space-y-1">
              <div>{result.msg}</div>
              {result.txHash && (
                <div className="font-mono text-xs flex items-center gap-2">
                  <span className="text-muted-foreground">tx:</span>
                  <span className="truncate">{result.txHash}</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(result.txHash!)}
                    className="text-emerald-300 hover:text-emerald-200"
                    aria-label="Copy tx hash"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          {RULES.map(({ icon: Icon, label, desc }) => (
            <div
              key={label}
              className="flex items-start gap-2 rounded-md border border-border/40 bg-background/40 px-3 py-2"
            >
              <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <div className="text-foreground font-semibold">{label}</div>
                <div className="text-muted-foreground">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STEPS.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="rounded-xl border border-border/60 bg-card/40 p-4"
          >
            <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="text-xs text-muted-foreground mt-1">{desc}</div>
          </div>
        ))}
      </section>

      {/* Useful links */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Link href="/wallet">
          <span className="group block rounded-xl border border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card/60 p-4 cursor-pointer transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  Open Wallet
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Create or import an address.
                </div>
              </div>
              <Wallet className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </span>
        </Link>
        <Link href="/balance-lookup">
          <span className="group block rounded-xl border border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card/60 p-4 cursor-pointer transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  Check Balance
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  See if your test ZBX has arrived.
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </span>
        </Link>
        <a
          href="https://docs.zebvix.io"
          target="_blank"
          rel="noopener noreferrer"
          className="group block rounded-xl border border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card/60 p-4 cursor-pointer transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                Developer Docs
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Read the testnet integration guide.
              </div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
        </a>
      </section>

      {/* Footnote */}
      <section className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-amber-500/5 p-4 text-sm flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-amber-200">Test ZBX has no real value.</div>
          <div className="text-foreground/80">
            Faucet tokens live only on the Zebvix testnet. Never share your private key with a faucet —
            you only need to share your <em>address</em>.
          </div>
        </div>
      </section>
    </div>
  );
}
