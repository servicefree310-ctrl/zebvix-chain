import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield,
  KeyRound,
  Settings,
  Palette,
  Link as LinkIcon,
  ListChecks,
  Plus,
  Save,
  RefreshCw,
  LogOut,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  ToggleLeft,
  ArrowDownUp,
  Droplets,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  adminApi,
  getAdminToken,
  setAdminToken,
  clearAdminToken,
  AdminError,
  type SettingDef,
  type NavItem,
} from "@/lib/admin-client";

// ─── Auth gate ─────────────────────────────────────────────────────────────
function LoginGate({
  configured,
  onAuthenticated,
}: {
  configured: boolean;
  onAuthenticated: () => void;
}) {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await adminApi.authCheck(token.trim());
      setAdminToken(token.trim());
      onAuthenticated();
    } catch (e2) {
      const m = e2 instanceof AdminError ? e2.message : "Login failed";
      setErr(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-md border-emerald-500/30 bg-slate-900/60">
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mb-3">
            <Shield className="h-6 w-6 text-emerald-300" />
          </div>
          <CardTitle className="text-xl">Admin Panel</CardTitle>
          <CardDescription>
            Token-protected control plane for chain settings, branding, and navigation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!configured ? (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200"
              data-testid="admin-not-configured"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p className="font-semibold">Admin token not configured</p>
                  <p className="text-amber-300/80 leading-snug">
                    Set the <code className="bg-black/40 px-1 rounded">ADMIN_TOKEN</code> environment variable
                    in your Replit Secrets pane (minimum 8 characters), then restart the API server.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="admin-token">Admin token</Label>
                <div className="relative">
                  <Input
                    id="admin-token"
                    type={show ? "text" : "password"}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Paste your ADMIN_TOKEN"
                    className="pr-10 font-mono"
                    data-testid="input-admin-token"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={show ? "Hide token" : "Show token"}
                    data-testid="btn-toggle-show-token"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {err && (
                <div
                  className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2"
                  data-testid="admin-login-error"
                >
                  {err}
                </div>
              )}
              <Button
                type="submit"
                disabled={busy || !token.trim()}
                className="w-full"
                data-testid="btn-admin-login"
              >
                <KeyRound className="h-4 w-4 mr-2" />
                {busy ? "Verifying…" : "Sign in"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Settings section ──────────────────────────────────────────────────────
function SettingsForm({
  defs,
  values,
  onSave,
}: {
  defs: SettingDef[];
  values: Record<string, unknown>;
  onSave: (next: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...values });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDraft({ ...values });
  }, [values]);

  const dirty = useMemo(() => {
    for (const d of defs) {
      if ((draft[d.key] ?? "") !== (values[d.key] ?? "")) return true;
    }
    return false;
  }, [draft, values, defs]);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      // Coerce numbers/bps from string inputs.
      const out: Record<string, unknown> = {};
      for (const d of defs) {
        let v = draft[d.key];
        if ((d.kind === "number" || d.kind === "bps") && typeof v === "string") {
          const n = Number(v);
          v = Number.isFinite(n) ? n : d.defaultValue;
        }
        out[d.key] = v;
      }
      await onSave(out);
      setSavedAt(Date.now());
    } catch (e) {
      setErr(e instanceof AdminError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        {defs.map((d) => {
          const v = draft[d.key];
          const display =
            v === undefined || v === null ? "" : typeof v === "boolean" ? v : String(v);
          return (
            <div key={d.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={`fld-${d.key}`} className="text-xs font-semibold">
                  {d.label}
                  {d.isSensitive && (
                    <span className="ml-2 text-[10px] uppercase text-amber-400">sensitive</span>
                  )}
                </Label>
                {!d.isPublic && (
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    server-only
                  </span>
                )}
              </div>
              {d.kind === "boolean" ? (
                <Switch
                  checked={Boolean(v)}
                  onCheckedChange={(c) => setDraft((p) => ({ ...p, [d.key]: c }))}
                  data-testid={`fld-${d.key}`}
                />
              ) : d.kind === "color" ? (
                <div className="flex items-center gap-2">
                  <input
                    id={`fld-${d.key}`}
                    type="color"
                    value={typeof display === "string" && display.startsWith("#") ? display : "#10b981"}
                    onChange={(e) => setDraft((p) => ({ ...p, [d.key]: e.target.value }))}
                    className="h-9 w-12 rounded border border-border bg-transparent cursor-pointer"
                    data-testid={`fld-${d.key}`}
                  />
                  <Input
                    value={typeof display === "string" ? display : ""}
                    onChange={(e) => setDraft((p) => ({ ...p, [d.key]: e.target.value }))}
                    className="font-mono text-xs"
                    placeholder="#10b981"
                  />
                </div>
              ) : d.kind === "enum" && Array.isArray(d.options) ? (
                <select
                  id={`fld-${d.key}`}
                  value={typeof display === "string" ? display : String(d.defaultValue)}
                  onChange={(e) => setDraft((p) => ({ ...p, [d.key]: e.target.value }))}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary"
                  data-testid={`fld-${d.key}`}
                >
                  {d.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : d.kind === "csv" ? (
                <textarea
                  id={`fld-${d.key}`}
                  value={typeof display === "string" ? display : ""}
                  onChange={(e) => setDraft((p) => ({ ...p, [d.key]: e.target.value }))}
                  placeholder={String(d.defaultValue) || "ZBX, USDC, USDT"}
                  rows={2}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary resize-y"
                  data-testid={`fld-${d.key}`}
                />
              ) : d.kind === "bps" ? (
                <div className="flex items-center gap-2">
                  <Input
                    id={`fld-${d.key}`}
                    type="number"
                    min={0}
                    max={10000}
                    step={1}
                    value={typeof display === "string" || typeof display === "number" ? String(display) : ""}
                    onChange={(e) => setDraft((p) => ({ ...p, [d.key]: e.target.value }))}
                    placeholder={String(d.defaultValue)}
                    className="font-mono text-xs"
                    data-testid={`fld-${d.key}`}
                  />
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    = {((Number(display) || 0) / 100).toFixed(2)}%
                  </span>
                </div>
              ) : (
                <Input
                  id={`fld-${d.key}`}
                  type={d.kind === "number" ? "number" : d.kind === "url" ? "url" : "text"}
                  value={typeof display === "string" || typeof display === "number" ? String(display) : ""}
                  onChange={(e) => setDraft((p) => ({ ...p, [d.key]: e.target.value }))}
                  placeholder={String(d.defaultValue)}
                  className="font-mono text-xs"
                  data-testid={`fld-${d.key}`}
                />
              )}
              {d.hint && (
                <p className="text-[10px] text-muted-foreground leading-snug">{d.hint}</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <Button onClick={submit} disabled={!dirty || saving} data-testid="btn-save-settings">
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {savedAt && !dirty && (
          <span className="text-xs text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        {err && <span className="text-xs text-red-300">{err}</span>}
        {dirty && !saving && (
          <span className="text-xs text-amber-300">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}

// ─── Nav manager ───────────────────────────────────────────────────────────
const ICON_OPTIONS = [
  "Link",
  "BookOpen",
  "Settings",
  "Wallet",
  "Coins",
  "Network",
  "Activity",
  "Shield",
  "Search",
  "Code2",
  "Sparkles",
  "Hammer",
  "Rocket",
  "TrendingUp",
  "Droplets",
  "ArrowLeftRight",
  "ArrowUpDown",
  "Cpu",
  "Vote",
  "Terminal",
  "UserPlus",
  "AtSign",
  "FileCode2",
  "Download",
  "Lock",
  "Layers",
  "GitBranch",
  "Package",
  "PlayCircle",
  "TerminalSquare",
  "FileJson",
  "Users",
  "CheckSquare",
  "KeyRound",
  "Info",
];

function NavManager({ items, refetch }: { items: NavItem[]; refetch: () => void }) {
  const [filter, setFilter] = useState("");
  const [section, setSection] = useState<"all" | "core" | "live" | "addons">("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<NavItem>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState<Partial<NavItem>>({
    section: "addons",
    label: "",
    href: "",
    iconName: "Link",
    badge: null,
    sortOrder: 1000,
    enabled: true,
    openInNewTab: false,
    slug: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return items.filter((i) => {
      if (section !== "all" && i.section !== section) return false;
      if (!f) return true;
      return (
        i.label.toLowerCase().includes(f) ||
        i.href.toLowerCase().includes(f) ||
        i.slug.toLowerCase().includes(f)
      );
    });
  }, [items, filter, section]);

  async function patch(id: number, body: Partial<NavItem>) {
    setBusyId(id);
    setErr(null);
    try {
      await adminApi.updateNav(id, body);
      refetch();
    } catch (e) {
      setErr(e instanceof AdminError ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this custom navigation entry?")) return;
    setBusyId(id);
    setErr(null);
    try {
      await adminApi.deleteNav(id);
      refetch();
    } catch (e) {
      setErr(e instanceof AdminError ? e.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(id: number) {
    await patch(id, draft);
    setEditingId(null);
    setDraft({});
  }

  async function addNew() {
    setErr(null);
    if (!newItem.label?.trim() || !newItem.href?.trim() || !newItem.slug?.trim()) {
      setErr("slug, label and href are required");
      return;
    }
    try {
      await adminApi.createNav({
        ...newItem,
        slug: `custom:${newItem.slug!.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`,
      });
      setAdding(false);
      setNewItem({
        section: "addons",
        label: "",
        href: "",
        iconName: "Link",
        badge: null,
        sortOrder: 1000,
        enabled: true,
        openInNewTab: false,
        slug: "",
      });
      refetch();
    } catch (e) {
      setErr(e instanceof AdminError ? e.message : "Create failed");
    }
  }

  async function doReset() {
    if (!confirm("Reset all built-in items to defaults? Custom items are kept.")) return;
    setResetting(true);
    setErr(null);
    try {
      await adminApi.resetNav();
      refetch();
    } catch (e) {
      setErr(e instanceof AdminError ? e.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  async function move(id: number, delta: number) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    await patch(id, { sortOrder: Math.max(0, item.sortOrder + delta) });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by label, href or slug…"
          className="max-w-xs"
          data-testid="input-nav-filter"
        />
        <div className="flex gap-1">
          {(["all", "core", "live", "addons"] as const).map((s) => (
            <Button
              key={s}
              variant={section === s ? "default" : "outline"}
              size="sm"
              onClick={() => setSection(s)}
              data-testid={`btn-section-${s}`}
            >
              {s}
            </Button>
          ))}
        </div>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={doReset}
          disabled={resetting}
          data-testid="btn-reset-nav"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          {resetting ? "Resetting…" : "Reset built-ins"}
        </Button>
        <Button size="sm" onClick={() => setAdding((a) => !a)} data-testid="btn-add-nav">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          {adding ? "Cancel" : "Add custom"}
        </Button>
      </div>

      {err && (
        <div
          className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2"
          data-testid="nav-error"
        >
          {err}
        </div>
      )}

      {adding && (
        <Card className="border-sky-500/30 bg-sky-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Plus className="h-4 w-4" /> New navigation entry
            </CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3 text-xs">
            <div>
              <Label className="text-[10px]">Section</Label>
              <select
                value={newItem.section}
                onChange={(e) =>
                  setNewItem((p) => ({ ...p, section: e.target.value as NavItem["section"] }))
                }
                className="w-full bg-input border border-border rounded px-2 py-1.5 text-xs"
                data-testid="new-nav-section"
              >
                <option value="core">core</option>
                <option value="live">live</option>
                <option value="addons">addons</option>
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Slug (auto-prefixed with custom:)</Label>
              <Input
                value={newItem.slug ?? ""}
                onChange={(e) => setNewItem((p) => ({ ...p, slug: e.target.value }))}
                placeholder="my-link"
                className="text-xs"
                data-testid="new-nav-slug"
              />
            </div>
            <div>
              <Label className="text-[10px]">Label</Label>
              <Input
                value={newItem.label ?? ""}
                onChange={(e) => setNewItem((p) => ({ ...p, label: e.target.value }))}
                placeholder="My External Link"
                className="text-xs"
                data-testid="new-nav-label"
              />
            </div>
            <div>
              <Label className="text-[10px]">Href</Label>
              <Input
                value={newItem.href ?? ""}
                onChange={(e) => setNewItem((p) => ({ ...p, href: e.target.value }))}
                placeholder="/my-page or https://…"
                className="text-xs font-mono"
                data-testid="new-nav-href"
              />
            </div>
            <div>
              <Label className="text-[10px]">Icon</Label>
              <select
                value={newItem.iconName}
                onChange={(e) => setNewItem((p) => ({ ...p, iconName: e.target.value }))}
                className="w-full bg-input border border-border rounded px-2 py-1.5 text-xs"
                data-testid="new-nav-icon"
              >
                {ICON_OPTIONS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Badge</Label>
              <select
                value={newItem.badge ?? ""}
                onChange={(e) =>
                  setNewItem((p) => ({
                    ...p,
                    badge: (e.target.value || null) as NavItem["badge"],
                  }))
                }
                className="w-full bg-input border border-border rounded px-2 py-1.5 text-xs"
                data-testid="new-nav-badge"
              >
                <option value="">none</option>
                <option value="LIVE">LIVE</option>
                <option value="NEW">NEW</option>
                <option value="PRO">PRO</option>
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Sort order</Label>
              <Input
                type="number"
                value={newItem.sortOrder ?? 1000}
                onChange={(e) =>
                  setNewItem((p) => ({ ...p, sortOrder: Number(e.target.value) || 0 }))
                }
                className="text-xs"
              />
            </div>
            <div className="flex items-center gap-4 pt-4">
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={Boolean(newItem.enabled)}
                  onCheckedChange={(c) => setNewItem((p) => ({ ...p, enabled: c }))}
                />
                Enabled
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={Boolean(newItem.openInNewTab)}
                  onCheckedChange={(c) => setNewItem((p) => ({ ...p, openInNewTab: c }))}
                />
                Open in new tab
              </label>
            </div>
            <div className="sm:col-span-2 flex justify-end pt-2">
              <Button onClick={addNew} size="sm" data-testid="btn-create-nav">
                <Save className="h-3.5 w-3.5 mr-1.5" /> Create
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="rounded-lg border border-border bg-slate-900/40 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-950/60 text-muted-foreground">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold">Enabled</th>
              <th className="px-3 py-2 font-semibold">Section</th>
              <th className="px-3 py-2 font-semibold">Label</th>
              <th className="px-3 py-2 font-semibold">Href</th>
              <th className="px-3 py-2 font-semibold">Badge</th>
              <th className="px-3 py-2 font-semibold">Order</th>
              <th className="px-3 py-2 font-semibold w-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                  No matching items.
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const isEdit = editingId === item.id;
                const isBusy = busyId === item.id;
                const cur = isEdit ? { ...item, ...draft } : item;
                return (
                  <tr
                    key={item.id}
                    className={`border-t border-border ${isBusy ? "opacity-60" : ""}`}
                    data-testid={`row-nav-${item.id}`}
                  >
                    <td className="px-3 py-1.5">
                      <Switch
                        checked={item.enabled}
                        onCheckedChange={(c) => patch(item.id, { enabled: c })}
                        data-testid={`toggle-nav-${item.id}`}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      {isEdit ? (
                        <select
                          value={cur.section}
                          onChange={(e) =>
                            setDraft((p) => ({ ...p, section: e.target.value as NavItem["section"] }))
                          }
                          className="bg-input border border-border rounded px-1.5 py-0.5 text-xs"
                        >
                          <option value="core">core</option>
                          <option value="live">live</option>
                          <option value="addons">addons</option>
                        </select>
                      ) : (
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {item.section}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {isEdit ? (
                        <Input
                          value={cur.label}
                          onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))}
                          className="h-7 text-xs"
                        />
                      ) : (
                        <span className="font-medium">{item.label}</span>
                      )}
                      {item.isCustom && (
                        <span className="ml-1.5 text-[9px] uppercase text-sky-400">custom</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                      {isEdit ? (
                        <Input
                          value={cur.href}
                          onChange={(e) => setDraft((p) => ({ ...p, href: e.target.value }))}
                          className="h-7 text-xs font-mono"
                        />
                      ) : (
                        <span className="truncate inline-flex items-center gap-1">
                          {item.href}
                          {item.openInNewTab && <ExternalLink className="h-3 w-3 opacity-60" />}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {isEdit ? (
                        <select
                          value={cur.badge ?? ""}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              badge: (e.target.value || null) as NavItem["badge"],
                            }))
                          }
                          className="bg-input border border-border rounded px-1.5 py-0.5 text-xs"
                        >
                          <option value="">—</option>
                          <option value="LIVE">LIVE</option>
                          <option value="NEW">NEW</option>
                          <option value="PRO">PRO</option>
                        </select>
                      ) : item.badge ? (
                        <Badge variant="outline" className="text-[10px]">
                          {item.badge}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">
                      {isEdit ? (
                        <Input
                          type="number"
                          value={cur.sortOrder}
                          onChange={(e) =>
                            setDraft((p) => ({ ...p, sortOrder: Number(e.target.value) || 0 }))
                          }
                          className="h-7 text-xs w-20"
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          <span>{item.sortOrder}</span>
                          <button
                            onClick={() => move(item.id, -10)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Move up"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => move(item.id, 10)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Move down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {isEdit ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            onClick={() => saveEdit(item.id)}
                            data-testid={`btn-save-${item.id}`}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingId(null);
                              setDraft({});
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingId(item.id);
                              setDraft({});
                            }}
                            data-testid={`btn-edit-${item.id}`}
                          >
                            Edit
                          </Button>
                          {item.isCustom && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => remove(item.id)}
                              className="text-red-300 hover:text-red-200 border-red-500/30"
                              data-testid={`btn-delete-${item.id}`}
                              aria-label={`Delete ${item.label}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Built-in items can be disabled but not deleted. Custom items can be created, edited and removed.
        Sidebar updates within a few seconds of saving.
      </p>
    </div>
  );
}

// ─── Page shell ────────────────────────────────────────────────────────────
function AdminShell({ onSignOut }: { onSignOut: () => void }) {
  const qc = useQueryClient();

  const catalog = useQuery({
    queryKey: ["admin", "catalog"],
    queryFn: () => adminApi.catalog(),
    staleTime: 60_000,
  });
  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => adminApi.getSettings(),
    staleTime: 5_000,
    retry: false,
  });
  const nav = useQuery({
    queryKey: ["admin", "nav"],
    queryFn: () => adminApi.getNav(),
    staleTime: 5_000,
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: (vals: Record<string, unknown>) => adminApi.putSettings(vals),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      qc.invalidateQueries({ queryKey: ["public-settings"] });
      qc.invalidateQueries({ queryKey: ["public-nav"] });
    },
  });

  const handleSettingsSave = async (next: Record<string, unknown>) => {
    await saveMutation.mutateAsync(next);
  };

  const defs = catalog.data?.defs ?? [];
  const grouped: Record<
    "chain" | "branding" | "links" | "features" | "dex" | "faucet" | "system",
    SettingDef[]
  > = {
    chain: defs.filter((d) => d.group === "chain"),
    branding: defs.filter((d) => d.group === "branding"),
    links: defs.filter((d) => d.group === "links"),
    features: defs.filter((d) => d.group === "features"),
    dex: defs.filter((d) => d.group === "dex"),
    faucet: defs.filter((d) => d.group === "faucet"),
    system: defs.filter((d) => d.group === "system"),
  };
  const values = settings.data?.values ?? {};

  // If our token got revoked or rotated server-side, kick back to login.
  const authBroken =
    settings.error instanceof AdminError && settings.error.status === 401;

  useEffect(() => {
    if (authBroken) onSignOut();
  }, [authBroken, onSignOut]);

  const navItems = nav.data?.items ?? [];
  const stats = useMemo(() => {
    const enabled = navItems.filter((i) => i.enabled).length;
    const custom = navItems.filter((i) => i.isCustom).length;
    return { total: navItems.length, enabled, custom };
  }, [navItems]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-emerald-400" />
            Admin Panel
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage chain configuration, branding, and the dashboard navigation.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onSignOut} data-testid="btn-admin-logout">
          <LogOut className="h-3.5 w-3.5 mr-1.5" />
          Sign out
        </Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Chain ID</div>
            <div className="text-2xl font-bold font-mono" data-testid="stat-chain-id">
              {String(values.chainId ?? "—")}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {String(values.chainName ?? "")}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Brand</div>
            <div className="text-2xl font-bold" data-testid="stat-brand">
              {String(values.brandName ?? "—")}
            </div>
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {String(values.brandDomain ?? "")}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Nav items</div>
            <div className="text-2xl font-bold" data-testid="stat-nav">
              {stats.enabled} <span className="text-sm text-muted-foreground">/ {stats.total}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats.custom} custom
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="chain">
        <TabsList className="flex-wrap">
          <TabsTrigger value="chain" data-testid="tab-chain">
            <Settings className="h-3.5 w-3.5 mr-1.5" /> Chain
          </TabsTrigger>
          <TabsTrigger value="branding" data-testid="tab-branding">
            <Palette className="h-3.5 w-3.5 mr-1.5" /> Branding
          </TabsTrigger>
          <TabsTrigger value="links" data-testid="tab-links">
            <LinkIcon className="h-3.5 w-3.5 mr-1.5" /> Social Links
          </TabsTrigger>
          <TabsTrigger value="features" data-testid="tab-features">
            <ToggleLeft className="h-3.5 w-3.5 mr-1.5" /> Features
          </TabsTrigger>
          <TabsTrigger value="dex" data-testid="tab-dex">
            <ArrowDownUp className="h-3.5 w-3.5 mr-1.5" /> DEX
          </TabsTrigger>
          <TabsTrigger value="faucet" data-testid="tab-faucet">
            <Droplets className="h-3.5 w-3.5 mr-1.5" /> Faucet
          </TabsTrigger>
          <TabsTrigger value="system" data-testid="tab-system">
            <Wrench className="h-3.5 w-3.5 mr-1.5" /> System
          </TabsTrigger>
          <TabsTrigger value="nav" data-testid="tab-nav">
            <ListChecks className="h-3.5 w-3.5 mr-1.5" /> Pages & Services
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chain" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Chain configuration</CardTitle>
              <CardDescription>
                Public values appear in the dashboard topbar and explorer pages. The
                <code className="mx-1 text-xs bg-black/40 px-1 rounded">rpcUrl</code>
                is server-only and overrides the upstream RPC proxy.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings.isLoading || catalog.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <SettingsForm
                  defs={grouped.chain}
                  values={values}
                  onSave={handleSettingsSave}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Branding</CardTitle>
              <CardDescription>
                Names, taglines and theme colors shown across the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings.isLoading || catalog.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <SettingsForm
                  defs={grouped.branding}
                  values={values}
                  onSave={handleSettingsSave}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="links" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Social & docs links</CardTitle>
              <CardDescription>
                Optional. Surfaces in the topbar and footer when populated.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings.isLoading || catalog.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <SettingsForm
                  defs={grouped.links}
                  values={values}
                  onSave={handleSettingsSave}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="features" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Feature flags</CardTitle>
              <CardDescription>
                Toggle entire dashboard sections on or off. Disabled features are
                hidden from the sidebar; the underlying pages remain reachable
                via direct URL so admins can preview them. Combine with the
                Pages & Services tab for a hard hide.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings.isLoading || catalog.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <SettingsForm
                  defs={grouped.features}
                  values={values}
                  onSave={handleSettingsSave}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dex" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">DEX & trading</CardTitle>
              <CardDescription>
                Defaults consumed by the swap, token-trade and pool pages. Fees
                and slippage are in basis points (100 bps = 1%). Allow / block
                lists accept comma-separated token symbols and apply on top of
                the on-chain registry.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings.isLoading || catalog.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <SettingsForm
                  defs={grouped.dex}
                  values={values}
                  onSave={handleSettingsSave}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="faucet" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Testnet faucet</CardTitle>
              <CardDescription>
                Drip amount, per-address cooldown and an optional message shown
                to faucet users.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings.isLoading || catalog.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <SettingsForm
                  defs={grouped.faucet}
                  values={values}
                  onSave={handleSettingsSave}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">System controls</CardTitle>
              <CardDescription>
                Maintenance mode shows a full-page overlay to all visitors — the
                Admin Panel itself is always exempt so you can switch it back
                off. The announcement banner appears at the top of every
                non-admin page when enabled.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings.isLoading || catalog.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <SettingsForm
                  defs={grouped.system}
                  values={values}
                  onSave={handleSettingsSave}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nav" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Pages &amp; services navigation</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => nav.refetch()}
                  data-testid="btn-refresh-nav"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
                </Button>
              </CardTitle>
              <CardDescription>
                Toggle, reorder, edit or delete sidebar entries. Built-in items can be
                disabled; custom items support full CRUD.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {nav.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <NavManager items={navItems} refetch={() => nav.refetch()} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Top-level page ────────────────────────────────────────────────────────
export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(getAdminToken()));

  const status = useQuery({
    queryKey: ["admin", "auth-status"],
    queryFn: () => adminApi.authStatus(),
    staleTime: 30_000,
    retry: false,
  });

  // If we have a stored token, verify it on first render. If invalid, kick to login.
  useEffect(() => {
    const t = getAdminToken();
    if (!t || !authed) return;
    let cancelled = false;
    (async () => {
      try {
        await adminApi.authCheck(t);
      } catch {
        if (cancelled) return;
        clearAdminToken();
        setAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  function signOut() {
    clearAdminToken();
    setAuthed(false);
  }

  if (status.isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-muted-foreground">
        Loading admin panel…
      </div>
    );
  }

  if (!authed) {
    return (
      <LoginGate
        configured={status.data?.configured ?? false}
        onAuthenticated={() => setAuthed(true)}
      />
    );
  }
  return <AdminShell onSignOut={signOut} />;
}
