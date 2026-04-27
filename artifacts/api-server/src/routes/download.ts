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

// Phase D-10 — CI-pass staleness gate.
//
// The marker file `zebvix-chain/target/.last-ci-pass` is touched by
// `scripts/ci-check.sh` after `cargo check` + `clippy -D warnings` +
// `cargo test --lib --features zvm` all pass. We refuse to stream a
// tarball whose backing source has not been validated by the gate within
// the last 24 hours. This is the operator-side guarantee that prevents
// "I forgot to run tests before pulling on the VPS" outages.
//
// Operator escape hatch: `?force=1` bypasses the gate but logs the
// override loudly (audit trail). Use only when the dev environment
// genuinely cannot run the gate (e.g. librocksdb-sys CPU budget on
// shared CI). On the VPS itself the operator can always re-run
// `bash scripts/ci-check.sh` after extraction to recover the marker.
const CI_MARKER_REL = path.join("zebvix-chain", "target", ".last-ci-pass");
const CI_GATE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function checkCiGate(): { ok: true } | { ok: false; reason: string; remediation: string } {
  const markerPath = path.join(WORKSPACE, CI_MARKER_REL);
  if (!fs.existsSync(markerPath)) {
    return {
      ok: false,
      reason: "ci_marker_missing",
      remediation:
        "Run `bash scripts/ci-check.sh` from /home/zebvix-chain on the dev " +
        "host. The marker `target/.last-ci-pass` is created on green PASS.",
    };
  }
  const age = Date.now() - fs.statSync(markerPath).mtimeMs;
  if (age > CI_GATE_MAX_AGE_MS) {
    const ageHours = (age / 3600_000).toFixed(1);
    return {
      ok: false,
      reason: "ci_marker_stale",
      remediation:
        `Marker is ${ageHours}h old (max 24h). Re-run ` +
        "`bash scripts/ci-check.sh` to refresh it before pulling a new " +
        "tarball.",
    };
  }
  return { ok: true };
}

