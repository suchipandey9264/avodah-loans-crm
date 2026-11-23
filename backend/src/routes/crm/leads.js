import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Router } from "express";
import { z } from "zod";
import {
  applications, followups, LEAD_SOURCES, LEAD_STATUSES, leads, lenders, roles, timelineEvents, users,
} from "../../db/schema.js";
import { audit } from "../../crm/audit.js";
import { customerEvent } from "../../crm/customers.js";
import { autoOwner, CONVERTIBLE, leadEvent, leadScope, OPEN, seesAllLeads, SOURCE_LABELS, STATUS_LABELS } from "../../crm/leads.js";
import { can } from "../../crm/middleware.js";
import { hasPermission } from "../../crm/permissions.js";
import {
  bulkLeadBody, convertBody, followupBody, followupUpdateBody, leadCreateBody, leadListQuery, leadUpdateBody, noteBody,
} from "../../crm/validate.js";
import { EMPLOYMENT, LOAN_TYPES } from "../../data/loans.js";
import { db } from "../../lib/db.js";
import { HttpError } from "../../lib/http.js";
import { parse } from "../../lib/validate.js";

// CRM lead management. Every route checks a permission, and every query is limited to the leads the
// signed-in staff member may see (crm/leads.js `leadScope`). Deleting is soft; history is never removed.

const r = Router();
const owner = alias(users, "owner");
const actor = alias(users, "actor");
const typeLabel = (id) => LOAN_TYPES.find((t) => t.id === id)?.label ?? id;
const has = (req, p) => hasPermission(req.staff.permissions, p);
const like = (q) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const leadId = (raw) => {
  const ok = z.uuid().safeParse(raw);
  if (!ok.success) throw new HttpError(404, "Lead not found");
  return ok.data;
};

const COLUMNS = {
  id: leads.id, ref: leads.ref, kind: leads.kind, name: leads.name, phone: leads.phone, email: leads.email, city: leads.city,
  loanType: leads.loanType, loanAmount: leads.loanAmount, annualIncome: leads.annualIncome, employment: leads.employment,
  source: leads.source, status: leads.status, message: leads.message, lostReason: leads.lostReason,
  ownerId: leads.ownerId, ownerName: owner.name, lastContactedAt: leads.lastContactedAt, convertedAt: leads.convertedAt,
  createdAt: leads.createdAt, updatedAt: leads.updatedAt, applicationId: applications.id, applicationRef: applications.ref,
};
const baseSelect = (tx = db) =>
  tx.select(COLUMNS).from(leads).leftJoin(owner, eq(leads.ownerId, owner.id)).leftJoin(applications, eq(applications.leadId, leads.id));

/** WHERE for the list, board and export. `withStatus: false` is used for the per-status counts. */
function listWhere(req, f, { withStatus = true } = {}) {
  const w = [isNull(leads.deletedAt)];
  const scope = leadScope(req.staff);
  if (scope) w.push(scope);
  if (f.q) w.push(or(ilike(leads.name, like(f.q)), ilike(leads.phone, like(f.q)), ilike(leads.email, like(f.q)), ilike(leads.ref, like(f.q))));
  if (withStatus && f.status) w.push(eq(leads.status, f.status));
  if (f.source) w.push(eq(leads.source, f.source));
  if (f.city) w.push(ilike(leads.city, f.city.replace(/[\\%_]/g, "\\$&")));
  if (f.loanType) w.push(eq(leads.loanType, f.loanType));
  if (f.owner === "unassigned") w.push(isNull(leads.ownerId));
  else if (f.owner === "me") w.push(eq(leads.ownerId, req.staff.id));
  else if (f.owner) w.push(eq(leads.ownerId, f.owner));
  return and(...w);
}

const SORT = { created: leads.createdAt, updated: leads.updatedAt, name: leads.name, amount: leads.loanAmount, lastContact: leads.lastContactedAt };
const orderBy = (f) => [sql`${SORT[f.sort]} ${sql.raw(f.dir === "asc" ? "asc" : "desc")} nulls last`, desc(leads.id)];

