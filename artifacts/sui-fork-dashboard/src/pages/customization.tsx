import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Palette, Globe2, Bell, Wifi, Smartphone, Wallet, Shield, ChevronRight,
  Check, Languages, MoonStar, Sun, Monitor, Zap, Radio,
} from "lucide-react";
import { MAINNET_META, TESTNET_META } from "@/lib/use-network";
import { rpcPathFor } from "@/lib/zbx-rpc";

type Theme = "dark" | "light" | "system";
type Language = "en" | "hi" | "hinglish";

// Source the user-facing endpoint list from the central network registry so
// it stays in lock-step with the rest of the dashboard. The "vps" entry is
// the proxied path that the dashboard itself uses (network-aware).
const RPC_PRESETS = [
  { id: "mainnet", label: MAINNET_META.label,      url: MAINNET_META.rpcUrl,         chain: MAINNET_META.chainId, latency: "Live" },
  { id: "testnet", label: TESTNET_META.label,      url: TESTNET_META.rpcUrl,         chain: TESTNET_META.chainId, latency: "Live" },
  { id: "vps",     label: "Production Node (proxy)", url: rpcPathFor("mainnet"),     chain: MAINNET_META.chainId, latency: "Live" },
  { id: "custom",  label: "Custom Endpoint",         url: "",                        chain: 0,                    latency: "—" },
];

const LANGUAGES: { id: Language; label: string; native: string }[] = [
  { id: "en",       label: "English",          native: "English" },
  { id: "hi",       label: "Hindi",            native: "हिन्दी"  },
  { id: "hinglish", label: "Hinglish (mixed)", native: "Hinglish" },
];

