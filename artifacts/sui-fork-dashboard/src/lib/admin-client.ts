// Tiny client for the /api/admin/* surface. Token is kept in sessionStorage so
// it doesn't outlive the tab; everything else is just typed fetch helpers.

const TOKEN_KEY = "zbx-admin-token";

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // sessionStorage unavailable — caller can still pass token explicitly.
  }
}

export function clearAdminToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

interface FetchOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
}

export class AdminError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "AdminError";
  }
}

async function adminFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const token = opts.token ?? getAdminToken();
  if (token) headers["x-admin-token"] = token;

  const r = await fetch(`/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
    signal: opts.signal,
  });

  let payload: unknown = null;
  try {
    payload = await r.json();
  } catch {
    // non-JSON response
  }

  if (!r.ok) {
    const obj = (payload ?? {}) as { error?: string; message?: string };
    throw new AdminError(
      r.status,
      obj.error ?? `http_${r.status}`,
      obj.message ?? obj.error ?? `Request failed with status ${r.status}`,
    );
  }
  return (payload ?? {}) as T;
}

// ── Types ──────────────────────────────────────────────────────────────────
export interface SettingDef {
  key: string;
  group: "chain" | "branding" | "links";
  label: string;
  hint: string | null;
  kind: "string" | "number" | "url" | "color" | "boolean";
  defaultValue: string | number | boolean;
  isPublic: boolean;
  isSensitive: boolean;
}

export interface NavItem {
  id: number;
  slug: string;
  section: "core" | "live" | "addons";
  label: string;
  href: string;
  iconName: string;
  badge: "LIVE" | "NEW" | "PRO" | null;
  sortOrder: number;
  enabled: boolean;
  isCustom: boolean;
  openInNewTab: boolean;
  updatedAt: string;
}

// ── Endpoints ──────────────────────────────────────────────────────────────
export const adminApi = {
  authStatus: () => adminFetch<{ configured: boolean }>("/admin/auth/status"),
  authCheck: (token: string) =>
    adminFetch<{ ok: boolean }>("/admin/auth/check", {
      method: "POST",
      body: { token },
      token,
    }),
  catalog: () => adminFetch<{ defs: SettingDef[] }>("/admin/settings/catalog"),
  publicSettings: () =>
    adminFetch<{ values: Record<string, unknown> }>("/admin/settings/public"),
  getSettings: () =>
    adminFetch<{ values: Record<string, unknown> }>("/admin/settings"),
  putSettings: (values: Record<string, unknown>) =>
    adminFetch<{ ok: true; values: Record<string, unknown> }>("/admin/settings", {
      method: "PUT",
      body: { values },
    }),
  getNav: () => adminFetch<{ items: NavItem[] }>("/admin/nav"),
  publicNav: () => adminFetch<{ items: NavItem[] }>("/admin/nav/public"),
  createNav: (item: Partial<NavItem>) =>
    adminFetch<{ item: NavItem }>("/admin/nav", { method: "POST", body: item }),
  updateNav: (id: number, item: Partial<NavItem>) =>
    adminFetch<{ item: NavItem }>(`/admin/nav/${id}`, {
      method: "PUT",
      body: item,
    }),
  deleteNav: (id: number) =>
    adminFetch<{ ok: true }>(`/admin/nav/${id}`, { method: "DELETE" }),
  resetNav: () =>
    adminFetch<{ ok: true; count: number }>("/admin/nav/reset", { method: "POST" }),
};