/** Loads a lead the staff member may see (not deleted), or 404. Pass `lock` inside a transaction to lock the row. */
async function loadLead(req, id, tx = db, { lock = false } = {}) {
  const scope = leadScope(req.staff);
  let q = tx.select().from(leads).where(and(eq(leads.id, id), isNull(leads.deletedAt), ...(scope ? [scope] : []))).limit(1);
  if (lock) q = q.for("update");
  const [row] = await q;
  if (!row) throw new HttpError(404, "Lead not found");
  return row;
}

/** Staff who can own leads: active, with a role that can view leads. */
async function assignableStaff() {
  return db
    .select({ id: users.id, name: users.name, roleName: roles.name })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.status, "active"), sql`(${roles.permissions} @> '["leads.view"]' or ${roles.permissions} @> '["*"]')`))
    .orderBy(asc(users.name));
}
async function checkOwner(id) {
  const staff = await assignableStaff();
  const found = staff.find((s) => s.id === id);
  if (!found) throw new HttpError(400, "Choose an active employee who can work leads", { fields: { ownerId: "Choose an active employee who can work leads" } });
  return found;
}

/** An open (not converted, lost or deleted) lead with this phone number, other than `exceptId`. */
async function openDuplicate(phone, exceptId) {
  const [dup] = await db
    .select({ id: leads.id, ref: leads.ref, name: leads.name })
    .from(leads)
    .where(and(eq(leads.phone, phone), isNull(leads.deletedAt), inArray(leads.status, OPEN), ...(exceptId ? [ne(leads.id, exceptId)] : [])))
    .limit(1);
  if (dup) {
    const msg = `${dup.ref} (${dup.name}) is already open for this number`;
    throw new HttpError(409, msg, { fields: { phone: msg }, });
  }
}

/* ---------- lists ---------- */

r.get("/leads/meta", can("leads.view"), async (req, res) => {
  const [staff, cityRows, lenderRows] = await Promise.all([
    assignableStaff(),
    db.execute(sql`select distinct initcap(trim(city)) as city from leads where city is not null and trim(city) <> '' and deleted_at is null order by 1 limit 200`),
    db.select({ id: lenders.id, name: lenders.name, kind: lenders.kind }).from(lenders).where(eq(lenders.active, true)).orderBy(asc(lenders.sortOrder), asc(lenders.name)),
  ]);
  res.json({
    statuses: LEAD_STATUSES.map((id) => ({ id, label: STATUS_LABELS[id] })),
    sources: LEAD_SOURCES.map((id) => ({ id, label: SOURCE_LABELS[id] })),
    loanTypes: LOAN_TYPES.map((t) => ({ id: t.id, label: t.label })),
    employment: EMPLOYMENT.map((e) => ({ id: e.id, label: e.label })),
    cities: cityRows.rows.map((x) => x.city),
    owners: seesAllLeads(req.staff) ? staff : staff.filter((s) => s.id === req.staff.id),
    lenders: has(req, "applications.create") ? lenderRows : [],
    convertible: CONVERTIBLE,
  });
});

