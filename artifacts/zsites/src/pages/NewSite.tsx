import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  useGenerateSiteWithAi,
  useCreateSite,
} from "@workspace/api-client-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, ArrowRight, RefreshCw, ArrowLeft } from "lucide-react";
import { ThemedSite } from "@/components/blocks/BlockRenderer";
import { DEFAULT_THEME } from "@/lib/types";
import type { SiteBlock, SiteTheme } from "@/lib/types";
import { toast } from "sonner";

const CATEGORIES = [
  { slug: "saas", label: "SaaS" },
  { slug: "nft", label: "NFT" },
  { slug: "agency", label: "Agency" },
  { slug: "restaurant", label: "Restaurant" },
  { slug: "portfolio", label: "Portfolio" },
];

const LOADING_STAGES = [
  "Reading your brief...",
  "Choosing a brand identity...",
  "Composing your hero...",
  "Picking a palette...",
  "Drafting your features...",
  "Writing real testimonials...",
  "Wiring up crypto checkout...",
  "Polishing every block...",
];

interface SitePageDraft {
  slug: string;
  name: string;
  blocks: SiteBlock[];
  seo?: { title?: string; description?: string; ogImageUrl?: string };
}

interface DraftPayload {
  title: string;
  description: string;
  blocks: SiteBlock[];
  extraPages?: SitePageDraft[];
  theme: SiteTheme;
  seo: { title: string; description: string; ogImageUrl?: string };
  suggestedSubdomain: string;
}

export default function NewSite() {
  const [, setLocation] = useLocation();
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<string>("saas");
  const [draft, setDraft] = useState<DraftPayload | null>(null);
  const [stage, setStage] = useState(0);
  const generate = useGenerateSiteWithAi();
  const create = useCreateSite();

  async function runGenerate() {
    if (prompt.trim().length < 8) {
      toast.error("Add at least a sentence about your business.");
      return;
    }
    setDraft(null);
    setStage(0);
    const tick = setInterval(() => {
      setStage((s) => Math.min(s + 1, LOADING_STAGES.length - 1));
    }, 900);
    try {
      const result = await generate.mutateAsync({
        data: { prompt, category },
      });
      setDraft(result as unknown as DraftPayload);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      clearInterval(tick);
    }
  }

  async function useThisDraft() {
    if (!draft) return;
    try {
      const created = await create.mutateAsync({
        data: {
          title: draft.title,
          subdomain: draft.suggestedSubdomain,
          description: draft.description,
          blocks: draft.blocks as never,
          extraPages: (draft.extraPages ?? []) as never,
          theme: draft.theme as never,
          seo: draft.seo as never,
        },
      });
      toast.success("Site created");
      setLocation(`/editor/${created.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save";
      toast.error(msg);
    }
  }

  return (
    <AppShell>
      <div className="flex-1 px-4 md:px-8 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <button
              onClick={() => setLocation("/dashboard")}
              className="text-sm opacity-60 hover:opacity-100 inline-flex items-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" /> Back to dashboard
            </button>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">
                Describe your business.
              </h1>
              <p className="mt-2 text-muted-foreground">
                One or two sentences is enough. We'll do the rest.
              </p>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A wood-fire pizza spot in the Mission, ten tables, two seatings nightly. Should feel warm and unpretentious."
                rows={6}
                className="mt-6 text-base"
              />
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Pick a category
                </div>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.slug}
                      onClick={() => setCategory(c.slug)}
                      className={`rounded-full border px-4 py-1.5 text-sm transition ${
                        category === c.slug
                          ? "border-[#00F0FF] bg-[#00F0FF]/10 text-[#00F0FF]"
                          : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <Button
                size="lg"
                className="mt-8 w-full bg-[#00F0FF] text-black hover:bg-[#00F0FF]/90"
                onClick={runGenerate}
                disabled={generate.isPending}
              >
                {generate.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate site
                  </>
                )}
              </Button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/40 p-6 min-h-[480px] flex items-center justify-center overflow-hidden">
              <AnimatePresence mode="wait">
                {generate.isPending ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center"
                  >
                    <Loader2 className="mx-auto mb-6 h-10 w-10 animate-spin text-[#00F0FF]" />
                    <div className="text-lg font-medium">
                      {LOADING_STAGES[stage]}
                    </div>
                    <div className="mt-6 w-64 h-1 bg-white/5 rounded mx-auto overflow-hidden">
                      <div
                        className="h-full bg-[#00F0FF] transition-all"
                        style={{
                          width: `${((stage + 1) / LOADING_STAGES.length) * 100}%`,
                        }}
                      />
                    </div>
                  </motion.div>
                ) : draft ? (
                  <motion.div
                    key="draft"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full"
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <div className="text-sm opacity-60">Draft preview</div>
                        <div className="text-xl font-semibold">{draft.title}</div>
                        <div className="text-xs opacity-60">
                          {draft.blocks.length} blocks · /p/{draft.suggestedSubdomain}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div
                          className="h-6 w-6 rounded-full border border-white/20"
                          style={{ background: draft.theme.primaryColor }}
                        />
                        <div
                          className="h-6 w-6 rounded-full border border-white/20"
                          style={{ background: draft.theme.accentColor }}
                        />
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 max-h-[420px] overflow-auto">
                      <div className="origin-top-left scale-[0.55] w-[182%]">
                        <ThemedSite
                          blocks={draft.blocks}
                          theme={draft.theme}
                          siteId={0}
                          isPreview
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button variant="outline" onClick={runGenerate} className="flex-1">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Regenerate
                      </Button>
                      <Button
                        onClick={useThisDraft}
                        className="flex-1 bg-[#00F0FF] text-black hover:bg-[#00F0FF]/90"
                        disabled={create.isPending}
                      >
                        Use this draft
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center text-sm opacity-50"
                  >
                    <Sparkles className="mx-auto mb-3 h-8 w-8" />
                    Your draft will appear here.
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
