import { AppShell } from "@/components/layout/AppShell";
import { useGetSitesDashboardSummary } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus, LayoutTemplate, Globe, BarChart3, Users, ExternalLink, Edit } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: summary, isLoading } = useGetSitesDashboardSummary();

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Dashboard</h1>
            <p className="text-zinc-400 mt-1">Manage your sites and view performance.</p>
          </div>
          <div className="flex gap-3">
            <Button asChild variant="outline" className="border-white/20 text-white hover:bg-white/10">
              <Link href="/templates">
                <LayoutTemplate className="mr-2 h-4 w-4" /> Templates
              </Link>
            </Button>
            <Button asChild className="bg-[#00F0FF] text-black hover:bg-[#00F0FF]/90">
              <Link href="/sites/new">
                <Plus className="mr-2 h-4 w-4" /> New Site
              </Link>
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-zinc-900 rounded-xl"></div>)}
            </div>
            <div className="h-64 bg-zinc-900 rounded-xl"></div>
          </div>
        ) : summary ? (
          <div className="space-y-8">
            {/* Stats Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="bg-black border-white/10">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-zinc-400">Total Sites</CardTitle>
                  <Globe className="h-4 w-4 text-zinc-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-white">{summary.totalSites}</div>
                  <p className="text-xs text-zinc-500 mt-1">{summary.publishedSites} published</p>
                </CardContent>
              </Card>
              <Card className="bg-black border-white/10">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-zinc-400">Total Views</CardTitle>
                  <BarChart3 className="h-4 w-4 text-zinc-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-white">{summary.totalViews.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card className="bg-black border-white/10">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-zinc-400">Total Leads</CardTitle>
                  <Users className="h-4 w-4 text-zinc-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-white">{summary.totalLeads}</div>
                </CardContent>
              </Card>
              <Card className="bg-black border-white/10">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-zinc-400">Revenue (ZBX)</CardTitle>
                  <div className="h-4 w-4 rounded-full bg-[#00F0FF]/20 flex items-center justify-center">
                    <div className="h-2 w-2 rounded-full bg-[#00F0FF]"></div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-[#00F0FF]">{summary.totalRevenueZbx}</div>
                </CardContent>
              </Card>
            </div>

            {/* Sites List */}
            <div>
              <h2 className="text-xl font-bold text-white mb-4">Your Sites</h2>
              {summary.recentSites.length === 0 ? (
                <div className="text-center py-16 bg-zinc-950 border border-white/5 rounded-xl">
                  <Globe className="mx-auto h-12 w-12 text-zinc-600 mb-4" />
                  <h3 className="text-lg font-medium text-white mb-2">No sites yet</h3>
                  <p className="text-zinc-400 mb-6">Create your first site to start building your web presence.</p>
                  <Button asChild className="bg-[#00F0FF] text-black">
                    <Link href="/sites/new">Create Site</Link>
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {summary.recentSites.map(site => (
                    <Card key={site.id} className="bg-black border-white/10 flex flex-col hover:border-white/20 transition-colors group">
                      <CardHeader>
                        <div className="flex justify-between items-start">
                          <div>
                            <CardTitle className="text-lg text-white">{site.title || site.subdomain}</CardTitle>
                            <CardDescription className="text-zinc-400">
                              {site.subdomain}.zsites.app
                            </CardDescription>
                          </div>
                          {site.published && (
                            <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                              Live
                            </span>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1">
                        <p className="text-sm text-zinc-500 line-clamp-2">
                          {site.description || "No description provided."}
                        </p>
                        <div className="mt-4 text-xs text-zinc-600">
                          Updated {format(new Date(site.updatedAt), "MMM d, yyyy")}
                        </div>
                      </CardContent>
                      <div className="p-4 border-t border-white/5 flex justify-between gap-2">
                        <Button asChild variant="ghost" size="sm" className="flex-1 text-zinc-300 hover:text-white hover:bg-white/10">
                          <Link href={`/editor/${site.id}`}>
                            <Edit className="h-4 w-4 mr-2" /> Edit
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="sm" className="flex-1 text-zinc-300 hover:text-white hover:bg-white/10" disabled={!site.published}>
                          {site.published ? (
                            <a href={`/p/${site.subdomain}`} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 mr-2" /> View
                            </a>
                          ) : (
                            <span className="opacity-50 cursor-not-allowed">
                              <ExternalLink className="h-4 w-4 mr-2" /> View
                            </span>
                          )}
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
