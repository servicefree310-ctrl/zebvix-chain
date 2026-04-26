import { Router, type IRouter } from "express";
import {
  checkSessionRateLimit,
  clientIp,
  createSession,
  getSession,
} from "../lib/wc-relay";

const router: IRouter = Router();

// Create a new wallet-connect session.
router.post("/wc/sessions", (req, res) => {
  const ip = clientIp(req);
  if (!checkSessionRateLimit(ip)) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  const origin = (req.body?.origin as string | undefined) ??
    (req.headers["origin"] as string | undefined);
  const created = createSession(origin);
  if (!created) {
    res.status(503).json({ error: "session capacity reached" });
    return;
  }
  const { id, expiresAt } = created;

  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.headers["host"] || "localhost";
  const wsProto = proto === "https" ? "wss" : "ws";
  const relayBase = `${wsProto}://${host}/api/wc/relay`;

  const params = new URLSearchParams({ id, relay: relayBase });
  if (origin) params.set("origin", origin);
  const uri = `zbx://wc?${params.toString()}`;

  res.json({
    id,
    expiresAt,
    relayUrl: `${relayBase}/${id}`,
    uri,
  });
});

router.get("/wc/sessions/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({
    id: s.id,
    origin: s.origin,
    expiresAt: s.expiresAt,
    dashboardConnected: !!s.dashboard,
    mobileConnected: !!s.mobile,
  });
});

export default router;