export default function Customization() {
  const [theme, setTheme]         = useState<Theme>("dark");
  const [lang, setLang]           = useState<Language>("hinglish");
  const [rpc, setRpc]             = useState<string>("mainnet");
  const [customRpc, setCustomRpc] = useState<string>("");
  const [notifTx, setNotifTx]     = useState(true);
  const [notifPrice, setNotifPrice] = useState(true);
  const [notifGov, setNotifGov]   = useState(false);
  const [biometric, setBiometric] = useState(true);
  const [autoLock, setAutoLock]   = useState("5");
  const [saved, setSaved]         = useState(false);

  // Restore from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("zbx-prefs");
      if (raw) {
        const p = JSON.parse(raw);
        if (p.theme) setTheme(p.theme);
        if (p.lang)  setLang(p.lang);
        if (p.rpc)   setRpc(p.rpc);
        if (p.customRpc) setCustomRpc(p.customRpc);
        if (typeof p.notifTx    === "boolean") setNotifTx(p.notifTx);
        if (typeof p.notifPrice === "boolean") setNotifPrice(p.notifPrice);
        if (typeof p.notifGov   === "boolean") setNotifGov(p.notifGov);
        if (typeof p.biometric  === "boolean") setBiometric(p.biometric);
        if (p.autoLock) setAutoLock(p.autoLock);
      }
    } catch { /* ignore */ }
  }, []);

  const save = () => {
    try {
      localStorage.setItem("zbx-prefs", JSON.stringify({
        theme, lang, rpc, customRpc, notifTx, notifPrice, notifGov, biometric, autoLock,
      }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <header>
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest mb-3">
          <Palette className="h-3 w-3" />
          Personalize
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-2">
          Customize Your Zebvix Experience
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-3xl">
          Tune the dashboard, wallet, and notifications to your preference. All settings save locally to your browser — your keys and chain data are never affected.
        </p>
      </header>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Theme */}
        <Card icon={MoonStar} title="Appearance" subtitle="Light, dark, or follow your system.">
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: "dark",   label: "Dark",   icon: MoonStar },
              { id: "light",  label: "Light",  icon: Sun },
              { id: "system", label: "System", icon: Monitor },
            ] as { id: Theme; label: string; icon: React.ElementType }[]).map((opt) => {
              const Icon = opt.icon;
              const active = theme === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTheme(opt.id)}
                  className={`relative flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/60 bg-card/40 text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {opt.label}
                  {active && <Check className="absolute top-1 right-1 h-3 w-3 text-primary" />}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Language */}
        <Card icon={Languages} title="Language" subtitle="Pick the voice the app speaks in.">
          <div className="space-y-1.5">
            {LANGUAGES.map((l) => {
              const active = lang === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLang(l.id)}
                  className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/60 bg-card/40 hover:bg-muted/30"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Globe2 className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="font-medium">{l.label}</span>
                    <span className="text-xs text-muted-foreground">· {l.native}</span>
                  </span>
                  {active && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
        </Card>

        {/* RPC endpoint */}
        <Card icon={Radio} title="RPC Endpoint" subtitle="Choose which node powers the live data.">
          <div className="space-y-1.5">
            {RPC_PRESETS.map((p) => {
              const active = rpc === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setRpc(p.id)}
                  className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/60 bg-card/40 hover:bg-muted/30"
                  }`}
                >
                  <span className="flex flex-col items-start min-w-0">
                    <span className="font-medium">{p.label}</span>
                    <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[220px]">
                      {p.id === "custom" && !customRpc ? "Enter URL below" : (p.url || "—")}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {p.chain ? (
                      <span className="text-[10px] font-mono text-muted-foreground">chain {p.chain}</span>
                    ) : null}
                    <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${
                      p.latency === "Live" ? "text-emerald-400" : "text-muted-foreground"
                    }`}>
                      {p.latency === "Live" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                      {p.latency}
                    </span>
                    {active && <Check className="h-4 w-4 text-primary" />}
                  </span>
                </button>
              );
            })}
            {rpc === "custom" && (
              <input
                type="text"
                value={customRpc}
                onChange={(e) => setCustomRpc(e.target.value)}
                placeholder="https://your-rpc-endpoint.example.com"
                className="w-full mt-2 rounded-md border border-border/60 bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50"
              />
            )}
          </div>
        </Card>

        {/* Notifications */}
        <Card icon={Bell} title="Notifications" subtitle="What deserves a buzz on your phone or browser.">
          <div className="space-y-1">
            <Toggle
              label="Transaction confirmations"
              desc="Send / receive / contract calls."
              checked={notifTx}
              onChange={setNotifTx}
            />
            <Toggle
              label="Price alerts"
              desc="ZBX moves > 5 % within an hour."
              checked={notifPrice}
              onChange={setNotifPrice}
            />
            <Toggle
              label="Governance updates"
              desc="New proposals, vote windows, results."
              checked={notifGov}
              onChange={setNotifGov}
            />
          </div>
        </Card>

        {/* Security */}
        <Card icon={Shield} title="Security" subtitle="Protect your wallet without slowing it down.">
          <Toggle
            label="Biometric unlock"
            desc="Fingerprint / Face ID on supported devices."
            checked={biometric}
            onChange={setBiometric}
          />
          <div className="mt-3 space-y-1.5">
            <div className="text-xs font-medium text-foreground">Auto-lock after</div>
            <div className="grid grid-cols-4 gap-1.5">
              {["1", "5", "15", "60"].map((m) => {
                const active = autoLock === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAutoLock(m)}
                    className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m} min
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Quick links */}
        <Card icon={Smartphone} title="Connected Apps" subtitle="Manage what's plugged into your wallet.">
          <div className="space-y-1.5">
            <QuickLink href="/wallet"          icon={Wallet}    label="Wallet & Accounts" />
            <QuickLink href="/connect-wallet"  icon={Smartphone} label="Mobile Wallet (QR)" />
            <QuickLink href="/import-wallet"   icon={Wifi}      label="Import an Address" />
            <QuickLink href="/multisig-explorer" icon={Shield}  label="Multisig Wallets" />
          </div>
        </Card>
      </div>

      {/* Save bar */}
      <div className="sticky bottom-4 z-10">
        <div className="mx-auto max-w-2xl rounded-xl border border-border/60 bg-background/85 backdrop-blur p-3 flex items-center justify-between gap-3 shadow-lg">
          <span className="text-xs text-muted-foreground">
            {saved ? "✓ Preferences saved." : "Changes are saved locally to this browser."}
          </span>
          <button
            type="button"
            onClick={save}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Zap className="h-4 w-4" />
            Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({
  icon: Icon, title, subtitle, children,
}: { icon: React.ElementType; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 backdrop-blur p-5">
      <header className="flex items-start gap-3 mb-4">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Toggle({
  label, desc, checked, onChange,
}: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-start justify-between gap-3 rounded-lg border border-transparent hover:border-border/60 hover:bg-muted/20 px-2 py-2.5 text-left transition-colors"
      aria-pressed={checked}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {desc && <span className="block text-xs text-muted-foreground mt-0.5">{desc}</span>}
      </span>
      <span
        className={`shrink-0 mt-0.5 inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
          checked ? "bg-primary border-primary/50" : "bg-muted border-border/60"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-background shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function QuickLink({
  href, icon: Icon, label,
}: { href: string; icon: React.ElementType; label: string }) {
  return (
    <Link href={href}>
      <span className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 hover:bg-muted/30 px-3 py-2.5 text-sm cursor-pointer transition-colors">
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{label}</span>
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </span>
    </Link>
  );
}
