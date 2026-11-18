import { and, asc, count, desc, eq, gt, ilike, isNotNull, or, sql } from "drizzle-orm";
import { Router } from "express";
import { roles, sessions, users } from "../../db/schema.js";
import { EMPLOYEE_FIELDS, issueResetLink, revokeStaffSessions, staffView } from "../../crm/accounts.js";
import { audit } from "../../crm/audit.js";
import { can } from "../../crm/middleware.js";
import { MODULES, hasPermission } from "../../crm/permissions.js";
import { createUserBody, updateUserBody, userListQuery } from "../../crm/validate.js";
import { db } from "../../lib/db.js";
import { HttpError } from "../../lib/http.js";
import { hashPassword } from "../../lib/password.js";
import { parse } from "../../lib/validate.js";

// CRM staff accounts (Settings → Users) and the role list. Staff are rows in `users` with a role_id.

const r = Router();

/** Admin (the top role) may manage anyone, other admins included; everyone else only roles ranked below their own. */
const outranks = (actor, rank) => actor.role.id === "admin" || rank < actor.role.rank;

async function getRole(id) {
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) throw new HttpError(400, "Unknown role", { fields: { roleId: "Unknown role" } });
  return role;
}

async function getStaff(id) {
  const [row] = await db
    .select({ user: users, role: roles })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, "User not found");
  return row;
}

r.get("/roles", can("users.view", "roles.view"), async (_req, res) => {
  const rows = await db.select().from(roles).orderBy(desc(roles.rank));
  res.json({ roles: rows, modules: MODULES });
});

