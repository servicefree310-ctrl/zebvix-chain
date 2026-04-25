import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  Info,
  RefreshCw,
  Loader2,
  CheckCircle2,
  ExternalLink,
  AlertTriangle,
  Image as ImageIcon,
  Globe,
  Twitter,
  Send,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  loadWallets,
  getActiveAddress,
  getWallet,
  recordTx,
  type StoredWallet,
} from "@/lib/web-wallet";
import {
  listTokens,
  getTokenMetadata,
  sendTokenSetMetadata,
  type TokenInfo,
  type TokenMetadata,
  TOKEN_META_LOGO_MAX_LEN,
  TOKEN_META_WEBSITE_MAX_LEN,
  TOKEN_META_DESCRIPTION_MAX_LEN,
  TOKEN_META_SOCIAL_MAX_LEN,
} from "@/lib/tokens";
import { Link } from "wouter";

// ────────────────────────────────────────────────────────────────────────────
// Token Metadata page (Phase G)
//
// Lets a token's creator attach a logo URL, website, description, and social
// links (twitter / telegram / discord) to their ZBX-20 token. The chain
// enforces creator-only auth and field length caps; we mirror the caps here
// so the user gets instant feedback before paying a fee.
// ────────────────────────────────────────────────────────────────────────────

function explorerUrl(hash: string): string {
  return `/block-explorer?tx=${hash}`;
}

interface MetaWalletState {
  address: string;
  privateKeyHex: string;
}

function loadActiveWallet(): MetaWalletState | null {
  const wallets = loadWallets();
  if (!wallets.length) return null;
  const active = getActiveAddress();
  const w: StoredWallet | undefined =
    (active ? getWallet(active) : undefined) ?? wallets[0];
  if (!w) return null;
  return { address: w.address, privateKeyHex: w.privateKey };
}

