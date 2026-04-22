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

// Serve a freshly-built tarball of the live zebvix-chain source on every request.
// This guarantees the VPS always pulls the latest pool.rs / state.rs / etc.
downloadRouter.get("/download/newchain", (_req, res) => {
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
  // tar -czf - -C /home/runner/workspace --exclude=target --exclude=.git zebvix-chain
  const tar = spawn(
    "tar",
    [
      "-czf",
      "-",
      "-C",
      WORKSPACE,
      "--exclude=zebvix-chain/target",
      "--exclude=zebvix-chain/.git",
      "--exclude=zebvix-chain/Cargo.lock",
      "zebvix-chain",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  tar.stdout.pipe(res);
  tar.stderr.on("data", (d) => console.error("[tar]", d.toString()));
  tar.on("error", (e) => {
    console.error("[tar spawn error]", e);
    if (!res.headersSent) res.status(500).end();
  });
  tar.on("exit", (code) => {
    if (code !== 0) console.error("[tar exit]", code);
  });
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
