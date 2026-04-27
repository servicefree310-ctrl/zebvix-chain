import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { usePublicConfig } from "@/lib/use-brand-config";
import {
  Rocket,
  Globe,
  Smartphone,
  Wallet as WalletIcon,
  ArrowUpDown,
  Shield,
  Zap,
  Clock,
  CheckCircle2,
  Circle,
  Layers,
  TrendingUp,
  Twitter,
  MessageCircle,
  ExternalLink,
  Mail,
  Building2,
  Cpu,
  Lock,
  Network,
  BarChart3,
} from "lucide-react";
import { Link } from "wouter";

const NEWS_KEY = "zbx_launch_notify_v1";

type Phase = {
  id: string;
  title: string;
  status: "live" | "in-progress" | "planned";
  when: string;
  bullets: string[];
};

const ROADMAP: Phase[] = [
  {
    id: "p0",
    title: "Phase 0 — Public Testnet (Web)",
    status: "live",
    when: "Live now",
    bullets: [
      "Zebvix L1 testnet running, chain id 7878, Cancun hardfork",
      "Web wallet, swap, faucet, AMM pool & block explorer reachable from this dashboard",
      "Pro DEX terminal with live charts and on-chain order routing",
      "Public RPC + WebSocket endpoints for builders",
    ],
  },
  {
    id: "p1",
    title: "Phase 1 — Mainnet Genesis",
    status: "in-progress",
    when: "Target: launch day",
    bullets: [
      "Audited validator set, slashing, governance, and on-chain treasury",
      "Final ZBX tokenomics, vesting, and staking enabled",
      "Production block explorer + indexer at the public domain",
      "Pay-ID, multisig, and bridge available for end users",
    ],
  },
  {
    id: "p2",
    title: "Phase 2 — Zebvix Exchange (Web)",
    status: "in-progress",
    when: "Same day as mainnet",
    bullets: [
      "Centralized order-book exchange with spot, margin, and perpetual futures",
      "Deep liquidity via market-maker partners and on-chain ZBX/zUSD pool",
      "KYC/AML flow, fiat ramps, and proof-of-reserves dashboard",
      "Listing program for projects launched on Zebvix L1",
    ],
  },
  {
    id: "p3",
    title: "Phase 3 — Mobile Wallet App",
    status: "planned",
    when: "Within 60 days of mainnet",
    bullets: [
      "Native iOS + Android wallet (Flutter), self-custody",
      "Send / receive ZBX, swap, stake, and bridge from your phone",
      "WalletConnect v2, hardware wallet pairing, biometric unlock",
      "Push notifications for incoming transfers and price alerts",
    ],
  },
  {
    id: "p4",
    title: "Phase 4 — Exchange Mobile App",
    status: "planned",
    when: "90–120 days post-mainnet",
    bullets: [
      "Full trading terminal on iOS + Android",
      "Spot, futures, copy-trading, and savings products",
      "Single sign-on across web + mobile, biometric 2FA",
      "Native price-alert engine and TradingView-grade charts",
    ],
  },
  {
    id: "p5",
    title: "Phase 5 — Ecosystem & Cards",
    status: "planned",
    when: "H2 after mainnet",
    bullets: [
      "Zebvix debit / prepaid card with on-chain spend",
      "Merchant Pay-ID acceptance and SDK for third-party apps",
      "Grants program for L1 builders and liquidity providers",
      "On-chain identity (zID) with selective KYC disclosure",
    ],
  },
];

function statusPill(status: Phase["status"]) {
  if (status === "live") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/20">
        <CheckCircle2 className="h-3 w-3 mr-1" /> Live
      </Badge>
    );
  }
  if (status === "in-progress") {
    return (
      <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/20">
        <Clock className="h-3 w-3 mr-1" /> In progress
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground border-border">
      <Circle className="h-3 w-3 mr-1" /> Planned
    </Badge>
  );
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function diffParts(targetMs: number, nowMs: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  past: boolean;
} {
  const ms = targetMs - nowMs;
  const past = ms <= 0;
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  return { days, hours, minutes, seconds, past };
}

function CountdownBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 px-3 py-3 sm:px-5 sm:py-4 min-w-[68px] sm:min-w-[96px] shadow-[0_0_30px_-12px_rgba(16,185,129,0.45)]">
      <span
        className="text-2xl sm:text-4xl font-mono font-bold text-primary tabular-nums leading-none"
        data-testid={`countdown-${label.toLowerCase()}`}
      >
        {pad2(value)}
      </span>
      <span className="mt-1.5 text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function Countdown({ targetMs }: { targetMs: number }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const parts = useMemo(() => diffParts(targetMs, now), [targetMs, now]);

  if (!Number.isFinite(targetMs)) {
    return (
      <div className="text-sm text-muted-foreground">
        Launch date will be announced soon.
      </div>
    );
  }

  if (parts.past) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Badge className="bg-emerald-500 text-white border-0 text-sm px-3 py-1">
          <Zap className="h-3.5 w-3.5 mr-1.5" /> Launch window open
        </Badge>
        <span className="text-xs text-muted-foreground font-mono">
          T+{parts.days}d {pad2(parts.hours)}:{pad2(parts.minutes)}:
          {pad2(parts.seconds)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex gap-2 sm:gap-3" data-testid="launch-countdown">
      <CountdownBox label="Days" value={parts.days} />
      <CountdownBox label="Hours" value={parts.hours} />
      <CountdownBox label="Minutes" value={parts.minutes} />
      <CountdownBox label="Seconds" value={parts.seconds} />
    </div>
  );
}

