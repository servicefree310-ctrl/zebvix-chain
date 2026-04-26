import { useEffect, useMemo, useRef } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetPublicSiteBySubdomain,
  getGetPublicSiteBySubdomainQueryKey,
  useTrackPageView,
} from "@workspace/api-client-react";
import { ThemedSite } from "@/components/blocks/BlockRenderer";
import { Loader2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SitePage {
  slug: string;
  name: string;
  blocks: unknown[];
  seo?: { title?: string; description?: string };
}

export default function PublicSite() {
  const params = useParams<{ subdomain: string; page?: string }>();
  const subdomain = params.subdomain ?? "";
  const pageSlug = (params.page ?? "").toLowerCase();
  const [, setLocation] = useLocation();
  const { data, isLoading, isError } = useGetPublicSiteBySubdomain(
    subdomain,
    {
      query: {
        enabled: !!subdomain,
        queryKey: getGetPublicSiteBySubdomainQueryKey(subdomain),
      },
    },
  );
  const track = useTrackPageView();
  const trackedRef = useRef<string | null>(null);

  const extraPages = useMemo<SitePage[]>(
    () => (((data as unknown as { extraPages?: SitePage[] })?.extraPages) ?? []),
    [data],
  );

  const currentPage = useMemo<SitePage | null>(() => {
    if (!data) return null;
    if (!pageSlug) {
      return {
        slug: "",
        name: "Home",
        blocks: (data.blocks ?? []) as unknown[],
        seo: data.seo as { title?: string; description?: string } | undefined,
      };
    }
    return extraPages.find((p) => p.slug === pageSlug) ?? null;
  }, [data, pageSlug, extraPages]);

  useEffect(() => {
    if (!data || !currentPage) return;
    const key = `${data.id}:${currentPage.slug || "/"}`;
    if (trackedRef.current === key) return;
    trackedRef.current = key;
    track.mutate({
      siteId: data.id,
      data: {
        path: currentPage.slug ? `/${currentPage.slug}` : "/",
        referrer: document.referrer || undefined,
      },
    });
    if (currentPage.seo?.title) document.title = currentPage.seo.title;
    else if (data.title) document.title = data.title;
  }, [data, currentPage, track]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <Loader2 className="h-6 w-6 animate-spin opacity-60" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white px-6">
        <div className="text-center max-w-md">
          <Globe className="mx-auto mb-4 h-10 w-10 opacity-40" />
          <h1 className="text-2xl font-bold">Site not found</h1>
          <p className="mt-2 text-sm opacity-60">
            This site might be unpublished or the address is wrong.
          </p>
          <Button
            className="mt-6 bg-[#00F0FF] text-black hover:bg-[#00F0FF]/90"
            onClick={() => setLocation("/")}
          >
            Build your own with Zebvix Sites
          </Button>
        </div>
      </div>
    );
  }
  if (pageSlug && !currentPage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white px-6">
        <div className="text-center max-w-md">
          <Globe className="mx-auto mb-4 h-10 w-10 opacity-40" />
          <h1 className="text-2xl font-bold">Page not found</h1>
          <p className="mt-2 text-sm opacity-60">
            "/{pageSlug}" doesn't exist on this site.
          </p>
          <Button
            className="mt-6 bg-[#00F0FF] text-black hover:bg-[#00F0FF]/90"
            onClick={() => setLocation(`/p/${subdomain}`)}
          >
            Go to home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ThemedSite
      blocks={(currentPage!.blocks ?? []) as never}
      theme={(data.theme ?? {}) as never}
      siteId={data.id}
      ownerWallet={(data as unknown as { cryptoWallet?: string }).cryptoWallet}
      siteSubdomain={subdomain}
    />
  );
}