// Serve a freshly-built tarball of the live zebvix-chain source + ops scripts
// on every request. Guarantees the VPS always pulls the latest pool.rs /
// state.rs / tokenomics.rs AND the latest deploy/admin scripts in one shot.
//
// Tarball layout (after `tar -xzf`):
//   ./src/...           (full Rust source, no target/, no .git)
//   ./Cargo.toml
//   ./scripts/*.sh      (optional — only if a top-level scripts/ exists)
//
// IMPORTANT: paths inside the tarball are RELATIVE to /home/zebvix-chain
// itself (i.e. `src/...`, NOT `zebvix-chain/src/...`). This matches the
// canonical VPS layout where the source root is `/home/zebvix-chain`, so a
// plain `cd /home/zebvix-chain && tar -xzf newchain.tgz` extracts in-place
// without nesting and without needing `--strip-components`.
function streamFreshTar(req: any, res: any) {
  const chainDir = path.join(WORKSPACE, "zebvix-chain");
  if (!fs.existsSync(chainDir)) {
    res.status(404).json({ error: "zebvix-chain source not found" });
    return;
  }
  // D-10 staleness gate. `?force=1` is an audited escape hatch.
  const force =
    req.query?.force === "1" ||
    req.query?.force === "true" ||
    req.query?.force === 1;
  const gate = checkCiGate();
  if (!gate.ok && !force) {
    res.status(503).json({
      error: "ci_gate_failed",
      gate_reason: gate.reason,
      remediation: gate.remediation,
      override_hint:
        "Re-run with `?force=1` to bypass (logged); only use when the gate " +
        "cannot be run on the dev host.",
    });
    return;
  }
  if (!gate.ok && force) {
    console.warn(
      `[download/newchain] CI GATE BYPASSED via ?force=1 — reason=${gate.reason} ` +
        `remediation="${gate.remediation}" ip=${req.ip ?? "?"} ua="${req.headers?.["user-agent"] ?? "?"}"`,
    );
  }
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="zebvix-chain-source.tar.gz"`,
  );
  res.setHeader("Cache-Control", "no-store");

  // Single tar invocation with `--transform` to strip the leading
  // `zebvix-chain/` prefix from chain entries while keeping `scripts/`
  // entries unchanged. This produces ONE valid tar.gz stream (no
  // multi-archive end-of-archive issues) that extracts in-place at
  // /home/zebvix-chain.
  const args: string[] = [
    "-czf", "-",
    "-C", WORKSPACE,
    "--exclude=zebvix-chain/target",
    "--exclude=zebvix-chain/.git",
    "--exclude=zebvix-chain/Cargo.lock",
    // The Replit .cargo/config.toml hard-pins LIBCLANG_PATH to a Nix store
    // path that does not exist on Ubuntu/Debian VPS — would break VPS build.
    // VPS has libclang at the standard /usr/lib/... path that bindgen finds
    // automatically, so we ship without any cargo config override.
    "--exclude=zebvix-chain/.cargo",
    "--exclude=scripts/node_modules",
    "--transform=s|^zebvix-chain/||",
    "--transform=s|^zebvix-chain$|.|",
    "zebvix-chain",
  ];
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

// ─────────────────────────────────────────────────────────────────────────────
// Bridge code update — fresh tarball of the BSC ↔ Zebvix bridge packages.
// Streams the live source on every request so the VPS always pulls the
// canonical version that matches what's running on Replit.
//
// Tarball layout (relative paths, extracts in-place at /opt/zebvix):
//   ./package.json
//   ./pnpm-workspace.yaml
//   ./pnpm-lock.yaml
//   ./.npmrc
//   ./tsconfig.base.json
//   ./lib/bridge-relayer/...
//   ./lib/bridge-signer/...
//   ./lib/bridge-deployment/...
//   ./lib/bsc-contracts/...      (incl deployments/bsc/MAINNET-LIVE.md)
//
// Excludes: node_modules, dist, .cache, hardhat artifacts, typechain-types,
// coverage. Total payload is small (~6 MB uncompressed, ~1 MB gzipped).
//
// VPS install workflow (one-shot updater):
//   cd /opt/zebvix
//   curl -fsSL "https://<dev-domain>/api/download/bridge" -o bridge.tgz
//   tar -tzf bridge.tgz | head            # preview
//   tar -xzf bridge.tgz                   # overwrite in-place
//   sudo VALIDATOR_COUNT=1 bash lib/bridge-deployment/install-vps.sh
function streamBridgeTar(_req: any, res: any) {
  const required = [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    ".npmrc",
    "tsconfig.base.json",
  ];
  for (const f of required) {
    if (!fs.existsSync(path.join(WORKSPACE, f))) {
      res.status(500).json({ error: `missing workspace file: ${f}` });
      return;
    }
  }
  const bridgeDirs = [
    "lib/bridge-relayer",
    "lib/bridge-signer",
    "lib/bridge-deployment",
    "lib/bsc-contracts",
  ];
  for (const d of bridgeDirs) {
    if (!fs.existsSync(path.join(WORKSPACE, d))) {
      res.status(500).json({ error: `missing bridge dir: ${d}` });
      return;
    }
  }

  res.setHeader("Content-Type", "application/gzip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="zebvix-bridge.tar.gz"`,
  );
  res.setHeader("Cache-Control", "no-store");

  const args: string[] = [
    "-czf", "-",
    "-C", WORKSPACE,
    // Exclude build/runtime artifacts — must come BEFORE the include list.
    "--exclude=**/node_modules",
    "--exclude=**/dist",
    "--exclude=**/.cache",
    "--exclude=**/coverage",
    "--exclude=**/.next",
    "--exclude=lib/bsc-contracts/artifacts",
    "--exclude=lib/bsc-contracts/cache",
    "--exclude=lib/bsc-contracts/typechain-types",
    "--exclude=lib/bridge-relayer/data",
    "--exclude=lib/bridge-relayer/relayer.sqlite*",
    "--exclude=*.log",
    // Include list — root workspace files + bridge packages.
    ...required,
    ...bridgeDirs,
  ];

  const tar = spawn("tar", args, { stdio: ["ignore", "pipe", "pipe"] });
  tar.stdout.pipe(res);
  tar.stderr.on("data", (d) => console.error("[bridge-tar]", d.toString()));
  tar.on("error", (e) => {
    console.error("[bridge-tar spawn error]", e);
    if (!res.headersSent) res.status(500).end();
  });
  tar.on("exit", (code) => {
    if (code !== 0) console.error("[bridge-tar exit]", code);
  });
}

downloadRouter.get("/download/bridge", streamBridgeTar);
// Friendly aliases.
downloadRouter.get("/download/bridge-latest", streamBridgeTar);

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
