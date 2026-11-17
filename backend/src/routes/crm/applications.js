import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Router } from "express";
import { z } from "zod";
import { APPLICATION_STAGES, applications, documents, leads, lenders, roles, STAGE_STATUS, timelineEvents, users } from "../../db/schema.js";
import {
  allowedMoves, applicationEvent, applicationScope, checklist, checkMove, MOVE_PERMISSION, OPEN_STAGES, requiredDocuments, seesAllApplications, STAGE_LABELS,
} from "../../crm/applications.js";
import { audit } from "../../crm/audit.js";
import { can } from "../../crm/middleware.js";
import { hasPermission } from "../../crm/permissions.js";
import { applicationCreateBody, applicationListQuery, applicationUpdateBody, noteBody, stageBody } from "../../crm/validate.js";
import { LOAN_TYPES } from "../../data/loans.js";
import { db } from "../../lib/db.js";
import { emi } from "../../lib/emi.js";
import { HttpError } from "../../lib/http.js";
import { parse } from "../../lib/validate.js";
import { DOC_LABELS } from "./customers.js";

// CRM loan applications: list, pipeline, detail, create/edit and stage moves. Every move is checked against
// crm/applications.js (order, permissions, required data) and recorded in timeline_events (entity "application").

const r = Router();
const assignee = alias(users, "assignee");
const creator = alias(users, "creator");
const customer = alias(users, "customer");
const typeLabel = (id) => LOAN_TYPES.find((t) => t.id === id)?.label ?? id;
const like = (q) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const has = (req, p) => hasPermission(req.staff.permissions, p);
const round2 = (n) => Math.round(n * 100) / 100;
const uuidOr404 = (raw) => {
  const ok = z.uuid().safeParse(raw);
  if (!ok.success) throw new HttpError(404, "Application not found");
  return ok.data;
};

/** Active lender + its product for this loan type, or a 400 naming the field. */
async function resolveProduct(lenderId, loanType, tx = db) {
  const [lender] = await tx.select().from(lenders).where(and(eq(lenders.id, lenderId), eq(lenders.active, true))).limit(1);
  if (!lender) throw new HttpError(400, "Choose an active lender", { fields: { lenderId: "Choose an active lender" } });
  const product = (lender.products ?? []).find((p) => p.type === loanType);
  if (!product) {
    const msg = `${lender.name} doesn’t offer ${typeLabel(loanType)}`;
    throw new HttpError(400, msg, { fields: { loanType: msg } });
  }
  return { lender, product };
}
function checkLimits(product, { loanAmount, tenureMonths }) {
  if (product.maxAmount && loanAmount > product.maxAmount) {
    const msg = `This product lends up to ₹${product.maxAmount.toLocaleString("en-IN")}`;
    throw new HttpError(400, msg, { fields: { loanAmount: msg } });
  }
  if (product.minTenure && tenureMonths < product.minTenure * 12) {
    const msg = `This product needs at least ${product.minTenure * 12} months`;
    throw new HttpError(400, msg, { fields: { tenureMonths: msg } });
  }
  if (product.maxTenure && tenureMonths > product.maxTenure * 12) {
    const msg = `This product allows up to ${product.maxTenure * 12} months`;
    throw new HttpError(400, msg, { fields: { tenureMonths: msg } });
  }
}

/** Active staff who can work applications. */
async function appStaff() {
  return db
    .select({ id: users.id, name: users.name, roleName: roles.name })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.status, "active"), sql`(${roles.permissions} @> '["applications.view"]' or ${roles.permissions} @> '["*"]')`))
    .orderBy(asc(users.name));
}
async function checkAssignee(id) {
  const found = (await appStaff()).find((s) => s.id === id);
  if (!found) throw new HttpError(400, "Choose an active employee who can work applications", { fields: { assignedTo: "Choose an active employee" } });
  return found;
}

