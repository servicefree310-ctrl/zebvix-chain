import { useParams, useLocation } from "wouter";
import {
  useGetSite,
  useGetSiteAnalytics,
  getGetSiteQueryKey,
  getGetSiteAnalyticsQueryKey,
} from "@workspace/api-client-react";
import { AppShell } from "@/components/layout/AppShell";
import {
  ArrowLeft,
  Loader2,
  Eye,
  Inbox,
  Banknote,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function Analytics() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { data: site } = useGetSite(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetSiteQueryKey(id) },
  });
  const { data, isLoading } = useGetSiteAnalytics(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetSiteAnalyticsQueryKey(id) },
  });

  const stats = data
    ? [
        {
          label: "Total page views",
          value: data.totalViews ?? 0,
          icon: Eye,
        },
        {
          label: "Leads captured",
          value: data.totalLeads ?? 0,
          icon: Inbox,
        },
        {
          label: "Confirmed payments",
          value: data.totalPayments ?? 0,
          icon: Banknote,
        },
        {
          label: "Revenue (zUSD)",
          value: data.totalRevenueZusd ?? "0",
          icon: TrendingUp,
        },
      ]
    : [];

  const series = (data?.last30Days ?? []) as {
    date: string;
    views: number;
    leads: number;
    payments: number;
  }[];

  return (
    <AppShell>
      <div className="px-4 md:px-8 py-12">
        <div className="mx-auto max-w-6xl">
          <button
            onClick={() => setLocation(`/editor/${id}`)}
            className="mb-6 inline-flex items-center gap-1 text-sm opacity-60 hover:opacity-100"
          >
            <ArrowLeft className="h-4 w-4" /> Back to editor
          </button>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm opacity-60">
            Performance for {site?.title ?? "your site"} over the last 30 days.
          </p>

          {isLoading ? (
            <div className="flex h-60 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin opacity-60" />
            </div>
          ) : (
            <>
              <div className="mt-8 grid gap-4 grid-cols-2 md:grid-cols-4">
                {stats.map((s) => {
                  const Icon = s.icon;
                  return (
                    <div
                      key={s.label}
                      className="rounded-2xl border border-white/10 bg-black/40 p-5"
                    >
                      <div className="flex items-center gap-2 opacity-70 text-xs uppercase tracking-wider">
                        <Icon className="h-3.5 w-3.5" /> {s.label}
                      </div>
                      <div className="mt-3 text-3xl font-bold">{s.value}</div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8 rounded-2xl border border-white/10 bg-black/40 p-6">
                <div className="text-sm font-semibold mb-4">
                  Daily page views (last 30 days)
                </div>
                <div className="h-72">
                  {series.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm opacity-50">
                      No traffic yet — publish your site to start collecting visits.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={series}>
                        <defs>
                          <linearGradient id="zsAreaFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00F0FF" stopOpacity={0.5} />
                            <stop offset="100%" stopColor="#00F0FF" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#ffffff10" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "#ffffff80", fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tick={{ fill: "#ffffff80", fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#0a0a0a",
                            border: "1px solid #ffffff20",
                            borderRadius: 8,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="views"
                          stroke="#00F0FF"
                          strokeWidth={2}
                          fill="url(#zsAreaFill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-6">
                <div className="text-sm font-semibold mb-4">Top referrers</div>
                {(data?.topReferrers ?? []).length === 0 ? (
                  <div className="text-sm opacity-50 py-6 text-center">
                    No referrer data yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(data?.topReferrers ?? []).map((r, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-sm border-b border-white/5 last:border-0 pb-2"
                      >
                        <div className="opacity-80 truncate">
                          {r.referrer || "Direct"}
                        </div>
                        <div className="font-semibold">{r.count}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
