import { Router } from "express";
import path from "path";
import fs from "fs/promises";

const dashboardCodeRouter = Router();

// Root of the Zebvix Dashboard SPA we are exposing for browse + download.
// Any file the user can see/download lives strictly inside this folder.
const DASHBOARD_ROOT =
  "/home/runner/workspace/artifacts/sui-fork-dashboard/src";

const ALLOWED_EXT = new Set([
  ".ts",
  ".tsx",
  ".css",
  ".json",
  ".md",
  ".html",
]);

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB — comfortably above the largest page

// Categorize each src/pages/<slug>.tsx file into one of three buckets so the
// user can grab "just the explorer code" or "just the wallet/services code"
// for their VPS without copy-pasting individual files. Slugs are matched
// against the file's basename (without the .tsx extension), case-sensitive.
//
// Anything in src/pages NOT listed here lands in "extra" (docs, marketing,
// admin-only screens). Anything outside src/pages — shared lib, components,
// hooks, contexts — also lands in "extra" because they are cross-cutting
// dependencies, not deployable units on their own.
const EXPLORE_PAGES = new Set([
  "zvm-explorer",
  "block-explorer",
  "balance-lookup",
  "chain-code",
  "chain-status",
  "network",
  "live-chain",
  "multisig-explorer",
  "pool-explorer",
  "rpc-playground",
  "bridge-live",
]);

// Note: `validators` lives in Services because the page is a
// validator-register / validator-management workbench (stake, commission,
// register/unregister), not a passive inspector. If a separate read-only
// validator browser is added later, it belongs in Explore.
const SERVICE_PAGES = new Set([
  "wallet",
  "import-wallet",
  "connect-wallet",
  "swap",
  "dex",
  "staking",
  "validators",
  "token-create",
  "token-trade",
  "token-liquidity",
  "token-metadata",
  "payid-register",
  "payid-resolver",
  "bridge",
  "faucet",
  "governance",
]);

type CategoryKey = "explore" | "services" | "extra";

interface FileEntry {
  name: string;
  path: string;          // relative to DASHBOARD_ROOT, eg "pages/wallet.tsx"
  size: number;
  lines: number;
}

interface CategoryGroup {
  key: CategoryKey;
  label: string;
  description: string;
  files: FileEntry[];
}

// Source-code explorer is OFF by default in production. To expose it on a
// preview/dev environment set DASHBOARD_CODE_PUBLIC=1. We do NOT want
// arbitrary visitors reading or downloading the dashboard source on the
// deployed dashboard.
function explorerEnabled(): boolean {
  if (process.env["DASHBOARD_CODE_PUBLIC"] === "1") return true;
  return process.env["NODE_ENV"] !== "production";
}

function categorizeFile(rel: string): CategoryKey {
  // rel is something like "pages/wallet.tsx" or "lib/zbx-rpc.ts"
  const norm = rel.replace(/\\/g, "/");
  const m = norm.match(/^pages\/([^/]+)\.tsx$/);
  if (m && m[1]) {
    const slug = m[1];
    if (EXPLORE_PAGES.has(slug)) return "explore";
    if (SERVICE_PAGES.has(slug)) return "services";
  }
  return "extra";
}

async function collectFiles(
  absDir: string,
  relDir: string,
  acc: FileEntry[],
  depth: number,
): Promise<void> {
  if (depth > 8) return;
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const abs = path.join(absDir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await collectFiles(abs, rel, acc, depth + 1);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;
      try {
        const stat = await fs.stat(abs);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = await fs.readFile(abs, "utf-8");
        acc.push({
          name: entry.name,
          path: rel,
          size: stat.size,
          lines: content.split("\n").length,
        });
      } catch {
        // skip unreadable
      }
    }
  }
}

dashboardCodeRouter.get("/dashboard/tree", async (_req, res) => {
  if (!explorerEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    try {
      await fs.access(DASHBOARD_ROOT);
    } catch {
      res.status(404).json({ error: "Dashboard source not found" });
      return;
    }

    const all: FileEntry[] = [];
    await collectFiles(DASHBOARD_ROOT, "", all, 0);

    const buckets: Record<CategoryKey, FileEntry[]> = {
      explore: [],
      services: [],
      extra: [],
    };
    for (const f of all) {
      buckets[categorizeFile(f.path)].push(f);
    }
    for (const k of Object.keys(buckets) as CategoryKey[]) {
      buckets[k].sort((a, b) => a.path.localeCompare(b.path));
    }

    const totalLines = all.reduce((s, f) => s + f.lines, 0);
    const totalSize = all.reduce((s, f) => s + f.size, 0);

    const categories: CategoryGroup[] = [
      {
        key: "explore",
        label: "Explore",
        description:
          "Chain explorer & inspection tools — block/tx/address browsers, ZVM Explorer, RPC playground, network insights.",
        files: buckets.explore,
      },
      {
        key: "services",
        label: "Services",
        description:
          "End-user chain services — wallet, swap/DEX, staking, validator-register, Pay-ID, faucet, bridge, token tooling, governance.",
        files: buckets.services,
      },
      {
        key: "extra",
        label: "Extra",
        description:
          "Everything else — docs, marketing pages, shared components, lib/, contexts/, hooks/, css. These are cross-cutting dependencies; ship them alongside Explore or Services as needed.",
        files: buckets.extra,
      },
    ];

    res.json({
      categories,
      stats: {
        files: all.length,
        lines: totalLines,
        size: totalSize,
        explore: buckets.explore.length,
        services: buckets.services.length,
        extra: buckets.extra.length,
      },
    });
  } catch {
    res.status(500).json({ error: "internal error" });
  }
});

// Resolve `rel` safely under DASHBOARD_ROOT. Returns absolute path or null.
function safeResolve(rel: string): string | null {
  if (!rel || rel.length > 512 || rel.includes("..") || rel.startsWith("/")) {
    return null;
  }
  const abs = path.normalize(path.join(DASHBOARD_ROOT, rel));
  if (!abs.startsWith(DASHBOARD_ROOT + path.sep)) return null;
  return abs;
}

dashboardCodeRouter.get("/dashboard/file", async (req, res) => {
  if (!explorerEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rel = String(req.query["path"] || "");
  const abs = safeResolve(rel);
  if (!abs) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    if (stat.size > MAX_FILE_BYTES) {
      res.status(413).json({ error: "File too large" });
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      res.status(403).json({ error: "Disallowed file type" });
      return;
    }
    const content = await fs.readFile(abs, "utf-8");
    res.json({
      path: rel,
      size: stat.size,
      lines: content.split("\n").length,
      content,
    });
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

// Raw download — same security model as /file but sets a Content-Disposition
// header so browsers offer a save-as dialog. This is what the user uses to
// scp/upload individual page files to their VPS.
dashboardCodeRouter.get("/dashboard/raw", async (req, res) => {
  if (!explorerEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rel = String(req.query["path"] || "");
  const abs = safeResolve(rel);
  if (!abs) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    if (stat.size > MAX_FILE_BYTES) {
      res.status(413).json({ error: "File too large" });
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      res.status(403).json({ error: "Disallowed file type" });
      return;
    }
    const filename = path.basename(abs);
    const content = await fs.readFile(abs, "utf-8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.send(content);
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

export default dashboardCodeRouter;
