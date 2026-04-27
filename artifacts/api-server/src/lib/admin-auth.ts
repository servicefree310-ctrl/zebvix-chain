import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function adminTokenConfigured(): boolean {
  const t = process.env["ADMIN_TOKEN"];
  return typeof t === "string" && t.length >= 8;
}

export function verifyAdminToken(provided: string | undefined): boolean {
  const expected = process.env["ADMIN_TOKEN"];
  if (!expected || expected.length < 8) return false;
  if (typeof provided !== "string" || provided.length === 0) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!adminTokenConfigured()) {
    res.status(503).json({
      error: "admin_not_configured",
      message:
        "ADMIN_TOKEN environment variable is not set on the server. Ask the operator to set it in Replit Secrets.",
    });
    return;
  }
  const header = req.header("x-admin-token") ?? "";
  if (!verifyAdminToken(header)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
