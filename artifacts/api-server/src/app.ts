import express, { type Express, type Request } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Hide framework fingerprint.
app.disable("x-powered-by");

// Trust the Replit / proxy chain so rate-limit + req.ip work correctly.
app.set("trust proxy", 1);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

// Mount under /api/downloads so it survives the path-based artifact proxy
// (api-server's previewPath is /api).
app.use("/api/downloads", express.static(path.join(publicDir, "downloads"), {
  setHeaders: (res, filePath) => {
    res.setHeader("Cache-Control", "no-store");
    if (filePath.endsWith(".sh")) {
      res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
    }
  },
}));

// Serve the Flutter web build of the mobile wallet under /api/mobile/.
const flutterWebDir = path.resolve(
  __dirname,
  "../../../mobile/zebvix_wallet/build/web",
);
app.use(
  "/api/mobile",
  express.static(flutterWebDir, {
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
    },
  }),
);
// SPA fallback for the Flutter web router.
app.get(/^\/api\/mobile(?:\/.*)?$/, (_req, res, next) => {
  res.sendFile(path.join(flutterWebDir, "index.html"), (err) => {
    if (err) next(err);
  });
});

// ── Security middleware ────────────────────────────────────────────────────
// Helmet with cross-origin friendly defaults so the dashboard (different
// path-prefix on the Replit proxy) and the Flutter web build can call us.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }),
);

// CORS allow-list. In dev we accept anything; in prod we honour
// CORS_ALLOWED_ORIGINS (comma-separated) and always allow same-origin
// (no-Origin) requests.
const allowList = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const allowSuffixes = [".replit.dev", ".replit.app", ".repl.co"];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (process.env.NODE_ENV !== "production") return cb(null, true);
      if (allowList.includes(origin)) return cb(null, true);
      try {
        const host = new URL(origin).host;
        if (allowSuffixes.some((s) => host.endsWith(s))) return cb(null, true);
      } catch {
        // fall-through
      }
      cb(new Error(`origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  }),
);

// Sensible body size cap.
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Rate-limit: tighter on mutating / relay endpoints, looser elsewhere.
const keyByIp = (req: Request) => req.ip ?? "unknown";

const tightLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: keyByIp,
  message: { error: "rate_limited", retryAfterSec: 60 },
});

const looseLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: keyByIp,
  message: { error: "rate_limited", retryAfterSec: 60 },
  // Skip routes that already have a tighter limiter so they don't get
  // double-counted toward both budgets.
  skip: (req) =>
    req.path.startsWith("/wc") || req.path.startsWith("/tokens/register"),
});

app.use("/api/wc", tightLimiter);
app.use("/api/tokens/register", tightLimiter);
app.use("/api", looseLimiter);

app.use("/api", router);

export default app;
