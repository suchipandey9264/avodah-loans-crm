import { randomBytes } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { otps, roles, sessions } from "../db/schema.js";
import { db } from "../lib/db.js";
import { sha256 } from "../lib/http.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";
import { SYSTEM_ROLES } from "./permissions.js";

const CRM_URL = (process.env.CRM_URL ?? "http://localhost:5174").replace(/\/$/, "");
export const RESET_TTL_MS = 30 * 60 * 1000;
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const resetKey = (userId) => `reset:${userId}`;

/** Inserts the built-in roles that are missing. Existing rows are left alone so Settings edits survive restarts. */
/** Built-in roles are defined in permissions.js: insert missing ones and bring existing rows in line on every start. */
export async function ensureSystemRoles() {
  await db
    .insert(roles)
    .values(SYSTEM_ROLES.map((r) => ({ ...r, isSystem: true })))
    .onConflictDoUpdate({
      target: roles.id,
      set: { name: sql`excluded.name`, description: sql`excluded.description`, rank: sql`excluded.rank`, permissions: sql`excluded.permissions`, isSystem: true },
    });
}

/** What the CRM frontend gets for a staff member. Never includes the password hash. */
export const staffView = (user, role) => ({
  id: user.id,
  name: user.name ?? "",
  email: user.email,
  phone: user.phone ?? null,
  status: user.status,
  role: role ? { id: role.id, name: role.name, rank: role.rank } : null,
  permissions: role?.permissions ?? [],
  lastLoginAt: user.lastLoginAt ?? null,
  createdAt: user.createdAt,
  ...employeeFields(user.profile),
});
export const EMPLOYEE_FIELDS = ["department", "designation", "branch", "monthlyTarget", "joinedOn"];
export const employeeFields = (profile = {}) => Object.fromEntries(EMPLOYEE_FIELDS.map((k) => [k, profile?.[k] ?? null]));

/** Creates a single-use reset (or invite) token in `otps` and emails the link. Replaces any earlier token. */
export async function issueResetLink(user, { invite = false } = {}) {
  const token = randomBytes(32).toString("hex");
  const entry = { codeHash: sha256(token), tries: 0, expiresAt: new Date(Date.now() + (invite ? INVITE_TTL_MS : RESET_TTL_MS)) };
  await db.insert(otps).values({ identifier: resetKey(user.id), ...entry }).onConflictDoUpdate({ target: otps.identifier, set: entry });
  const link = `${CRM_URL}/reset-password?uid=${user.id}&token=${token}${invite ? "&invite=1" : ""}`;
  await sendPasswordResetEmail({ to: user.email, name: user.name, link, invite });
}

/** Deletes a user's staff sessions, optionally keeping one (the caller's own). Returns how many were removed. */
export async function revokeStaffSessions(userId, { except } = {}) {
  const where = [eq(sessions.userId, userId), eq(sessions.kind, "staff")];
  if (except) where.push(ne(sessions.tokenHash, except));
  const removed = await db.delete(sessions).where(and(...where)).returning({ id: sessions.id });
  return removed.length;
}
