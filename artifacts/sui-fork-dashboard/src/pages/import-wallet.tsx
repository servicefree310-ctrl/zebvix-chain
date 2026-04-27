import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  KeyRound,
  FileKey2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Copy,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  Wallet as WalletIcon,
  Trash2,
  RefreshCw,
  Search,
  Pencil,
  Check,
  X,
  Download,
  FileText,
  Wand2,
  Loader2,
  ListTree,
  Lock,
  LockOpen,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
import { useWallet } from "@/contexts/wallet-context";
import { useToast } from "@/hooks/use-toast";
import { rpc, shortAddr, weiHexToZbx } from "@/lib/zbx-rpc";
import {
  ETH_DEFAULT_PATH,
  generateMnemonic,
  privateKeyFromMnemonic,
  validateMnemonic,
} from "@/lib/mnemonic";
import {
  addressFromPublic,
  publicKeyFromSeed,
  isVaultNotReady,
  type StoredWallet,
} from "@/lib/web-wallet";
import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { Wallet as EthersWallet, HDNodeWallet, Mnemonic as EthersMnemonic } from "ethers";

type Tab = "key" | "mnemonic" | "json" | "generate";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

interface PathPreset {
  id: string;
  label: string;
  template: string; // contains "{N}" where the account/index slot lives
  hint: string;
}

/** Common HD-derivation presets — first six match every major EVM wallet. */
const PATH_PRESETS: PathPreset[] = [
  { id: "eth-standard",    label: "Ethereum (default)",  template: "m/44'/60'/0'/0/{N}",  hint: "MetaMask, Trust, Rabby — standard BIP44/60" },
  { id: "ledger-live",     label: "Ledger Live",         template: "m/44'/60'/{N}'/0/0",  hint: "Ledger Live — account-per-N derivation" },
  { id: "ledger-legacy",   label: "Ledger (legacy)",     template: "m/44'/60'/0'/{N}",    hint: "Older Ledger Chrome app" },
  { id: "metamask-legacy", label: "MetaMask (legacy)",   template: "m/44'/60'/0'/{N}",    hint: "Pre-2018 MetaMask" },
  { id: "trezor",          label: "Trezor",              template: "m/44'/60'/0'/0/{N}",  hint: "Same as Ethereum standard" },
  { id: "custom",          label: "Custom path…",        template: "m/44'/60'/0'/0/{N}",  hint: "Edit the template freely (use {N} for the index)" },
];

const STRENGTH_OPTIONS: Array<{ words: 12 | 15 | 18 | 21 | 24; bits: 128 | 160 | 192 | 224 | 256 }> = [
  { words: 12, bits: 128 },
  { words: 15, bits: 160 },
  { words: 18, bits: 192 },
  { words: 21, bits: 224 },
  { words: 24, bits: 256 },
];

