import { and, asc, count, desc, eq, gte, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Router } from "express";
import { z } from "zod";
import { followups, leads, roles, users } from "../../db/schema.js";
import { customerEvent } from "../../crm/customers.js";
import { leadEvent, leadScope, seesAllLeads } from "../../crm/leads.js";
import { can } from "../../crm/middleware.js";
import { hasPermission } from "../../crm/permissions.js";
import { followupChangeBody, followupListQuery, followupScheduleBody } from "../../crm/validate.js";
import { db } from "../../lib/db.js";
import { HttpError } from "../../lib/http.js";
import { parse } from "../../lib/validate.js";

// Follow-ups across leads and customers. Managers (leads.assign) see everyone's; other staff see the ones
// assigned to them. "Overdue" is not stored: it is a pending follow-up whose time has passed.

const r = Router();
const customer = alias(users, "customer");
const assignee = alias(users, "assignee");
const uuidOr404 = (raw) => {
  const ok = z.uuid().safeParse(raw);
  if (!ok.success) throw new HttpError(404, "Follow-up not found");
  return ok.data;
};
const TZ = process.env.CRM_TIMEZONE ?? "Asia/Kolkata"; // "today" follows the same clock as the dashboard
const endOfToday = sql`((date_trunc('day', now() at time zone ${TZ}) + interval '1 day') at time zone ${TZ})`;
const stateOf = (f, now = new Date()) => (f.status === "pending" && f.dueAt < now ? "overdue" : f.status);
const event = (tx, f, type, actorId, opts) => (f.leadId ? leadEvent(tx, f.leadId, type, actorId, opts) : customerEvent(tx, f.customerId, type, actorId, opts));

const COLUMNS = {
  id: followups.id, type: followups.type, dueAt: followups.dueAt, note: followups.note, status: followups.status, outcome: followups.outcome,
  completedAt: followups.completedAt, createdAt: followups.createdAt, assignedTo: followups.assignedTo, assignedName: assignee.name,
  leadId: followups.leadId, leadRef: leads.ref, customerId: followups.customerId, customerCode: customer.customerCode,
  name: sql`coalesce(${customer.name}, ${leads.name})`.mapWith(String).as("name"),
  phone: sql`coalesce(${customer.phone}, ${leads.phone})`.as("phone"),
};
const fromJoined = (tx = db, cols = COLUMNS) =>
  tx.select(cols).from(followups)
    .leftJoin(leads, eq(followups.leadId, leads.id))
    .leftJoin(customer, eq(followups.customerId, customer.id))
    .leftJoin(assignee, eq(followups.assignedTo, assignee.id));

/** Rows this staff member may see; follow-ups on deleted leads drop out unless they're also on a customer. */
function scopeWhere(req) {
  const w = [or(isNull(followups.leadId), isNull(leads.deletedAt), sql`${followups.customerId} is not null`)];
  if (!seesAllLeads(req.staff)) w.push(eq(followups.assignedTo, req.staff.id));
  return w;
}
function bucket(view, now = new Date()) {
  const pending = eq(followups.status, "pending");
  return {
    overdue: and(pending, lt(followups.dueAt, now)),
    today: and(pending, gte(followups.dueAt, now), lt(followups.dueAt, endOfToday)),
    upcoming: and(pending, gte(followups.dueAt, endOfToday)),
    done: eq(followups.status, "done"),
    cancelled: eq(followups.status, "cancelled"),
    all: undefined,
  }[view];
}

async function loadFollowup(req, id, tx = db) {
  const [row] = await fromJoined(tx, { f: followups }).where(and(eq(followups.id, id), ...scopeWhere(req))).limit(1);
  if (!row) throw new HttpError(404, "Follow-up not found");
  return row.f;
}

