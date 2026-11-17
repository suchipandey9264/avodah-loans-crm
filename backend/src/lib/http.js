import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { roles, sessions, users } from "../db/schema.js";
import { db } from "./db.js";

/** A staff session ends after this long without a request (CRM_IDLE_MINUTES, default 60). */
export const STAFF_IDLE_MS = Number(process.env.CRM_IDLE_MINUTES ?? 60) * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000; // write last_seen_at at most once a minute per session

export class HttpError extends Error {
  /** `extra.fields` maps field names to messages (set by validate.parse). */
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.fields = extra.fields;
  }
}

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/**
 * Reads the Bearer token. A staff session attaches req.staff + req.staffSession (CRM API).
 * Customer sessions left over from the old website are ignored.
 */
export async function session(req, _res, next) {
  req.staff = null;
  req.staffSession = null;
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return next();
  const tokenHash = sha256(token);
  const now = new Date();
  const [row] = await db
    .select({ session: sessions, user: users, role: roles })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return next();

  if (row.session.kind !== "staff") return next();

  // Staff: the account must still be active with a role, and the session must not have gone idle.
  const lastSeen = row.session.lastSeenAt ?? row.session.createdAt;
  if (row.user.status !== "active" || !row.role || now - lastSeen > STAFF_IDLE_MS) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return next();
  }
  if (now - lastSeen > TOUCH_EVERY_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, tokenHash));
  }
  req.staff = { ...row.user, role: row.role, permissions: row.role.permissions ?? [] };
  req.staffSession = { id: row.session.id, tokenHash };
  next();
}