function ProductCard({
  icon: Icon,
  title,
  tag,
  tagClass,
  blurb,
  bullets,
  cta,
  ctaHref,
}: {
  icon: React.ElementType;
  title: string;
  tag: string;
  tagClass: string;
  blurb: string;
  bullets: string[];
  cta: string;
  ctaHref: string;
}) {
  const isInternal = ctaHref.startsWith("/");
  return (
    <Card className="relative overflow-hidden p-6 border-border/60 bg-gradient-to-br from-card to-card/50">
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-3 mb-3">
          <div className="rounded-lg bg-primary/15 p-2 border border-primary/30">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <Badge className={`ml-auto text-[10px] ${tagClass}`}>{tag}</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{blurb}</p>
        <ul className="space-y-2 mb-5">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span className="text-foreground/90">{b}</span>
            </li>
          ))}
        </ul>
        {isInternal ? (
          <Link href={ctaHref}>
            <Button className="w-full" variant="outline">
              {cta}
            </Button>
          </Link>
        ) : (
          <a href={ctaHref} target="_blank" rel="noopener noreferrer">
            <Button className="w-full" variant="outline">
              {cta} <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </a>
        )}
      </div>
    </Card>
  );
}

function PlatformChip({
  icon: Icon,
  label,
  status,
}: {
  icon: React.ElementType;
  label: string;
  status: "live" | "soon" | "planned";
}) {
  const map = {
    live: {
      ring: "border-emerald-500/40 bg-emerald-500/10",
      dot: "bg-emerald-400",
      pill: "text-emerald-300",
      text: "Available now",
    },
    soon: {
      ring: "border-amber-500/40 bg-amber-500/10",
      dot: "bg-amber-400",
      pill: "text-amber-300",
      text: "Coming soon",
    },
    planned: {
      ring: "border-border bg-muted/30",
      dot: "bg-muted-foreground",
      pill: "text-muted-foreground",
      text: "Planned",
    },
  } as const;
  const m = map[status];
  return (
    <div className={`flex items-center gap-3 rounded-lg border ${m.ring} px-4 py-3`}>
      <Icon className="h-5 w-5 text-foreground/80" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{label}</div>
        <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
          <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
          <span className={m.pill}>{m.text}</span>
        </div>
      </div>
    </div>
  );
}

function NotifyForm({ supportEmail }: { supportEmail: string }) {
  const [email, setEmail] = useState("");
  const [registered, setRegistered] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return !!window.localStorage.getItem(NEWS_KEY);
    } catch {
      return false;
    }
  });
  const { toast } = useToast();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    if (!valid) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }
    try {
      window.localStorage.setItem(
        NEWS_KEY,
        JSON.stringify({ email: v, at: Date.now() }),
      );
    } catch {
      // localStorage unavailable — still confirm to the user below
    }
    setRegistered(true);
    toast({
      title: "You're on the list",
      description: supportEmail
        ? `We'll email ${v} when launch goes live. For partnerships, write to ${supportEmail}.`
        : `We'll email ${v} when launch goes live.`,
    });
  };

  if (registered) {
    return (
      <div
        className="flex items-center gap-2 text-sm text-emerald-300"
        data-testid="notify-confirmed"
      >
        <CheckCircle2 className="h-4 w-4" />
        You're on the launch notification list.
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.removeItem(NEWS_KEY);
            } catch {
              // ignore
            }
            setRegistered(false);
            setEmail("");
          }}
          className="ml-2 underline text-xs text-muted-foreground hover:text-foreground"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col sm:flex-row gap-2 max-w-xl"
      data-testid="notify-form"
    >
      <Input
        type="email"
        required
        placeholder="you@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="flex-1"
        data-testid="notify-email"
        aria-label="Email for launch notifications"
      />
      <Button type="submit" data-testid="notify-submit">
        <Mail className="h-4 w-4 mr-2" />
        Notify me at launch
      </Button>
    </form>
  );
}

