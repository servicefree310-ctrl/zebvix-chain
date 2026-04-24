import { Router } from "express";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

const downloadRouter = Router();

const WORKSPACE = "/home/runner/workspace";

const FILES: Record<string, { file: string; name: string; mime: string }> = {
  patches: {
    file: "zebvix-chain-patches.zip",
    name: "zebvix-chain-patches.zip",
    mime: "application/zip",
  },
  fullsource: {
    file: "zebvix-full-source.zip",
    name: "zebvix-full-source.zip",
    mime: "application/zip",
  },
};

// Serve a freshly-built tarball of the live zebvix-chain source + ops scripts
// on every request. Guarantees the VPS always pulls the latest pool.rs /
// state.rs / tokenomics.rs AND the latest deploy/admin scripts in one shot.
//
// Tarball layout (after `tar -xzf`):
//   ./zebvix-chain/...        (full Rust source, no target/, no .git)
//   ./scripts/*.sh            (deploy + post-merge + helper scripts)
function streamFreshTar(_req: any, res: any) {
  const chainDir = path.join(WORKSPACE, "zebvix-chain");
  if (!fs.existsSync(chainDir)) {
    res.status(404).json({ error: "zebvix-chain source not found" });
    return;
  }
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="zebvix-chain-source.tar.gz"`,
  );
  res.setHeader("Cache-Control", "no-store");

  const args = [
    "-czf", "-",
    "-C", WORKSPACE,
    "--exclude=zebvix-chain/target",
    "--exclude=zebvix-chain/.git",
    "--exclude=zebvix-chain/Cargo.lock",
    "--exclude=scripts/node_modules",
    "zebvix-chain",
  ];
  // Only add scripts/ if it exists (avoids tar errors on minimal checkouts).
  if (fs.existsSync(path.join(WORKSPACE, "scripts"))) {
    args.push("scripts");
  }

  const tar = spawn("tar", args, { stdio: ["ignore", "pipe", "pipe"] });
  tar.stdout.pipe(res);
  tar.stderr.on("data", (d) => console.error("[tar]", d.toString()));
  tar.on("error", (e) => {
    console.error("[tar spawn error]", e);
    if (!res.headersSent) res.status(500).end();
  });
  tar.on("exit", (code) => {
    if (code !== 0) console.error("[tar exit]", code);
  });
}

downloadRouter.get("/download/newchain", streamFreshTar);
// Friendly alias used by Phase B.11.1 deploy run-book.
downloadRouter.get("/download/chain-latest", streamFreshTar);

// Stream a single live script straight from disk (no static cache, no rebuild).
// GET /api/download/script/<filename>  e.g. deploy_pool_genesis_seed.sh
const ALLOWED_SCRIPTS = new Set([
  "deploy_pool_genesis_seed.sh",
  "post-merge.sh",
]);
downloadRouter.get("/download/script/:name", (req, res) => {
  const name = req.params.name;
  if (!ALLOWED_SCRIPTS.has(name)) {
    res.status(404).json({ error: "script not allowed", allowed: [...ALLOWED_SCRIPTS] });
    return;
  }
  const fp = path.join(WORKSPACE, "scripts", name);
  if (!fs.existsSync(fp)) {
    res.status(404).json({ error: "script not found on server", path: fp });
    return;
  }
  res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(fp).pipe(res);
});

downloadRouter.get("/download/:key", (req, res) => {
  const entry = FILES[req.params.key];
  if (!entry) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  const filePath = path.join(WORKSPACE, entry.file);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File does not exist on server" });
    return;
  }
  res.setHeader("Content-Type", entry.mime);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${entry.name}"`,
  );
  res.setHeader("Content-Length", fs.statSync(filePath).size);
  fs.createReadStream(filePath).pipe(res);
});

downloadRouter.get("/download", (req, res) => {
  const links = Object.entries(FILES).map(([key, val]) => {
    const fp = path.join(WORKSPACE, val.file);
    const exists = fs.existsSync(fp);
    const size = exists
      ? (fs.statSync(fp).size / 1024 / 1024).toFixed(1) + " MB"
      : "missing";
    return { key, name: val.name, size, url: `/api/download/${key}` };
  });
  res.json({ files: links });
});

export default downloadRouter;