const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;
const PATH_TEMPLATE_RE = /^m(\/\d+'?)+$/;
const MAX_DERIVE = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/** EIP-55 mixed-case checksum address (lowercase 0x-prefixed input). */
function toChecksumAddress(addrLower: string): string {
  const a = addrLower.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(a)) return addrLower;
  const enc = new TextEncoder();
  const hashHex = bytesToHex(keccak_256(enc.encode(a)));
  let out = "0x";
  for (let i = 0; i < a.length; i++) {
    const ch = a[i];
    if (/[a-f]/.test(ch)) {
      out += parseInt(hashHex[i], 16) >= 8 ? ch.toUpperCase() : ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Replace the {N} slot with `idx` (zero-padded so paths sort naturally). */
function expandPath(template: string, idx: number): string {
  return template.replace("{N}", String(idx));
}

/** Lightweight strength bar 0-100 for a mnemonic word count. */
function strengthScore(words: number): number {
  switch (words) {
    case 12: return 50;
    case 15: return 65;
    case 18: return 80;
    case 21: return 90;
    case 24: return 100;
    default: return 0;
  }
}

interface DerivedAccount {
  index: number;
  path: string;
  address: string;       // lower-case 0x
  privateKey: string;    // 0x + 64 hex
}

/** Derive N accounts from a (mnemonic + optional 25th-word passphrase + path template). */
function deriveAccounts(
  phrase: string,
  passphrase: string,
  template: string,
  count: number,
): DerivedAccount[] {
  const cleaned = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  if (!validateMnemonic(cleaned)) throw new Error("invalid BIP39 mnemonic");
  const seed = mnemonicToSeedSync(cleaned, passphrase);
  const master = HDKey.fromMasterSeed(seed);
  const out: DerivedAccount[] = [];
  for (let i = 0; i < count; i++) {
    const path = expandPath(template, i);
    const node = master.derive(path);
    if (!node.privateKey) throw new Error(`derivation failed at ${path}`);
    const sk = node.privateKey;
    const pub = publicKeyFromSeed(sk);
    out.push({
      index: i,
      path,
      address: addressFromPublic(pub),
      privateKey: "0x" + bytesToHex(sk),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live balance hook — race-safe: aborts in-flight + drops stale results.
// ─────────────────────────────────────────────────────────────────────────────

type BalanceState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; zbx: string; weiHex: string }
  | { state: "error"; reason: string };

function useLiveBalance(addresses: string[]): {
  balances: Record<string, BalanceState>;
  refresh: (addrs?: string[]) => void;
} {
  const [balances, setBalances] = useState<Record<string, BalanceState>>({});
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchAll = useCallback(async (addrs: string[]) => {
    if (addrs.length === 0) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const mySeq = ++seqRef.current;

    setBalances((prev) => {
      const next = { ...prev };
      for (const a of addrs) next[a.toLowerCase()] = { state: "loading" };
      return next;
    });

    const results = await Promise.allSettled(
      addrs.map(async (a) => {
        const hex = await rpc<string>("zbx_getBalance", [a]);
        return { a: a.toLowerCase(), hex };
      }),
    );

    if (controller.signal.aborted) return;
    if (mySeq !== seqRef.current) return;

    setBalances((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (r.status === "fulfilled") {
          next[r.value.a] = {
            state: "ok",
            zbx: weiHexToZbx(r.value.hex),
            weiHex: r.value.hex,
          };
        } else {
          // Best-effort: keep the address visible; just mark error.
          // Stash by index since we don't know which addr failed.
        }
      }
      // Mark anything still in "loading" from this batch as error
      for (const a of addrs) {
        const k = a.toLowerCase();
        if (next[k]?.state === "loading") {
          next[k] = { state: "error", reason: "RPC unreachable" };
        }
      }
      return next;
    });
  }, []);

  // Auto-fetch when address list changes
  useEffect(() => {
    if (addresses.length > 0) fetchAll(addresses);
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses.join("|")]);

  const refresh = useCallback(
    (addrs?: string[]) => {
      fetchAll(addrs ?? addresses);
    },
    [fetchAll, addresses],
  );

  return { balances, refresh };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ImportWallet() {
  const {
    wallets,
    active,
    addFromPrivateKey,
    addGenerated,
    remove,
    rename,
    setActive,
    vaultReady,
    vaultState,
  } = useWallet();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  /**
   * Shared guard for any "mint a key into local storage" action on this
   * page. If the encrypted vault isn't ready we SPA-navigate to /wallet
   * so the user can set a password or unlock. Returns `true` when the
   * caller may proceed.
   */
  function ensureVaultOrRedirect(): boolean {
    if (vaultReady) return true;
    const dest =
      vaultState === "missing"
        ? "/wallet?tab=manage&gate=create"
        : "/wallet";
    toast({
      title:
        vaultState === "missing"
          ? "Set a wallet password first"
          : "Unlock your wallet vault",
      description:
        vaultState === "missing"
          ? "Encryption is on by default — opening the wallet page so you can set a password."
          : "Opening the wallet page so you can unlock your encrypted vault.",
    });
    navigate(dest);
    return false;
  }

  const [tab, setTab] = useState<Tab>("key");

  // Set of normalised lower-case addresses already in the vault — for
  // "already imported" detection across every input surface.
  const existingAddrs = useMemo(
    () => new Set(wallets.map((w) => w.address.toLowerCase())),
    [wallets],
  );

  function isAlreadyImported(addrLower: string): boolean {
    return existingAddrs.has(addrLower.toLowerCase());
  }

  // ── Key tab state ───────────────────────────────────────────────────────
  const [keyHex, setKeyHex] = useState("");
  const [keyLabel, setKeyLabel] = useState("Imported (key)");
  const [showKey, setShowKey] = useState(false);

  const keyValidation = useMemo<
    | { state: "idle" }
    | { state: "invalid"; reason: string }
    | { state: "ok"; address: string; addressChecksum: string; alreadyImported: boolean }
  >(() => {
    const s = keyHex.trim().replace(/^0x/i, "");
    if (!s) return { state: "idle" };
    if (!HEX_KEY_RE.test(s)) {
      return { state: "invalid", reason: "must be 64 hex chars (32 bytes)" };
    }
    try {
      const seed = hexToBytes(s);
      const pub = publicKeyFromSeed(seed);
      const addr = addressFromPublic(pub);
      return {
        state: "ok",
        address: addr,
        addressChecksum: toChecksumAddress(addr),
        alreadyImported: isAlreadyImported(addr),
      };
    } catch (e) {
      return { state: "invalid", reason: e instanceof Error ? e.message : "invalid key" };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyHex, existingAddrs]);

  function importKey() {
    if (keyValidation.state !== "ok") return;
    if (!ensureVaultOrRedirect()) return;
    try {
      const w = addFromPrivateKey(keyHex.trim(), keyLabel.trim() || "Imported (key)");
      toast({ title: "Imported", description: shortAddr(w.address) });
      setKeyHex("");
      setKeyLabel("Imported (key)");
    } catch (e) {
      if (isVaultNotReady(e)) {
        ensureVaultOrRedirect();
        return;
      }
      toast({
        title: "Import failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  // ── Mnemonic tab state (HD derivation) ──────────────────────────────────
  const [phrase, setPhrase] = useState("");
  const [bipPassphrase, setBipPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [presetId, setPresetId] = useState<string>("eth-standard");
  const [customTemplate, setCustomTemplate] = useState<string>(ETH_DEFAULT_PATH.replace("/0", "/{N}"));
  const [deriveCount, setDeriveCount] = useState<number>(5);
  const [pickedIndices, setPickedIndices] = useState<Set<number>>(new Set([0]));
  const [mnLabelPrefix, setMnLabelPrefix] = useState("HD account");

  const activeTemplate = useMemo(() => {
    if (presetId === "custom") return customTemplate.trim();
    const p = PATH_PRESETS.find((x) => x.id === presetId);
    return p?.template ?? ETH_DEFAULT_PATH;
  }, [presetId, customTemplate]);

  // Custom templates MUST contain exactly one {N} placeholder — without it
  // every derived row would resolve to the same address, silently breaking
  // multi-account import.  We also require the underlying path to match
  // the BIP32 grammar after substitution.
  const templateValid = useMemo(() => {
    let placeholderCount = 0;
    for (let i = 0; i + 2 < activeTemplate.length; i++) {
      if (activeTemplate.charAt(i) === "{" && activeTemplate.charAt(i + 1) === "N" && activeTemplate.charAt(i + 2) === "}") {
        placeholderCount += 1;
      }
    }
    if (placeholderCount !== 1) return false;
    return PATH_TEMPLATE_RE.test(activeTemplate.replace("{N}", "0"));
  }, [activeTemplate]);

  const mnValidation = useMemo<
    | { state: "idle" }
    | { state: "invalid"; reason: string }
    | { state: "ok"; words: number; cleaned: string }
  >(() => {
    const cleaned = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
    if (!cleaned) return { state: "idle" };
    const words = cleaned.split(" ");
    if (![12, 15, 18, 21, 24].includes(words.length)) {
      return { state: "invalid", reason: `must be 12, 15, 18, 21 or 24 words (got ${words.length})` };
    }
    if (!validateMnemonic(cleaned)) {
      return { state: "invalid", reason: "invalid checksum or unknown word(s)" };
    }
    return { state: "ok", words: words.length, cleaned };
  }, [phrase]);

  const derived = useMemo<DerivedAccount[]>(() => {
    if (mnValidation.state !== "ok") return [];
    if (!templateValid) return [];
    try {
      return deriveAccounts(mnValidation.cleaned, bipPassphrase, activeTemplate, deriveCount);
    } catch {
      return [];
    }
  }, [mnValidation, bipPassphrase, activeTemplate, deriveCount, templateValid]);

  function togglePicked(idx: number) {
    setPickedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function importPicked() {
    if (derived.length === 0) return;
    if (!ensureVaultOrRedirect()) return;
    let ok = 0;
    let skipped = 0;
    let failed = 0;
    for (const a of derived) {
      if (!pickedIndices.has(a.index)) continue;
      if (existingAddrs.has(a.address.toLowerCase())) {
        skipped += 1;
        continue;
      }
      try {
        addFromPrivateKey(
          a.privateKey,
          `${mnLabelPrefix.trim() || "HD account"} #${a.index}`,
        );
        ok += 1;
      } catch (e) {
        if (isVaultNotReady(e)) {
          ensureVaultOrRedirect();
          return;
        }
        failed += 1;
      }
    }
    const parts: string[] = [];
    if (ok > 0) parts.push(`${ok} imported`);
    if (skipped > 0) parts.push(`${skipped} already in vault`);
    if (failed > 0) parts.push(`${failed} failed`);
    toast({
      title: ok > 0 ? "Imported" : "No new accounts",
      description: parts.join(" · ") || "Nothing to do",
      variant: failed > 0 ? "destructive" : "default",
    });
    if (ok > 0) {
      // Reset picks but keep the phrase visible so the user can pick more.
      setPickedIndices(new Set());
    }
  }

  // ── JSON Keystore tab state ─────────────────────────────────────────────
  const [jsonText, setJsonText] = useState("");
  const [jsonPassword, setJsonPassword] = useState("");
  const [showJsonPwd, setShowJsonPwd] = useState(false);
  const [jsonLabel, setJsonLabel] = useState("Imported (keystore)");
  const [jsonBusy, setJsonBusy] = useState(false);
  const [jsonResult, setJsonResult] = useState<
    | { state: "idle" }
    | { state: "ok"; address: string; alreadyImported: boolean }
    | { state: "error"; reason: string }
  >({ state: "idle" });
  const [jsonPrivateKey, setJsonPrivateKey] = useState<string>("");

  const jsonShape = useMemo<{ valid: boolean; reason?: string }>(() => {
    const s = jsonText.trim();
    if (!s) return { valid: false };
    try {
      const obj = JSON.parse(s);
      if (typeof obj !== "object" || obj === null) return { valid: false, reason: "not a JSON object" };
      if (typeof obj.version !== "number") return { valid: false, reason: "missing numeric `version` field" };
      if (typeof obj.crypto !== "object" && typeof obj.Crypto !== "object") {
        return { valid: false, reason: "missing `crypto` block (V3 keystore)" };
      }
      return { valid: true };
    } catch {
      return { valid: false, reason: "invalid JSON" };
    }
  }, [jsonText]);

  async function decryptJson() {
    if (!jsonShape.valid) return;
    setJsonBusy(true);
    setJsonResult({ state: "idle" });
    setJsonPrivateKey("");
    try {
      const wallet = await EthersWallet.fromEncryptedJson(jsonText.trim(), jsonPassword);
      const addr = (wallet.address || "").toLowerCase();
      const sk = (wallet as { privateKey?: string }).privateKey ?? "";
      if (!sk) throw new Error("ethers returned no private key (unsupported keystore variant)");
      setJsonPrivateKey(sk);
      setJsonResult({
        state: "ok",
        address: addr,
        alreadyImported: existingAddrs.has(addr),
      });
    } catch (e) {
      setJsonResult({
        state: "error",
        reason: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setJsonBusy(false);
    }
  }

  function importJson() {
    if (jsonResult.state !== "ok" || !jsonPrivateKey) return;
    if (!ensureVaultOrRedirect()) return;
    try {
      const w = addFromPrivateKey(jsonPrivateKey, jsonLabel.trim() || "Imported (keystore)");
      toast({ title: "Imported", description: shortAddr(w.address) });
      setJsonText("");
      setJsonPassword("");
      setJsonPrivateKey("");
      setJsonResult({ state: "idle" });
      setJsonLabel("Imported (keystore)");
    } catch (e) {
      if (isVaultNotReady(e)) {
        ensureVaultOrRedirect();
        return;
      }
      toast({
        title: "Import failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  // ── Generate tab state ──────────────────────────────────────────────────
  const [genStrength, setGenStrength] = useState<128 | 160 | 192 | 224 | 256>(128);
  const [genPhrase, setGenPhrase] = useState<string>("");
  const [genBackedUp, setGenBackedUp] = useState(false);
  const [genReveal, setGenReveal] = useState(false);
  const [genPassphrase, setGenPassphrase] = useState("");
  const [genPresetId, setGenPresetId] = useState<string>("eth-standard");
  const [genIndex, setGenIndex] = useState<number>(0);
  const [genLabel, setGenLabel] = useState<string>("Generated wallet");
  const [genFastPath, setGenFastPath] = useState(true); // skip mnemonic entirely

  const genTemplate = useMemo(() => {
    const p = PATH_PRESETS.find((x) => x.id === genPresetId);
    return p?.template ?? ETH_DEFAULT_PATH;
  }, [genPresetId]);

  const genDerived = useMemo<DerivedAccount | null>(() => {
    if (!genPhrase) return null;
    if (!validateMnemonic(genPhrase)) return null;
    try {
      const accs = deriveAccounts(genPhrase, genPassphrase, genTemplate, genIndex + 1);
      return accs[genIndex] ?? null;
    } catch {
      return null;
    }
  }, [genPhrase, genPassphrase, genTemplate, genIndex]);

  function generateNewMnemonic() {
    // Strength bits → @scure/bip39 supports 128 and 256 (12 + 24 words).
    // For 15/18/21 we fall back to ethers' HDNodeWallet which generates an
    // arbitrary-strength mnemonic via Mnemonic.fromEntropy.
    if (genStrength === 128 || genStrength === 256) {
      setGenPhrase(generateMnemonic(genStrength));
    } else {
      const entropyBytes = new Uint8Array(genStrength / 8);
      crypto.getRandomValues(entropyBytes);
      const ent = "0x" + bytesToHex(entropyBytes);
      const mn = EthersMnemonic.fromEntropy(ent);
      setGenPhrase(mn.phrase);
    }
    setGenBackedUp(false);
    setGenReveal(true);
  }

  function generateFastImport() {
    if (!ensureVaultOrRedirect()) return;
    try {
      const w = addGenerated(genLabel.trim() || "Generated wallet");
      toast({ title: "Wallet created", description: shortAddr(w.address) });
    } catch (e) {
      if (isVaultNotReady(e)) {
        ensureVaultOrRedirect();
        return;
      }
      toast({
        title: "Wallet creation failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  function importGenerated() {
    if (!genDerived) return;
    if (!genBackedUp) {
      toast({
        title: "Confirm backup first",
        description: "Tick the box to confirm you wrote down the recovery phrase.",
        variant: "destructive",
      });
      return;
    }
    if (!ensureVaultOrRedirect()) return;
    try {
      const w = addFromPrivateKey(
        genDerived.privateKey,
        `${genLabel.trim() || "Generated"} #${genDerived.index}`,
      );
      toast({ title: "Wallet created", description: shortAddr(w.address) });
      setGenPhrase("");
      setGenBackedUp(false);
      setGenReveal(false);
      setGenPassphrase("");
      setGenIndex(0);
    } catch (e) {
      if (isVaultNotReady(e)) {
        ensureVaultOrRedirect();
        return;
      }
      toast({
        title: "Wallet creation failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  // ── Live balance for top-of-tab preview address ─────────────────────────
  const previewAddrs = useMemo(() => {
    const out: string[] = [];
    if (tab === "key" && keyValidation.state === "ok") out.push(keyValidation.address);
    if (tab === "mnemonic") for (const a of derived) out.push(a.address);
    if (tab === "json" && jsonResult.state === "ok") out.push(jsonResult.address);
    if (tab === "generate" && genDerived) out.push(genDerived.address);
    return out;
  }, [tab, keyValidation, derived, jsonResult, genDerived]);

  const { balances: previewBalances, refresh: refreshPreviewBalances } = useLiveBalance(previewAddrs);

  // ── Live balance for the wallets list ───────────────────────────────────
  const listAddrs = useMemo(() => wallets.map((w) => w.address), [wallets]);
  const { balances: listBalances, refresh: refreshListBalances } = useLiveBalance(listAddrs);

  // ── Wallet list filter + bulk export ────────────────────────────────────
  const [filter, setFilter] = useState("");
  const filteredWallets = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return wallets;
    return wallets.filter(
      (w) =>
        w.address.toLowerCase().includes(q) ||
        w.label.toLowerCase().includes(q),
    );
  }, [wallets, filter]);

  function exportCsv() {
    if (wallets.length === 0) {
      toast({ title: "Nothing to export", description: "No wallets in this browser yet." });
      return;
    }
    const header = "address,checksum,label,created_at_iso";
    const rows = wallets.map((w) =>
      [
        w.address,
        toChecksumAddress(w.address),
        JSON.stringify(w.label),
        new Date(w.createdAt).toISOString(),
      ].join(","),
    );
    const csv = [header, ...rows].join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zebvix-wallets-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported", description: `${wallets.length} address(es) — keys NOT included.` });
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">Hot Wallet</Badge>
          <Badge variant="outline" className="text-blue-400 border-blue-500/40">secp256k1</Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">BIP39 / BIP32</Badge>
          <Badge variant="outline" className="text-amber-400 border-amber-500/40">EIP-55</Badge>
          <Badge variant="outline" className="text-purple-400 border-purple-500/40">V3 Keystore</Badge>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <KeyRound className="w-7 h-7 text-primary" />
            Import Address — Workbench
          </h1>
          <Link href="/wallet">
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary/40"
              data-testid="button-manage-wallet"
            >
              <WalletIcon className="h-3.5 w-3.5 text-primary" />
              Manage
              <ArrowRight className="h-3 w-3 opacity-60" />
            </button>
          </Link>
        </div>
        <p className="text-base text-muted-foreground max-w-3xl">
          Import any address — raw private key, BIP39 mnemonic with HD derivation across multiple
          accounts, encrypted JSON keystore (V3), or a fresh wallet generated locally. The same
          private key you use in MetaMask, Rabby, Trust or Ledger Live derives the SAME 0x-address
          on Zebvix.
        </p>
      </div>

      {/* Two-column layout: tabs (left) + sticky sidebar (right) */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 items-start">
        {/* LEFT — tabs + body + wallets list */}
        <div className="space-y-6 min-w-0">
          {/* Tabs */}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Import method">
            <TabBtn active={tab === "key"}      onClick={() => setTab("key")}      icon={KeyRound}  testId="tab-key"      tabId="tab-key"      panelId="panel-key">      Private Key   </TabBtn>
            <TabBtn active={tab === "mnemonic"} onClick={() => setTab("mnemonic")} icon={FileKey2}  testId="tab-mnemonic" tabId="tab-mnemonic" panelId="panel-mnemonic"> Mnemonic (HD)</TabBtn>
            <TabBtn active={tab === "json"}     onClick={() => setTab("json")}     icon={FileText}  testId="tab-json"     tabId="tab-json"     panelId="panel-json">     JSON Keystore </TabBtn>
            <TabBtn active={tab === "generate"} onClick={() => setTab("generate")} icon={Sparkles}  testId="tab-generate" tabId="tab-generate" panelId="panel-generate"> Generate New  </TabBtn>
          </div>

          {/* Tab body */}
          {tab === "key" && (
            <div role="tabpanel" id="panel-key" aria-labelledby="tab-key">
            <SectionCard title="Import via private key" icon={KeyRound} tone="primary">
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-key-hex">
                    Private key (hex)
                  </label>
                  <div className="relative">
                    <input
                      id="input-key-hex"
                      data-testid="input-key-hex"
                      value={keyHex}
                      onChange={(e) => setKeyHex(e.target.value.trim())}
                      placeholder="0x or raw 64 hex characters"
                      type={showKey ? "text" : "password"}
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full rounded-md border border-border bg-background py-2.5 pl-3 pr-11 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={showKey ? "Hide key" : "Reveal key"}
                      aria-pressed={showKey}
                      data-testid="button-toggle-show-key"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <KeyValidationLine v={keyValidation} />
                </div>

                {keyValidation.state === "ok" && (
                  <ChecksumPreview
                    address={keyValidation.addressChecksum}
                    balanceState={previewBalances[keyValidation.address.toLowerCase()] ?? { state: "idle" }}
                    onRefresh={() => refreshPreviewBalances([keyValidation.address])}
                  />
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-key-label">
                    Label (optional)
                  </label>
                  <input
                    id="input-key-label"
                    data-testid="input-key-label"
                    value={keyLabel}
                    onChange={(e) => setKeyLabel(e.target.value)}
                    placeholder="My main address"
                    className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                <button
                  onClick={importKey}
                  disabled={
                    keyValidation.state !== "ok" ||
                    (keyValidation.state === "ok" && keyValidation.alreadyImported)
                  }
                  data-testid="button-import-key"
                  className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {keyValidation.state === "ok" && keyValidation.alreadyImported
                    ? "Already in vault"
                    : "Import Address"}
                </button>

                {keyValidation.state === "ok" && keyValidation.alreadyImported && (
                  <button
                    onClick={() => {
                      setActive(keyValidation.address);
                      toast({ title: "Activated", description: shortAddr(keyValidation.address) });
                    }}
                    data-testid="button-activate-existing-key"
                    className="w-full rounded-md border border-border bg-card py-2 text-xs font-medium text-foreground hover:border-primary/40"
                  >
                    Activate this address instead
                  </button>
                )}
              </div>
            </SectionCard>
            </div>
          )}

          {tab === "mnemonic" && (
            <div role="tabpanel" id="panel-mnemonic" aria-labelledby="tab-mnemonic">
            <SectionCard title="Import via BIP39 mnemonic — HD derivation" icon={FileKey2} tone="primary">
              <div className="space-y-5">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-mnemonic">
                    Recovery phrase (12 / 15 / 18 / 21 / 24 words)
                  </label>
                  <textarea
                    id="input-mnemonic"
                    data-testid="input-mnemonic"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    placeholder="word1 word2 word3 …"
                    rows={4}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    className="w-full resize-none rounded-md border border-border bg-background px-3 py-2.5 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <MnemonicValidationLine v={mnValidation} templateValid={templateValid} template={activeTemplate} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-bip-passphrase">
                      BIP39 passphrase (optional 25th word)
                    </label>
                    <div className="relative">
                      <input
                        id="input-bip-passphrase"
                        data-testid="input-bip-passphrase"
                        value={bipPassphrase}
                        onChange={(e) => setBipPassphrase(e.target.value)}
                        placeholder="leave empty for none"
                        type={showPassphrase ? "text" : "password"}
                        spellCheck={false}
                        autoComplete="off"
                        className="w-full rounded-md border border-border bg-background py-2.5 pl-3 pr-11 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassphrase((s) => !s)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={showPassphrase ? "Hide passphrase" : "Reveal passphrase"}
                        aria-pressed={showPassphrase}
                        data-testid="button-toggle-show-passphrase"
                      >
                        {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="select-derive-count">
                      Accounts to preview
                    </label>
                    <select
                      id="select-derive-count"
                      data-testid="select-derive-count"
                      value={deriveCount}
                      onChange={(e) => setDeriveCount(Math.max(1, Math.min(MAX_DERIVE, Number(e.target.value))))}
                      className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {[1, 3, 5, 10].map((n) => (
                        <option key={n} value={n}>{n} account{n === 1 ? "" : "s"}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <PathPickerCard
                  presetId={presetId}
                  onPresetChange={setPresetId}
                  customTemplate={customTemplate}
                  onCustomChange={setCustomTemplate}
                  templateValid={templateValid}
                />

                <HDDeriveTable
                  derived={derived}
                  picked={pickedIndices}
                  onTogglePicked={togglePicked}
                  balances={previewBalances}
                  onRefreshBalances={() => refreshPreviewBalances(derived.map((d) => d.address))}
                  existingAddrs={existingAddrs}
                />

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-mn-label-prefix">
                      Label prefix
                    </label>
                    <input
                      id="input-mn-label-prefix"
                      data-testid="input-mn-label-prefix"
                      value={mnLabelPrefix}
                      onChange={(e) => setMnLabelPrefix(e.target.value)}
                      placeholder="HD account"
                      className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <button
                    onClick={importPicked}
                    disabled={pickedIndices.size === 0 || derived.length === 0}
                    data-testid="button-import-picked"
                    className="rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Import selected ({pickedIndices.size})
                  </button>
                </div>
              </div>
            </SectionCard>
            </div>
          )}

          {tab === "json" && (
            <div role="tabpanel" id="panel-json" aria-labelledby="tab-json">
            <SectionCard title="Import via encrypted JSON keystore (V3)" icon={FileText} tone="primary">
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-json-file">
                    Keystore file (or paste below)
                  </label>
                  <input
                    id="input-json-file"
                    data-testid="input-json-file"
                    type="file"
                    accept=".json,application/json"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const text = await f.text();
                      setJsonText(text);
                      setJsonResult({ state: "idle" });
                      setJsonPrivateKey("");
                    }}
                    className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-muted/70"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-json-text">
                    Keystore JSON
                  </label>
                  <textarea
                    id="input-json-text"
                    data-testid="input-json-text"
                    value={jsonText}
                    onChange={(e) => {
                      setJsonText(e.target.value);
                      setJsonResult({ state: "idle" });
                      setJsonPrivateKey("");
                    }}
                    placeholder='{"version":3,"crypto":{...},"address":"..."}'
                    rows={6}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    className="w-full resize-none rounded-md border border-border bg-background px-3 py-2.5 font-mono text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <JsonShapeLine valid={jsonShape.valid} reason={jsonShape.reason} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-json-pwd">
                    Keystore password
                  </label>
                  <div className="relative">
                    <input
                      id="input-json-pwd"
                      data-testid="input-json-pwd"
                      value={jsonPassword}
                      onChange={(e) => setJsonPassword(e.target.value)}
                      placeholder="the password used when this keystore was created"
                      type={showJsonPwd ? "text" : "password"}
                      autoComplete="off"
                      className="w-full rounded-md border border-border bg-background py-2.5 pl-3 pr-11 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowJsonPwd((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={showJsonPwd ? "Hide password" : "Reveal password"}
                      aria-pressed={showJsonPwd}
                      data-testid="button-toggle-show-json-pwd"
                    >
                      {showJsonPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={decryptJson}
                    disabled={!jsonShape.valid || !jsonPassword || jsonBusy}
                    data-testid="button-decrypt-json"
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {jsonBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    {jsonBusy ? "Decrypting (scrypt)…" : "Decrypt keystore"}
                  </button>
                  {jsonResult.state === "ok" && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300"
                      data-testid="json-decrypt-ok"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Decrypted — {shortAddr(jsonResult.address)}
                      {jsonResult.alreadyImported && " (already in vault)"}
                    </span>
                  )}
                  {jsonResult.state === "error" && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300"
                      data-testid="json-decrypt-error"
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                      {jsonResult.reason.length > 90 ? jsonResult.reason.slice(0, 90) + "…" : jsonResult.reason}
                    </span>
                  )}
                </div>

                {jsonResult.state === "ok" && (
                  <ChecksumPreview
                    address={toChecksumAddress(jsonResult.address)}
                    balanceState={previewBalances[jsonResult.address.toLowerCase()] ?? { state: "idle" }}
                    onRefresh={() => refreshPreviewBalances([jsonResult.address])}
                  />
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-json-label">
                    Label (optional)
                  </label>
                  <input
                    id="input-json-label"
                    data-testid="input-json-label"
                    value={jsonLabel}
                    onChange={(e) => setJsonLabel(e.target.value)}
                    placeholder="My MetaMask export"
                    className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                <button
                  onClick={importJson}
                  disabled={
                    jsonResult.state !== "ok" ||
                    (jsonResult.state === "ok" && jsonResult.alreadyImported) ||
                    !jsonPrivateKey
                  }
                  data-testid="button-import-json"
                  className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {jsonResult.state === "ok" && jsonResult.alreadyImported
                    ? "Already in vault"
                    : "Import Address"}
                </button>
              </div>
            </SectionCard>
            </div>
          )}

          {tab === "generate" && (
            <div role="tabpanel" id="panel-generate" aria-labelledby="tab-generate">
            <SectionCard title="Generate a fresh wallet" icon={Sparkles} tone="primary">
              <div className="space-y-5">
                {/* Mode toggle */}
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Generation mode">
                  <ModeBtn
                    active={genFastPath}
                    onClick={() => setGenFastPath(true)}
                    testId="mode-quick"
                  >
                    Quick (no mnemonic)
                  </ModeBtn>
                  <ModeBtn
                    active={!genFastPath}
                    onClick={() => setGenFastPath(false)}
                    testId="mode-mnemonic"
                  >
                    BIP39 mnemonic (backup-friendly)
                  </ModeBtn>
                </div>

                {genFastPath ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Mints a fresh secp256k1 keypair directly into your encrypted vault. No
                      mnemonic to back up — to recover this address later, export the private key
                      from the Wallet page and store it somewhere safe.
                    </p>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-gen-quick-label">
                        Label
                      </label>
                      <input
                        id="input-gen-quick-label"
                        data-testid="input-gen-quick-label"
                        value={genLabel}
                        onChange={(e) => setGenLabel(e.target.value)}
                        placeholder="Generated wallet"
                        className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <button
                      onClick={generateFastImport}
                      data-testid="button-generate-quick"
                      className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                    >
                      <Sparkles className="mr-2 inline h-4 w-4" />
                      Generate &amp; Import
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Strength */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Mnemonic strength</span>
                        <span className="text-[10px] text-muted-foreground" data-testid="gen-strength-label">
                          {genStrength}-bit entropy
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {STRENGTH_OPTIONS.map(({ words, bits }) => (
                          <button
                            key={words}
                            onClick={() => { setGenStrength(bits); setGenPhrase(""); setGenBackedUp(false); }}
                            data-testid={`button-strength-${words}`}
                            aria-pressed={genStrength === bits}
                            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                              genStrength === bits
                                ? "border-primary/50 bg-primary/10 text-primary"
                                : "border-border bg-card text-foreground hover:border-primary/30"
                            }`}
                          >
                            {words} words
                          </button>
                        ))}
                      </div>
                      <StrengthBar score={strengthScore(STRENGTH_OPTIONS.find((s) => s.bits === genStrength)?.words ?? 12)} />
                    </div>

                    {/* Generate button */}
                    <button
                      onClick={generateNewMnemonic}
                      data-testid="button-generate-mnemonic"
                      className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
                    >
                      <Wand2 className="h-4 w-4" />
                      {genPhrase ? "Re-generate" : "Generate mnemonic"}
                    </button>

                    {/* Mnemonic display */}
                    {genPhrase && (
                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">Recovery phrase</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setGenReveal((r) => !r)}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={genReveal ? "Hide phrase" : "Reveal phrase"}
                              aria-pressed={genReveal}
                              data-testid="button-toggle-reveal-mnemonic"
                            >
                              {genReveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(genPhrase);
                                toast({ title: "Copied" });
                              }}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label="Copy phrase"
                              data-testid="button-copy-mnemonic"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div
                          className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 font-mono text-sm leading-relaxed select-all"
                          data-testid="generated-mnemonic"
                        >
                          {genReveal ? genPhrase : genPhrase.split(" ").map(() => "•".repeat(6)).join(" ")}
                        </div>
                        <label className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={genBackedUp}
                            onChange={(e) => setGenBackedUp(e.target.checked)}
                            className="h-4 w-4 rounded border-border accent-primary"
                            data-testid="checkbox-backed-up"
                          />
                          <span>I have written down this phrase in a safe offline place.</span>
                        </label>
                      </div>
                    )}

                    {/* Path + index for the address derived from this phrase */}
                    {genPhrase && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-2">
                          <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="select-gen-preset">
                            Derivation path
                          </label>
                          <select
                            id="select-gen-preset"
                            data-testid="select-gen-preset"
                            value={genPresetId}
                            onChange={(e) => setGenPresetId(e.target.value)}
                            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                          >
                            {PATH_PRESETS.filter((p) => p.id !== "custom").map((p) => (
                              <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-gen-index">
                            Account index
                          </label>
                          <input
                            id="input-gen-index"
                            data-testid="input-gen-index"
                            type="number"
                            min={0}
                            max={1024}
                            value={genIndex}
                            onChange={(e) => setGenIndex(Math.max(0, Math.min(1024, Number(e.target.value) || 0)))}
                            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                      </div>
                    )}

                    {genPhrase && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-gen-passphrase">
                          BIP39 passphrase (optional 25th word)
                        </label>
                        <input
                          id="input-gen-passphrase"
                          data-testid="input-gen-passphrase"
                          value={genPassphrase}
                          onChange={(e) => setGenPassphrase(e.target.value)}
                          placeholder="leave empty for none"
                          type="password"
                          spellCheck={false}
                          autoComplete="off"
                          className="w-full rounded-md border border-border bg-background px-3 py-2.5 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                    )}

                    {genDerived && (
                      <ChecksumPreview
                        address={toChecksumAddress(genDerived.address)}
                        balanceState={previewBalances[genDerived.address.toLowerCase()] ?? { state: "idle" }}
                        onRefresh={() => refreshPreviewBalances([genDerived.address])}
                        path={genDerived.path}
                      />
                    )}

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="input-gen-label">
                        Label
                      </label>
                      <input
                        id="input-gen-label"
                        data-testid="input-gen-label"
                        value={genLabel}
                        onChange={(e) => setGenLabel(e.target.value)}
                        placeholder="Generated wallet"
                        className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>

                    <button
                      onClick={importGenerated}
                      disabled={!genDerived || !genBackedUp}
                      data-testid="button-import-generated"
                      className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Sparkles className="mr-2 inline h-4 w-4" />
                      Import generated wallet
                    </button>
                  </div>
                )}
              </div>
            </SectionCard>
            </div>
          )}

          {/* Existing wallets list — pro-level row controls */}
          <SectionCard
            title={`Your wallets (${wallets.length})`}
            icon={WalletIcon}
            subtitle={
              active
                ? `Active: ${active.label} · ${shortAddr(active.address)}`
                : "No active wallet selected"
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by label or address…"
                  data-testid="input-wallet-filter"
                  className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                onClick={() => refreshListBalances()}
                disabled={wallets.length === 0}
                data-testid="button-refresh-list-balances"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-2 text-xs font-medium text-foreground transition hover:border-primary/40 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh balances
              </button>
              <button
                onClick={exportCsv}
                disabled={wallets.length === 0}
                data-testid="button-export-csv"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-2 text-xs font-medium text-foreground transition hover:border-primary/40 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>

            {wallets.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
                No wallets yet. Import or generate one above.
              </div>
            ) : filteredWallets.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
                No wallets match &ldquo;{filter}&rdquo;.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredWallets.map((w) => (
                  <WalletRow
                    key={w.address}
                    wallet={w}
                    isActive={active?.address.toLowerCase() === w.address.toLowerCase()}
                    balance={listBalances[w.address.toLowerCase()] ?? { state: "idle" }}
                    onActivate={() => setActive(w.address)}
                    onCopy={(text) => {
                      navigator.clipboard.writeText(text);
                      toast({ title: "Copied" });
                    }}
                    onRefreshBalance={() => refreshListBalances([w.address])}
                    onRename={(newLabel) => {
                      try {
                        rename(w.address, newLabel);
                        toast({ title: "Renamed", description: newLabel });
                      } catch (e) {
                        if (isVaultNotReady(e)) {
                          ensureVaultOrRedirect();
                          return;
                        }
                        toast({
                          title: "Rename failed",
                          description: e instanceof Error ? e.message : String(e),
                          variant: "destructive",
                        });
                      }
                    }}
                    onRemove={() => {
                      if (confirm(`Remove ${shortAddr(w.address)} from this browser?`)) {
                        remove(w.address);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* RIGHT — sticky sidebar */}
        <aside className="space-y-4 xl:sticky xl:top-4 self-start">
          <VaultStatusCard vaultState={vaultState} onAction={() => navigate(vaultState === "missing" ? "/wallet?tab=manage&gate=create" : "/wallet")} />
          <RiskAdvisorCard vaultState={vaultState} />
          <DerivationSummaryCard
            tab={tab}
            keyValidation={keyValidation}
            mnValid={mnValidation.state === "ok"}
            mnWords={mnValidation.state === "ok" ? mnValidation.words : 0}
            template={activeTemplate}
            picked={pickedIndices.size}
            jsonValid={jsonShape.valid}
            jsonOk={jsonResult.state === "ok"}
            genWords={genPhrase ? genPhrase.split(/\s+/).length : 0}
          />
        </aside>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function TabBtn({
  active, onClick, icon: Icon, children, testId, tabId, panelId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  children: React.ReactNode;
  testId?: string;
  tabId?: string;
  panelId?: string;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      id={tabId}
      aria-controls={panelId}
      aria-selected={active}
      aria-pressed={active}
      data-testid={testId}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition ${
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-card text-foreground hover:border-primary/30"
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {children}
    </button>
  );
}

function ModeBtn({
  active, onClick, children, testId,
}: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      onClick={onClick}
      role="radio"
      aria-checked={active}
      data-testid={testId}
      className={`rounded-md border px-3 py-2 text-xs font-medium transition ${
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-card text-foreground hover:border-primary/30"
      }`}
    >
      {children}
    </button>
  );
}

function KeyValidationLine({
  v,
}: {
  v:
    | { state: "idle" }
    | { state: "invalid"; reason: string }
    | { state: "ok"; address: string; addressChecksum: string; alreadyImported: boolean };
}) {
  if (v.state === "idle") {
    return <div className="mt-1.5 text-xs text-muted-foreground">MetaMask-compatible — paste the same key you use there.</div>;
  }
  if (v.state === "invalid") {
    return (
      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-red-400" role="alert" data-testid="key-validation-error">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{v.reason}</span>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex items-start gap-1.5 text-xs text-emerald-300" data-testid="key-validation-ok" aria-live="polite">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="break-all">
        Resolves to <code className="font-mono">{v.addressChecksum}</code>
        {v.alreadyImported && <span className="ml-1 text-amber-300">· already in vault</span>}
      </span>
    </div>
  );
}

function MnemonicValidationLine({
  v, templateValid, template,
}: {
  v: { state: "idle" } | { state: "invalid"; reason: string } | { state: "ok"; words: number; cleaned: string };
  templateValid: boolean;
  template: string;
}) {
  if (v.state === "idle") {
    return <div className="mt-1.5 text-xs text-muted-foreground">Standard EVM derivation path: <code className="font-mono">{template}</code></div>;
  }
  if (v.state === "invalid") {
    return (
      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-red-400" role="alert" data-testid="mn-validation-error">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{v.reason}</span>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-emerald-300" data-testid="mn-validation-ok">
      <span className="flex items-center gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {v.words}-word phrase, valid checksum
      </span>
      <span className={templateValid ? "text-muted-foreground" : "text-amber-400"}>
        path template <code className="font-mono">{template}</code>{!templateValid && " (invalid)"}
      </span>
    </div>
  );
}

function JsonShapeLine({ valid, reason }: { valid: boolean; reason?: string }) {
  if (valid) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-300" data-testid="json-shape-ok">
        <CheckCircle2 className="h-3.5 w-3.5" /> Looks like a V3 keystore.
      </div>
    );
  }
  if (!reason) {
    return <div className="mt-1.5 text-xs text-muted-foreground">Paste an Ethereum-style encrypted JSON keystore (e.g. exported from MetaMask, geth or ethers).</div>;
  }
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-400" role="alert">
      <AlertCircle className="h-3.5 w-3.5" /> {reason}
    </div>
  );
}

function ChecksumPreview({
  address, balanceState, onRefresh, path,
}: {
  address: string;
  balanceState: BalanceState;
  onRefresh: () => void;
  path?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-3 space-y-2" data-testid="checksum-preview">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">EIP-55 address</div>
          <code className="block break-all font-mono text-sm text-foreground" data-testid="preview-address">{address}</code>
          {path && (
            <div className="mt-1 text-[10px] text-muted-foreground">path <code className="font-mono">{path}</code></div>
          )}
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(address);
          }}
          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Copy checksum address"
          data-testid="button-copy-preview-address"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
        <BalancePill state={balanceState} />
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-1 rounded p-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Refresh balance"
          data-testid="button-refresh-preview-balance"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>
    </div>
  );
}

function BalancePill({ state }: { state: BalanceState }) {
  if (state.state === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> fetching live balance…
      </span>
    );
  }
  if (state.state === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-foreground" data-testid="balance-ok">
        <span className="font-mono font-semibold text-primary">{state.zbx}</span>
        <span className="text-muted-foreground">ZBX (live)</span>
      </span>
    );
  }
  if (state.state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-400" data-testid="balance-error">
        <AlertCircle className="h-3 w-3" /> balance unavailable
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">balance: not yet fetched</span>;
}

function PathPickerCard({
  presetId, onPresetChange, customTemplate, onCustomChange, templateValid,
}: {
  presetId: string;
  onPresetChange: (id: string) => void;
  customTemplate: string;
  onCustomChange: (s: string) => void;
  templateValid: boolean;
}) {
  const preset = PATH_PRESETS.find((p) => p.id === presetId);
  return (
    <div className="rounded-md border border-border bg-card/40 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <ListTree className="h-3.5 w-3.5 text-primary" />
        Derivation path
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select
          value={presetId}
          onChange={(e) => onPresetChange(e.target.value)}
          data-testid="select-path-preset"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {PATH_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <input
          value={presetId === "custom" ? customTemplate : (preset?.template ?? "")}
          onChange={(e) => {
            if (presetId === "custom") onCustomChange(e.target.value);
          }}
          readOnly={presetId !== "custom"}
          spellCheck={false}
          data-testid="input-path-template"
          className={`rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 ${
            templateValid ? "border-border focus:border-primary focus:ring-primary/30" : "border-amber-500/60 focus:ring-amber-500/30"
          } ${presetId !== "custom" ? "opacity-70 cursor-not-allowed" : ""}`}
        />
      </div>
      <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          {preset?.hint ?? "Custom"}. The <code className="font-mono">{"{N}"}</code> placeholder is replaced with the account index 0…{MAX_DERIVE - 1}.
        </span>
      </div>
    </div>
  );
}

function HDDeriveTable({
  derived, picked, onTogglePicked, balances, onRefreshBalances, existingAddrs,
}: {
  derived: DerivedAccount[];
  picked: Set<number>;
  onTogglePicked: (idx: number) => void;
  balances: Record<string, BalanceState>;
  onRefreshBalances: () => void;
  existingAddrs: Set<string>;
}) {
  if (derived.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/40 p-6 text-center text-xs text-muted-foreground">
        Enter a valid mnemonic above to preview HD-derived addresses.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="flex items-center justify-between bg-muted/30 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>Derived accounts ({derived.length})</span>
        <button
          onClick={onRefreshBalances}
          className="inline-flex items-center gap-1 rounded p-1 text-[10px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          aria-label="Refresh derived balances"
          data-testid="button-refresh-derived-balances"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>
      <div className="divide-y divide-border">
        {derived.map((a) => {
          const k = a.address.toLowerCase();
          const bal = balances[k] ?? { state: "idle" };
          const already = existingAddrs.has(k);
          const isPicked = picked.has(a.index);
          return (
            <label
              key={a.path}
              className={`grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-3 px-3 py-2.5 cursor-pointer transition ${
                isPicked ? "bg-primary/5" : "hover:bg-muted/20"
              } ${already ? "opacity-80" : ""}`}
              data-testid={`derive-row-${a.index}`}
            >
              <input
                type="checkbox"
                checked={isPicked && !already}
                onChange={() => {
                  // Already-in-vault rows are a no-op on import (dedup'd
                  // server-side) — leaving the checkbox interactive but
                  // visually de-emphasised gives the user a clearer mental
                  // model than a hard-disable.
                  if (already) return;
                  onTogglePicked(a.index);
                }}
                aria-label={`Select account #${a.index}`}
                aria-disabled={already}
                className={`h-4 w-4 rounded border-border accent-primary ${already ? "opacity-40 cursor-not-allowed" : ""}`}
                data-testid={`checkbox-derive-${a.index}`}
              />
              <span className="text-xs font-medium text-muted-foreground tabular-nums">#{a.index}</span>
              <div className="min-w-0">
                <code className="block truncate font-mono text-xs text-foreground">{toChecksumAddress(a.address)}</code>
                <div className="text-[10px] text-muted-foreground truncate">{a.path}</div>
              </div>
              <BalancePill state={bal} />
              {already && (
                <span
                  className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
                  data-testid={`already-in-vault-${a.index}`}
                >
                  in vault
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function StrengthBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const colorClass =
    pct >= 90 ? "bg-emerald-500" : pct >= 75 ? "bg-emerald-400" : pct >= 60 ? "bg-amber-400" : "bg-amber-500";
  return (
    <div className="mt-2 h-1.5 w-full rounded bg-muted overflow-hidden" aria-hidden="true">
      <div className={`h-full ${colorClass} transition-all`} style={{ width: `${pct}%` }} data-testid="strength-bar" />
    </div>
  );
}

function VaultStatusCard({
  vaultState, onAction,
}: {
  vaultState: "missing" | "locked" | "ready";
  onAction: () => void;
}) {
  const config = vaultState === "ready"
    ? {
        Icon: ShieldCheck,
        ring: "border-emerald-500/40 bg-emerald-500/5",
        title: "Vault ready",
        body: "New imports go straight into your encrypted local vault.",
        actionLabel: "Open vault",
        toneText: "text-emerald-300",
      }
    : vaultState === "locked"
    ? {
        Icon: Lock,
        ring: "border-amber-500/40 bg-amber-500/5",
        title: "Vault locked",
        body: "Unlock to import or generate any new address from this page.",
        actionLabel: "Unlock vault",
        toneText: "text-amber-300",
      }
    : {
        Icon: LockOpen,
        ring: "border-rose-500/40 bg-rose-500/5",
        title: "No vault yet",
        body: "Set a wallet password — encryption is on by default for safety.",
        actionLabel: "Set password",
        toneText: "text-rose-300",
      };
  const { Icon } = config;
  return (
    <div className={`rounded-md border ${config.ring} p-3 space-y-2`} data-testid="vault-status-card">
      <div className={`flex items-center gap-2 text-xs font-semibold ${config.toneText}`}>
        <Icon className="h-4 w-4" />
        {config.title}
      </div>
      <p className="text-xs text-muted-foreground">{config.body}</p>
      <button
        onClick={onAction}
        data-testid="button-vault-action"
        className="w-full rounded-md border border-border bg-background py-1.5 text-xs font-medium text-foreground hover:border-primary/40"
      >
        {config.actionLabel}
      </button>
    </div>
  );
}

function RiskAdvisorCard({ vaultState }: { vaultState: "missing" | "locked" | "ready" }) {
  const isVaulted = vaultState !== "missing";
  return (
    <div className="rounded-md border border-border bg-card/40 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <ShieldAlert className="h-4 w-4 text-amber-400" />
        Hot wallet risk
      </div>
      <ul className="text-[11px] text-muted-foreground space-y-1.5 list-disc pl-4">
        <li>
          {isVaulted
            ? "Keys are AES-GCM encrypted under your password before being written to localStorage."
            : "Without a vault password, keys would land in plaintext localStorage — set one now."}
        </li>
        <li>Anyone with this browser profile + your password (or unlocked tab) can spend the funds.</li>
        <li>For larger holdings use a hardware wallet (Ledger / Trezor) and import only watch-only addresses here.</li>
      </ul>
    </div>
  );
}

function DerivationSummaryCard({
  tab, keyValidation, mnValid, mnWords, template, picked, jsonValid, jsonOk, genWords,
}: {
  tab: Tab;
  keyValidation:
    | { state: "idle" }
    | { state: "invalid"; reason: string }
    | { state: "ok"; address: string; addressChecksum: string; alreadyImported: boolean };
  mnValid: boolean;
  mnWords: number;
  template: string;
  picked: number;
  jsonValid: boolean;
  jsonOk: boolean;
  genWords: number;
}) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-3 space-y-2" data-testid="summary-card">
      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <Info className="h-4 w-4 text-primary" />
        Pending import summary
      </div>
      <dl className="text-[11px] text-muted-foreground space-y-1">
        <div className="flex justify-between gap-2"><dt>Active tab</dt><dd className="text-foreground capitalize">{tab}</dd></div>
        {tab === "key" && (
          <>
            <div className="flex justify-between gap-2"><dt>Key valid</dt><dd className={keyValidation.state === "ok" ? "text-emerald-400" : "text-muted-foreground"}>{keyValidation.state === "ok" ? "yes" : keyValidation.state === "invalid" ? "no" : "—"}</dd></div>
            {keyValidation.state === "ok" && (
              <div className="flex justify-between gap-2"><dt>Already in vault</dt><dd className={keyValidation.alreadyImported ? "text-amber-300" : "text-emerald-400"}>{keyValidation.alreadyImported ? "yes" : "no"}</dd></div>
            )}
          </>
        )}
        {tab === "mnemonic" && (
          <>
            <div className="flex justify-between gap-2"><dt>Mnemonic</dt><dd className={mnValid ? "text-emerald-400" : "text-muted-foreground"}>{mnValid ? `${mnWords} words OK` : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt>Path</dt><dd className="font-mono text-foreground truncate max-w-[160px]" title={template}>{template}</dd></div>
            <div className="flex justify-between gap-2"><dt>Selected</dt><dd className="text-foreground">{picked} account{picked === 1 ? "" : "s"}</dd></div>
          </>
        )}
        {tab === "json" && (
          <>
            <div className="flex justify-between gap-2"><dt>JSON shape</dt><dd className={jsonValid ? "text-emerald-400" : "text-muted-foreground"}>{jsonValid ? "V3 keystore" : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt>Decrypted</dt><dd className={jsonOk ? "text-emerald-400" : "text-muted-foreground"}>{jsonOk ? "yes" : "no"}</dd></div>
          </>
        )}
        {tab === "generate" && (
          <div className="flex justify-between gap-2"><dt>Mnemonic</dt><dd className={genWords > 0 ? "text-emerald-400" : "text-muted-foreground"}>{genWords > 0 ? `${genWords} words drafted` : "—"}</dd></div>
        )}
      </dl>
    </div>
  );
}

function WalletRow({
  wallet, isActive, balance, onActivate, onCopy, onRefreshBalance, onRename, onRemove,
}: {
  wallet: StoredWallet;
  isActive: boolean;
  balance: BalanceState;
  onActivate: () => void;
  onCopy: (text: string) => void;
  onRefreshBalance: () => void;
  onRename: (newLabel: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(wallet.label);
  useEffect(() => { setDraft(wallet.label); }, [wallet.label]);

  const checksum = useMemo(() => toChecksumAddress(wallet.address), [wallet.address]);
  const created = useMemo(() => {
    try { return new Date(wallet.createdAt).toLocaleDateString(); } catch { return ""; }
  }, [wallet.createdAt]);

  return (
    <div
      className={`rounded-md border p-3 transition ${
        isActive ? "border-primary/40 bg-primary/5" : "border-border bg-card/40 hover:border-primary/30"
      }`}
      data-testid={`wallet-row-${wallet.address.toLowerCase()}`}
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground/30"}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                data-testid={`input-rename-${wallet.address.toLowerCase()}`}
                className="flex-1 rounded border border-primary/40 bg-background px-2 py-1 text-sm focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onRename(draft.trim() || wallet.label);
                    setEditing(false);
                  } else if (e.key === "Escape") {
                    setDraft(wallet.label);
                    setEditing(false);
                  }
                }}
              />
              <button
                onClick={() => {
                  onRename(draft.trim() || wallet.label);
                  setEditing(false);
                }}
                className="rounded p-1 text-emerald-400 hover:bg-muted"
                aria-label="Save label"
                data-testid={`button-save-rename-${wallet.address.toLowerCase()}`}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => { setDraft(wallet.label); setEditing(false); }}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Cancel rename"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">{wallet.label}</span>
              <button
                onClick={() => setEditing(true)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Rename wallet"
                data-testid={`button-rename-${wallet.address.toLowerCase()}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="truncate font-mono text-xs text-muted-foreground" title={checksum}>{checksum}</div>
        </div>
        <button
          onClick={() => onCopy(checksum)}
          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Copy address (EIP-55)"
          title="Copy address"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        {!isActive && (
          <button
            onClick={onActivate}
            data-testid={`button-activate-${wallet.address.toLowerCase()}`}
            className="rounded border border-border px-2 py-1 text-xs font-medium text-foreground hover:border-primary/40"
          >
            Activate
          </button>
        )}
        <button
          onClick={onRemove}
          className="rounded p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
          aria-label="Remove wallet"
          title="Remove"
          data-testid={`button-remove-${wallet.address.toLowerCase()}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 pl-6 text-[11px] text-muted-foreground">
        <BalancePill state={balance} />
        <div className="flex items-center gap-2">
          {created && <span>created {created}</span>}
          <button
            onClick={onRefreshBalance}
            className="inline-flex items-center gap-1 rounded p-0.5 hover:bg-muted hover:text-foreground"
            aria-label="Refresh balance"
            data-testid={`button-refresh-${wallet.address.toLowerCase()}`}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