r.get("/leads", can("leads.view"), async (req, res) => {
  const f = parse(leadListQuery, req.query);
  const where = listWhere(req, f);
  const [rows, [{ total }], counts] = await Promise.all([
    baseSelect().where(where).orderBy(...orderBy(f)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
    db.select({ total: count() }).from(leads).where(where),
    db.select({ status: leads.status, n: count() }).from(leads).where(listWhere(req, f, { withStatus: false })).groupBy(leads.status),
  ]);
  const statusCounts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  for (const c of counts) statusCounts[c.status] = c.n;
  res.json({ leads: rows, total, page: f.page, pageSize: f.pageSize, statusCounts });
});

r.get("/leads/board", can("leads.view"), async (req, res) => {
  const f = parse(leadListQuery, req.query);
  const columns = await Promise.all(
    LEAD_STATUSES.map(async (status) => {
      const where = and(listWhere(req, f, { withStatus: false }), eq(leads.status, status));
      const [rows, [agg]] = await Promise.all([
        baseSelect().where(where).orderBy(desc(leads.updatedAt), desc(leads.id)).limit(50),
        db.select({ n: count(), amount: sql`coalesce(sum(${leads.loanAmount}), 0)`.mapWith(Number) }).from(leads).where(where),
      ]);
      return { status, label: STATUS_LABELS[status], count: agg.n, amount: agg.amount, leads: rows };
    })
  );
  res.json({ columns });
});

const csvCell = (v) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // stop spreadsheet formula injection
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

r.get("/leads/export", can("leads.export"), async (req, res) => {
  const f = parse(leadListQuery, req.query);
  const rows = await baseSelect().where(listWhere(req, f)).orderBy(...orderBy(f)).limit(5000);
  const head = ["Lead ID", "Name", "Phone", "Email", "City", "Loan type", "Loan amount", "Annual income", "Employment", "Source", "Status", "Owner", "Last contact", "Created", "Application"];
  const body = rows.map((l) =>
    [l.ref, l.name, l.phone, l.email, l.city, l.loanType && typeLabel(l.loanType), l.loanAmount, l.annualIncome, l.employment, SOURCE_LABELS[l.source], STATUS_LABELS[l.status], l.ownerName, l.lastContactedAt, l.createdAt, l.applicationRef]
      .map(csvCell)
      .join(",")
  );
  await audit(req, "leads.exported", { meta: { rows: rows.length, filters: Object.fromEntries(Object.entries(f).filter(([k, v]) => v != null && !["page", "pageSize"].includes(k))) } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + [head.join(","), ...body].join("\r\n"));
});

/* ---------- one lead ---------- */

r.get("/leads/:id", can("leads.view"), async (req, res) => {
  const id = leadId(req.params.id);
  const scope = leadScope(req.staff);
  const [lead] = await baseSelect().where(and(eq(leads.id, id), isNull(leads.deletedAt), ...(scope ? [scope] : []))).limit(1);
  if (!lead) throw new HttpError(404, "Lead not found");
  const creatorRow = alias(users, "creator");
  const assignee = alias(users, "assignee");
  const [[extra], fups, events, customer] = await Promise.all([
    db.select({ createdByName: creatorRow.name, userId: leads.userId }).from(leads).leftJoin(creatorRow, eq(leads.createdBy, creatorRow.id)).where(eq(leads.id, id)),
    db
      .select({ id: followups.id, type: followups.type, dueAt: followups.dueAt, note: followups.note, status: followups.status, outcome: followups.outcome, completedAt: followups.completedAt, assignedTo: followups.assignedTo, assignedName: assignee.name })
      .from(followups).leftJoin(assignee, eq(followups.assignedTo, assignee.id))
      .where(eq(followups.leadId, id)).orderBy(desc(followups.dueAt)),
    db
      .select({ id: timelineEvents.id, type: timelineEvents.type, body: timelineEvents.body, meta: timelineEvents.meta, createdAt: timelineEvents.createdAt, actorName: actor.name })
      .from(timelineEvents).leftJoin(actor, eq(timelineEvents.actorId, actor.id))
      .where(and(eq(timelineEvents.entityType, "lead"), eq(timelineEvents.entityId, id))).orderBy(desc(timelineEvents.createdAt)),
    db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email }).from(users).innerJoin(leads, eq(leads.userId, users.id)).where(and(eq(leads.id, id), isNull(users.roleId))),
  ]);
  const now = new Date();
  res.json({
    lead: { ...lead, createdByName: extra.createdByName },
    customer: customer[0] ?? null,
    followups: fups.map((f) => ({ ...f, state: f.status === "pending" && f.dueAt < now ? "overdue" : f.status })),
    timeline: events,
  });
});