async function loadApp(req, id, tx = db, { lock = false } = {}) {
  const scope = applicationScope(req.staff);
  let q = tx.select().from(applications).where(and(eq(applications.id, id), ...(scope ? [scope] : []))).limit(1);
  if (lock) q = q.for("update");
  const [row] = await q;
  if (!row) throw new HttpError(404, "Application not found");
  return row;
}

/* ---------- lists ---------- */

r.get("/applications/meta", can("applications.view"), async (_req, res) => {
  const [staff, lenderRows] = await Promise.all([
    appStaff(),
    db.select({ id: lenders.id, name: lenders.name, kind: lenders.kind, fee: lenders.fee, products: lenders.products }).from(lenders).where(eq(lenders.active, true)).orderBy(asc(lenders.sortOrder), asc(lenders.name)),
  ]);
  res.json({
    stages: APPLICATION_STAGES.map((id) => ({ id, label: STAGE_LABELS[id] })),
    loanTypes: LOAN_TYPES.map((t) => ({ id: t.id, label: t.label })),
    lenders: lenderRows,
    staff,
  });
});

const LIST_COLUMNS = {
  id: applications.id, ref: applications.ref, stage: applications.stage, status: applications.status, type: applications.type,
  loanAmount: applications.loanAmount, sanctionedAmount: applications.sanctionedAmount, disbursedAmount: applications.disbursedAmount,
  tenureMonths: applications.tenureMonths, rate: applications.rate, emi: applications.emi, lenderId: applications.lenderId,
  lenderName: applications.lenderName, lenderRef: applications.lenderRef, createdAt: applications.createdAt, updatedAt: applications.updatedAt,
  assignedTo: applications.assignedTo, assigneeName: assignee.name, customerId: applications.userId, customerName: customer.name,
  customerCode: customer.customerCode, customerCity: sql`${customer.profile}->>'city'`, contactName: sql`${applications.contact}->>'name'`,
};
const listSelect = (tx = db) =>
  tx.select(LIST_COLUMNS).from(applications).innerJoin(customer, eq(applications.userId, customer.id)).leftJoin(assignee, eq(applications.assignedTo, assignee.id));
const toItem = (a) => ({ ...a, customerName: a.customerName || a.contactName || "Customer", loanType: typeLabel(a.type), stageLabel: STAGE_LABELS[a.stage] });

function listWhere(req, f, { withStage = true } = {}) {
  const w = [];
  const scope = applicationScope(req.staff);
  if (scope) w.push(scope);
  if (f.q) {
    const l = like(f.q);
    w.push(or(ilike(applications.ref, l), ilike(applications.lenderRef, l), ilike(applications.lenderName, l), sql`${applications.contact}->>'name' ilike ${l}`,
      sql`${applications.contact}->>'phone' ilike ${l}`, ilike(customer.name, l), ilike(customer.phone, l), ilike(customer.customerCode, l)));
  }
  if (withStage && f.stage) w.push(eq(applications.stage, f.stage));
  if (f.lenderId) w.push(eq(applications.lenderId, f.lenderId));
  if (f.loanType) w.push(eq(applications.type, f.loanType));
  if (f.assignee === "me") w.push(eq(applications.assignedTo, req.staff.id));
  else if (f.assignee === "unassigned") w.push(isNull(applications.assignedTo));
  else if (f.assignee) w.push(eq(applications.assignedTo, f.assignee));
  return w.length ? and(...w) : undefined;
}
const SORT = { updated: applications.updatedAt, created: applications.createdAt, amount: applications.loanAmount };
const orderBy = (f) => [sql`${SORT[f.sort]} ${sql.raw(f.dir === "asc" ? "asc" : "desc")} nulls last`, desc(applications.id)];
const stageTotals = (where) =>
  db.select({ stage: applications.stage, n: count(), amount: sql`coalesce(sum(${applications.loanAmount}), 0)`.mapWith(Number) })
    .from(applications).innerJoin(customer, eq(applications.userId, customer.id)).where(where).groupBy(applications.stage);