export default function Launch() {
  const cfg = usePublicConfig();
  const targetMs = useMemo(() => {
    const t = Date.parse(cfg.launchDateIso);
    return Number.isFinite(t) ? t : NaN;
  }, [cfg.launchDateIso]);

  const targetLabel = useMemo(() => {
    if (!Number.isFinite(targetMs)) return "TBA";
    try {
      return new Date(targetMs).toLocaleString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
    } catch {
      return new Date(targetMs).toUTCString();
    }
  }, [targetMs]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-10">
      {/* Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-6 sm:p-10">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
        <div className="absolute -left-24 -bottom-24 h-72 w-72 rounded-full bg-sky-500/15 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-4">
            <Badge className="bg-primary/20 text-primary border border-primary/40">
              <Rocket className="h-3 w-3 mr-1" /> Launch Announcement
            </Badge>
            <Badge variant="outline" className="text-amber-300 border-amber-500/40">
              MAINNET + EXCHANGE
            </Badge>
            <Badge variant="outline" className="text-sky-300 border-sky-500/40">
              {cfg.brandName || "Zebvix"}
            </Badge>
          </div>
          <h1
            className="text-3xl sm:text-5xl font-bold leading-tight max-w-4xl"
            data-testid="launch-headline"
          >
            {cfg.launchHeadline}
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-3xl">
            {cfg.launchSubline}
          </p>

          <div className="mt-8 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>Time until launch</span>
              <span className="text-foreground/80 font-mono normal-case tracking-normal">
                · {targetLabel}
              </span>
            </div>
            <Countdown targetMs={targetMs} />
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/dex">
              <Button size="lg" data-testid="cta-try-dex">
                Try the live DEX
              </Button>
            </Link>
            <Link href="/wallet">
              <Button size="lg" variant="outline" data-testid="cta-open-wallet">
                Open testnet wallet
              </Button>
            </Link>
            {cfg.docsUrl && (
              <a href={cfg.docsUrl} target="_blank" rel="noopener noreferrer">
                <Button size="lg" variant="ghost">
                  Read docs <ExternalLink className="h-4 w-4 ml-1.5" />
                </Button>
              </a>
            )}
          </div>
        </div>
      </section>

      {/* What's launching ────────────────────────────────────────── */}
      <section>
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-2xl font-bold">What's launching</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Two flagship products going live together — chain and exchange,
              built to plug straight into each other.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <ProductCard
            icon={Layers}
            title="Zebvix Chain (L1)"
            tag="MAINNET"
            tagClass="bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
            blurb="EVM-compatible Layer-1 with built-in DEX, AMM, bridge, Pay-ID and multisig as native primitives."
            bullets={[
              "High-throughput consensus, ~2s blocks, Cancun hardfork",
              "Native ZBX gas + zUSD stable, on-chain AMM and order routing",
              "First-class Pay-ID, multisig, bridge and faucet endpoints",
              "Public RPC, WebSocket, indexer + block explorer at launch",
            ]}
            cta="Explore the chain"
            ctaHref="/live-chain"
          />
          <ProductCard
            icon={BarChart3}
            title="Zebvix Exchange"
            tag="BINANCE-GRADE"
            tagClass="bg-amber-500/15 text-amber-300 border border-amber-500/40"
            blurb="Centralised exchange with a deep order book, spot, margin and futures — paired with the on-chain pool for hybrid liquidity."
            bullets={[
              "Spot, margin and perpetual futures with deep liquidity",
              "Fiat on-ramps, KYC/AML, proof-of-reserves dashboard",
              "Hybrid CEX + on-chain ZBX/zUSD pool routing",
              "Listing track for tokens minted on Zebvix L1",
            ]}
            cta="Preview the pro DEX"
            ctaHref="/dex"
          />
        </div>
      </section>

      {/* Platform availability ──────────────────────────────────── */}
      <section>
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-2xl font-bold">Where you can use it</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Web is live first. Mobile wallet and exchange apps follow on a
              fixed schedule.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <PlatformChip icon={Globe} label="Web Dashboard" status="live" />
          <PlatformChip icon={ArrowUpDown} label="Web DEX & Exchange" status="soon" />
          <PlatformChip icon={WalletIcon} label="Mobile Wallet (iOS + Android)" status="planned" />
          <PlatformChip icon={Smartphone} label="Mobile Exchange (iOS + Android)" status="planned" />
        </div>
      </section>

      {/* Roadmap ────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-2xl font-bold">Roadmap</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Honest phasing — what is live, what is in progress, what is
              planned. Dates may shift; status will not.
            </p>
          </div>
        </div>
        <div className="space-y-3" data-testid="roadmap-list">
          {ROADMAP.map((p, idx) => (
            <Card
              key={p.id}
              className="p-5 border-border/60"
              data-testid={`roadmap-${p.id}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="flex sm:flex-col items-center sm:items-start gap-3 sm:min-w-[110px]">
                  <div className="rounded-md bg-muted/50 border border-border/60 px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
                    {String(idx).padStart(2, "0")}
                  </div>
                  {statusPill(p.status)}
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
                    <h3 className="text-lg font-semibold">{p.title}</h3>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      {p.when}
                    </span>
                  </div>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                    {p.bullets.map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary/70 shrink-0" />
                        <span className="text-foreground/90">{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Pillars / why ──────────────────────────────────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            icon: Zap,
            title: "Fast & low fee",
            body: "~2s blocks and minimal gas — built for consumer-grade UX, not just power users.",
          },
          {
            icon: Shield,
            title: "Audited & open",
            body: "Public source, third-party security review, on-chain proof-of-reserves at exchange launch.",
          },
          {
            icon: Network,
            title: "EVM-compatible",
            body: "Bring your Solidity, Hardhat and Foundry stack — deploy in minutes, no rewrite.",
          },
          {
            icon: Lock,
            title: "Self-custody first",
            body: "Wallet keys never leave your device. Exchange custody is opt-in, segregated, and provable.",
          },
        ].map((p) => (
          <Card
            key={p.title}
            className="p-5 border-border/60 bg-gradient-to-br from-card to-card/40"
          >
            <p.icon className="h-5 w-5 text-primary mb-2" />
            <h4 className="font-semibold mb-1">{p.title}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {p.body}
            </p>
          </Card>
        ))}
      </section>

      {/* Notify + community ─────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2 p-6 border-primary/30 bg-gradient-to-br from-primary/10 to-card">
          <div className="flex items-center gap-2 mb-3">
            <Mail className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">Get notified at launch</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Drop your email and we'll ping you the moment the chain goes live
            and the exchange opens deposits. No spam — just the launch alert.
          </p>
          <NotifyForm supportEmail={cfg.supportEmail || ""} />
        </Card>

        <Card className="p-6 border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">Follow & talk to us</h3>
          </div>
          <div className="space-y-2">
            {cfg.twitterUrl && (
              <a
                href={cfg.twitterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 hover:bg-muted/40 transition-colors text-sm"
              >
                <Twitter className="h-4 w-4 text-sky-300" /> Twitter / X
                <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </a>
            )}
            {cfg.discordUrl && (
              <a
                href={cfg.discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 hover:bg-muted/40 transition-colors text-sm"
              >
                <MessageCircle className="h-4 w-4 text-violet-300" /> Discord
                <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </a>
            )}
            {cfg.githubUrl && (
              <a
                href={cfg.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 hover:bg-muted/40 transition-colors text-sm"
              >
                <Cpu className="h-4 w-4 text-foreground" /> GitHub
                <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </a>
            )}
            {cfg.supportEmail && (
              <a
                href={`mailto:${cfg.supportEmail}`}
                className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 hover:bg-muted/40 transition-colors text-sm"
              >
                <Mail className="h-4 w-4 text-emerald-300" /> {cfg.supportEmail}
              </a>
            )}
            {!cfg.twitterUrl &&
              !cfg.discordUrl &&
              !cfg.githubUrl &&
              !cfg.supportEmail && (
                <p className="text-xs text-muted-foreground">
                  Social links can be added from the Admin Panel → Links.
                </p>
              )}
          </div>
        </Card>
      </section>

      {/* Footer trust note ──────────────────────────────────────── */}
      <section>
        <Card className="p-5 border-border/60 bg-muted/20">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Honest disclosure.</strong>{" "}
              The Zebvix chain is currently running as a public testnet — every
              transaction you see in this dashboard is real on-chain activity on
              chain id 7878. The mainnet and exchange are launching on the date
              shown above. Mobile wallet and exchange apps roll out after web
              launch on the schedule in the roadmap. Nothing on this page is
              investment advice; ZBX is a utility token and trading any digital
              asset carries risk.
            </div>
          </div>
        </Card>
      </section>

      {/* Quick links footer ─────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5" />
          <span>Useful next steps:</span>
          <Link href="/dex" className="underline hover:text-foreground">
            Pro DEX
          </Link>
          <span>·</span>
          <Link href="/wallet" className="underline hover:text-foreground">
            Web Wallet
          </Link>
          <span>·</span>
          <Link href="/faucet" className="underline hover:text-foreground">
            Testnet Faucet
          </Link>
          <span>·</span>
          <Link href="/live-chain" className="underline hover:text-foreground">
            Live Chain
          </Link>
          <span>·</span>
          <Link href="/admin" className="underline hover:text-foreground">
            Admin
          </Link>
        </div>
      </section>
    </div>
  );
}
