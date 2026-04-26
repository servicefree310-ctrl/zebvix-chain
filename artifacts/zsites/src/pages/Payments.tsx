import { useParams, useLocation } from "wouter";
import {
  useGetSite,
  useListPaymentsForSite,
  getGetSiteQueryKey,
  getListPaymentsForSiteQueryKey,
} from "@workspace/api-client-react";
import { AppShell } from "@/components/layout/AppShell";
import { ArrowLeft, Banknote, Loader2 } from "lucide-react";

export default function Payments() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { data: site } = useGetSite(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetSiteQueryKey(id) },
  });
  const { data: payments, isLoading } = useListPaymentsForSite(id, {
    query: { enabled: Number.isFinite(id), queryKey: getListPaymentsForSiteQueryKey(id) },
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
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="mt-1 text-sm opacity-60">
            On-chain transactions received by {site?.title ?? "your site"} via Zebvix L1.
          </p>

          <div className="mt-8 rounded-2xl border border-white/10 overflow-hidden">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin opacity-60" />
              </div>
            ) : (payments?.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <Banknote className="h-10 w-10 opacity-40 mb-3" />
                <div className="font-semibold">No payments yet</div>
                <p className="mt-1 text-sm opacity-60 max-w-md">
                  Add a Crypto Checkout block, set your wallet, and publish your site to start
                  accepting on-chain payments.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Asset</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">From</th>
                    <th className="px-4 py-3 font-medium">Tx</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(payments ?? []).map((p) => (
                    <tr key={p.id} className="border-t border-white/5">
                      <td className="px-4 py-3 whitespace-nowrap opacity-70">
                        {new Date(p.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 uppercase">{p.asset}</td>
                      <td className="px-4 py-3 font-semibold">{p.amount}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {p.fromAddress.slice(0, 6)}…{p.fromAddress.slice(-4)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {p.txHash.slice(0, 8)}…{p.txHash.slice(-6)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                            p.status === "confirmed"
                              ? "bg-green-500/15 text-green-400"
                              : p.status === "pending"
                                ? "bg-amber-500/15 text-amber-400"
                                : "bg-red-500/15 text-red-400"
                          }`}
                        >
                          {p.status}
                        </span>
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
