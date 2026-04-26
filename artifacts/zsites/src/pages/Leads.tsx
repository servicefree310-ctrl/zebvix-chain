import { useParams, useLocation } from "wouter";
import {
  useGetSite,
  useListLeadsForSite,
  getGetSiteQueryKey,
  getListLeadsForSiteQueryKey,
} from "@workspace/api-client-react";
import { AppShell } from "@/components/layout/AppShell";
import { ArrowLeft, Inbox, Loader2 } from "lucide-react";

export default function Leads() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { data: site } = useGetSite(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetSiteQueryKey(id) },
  });
  const { data: leads, isLoading } = useListLeadsForSite(id, {
    query: { enabled: Number.isFinite(id), queryKey: getListLeadsForSiteQueryKey(id) },
  });

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-12">
        <div className="mx-auto max-w-5xl">
          <button
            onClick={() => setLocation(`/editor/${id}`)}
            className="mb-6 inline-flex items-center gap-1 text-sm opacity-60 hover:opacity-100"
          >
            <ArrowLeft className="h-4 w-4" /> Back to editor
          </button>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm opacity-60">
            Submissions from {site?.title ?? "your site"}'s lead forms.
          </p>

          <div className="mt-8 rounded-2xl border border-white/10 overflow-hidden">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin opacity-60" />
              </div>
            ) : (leads?.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <Inbox className="h-10 w-10 opacity-40 mb-3" />
                <div className="font-semibold">No leads yet</div>
                <p className="mt-1 text-sm opacity-60 max-w-md">
                  Once visitors submit a lead form on your published site, they'll show up here.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Wallet</th>
                    <th className="px-4 py-3 font-medium">Fields</th>
                  </tr>
                </thead>
                <tbody>
                  {(leads ?? []).map((l) => (
                    <tr key={l.id} className="border-t border-white/5">
                      <td className="px-4 py-3 align-top whitespace-nowrap opacity-70">
                        {new Date(l.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 align-top">{l.email ?? "—"}</td>
                      <td className="px-4 py-3 align-top font-mono text-xs">
                        {l.walletAddress ?? "—"}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <pre className="text-xs opacity-70 whitespace-pre-wrap break-words max-w-md">
                          {JSON.stringify(l.fields, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