r.get("/applications", can("applications.view"), async (req, res) => {
  const f = parse(applicationListQuery, req.query);
  const where = listWhere(req, f);
  const [rows, [{ total }], totals] = await Promise.all([
    listSelect().where(where).orderBy(...orderBy(f)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
    db.select({ total: count() }).from(applications).innerJoin(customer, eq(applications.userId, customer.id)).where(where),
    stageTotals(listWhere(req, f, { withStage: false })),
  ]);
  const stages = APPLICATION_STAGES.map((s) => {
    const t = totals.find((x) => x.stage === s);
    return { stage: s, label: STAGE_LABELS[s], count: t?.n ?? 0, amount: t?.amount ?? 0 };
  });
  res.json({ applications: rows.map(toItem), total, page: f.page, pageSize: f.pageSize, stages });
});

r.get("/applications/board", can("applications.view"), async (req, res) => {
  const f = parse(applicationListQuery, req.query);
  const columns = await Promise.all(
    APPLICATION_STAGES.map(async (stage) => {
      const where = and(listWhere(req, f, { withStage: false }), eq(applications.stage, stage));
      const [rows, [agg]] = await Promise.all([
        listSelect().where(where).orderBy(desc(applications.updatedAt), desc(applications.id)).limit(50),
        db.select({ n: count(), amount: sql`coalesce(sum(${applications.loanAmount}), 0)`.mapWith(Number) }).from(applications).innerJoin(customer, eq(applications.userId, customer.id)).where(where),
      ]);
      return { stage, label: STAGE_LABELS[stage], count: agg.n, amount: agg.amount, applications: rows.map(toItem) };
    })
  );
  res.json({ columns });
});

const csvCell = (v) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
r.get("/applications/export", can("applications.export"), async (req, res) => {
  const f = parse(applicationListQuery, req.query);
  const rows = (await listSelect().where(listWhere(req, f)).orderBy(...orderBy(f)).limit(5000)).map(toItem);
  const head = ["Application", "Customer", "Customer ID", "Product", "Amount", "Tenure (months)", "Rate", "EMI", "Lender", "Lender ref", "Stage", "Sanctioned", "Disbursed", "Owner", "Created", "Updated"];
  const body = rows.map((a) => [a.ref, a.customerName, a.customerCode, a.loanType, a.loanAmount, a.tenureMonths, a.rate, a.emi && round2(a.emi), a.lenderName, a.lenderRef, a.stageLabel, a.sanctionedAmount, a.disbursedAmount, a.assigneeName, a.createdAt, a.updatedAt].map(csvCell).join(","));
  await audit(req, "applications.exported", { meta: { rows: rows.length } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="applications-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + [head.join(","), ...body].join("\r\n"));
});

/* ---------- one application ---------- */

async function detail(req, id) {
  const scope = applicationScope(req.staff);
  const [row] = await db
    .select({ a: applications, assigneeName: assignee.name, createdByName: creator.name, leadRef: leads.ref, c: customer })
    .from(applications)
    .innerJoin(customer, eq(applications.userId, customer.id))
    .leftJoin(assignee, eq(applications.assignedTo, assignee.id))
    .leftJoin(creator, eq(applications.createdBy, creator.id))
    .leftJoin(leads, eq(applications.leadId, leads.id))
    .where(and(eq(applications.id, id), ...(scope ? [scope] : [])))
    .limit(1);
  if (!row) throw new HttpError(404, "Application not found");
  const { a, c } = row;
  const actor = alias(users, "actor");
  const uploader = alias(users, "uploader");
  const [[lender], docs, events] = await Promise.all([
    db.select().from(lenders).where(eq(lenders.id, a.lenderId)).limit(1),
    db.select({ id: documents.id, docType: documents.docType, fileName: documents.fileName, status: documents.status, note: documents.note, applicationId: documents.applicationId, sizeBytes: documents.sizeBytes, createdAt: documents.createdAt, uploadedByName: uploader.name })
      .from(documents).leftJoin(uploader, eq(documents.uploadedBy, uploader.id))
      .where(and(eq(documents.customerId, c.id), isNull(documents.deletedAt))).orderBy(desc(documents.createdAt)),
    db.select({ id: timelineEvents.id, type: timelineEvents.type, body: timelineEvents.body, meta: timelineEvents.meta, createdAt: timelineEvents.createdAt, actorName: actor.name })
      .from(timelineEvents).leftJoin(actor, eq(timelineEvents.actorId, actor.id))
      .where(and(eq(timelineEvents.entityType, "application"), eq(timelineEvents.entityId, id))).orderBy(desc(timelineEvents.createdAt)),
  ]);
  const p = c.profile ?? {};
  const emp = p.emp ?? a.emp;
  const required = requiredDocuments(emp, a.type);
  const product = (lender?.products ?? []).find((x) => x.type === a.type) ?? null;
  const history = [...events, { id: `created:${a.id}`, type: "created", createdAt: a.createdAt, actorName: row.createdByName, meta: { website: !a.createdBy, leadRef: row.leadRef } }];
  return {
    application: {
      ...a, loanType: typeLabel(a.type), stageLabel: STAGE_LABELS[a.stage], assigneeName: row.assigneeName, createdByName: row.createdByName, leadRef: row.leadRef,
      emi: a.emi && round2(a.emi), source: a.createdBy ? "crm" : "website", editable: OPEN_STAGES.includes(a.stage),
    },
    customer: {
      id: c.id, code: c.customerCode, name: c.name || a.contact?.name || "Customer", phone: c.phone, email: c.email, city: p.city ?? null,
      creditScore: c.creditScore, kycStatus: c.kycStatus, emp, annualIncome: p.employment?.annualIncome != null ? Number(p.employment.annualIncome) : null,
    },
    lender: lender ? { id: lender.id, name: lender.name, kind: lender.kind, logo: lender.logo, fee: lender.fee, active: lender.active, product } : { id: a.lenderId, name: a.lenderName, product: null },
    checklist: checklist(required, docs, a.id).map((x) => ({ ...x, label: DOC_LABELS[x.docType] })),
    otherDocuments: docs.filter((d) => !required.includes(d.docType)).map((d) => ({ ...d, label: DOC_LABELS[d.docType] })),
    moves: allowedMoves(req.staff, a.stage),
    history,
  };
}

r.get("/applications/:id", can("applications.view"), async (req, res) => {
  res.json(await detail(req, uuidOr404(req.params.id)));
});

r.post("/applications", can("applications.create"), async (req, res) => {
  const body = parse(applicationCreateBody, req.body);
  const [cust] = await db.select().from(users).where(and(eq(users.id, body.customerId), isNull(users.roleId))).limit(1);
  if (!cust) throw new HttpError(400, "Choose a customer", { fields: { customerId: "Choose a customer" } });
  const { lender, product } = await resolveProduct(body.lenderId, body.loanType);
  checkLimits(product, body);
  if (body.assignedTo && body.assignedTo !== req.staff.id && !seesAllApplications(req.staff)) throw new HttpError(403, "You can only assign applications to yourself");
  const owner = body.assignedTo ? await checkAssignee(body.assignedTo) : { id: req.staff.id, name: req.staff.name };
  const rate = body.rate ?? product.rate ?? null;
  const app = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(applications)
      .values({
        ref: "AVD" + randomBytes(4).toString("hex").toUpperCase(),
        userId: cust.id,
        contact: { name: cust.name, phone: cust.phone, email: cust.email },
        lenderId: lender.id, lenderName: lender.name, type: body.loanType, loanAmount: body.loanAmount, tenureMonths: body.tenureMonths,
        rate, emi: rate != null ? emi(body.loanAmount, rate, body.tenureMonths) : null, emp: cust.profile?.emp ?? null,
        processingFee: body.processingFee ?? null, lenderRef: body.lenderRef ?? null, stage: "new", status: STAGE_STATUS.new,
        assignedTo: owner.id, createdBy: req.staff.id, details: { source: "crm" },
      })
      .returning();
    await applicationEvent(tx, row.id, "assigned", req.staff.id, { meta: { to: owner.id, toName: owner.name } });
    if (body.note) await applicationEvent(tx, row.id, "note", req.staff.id, { body: body.note });
    return row;
  });
  await audit(req, "application.created", { entityType: "application", entityId: app.id, meta: { ref: app.ref, customerId: cust.id, lender: lender.id } });
  res.status(201).json(await detail(req, app.id));
});

const EDITABLE = ["lenderId", "loanType", "loanAmount", "tenureMonths", "rate", "processingFee", "lenderRef"];

r.patch("/applications/:id", can("applications.edit"), async (req, res) => {
  const id = uuidOr404(req.params.id);
  const body = parse(applicationUpdateBody, req.body);
  const row = await loadApp(req, id);
  const app = { ...row, loanType: row.type }; // the API calls the product `loanType`; the column is `type`
  const detailsChanged = EDITABLE.some((k) => body[k] !== undefined && body[k] !== app[k]);
  if (detailsChanged && !OPEN_STAGES.includes(app.stage)) throw new HttpError(409, "The loan details are locked once an application is sanctioned, disbursed or rejected.");
  const next = { ...app, ...Object.fromEntries(EDITABLE.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])) };
  const set = {};
  const changes = {};
  if (detailsChanged) {
    const { lender, product } = await resolveProduct(next.lenderId, next.loanType);
    checkLimits(product, next);
    for (const k of EDITABLE) if (next[k] !== app[k]) { set[k] = next[k]; changes[k] = { from: app[k], to: next[k] }; }
    if (set.lenderId) set.lenderName = lender.name;
    if ("loanType" in set) { set.type = set.loanType; delete set.loanType; }
    // A new product brings its own rate unless one was given.
    if ((set.lenderId || set.type) && body.rate === undefined) set.rate = next.rate = product.rate ?? next.rate;
    set.emi = next.rate != null ? emi(next.loanAmount, next.rate, next.tenureMonths) : null;
  }
  let owner = null;
  if (body.assignedTo !== undefined && body.assignedTo !== app.assignedTo) {
    if (body.assignedTo !== req.staff.id && !seesAllApplications(req.staff)) throw new HttpError(403, "You can only assign applications to yourself");
    owner = body.assignedTo ? await checkAssignee(body.assignedTo) : null;
    set.assignedTo = body.assignedTo;
  }
  if (Object.keys(set).length) {
    await db.transaction(async (tx) => {
      await tx.update(applications).set(set).where(eq(applications.id, id));
      if (Object.keys(changes).length) await applicationEvent(tx, id, "updated", req.staff.id, { meta: { changes } });
      if ("assignedTo" in set) await applicationEvent(tx, id, "assigned", req.staff.id, { meta: { from: app.assignedTo, to: set.assignedTo, toName: owner?.name ?? null } });
    });
    await audit(req, "application.updated", { entityType: "application", entityId: id, meta: { ref: app.ref, fields: Object.keys(set) } });
  }
  res.json(await detail(req, id));
});

