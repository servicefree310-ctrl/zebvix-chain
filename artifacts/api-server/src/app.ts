import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
// The Flutter app is built with `--base-href /api/mobile/` so absolute
// asset URLs match the proxy path.
// __dirname at runtime is artifacts/api-server/dist, so 3 levels up = workspace root
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
// SPA fallback for the Flutter web router (so refreshes on inner routes work).
app.get(/^\/api\/mobile(?:\/.*)?$/, (_req, res, next) => {
  res.sendFile(path.join(flutterWebDir, "index.html"), (err) => {
    if (err) next(err);
  });
});

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
