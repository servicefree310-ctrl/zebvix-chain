import React, { useState } from "react";
import { Link } from "wouter";
import {
  Droplets, Clock, ShieldCheck, Wallet, ArrowRight, Check, Copy,
  ExternalLink, Sparkles, Zap, AlertTriangle, CheckCircle2,
  Activity
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

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

function StatTile({
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
    <div className="border border-border rounded-lg p-4 bg-card/60">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide mb-2">
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
      <div className="text-2xl font-mono font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  );
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
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">
            Faucet
          </Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
            Testnet
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Droplets className="w-7 h-7 text-primary" />
          Testnet Faucet
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Paste your wallet address to receive test ZBX on the Zebvix testnet — perfect for trying swaps, deploying contracts, and integrating dApps without spending real value.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">Testnet Funding</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                <strong className="text-emerald-400">1.0 ZBX</strong> per request
              </li>
              <li>
                <strong className="text-emerald-400">24-hour cooldown</strong> per address/IP
              </li>
              <li>
                Funds have <strong className="text-emerald-400">no real value</strong>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatTile
          icon={Droplets}
          label="Drip Amount"
          value="1.0"
          sub="Test ZBX per request"
        />
        <StatTile
          icon={Clock}
          label="Cooldown"
          value="24h"
          sub="Per address and IP limit"
        />
        <StatTile
          icon={Activity}
          label="Network"
          value="Testnet"
          sub="Test tokens only"
        />
      </div>

      {/* Drip card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Request 1.0 test ZBX
          </CardTitle>
          <CardDescription>
            Enter your 0x-prefixed Zebvix address below to receive test funds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-3">
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
              className={`mt-4 rounded-lg border px-3 py-2.5 text-sm flex items-start gap-2 ${
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
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {STEPS.map(({ icon: Icon, title, desc }) => (
          <Card key={title}>
            <CardHeader className="pb-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Useful links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/wallet">
          <Card className="hover:border-primary/40 hover:bg-card/60 cursor-pointer transition-colors h-full">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base group-hover:text-primary transition-colors">
                    Open Wallet
                  </CardTitle>
                </div>
                <Wallet className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Create or import an address.</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/balance-lookup">
          <Card className="hover:border-primary/40 hover:bg-card/60 cursor-pointer transition-colors h-full">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base group-hover:text-primary transition-colors">
                    Check Balance
                  </CardTitle>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">See if your test ZBX has arrived.</p>
            </CardContent>
          </Card>
        </Link>
        <a
          href="https://docs.zebvix.io"
          target="_blank" rel="noopener noreferrer"
          className="block h-full"
        >
          <Card className="hover:border-primary/40 hover:bg-card/60 cursor-pointer transition-colors h-full">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base group-hover:text-primary transition-colors">
                    Developer Docs
                  </CardTitle>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Read the testnet integration guide.</p>
            </CardContent>
          </Card>
        </a>
      </div>

      {/* Footnote */}
      <div className="border-l-4 border-l-amber-500/50 bg-amber-500/5 p-4 rounded-md flex gap-3 text-sm">
        <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-amber-200">Test ZBX has no real value.</div>
          <div className="text-muted-foreground">
            Faucet tokens live only on the Zebvix testnet. Never share your private key with a faucet —
            you only need to share your <em>address</em>.
          </div>
        </div>
      </div>
    </div>
  );
}