r.post("/leads", can("leads.create"), async (req, res) => {
  const body = parse(leadCreateBody, req.body);
  await openDuplicate(body.phone);

  // Without leads.assign you can only create leads for yourself.
  let ownerRow = null;
  let auto = false;
  if (!seesAllLeads(req.staff)) {
    if (body.ownerId && body.ownerId !== "auto" && body.ownerId !== req.staff.id) throw new HttpError(403, "You can’t assign leads to other employees");
    ownerRow = { id: req.staff.id, name: req.staff.name };
  } else if (body.ownerId === undefined || body.ownerId === "auto") {
    ownerRow = await autoOwner();
    auto = true;
  } else if (body.ownerId) {
    ownerRow = await checkOwner(body.ownerId);
  }

  const { ownerId: _o, ...fields } = body;
  const lead = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(leads)
      .values({ ...fields, kind: "crm", status: "new", createdBy: req.staff.id, ownerId: ownerRow?.id ?? null, assignedAt: ownerRow ? new Date() : null })
      .returning();
    if (ownerRow) await leadEvent(tx, row.id, "assigned", req.staff.id, { meta: { to: ownerRow.id, toName: ownerRow.name, auto } });
    return row;
  });
  await audit(req, "lead.created", { entityType: "lead", entityId: lead.id, meta: { ref: lead.ref, owner: ownerRow?.id ?? null, auto } });
  res.status(201).json({ lead: { ...lead, ownerName: ownerRow?.name ?? null } });
});

const EDITABLE = ["name", "phone", "email", "city", "loanType", "loanAmount", "annualIncome", "employment", "source", "message"];

r.patch("/leads/:id", can("leads.edit"), async (req, res) => {
  const id = leadId(req.params.id);
  const body = parse(leadUpdateBody, req.body);
  const lead = await loadLead(req, id);
  if (lead.status === "converted") throw new HttpError(409, "This lead has been converted. Its details are kept as they were; add notes or follow-ups instead.");
  if (body.status === "converted") throw new HttpError(400, "Use “Convert to application” to convert a lead", { fields: { status: "Use “Convert to application”" } });
  if (body.status === "lost" && lead.status !== "lost" && !body.lostReason) throw new HttpError(400, "Say why the lead was lost", { fields: { lostReason: "Say why the lead was lost" } });
  if (body.ownerId !== undefined && body.ownerId !== lead.ownerId && !seesAllLeads(req.staff)) throw new HttpError(403, "You can’t reassign leads");
  if (body.phone && body.phone !== lead.phone) await openDuplicate(body.phone, id);
  const newOwner = body.ownerId ? await checkOwner(body.ownerId) : null;

  const set = {};
  const changes = {};
  for (const k of EDITABLE) {
    if (body[k] !== undefined && body[k] !== lead[k]) {
      set[k] = body[k];
      changes[k] = { from: lead[k], to: body[k] };
    }
  }
  const statusChanged = body.status && body.status !== lead.status;
  if (statusChanged) {
    set.status = body.status;
    set.handled = body.status !== "new";
    set.lostReason = body.status === "lost" ? body.lostReason : null;
    if (lead.status === "new" && !lead.lastContactedAt) set.lastContactedAt = new Date();
  } else if (body.lostReason && lead.status === "lost" && body.lostReason !== lead.lostReason) {
    set.lostReason = body.lostReason;
    changes.lostReason = { from: lead.lostReason, to: body.lostReason };
  }
  const ownerChanged = body.ownerId !== undefined && body.ownerId !== lead.ownerId;
  if (ownerChanged) {
    set.ownerId = body.ownerId;
    set.assignedAt = body.ownerId ? new Date() : null;
  }
  if (!Object.keys(set).length) return res.json({ lead: (await baseSelect().where(eq(leads.id, id)))[0] });

  await db.transaction(async (tx) => {
    await tx.update(leads).set(set).where(eq(leads.id, id));
    if (Object.keys(changes).length) await leadEvent(tx, id, "updated", req.staff.id, { meta: { changes } });
    if (statusChanged) await leadEvent(tx, id, "status_changed", req.staff.id, { meta: { from: lead.status, to: body.status, reason: set.lostReason ?? undefined } });
    if (ownerChanged) await leadEvent(tx, id, "assigned", req.staff.id, { meta: { from: lead.ownerId, to: body.ownerId, toName: newOwner?.name ?? null } });
  });
  await audit(req, "lead.updated", { entityType: "lead", entityId: id, meta: { ref: lead.ref, fields: Object.keys(set) } });
  res.json({ lead: (await baseSelect().where(eq(leads.id, id)))[0] });
});

