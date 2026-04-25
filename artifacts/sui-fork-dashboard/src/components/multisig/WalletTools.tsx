import React, { useEffect, useMemo, useState } from "react";
import {
  Plus, X, Shuffle, Check, AlertCircle, Copy, Hash, Users, Key,
  Wand2, BookmarkPlus, Trash2, ChevronRight, Download, Upload,
  Eye, Sparkles, Terminal, RefreshCw, AlertTriangle, Info,
} from "lucide-react";
import {
  isValidAddress, normalizeAddress, sortOwners, deriveMultisigAddress,
  randomSalt, loadWatchlist, addToWatchlist, removeFromWatchlist,
  exportWatchlistJson, importWatchlistJson, type WatchlistEntry,
} from "@/lib/multisig-utils";
import { rpc, weiHexToZbx, shortAddr, ZbxRpcError } from "@/lib/zbx-rpc";

interface Props {
  onInspect: (addr: string) => void;
}

type Tab = "create" | "watchlist";

export default function WalletTools({ onInspect }: Props) {
  const [tab, setTab] = useState<Tab>("create");
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex border-b border-border">
        <TabBtn active={tab === "create"} onClick={() => setTab("create")} icon={Wand2}>
          Create New Multisig
        </TabBtn>
        <TabBtn active={tab === "watchlist"} onClick={() => setTab("watchlist")} icon={BookmarkPlus}>
          Import / Watchlist
        </TabBtn>
      </div>
      {tab === "create" ? <CreateWizard /> : <WatchlistPanel onInspect={onInspect} />}
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

/* ──────────────────────────────────────────── CREATE WIZARD ─ */

function CreateWizard() {
  const [creator, setCreator] = useState("");
  const [owners, setOwners] = useState<string[]>(["", ""]);
  const [threshold, setThreshold] = useState(2);
  const [salt, setSalt] = useState<bigint>(0n);
  const [signerKeyPath, setSignerKeyPath] = useState("/root/.zebvix/founder.json");
  const [feeOverride, setFeeOverride] = useState("");
  const [rpcUrl, setRpcUrl] = useState("");
  const [existsCheck, setExistsCheck] = useState<"unknown" | "checking" | "free" | "taken">("unknown");
  const [copied, setCopied] = useState<string | null>(null);

  // Initialize a random salt on mount.
  useEffect(() => { setSalt(randomSalt()); }, []);

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

  // Live derived address — only when form is valid.
  const derived = useMemo(() => {
    if (!formOk) return null;
    try {
      return deriveMultisigAddress(sortOwners(validOwners), threshold, salt, creator.toLowerCase());
    } catch {
      return null;
    }
  }, [formOk, validOwners, threshold, salt, creator]);

  // Reset existence check when derived address changes.
  useEffect(() => { setExistsCheck("unknown"); }, [derived]);

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

  async function checkExists() {
    if (!derived) return;
    setExistsCheck("checking");
    try {
      await rpc("zbx_getMultisig", [derived]);
      setExistsCheck("taken"); // any successful response means address resolves
    } catch (e) {
      // rpc.rs returns -32004 "multisig {addr} not found" → address is free for creation.
      if (e instanceof ZbxRpcError && e.code === -32004) setExistsCheck("free");
      else setExistsCheck("unknown");
    }
  }

  // Generated CLI command — owners joined comma-separated, salt as decimal u64.
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

  function addDerivedToWatchlist() {
    if (!derived) return;
    addToWatchlist(`M-of-N ${threshold}/${owners.length}`, derived);
    setCopied("watchlist");
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="p-5 space-y-5">
      {/* INTRO */}
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-sky-500/5 border border-sky-500/20 rounded-md p-3">
        <Info className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
        <div>
          This is a <span className="text-foreground font-semibold">deterministic-address planner</span>.
          The dashboard cannot sign transactions (no in-browser keystore for native Zebvix txs).
          Configure owners + threshold + salt below and the predicted address updates live —
          then copy the generated <code className="font-mono bg-muted/40 px-1 rounded">zebvix-node multisig-create</code> command and run it on the box that holds your signer keyfile.
        </div>
      </div>

      {/* CREATOR */}
      <Section icon={Key} title="1. Creator (signer of the create tx)">
        <input
          value={creator}
          onChange={(e) => setCreator(e.target.value)}
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
          <button
            onClick={addOwner}
            disabled={owners.length >= 10}
            className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Add Owner
          </button>
        }
      >
        <div className="space-y-2">
          {owners.map((o, i) => {
            const st = ownerStatus[i];
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
                onClick={addDerivedToWatchlist}
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
      <Section icon={Terminal} title="5. Generated CLI command" hideWhenIncomplete={!formOk}>
        <pre className="text-[11px] font-mono bg-muted/30 p-3 rounded-md overflow-x-auto leading-relaxed text-foreground">
{cliCmd}
        </pre>
        <div className="flex items-center justify-between mt-2">
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
    </div>
  );
}

/* ──────────────────────────────────────────── WATCHLIST ─ */

function WatchlistPanel({ onInspect }: { onInspect: (addr: string) => void }) {
  const [list, setList] = useState<WatchlistEntry[]>(() => loadWatchlist());
  const [newLabel, setNewLabel] = useState("");
  const [newAddr, setNewAddr] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importErr, setImportErr] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, { threshold: number; owners: number; balance_zbx: string } | null>>({});

  // Lazy-load summaries for each watched multisig.
  useEffect(() => {
    list.forEach((e) => {
      if (summaries[e.address] !== undefined) return;
      Promise.all([
        rpc<{ threshold: number; owners: string[] }>("zbx_getMultisig", [e.address]).catch(() => null),
        rpc<string>("zbx_getBalance", [e.address]).catch(() => "0x0"),
      ])
        .then(([info, bal]) => {
          setSummaries((prev) => ({
            ...prev,
            [e.address]: info
              ? { threshold: info.threshold, owners: info.owners.length, balance_zbx: weiHexToZbx(bal) }
              : null,
          }));
        });
    });
  }, [list, summaries]);

  function add() {
    if (!isValidAddress(newAddr)) return;
    setList(addToWatchlist(newLabel, newAddr));
    setNewLabel("");
    setNewAddr("");
  }
  function remove(addr: string) {
    setList(removeFromWatchlist(addr));
    setSummaries((prev) => {
      const next = { ...prev };
      delete next[normalizeAddress(addr)];
      return next;
    });
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
  function doImport() {
    setImportErr(null);
    try {
      const next = importWatchlistJson(importText, importMode);
      setList(next);
      setImportText("");
      setShowImport(false);
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e));
    }
  }

  const newAddrValid = newAddr === "" || isValidAddress(newAddr);

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-violet-500/5 border border-violet-500/20 rounded-md p-3">
        <Info className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
        <div>
          Bookmark multisig wallets you operate or monitor. Saved locally in your browser
          (<code className="font-mono bg-muted/40 px-1 rounded">localStorage</code>) — nothing leaves the device.
          Export/import as JSON to share between machines.
        </div>
      </div>

      {/* ADD ROW */}
      <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <BookmarkPlus className="h-3 w-3" /> Add to watchlist
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (e.g. Treasury)"
            className="sm:w-44 px-2.5 py-2 rounded-md bg-background border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            value={newAddr}
            onChange={(e) => setNewAddr(e.target.value)}
            placeholder="0x… multisig address"
            className={`flex-1 px-2.5 py-2 rounded-md bg-background border font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary ${
              !newAddrValid ? "border-rose-500/60" : "border-border"
            }`}
            onKeyDown={(e) => e.key === "Enter" && newAddrValid && newAddr && add()}
          />
          <button
            onClick={add}
            disabled={!newAddrValid || !newAddr}
            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        {!newAddrValid && (
          <Warn>Address must be 0x-prefix + 40 hex chars (20 bytes).</Warn>
        )}
      </div>

      {/* TOOLBAR */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[11px] text-muted-foreground">
          {list.length} bookmark{list.length === 1 ? "" : "s"}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={downloadJson}
            disabled={list.length === 0}
            className="text-[10px] px-2 py-1 rounded bg-background border border-border hover:bg-muted/40 disabled:opacity-40 flex items-center gap-1"
          >
            <Download className="h-3 w-3" /> Export
          </button>
          <button
            onClick={() => { setShowImport((v) => !v); setImportErr(null); }}
            className="text-[10px] px-2 py-1 rounded bg-background border border-border hover:bg-muted/40 flex items-center gap-1"
          >
            <Upload className="h-3 w-3" /> Import
          </button>
        </div>
      </div>

      {/* IMPORT PANEL */}
      {showImport && (
        <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='[{"label":"Treasury","address":"0x…","added_at":1714000000000}, …]'
            rows={5}
            className="w-full px-2.5 py-2 rounded-md bg-background border border-border font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 text-[10px]">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" checked={importMode === "merge"} onChange={() => setImportMode("merge")} className="accent-primary" />
                merge (skip duplicates)
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" checked={importMode === "replace"} onChange={() => setImportMode("replace")} className="accent-primary" />
                replace all
              </label>
            </div>
            <button
              onClick={doImport}
              disabled={!importText.trim()}
              className="text-[10px] px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 font-semibold"
            >
              Import
            </button>
          </div>
          {importErr && <Warn>{importErr}</Warn>}
        </div>
      )}

      {/* LIST */}
      {list.length === 0 ? (
        <div className="text-center text-xs text-muted-foreground py-8 rounded-lg border border-dashed border-border">
          No bookmarks yet. Add one above, or click "add to watchlist" on a derived address from the Create tab.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card overflow-hidden">
          {list.map((e) => {
            const sum = summaries[e.address];
            return (
              <li key={e.address} className="p-3 hover:bg-muted/20 transition-colors">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground">{e.label}</div>
                    <code className="text-[11px] font-mono text-muted-foreground break-all">{e.address}</code>
                    {sum === null && (
                      <div className="text-[10px] text-rose-400 mt-1">⚠ not found on chain</div>
                    )}
                    {sum && (
                      <div className="text-[10px] text-muted-foreground mt-1 font-mono">
                        {sum.threshold}-of-{sum.owners} · {sum.balance_zbx} ZBX
                      </div>
                    )}
                    {sum === undefined && (
                      <div className="text-[10px] text-muted-foreground mt-1 italic">loading…</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
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

/* ──────────────────────────────────────────── tiny helpers ─ */

function Section({
  icon: Icon, title, action, children, hideWhenIncomplete,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  hideWhenIncomplete?: boolean;
}) {
  if (hideWhenIncomplete) return null;
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
