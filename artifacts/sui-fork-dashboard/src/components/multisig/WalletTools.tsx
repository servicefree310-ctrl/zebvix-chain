import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, X, Shuffle, Check, AlertCircle, Copy, Hash, Users, Key,
  Wand2, BookmarkPlus, Trash2, ChevronRight, Download, Upload,
  Eye, Sparkles, Terminal, RefreshCw, AlertTriangle, Info, Wallet,
  FileJson, ListPlus, Search, Crown, ShieldCheck, Loader2, Filter,
  ArrowDown, ArrowUp, Pencil, FileSignature,
} from "lucide-react";
import {
  isValidAddress, normalizeAddress, sortOwners, deriveMultisigAddress,
  randomSalt, loadWatchlist, addToWatchlist, removeFromWatchlist,
  exportWatchlistJson, importWatchlistJson, fetchMultisigInfo,
  updateWatchlistMetadata, renameWatchlistEntry, parseAddressList,
  type WatchlistEntry, type MultisigMetadata,
} from "@/lib/multisig-utils";
import { rpc, weiHexToZbx, shortAddr, ZbxRpcError } from "@/lib/zbx-rpc";
import { loadWallets, isVaultNotReady, type StoredWallet } from "@/lib/web-wallet";

interface Props {
  onInspect: (addr: string) => void;
}

type Tab = "create" | "import" | "watchlist";