r.delete("/leads/:id", can("leads.delete"), async (req, res) => {
  const id = leadId(req.params.id);
  const lead = await loadLead(req, id);
  if (lead.status === "converted") throw new HttpError(409, "Converted leads can’t be deleted: they’re linked to an application.");
  await db.transaction(async (tx) => {
    await tx.update(leads).set({ deletedAt: new Date(), deletedBy: req.staff.id }).where(eq(leads.id, id));
    await leadEvent(tx, id, "deleted", req.staff.id);
  });
  await audit(req, "lead.deleted", { entityType: "lead", entityId: id, meta: { ref: lead.ref, name: lead.name } });
  res.json({ ok: true });
});

/* ---------- notes & follow-ups ---------- */

r.post("/leads/:id/notes", can("leads.edit"), async (req, res) => {
  const id = leadId(req.params.id);
  const { body } = parse(noteBody, req.body);
  await loadLead(req, id);
  const [event] = await db.transaction(async (tx) => {
    await tx.update(leads).set({ lastContactedAt: new Date() }).where(eq(leads.id, id));
    return leadEvent(tx, id, "note", req.staff.id, { body }).returning();
  });
  res.status(201).json({ event: { ...event, actorName: req.staff.name } });
});

r.post("/leads/:id/followups", can("followups.create"), async (req, res) => {
  const id = leadId(req.params.id);
  const body = parse(followupBody, req.body);
  const lead = await loadLead(req, id);
  const assignedTo = body.assignedTo ?? lead.ownerId ?? req.staff.id;
  if (body.assignedTo && body.assignedTo !== req.staff.id && !seesAllLeads(req.staff)) throw new HttpError(403, "You can only schedule follow-ups for yourself");
  if (body.assignedTo) await checkOwner(body.assignedTo);
  const [fu] = await db.transaction(async (tx) => {
    const row = await tx.insert(followups).values({ leadId: id, type: body.type, dueAt: body.dueAt, note: body.note ?? null, assignedTo, createdBy: req.staff.id }).returning();
    await leadEvent(tx, id, "followup_scheduled", req.staff.id, { body: body.note ?? null, meta: { followupId: row[0].id, type: body.type, dueAt: body.dueAt } });
    return row;
  });
  res.status(201).json({ followup: { ...fu, state: "pending" } });
});

r.patch("/leads/:id/followups/:fid", can("followups.edit"), async (req, res) => {
  const id = leadId(req.params.id);
  const fid = leadId(req.params.fid);
  const body = parse(followupUpdateBody, req.body);
  await loadLead(req, id);
  const [fu] = await db.select().from(followups).where(and(eq(followups.id, fid), eq(followups.leadId, id))).limit(1);
  if (!fu) throw new HttpError(404, "Follow-up not found");
  if (fu.status !== "pending") throw new HttpError(409, "This follow-up is already closed");
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const row = await tx.update(followups).set({ status: body.status, outcome: body.outcome ?? null, completedAt: now, completedBy: req.staff.id }).where(eq(followups.id, fid)).returning();
    if (body.status === "done") await tx.update(leads).set({ lastContactedAt: now }).where(eq(leads.id, id));
    await leadEvent(tx, id, body.status === "done" ? "followup_done" : "followup_cancelled", req.staff.id, { body: body.outcome ?? null, meta: { followupId: fid, type: fu.type } });
    return row;
  });
  res.json({ followup: { ...updated, state: updated.status } });
});

/* ---------- bulk ---------- */