/** Someone a follow-up can be assigned to: active staff whose role works follow-ups. Non-managers can only pick themselves. */
async function checkAssignee(req, id) {
  if (id !== req.staff.id && !seesAllLeads(req.staff)) throw new HttpError(403, "You can only schedule follow-ups for yourself");
  const [ok] = await db.select({ id: users.id }).from(users).innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.id, id), eq(users.status, "active"), sql`(${roles.permissions} @> '["followups.view"]' or ${roles.permissions} @> '["*"]')`));
  if (!ok) throw new HttpError(400, "Choose an active employee who works follow-ups", { fields: { assignedTo: "Choose an active employee who works follow-ups" } });
}

/* ---------- list ---------- */

r.get("/followups/meta", can("followups.view"), async (req, res) => {
  const staff = seesAllLeads(req.staff)
    ? await db.select({ id: users.id, name: users.name }).from(users).innerJoin(roles, eq(users.roleId, roles.id))
        .where(and(eq(users.status, "active"), sql`(${roles.permissions} @> '["followups.view"]' or ${roles.permissions} @> '["*"]')`)).orderBy(asc(users.name))
    : [{ id: req.staff.id, name: req.staff.name }];
  res.json({ staff, canAssign: seesAllLeads(req.staff) });
});

/** GET /followups — one tab (overdue|today|upcoming|done|cancelled|all) plus counts for every tab. from/to feed the calendar. */
r.get("/followups", can("followups.view"), async (req, res) => {
  const f = parse(followupListQuery, req.query);
  const now = new Date();
  const w = scopeWhere(req);
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    w.push(or(ilike(leads.name, like), ilike(leads.phone, like), ilike(leads.ref, like), ilike(customer.name, like), ilike(customer.phone, like), ilike(customer.customerCode, like)));
  }
  if (f.type) w.push(eq(followups.type, f.type));
  if (f.assignee) w.push(eq(followups.assignedTo, f.assignee === "me" ? req.staff.id : f.assignee));
  if (f.leadId) w.push(eq(followups.leadId, f.leadId));
  if (f.customerId) w.push(eq(followups.customerId, f.customerId));
  if (f.from) w.push(gte(followups.dueAt, f.from));
  if (f.to) w.push(lt(followups.dueAt, f.to));
  const view = bucket(f.view, now);
  const where = and(...w, ...(view ? [view] : []));
  const closed = f.view === "done" || f.view === "cancelled";

  const monthAgo = new Date(now.getTime() - 30 * 86400000);
  const [items, [{ total }], [counts]] = await Promise.all([
    fromJoined().where(where)
      .orderBy(closed ? desc(followups.completedAt) : f.view === "all" ? desc(followups.dueAt) : asc(followups.dueAt))
      .limit(f.pageSize).offset((f.page - 1) * f.pageSize),
    fromJoined(db, { total: count() }).where(where),
    fromJoined(db, {
      overdue: sql`count(*) filter (where ${bucket("overdue", now)})`.mapWith(Number),
      today: sql`count(*) filter (where ${bucket("today", now)})`.mapWith(Number),
      upcoming: sql`count(*) filter (where ${bucket("upcoming", now)})`.mapWith(Number),
      done: sql`count(*) filter (where ${bucket("done", now)})`.mapWith(Number),
      cancelled: sql`count(*) filter (where ${bucket("cancelled", now)})`.mapWith(Number),
      // Completion rate: of the follow-ups due in the last 30 days that are done or overdue, how many were done.
      dueDone: sql`count(*) filter (where ${followups.status} = 'done' and ${followups.dueAt} >= ${monthAgo} and ${followups.dueAt} < ${now})`.mapWith(Number),
      dueMissed: sql`count(*) filter (where ${followups.status} = 'pending' and ${followups.dueAt} >= ${monthAgo} and ${followups.dueAt} < ${now})`.mapWith(Number),
    }).where(and(...w)),
  ]);
  const { dueDone, dueMissed, ...tabs } = counts;
  res.json({
    items: items.map((x) => ({ ...x, state: stateOf(x, now) })),
    total: Number(total), page: f.page, pageSize: f.pageSize,
    counts: { ...tabs, all: tabs.overdue + tabs.today + tabs.upcoming + tabs.done + tabs.cancelled },
    completionRate: dueDone + dueMissed ? Math.round((dueDone / (dueDone + dueMissed)) * 100) : null,
  });
});

