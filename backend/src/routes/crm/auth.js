import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { Router } from "express";
import { otps, roles, sessions, users } from "../../db/schema.js";
import { issueResetLink, RESET_TTL_MS, resetKey, revokeStaffSessions, staffView } from "../../crm/accounts.js";
import { audit, clientInfo } from "../../crm/audit.js";
import { requireStaff } from "../../crm/middleware.js";
import { changePasswordBody, forgotBody, loginBody, resetBody, signupBody } from "../../crm/validate.js";
import { db } from "../../lib/db.js";
import { HttpError, sha256, STAFF_IDLE_MS } from "../../lib/http.js";
import { crmForgotLimiter, crmLoginLimiter, crmResetLimiter, crmSignupLimiter } from "../../lib/limits.js";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../../lib/password.js";
import { parse } from "../../lib/validate.js";

// CRM staff authentication: email + password → opaque bearer token stored hashed in `sessions` (kind = "staff").

const r = Router();
const SESSION_TTL_MS = Number(process.env.CRM_SESSION_HOURS ?? 12) * 60 * 60 * 1000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const INVALID = "Invalid email or password";

async function findStaffByEmail(email) {
  const [row] = await db
    .select({ user: users, role: roles })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.email, email))
    .limit(1);
  return row?.user.roleId ? row : null; // customers (no role) can't use the CRM login
}

