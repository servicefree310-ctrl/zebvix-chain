import { Router } from "express";
import path from "path";
import fs from "fs/promises";

const chainRouter = Router();

const CHAIN_ROOT = "/home/runner/workspace/zebvix-chain";

const ALLOWED_EXT = new Set([
  ".rs",
  ".sol",
  ".toml",
  ".md",
  ".lock",
  ".gitignore",
  ".json",
  ".yaml",
  ".yml",
  ".sh",
  ".txt",
]);

const SKIP_DIRS = new Set(["target", "node_modules", ".git", ".zebvix"]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_DEPTH = 8;

// Source-code explorer is OFF by default in production. To expose it on a
// preview/dev environment set CHAIN_EXPLORER_PUBLIC=1. (We do NOT want
// arbitrary visitors reading the chain source on the deployed dashboard.)
function explorerEnabled(): boolean {
  if (process.env["CHAIN_EXPLORER_PUBLIC"] === "1") return true;
  return process.env["NODE_ENV"] !== "production";
}

interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  children?: TreeNode[];
}

async function buildTree(
  absDir: string,
  relDir: string,
  depth: number,
): Promise<TreeNode[]> {
  if (depth > MAX_DEPTH) return [];
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const abs = path.join(absDir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = await buildTree(abs, rel, depth + 1);
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: rel, type: "dir", children });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const isCargoLock = entry.name === "Cargo.lock";
      if (!isCargoLock && ext && !ALLOWED_EXT.has(ext)) continue;
      try {
        const stat = await fs.stat(abs);
        nodes.push({
          name: entry.name,
          path: rel,
          type: "file",
          size: stat.size,
        });
      } catch {
        // skip unreadable
      }
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

chainRouter.get("/chain/tree", async (_req, res) => {
  if (!explorerEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    try {
      await fs.access(CHAIN_ROOT);
    } catch {
      res.status(404).json({ error: "Chain source not found" });
      return;
    }
    const tree = await buildTree(CHAIN_ROOT, "", 0);
    let fileCount = 0;
    let totalLines = 0;
    const walk = async (nodes: TreeNode[]): Promise<void> => {
      for (const n of nodes) {
        if (n.type === "file") {
          fileCount++;
          try {
            const content = await fs.readFile(
              path.join(CHAIN_ROOT, n.path),
              "utf-8",
            );
            totalLines += content.split("\n").length;
          } catch {
            // skip
          }
        } else if (n.children) {
          await walk(n.children);
        }
      }
    };
    await walk(tree);
    res.json({ tree, stats: { files: fileCount, lines: totalLines } });
  } catch {
    res.status(500).json({ error: "internal error" });
  }
});

chainRouter.get("/chain/file", async (req, res) => {
  if (!explorerEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rel = String(req.query["path"] || "");
  if (!rel || rel.length > 512 || rel.includes("..") || rel.startsWith("/")) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  const abs = path.join(CHAIN_ROOT, rel);
  const normalizedAbs = path.normalize(abs);
  if (!normalizedAbs.startsWith(CHAIN_ROOT + path.sep)) {
    res.status(400).json({ error: "Path escape" });
    return;
  }
  try {
    const stat = await fs.stat(normalizedAbs);
    if (!stat.isFile()) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    if (stat.size > MAX_FILE_BYTES) {
      res.status(413).json({ error: "File too large" });
      return;
    }
    const content = await fs.readFile(normalizedAbs, "utf-8");
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

export default chainRouter;
