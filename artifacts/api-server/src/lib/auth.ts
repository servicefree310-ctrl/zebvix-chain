import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  const auth = getAuth(req);
  const userId =
    (auth?.sessionClaims as { userId?: string } | null)?.userId ??
    auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}

export function getUserId(req: Request): string | null {
  const auth = getAuth(req);
  return (
    (auth?.sessionClaims as { userId?: string } | null)?.userId ??
    auth?.userId ??
    null
  );
}
