import type { IncomingMessage, Server } from "http";
import type { Socket } from "net";
import { randomUUID } from "crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "./logger";

interface Session {
  id: string;
  origin?: string;
  createdAt: number;
  expiresAt: number;
  dashboard?: WebSocket;
  mobile?: WebSocket;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 1000;
const MAX_MSG_BYTES = 64 * 1024; // 64 KB per relayed message
const MAX_SESSIONS_PER_IP_PER_MIN = 30;

const sessions = new Map<string, Session>();
const ipBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: IncomingMessage): string {
  const xf = (req.headers["x-forwarded-for"] as string | undefined) ?? "";
  const first = xf.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

export function checkSessionRateLimit(ip: string): boolean {
  const now = Date.now();
  const b = ipBuckets.get(ip);
  if (!b || b.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (b.count >= MAX_SESSIONS_PER_IP_PER_MIN) return false;
  b.count += 1;
  return true;
}

function gc() {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (s.expiresAt < now) {
      try {
        s.dashboard?.close();
      } catch {}
      try {
        s.mobile?.close();
      } catch {}
      sessions.delete(id);
    }
  }
  for (const [ip, b] of ipBuckets.entries()) {
    if (b.resetAt < now) ipBuckets.delete(ip);
  }
}
setInterval(gc, 60 * 1000).unref?.();

export function activeSessionCount(): number {
  return sessions.size;
}

export function createSession(origin?: string): {
  id: string;
  expiresAt: number;
} | null {
  if (sessions.size >= MAX_ACTIVE_SESSIONS) return null;
  const id = randomUUID();
  const now = Date.now();
  const session: Session = {
    id,
    origin,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(id, session);
  logger.info({ sessionId: id, origin }, "wc session created");
  return { id, expiresAt: session.expiresAt };
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export { clientIp };

export function attachWcRelay(server: Server): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MSG_BYTES,
  });

  wss.on(
    "connection",
    (ws: WebSocket, _req: IncomingMessage, sessionId: string, role: string) => {
      const s = sessions.get(sessionId);
      if (!s) {
        ws.close(4404, "session not found");
        return;
      }
      // Reject duplicate connection for the same role
      const occupied =
        role === "dashboard" ? s.dashboard : s.mobile;
      if (occupied && occupied.readyState === occupied.OPEN) {
        ws.close(4409, "role already connected");
        return;
      }

      if (role === "dashboard") {
        s.dashboard = ws;
      } else {
        s.mobile = ws;
      }
      logger.info({ sessionId, role }, "wc peer connected");

      ws.on("message", (data) => {
        // Validate JSON & basic shape before forwarding
        let raw: string;
        try {
          raw = data.toString("utf8");
        } catch {
          return;
        }
        if (raw.length > MAX_MSG_BYTES) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (
          !parsed ||
          typeof parsed !== "object" ||
          typeof (parsed as { type?: unknown }).type !== "string"
        ) {
          return;
        }
        const peer = role === "dashboard" ? s.mobile : s.dashboard;
        if (peer && peer.readyState === peer.OPEN) {
          try {
            peer.send(raw);
          } catch (e) {
            logger.warn({ err: e }, "wc relay forward failed");
          }
        }
      });

      const cleanup = () => {
        if (role === "dashboard") s.dashboard = undefined;
        else s.mobile = undefined;
        logger.info({ sessionId, role }, "wc peer disconnected");
        // If both peers are gone, drop the session immediately
        if (!s.dashboard && !s.mobile) {
          sessions.delete(sessionId);
          logger.info({ sessionId }, "wc session torn down");
        }
      };

      ws.on("close", cleanup);
      ws.on("error", (err) => {
        logger.warn({ err, sessionId, role }, "wc peer error");
      });

      try {
        ws.send(JSON.stringify({ type: "ready", role }));
      } catch {}
    },
  );

  server.on(
    "upgrade",
    (req: IncomingMessage, socket: Socket, head: Buffer) => {
      const url = req.url || "";
      const m = url.match(/^\/api\/wc\/relay\/([^/?]+)(?:\?(.*))?$/);
      if (!m) return; // not for us
      let sessionId: string;
      let role: string;
      try {
        sessionId = decodeURIComponent(m[1] ?? "");
        const qs = new URLSearchParams(m[2] ?? "");
        role = qs.get("role") ?? "mobile";
      } catch {
        socket.destroy();
        return;
      }
      if (role !== "dashboard" && role !== "mobile") {
        socket.destroy();
        return;
      }
      if (!sessions.has(sessionId)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, sessionId, role);
      });
    },
  );

  logger.info("wc relay attached");
}