export default function WalletTools({ onInspect }: Props) {
  const [tab, setTab] = useState<Tab>("create");
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex border-b border-border">
        <TabBtn active={tab === "create"} onClick={() => setTab("create")} icon={Wand2}>
          Create
        </TabBtn>
        <TabBtn active={tab === "import"} onClick={() => setTab("import")} icon={ListPlus}>
          Import
        </TabBtn>
        <TabBtn active={tab === "watchlist"} onClick={() => setTab("watchlist")} icon={BookmarkPlus}>
          Watchlist
        </TabBtn>
      </div>
      {tab === "create" && <CreateWizard onInspect={onInspect} />}
      {tab === "import" && <ImportPanel onInspect={onInspect} />}
      {tab === "watchlist" && <WatchlistPanel onInspect={onInspect} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: {
  active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-4 py-3 text-xs font-semibold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 ${
        active
          ? "bg-primary/10 text-primary border-b-2 border-primary"
          : "text-muted-foreground hover:bg-muted/40"
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

/* ──────────────────────────────────────────── VAULT WALLETS HOOK ─ */
//
// Loads wallets from the in-browser AES-GCM vault, gracefully handling the
// "vault locked / not yet set up" case so the picker still renders without
// throwing.

interface VaultState {
  wallets: StoredWallet[];
  /** "ready" → unlocked + readable. "locked" → exists but needs unlock.
   *  "empty" → no vault yet (first-time user). "error" → unexpected failure. */
  status: "ready" | "locked" | "empty" | "error";
  error?: string;
}

function useVaultWallets(): VaultState {
  const [state, setState] = useState<VaultState>({ wallets: [], status: "empty" });
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      try {
        const ws = loadWallets();
        if (cancelled) return;
        setState({ wallets: ws, status: ws.length === 0 ? "empty" : "ready" });
      } catch (e) {
        if (cancelled) return;
        if (isVaultNotReady(e)) {
          setState({ wallets: [], status: "locked" });
        } else {
          setState({
            wallets: [],
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
    refresh();
    // Re-check on focus / storage events so the picker reflects vault changes
    // made elsewhere in the dashboard (e.g. /wallet page).
    const onStorage = () => refresh();
    const onFocus = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return state;
}

/* ──────────────────────────────────────────── CREATE WIZARD ─ */

function CreateWizard({ onInspect }: { onInspect: (addr: string) => void }) {
  const vault = useVaultWallets();

  const [creator, setCreator] = useState("");
  const [creatorSource, setCreatorSource] = useState<"manual" | "vault">("manual");
  const [owners, setOwners] = useState<string[]>(["", ""]);
  const [threshold, setThreshold] = useState(2);
  const [salt, setSalt] = useState<bigint>(0n);
  const [signerKeyPath, setSignerKeyPath] = useState("/root/.zebvix/founder.json");
  const [feeOverride, setFeeOverride] = useState("");
  const [rpcUrl, setRpcUrl] = useState("");
  const [existsCheck, setExistsCheck] = useState<"unknown" | "checking" | "free" | "taken">("unknown");
  const [copied, setCopied] = useState<string | null>(null);

  // Post-submit verification state.
  const [verifyState, setVerifyState] = useState<"idle" | "polling" | "confirmed" | "timeout">("idle");
  const [verifyAttempts, setVerifyAttempts] = useState(0);
  const verifyAbort = useRef<{ aborted: boolean }>({ aborted: false });

  // Initialize a random salt on mount.
  useEffect(() => { setSalt(randomSalt()); }, []);

  // If the vault has exactly one wallet, soft-suggest it as creator.
  useEffect(() => {
    if (creatorSource === "manual" && !creator && vault.status === "ready" && vault.wallets.length === 1) {
      setCreator(vault.wallets[0].address);
      setCreatorSource("vault");
    }
  }, [vault.status, vault.wallets, creator, creatorSource]);

  // Validation per row + aggregate.
  const ownerStatus = useMemo(() => {
    const norm = owners.map((o) => o.trim().toLowerCase());
    const seen = new Map<string, number>();
    return norm.map((o, i) => {
      if (o.length === 0) return { ok: false, reason: "empty" } as const;
      if (!isValidAddress(o)) return { ok: false, reason: "invalid" } as const;
      const prev = seen.get(o);
      seen.set(o, i);
      if (prev !== undefined) return { ok: false, reason: "duplicate" } as const;
      return { ok: true } as const;
    });
  }, [owners]);

  const validOwners = owners
    .map((o) => o.trim().toLowerCase())
    .filter((_, i) => ownerStatus[i].ok);
  const allOwnersValid = ownerStatus.every((s) => s.ok) && validOwners.length === owners.length;
  const ownerCountOk = owners.length >= 2 && owners.length <= 10;
  const creatorOk = isValidAddress(creator);
  const thresholdOk = threshold >= 1 && threshold <= owners.length;
  const formOk = ownerCountOk && allOwnersValid && creatorOk && thresholdOk;

  // Is the creator already in the owner list?
  const creatorInOwners = useMemo(() => {
    if (!creatorOk) return false;
    return validOwners.includes(creator.toLowerCase());
  }, [creatorOk, validOwners, creator]);

  // Live derived address — only when form is valid.
  const derived = useMemo(() => {
    if (!formOk) return null;
    try {
      return deriveMultisigAddress(sortOwners(validOwners), threshold, salt, creator.toLowerCase());
    } catch {
      return null;
    }
  }, [formOk, validOwners, threshold, salt, creator]);

  // Reset existence check + verify state when derived address changes.
  useEffect(() => {
    setExistsCheck("unknown");
    setVerifyState("idle");
    setVerifyAttempts(0);
    verifyAbort.current.aborted = true;
    verifyAbort.current = { aborted: false };
  }, [derived]);

  // Auto-clamp threshold when owners shrink below it.
  useEffect(() => {
    if (threshold > owners.length) setThreshold(Math.max(1, owners.length));
  }, [owners.length, threshold]);

  function setOwner(i: number, v: string) {
    setOwners((cur) => cur.map((o, idx) => (idx === i ? v : o)));
  }
  function addOwner() {
    if (owners.length >= 10) return;
    setOwners((cur) => [...cur, ""]);
  }
  function removeOwner(i: number) {
    if (owners.length <= 2) return;
    setOwners((cur) => cur.filter((_, idx) => idx !== i));
  }

  function pickVaultCreator(addr: string) {
    setCreator(addr);
    setCreatorSource("vault");
  }
  function clearCreator() {
    setCreator("");
    setCreatorSource("manual");
  }

  function addCreatorAsOwner() {
    if (!creatorOk || creatorInOwners) return;
    // Replace the first empty slot, else append (respecting MAX_OWNERS=10).
    setOwners((cur) => {
      const idx = cur.findIndex((o) => o.trim() === "");
      if (idx >= 0) {
        return cur.map((o, i) => (i === idx ? creator.toLowerCase() : o));
      }
      if (cur.length >= 10) return cur;
      return [...cur, creator.toLowerCase()];
    });
  }

  async function checkExists() {
    if (!derived) return;
    setExistsCheck("checking");
    try {
      await rpc("zbx_getMultisig", [derived]);
      setExistsCheck("taken");
    } catch (e) {
      if (e instanceof ZbxRpcError && e.code === -32004) setExistsCheck("free");
      else setExistsCheck("unknown");
    }
  }

  // Poll for the multisig appearing on-chain after the user runs the CLI.
  // Polls every 4s for up to 90s (~18 blocks @ 5s).
  async function startVerifyPoll() {
    if (!derived) return;
    verifyAbort.current.aborted = true;
    const handle = { aborted: false };
    verifyAbort.current = handle;
    setVerifyState("polling");
    setVerifyAttempts(0);
    const MAX_ATTEMPTS = 23;
    const INTERVAL_MS = 4000;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (handle.aborted) return;
      setVerifyAttempts(i + 1);
      try {
        const meta = await fetchMultisigInfo(derived);
        if (meta) {
          if (handle.aborted) return;
          setVerifyState("confirmed");
          setExistsCheck("taken");
          // Auto-bookmark with full metadata.
          const label = `${threshold}-of-${owners.length} multisig`;
          addToWatchlist(label, derived, meta);
          return;
        }
      } catch {
        // Transient; keep polling.
      }
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
    if (!handle.aborted) setVerifyState("timeout");
  }
  function stopVerifyPoll() {
    verifyAbort.current.aborted = true;
    setVerifyState("idle");
  }

  // Generated CLI command.
  const cliCmd = useMemo(() => {
    const ownersArg = validOwners.length > 0 ? validOwners.join(",") : "OWNER1,OWNER2";
    const parts = [
      "zebvix-node multisig-create",
      `--signer-key ${signerKeyPath}`,
      `--owners ${ownersArg}`,
      `--threshold ${threshold}`,
      `--salt ${salt.toString()}`,
    ];
    if (rpcUrl.trim()) parts.push(`--rpc-url ${rpcUrl.trim()}`);
    if (feeOverride.trim()) parts.push(`--fee ${feeOverride.trim()}`);
    return parts.join(" \\\n  ");
  }, [validOwners, signerKeyPath, threshold, salt, rpcUrl, feeOverride]);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1200);
    } catch {/* ignore */}
  }

  function manualBookmarkDerived() {
    if (!derived) return;
    addToWatchlist(`${threshold}-of-${owners.length} multisig`, derived);
    setCopied("watchlist");
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="p-5 space-y-5">
      {/* INTRO */}
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-sky-500/5 border border-sky-500/20 rounded-md p-3">
        <Info className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
        <div>
          Configure owners + threshold + salt below — the predicted address updates live.
          Copy the generated CLI command, run it on the host with your signer keyfile, then click{" "}
          <span className="text-foreground font-semibold">"verify on-chain"</span> to auto-bookmark
          the wallet with full metadata once it lands in a block.
        </div>
      </div>

      {/* CREATOR — vault picker + manual */}
      <Section icon={Key} title="1. Creator (signer of the create tx)">
        {/* Vault picker */}
        <VaultPicker
          state={vault}
          selected={creatorSource === "vault" ? creator.toLowerCase() : null}
          onPick={pickVaultCreator}
          onClear={clearCreator}
        />
        <input
          value={creator}
          onChange={(e) => { setCreator(e.target.value); setCreatorSource("manual"); }}
          placeholder="0x… (the address derived from --signer-key)"
          className={`w-full px-3 py-2 rounded-md bg-background border font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary ${
            creator && !creatorOk ? "border-rose-500/60" : "border-border"
          }`}
        />
        <Hint>
          The creator's address goes into the keccak hash → changing it changes the multisig address.
          Same {`(owners, threshold, salt)`} from a different creator → different address.
        </Hint>
      </Section>

      {/* OWNERS */}
      <Section
        icon={Users}
        title={`2. Owners (${owners.length}/10)`}
        action={
          <div className="flex items-center gap-1">
            {creatorOk && !creatorInOwners && owners.length < 10 && (
              <button
                onClick={addCreatorAsOwner}
                className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 flex items-center gap-1"
                title="Insert the creator address into the owner list"
              >
                <Plus className="h-3 w-3" /> Add Creator
              </button>
            )}
            <button
              onClick={addOwner}
              disabled={owners.length >= 10}
              className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Add Owner
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          {owners.map((o, i) => {
            const st = ownerStatus[i];
            const isCreator = creatorOk && o.trim().toLowerCase() === creator.toLowerCase();
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground w-6 tabular-nums">#{i + 1}</span>
                <input
                  value={o}
                  onChange={(e) => setOwner(i, e.target.value)}
                  placeholder={`0x… owner ${i + 1}`}
                  className={`flex-1 px-2.5 py-1.5 rounded-md bg-background border font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-primary ${
                    o && !st.ok ? "border-rose-500/60" : "border-border"
                  }`}
                />
                {isCreator && (
                  <span
                    className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"
                    title="this owner is also the creator"
                  >
                    <Crown className="h-2.5 w-2.5" /> creator
                  </span>
                )}
                <OwnerBadge status={st} />
                <button
                  onClick={() => removeOwner(i)}
                  disabled={owners.length <= 2}
                  className="h-7 w-7 rounded hover:bg-muted/60 text-muted-foreground hover:text-rose-400 disabled:opacity-30 flex items-center justify-center"
                  title={owners.length <= 2 ? "minimum 2 owners" : "remove"}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        {!ownerCountOk && (
          <Warn>Owner count must be 2–10 (MIN_OWNERS / MAX_OWNERS).</Warn>
        )}
        {validOwners.length >= 2 && allOwnersValid && (
          <div className="text-[10px] text-muted-foreground font-mono mt-2">
            sort+dedup preview: {sortOwners(validOwners).map((o) => shortAddr(o, 6, 4)).join(" · ")}
          </div>
        )}
      </Section>

      {/* THRESHOLD + SALT */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Section icon={Hash} title={`3. Threshold (${threshold} of ${owners.length})`}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={owners.length}
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value))}
              className="flex-1 accent-primary"
            />
            <input
              type="number"
              min={1}
              max={owners.length}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(1, Math.min(owners.length, parseInt(e.target.value) || 1)))}
              className="w-16 px-2 py-1 rounded-md bg-background border border-border font-mono text-xs text-center"
            />
          </div>
          <Hint>
            {threshold === 1 && "⚠ 1-of-N is effectively a single-owner wallet — any owner can move funds alone."}
            {threshold === owners.length && threshold > 1 && "Strict unanimous: ALL owners must approve."}
            {threshold > 1 && threshold < owners.length && `Quorum: any ${threshold} of ${owners.length} owners.`}
          </Hint>
        </Section>

        <Section
          icon={Shuffle}
          title="4. Salt (u64, randomizes address)"
          action={
            <button
              onClick={() => setSalt(randomSalt())}
              className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1"
            >
              <Shuffle className="h-3 w-3" /> Random
            </button>
          }
        >
          <input
            type="text"
            value={salt.toString()}
            onChange={(e) => {
              try {
                const v = BigInt(e.target.value || "0");
                if (v >= 0n && v < 2n ** 64n) setSalt(v);
              } catch {/* ignore non-numeric */}
            }}
            className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border font-mono text-xs"
          />
          <Hint>
            Lets the same {"(owners, threshold, creator)"} produce multiple distinct multisig addresses (e.g. "treasury", "ops", "grants").
          </Hint>
        </Section>
      </div>

      {/* CLI EXTRAS */}
      <details className="group">
        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
          Advanced — signer key path / RPC URL / fee override
        </summary>
        <div className="mt-3 grid sm:grid-cols-3 gap-3">
          <LabelInput
            label="--signer-key"
            value={signerKeyPath}
            onChange={setSignerKeyPath}
            placeholder="/root/.zebvix/founder.json"
          />
          <LabelInput
            label="--rpc-url (optional)"
            value={rpcUrl}
            onChange={setRpcUrl}
            placeholder="http://127.0.0.1:8545"
          />
          <LabelInput
            label="--fee (ZBX, optional)"
            value={feeOverride}
            onChange={setFeeOverride}
            placeholder="auto-resolve"
          />
        </div>
      </details>

      {/* DERIVED ADDRESS PREVIEW */}
      <div className={`rounded-lg border-2 p-4 ${
        derived ? "border-emerald-500/40 bg-emerald-500/5" : "border-dashed border-border bg-muted/10"
      }`}>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className={`h-4 w-4 ${derived ? "text-emerald-400" : "text-muted-foreground"}`} />
          <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
            Predicted Multisig Address (live)
          </span>
        </div>
        {derived ? (
          <>
            <div className="flex items-center gap-2">
              <code className="text-base font-mono text-emerald-300 break-all flex-1">{derived}</code>
              <button
                onClick={() => copy(derived, "addr")}
                className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 text-[10px] font-semibold uppercase flex items-center gap-1"
              >
                {copied === "addr" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied === "addr" ? "copied" : "copy"}
              </button>
            </div>
            <div className="text-[10px] text-muted-foreground mt-2 font-mono">
              keccak256("ZBX_MULTISIG_v1" || sorted_owners[{validOwners.length}] || [{threshold}] || salt_LE(8B) || creator)[12..32]
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <button
                onClick={checkExists}
                disabled={existsCheck === "checking"}
                className="text-[10px] px-2.5 py-1 rounded bg-background border border-border hover:bg-muted/40 flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${existsCheck === "checking" ? "animate-spin" : ""}`} />
                {existsCheck === "checking" ? "checking…" : "check on-chain"}
              </button>
              <button
                onClick={manualBookmarkDerived}
                className="text-[10px] px-2.5 py-1 rounded bg-background border border-border hover:bg-muted/40 flex items-center gap-1"
              >
                <BookmarkPlus className="h-3 w-3" />
                {copied === "watchlist" ? "added!" : "add to watchlist"}
              </button>
              {existsCheck === "free" && (
                <span className="text-[10px] px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <Check className="h-3 w-3" /> address is free — safe to create
                </span>
              )}
              {existsCheck === "taken" && (
                <span className="text-[10px] px-2 py-1 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> already exists — pick a new salt
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground italic">
            Fill in creator + ≥2 valid owners + threshold above to preview the address.
          </div>
        )}
      </div>

      {/* CLI COMMAND */}
      {formOk && (
        <Section icon={Terminal} title="5. Generated CLI command">
          <pre className="text-[11px] font-mono bg-muted/30 p-3 rounded-md overflow-x-auto leading-relaxed text-foreground">
{cliCmd}
          </pre>
          <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
            <span className="text-[10px] text-muted-foreground">
              Run on the host that owns the signer keyfile. Creator address must match the pubkey derived from that key.
            </span>
            <button
              onClick={() => copy(cliCmd.replace(/ \\\n  /g, " "), "cli")}
              className="text-[10px] px-2.5 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1 font-semibold uppercase tracking-wider"
            >
              {copied === "cli" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied === "cli" ? "copied" : "copy command"}
            </button>
          </div>
        </Section>
      )}

      {/* POST-SUBMIT VERIFY */}
      {formOk && derived && (
        <Section icon={ShieldCheck} title="6. Verify on-chain (after running the CLI)">
          <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
            <div className="text-[11px] text-muted-foreground">
              After you run <code className="font-mono bg-muted/40 px-1 rounded">multisig-create</code> on the host,
              click below — we'll poll the chain for up to 90 seconds and auto-bookmark the wallet with
              full metadata once it appears.
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {verifyState === "idle" && (
                <button
                  onClick={startVerifyPoll}
                  className="text-[11px] px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 font-semibold uppercase tracking-wider flex items-center gap-1.5"
                >
                  <Search className="h-3 w-3" /> Verify on-chain
                </button>
              )}
              {verifyState === "polling" && (
                <>
                  <span className="text-[11px] px-3 py-1.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 font-semibold flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> Polling chain… attempt {verifyAttempts}/23
                  </span>
                  <button
                    onClick={stopVerifyPoll}
                    className="text-[10px] px-2 py-1 rounded bg-background border border-border hover:bg-muted/40"
                  >
                    Cancel
                  </button>
                </>
              )}
              {verifyState === "confirmed" && (
                <>
                  <span className="text-[11px] px-3 py-1.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1.5">
                    <Check className="h-3 w-3" /> Confirmed + bookmarked
                  </span>
                  <button
                    onClick={() => onInspect(derived)}
                    className="text-[11px] px-3 py-1.5 rounded bg-primary/10 text-primary hover:bg-primary/20 font-semibold uppercase tracking-wider flex items-center gap-1.5"
                  >
                    <Eye className="h-3 w-3" /> Inspect now
                  </button>
                </>
              )}
              {verifyState === "timeout" && (
                <>
                  <span className="text-[11px] px-3 py-1.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" /> Not seen yet — keep waiting and retry
                  </span>
                  <button
                    onClick={startVerifyPoll}
                    className="text-[10px] px-2 py-1 rounded bg-background border border-border hover:bg-muted/40 flex items-center gap-1"
                  >
                    <RefreshCw className="h-3 w-3" /> Retry
                  </button>
                </>
              )}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────── VAULT PICKER ─ */

function VaultPicker({ state, selected, onPick, onClear }: {
  state: VaultState;
  selected: string | null;
  onPick: (addr: string) => void;
  onClear: () => void;
}) {
  if (state.status === "empty") {
    return (
      <div className="text-[11px] text-muted-foreground bg-muted/20 border border-border rounded-md p-2.5 flex items-start gap-2 mb-2">
        <Wallet className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          No wallets in your vault yet. Set one up at{" "}
          <a href="/wallet" className="text-primary hover:underline font-semibold">/wallet</a>{" "}
          to auto-fill the creator address — or paste it manually below.
        </div>
      </div>
    );
  }
  if (state.status === "locked") {
    return (
      <div className="text-[11px] text-muted-foreground bg-amber-500/5 border border-amber-500/20 rounded-md p-2.5 flex items-start gap-2 mb-2">
        <Wallet className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          Your wallet vault is locked. Unlock it at{" "}
          <a href="/wallet" className="text-primary hover:underline font-semibold">/wallet</a>{" "}
          to auto-fill the creator — or paste an address manually below.
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="text-[11px] text-rose-300 bg-rose-500/5 border border-rose-500/20 rounded-md p-2.5 flex items-start gap-2 mb-2">
        <AlertCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
        <div>Vault read failed: <code className="font-mono">{state.error}</code></div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-muted/10 p-2.5 mb-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Wallet className="h-3 w-3" /> Pick from vault ({state.wallets.length})
        </div>
        {selected && (
          <button
            onClick={onClear}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {state.wallets.map((w) => {
          const isSel = selected === w.address.toLowerCase();
          return (
            <button
              key={w.address}
              onClick={() => onPick(w.address)}
              className={`text-[10px] px-2 py-1 rounded border flex items-center gap-1 transition-colors ${
                isSel
                  ? "bg-primary/15 text-primary border-primary/40"
                  : "bg-background border-border text-foreground hover:bg-muted/40"
              }`}
              title={w.address}
            >
              {isSel && <Check className="h-2.5 w-2.5" />}
              <span className="font-semibold">{w.label || "Wallet"}</span>
              <span className="font-mono text-muted-foreground">{shortAddr(w.address, 4, 4)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────── IMPORT PANEL ─ */

type ImportMode = "single" | "bulk" | "json";

interface BulkResult {
  raw: string;
  address: string;
  valid: boolean;
  status: "pending" | "checking" | "found" | "missing" | "duplicate" | "error";
  metadata?: MultisigMetadata;
  error?: string;
  selected: boolean;
  label: string;
}

function ImportPanel({ onInspect }: { onInspect: (addr: string) => void }) {
  const vault = useVaultWallets();
  const vaultAddrs = useMemo(
    () => new Set(vault.wallets.map((w) => w.address.toLowerCase())),
    [vault.wallets],
  );

  const [mode, setMode] = useState<ImportMode>("single");

  /* SINGLE-ADDRESS STATE */
  const [singleAddr, setSingleAddr] = useState("");
  const [singleLabel, setSingleLabel] = useState("");
  const [singleNote, setSingleNote] = useState("");
  const [singleState, setSingleState] = useState<"idle" | "checking" | "found" | "missing" | "error" | "saved">("idle");
  const [singleMeta, setSingleMeta] = useState<MultisigMetadata | null>(null);
  const [singleErr, setSingleErr] = useState<string | null>(null);

  /* BULK STATE */
  const [bulkRaw, setBulkRaw] = useState("");
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSavedCount, setBulkSavedCount] = useState(0);

  /* JSON STATE */
  const [jsonText, setJsonText] = useState("");
  const [jsonMode, setJsonMode] = useState<"merge" | "replace">("merge");
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [jsonImportedCount, setJsonImportedCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const singleAddrValid = singleAddr.trim() === "" || isValidAddress(singleAddr);

  async function verifySingle() {
    if (!isValidAddress(singleAddr)) return;
    setSingleState("checking");
    setSingleErr(null);
    setSingleMeta(null);
    try {
      const meta = await fetchMultisigInfo(singleAddr);
      if (meta) {
        setSingleMeta(meta);
        setSingleState("found");
        // Auto-suggest a label if user hasn't typed one.
        if (!singleLabel.trim()) {
          setSingleLabel(`${meta.threshold}-of-${meta.owners.length} multisig`);
        }
      } else {
        setSingleState("missing");
      }
    } catch (e) {
      setSingleState("error");
      setSingleErr(e instanceof Error ? e.message : String(e));
    }
  }

  function saveSingle() {
    if (singleState !== "found" || !singleMeta) return;
    addToWatchlist(
      singleLabel.trim() || `${singleMeta.threshold}-of-${singleMeta.owners.length} multisig`,
      singleAddr,
      singleMeta,
      singleNote.trim() || undefined,
    );
    setSingleState("saved");
    setTimeout(() => {
      // Reset for the next import.
      setSingleAddr("");
      setSingleLabel("");
      setSingleNote("");
      setSingleMeta(null);
      setSingleState("idle");
    }, 1400);
  }

  async function verifyBulk() {
    const parsed = parseAddressList(bulkRaw);
    const existing = new Set(loadWatchlist().map((e) => normalizeAddress(e.address)));
    const seeded: BulkResult[] = parsed.map((p) => ({
      raw: p.raw,
      address: p.valid ? p.address : p.raw,
      valid: p.valid,
      status: !p.valid
        ? "error"
        : existing.has(p.address)
          ? "duplicate"
          : "pending",
      error: !p.valid ? "invalid format" : undefined,
      selected: p.valid && !existing.has(p.address),
      label: "",
    }));
    setBulkResults(seeded);
    setBulkBusy(true);
    setBulkSavedCount(0);
    // Sequential to avoid hammering the RPC; chain handles it fast either way.
    for (let i = 0; i < seeded.length; i++) {
      const r = seeded[i];
      if (r.status !== "pending") continue;
      setBulkResults((prev) => prev.map((x, j) => (j === i ? { ...x, status: "checking" } : x)));
      try {
        const meta = await fetchMultisigInfo(r.address);
        setBulkResults((prev) =>
          prev.map((x, j) =>
            j === i
              ? meta
                ? {
                    ...x,
                    status: "found",
                    metadata: meta,
                    label: x.label || `${meta.threshold}-of-${meta.owners.length} multisig`,
                  }
                : { ...x, status: "missing", selected: false }
              : x,
          ),
        );
      } catch (e) {
        setBulkResults((prev) =>
          prev.map((x, j) =>
            j === i
              ? { ...x, status: "error", error: e instanceof Error ? e.message : String(e), selected: false }
              : x,
          ),
        );
      }
    }
    setBulkBusy(false);
  }

  function toggleBulkRow(i: number) {
    setBulkResults((prev) =>
      prev.map((r, j) =>
        j === i && r.status === "found" ? { ...r, selected: !r.selected } : r,
      ),
    );
  }

  function setBulkLabel(i: number, label: string) {
    setBulkResults((prev) => prev.map((r, j) => (j === i ? { ...r, label } : r)));
  }

  function saveBulk() {
    let saved = 0;
    for (const r of bulkResults) {
      if (r.selected && r.status === "found" && r.metadata) {
        addToWatchlist(r.label.trim() || "(imported)", r.address, r.metadata);
        saved++;
      }
    }
    setBulkSavedCount(saved);
    setTimeout(() => {
      setBulkRaw("");
      setBulkResults([]);
      setBulkSavedCount(0);
    }, 1500);
  }

  function doJsonImport() {
    setJsonErr(null);
    setJsonImportedCount(null);
    try {
      const next = importWatchlistJson(jsonText, jsonMode);
      setJsonImportedCount(next.length);
      setTimeout(() => {
        setJsonText("");
        setJsonImportedCount(null);
      }, 1800);
    } catch (e) {
      setJsonErr(e instanceof Error ? e.message : String(e));
    }
  }

  function handleJsonFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setJsonText(text);
    };
    reader.onerror = () => setJsonErr("failed to read file");
    reader.readAsText(file);
  }

  return (
    <div className="p-5 space-y-4">
      {/* INTRO */}
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-violet-500/5 border border-violet-500/20 rounded-md p-3">
        <Info className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
        <div>
          Import existing multisig wallets that were created via the CLI on another host.
          The dashboard fetches each wallet's owners + threshold + balance from chain
          before saving so your watchlist always carries verified metadata.
        </div>
      </div>

      {/* MODE SWITCHER */}
      <div className="flex gap-1 p-1 rounded-md bg-muted/20 border border-border">
        <ModeBtn active={mode === "single"} onClick={() => setMode("single")} icon={Key} label="Single" />
        <ModeBtn active={mode === "bulk"} onClick={() => setMode("bulk")} icon={Users} label="Bulk paste" />
        <ModeBtn active={mode === "json"} onClick={() => setMode("json")} icon={FileJson} label="JSON file" />
      </div>

      {/* SINGLE */}
      {mode === "single" && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Multisig address
            </label>
            <div className="flex gap-2 mt-1">
              <input
                value={singleAddr}
                onChange={(e) => {
                  setSingleAddr(e.target.value);
                  setSingleState("idle");
                  setSingleMeta(null);
                  setSingleErr(null);
                }}
                placeholder="0x… (multisig wallet)"
                onKeyDown={(e) => e.key === "Enter" && singleAddrValid && singleAddr && verifySingle()}
                className={`flex-1 px-3 py-2 rounded-md bg-background border font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary ${
                  !singleAddrValid ? "border-rose-500/60" : "border-border"
                }`}
              />
              <button
                onClick={verifySingle}
                disabled={!singleAddrValid || !singleAddr || singleState === "checking"}
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 flex items-center gap-1.5"
              >
                {singleState === "checking" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                {singleState === "checking" ? "Verifying…" : "Verify"}
              </button>
            </div>
            {!singleAddrValid && <Warn>Address must be 0x-prefix + 40 hex chars (20 bytes).</Warn>}
          </div>

          {/* PREVIEW */}
          {singleState === "missing" && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-[11px] text-rose-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                Address not found on chain. Either the multisig hasn't been created yet,
                or this is a regular EOA address — verify with the host that created it.
              </div>
            </div>
          )}
          {singleState === "error" && singleErr && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-[11px] text-rose-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>Verification failed: <code className="font-mono break-all">{singleErr}</code></div>
            </div>
          )}
          {singleState === "found" && singleMeta && (
            <MultisigPreviewCard meta={singleMeta} address={singleAddr} vaultAddrs={vaultAddrs} />
          )}
          {singleState === "saved" && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-[11px] text-emerald-300 flex items-center gap-2">
              <Check className="h-4 w-4" /> Added to watchlist
            </div>
          )}

          {singleState === "found" && singleMeta && (
            <div className="space-y-2">
              <div className="grid sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Label</label>
                  <input
                    value={singleLabel}
                    onChange={(e) => setSingleLabel(e.target.value)}
                    placeholder="Treasury / Ops / Grants…"
                    className="mt-1 w-full px-2.5 py-2 rounded-md bg-background border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Note (optional)</label>
                  <input
                    value={singleNote}
                    onChange={(e) => setSingleNote(e.target.value)}
                    placeholder="e.g. team-controlled, 4-of-7 quorum"
                    className="mt-1 w-full px-2.5 py-2 rounded-md bg-background border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={saveSingle}
                  className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 flex items-center gap-1.5"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" /> Save to watchlist
                </button>
                <button
                  onClick={() => onInspect(singleAddr)}
                  className="px-3 py-2 rounded-md bg-background border border-border hover:bg-muted/40 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Eye className="h-3.5 w-3.5" /> Inspect now
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BULK */}
      {mode === "bulk" && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Paste addresses (one per line, comma or whitespace separated)
            </label>
            <textarea
              value={bulkRaw}
              onChange={(e) => setBulkRaw(e.target.value)}
              placeholder={"0xabc...\n0xdef...\n0x123..."}
              rows={6}
              className="mt-1 w-full px-2.5 py-2 rounded-md bg-background border border-border font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={verifyBulk}
              disabled={!bulkRaw.trim() || bulkBusy}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 flex items-center gap-1.5"
            >
              {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {bulkBusy ? "Verifying…" : "Verify all"}
            </button>
            {bulkResults.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {bulkResults.filter((r) => r.status === "found").length} found ·{" "}
                {bulkResults.filter((r) => r.status === "missing").length} missing ·{" "}
                {bulkResults.filter((r) => r.status === "duplicate").length} already saved ·{" "}
                {bulkResults.filter((r) => r.status === "error").length} invalid
              </span>
            )}
          </div>

          {/* RESULTS TABLE */}
          {bulkResults.length > 0 && (
            <div className="rounded-md border border-border bg-card overflow-hidden">
              <div className="max-h-72 overflow-auto divide-y divide-border">
                {bulkResults.map((r, i) => (
                  <BulkRow
                    key={`${r.raw}-${i}`}
                    row={r}
                    vaultAddrs={vaultAddrs}
                    onToggle={() => toggleBulkRow(i)}
                    onLabel={(v) => setBulkLabel(i, v)}
                  />
                ))}
              </div>
              <div className="border-t border-border p-2.5 flex items-center justify-between bg-muted/20">
                <span className="text-[10px] text-muted-foreground">
                  {bulkResults.filter((r) => r.selected).length} selected for import
                </span>
                <button
                  onClick={saveBulk}
                  disabled={bulkResults.filter((r) => r.selected).length === 0}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 flex items-center gap-1.5"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" /> Save selected
                </button>
              </div>
            </div>
          )}
          {bulkSavedCount > 0 && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-[11px] text-emerald-300 flex items-center gap-2">
              <Check className="h-4 w-4" /> Saved {bulkSavedCount} multisig{bulkSavedCount === 1 ? "" : "s"} to watchlist
            </div>
          )}
        </div>
      )}

      {/* JSON */}
      {mode === "json" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-[11px] px-2.5 py-1.5 rounded bg-background border border-border hover:bg-muted/40 flex items-center gap-1.5"
            >
              <Upload className="h-3 w-3" /> Choose JSON file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleJsonFile(e.target.files[0])}
            />
            <span className="text-[10px] text-muted-foreground">or paste below</span>
          </div>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder='[{"label":"Treasury","address":"0x…","added_at":1714000000000}, …]'
            rows={6}
            className="w-full px-2.5 py-2 rounded-md bg-background border border-border font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 text-[10px]">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" checked={jsonMode === "merge"} onChange={() => setJsonMode("merge")} className="accent-primary" />
                merge (skip duplicates)
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" checked={jsonMode === "replace"} onChange={() => setJsonMode("replace")} className="accent-primary" />
                replace all
              </label>
            </div>
            <button
              onClick={doJsonImport}
              disabled={!jsonText.trim()}
              className="text-[11px] px-2.5 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 font-semibold flex items-center gap-1.5"
            >
              <Upload className="h-3 w-3" /> Import
            </button>
          </div>
          {jsonErr && <Warn>{jsonErr}</Warn>}
          {jsonImportedCount !== null && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-[11px] text-emerald-300 flex items-center gap-2">
              <Check className="h-4 w-4" /> Watchlist now has {jsonImportedCount} entr{jsonImportedCount === 1 ? "y" : "ies"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModeBtn({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2 rounded text-[11px] font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40"
      }`}
    >
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
}

function MultisigPreviewCard({ meta, address, vaultAddrs }: {
  meta: MultisigMetadata;
  address: string;
  vaultAddrs: Set<string>;
}) {
  const ownedIdx = meta.owners.findIndex((o) => vaultAddrs.has(o.toLowerCase()));
  return (
    <div className="rounded-lg border-2 border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span className="text-[10px] uppercase tracking-widest font-bold text-emerald-300">
            Verified on chain
          </span>
        </div>
        {ownedIdx >= 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1">
            <Crown className="h-2.5 w-2.5" /> you are owner #{ownedIdx + 1}
          </span>
        )}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Address</div>
        <code className="text-xs font-mono text-foreground break-all">{normalizeAddress(address)}</code>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-emerald-500/20">
        <KV label="Threshold" val={`${meta.threshold} of ${meta.owners.length}`} />
        <KV label="Balance" val={`${meta.balanceZbx} ZBX`} accent />
        <KV label="Created at" val={`#${meta.createdHeight.toLocaleString()}`} />
        <KV label="Next prop id" val={`#${meta.proposalSeq}`} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Owners ({meta.owners.length})
        </div>
        <ul className="space-y-1">
          {meta.owners.map((o, i) => {
            const isMine = vaultAddrs.has(o.toLowerCase());
            return (
              <li key={o} className="flex items-center gap-2 text-[11px] font-mono">
                <span className="text-muted-foreground tabular-nums w-5">#{i + 1}</span>
                <span className="flex-1 break-all">{o}</span>
                {isMine && (
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <Crown className="h-2.5 w-2.5" /> mine
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function BulkRow({ row, vaultAddrs, onToggle, onLabel }: {
  row: BulkResult;
  vaultAddrs: Set<string>;
  onToggle: () => void;
  onLabel: (v: string) => void;
}) {
  const isOwner =
    row.metadata?.owners.some((o) => vaultAddrs.has(o.toLowerCase())) ?? false;
  return (
    <div className="p-2.5 flex items-center gap-2 hover:bg-muted/10">
      <input
        type="checkbox"
        disabled={row.status !== "found"}
        checked={row.selected}
        onChange={onToggle}
        className="accent-primary disabled:opacity-30"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="font-mono text-[11px] break-all">{row.address}</code>
          <BulkStatusBadge status={row.status} error={row.error} />
          {isOwner && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
              <Crown className="h-2.5 w-2.5" /> mine
            </span>
          )}
          {row.metadata && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {row.metadata.threshold}-of-{row.metadata.owners.length} · {row.metadata.balanceZbx} ZBX
            </span>
          )}
        </div>
        {row.status === "found" && (
          <input
            value={row.label}
            onChange={(e) => onLabel(e.target.value)}
            placeholder="Label"
            className="mt-1 w-full max-w-xs px-2 py-1 rounded bg-background border border-border text-[11px] focus:outline-none focus:ring-2 focus:ring-primary"
          />
        )}
      </div>
    </div>
  );
}

function BulkStatusBadge({ status, error }: { status: BulkResult["status"]; error?: string }) {
  const map: Record<BulkResult["status"], { cls: string; label: string }> = {
    pending:   { cls: "bg-muted/40 text-muted-foreground border-border", label: "queued" },
    checking:  { cls: "bg-sky-500/15 text-sky-300 border-sky-500/30", label: "checking…" },
    found:     { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", label: "found" },
    missing:   { cls: "bg-rose-500/15 text-rose-300 border-rose-500/30", label: "not on chain" },
    duplicate: { cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: "already saved" },
    error:     { cls: "bg-rose-500/15 text-rose-300 border-rose-500/30", label: error || "error" },
  };
  const m = map[status];
  return (
    <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${m.cls}`}>
      {m.label}
    </span>
  );
}

/* ──────────────────────────────────────────── WATCHLIST PANEL ─ */

type Filter = "all" | "owned" | "withBalance";
type Sort = "added" | "balance" | "label";

const STALE_MS = 5 * 60 * 1000; // 5 minutes

function WatchlistPanel({ onInspect }: { onInspect: (addr: string) => void }) {
  const vault = useVaultWallets();
  const vaultAddrs = useMemo(
    () => new Set(vault.wallets.map((w) => w.address.toLowerCase())),
    [vault.wallets],
  );

  const [list, setList] = useState<WatchlistEntry[]>(() => loadWatchlist());
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("added");
  const [sortDesc, setSortDesc] = useState(true);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  // Auto-refresh stale entries on mount.
  useEffect(() => {
    const stale = list.filter(
      (e) => !e.metadata || Date.now() - e.metadata.checkedAt > STALE_MS,
    );
    if (stale.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const e of stale) {
        if (cancelled) return;
        await refreshOne(e.address, /*silent*/ true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshOne(addr: string, _silent = false) {
    setRefreshing((prev) => {
      const next = new Set(prev);
      next.add(addr);
      return next;
    });
    try {
      const meta = await fetchMultisigInfo(addr);
      if (meta) {
        const next = updateWatchlistMetadata(addr, meta);
        setList(next);
      } else {
        // Stamp checkedAt so we don't re-poll missing entries every render.
        const stamped: MultisigMetadata = {
          owners: [],
          threshold: 0,
          balanceWei: "0x0",
          balanceZbx: "0",
          createdHeight: 0,
          proposalSeq: 0,
          checkedAt: Date.now(),
        };
        const next = updateWatchlistMetadata(addr, stamped);
        setList(next);
      }
    } catch {
      // Network error — leave metadata untouched.
    } finally {
      setRefreshing((prev) => {
        const next = new Set(prev);
        next.delete(addr);
        return next;
      });
    }
  }

  function refreshAll() {
    list.forEach((e) => refreshOne(e.address, true));
  }

  function remove(addr: string) {
    setList(removeFromWatchlist(addr));
  }

  function startEdit(addr: string, label: string) {
    setEditing(addr);
    setEditLabel(label);
  }
  function commitEdit() {
    if (editing) {
      const next = renameWatchlistEntry(editing, editLabel);
      setList(next);
    }
    setEditing(null);
    setEditLabel("");
  }

  function downloadJson() {
    const blob = new Blob([exportWatchlistJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zebvix-multisig-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // Filter + sort.
  const visible = useMemo(() => {
    let v = list.slice();
    if (filter === "owned") {
      v = v.filter((e) => e.metadata?.owners.some((o) => vaultAddrs.has(o.toLowerCase())));
    } else if (filter === "withBalance") {
      v = v.filter((e) => e.metadata && BigInt(e.metadata.balanceWei || "0x0") > 0n);
    }
    v.sort((a, b) => {
      if (sort === "label") {
        const cmp = a.label.localeCompare(b.label);
        return sortDesc ? -cmp : cmp;
      }
      if (sort === "balance") {
        const ab = a.metadata ? BigInt(a.metadata.balanceWei || "0x0") : 0n;
        const bb = b.metadata ? BigInt(b.metadata.balanceWei || "0x0") : 0n;
        const cmp = ab < bb ? -1 : ab > bb ? 1 : 0;
        return sortDesc ? -cmp : cmp;
      }
      // added_at
      const cmp = a.added_at - b.added_at;
      return sortDesc ? -cmp : cmp;
    });
    return v;
  }, [list, filter, sort, sortDesc, vaultAddrs]);

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-violet-500/5 border border-violet-500/20 rounded-md p-3">
        <Info className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
        <div>
          Bookmarked multisig wallets with cached on-chain metadata. Saved locally
          in your browser (<code className="font-mono bg-muted/40 px-1 rounded">localStorage</code>) —
          nothing leaves the device. Use the <span className="text-foreground font-semibold">Import</span> tab
          to add new ones, or <span className="text-foreground font-semibold">Export</span> to share between machines.
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[11px] text-muted-foreground">
            {list.length} bookmark{list.length === 1 ? "" : "s"}
            {visible.length !== list.length && ` · ${visible.length} shown`}
          </div>
          <FilterPicker value={filter} onChange={setFilter} />
          <SortPicker value={sort} desc={sortDesc} onChange={setSort} onToggleDir={() => setSortDesc((v) => !v)} />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={refreshAll}
            disabled={list.length === 0}
            className="text-[10px] px-2 py-1 rounded bg-background border border-border hover:bg-muted/40 disabled:opacity-40 flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Refresh all
          </button>
          <button
            onClick={downloadJson}
            disabled={list.length === 0}
            className="text-[10px] px-2 py-1 rounded bg-background border border-border hover:bg-muted/40 disabled:opacity-40 flex items-center gap-1"
          >
            <Download className="h-3 w-3" /> Export
          </button>
        </div>
      </div>

      {/* LIST */}
      {visible.length === 0 ? (
        <div className="text-center text-xs text-muted-foreground py-10 rounded-lg border border-dashed border-border">
          {list.length === 0 ? (
            <>No bookmarks yet. Use the <span className="text-foreground font-semibold">Import</span> tab
            to add a multisig, or <span className="text-foreground font-semibold">Create</span> a new one.</>
          ) : (
            <>No bookmarks match the current filter.</>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card overflow-hidden">
          {visible.map((e) => {
            const isRefreshing = refreshing.has(e.address);
            const m = e.metadata;
            const ownedIdx = m?.owners.findIndex((o) => vaultAddrs.has(o.toLowerCase())) ?? -1;
            const stale = m && Date.now() - m.checkedAt > STALE_MS;
            const missing = m && m.owners.length === 0 && m.threshold === 0;
            const isEditing = editing === e.address;
            return (
              <li key={e.address} className="p-3 hover:bg-muted/10 transition-colors">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isEditing ? (
                        <>
                          <input
                            value={editLabel}
                            onChange={(ev) => setEditLabel(ev.target.value)}
                            onKeyDown={(ev) => ev.key === "Enter" && commitEdit()}
                            className="px-2 py-1 rounded bg-background border border-border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                            autoFocus
                          />
                          <button
                            onClick={commitEdit}
                            className="text-[10px] px-2 py-1 rounded bg-primary text-primary-foreground font-semibold"
                          >
                            Save
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-semibold text-foreground">{e.label}</span>
                          <button
                            onClick={() => startEdit(e.address, e.label)}
                            className="h-5 w-5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground flex items-center justify-center"
                            title="rename"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </>
                      )}
                      {ownedIdx >= 0 && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                          <Crown className="h-2.5 w-2.5" /> owner #{ownedIdx + 1}
                        </span>
                      )}
                      {missing && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                          <AlertCircle className="h-2.5 w-2.5" /> not on chain
                        </span>
                      )}
                    </div>
                    <code className="text-[11px] font-mono text-muted-foreground break-all">{e.address}</code>
                    {e.note && (
                      <div className="text-[10px] text-muted-foreground italic mt-0.5">— {e.note}</div>
                    )}
                    {m && !missing && (
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[10px]">
                        <Badge>
                          <FileSignature className="h-2.5 w-2.5" />
                          {m.threshold}-of-{m.owners.length}
                        </Badge>
                        <Badge accent>
                          <Wallet className="h-2.5 w-2.5" />
                          {m.balanceZbx} ZBX
                        </Badge>
                        <Badge>
                          <Hash className="h-2.5 w-2.5" />
                          #{m.createdHeight.toLocaleString()}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground font-mono">
                          {stale ? "↻ stale" : "✓ fresh"} · {timeAgo(m.checkedAt)}
                        </span>
                      </div>
                    )}
                    {!m && (
                      <div className="text-[10px] text-muted-foreground mt-1 italic flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> loading metadata…
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => refreshOne(e.address)}
                      disabled={isRefreshing}
                      className="h-7 w-7 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center justify-center"
                      title="refresh"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                    </button>
                    <button
                      onClick={() => onInspect(e.address)}
                      className="text-[10px] px-2.5 py-1.5 rounded bg-primary/10 text-primary hover:bg-primary/20 font-semibold uppercase tracking-wider flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" /> Inspect
                    </button>
                    <button
                      onClick={() => remove(e.address)}
                      className="h-7 w-7 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 flex items-center justify-center"
                      title="remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FilterPicker({ value, onChange }: { value: Filter; onChange: (v: Filter) => void }) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-background overflow-hidden">
      <span className="px-1.5 text-muted-foreground"><Filter className="h-3 w-3" /></span>
      {(["all", "owned", "withBalance"] as Filter[]).map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={`text-[10px] px-2 py-1 transition-colors ${
            value === f ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-muted/40"
          }`}
        >
          {f === "all" ? "All" : f === "owned" ? "Owned by me" : "With balance"}
        </button>
      ))}
    </div>
  );
}

function SortPicker({ value, desc, onChange, onToggleDir }: {
  value: Sort; desc: boolean; onChange: (v: Sort) => void; onToggleDir: () => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-background overflow-hidden">
      <span className="px-1.5 text-muted-foreground text-[10px]">sort</span>
      {(["added", "balance", "label"] as Sort[]).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`text-[10px] px-2 py-1 transition-colors ${
            value === s ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-muted/40"
          }`}
        >
          {s === "added" ? "Added" : s === "balance" ? "Balance" : "Label"}
        </button>
      ))}
      <button
        onClick={onToggleDir}
        className="px-1.5 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/40"
        title={desc ? "descending" : "ascending"}
      >
        {desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
      </button>
    </div>
  );
}

function Badge({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono ${
      accent
        ? "bg-primary/10 text-primary border-primary/30"
        : "bg-muted/30 text-foreground border-border"
    }`}>
      {children}
    </span>
  );
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ──────────────────────────────────────────── tiny helpers ─ */

function Section({
  icon: Icon, title, action, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          <Icon className="h-3.5 w-3.5 text-primary" /> {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function OwnerBadge({ status }: { status: { ok: true } | { ok: false; reason: "empty" | "invalid" | "duplicate" } }) {
  if (status.ok) {
    return (
      <span className="h-6 w-6 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center" title="valid">
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (status.reason === "empty") return <span className="h-6 w-6" />;
  if (status.reason === "invalid") {
    return (
      <span
        className="h-6 w-6 rounded-full bg-rose-500/15 text-rose-400 flex items-center justify-center"
        title="not 0x + 40 hex chars"
      >
        <AlertCircle className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span
      className="h-6 w-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center"
      title="duplicate owner"
    >
      <AlertCircle className="h-3 w-3" />
    </span>
  );
}

function LabelInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border font-mono text-[11px]"
      />
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <div className="text-[10px] text-muted-foreground leading-relaxed">{children}</div>;
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] text-rose-300 flex items-center gap-1 mt-1">
      <AlertCircle className="h-3 w-3" /> {children}
    </div>
  );
}

function KV({ label, val, accent, hint }: {
  label: string; val: string; accent?: boolean; hint?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-mono font-semibold ${accent ? "text-primary" : "text-foreground"}`}>
        {val}
      </div>
      {hint && <div className="text-[9px] text-muted-foreground italic">{hint}</div>}
    </div>
  );
}