r.post("/leads/bulk", can("leads.view"), async (req, res) => {
  const body = parse(bulkLeadBody, req.body);
  const need = { assign: "leads.assign", status: "leads.edit", delete: "leads.delete" }[body.action];
  if (!has(req, need)) throw new HttpError(403, "You don’t have permission to do that");
  if (body.action === "status" && body.status === "lost" && !body.lostReason) throw new HttpError(400, "Say why these leads were lost", { fields: { lostReason: "Say why these leads were lost" } });
  const target = body.action === "assign" && body.ownerId ? await checkOwner(body.ownerId) : null;

  const scope = leadScope(req.staff);
  // Converted leads are never changed in bulk; leads the user can't see are ignored.
  const rows = await db
    .select({ id: leads.id, status: leads.status, ownerId: leads.ownerId })
    .from(leads)
    .where(and(inArray(leads.id, body.ids), isNull(leads.deletedAt), ne(leads.status, "converted"), ...(scope ? [scope] : [])));
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const l of rows) {
      if (body.action === "assign" && l.ownerId !== body.ownerId) {
        await tx.update(leads).set({ ownerId: body.ownerId, assignedAt: body.ownerId ? now : null }).where(eq(leads.id, l.id));
        await leadEvent(tx, l.id, "assigned", req.staff.id, { meta: { from: l.ownerId, to: body.ownerId, toName: target?.name ?? null, bulk: true } });
      } else if (body.action === "status" && l.status !== body.status) {
        await tx.update(leads).set({ status: body.status, handled: body.status !== "new", lostReason: body.status === "lost" ? body.lostReason : null }).where(eq(leads.id, l.id));
        await leadEvent(tx, l.id, "status_changed", req.staff.id, { meta: { from: l.status, to: body.status, reason: body.lostReason, bulk: true } });
      } else if (body.action === "delete") {
        await tx.update(leads).set({ deletedAt: now, deletedBy: req.staff.id }).where(eq(leads.id, l.id));
        await leadEvent(tx, l.id, "deleted", req.staff.id, { meta: { bulk: true } });
      }
    }
  });
  await audit(req, `lead.bulk_${body.action}`, { meta: { requested: body.ids.length, changed: rows.length, ownerId: body.ownerId, status: body.status } });
  res.json({ ok: true, changed: rows.length, skipped: body.ids.length - rows.length });
});

/* ---------- convert ---------- */

/**
 * POST /api/crm/leads/:id/convert — finds or creates the customer, logs an application with the chosen lender,
 * and marks the lead converted, all in one transaction. The lead row is locked, and applications.lead_id is
 * unique, so the same lead can never be converted twice.
 */
