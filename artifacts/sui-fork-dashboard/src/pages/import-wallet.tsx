import React, { useMemo, useState } from "react";
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
  Wallet as WalletIcon,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
import { useWallet } from "@/contexts/wallet-context";
import { useToast } from "@/hooks/use-toast";
import { shortAddr } from "@/lib/zbx-rpc";
import { validateMnemonic, privateKeyFromMnemonic } from "@/lib/mnemonic";
import { addressFromPublic, publicKeyFromSeed, isVaultNotReady } from "@/lib/web-wallet";
import { hexToBytes } from "@noble/hashes/utils.js";

type Tab = "key" | "mnemonic" | "generate";

export default function ImportWallet() {
  const {
    wallets,
    active,
    addFromPrivateKey,
    addFromMnemonic,
    addGenerated,
    remove,
    setActive,
    vaultReady,
    vaultState,
  } = useWallet();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  /**
   * Shared guard for any "mint a key into local storage" action on this
   * page. If the encrypted vault isn't ready we SPA-navigate (NOT
   * window.location.assign — that would discard the just-queued toast)
   * to /wallet so the user can set a password or unlock. Returns `true`
   * when the caller may proceed.
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

  // ── Key tab state ────────────────────────────────────────────────────────
  const [keyHex, setKeyHex] = useState("");
  const [keyLabel, setKeyLabel] = useState("Imported (key)");
  const [showKey, setShowKey] = useState(false);

  const keyValidation = useMemo(() => {
    const s = keyHex.trim().replace(/^0x/i, "");
    if (!s) return { state: "idle" as const };
    if (!/^[0-9a-fA-F]{64}$/.test(s)) {
      return { state: "invalid" as const, reason: "must be 64 hex chars (32 bytes)" };
    }
    try {
      const seed = hexToBytes(s);
      const pub = publicKeyFromSeed(seed);
      const addr = addressFromPublic(pub);
      return { state: "ok" as const, address: addr };
    } catch (e) {
      return { state: "invalid" as const, reason: e instanceof Error ? e.message : "invalid key" };
    }
  }, [keyHex]);

  function importKey() {
    if (keyValidation.state !== "ok") return;
    if (!ensureVaultOrRedirect()) return;
    try {
      const w = addFromPrivateKey(keyHex.trim(), keyLabel.trim() || "Imported (key)");
      toast({ title: "Imported", description: shortAddr(w.address) });
      setKeyHex("");
      setKeyLabel("Imported (key)");
    } catch (e) {
      // Race-defense: vault could have been locked in another tab
      // between the `vaultReady` snapshot and this storage write.
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

  // ── Mnemonic tab state ───────────────────────────────────────────────────
  const [phrase, setPhrase] = useState("");
  const [mnLabel, setMnLabel] = useState("Imported (mnemonic)");

  const mnValidation = useMemo(() => {
    const cleaned = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
    if (!cleaned) return { state: "idle" as const };
    const words = cleaned.split(" ");
    if (![12, 15, 18, 21, 24].includes(words.length)) {
      return {
        state: "invalid" as const,
        reason: `must be 12, 15, 18, 21 or 24 words (got ${words.length})`,
      };
    }
    if (!validateMnemonic(cleaned)) {
      return { state: "invalid" as const, reason: "invalid checksum or unknown word(s)" };
    }
    try {
      const sk = privateKeyFromMnemonic(cleaned);
      const pub = publicKeyFromSeed(sk);
      return {
        state: "ok" as const,
        address: addressFromPublic(pub),
        words: words.length,
      };
    } catch (e) {
      return { state: "invalid" as const, reason: e instanceof Error ? e.message : "derivation failed" };
    }
  }, [phrase]);

  function importMnemonic() {
    if (mnValidation.state !== "ok") return;
    if (!ensureVaultOrRedirect()) return;
    try {
      const w = addFromMnemonic(phrase.trim(), mnLabel.trim() || "Imported (mnemonic)");
      toast({ title: "Imported", description: shortAddr(w.address) });
      setPhrase("");
      setMnLabel("Imported (mnemonic)");
    } catch (e) {
      // Race-defense (see importKey above).
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

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">
            Hot Wallet
          </Badge>
          <Badge variant="outline" className="text-blue-400 border-blue-500/40">
            secp256k1
          </Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
            BIP39
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <KeyRound className="w-7 h-7 text-primary" />
            Import Address
          </h1>
          <Link href="/wallet">
            <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary/40">
              <WalletIcon className="h-3.5 w-3.5 text-primary" />
              Manage
              <ArrowRight className="h-3 w-3 opacity-60" />
            </button>
          </Link>
        </div>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Bring an existing address into the Zebvix dashboard. The same private key (or BIP39 mnemonic) you use in MetaMask works here — derivation path <code className="text-sm bg-muted px-1.5 py-0.5 rounded font-mono">m/44'/60'/0'/0/0</code>.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">Local Storage Only</div>
            <p>
              Keys are stored unencrypted in your browser's localStorage. Anyone with access to this browser can spend the funds. Use this for testing or low-value addresses only — use a hardware wallet for serious holdings.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <TabBtn active={tab === "key"} onClick={() => setTab("key")} icon={KeyRound}>
          Private Key
        </TabBtn>
        <TabBtn active={tab === "mnemonic"} onClick={() => setTab("mnemonic")} icon={FileKey2}>
          Mnemonic Phrase
        </TabBtn>
        <TabBtn active={tab === "generate"} onClick={() => setTab("generate")} icon={Sparkles}>
          Generate New
        </TabBtn>
      </div>

      {/* Tab body */}
      {tab === "key" && (
        <SectionCard title="Import via private key" icon={KeyRound} tone="primary">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Private key (hex)
              </label>
              <div className="relative">
                <input
                  value={keyHex}
                  onChange={(e) => setKeyHex(e.target.value.trim())}
                  placeholder="0x or raw 64 hex characters"
                  type={showKey ? "text" : "password"}
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-md border border-border bg-background py-2.5 pl-3 pr-11 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  type="button"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <ValidationLine
                state={keyValidation.state}
                okMessage={
                  keyValidation.state === "ok" ? (
                    <>
                      Address: <code className="ml-1 font-mono">{keyValidation.address}</code>
                    </>
                  ) : null
                }
                reason={keyValidation.state === "invalid" ? keyValidation.reason : ""}
                idleHint="MetaMask-compatible — paste the same key you use there"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Label (optional)
              </label>
              <input
                value={keyLabel}
                onChange={(e) => setKeyLabel(e.target.value)}
                placeholder="My main address"
                className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <button
              onClick={importKey}
              disabled={keyValidation.state !== "ok"}
              className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Import Address
            </button>
          </div>
        </SectionCard>
      )}

      {tab === "mnemonic" && (
        <SectionCard title="Import via BIP39 mnemonic" icon={FileKey2} tone="primary">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Recovery phrase (12 / 15 / 18 / 21 / 24 words)
              </label>
              <textarea
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="word1 word2 word3 …"
                rows={4}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="w-full resize-none rounded-md border border-border bg-background px-3 py-2.5 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <ValidationLine
                state={mnValidation.state}
                okMessage={
                  mnValidation.state === "ok" ? (
                    <>
                      {mnValidation.words}-word phrase ·{" "}
                      <code className="ml-0.5 font-mono">{mnValidation.address}</code>
                    </>
                  ) : null
                }
                reason={mnValidation.state === "invalid" ? mnValidation.reason : ""}
                idleHint="Derivation path m/44'/60'/0'/0/0 — same as MetaMask / Trust / Rabby"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Label (optional)
              </label>
              <input
                value={mnLabel}
                onChange={(e) => setMnLabel(e.target.value)}
                placeholder="My MetaMask account"
                className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <button
              onClick={importMnemonic}
              disabled={mnValidation.state !== "ok"}
              className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Import Address
            </button>
          </div>
        </SectionCard>
      )}

      {tab === "generate" && (
        <SectionCard title="Generate a fresh wallet" icon={Sparkles} tone="primary">
          <p className="mb-4 text-sm text-muted-foreground">
            Creates a brand-new secp256k1 keypair. You can export the private key from the
            <Link href="/wallet">
              <span className="px-1 text-primary underline">Wallet</span>
            </Link>
            page once created.
          </p>
          <button
            onClick={() => {
              if (!ensureVaultOrRedirect()) return;
              try {
                const w = addGenerated();
                toast({ title: "Wallet created", description: shortAddr(w.address) });
              } catch (e) {
                // Race-defense (see importKey above).
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
            }}
            className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            <Sparkles className="mr-2 inline h-4 w-4" />
            Generate New Wallet
          </button>
        </SectionCard>
      )}

      {/* Existing wallets list */}
      <SectionCard
        title={`Your wallets (${wallets.length})`}
        icon={WalletIcon}
        subtitle={
          active
            ? `Active: ${active.label} · ${shortAddr(active.address)}`
            : "No active wallet selected"
        }
      >
        {wallets.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
            No wallets yet. Import or generate one above.
          </div>
        ) : (
          <div className="space-y-2">
            {wallets.map((w) => {
              const isActive = active?.address.toLowerCase() === w.address.toLowerCase();
              return (
                <div
                  key={w.address}
                  className={`flex items-center gap-2 rounded-md border p-3 transition ${
                    isActive
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-card/40 hover:border-primary/30"
                  }`}
                >
                  <CheckCircle2
                    className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground/30"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">{w.label}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {w.address}
                    </div>
                  </div>
                  <button
                    onClick={() => copy(w.address)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Copy address"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {!isActive && (
                    <button
                      onClick={() => setActive(w.address)}
                      className="rounded border border-border px-2 py-1 text-xs font-medium text-foreground hover:border-primary/40"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${shortAddr(w.address)} from this browser?`)) {
                        remove(w.address);
                      }
                    }}
                    className="rounded p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition ${
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-card text-foreground hover:border-primary/30"
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function ValidationLine({
  state,
  okMessage,
  reason,
  idleHint,
}: {
  state: "idle" | "ok" | "invalid";
  okMessage: React.ReactNode;
  reason: string;
  idleHint: string;
}) {
  if (state === "ok") {
    return (
      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-emerald-300">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="break-all">{okMessage}</span>
      </div>
    );
  }
  if (state === "invalid") {
    return (
      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-red-400">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{reason}</span>
      </div>
    );
  }
  return <div className="mt-1.5 text-xs text-muted-foreground">{idleHint}</div>;
}