r.get("/users", can("users.view"), async (req, res) => {
  const { q, role, status, page, pageSize } = parse(userListQuery, req.query);
  const where = [isNotNull(users.roleId)];
  if (q) where.push(or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`), ilike(users.phone, `%${q}%`)));
  if (role) where.push(eq(users.roleId, role));
  if (status) where.push(eq(users.status, status));
  const live = db
    .select({ userId: sessions.userId, n: count().as("n") })
    .from(sessions)
    .where(and(eq(sessions.kind, "staff"), gt(sessions.expiresAt, new Date())))
    .groupBy(sessions.userId)
    .as("live");
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ user: users, role: roles, activeSessions: sql`coalesce(${live.n}, 0)`.mapWith(Number) })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .leftJoin(live, eq(live.userId, users.id))
      .where(and(...where))
      .orderBy(desc(roles.rank), asc(users.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(users).where(and(...where)),
  ]);
  res.json({
    users: rows.map(({ user, role, activeSessions }) => ({ ...staffView(user, role), activeSessions, locked: Boolean(user.lockedUntil && user.lockedUntil > new Date()) })),
    total,
    page,
    pageSize,
  });
});

/** POST /api/crm/users — with `password` the account is ready to use; without it the user is emailed an invite link. */
r.post("/users", can("users.create", "employees.create"), async (req, res) => {
  const body = parse(createUserBody, req.body);
  const role = await getRole(body.roleId);
  if (!outranks(req.staff, role.rank)) throw new HttpError(403, "You can’t create users with this role", { fields: { roleId: "Choose a role below your own" } });

  const [existing] = await db.select({ id: users.id, roleId: users.roleId }).from(users).where(eq(users.email, body.email)).limit(1);
  if (existing) {
    const msg = existing.roleId ? "A CRM user with this email already exists" : "This email belongs to a customer account on the website";
    throw new HttpError(409, msg, { fields: { email: msg } });
  }

  const [user] = await db
    .insert(users)
    .values({
      name: body.name,
      email: body.email,
      phone: body.phone ?? null,
      roleId: role.id,
      passwordHash: body.password ? await hashPassword(body.password) : null, // null: can't sign in until the invite link is used
      passwordChangedAt: body.password ? new Date() : null,
      profile: Object.fromEntries(EMPLOYEE_FIELDS.filter((k) => body[k] != null).map((k) => [k, body[k]])),
    })
    .returning();
  if (!body.password) await issueResetLink(user, { invite: true });
  await audit(req, "user.created", { entityType: "user", entityId: user.id, meta: { email: user.email, role: role.id, invited: !body.password } });
  res.status(201).json({ user: staffView(user, role), invited: !body.password });
});

r.patch("/users/:id", can("users.edit", "employees.edit"), async (req, res) => {
  const body = parse(updateUserBody, req.body);
  const { user, role } = await getStaff(req.params.id);
  const self = user.id === req.staff.id;
  if (self && (body.roleId || body.status)) throw new HttpError(403, "You can’t change your own role or status");
  if (!self && !outranks(req.staff, role.rank)) throw new HttpError(403, "You can’t edit users with this role");

  const changes = {};
  let newRole = role;
  if (body.roleId && body.roleId !== user.roleId) {
    newRole = await getRole(body.roleId);
    if (!outranks(req.staff, newRole.rank)) throw new HttpError(403, "You can’t assign this role", { fields: { roleId: "Choose a role below your own" } });
    changes.roleId = newRole.id;
  }
  if (body.status && body.status !== user.status) changes.status = body.status;
  if (body.name !== undefined && body.name !== user.name) changes.name = body.name;
  if (body.phone !== undefined && body.phone !== user.phone) changes.phone = body.phone;
  const work = EMPLOYEE_FIELDS.filter((k) => body[k] !== undefined && body[k] !== (user.profile?.[k] ?? null));
  // Merged in SQL so other profile keys (e.g. notification settings) written meanwhile aren't lost.
  if (work.length) changes.profile = sql`${users.profile} || ${JSON.stringify(Object.fromEntries(work.map((k) => [k, body[k]])))}::jsonb`;
  if (!Object.keys(changes).length) return res.json({ user: staffView(user, role) });

  const [updated] = await db.update(users).set(changes).where(eq(users.id, user.id)).returning();
  // Role or status changes take effect immediately: the user signs in again with the new access.
  const signedOut = changes.roleId || changes.status === "suspended" ? await revokeStaffSessions(user.id) : 0;

  if (changes.roleId) await audit(req, "user.role_changed", { entityType: "user", entityId: user.id, meta: { from: role.id, to: newRole.id } });
  if (changes.status) {
    const action = changes.status === "suspended" ? "user.suspended" : user.status === "pending" ? "user.approved" : "user.reactivated";
    await audit(req, action, { entityType: "user", entityId: user.id });
  }
  if (changes.name !== undefined || changes.phone !== undefined || work.length) {
    await audit(req, "user.updated", { entityType: "user", entityId: user.id, meta: { fields: [...Object.keys(changes).filter((k) => k === "name" || k === "phone"), ...work] } });
  }
  res.json({ user: staffView(updated, newRole), sessionsSignedOut: signedOut });
});

/** POST /api/crm/users/:id/reset-password — emails the user a reset link. */
r.post("/users/:id/reset-password", can("users.edit"), async (req, res) => {
  const { user, role } = await getStaff(req.params.id);
  if (user.id !== req.staff.id && !outranks(req.staff, role.rank)) throw new HttpError(403, "You can’t reset this user’s password");
  if (user.status !== "active") throw new HttpError(400, "Reactivate this user before sending a reset link");
  await issueResetLink(user, { invite: !user.passwordHash });
  await audit(req, "user.password_reset_sent", { entityType: "user", entityId: user.id });
  res.json({ ok: true });
});

/** DELETE /api/crm/users/:id/sessions — signs the user out everywhere. */
r.delete("/users/:id/sessions", can("users.edit"), async (req, res) => {
  const { user, role } = await getStaff(req.params.id);
  if (user.id !== req.staff.id && !outranks(req.staff, role.rank)) throw new HttpError(403, "You can’t sign this user out");
  const signedOut = await revokeStaffSessions(user.id, user.id === req.staff.id ? { except: req.staffSession.tokenHash } : {});
  await audit(req, "user.sessions_revoked", { entityType: "user", entityId: user.id, meta: { count: signedOut } });
  res.json({ ok: true, signedOut });
});

export default r;
