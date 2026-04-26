import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetSite,
  useUpdateSite,
  usePublishSite,
  useDeleteSite,
  getGetSiteQueryKey,
  getListSitesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { ThemedSite } from "@/components/blocks/BlockRenderer";
import {
  ArrowLeft,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  Loader2,
  ExternalLink,
  Eye,
  BarChart3,
  Inbox,
  Banknote,
  X,
} from "lucide-react";
import {
  BLOCK_TYPES,
  defaultPropsFor,
  DEFAULT_THEME,
  type SiteBlock,
  type SiteTheme,
} from "@/lib/types";
import { toast } from "sonner";

interface SitePage {
  slug: string;
  name: string;
  blocks: SiteBlock[];
  seo: { title?: string; description?: string; ogImageUrl?: string };
}

const HOME_SLUG = "";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

const FONT_OPTIONS = [
  "Inter",
  "Plus Jakarta Sans",
  "Fraunces",
  "Playfair Display",
  "Cormorant Garamond",
  "JetBrains Mono",
  "DM Sans",
  "Space Grotesk",
];

const RADIUS_OPTIONS = ["0.125rem", "0.25rem", "0.5rem", "0.75rem", "1rem"];

function newId() {
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}

export default function Editor() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: site, isLoading } = useGetSite(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetSiteQueryKey(id) },
  });
  const update = useUpdateSite();
  const publish = usePublishSite();
  const del = useDeleteSite();

  const [title, setTitle] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [description, setDescription] = useState("");
  const [cryptoWallet, setCryptoWallet] = useState("");
  const [blocks, setBlocks] = useState<SiteBlock[]>([]);
  const [extraPages, setExtraPages] = useState<SitePage[]>([]);
  const [currentSlug, setCurrentSlug] = useState<string>(HOME_SLUG);
  const [theme, setTheme] = useState<SiteTheme>(DEFAULT_THEME);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (site && !initRef.current) {
      setTitle(site.title);
      setSubdomain(site.subdomain);
      setDescription(site.description ?? "");
      setCryptoWallet((site as unknown as { cryptoWallet?: string }).cryptoWallet ?? "");
      setBlocks(((site.blocks ?? []) as unknown[]) as SiteBlock[]);
      const ep = ((site as unknown as { extraPages?: SitePage[] }).extraPages ?? []).map(
        (p) => ({
          slug: p.slug,
          name: p.name,
          blocks: (p.blocks ?? []) as SiteBlock[],
          seo: p.seo ?? {},
        }),
      );
      setExtraPages(ep);
      setTheme(((site.theme ?? DEFAULT_THEME) as unknown) as SiteTheme);
      initRef.current = true;
    }
  }, [site]);

  const currentBlocks: SiteBlock[] = useMemo(() => {
    if (currentSlug === HOME_SLUG) return blocks;
    const page = extraPages.find((p) => p.slug === currentSlug);
    return page ? page.blocks : [];
  }, [currentSlug, blocks, extraPages]);

  function setCurrentBlocks(updater: (bs: SiteBlock[]) => SiteBlock[]) {
    if (currentSlug === HOME_SLUG) {
      setBlocks((bs) => updater(bs));
    } else {
      setExtraPages((eps) =>
        eps.map((p) => (p.slug === currentSlug ? { ...p, blocks: updater(p.blocks) } : p)),
      );
    }
  }

  const selected = useMemo(
    () => currentBlocks.find((b) => b.id === selectedId) ?? null,
    [currentBlocks, selectedId],
  );

  // When switching pages, clear selected block.
  useEffect(() => {
    setSelectedId(null);
  }, [currentSlug]);

  function moveBlock(blockId: string, dir: -1 | 1) {
    setCurrentBlocks((bs) => {
      const idx = bs.findIndex((b) => b.id === blockId);
      if (idx < 0) return bs;
      const target = idx + dir;
      if (target < 0 || target >= bs.length) return bs;
      const copy = [...bs];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  }

  function deleteBlock(blockId: string) {
    setCurrentBlocks((bs) => bs.filter((b) => b.id !== blockId));
    if (selectedId === blockId) setSelectedId(null);
  }

  function addBlock(type: string) {
    const block: SiteBlock = {
      id: newId(),
      type,
      props: defaultPropsFor(type),
    };
    setCurrentBlocks((bs) => [...bs, block]);
    setSelectedId(block.id);
  }

  function updateSelectedProps(patch: Record<string, unknown>) {
    if (!selected) return;
    setCurrentBlocks((bs) =>
      bs.map((b) =>
        b.id === selected.id ? { ...b, props: { ...b.props, ...patch } } : b,
      ),
    );
  }

  function addPage() {
    const raw = window.prompt("New page name (e.g. About, Pricing, Contact):");
    if (!raw) return;
    const name = raw.trim();
    if (!name) return;
    const baseSlug = slugify(name) || "page";
    let slug = baseSlug;
    let n = 2;
    const used = new Set(extraPages.map((p) => p.slug));
    while (used.has(slug) || slug === "home") {
      slug = `${baseSlug}-${n++}`;
    }
    const newPage: SitePage = {
      slug,
      name,
      blocks: [],
      seo: { title: `${name} — ${title}`, description },
    };
    setExtraPages((eps) => [...eps, newPage]);
    setCurrentSlug(slug);
  }

  function removePage(slug: string) {
    if (!confirm(`Delete page "${slug}"? This is permanent.`)) return;
    setExtraPages((eps) => eps.filter((p) => p.slug !== slug));
    if (currentSlug === slug) setCurrentSlug(HOME_SLUG);
  }

  async function save() {
    if (!Number.isFinite(id)) return;
    try {
      await update.mutateAsync({
        id,
        data: {
          title,
          subdomain,
          description,
          cryptoWallet,
          blocks: blocks as never,
          extraPages: extraPages as never,
          theme: theme as never,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetSiteQueryKey(id) });
      await queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function togglePublish(next: boolean) {
    try {
      await publish.mutateAsync({ id, data: { published: next } });
      await queryClient.invalidateQueries({ queryKey: getGetSiteQueryKey(id) });
      await queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
      toast.success(next ? "Published" : "Unpublished");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    }
  }

  async function deleteSite() {
    if (!confirm("Delete this site permanently?")) return;
    try {
      await del.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
      setLocation("/dashboard");
      toast.success("Site deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (isLoading || !site) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin opacity-60" />
        </div>
      </AppShell>
    );
  }

  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
  const publicUrl = `${baseUrl}/p/${subdomain}`;

  return (
    <AppShell>
      <div className="border-b border-white/10 px-4 py-3">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 flex-wrap">
          <button
            onClick={() => setLocation("/dashboard")}
            className="text-sm opacity-60 hover:opacity-100 inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Site title"
            className="w-64"
          />
          <div className="flex items-center text-sm opacity-60">/p/</div>
          <Input
            value={subdomain}
            onChange={(e) =>
              setSubdomain(
                e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
              )
            }
            placeholder="subdomain"
            className="w-48"
          />
          <div className="ml-auto flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation(`/sites/${id}/leads`)}
            >
              <Inbox className="mr-1 h-4 w-4" /> Leads
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation(`/sites/${id}/payments`)}
            >
              <Banknote className="mr-1 h-4 w-4" /> Payments
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation(`/sites/${id}/analytics`)}
            >
              <BarChart3 className="mr-1 h-4 w-4" /> Analytics
            </Button>
            <div className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5">
              <Switch
                checked={site.published}
                onCheckedChange={togglePublish}
                disabled={publish.isPending}
              />
              <span className="text-sm">
                {site.published ? "Published" : "Draft"}
              </span>
            </div>
            {site.published ? (
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-sm hover:border-white/30"
              >
                <ExternalLink className="h-3 w-3" /> View
              </a>
            ) : null}
            <Button
              size="sm"
              onClick={save}
              disabled={update.isPending}
              className="bg-[#00F0FF] text-black hover:bg-[#00F0FF]/90"
            >
              {update.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[280px_1fr_320px] min-h-[calc(100vh-128px)]">
        <aside className="border-r border-white/10 p-4 overflow-y-auto">
          <div className="mb-3">
            <div className="text-xs uppercase tracking-wider opacity-60 mb-2">
              Pages
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setCurrentSlug(HOME_SLUG)}
                className={`group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                  currentSlug === HOME_SLUG
                    ? "border-[#00F0FF] bg-[#00F0FF]/10 text-[#00F0FF]"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                Home
              </button>
              {extraPages.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => setCurrentSlug(p.slug)}
                  className={`group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                    currentSlug === p.slug
                      ? "border-[#00F0FF] bg-[#00F0FF]/10 text-[#00F0FF]"
                      : "border-white/10 hover:border-white/30"
                  }`}
                >
                  {p.name}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Delete page ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removePage(p.slug);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        removePage(p.slug);
                      }
                    }}
                    className="opacity-50 hover:opacity-100 cursor-pointer rounded p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              ))}
              <button
                onClick={addPage}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/20 px-2.5 py-1 text-xs opacity-70 hover:opacity-100"
              >
                <Plus className="h-3 w-3" /> Page
              </button>
            </div>
          </div>
          <div className="mb-3 flex items-center justify-between border-t border-white/10 pt-3">
            <div className="text-sm font-semibold">
              Blocks
              <span className="ml-1 text-xs font-normal opacity-50">
                ({currentSlug === HOME_SLUG ? "Home" : extraPages.find((p) => p.slug === currentSlug)?.name ?? currentSlug})
              </span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-auto">
                {BLOCK_TYPES.map((bt) => (
                  <DropdownMenuItem key={bt.type} onClick={() => addBlock(bt.type)}>
                    {bt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="space-y-1">
            {currentBlocks.map((b, i) => (
              <div
                key={b.id}
                className={`group rounded-md border px-3 py-2 cursor-pointer text-sm flex items-center gap-2 ${
                  selectedId === b.id
                    ? "border-[#00F0FF] bg-[#00F0FF]/10"
                    : "border-white/10 hover:border-white/30"
                }`}
                onClick={() => setSelectedId(b.id)}
              >
                <div className="text-xs opacity-50">{i + 1}</div>
                <div className="flex-1 truncate">{b.type}</div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveBlock(b.id, -1);
                  }}
                  className="opacity-0 group-hover:opacity-60 hover:opacity-100"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveBlock(b.id, 1);
                  }}
                  className="opacity-0 group-hover:opacity-60 hover:opacity-100"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteBlock(b.id);
                  }}
                  className="opacity-0 group-hover:opacity-60 hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            {currentBlocks.length === 0 ? (
              <div className="text-center text-xs opacity-50 py-8">
                No blocks yet. Add one above.
              </div>
            ) : null}
          </div>
        </aside>

        <main className="overflow-y-auto bg-neutral-950">
          <div className="m-4 rounded-2xl border border-white/10 overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-4 py-2 text-xs opacity-60">
              <div className="flex items-center gap-2">
                <Eye className="h-3 w-3" /> Live preview
              </div>
              <div className="opacity-70">
                {currentSlug === HOME_SLUG
                  ? "/"
                  : `/${currentSlug}`}
              </div>
            </div>
            <div>
              <ThemedSite
                blocks={currentBlocks}
                theme={theme}
                siteId={id}
                ownerWallet={cryptoWallet}
                isPreview
              />
            </div>
          </div>
        </main>

        <aside className="border-l border-white/10 p-4 overflow-y-auto">
          <Tabs defaultValue="block">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="block">Block</TabsTrigger>
              <TabsTrigger value="theme">Theme</TabsTrigger>
              <TabsTrigger value="site">Site</TabsTrigger>
            </TabsList>
            <TabsContent value="block" className="mt-4">
              {selected ? (
                <BlockEditor
                  block={selected}
                  onChange={updateSelectedProps}
                />
              ) : (
                <div className="text-sm opacity-60 text-center py-8">
                  Select a block to edit its properties.
                </div>
              )}
            </TabsContent>
            <TabsContent value="theme" className="mt-4 space-y-4">
              <ThemeField label="Mode">
                <select
                  value={theme.mode}
                  onChange={(e) =>
                    setTheme({ ...theme, mode: e.target.value as "light" | "dark" })
                  }
                  className="w-full bg-black border border-white/10 rounded-md px-2 py-1.5 text-sm"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </ThemeField>
              <ColorField
                label="Primary"
                value={theme.primaryColor}
                onChange={(v) => setTheme({ ...theme, primaryColor: v })}
              />
              <ColorField
                label="Accent"
                value={theme.accentColor}
                onChange={(v) => setTheme({ ...theme, accentColor: v })}
              />
              <ColorField
                label="Background"
                value={theme.backgroundColor}
                onChange={(v) => setTheme({ ...theme, backgroundColor: v })}
              />
              <ColorField
                label="Text"
                value={theme.textColor}
                onChange={(v) => setTheme({ ...theme, textColor: v })}
              />
              <ThemeField label="Font">
                <select
                  value={theme.fontFamily}
                  onChange={(e) =>
                    setTheme({ ...theme, fontFamily: e.target.value })
                  }
                  className="w-full bg-black border border-white/10 rounded-md px-2 py-1.5 text-sm"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </ThemeField>
              <ThemeField label="Radius">
                <select
                  value={theme.radius}
                  onChange={(e) => setTheme({ ...theme, radius: e.target.value })}
                  className="w-full bg-black border border-white/10 rounded-md px-2 py-1.5 text-sm"
                >
                  {RADIUS_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </ThemeField>
            </TabsContent>
            <TabsContent value="site" className="mt-4 space-y-4">
              <ThemeField label="Description">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </ThemeField>
              <ThemeField label="Owner wallet (for crypto checkout)">
                <Input
                  value={cryptoWallet}
                  onChange={(e) => setCryptoWallet(e.target.value)}
                  placeholder="0x..."
                  spellCheck={false}
                />
              </ThemeField>
              <Button
                variant="destructive"
                onClick={deleteSite}
                disabled={del.isPending}
                className="w-full"
              >
                Delete site
              </Button>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </AppShell>
  );
}

function ThemeField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wider opacity-60">{label}</div>
      {children}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <ThemeField label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 rounded border border-white/10 cursor-pointer bg-transparent"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </div>
    </ThemeField>
  );
}

function BlockEditor({
  block,
  onChange,
}: {
  block: SiteBlock;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  // Render a known field per block type, plus a JSON fallback for full power.
  const t = block.type;
  return (
    <div className="space-y-4">
      <div className="text-xs uppercase tracking-wider opacity-60">{t}</div>
      {t === "hero" && (
        <>
          <Field label="Eyebrow">
            <Input
              value={(block.props.eyebrow as string) ?? ""}
              onChange={(e) => onChange({ eyebrow: e.target.value })}
            />
          </Field>
          <Field label="Headline">
            <Textarea
              rows={2}
              value={(block.props.headline as string) ?? ""}
              onChange={(e) => onChange({ headline: e.target.value })}
            />
          </Field>
          <Field label="Subhead">
            <Textarea
              rows={2}
              value={(block.props.subhead as string) ?? ""}
              onChange={(e) => onChange({ subhead: e.target.value })}
            />
          </Field>
        </>
      )}
      {t === "nav" && (
        <Field label="Brand name">
          <Input
            value={(block.props.brandName as string) ?? ""}
            onChange={(e) => onChange({ brandName: e.target.value })}
          />
        </Field>
      )}
      {t === "cta" && (
        <>
          <Field label="Headline">
            <Input
              value={(block.props.headline as string) ?? ""}
              onChange={(e) => onChange({ headline: e.target.value })}
            />
          </Field>
          <Field label="Subhead">
            <Input
              value={(block.props.subhead as string) ?? ""}
              onChange={(e) => onChange({ subhead: e.target.value })}
            />
          </Field>
        </>
      )}
      {t === "text" && (
        <Field label="Markdown">
          <Textarea
            rows={8}
            value={(block.props.markdown as string) ?? ""}
            onChange={(e) => onChange({ markdown: e.target.value })}
          />
        </Field>
      )}
      {t === "crypto_checkout" && (
        <>
          <Field label="Product name">
            <Input
              value={(block.props.productName as string) ?? ""}
              onChange={(e) => onChange({ productName: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <Textarea
              rows={2}
              value={(block.props.description as string) ?? ""}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Asset">
              <select
                value={(block.props.asset as string) ?? "zusd"}
                onChange={(e) => onChange({ asset: e.target.value })}
                className="w-full bg-black border border-white/10 rounded-md px-2 py-1.5 text-sm"
              >
                <option value="zbx">ZBX</option>
                <option value="zusd">zUSD</option>
                <option value="bnb">BNB</option>
              </select>
            </Field>
            <Field label="Amount">
              <Input
                value={(block.props.amount as string) ?? ""}
                onChange={(e) => onChange({ amount: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Button label">
            <Input
              value={(block.props.buttonLabel as string) ?? ""}
              onChange={(e) => onChange({ buttonLabel: e.target.value })}
            />
          </Field>
        </>
      )}
      <details className="border border-white/10 rounded-md">
        <summary className="cursor-pointer px-3 py-2 text-xs opacity-70">
          Raw JSON
        </summary>
        <Textarea
          rows={10}
          className="font-mono text-xs"
          value={JSON.stringify(block.props, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              onChange(parsed);
            } catch {
              // ignore parse errors while typing
            }
          }}
        />
      </details>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wider opacity-60">{label}</div>
      {children}
    </div>
  );
}