/** POST /api/crm/auth/login { email, password } → { token, expiresAt, user } */
r.post("/login", crmLoginLimiter, async (req, res) => {
  const { email, password } = parse(loginBody, req.body);
  const row = await findStaffByEmail(email);

  if (!row) {
    await verifyPassword(password, DUMMY_HASH); // same work as a real check, so timing doesn't reveal the email exists
    await audit(req, "auth.login_failed", { actorEmail: email, meta: { reason: "unknown_account" } });
    throw new HttpError(401, INVALID);
  }
  const { user, role } = row;
  const now = new Date();

  if (user.lockedUntil && user.lockedUntil > now) {
    await audit(req, "auth.login_blocked", { actor: user, meta: { reason: "locked", until: user.lockedUntil } });
    const minutes = Math.ceil((user.lockedUntil - now) / 60000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`);
  }

  // An invited user who hasn't set a password yet (password_hash null) fails like a wrong password.
  const ok = user.passwordHash ? await verifyPassword(password, user.passwordHash) : (await verifyPassword(password, DUMMY_HASH), false);
  if (!ok) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED;
    await db
      .update(users)
      .set(lock ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) } : { failedLogins: failed })
      .where(eq(users.id, user.id));
    await audit(req, "auth.login_failed", { actor: user, meta: { reason: "wrong_password", attempt: failed } });
    if (lock) await audit(req, "auth.account_locked", { actor: user, entityType: "user", entityId: user.id, meta: { minutes: LOCK_MS / 60000 } });
    throw new HttpError(401, INVALID);
  }

  // Only reveal "pending" or "suspended" to someone who knows the password.
  if (user.status !== "active") {
    await audit(req, "auth.login_failed", { actor: user, meta: { reason: user.status } });
    throw new HttpError(403, user.status === "pending" ? "Your account is waiting for an administrator to approve it." : "This account is suspended. Contact your administrator.");
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ tokenHash: sha256(token), userId: user.id, kind: "staff", lastSeenAt: now, expiresAt, ...clientInfo(req) });
  const [fresh] = await db
    .update(users)
    .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now })
    .where(eq(users.id, user.id))
    .returning();
  await audit(req, "auth.login", { actor: user });
  res.json({ token, expiresAt, user: staffView(fresh, role) });
});

/**
 * POST /api/crm/auth/signup { name, email, password } — requests an account. It starts "pending" with the lowest role
 * and no access until an admin approves it in Settings → Users. The reply is the same whether or not the email is
 * already taken, so the form can't be used to find out who has an account.
 */
r.post("/signup", crmSignupLimiter, async (req, res) => {
  const { name, email, password } = parse(signupBody, req.body);
  const passwordHash = await hashPassword(password); // hashed either way, so timing doesn't reveal a taken email
  const [user] = await db
    .insert(users)
    .values({ name, email, roleId: "viewer", status: "pending", passwordHash, passwordChangedAt: new Date() })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (user) await audit(req, "user.signup_requested", { actorEmail: email, entityType: "user", entityId: user.id, meta: { email } });
  res.status(202).json({ requested: true });
});

/** POST /api/crm/auth/logout — ends this session (no-op without one). */
r.post("/logout", async (req, res) => {
  if (req.staffSession) {
    await db.delete(sessions).where(eq(sessions.tokenHash, req.staffSession.tokenHash));
    await audit(req, "auth.logout");
  }
  res.json({ ok: true });
});

// The rules this server actually enforces, for the Security page.
const POLICY = {
  idleMinutes: STAFF_IDLE_MS / 60000,
  sessionHours: SESSION_TTL_MS / 3600000,
  minPasswordLength: 10,
  lockoutAttempts: MAX_FAILED,
  lockoutMinutes: LOCK_MS / 60000,
  resetLinkMinutes: RESET_TTL_MS / 60000,
};

r.get("/me", requireStaff, (req, res) => res.json({ user: staffView(req.staff, req.staff.role), policy: POLICY }));

/** POST /api/crm/auth/password { currentPassword, newPassword } — signs out every other session. */
r.post("/password", requireStaff, async (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordBody, req.body);
  if (!(await verifyPassword(currentPassword, req.staff.passwordHash))) {
    await audit(req, "auth.password_change_failed");
    throw new HttpError(400, "Current password is incorrect", { fields: { currentPassword: "Current password is incorrect" } });
  }
  if (currentPassword === newPassword) {
    throw new HttpError(400, "Choose a password you haven’t used here", { fields: { newPassword: "Must differ from your current password" } });
  }
  await db.update(users).set({ passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() }).where(eq(users.id, req.staff.id));
  const signedOut = await revokeStaffSessions(req.staff.id, { except: req.staffSession.tokenHash });
  await audit(req, "auth.password_changed", { entityType: "user", entityId: req.staff.id, meta: { otherSessionsSignedOut: signedOut } });
  res.json({ ok: true, otherSessionsSignedOut: signedOut });
});

/* ---------- forgot / reset ---------- */

const FORGOT_REPLY = { ok: true, message: "If that email belongs to a CRM account, a reset link is on its way." };

/** POST /api/crm/auth/forgot { email } — same reply whether or not the account exists. */
r.post("/forgot", crmForgotLimiter, async (req, res) => {
  const { email } = parse(forgotBody, req.body);
  const row = await findStaffByEmail(email);
  if (row && row.user.status === "active") {
    await issueResetLink(row.user);
    await audit(req, "auth.password_reset_requested", { actor: row.user, entityType: "user", entityId: row.user.id });
  } else {
    await audit(req, "auth.password_reset_requested", { actorEmail: email, meta: { matched: false } });
  }
  res.json(FORGOT_REPLY);
});

/** POST /api/crm/auth/reset { uid, token, password } — single-use; signs out every session for that user. */
r.post("/reset", crmResetLimiter, async (req, res) => {
  const { uid, token, password } = parse(resetBody, req.body);
  const invalid = new HttpError(400, "This reset link is invalid or has expired. Request a new one.");
  const [entry] = await db.select().from(otps).where(eq(otps.identifier, resetKey(uid))).limit(1);
  if (!entry || entry.expiresAt < new Date() || entry.tries >= 5) throw invalid;
  if (entry.codeHash !== sha256(token)) {
    await db.update(otps).set({ tries: sql`${otps.tries} + 1` }).where(eq(otps.identifier, resetKey(uid)));
    throw invalid;
  }
  const [user] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null })
    .where(and(eq(users.id, uid), isNotNull(users.roleId)))
    .returning();
  await db.delete(otps).where(eq(otps.identifier, resetKey(uid)));
  if (!user) throw invalid;
  const signedOut = await revokeStaffSessions(uid);
  await audit(req, "auth.password_reset", { actor: user, entityType: "user", entityId: uid, meta: { sessionsSignedOut: signedOut } });
  res.json({ ok: true });
});

/* ---------- my sessions ---------- */

r.get("/sessions", requireStaff, async (req, res) => {
  const rows = await db
    .select({ id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.userId, req.staff.id), eq(sessions.kind, "staff"), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
  res.json({ sessions: rows.map((s) => ({ ...s, current: s.id === req.staffSession.id })) });
});

/** DELETE /api/crm/auth/sessions — signs out every session except this one. */
r.delete("/sessions", requireStaff, async (req, res) => {
  const signedOut = await revokeStaffSessions(req.staff.id, { except: req.staffSession.tokenHash });
  await audit(req, "session.revoked_others", { meta: { count: signedOut } });
  res.json({ ok: true, signedOut });
});

r.delete("/sessions/:id", requireStaff, async (req, res) => {
  const removed = await db
    .delete(sessions)
    .where(and(eq(sessions.id, req.params.id), eq(sessions.userId, req.staff.id), eq(sessions.kind, "staff")))
    .returning({ id: sessions.id });
  if (!removed.length) throw new HttpError(404, "Session not found");
  await audit(req, "session.revoked", { entityType: "session", entityId: req.params.id });
  res.json({ ok: true });
});

export default r;
