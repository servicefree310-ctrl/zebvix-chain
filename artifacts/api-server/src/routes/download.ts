import { Router } from "express";
import path from "path";
import fs from "fs";

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
  newchain: {
    file: "zebvix-chain-source.tar.gz",
    name: "zebvix-chain-source.tar.gz",
    mime: "application/gzip",
  },
};

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
