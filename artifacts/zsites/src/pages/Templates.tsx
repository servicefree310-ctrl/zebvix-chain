import { useLocation } from "wouter";
import {
  useListSiteTemplates,
  useCreateSite,
} from "@workspace/api-client-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight } from "lucide-react";
import { ThemedSite } from "@/components/blocks/BlockRenderer";
import { toast } from "sonner";

export default function Templates() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useListSiteTemplates();
  const create = useCreateSite();

  async function clone(slug: string) {
    const tpl = (data ?? []).find((t) => t.slug === slug);
    if (!tpl) return;
    const draft = (tpl as unknown as { draft: never }).draft as {
      title: string;
      description: string;
      blocks: unknown[];
      theme: unknown;
      seo: unknown;
      suggestedSubdomain: string;
    };
    try {
      const suffix = Math.random().toString(36).slice(2, 6);
      const created = await create.mutateAsync({
        data: {
          title: draft.title,
          subdomain: `${draft.suggestedSubdomain}-${suffix}`,
          description: draft.description,
          blocks: draft.blocks as never,
          theme: draft.theme as never,
          seo: draft.seo as never,
        },
      });
      toast.success("Template cloned");
      setLocation(`/editor/${created.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Clone failed");
    }
  }

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <h1 className="text-4xl font-bold tracking-tight">Templates</h1>
            <p className="mt-2 text-muted-foreground">
              Start from a polished, ready-to-publish base.
            </p>
          </div>
          {isLoading ? (
            <div className="flex h-60 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin opacity-60" />
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {(data ?? []).map((tpl) => {
                const draft = (tpl as unknown as { draft: never }).draft as {
                  blocks: never[];
                  theme: never;
                };
                return (
                  <div
                    key={tpl.slug}
                    className="overflow-hidden rounded-2xl border border-white/10 bg-black/40"
                  >
                    <div className="h-72 overflow-hidden border-b border-white/10">
                      <div className="origin-top-left scale-[0.55] w-[182%] pointer-events-none select-none">
                        <ThemedSite
                          blocks={draft.blocks}
                          theme={draft.theme}
                          siteId={0}
                          isPreview
                        />
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="text-xs uppercase tracking-wider text-[#00F0FF]">
                        {tpl.category}
                      </div>
                      <div className="mt-1 text-lg font-semibold">{tpl.name}</div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {tpl.description}
                      </p>
                      <Button
                        className="mt-4 bg-[#00F0FF] text-black hover:bg-[#00F0FF]/90"
                        onClick={() => clone(tpl.slug)}
                        disabled={create.isPending}
                      >
                        Use this template
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
