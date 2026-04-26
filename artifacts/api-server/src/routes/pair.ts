import { Router, type IRouter } from "express";
import crypto from "crypto";

const router: IRouter = Router();

type SignRequest = {
  id: string;
  type: string;
  payload: any;
  createdAt: number;
  status: "pending" | "approved" | "rejected" | "error";
  result?: any;
  error?: string;
};

type Session = {
  id: string;
  secret: string;
  createdAt: number;
  lastEvent: number;
  paired: boolean;
  address?: string;
  payIdName?: string | null;
  meta?: Record<string, any>;
  requests: Map<string, SignRequest>;
};

const SESSIONS = new Map<string, Session>();
const TTL_MS = 15 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [k, s] of SESSIONS) {
    if (now - s.lastEvent > TTL_MS) SESSIONS.delete(k);
  }
}
setInterval(gc, 60_000).unref?.();

function newId(n = 16): string {
  return crypto.randomBytes(n).toString("hex");
}

function getSession(id: string): Session | null {
  const s = SESSIONS.get(id);
  if (!s) return null;
  if (Date.now() - s.lastEvent > TTL_MS) {
    SESSIONS.delete(id);
    return null;
  }
  return s;
}

function touch(s: Session) {
  s.lastEvent = Date.now();
}

// Web: create a new pairing session and return QR payload
router.post("/pair/init", (_req, res) => {
  const id = newId(8);
  const secret = newId(16);
  const s: Session = {
    id,
    secret,
    createdAt: Date.now(),
    lastEvent: Date.now(),
    paired: false,
    requests: new Map(),
  };
  SESSIONS.set(id, s);
  const payload = {
    v: 1,
    sid: id,
    sec: secret,
    chain: "zebvix",
    cid: 7878,
  };
  res.json({
    sessionId: id,
    secret,
    qr: "zbxconnect:" + Buffer.from(JSON.stringify(payload)).toString("base64url"),
    expiresAt: Date.now() + TTL_MS,
  });
});

// Web: poll session state
router.get("/pair/state/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) { res.status(404).json({ error: "session not found or expired" }); return; }
  res.json({
    sessionId: s.id,
    paired: s.paired,
    address: s.address ?? null,
    payIdName: s.payIdName ?? null,
    meta: s.meta ?? null,
    lastEvent: s.lastEvent,
  });
});

// Mobile: confirm pairing after scanning QR
router.post("/pair/connect/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) { res.status(404).json({ error: "session not found or expired" }); return; }
  const { secret, address, payIdName, meta } = req.body ?? {};
  if (secret !== s.secret) { res.status(401).json({ error: "invalid secret" }); return; }
  if (!address || typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    res.status(400).json({ error: "invalid address" }); return;
  }
  s.paired = true;
  s.address = address.toLowerCase();
  s.payIdName = payIdName ?? null;
  s.meta = meta ?? null;
  touch(s);
  res.json({ ok: true });
});

// Web: ask the mobile wallet to sign / approve a request
router.post("/pair/request/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) { res.status(404).json({ error: "session not found or expired" }); return; }
  if (!s.paired) { res.status(409).json({ error: "not paired" }); return; }
  const { type, payload } = req.body ?? {};
  if (!type) { res.status(400).json({ error: "missing type" }); return; }
  const reqId = newId(12);
  const r: SignRequest = {
    id: reqId,
    type,
    payload,
    createdAt: Date.now(),
    status: "pending",
  };
  s.requests.set(reqId, r);
  touch(s);
  res.json({ requestId: reqId });
});

// Mobile: long-poll for pending requests (since timestamp)
router.get("/pair/poll/:id", async (req, res) => {
  const s = getSession(req.params.id);
  if (!s) { res.status(404).json({ error: "session not found or expired" }); return; }
  const since = Number(req.query.since ?? 0) || 0;
  const wait = Math.min(Number(req.query.wait ?? 25_000) || 25_000, 25_000);
  touch(s);

  const find = () => {
    const out: SignRequest[] = [];
    for (const r of s.requests.values()) {
      if (r.status === "pending" && r.createdAt > since) out.push(r);
    }
    return out;
  };

  let pending = find();
  if (pending.length > 0) res.json({ requests: pending }); return;

  const start = Date.now();
  await new Promise<void>((resolve) => {
    const tick = setInterval(() => {
      if (!SESSIONS.has(s!.id)) {
        clearInterval(tick);
        return resolve();
      }
      pending = find();
      if (pending.length > 0 || Date.now() - start > wait) {
        clearInterval(tick);
        resolve();
      }
    }, 800);
  });
  res.json({ requests: pending });
});

// Mobile: respond to a request
router.post("/pair/respond/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) { res.status(404).json({ error: "session not found or expired" }); return; }
  const { requestId, status, result, error } = req.body ?? {};
  const r = s.requests.get(requestId);
  if (!r) { res.status(404).json({ error: "request not found" }); return; }
  if (!["approved", "rejected", "error"].includes(status)) {
    res.status(400).json({ error: "invalid status" }); return;
  }
  r.status = status;
  r.result = result;
  r.error = error;
  touch(s);
  res.json({ ok: true });
});

// Web: poll for the result of a specific request
router.get("/pair/result/:id/:requestId", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) { res.status(404).json({ error: "session not found or expired" }); return; }
  const r = s.requests.get(req.params.requestId);
  if (!r) { res.status(404).json({ error: "request not found" }); return; }
  res.json({
    id: r.id,
    type: r.type,
    status: r.status,
    result: r.result ?? null,
    error: r.error ?? null,
  });
});

// Mobile or Web: disconnect / delete session
router.post("/pair/disconnect/:id", (req, res) => {
  SESSIONS.delete(req.params.id);
  res.json({ ok: true });
});

export default router;