function eqAddr(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

interface FormState {
  logoUrl: string;
  website: string;
  description: string;
  twitter: string;
  telegram: string;
  discord: string;
}

const EMPTY_FORM: FormState = {
  logoUrl: "",
  website: "",
  description: "",
  twitter: "",
  telegram: "",
  discord: "",
};

function metaToForm(m: TokenMetadata | null | undefined): FormState {
  if (!m) return { ...EMPTY_FORM };
  return {
    logoUrl:     m.logo_url     ?? "",
    website:     m.website      ?? "",
    description: m.description  ?? "",
    twitter:     m.twitter      ?? "",
    telegram:    m.telegram     ?? "",
    discord:     m.discord      ?? "",
  };
}

export default function TokenMetadataPage(): React.ReactElement {
  const { toast } = useToast();
  const [wallet, setWallet] = useState<MetaWalletState | null>(null);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [meta, setMeta] = useState<TokenMetadata | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [lastHash, setLastHash] = useState<string | null>(null);

  // Initial wallet + token list load.
  useEffect(() => {
    setWallet(loadActiveWallet());
    void refreshTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshTokens = useCallback(async () => {
    setTokensLoading(true);
    try {
      const resp = await listTokens(0, 500);
      setTokens(resp.tokens ?? []);
    } catch (e) {
      toast({
        title: "Tokens load fail",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setTokensLoading(false);
    }
  }, [toast]);

  // Tokens that THIS wallet created — only these are editable on-chain.
  const myTokens = useMemo(() => {
    if (!wallet) return [];
    return tokens.filter((t) => eqAddr(t.creator, wallet.address));
  }, [tokens, wallet]);

  // Auto-select the first creator-owned token on first load.
  useEffect(() => {
    if (selectedId !== null) return;
    if (myTokens.length > 0) {
      setSelectedId(myTokens[0].id);
    }
  }, [myTokens, selectedId]);

  // Whenever selection changes, fetch its metadata and seed the form.
  useEffect(() => {
    if (selectedId === null) {
      setMeta(null);
      setForm({ ...EMPTY_FORM });
      return;
    }
    let cancelled = false;
    (async () => {
      setMetaLoading(true);
      try {
        const m = await getTokenMetadata(selectedId);
        if (cancelled) return;
        setMeta(m);
        // Seed form from existing on-chain values (or empty if `unset`).
        setForm(metaToForm(m.unset ? null : m));
      } catch (e) {
        if (!cancelled) {
          toast({
            title: "Metadata load fail",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
          setMeta(null);
          setForm({ ...EMPTY_FORM });
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, toast]);

  const selectedToken = useMemo(
    () => tokens.find((t) => t.id === selectedId) ?? null,
    [tokens, selectedId],
  );
  const isCreator = useMemo(
    () => !!(wallet && selectedToken && eqAddr(wallet.address, selectedToken.creator)),
    [wallet, selectedToken],
  );

  // Per-field length validation — mirrors the chain caps so the user
  // sees the error before broadcasting and burning a fee.
  const fieldLimits: Array<{ key: keyof FormState; max: number; label: string }> = [
    { key: "logoUrl",     max: TOKEN_META_LOGO_MAX_LEN,        label: "Logo URL" },
    { key: "website",     max: TOKEN_META_WEBSITE_MAX_LEN,     label: "Website" },
    { key: "description", max: TOKEN_META_DESCRIPTION_MAX_LEN, label: "Description" },
    { key: "twitter",     max: TOKEN_META_SOCIAL_MAX_LEN,      label: "Twitter" },
    { key: "telegram",    max: TOKEN_META_SOCIAL_MAX_LEN,      label: "Telegram" },
    { key: "discord",     max: TOKEN_META_SOCIAL_MAX_LEN,      label: "Discord" },
  ];

  const oversized = fieldLimits.find((f) => (form[f.key] || "").length > f.max) ?? null;

  const handleSubmit = async (): Promise<void> => {
    if (!wallet || !selectedToken) return;
    if (!isCreator) {
      toast({
        title: "Not allowed",
        description: "Bhai, sirf token creator hi metadata set kar sakta hai.",
        variant: "destructive",
      });
      return;
    }
    if (oversized) {
      toast({
        title: `${oversized.label} too long`,
        description: `Max ${oversized.max} chars; trim and try again.`,
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    setLastHash(null);
    try {
      const res = await sendTokenSetMetadata({
        privateKeyHex: wallet.privateKeyHex,
        tokenId:       selectedToken.id,
        logoUrl:       form.logoUrl,
        website:       form.website,
        description:   form.description,
        twitter:       form.twitter,
        telegram:      form.telegram,
        discord:       form.discord,
      });
      setLastHash(res.hash);
      try {
        recordTx({
          hash:      res.hash,
          from:      wallet.address,
          to:        wallet.address,
          amountZbx: "0",
          feeZbx:    "0",
          ts:        Date.now(),
          status:    "submitted",
          kind:      "native",
        });
      } catch {/* non-fatal */}
      toast({
        title: "Metadata submitted",
        description: `Tx ${res.hash.slice(0, 10)}… broadcasted. Refresh after a block.`,
      });
      // Re-read after a short delay so the user sees the persisted record.
      setTimeout(() => {
        if (selectedId !== null) {
          getTokenMetadata(selectedId)
            .then((m) => { setMeta(m); setForm(metaToForm(m.unset ? null : m)); })
            .catch(() => {/* keep current form */});
        }
      }, 2500);
    } catch (e) {
      toast({
        title: "Submit fail",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-5xl space-y-6">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Info className="w-6 h-6 text-primary" />
            Token Metadata
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Logo, website, description aur socials on-chain set karo. Sirf token
            creator wallet hi edit kar sakti hai. Empty fields chhodne se
            existing values clear ho jayengi.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshTokens()}
          disabled={tokensLoading}
          data-testid="button-refresh-tokens"
        >
          {tokensLoading
            ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            : <RefreshCw className="w-4 h-4 mr-1" />}
          Refresh
        </Button>
      </header>

      {!wallet && (
        <Card className="p-4 border-yellow-600/50 bg-yellow-950/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
            <div className="text-sm">
              No active wallet found.{" "}
              <Link href="/web-wallet" className="text-primary underline">
                Open the wallet page
              </Link>{" "}
              and create or import one before editing metadata.
            </div>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="text-sm font-semibold mb-2">Your tokens</div>
        {tokensLoading ? (
          <div className="text-sm text-muted-foreground">Loading tokens…</div>
        ) : myTokens.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            This wallet hasn't created any tokens yet.{" "}
            <Link href="/token-create" className="text-primary underline">
              Create one first
            </Link>.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {myTokens.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={selectedId === t.id ? "default" : "outline"}
                onClick={() => setSelectedId(t.id)}
                data-testid={`button-select-token-${t.id}`}
              >
                <span className="font-mono mr-1">#{t.id}</span>
                {t.symbol || t.name || "?"}
              </Button>
            ))}
          </div>
        )}
      </Card>

      {selectedToken && (
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-lg font-semibold">
                {selectedToken.name}{" "}
                <span className="text-muted-foreground">({selectedToken.symbol})</span>
              </div>
              <div className="text-xs text-muted-foreground font-mono break-all">
                Token ID #{selectedToken.id} · creator {selectedToken.creator}
              </div>
            </div>
            {meta && !meta.unset ? (
              <Badge variant="secondary">
                Updated at block #{meta.updated_at_height}
              </Badge>
            ) : (
              <Badge variant="outline">Not set</Badge>
            )}
          </div>

          {!isCreator && (
            <div className="text-xs text-yellow-500 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              You are not the creator of this token. Form is read-only.
            </div>
          )}

          {metaLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading metadata…
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldRow
                icon={<ImageIcon className="w-4 h-4" />}
                label="Logo URL"
                value={form.logoUrl}
                max={TOKEN_META_LOGO_MAX_LEN}
                placeholder="https://example.com/logo.png"
                disabled={!isCreator || submitting}
                onChange={(v) => setForm({ ...form, logoUrl: v })}
                testId="input-logo-url"
              />
              <FieldRow
                icon={<Globe className="w-4 h-4" />}
                label="Website"
                value={form.website}
                max={TOKEN_META_WEBSITE_MAX_LEN}
                placeholder="https://yourtoken.xyz"
                disabled={!isCreator || submitting}
                onChange={(v) => setForm({ ...form, website: v })}
                testId="input-website"
              />
              <div className="md:col-span-2">
                <label className="text-xs font-semibold flex items-center gap-1 mb-1">
                  <Info className="w-4 h-4" /> Description
                  <span className="ml-auto text-muted-foreground font-normal">
                    {form.description.length}/{TOKEN_META_DESCRIPTION_MAX_LEN}
                  </span>
                </label>
                <textarea
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
                  rows={4}
                  placeholder="Short description shown in wallets and explorers."
                  value={form.description}
                  disabled={!isCreator || submitting}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  data-testid="input-description"
                />
              </div>
              <FieldRow
                icon={<Twitter className="w-4 h-4" />}
                label="Twitter"
                value={form.twitter}
                max={TOKEN_META_SOCIAL_MAX_LEN}
                placeholder="@handle or full URL"
                disabled={!isCreator || submitting}
                onChange={(v) => setForm({ ...form, twitter: v })}
                testId="input-twitter"
              />
              <FieldRow
                icon={<Send className="w-4 h-4" />}
                label="Telegram"
                value={form.telegram}
                max={TOKEN_META_SOCIAL_MAX_LEN}
                placeholder="t.me/yourgroup"
                disabled={!isCreator || submitting}
                onChange={(v) => setForm({ ...form, telegram: v })}
                testId="input-telegram"
              />
              <FieldRow
                icon={<MessageCircle className="w-4 h-4" />}
                label="Discord"
                value={form.discord}
                max={TOKEN_META_SOCIAL_MAX_LEN}
                placeholder="discord.gg/invite"
                disabled={!isCreator || submitting}
                onChange={(v) => setForm({ ...form, discord: v })}
                testId="input-discord"
              />
            </div>
          )}

          {oversized && (
            <div className="text-xs text-red-500 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {oversized.label} is too long ({form[oversized.key].length}/{oversized.max}).
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={() => void handleSubmit()}
              disabled={!isCreator || submitting || !!oversized || !wallet}
              data-testid="button-submit-metadata"
            >
              {submitting
                ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                : <CheckCircle2 className="w-4 h-4 mr-1" />}
              Save metadata on-chain
            </Button>
            {lastHash && (
              <Link
                href={explorerUrl(lastHash)}
                className="text-xs text-primary underline flex items-center gap-1"
                data-testid="link-last-tx"
              >
                Last tx <ExternalLink className="w-3 h-3" />
              </Link>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

interface FieldRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  max: number;
  placeholder?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  testId: string;
}

function FieldRow({ icon, label, value, max, placeholder, disabled, onChange, testId }: FieldRowProps): React.ReactElement {
  return (
    <div>
      <label className="text-xs font-semibold flex items-center gap-1 mb-1">
        {icon} {label}
        <span className="ml-auto text-muted-foreground font-normal">
          {value.length}/{max}
        </span>
      </label>
      <Input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
    </div>
  );
}
