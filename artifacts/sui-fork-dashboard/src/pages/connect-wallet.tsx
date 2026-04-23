import React, { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Smartphone, RefreshCw, CheckCircle2, AlertCircle, Copy, ArrowUpRight,
  Wifi, WifiOff, ShieldCheck, Loader2, Trash2, Send, ArrowDownUp, Lock,
} from "lucide-react";

const API_BASE = (import.meta as any).env?.BASE_URL?.replace(/\/+$/, "") || "";
const PAIR_API = "/api/pair";

type InitRes = { sessionId: string; secret: string; qr: string; expiresAt: number };
type StateRes = {
  sessionId: string;
  paired: boolean;
  address: string | null;
  payIdName: string | null;
  meta: any;
  lastEvent: number;
};

async function postJson<T>(path: string, body: any = {}): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
  return r.json();
}
async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
  return r.json();
}

function shortAddr(a?: string | null): string {
  if (!a) return "—";
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

function fmtAge(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function ConnectWalletPage() {
  const [session, setSession] = useState<InitRes | null>(null);
  const [state, setState] = useState<StateRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const pollTimer = useRef<any>(null);

  async function init() {
    setBusy(true);
    setErr(null);
    setState(null);
    try {
      const r = await postJson<InitRes>(`${PAIR_API}/init`);
      setSession(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshState() {
    if (!session) return;
    try {
      const s = await getJson<StateRes>(`${PAIR_API}/state/${session.sessionId}`);
      setState(s);
    } catch {
      /* ignore */
    }
  }

  async function disconnect() {
    if (!session) return;
    await postJson(`${PAIR_API}/disconnect/${session.sessionId}`).catch(() => null);
    setSession(null);
    setState(null);
  }

  useEffect(() => { init(); }, []);
  useEffect(() => {
    if (!session) return;
    refreshState();
    pollTimer.current = setInterval(refreshState, 1500);
    return () => clearInterval(pollTimer.current);
  }, [session?.sessionId]);

  const expiresIn = session ? Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)) : 0;
  const expiredSoon = expiresIn < 60 && expiresIn > 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2 flex items-center gap-3">
          <Smartphone className="h-7 w-7 text-primary" />
          Connect Wallet
        </h1>
        <p className="text-sm text-muted-foreground">
          Scan the QR with the <strong className="text-foreground">Zebvix Wallet</strong> mobile app to pair this browser session.
          Once paired, the dashboard can request signatures (transfer, swap, multisig approve) — your private keys never leave your phone.
        </p>
      </div>

      {err && (
        <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/5 text-sm flex gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <span className="text-red-300">{err}</span>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* QR PANEL */}
        <div className="rounded-xl border border-border bg-gradient-to-br from-card via-card to-primary/5 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              Pairing QR
            </h2>
            <button
              onClick={init}
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded border border-border hover:bg-muted/40 flex items-center gap-1.5"
            >
              <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
              new session
            </button>
          </div>

          <div className="rounded-lg bg-white p-5 mx-auto w-fit border-4 border-primary/20 relative">
            {session ? (
              <>
                <QRCodeSVG
                  value={session.qr}
                  size={240}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  level="M"
                  includeMargin={false}
                />
                {state?.paired && (
                  <div className="absolute inset-0 bg-emerald-500/95 rounded flex flex-col items-center justify-center text-white animate-in zoom-in-50 duration-300">
                    <CheckCircle2 className="h-16 w-16 mb-2" />
                    <div className="text-lg font-bold">Paired</div>
                  </div>
                )}
              </>
            ) : (
              <div className="w-[240px] h-[240px] flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            )}
          </div>

          {session && (
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Session ID</span>
                <code className="font-mono text-foreground">{session.sessionId}</code>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Expires</span>
                <span className={expiredSoon ? "text-amber-400" : "text-foreground"}>
                  in {Math.floor(expiresIn / 60)}m {expiresIn % 60}s
                </span>
              </div>
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="text-[10px] text-primary hover:underline"
              >
                {showRaw ? "hide" : "show"} raw payload
              </button>
              {showRaw && (
                <div className="p-2 rounded bg-muted/40 font-mono text-[10px] break-all">
                  {session.qr}
                  <button
                    onClick={() => navigator.clipboard.writeText(session.qr).catch(() => null)}
                    className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Copy className="h-2.5 w-2.5" /> copy
                  </button>
                </div>
              )}
            </div>
          )}

          <ol className="text-xs text-muted-foreground space-y-1.5 pt-3 border-t border-border">
            <li>1. Open the <strong className="text-foreground">Zebvix Wallet</strong> app on your phone</li>
            <li>2. Tap the <strong className="text-foreground">Connect</strong> tab → <strong className="text-foreground">Scan QR</strong></li>
            <li>3. Point your camera at the QR above</li>
            <li>4. Approve the connection on your phone</li>
          </ol>
        </div>

        {/* STATUS PANEL */}
        <div className="space-y-4">
          <div className={`rounded-xl border p-5 ${state?.paired ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-card"}`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                {state?.paired ? <Wifi className="h-4 w-4 text-emerald-400" /> : <WifiOff className="h-4 w-4 text-muted-foreground" />}
                Connection Status
              </h2>
              {state?.paired && (
                <button
                  onClick={disconnect}
                  className="text-[10px] px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" /> disconnect
                </button>
              )}
            </div>

            {!state?.paired && (
              <div className="text-sm text-muted-foreground py-6 text-center">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                Waiting for mobile wallet to scan…
              </div>
            )}

            {state?.paired && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-emerald-500/20">
                  <div className="h-10 w-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground">Connected wallet</div>
                    <div className="font-mono text-sm font-semibold truncate">{shortAddr(state.address)}</div>
                    {state.payIdName && (
                      <div className="text-xs text-primary">@{state.payIdName}</div>
                    )}
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(state.address ?? "").catch(() => null)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="text-xs text-muted-foreground">
                  Last activity: {fmtAge(state.lastEvent)}
                </div>
              </div>
            )}
          </div>

          {/* ACTIONS — only when paired */}
          {state?.paired && session && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-primary" />
                Request from connected wallet
              </h2>
              <p className="text-xs text-muted-foreground">
                Send a signing request to your phone. Approve or reject it in the Zebvix Wallet app.
              </p>
              <SignRequestForm sessionId={session.sessionId} address={state.address!} />
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-xs">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-primary" />
              Security
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              The QR contains only an ephemeral session ID + secret — no keys, no balance access. Your private keys remain on your phone, encrypted with biometric / PIN. Each signing request must be approved on the device.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign request form — sends request to mobile via relay, polls for result
// ─────────────────────────────────────────────────────────────────────────────
type ReqType = "transfer" | "swap" | "multisig_approve" | "message";

function SignRequestForm({ sessionId, address }: { sessionId: string; address: string }) {
  const [type, setType] = useState<ReqType>("transfer");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [multisigAddr, setMultisigAddr] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [pending, setPending] = useState<{ requestId: string; type: string } | null>(null);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const buildPayload = (): any => {
    if (type === "transfer") return { from: address, to, amountZbx: amount, feeUsd: 0.002 };
    if (type === "swap") return { from: address, side: "zbx_to_zusd", amountZbx: amount };
    if (type === "multisig_approve") return { from: address, multisig: multisigAddr, proposalId };
    if (type === "message") return { from: address, message };
    return {};
  };

  async function send() {
    setErr(null);
    setResult(null);
    try {
      const r = await postJson<{ requestId: string }>(`${PAIR_API}/request/${sessionId}`, {
        type,
        payload: buildPayload(),
      });
      setPending({ requestId: r.requestId, type });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!pending) return;
    const t = setInterval(async () => {
      try {
        const r = await getJson<any>(`${PAIR_API}/result/${sessionId}/${pending.requestId}`);
        if (r.status !== "pending") {
          setResult(r);
          setPending(null);
          clearInterval(t);
        }
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [pending?.requestId]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-muted/30">
        {(["transfer", "swap", "multisig_approve", "message"] as ReqType[]).map((t) => (
          <button
            key={t}
            onClick={() => { setType(t); setResult(null); setPending(null); }}
            className={`text-[11px] py-1.5 rounded font-medium transition flex items-center justify-center gap-1 ${type === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t === "transfer" && <Send className="h-3 w-3" />}
            {t === "swap" && <ArrowDownUp className="h-3 w-3" />}
            {t === "multisig_approve" && <ShieldCheck className="h-3 w-3" />}
            {t === "message" && <Lock className="h-3 w-3" />}
            {t === "multisig_approve" ? "MS Approve" : t}
          </button>
        ))}
      </div>

      {type === "transfer" && (
        <>
          <Field label="To address" value={to} onChange={setTo} placeholder="0x... 40 hex" mono />
          <Field label="Amount (ZBX)" value={amount} onChange={setAmount} placeholder="1.5" />
        </>
      )}
      {type === "swap" && (
        <Field label="Amount (ZBX → zUSD)" value={amount} onChange={setAmount} placeholder="100" />
      )}
      {type === "multisig_approve" && (
        <>
          <Field label="Multisig address" value={multisigAddr} onChange={setMultisigAddr} placeholder="0x... 40 hex" mono />
          <Field label="Proposal ID" value={proposalId} onChange={setProposalId} placeholder="0" />
        </>
      )}
      {type === "message" && (
        <Field label="Message" value={message} onChange={setMessage} placeholder="Hello from dashboard" />
      )}

      <button
        onClick={send}
        disabled={!!pending}
        className="w-full px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 flex items-center justify-center gap-2"
      >
        {pending ? <><Loader2 className="h-4 w-4 animate-spin" /> waiting for phone…</> : <><ArrowUpRight className="h-4 w-4" /> send to phone</>}
      </button>

      {err && (
        <div className="p-2 rounded border border-red-500/30 bg-red-500/5 text-xs text-red-300">{err}</div>
      )}

      {result && (
        <div className={`p-3 rounded-lg border text-xs space-y-1 ${
          result.status === "approved" ? "border-emerald-500/30 bg-emerald-500/5" :
          result.status === "rejected" ? "border-amber-500/30 bg-amber-500/5" :
          "border-red-500/30 bg-red-500/5"
        }`}>
          <div className="flex items-center gap-1.5 font-semibold">
            {result.status === "approved" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> :
             result.status === "rejected" ? <AlertCircle className="h-4 w-4 text-amber-400" /> :
             <AlertCircle className="h-4 w-4 text-red-400" />}
            {result.status.toUpperCase()}
          </div>
          {result.result && (
            <pre className="font-mono text-[10px] bg-muted/30 p-2 rounded overflow-x-auto">
              {JSON.stringify(result.result, null, 2)}
            </pre>
          )}
          {result.error && <div className="text-red-300">{result.error}</div>}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full mt-1 px-2.5 py-1.5 rounded bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
