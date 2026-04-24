import { Router } from "express";
import path from "path";
import fs from "fs";

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

interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  children?: TreeNode[];
}

function buildTree(absDir: string, relDir: string): TreeNode[] {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const abs = path.join(absDir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = buildTree(abs, rel);
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: rel, type: "dir", children });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const isCargoLock = entry.name === "Cargo.lock";
      if (!isCargoLock && ext && !ALLOWED_EXT.has(ext)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
      const stat = fs.statSync(abs);
      nodes.push({
        name: entry.name,
        path: rel,
        type: "file",
        size: stat.size,
      });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

chainRouter.get("/chain/tree", (_req, res) => {
  try {
    if (!fs.existsSync(CHAIN_ROOT)) {
      res.status(404).json({ error: "Chain source not found" });
      return;
    }
    const tree = buildTree(CHAIN_ROOT, "");
    let fileCount = 0;
    let totalLines = 0;
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === "file") {
          fileCount++;
          try {
            const content = fs.readFileSync(
              path.join(CHAIN_ROOT, n.path),
              "utf-8",
            );
            totalLines += content.split("\n").length;
          } catch {
            // skip
          }
        } else if (n.children) {
          walk(n.children);
        }
      }
    };
    walk(tree);
    res.json({ tree, stats: { files: fileCount, lines: totalLines } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

chainRouter.get("/chain/file", (req, res) => {
  const rel = String(req.query["path"] || "");
  if (!rel || rel.includes("..") || rel.startsWith("/")) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  const abs = path.join(CHAIN_ROOT, rel);
  const normalizedAbs = path.normalize(abs);
  if (!normalizedAbs.startsWith(CHAIN_ROOT + path.sep)) {
    res.status(400).json({ error: "Path escape" });
    return;
  }
  if (!fs.existsSync(normalizedAbs) || !fs.statSync(normalizedAbs).isFile()) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  const stat = fs.statSync(normalizedAbs);
  if (stat.size > MAX_FILE_BYTES) {
    res.status(413).json({ error: "File too large" });
    return;
  }
  const content = fs.readFileSync(normalizedAbs, "utf-8");
  res.json({
    path: rel,
    size: stat.size,
    lines: content.split("\n").length,
    content,
  });
});

export default chainRouter;