r.post("/leads/:id/convert", can("leads.edit"), async (req, res) => {
  if (!has(req, "applications.create")) throw new HttpError(403, "Your role can’t create applications");
  const id = leadId(req.params.id);
  const body = parse(convertBody, req.body);
  const [lender] = await db.select().from(lenders).where(and(eq(lenders.id, body.lenderId), eq(lenders.active, true))).limit(1);
  if (!lender) throw new HttpError(400, "Choose an active lender", { fields: { lenderId: "Choose an active lender" } });

  const result = await db.transaction(async (tx) => {
    const lead = await loadLead(req, id, tx, { lock: true });
    const [already] = await tx.select({ ref: applications.ref }).from(applications).where(eq(applications.leadId, id)).limit(1);
    if (lead.status === "converted" || already) throw new HttpError(409, `This lead is already converted${already ? ` (application ${already.ref})` : ""}`);
    if (!CONVERTIBLE.includes(lead.status)) {
      throw new HttpError(409, `Only interested, docs-pending or qualified leads can be converted. This lead is “${STATUS_LABELS[lead.status]}”.`);
    }

    // Customer: reuse the website account with this phone (or email), otherwise create one.
    const [match] = await tx
      .select()
      .from(users)
      .where(or(eq(users.phone, lead.phone), ...(lead.email ? [eq(users.email, lead.email)] : [])))
      .orderBy(sql`case when ${users.phone} = ${lead.phone} then 0 else 1 end`)
      .limit(1);
    if (match?.roleId) throw new HttpError(409, "This phone number or email belongs to a CRM staff account, not a customer.");
    let customer = match;
    const createdCustomer = !match;
    // Same profile keys as the website dashboard: emp = employment type, employment = its details.
    const fromLead = {
      ...(lead.city && { city: lead.city }),
      ...(lead.employment && { emp: lead.employment }),
      ...(lead.annualIncome && { employment: { annualIncome: lead.annualIncome } }),
    };
    if (!customer) {
      const emailFree = lead.email ? !(await tx.select({ id: users.id }).from(users).where(eq(users.email, lead.email)).limit(1)).length : false;
      [customer] = await tx
        .insert(users)
        .values({
          name: lead.name.slice(0, 80),
          phone: lead.phone,
          email: emailFree ? lead.email : null,
          profile: fromLead,
          relationshipManagerId: lead.ownerId ?? req.staff.id,
          createdBy: req.staff.id,
        })
        .returning();
      await customerEvent(tx, customer.id, "created", req.staff.id, { meta: { source: "lead", leadRef: lead.ref, leadId: id } });
    } else {
      // Existing customer: fill in details they don't have yet (never overwrite), and give them an RM if they have none.
      const p = customer.profile ?? {};
      const emp = p.employment && typeof p.employment === "object" ? p.employment : {};
      const profile = {
        ...fromLead, ...p,
        ...(fromLead.employment && { employment: { ...fromLead.employment, ...emp } }),
      };
      [customer] = await tx
        .update(users)
        .set({ profile, ...(!customer.relationshipManagerId && { relationshipManagerId: lead.ownerId ?? req.staff.id }) })
        .where(eq(users.id, customer.id))
        .returning();
      await customerEvent(tx, customer.id, "lead_linked", req.staff.id, { meta: { leadRef: lead.ref, leadId: id } });
    }

    const [app] = await tx
      .insert(applications)
      .values({
        ref: "AVD" + randomBytes(4).toString("hex").toUpperCase(),
        userId: customer.id,
        contact: { name: lead.name, phone: lead.phone, email: lead.email },
        lenderId: lender.id,
        lenderName: lender.name,
        type: body.loanType,
        loanAmount: body.loanAmount,
        tenureMonths: body.tenureMonths ?? null,
        emp: lead.employment,
        status: "submitted",
        stage: "login",
        assignedTo: lead.ownerId ?? req.staff.id,
        details: { source: "crm", leadRef: lead.ref, note: body.note ?? undefined },
        leadId: id,
        createdBy: req.staff.id,
      })
      .returning();
    const now = new Date();
    await tx.update(leads).set({ status: "converted", handled: true, userId: customer.id, convertedAt: now, convertedBy: req.staff.id }).where(eq(leads.id, id));
    await leadEvent(tx, id, "converted", req.staff.id, {
      body: body.note ?? null,
      meta: { applicationId: app.id, applicationRef: app.ref, lender: lender.name, loanType: body.loanType, loanAmount: body.loanAmount, customerId: customer.id, createdCustomer, from: lead.status },
    });
    return { lead, app, customer, createdCustomer };
  }).catch((err) => {
    // Two conversions racing: the unique applications.lead_id stops the second one.
    if ((err.cause?.code ?? err.code) === "23505") throw new HttpError(409, "This lead is already converted");
    throw err;
  });

  await audit(req, "lead.converted", { entityType: "lead", entityId: id, meta: { ref: result.lead.ref, application: result.app.ref, customerId: result.customer.id, createdCustomer: result.createdCustomer } });
  res.status(201).json({
    application: { id: result.app.id, ref: result.app.ref, status: result.app.status, lenderName: result.app.lenderName, loanType: typeLabel(result.app.type), loanAmount: result.app.loanAmount },
    customer: { id: result.customer.id, name: result.customer.name, phone: result.customer.phone, created: result.createdCustomer },
  });
});

export default r;