/* ---------- schedule / change ---------- */

/** POST /followups — for one lead (in the caller's scope) or one customer. */
r.post("/followups", can("followups.create"), async (req, res) => {
  const body = parse(followupScheduleBody, req.body);
  let defaultTo = req.staff.id;
  if (body.leadId) {
    const scope = leadScope(req.staff);
    const [lead] = await db.select({ ownerId: leads.ownerId }).from(leads).where(and(eq(leads.id, body.leadId), isNull(leads.deletedAt), ...(scope ? [scope] : []))).limit(1);
    if (!lead) throw new HttpError(400, "Choose a lead you work with", { fields: { target: "Choose a lead you work with" } });
    if (seesAllLeads(req.staff) && lead.ownerId) defaultTo = lead.ownerId;
  } else {
    if (!hasPermission(req.staff.permissions, "customers.view")) throw new HttpError(403, "You don’t have permission to do that");
    const [cust] = await db.select({ rm: users.relationshipManagerId }).from(users).where(and(eq(users.id, body.customerId), isNull(users.roleId))).limit(1);
    if (!cust) throw new HttpError(400, "Choose a customer", { fields: { target: "Choose a customer" } });
    if (seesAllLeads(req.staff) && cust.rm) defaultTo = cust.rm;
  }
  const assignedTo = body.assignedTo ?? defaultTo;
  if (body.assignedTo) await checkAssignee(req, body.assignedTo);
  const [fu] = await db.transaction(async (tx) => {
    const row = await tx.insert(followups)
      .values({ leadId: body.leadId ?? null, customerId: body.customerId ?? null, type: body.type, dueAt: body.dueAt, note: body.note ?? null, assignedTo, createdBy: req.staff.id })
      .returning();
    await event(tx, row[0], "followup_scheduled", req.staff.id, { body: body.note ?? null, meta: { followupId: row[0].id, type: body.type, dueAt: body.dueAt } });
    return row;
  });
  res.status(201).json({ followup: { ...fu, state: "pending" } });
});

/** PATCH /followups/:id — reschedule / reassign / edit a pending follow-up, or close it (done | cancelled). */
r.patch("/followups/:id", can("followups.edit"), async (req, res) => {
  const id = uuidOr404(req.params.id);
  const body = parse(followupChangeBody, req.body);
  if (body.assignedTo) await checkAssignee(req, body.assignedTo);
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const fu = await loadFollowup(req, id, tx);
    const [locked] = await tx.select({ status: followups.status }).from(followups).where(eq(followups.id, id)).for("update");
    if (locked.status !== "pending") throw new HttpError(409, "This follow-up is already closed");
    if (body.status) {
      const [row] = await tx.update(followups).set({ status: body.status, outcome: body.outcome ?? null, completedAt: now, completedBy: req.staff.id, updatedAt: now }).where(eq(followups.id, id)).returning();
      if (body.status === "done" && fu.leadId) await tx.update(leads).set({ lastContactedAt: now }).where(eq(leads.id, fu.leadId));
      await event(tx, fu, body.status === "done" ? "followup_done" : "followup_cancelled", req.staff.id, { body: body.outcome ?? null, meta: { followupId: id, type: fu.type } });
      return row;
    }
    const { status: _s, outcome: _o, ...change } = body;
    const [row] = await tx.update(followups).set({ ...change, updatedAt: now }).where(eq(followups.id, id)).returning();
    const moved = body.dueAt && body.dueAt.getTime() !== fu.dueAt.getTime();
    await event(tx, fu, moved ? "followup_rescheduled" : "followup_updated", req.staff.id, {
      body: body.note ?? null,
      meta: { followupId: id, type: row.type, ...(moved ? { from: fu.dueAt, dueAt: body.dueAt } : {}), fields: Object.keys(change) },
    });
    return row;
  });
  res.json({ followup: { ...updated, state: stateOf(updated, now) } });
});

export default r;