r.post("/applications/:id/notes", can("applications.edit"), async (req, res) => {
  const id = uuidOr404(req.params.id);
  const { body } = parse(noteBody, req.body);
  await loadApp(req, id);
  await applicationEvent(db, id, "note", req.staff.id, { body });
  res.status(201).json(await detail(req, id));
});

/* ---------- stage moves ---------- */

/**
 * POST /api/crm/applications/:id/stage { stage, … } — the only way a file moves. Locks the row, checks the move
 * (order, permission, required data, verified documents before credit review) and keeps `status` in step.
 */
r.post("/applications/:id/stage", can("applications.view"), async (req, res) => {
  const id = uuidOr404(req.params.id);
  const body = parse(stageBody, req.body);
  const result = await db.transaction(async (tx) => {
    const app = await loadApp(req, id, tx, { lock: true });
    const move = checkMove(app.stage, body.stage);
    if (move.error) throw new HttpError(409, move.error);
    if (!has(req, MOVE_PERMISSION[move.kind])) {
      throw new HttpError(403, move.kind === "forward" || move.kind === "back" ? "Your role can’t move applications between stages" : "Only approvers (credit and branch managers) can sanction, disburse or reject");
    }
    const now = new Date();
    const set = { stage: body.stage, status: STAGE_STATUS[body.stage] };
    const meta = { from: app.stage, to: body.stage };
    const need = (field, msg) => { throw new HttpError(400, msg, { fields: { [field]: msg } }); };

    if (move.kind === "back" && !body.note) need("note", "Say why the application is going back a stage");
    if (body.stage === "credit_review") {
      const [cust] = await tx.select({ profile: users.profile }).from(users).where(eq(users.id, app.userId));
      const docs = await tx.select({ docType: documents.docType, status: documents.status, applicationId: documents.applicationId, createdAt: documents.createdAt })
        .from(documents).where(and(eq(documents.customerId, app.userId), isNull(documents.deletedAt)));
      const missing = checklist(requiredDocuments(cust?.profile?.emp ?? app.emp, app.type), docs, id).filter((x) => x.status !== "verified");
      if (missing.length) throw new HttpError(409, `Verify these documents before credit review: ${missing.map((x) => DOC_LABELS[x.docType]).join(", ")}`, { fields: { documents: missing.map((x) => x.docType).join(",") } });
    }
    if (move.kind === "sanction") {
      if (!body.sanctionedAmount) need("sanctionedAmount", "Enter the sanctioned amount");
      if (body.sanctionedAmount > app.loanAmount) need("sanctionedAmount", "The sanctioned amount can’t be more than the amount requested");
      const rate = body.rate ?? app.rate;
      const months = body.tenureMonths ?? app.tenureMonths;
      if (rate == null) need("rate", "Enter the sanctioned interest rate");
      if (!months) need("tenureMonths", "Enter the tenure");
      Object.assign(set, { sanctionedAmount: body.sanctionedAmount, sanctionedAt: now, rate, tenureMonths: months, emi: emi(body.sanctionedAmount, rate, months) });
      Object.assign(meta, { sanctionedAmount: body.sanctionedAmount, rate, tenureMonths: months, emi: round2(set.emi) });
    }
    if (move.kind === "disburse") {
      if (!body.disbursedAmount) need("disbursedAmount", "Enter the disbursed amount");
      const cap = app.sanctionedAmount ?? app.loanAmount;
      if (body.disbursedAmount > cap) need("disbursedAmount", `Can’t disburse more than the sanctioned ₹${cap.toLocaleString("en-IN")}`);
      Object.assign(set, { disbursedAmount: body.disbursedAmount, disbursedAt: now });
      meta.disbursedAmount = body.disbursedAmount;
    }
    if (move.kind === "reject") {
      if (!body.rejectionReason) need("rejectionReason", "Say why the application was rejected");
      Object.assign(set, { rejectedAt: now, rejectionReason: body.rejectionReason });
      meta.reason = body.rejectionReason;
    }
    await tx.update(applications).set(set).where(eq(applications.id, id));
    await applicationEvent(tx, id, "stage_changed", req.staff.id, { body: body.note ?? null, meta });
    return { app, meta };
  });
  await audit(req, "application.stage_changed", { entityType: "application", entityId: id, meta: { ref: result.app.ref, ...result.meta } });
  res.json(await detail(req, id));
});

export default r;
