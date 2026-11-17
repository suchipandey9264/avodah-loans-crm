import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import express, { Router } from "express";
import { z } from "zod";
import { applications, DOCUMENT_TYPES, documents, followups, KYC_STATUSES, leads, roles, timelineEvents, users } from "../../db/schema.js";
import { audit } from "../../crm/audit.js";
import { customerEvent, customerView, maskPan, mergeProfile, seesSensitive, sniffMime } from "../../crm/customers.js";
import { SOURCE_LABELS, STATUS_LABELS } from "../../crm/leads.js";
import { can } from "../../crm/middleware.js";
import { hasPermission } from "../../crm/permissions.js";
import {
  customerCreateBody, customerListQuery, customerUpdateBody, documentUpdateBody, documentUploadQuery, GENDERS, MARITAL, noteBody,
} from "../../crm/validate.js";
import { EMPLOYMENT, LOAN_TYPES } from "../../data/loans.js";
import { db } from "../../lib/db.js";
import { HttpError } from "../../lib/http.js";
import { parse } from "../../lib/validate.js";

// CRM customer management. Customers are `users` rows with no role (website sign-ups, converted leads,
// and customers added here). Every change is recorded in timeline_events (entity "customer").

const r = Router();
const rm = alias(users, "rm");
const creator = alias(users, "creator");
const actor = alias(users, "actor");
const typeLabel = (id) => LOAN_TYPES.find((t) => t.id === id)?.label ?? id;
const like = (q) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const isCustomer = isNull(users.roleId);
const uuidOr404 = (raw, what = "Customer") => {
  const ok = z.uuid().safeParse(raw);
  if (!ok.success) throw new HttpError(404, `${what} not found`);
  return ok.data;
};

export const KYC_LABELS = { pending: "Pending", verified: "Verified", re_kyc: "Re-KYC" };
export const DOC_LABELS = {
  pan: "PAN card", aadhaar: "Aadhaar", photo: "Photograph", address_proof: "Address proof", bank_statement: "Bank statement",
  salary_slip: "Salary slips", itr: "Income tax return", form16: "Form 16", property: "Property papers", other: "Other",
};
const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands",
  "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

/** Active staff who can look after customers (relationship managers). */
async function rmStaff() {
  return db
    .select({ id: users.id, name: users.name, roleName: roles.name })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.status, "active"), sql`(${roles.permissions} @> '["customers.view"]' or ${roles.permissions} @> '["*"]')`))
    .orderBy(asc(users.name));
}
async function checkRm(id) {
  const found = (await rmStaff()).find((s) => s.id === id);
  if (!found) throw new HttpError(400, "Choose an active employee who can work with customers", { fields: { relationshipManagerId: "Choose an active employee" } });
  return found;
}

/** 409 if the phone or email already belongs to someone else. */
async function checkUnique({ phone, email }, exceptId) {
  for (const [field, value] of [["phone", phone], ["email", email]]) {
    if (!value) continue;
    const [hit] = await db.select({ id: users.id, roleId: users.roleId, code: users.customerCode, name: users.name }).from(users).where(eq(users[field], value)).limit(1);
    if (hit && hit.id !== exceptId) {
      const msg = hit.roleId ? `This ${field === "phone" ? "mobile number" : "email"} belongs to a CRM staff account` : `${hit.code} (${hit.name || "a customer"}) already has this ${field === "phone" ? "mobile number" : "email"}`;
      throw new HttpError(409, msg, { fields: { [field]: msg } });
    }
  }
}

async function loadCustomer(id, tx = db, { lock = false } = {}) {
  let q = tx.select().from(users).where(and(eq(users.id, id), isCustomer)).limit(1);
  if (lock) q = q.for("update");
  const [row] = await q;
  if (!row) throw new HttpError(404, "Customer not found");
  return row;
}

/* ---------- lists ---------- */

r.get("/customers/meta", can("customers.view"), async (_req, res) => {
  const [staff, cityRows] = await Promise.all([
    rmStaff(),
    db.execute(sql`select distinct initcap(trim(profile->>'city')) as city from users where role_id is null and coalesce(trim(profile->>'city'), '') <> '' order by 1 limit 200`),
  ]);
  res.json({
    kycStatuses: KYC_STATUSES.map((id) => ({ id, label: KYC_LABELS[id] })),
    genders: GENDERS,
    marital: MARITAL,
    employment: EMPLOYMENT.map((e) => ({ id: e.id, label: e.label })),
    states: STATES,
    cities: cityRows.rows.map((x) => x.city),
    documentTypes: DOCUMENT_TYPES.map((id) => ({ id, label: DOC_LABELS[id] })),
    relationshipManagers: staff,
  });
});

const appStats = db
  .select({
    userId: applications.userId,
    n: sql`count(*)`.as("n"),
    active: sql`count(*) filter (where ${applications.status} in ('submitted', 'in_review', 'approved'))`.as("active"),
    disbursed: sql`coalesce(sum(${applications.loanAmount}) filter (where ${applications.status} = 'disbursed'), 0)`.as("disbursed"),
  })
  .from(applications)
  .groupBy(applications.userId)
  .as("app_stats");

function listWhere(req, f) {
  const w = [isCustomer];
  if (f.q) {
    const l = like(f.q);
    w.push(or(ilike(users.name, l), ilike(users.phone, l), ilike(users.email, l), ilike(users.customerCode, l), sql`${users.profile}->>'pan' ilike ${l}`));
  }
  if (f.kyc) w.push(eq(users.kycStatus, f.kyc));
  if (f.rm === "me") w.push(eq(users.relationshipManagerId, req.staff.id));
  else if (f.rm === "none") w.push(isNull(users.relationshipManagerId));
  else if (f.rm) w.push(eq(users.relationshipManagerId, f.rm));
  if (f.city) w.push(sql`${users.profile}->>'city' ilike ${f.city.replace(/[\\%_]/g, "\\$&")}`);
  return and(...w);
}
const listOrder = (f) => {
  const col = { created: users.createdAt, name: users.name, score: users.creditScore, applications: sql`coalesce(${appStats.n}, 0)` }[f.sort];
  return [sql`${col} ${sql.raw(f.dir === "asc" ? "asc" : "desc")} nulls last`, desc(users.id)];
};
const listSelect = () =>
  db
    .select({
      u: users,
      rmName: rm.name,
      applications: sql`coalesce(${appStats.n}, 0)`.mapWith(Number),
      activeApplications: sql`coalesce(${appStats.active}, 0)`.mapWith(Number),
      disbursed: sql`coalesce(${appStats.disbursed}, 0)`.mapWith(Number),
    })
    .from(users)
    .leftJoin(rm, eq(users.relationshipManagerId, rm.id))
    .leftJoin(appStats, eq(appStats.userId, users.id));
const listItem = (req) => ({ u, rmName, ...stats }) => ({
  id: u.id, code: u.customerCode, name: u.name ?? "", phone: u.phone, email: u.email, city: u.profile?.city ?? null,
  pan: seesSensitive(req.staff) ? u.profile?.pan ?? null : maskPan(u.profile?.pan),
  creditScore: u.creditScore, kycStatus: u.kycStatus, relationshipManagerName: rmName, createdAt: u.createdAt, ...stats,
});

r.get("/customers", can("customers.view"), async (req, res) => {
  const f = parse(customerListQuery, req.query);
  const where = listWhere(req, f);
  const [rows, [{ total }], [stats]] = await Promise.all([
    listSelect().where(where).orderBy(...listOrder(f)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
    db.select({ total: count() }).from(users).where(where),
    db.execute(sql`
      select count(*)::int as total,
             count(*) filter (where kyc_status = 'verified')::int as verified,
             (select count(distinct a.user_id)::int from applications a join users c on c.id = a.user_id and c.role_id is null
               where a.status in ('submitted', 'in_review', 'approved')) as "activeFile",
             (select coalesce(sum(a.loan_amount), 0)::float8 from applications a join users c on c.id = a.user_id and c.role_id is null
               where a.status = 'disbursed') as disbursed
      from users where role_id is null`).then((x) => x.rows),
  ]);
  res.json({ customers: rows.map(listItem(req)), total, page: f.page, pageSize: f.pageSize, stats });
});

const csvCell = (v) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

r.get("/customers/export", can("customers.export"), async (req, res) => {
  const f = parse(customerListQuery, req.query);
  const rows = (await listSelect().where(listWhere(req, f)).orderBy(...listOrder(f)).limit(5000)).map(listItem(req));
  const head = ["Customer ID", "Name", "Phone", "Email", "City", "PAN", "CIBIL", "KYC", "Applications", "Active", "Disbursed", "Relationship manager", "Customer since"];
  const body = rows.map((c) => [c.code, c.name, c.phone, c.email, c.city, c.pan, c.creditScore, KYC_LABELS[c.kycStatus], c.applications, c.activeApplications, c.disbursed, c.relationshipManagerName, c.createdAt].map(csvCell).join(","));
  await audit(req, "customers.exported", { meta: { rows: rows.length } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + [head.join(","), ...body].join("\r\n"));
});

/* ---------- add & edit ---------- */

r.post("/customers", can("customers.create"), async (req, res) => {
  const body = parse(customerCreateBody, req.body);
  await checkUnique(body);
  if (body.kycStatus !== "pending" && !seesSensitive(req.staff)) throw new HttpError(403, "Setting KYC status needs KYC access", { fields: { kycStatus: "Setting KYC status needs KYC access" } });
  // Staff who can edit customers become the relationship manager of customers they add, unless one is chosen.
  const rmRow = body.relationshipManagerId ? await checkRm(body.relationshipManagerId) : hasPermission(req.staff.permissions, "customers.edit") ? { id: req.staff.id, name: req.staff.name } : null;
  const { profile } = mergeProfile({}, body);
  const customer = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        name: body.name, phone: body.phone, email: body.email ?? null, profile, kycStatus: body.kycStatus,
        creditScore: body.creditScore ?? null, creditScoreUpdatedAt: body.creditScore ? new Date() : null,
        relationshipManagerId: rmRow?.id ?? null, createdBy: req.staff.id,
      })
      .returning();
    await customerEvent(tx, row.id, "created", req.staff.id, { meta: { source: "crm", relationshipManager: rmRow?.name ?? null } });
    return row;
  });
  await audit(req, "customer.created", { entityType: "customer", entityId: customer.id, meta: { code: customer.customerCode } });
  res.status(201).json({ customer: customerView(customer, { sensitive: seesSensitive(req.staff), rmName: rmRow?.name ?? null, createdByName: req.staff.name }) });
});

r.patch("/customers/:id", can("customers.edit"), async (req, res) => {
  const id = uuidOr404(req.params.id);
  const body = parse(customerUpdateBody, req.body);
  const current = await loadCustomer(id);
  await checkUnique({ phone: body.phone !== current.phone ? body.phone : null, email: body.email && body.email !== current.email ? body.email : null }, id);
  const newRm = body.relationshipManagerId ? await checkRm(body.relationshipManagerId) : null;
  if (!seesSensitive(req.staff)) {
    // Without KYC access the PAN is shown masked: a PAN can be added, but not changed; KYC status can't be changed.
    if (body.pan !== undefined && current.profile?.pan && body.pan !== current.profile.pan) throw new HttpError(403, "Changing a PAN needs KYC access", { fields: { pan: "Changing a PAN needs KYC access" } });
    if (body.kycStatus && body.kycStatus !== current.kycStatus) throw new HttpError(403, "Changing KYC status needs KYC access", { fields: { kycStatus: "Changing KYC status needs KYC access" } });
  }

  const saved = await db.transaction(async (tx) => {
    const cust = await loadCustomer(id, tx, { lock: true });
    const { profile, changed } = mergeProfile(cust.profile, body);
    const set = { profile };
    for (const k of ["name", "phone", "email"]) if (body[k] !== undefined && body[k] !== cust[k]) { set[k] = body[k]; changed.push(k); }
    const kycChanged = body.kycStatus && body.kycStatus !== cust.kycStatus;
    if (kycChanged) set.kycStatus = body.kycStatus;
    const scoreChanged = body.creditScore !== undefined && body.creditScore !== cust.creditScore;
    if (scoreChanged) { set.creditScore = body.creditScore; set.creditScoreUpdatedAt = body.creditScore == null ? null : new Date(); }
    const rmChanged = body.relationshipManagerId !== undefined && body.relationshipManagerId !== cust.relationshipManagerId;
    if (rmChanged) set.relationshipManagerId = body.relationshipManagerId;

    const [row] = await tx.update(users).set(set).where(eq(users.id, id)).returning();
    // History keeps which fields changed; sensitive values (PAN, Aadhaar, income) are not copied into it.
    if (changed.length) await customerEvent(tx, id, "updated", req.staff.id, { meta: { fields: changed } });
    if (kycChanged) await customerEvent(tx, id, "kyc_changed", req.staff.id, { meta: { from: cust.kycStatus, to: body.kycStatus } });
    if (scoreChanged) await customerEvent(tx, id, "credit_score_updated", req.staff.id, { meta: { from: cust.creditScore, to: body.creditScore } });
    if (rmChanged) await customerEvent(tx, id, "rm_assigned", req.staff.id, { meta: { to: body.relationshipManagerId, toName: newRm?.name ?? null } });
    return { row, fields: [...changed, ...(kycChanged ? ["kycStatus"] : []), ...(scoreChanged ? ["creditScore"] : []), ...(rmChanged ? ["relationshipManager"] : [])] };
  });
  if (saved.fields.length) await audit(req, "customer.updated", { entityType: "customer", entityId: id, meta: { code: current.customerCode, fields: saved.fields } });
  const [rmRow] = saved.row.relationshipManagerId ? await db.select({ name: users.name }).from(users).where(eq(users.id, saved.row.relationshipManagerId)) : [];
  res.json({ customer: customerView(saved.row, { sensitive: true, rmName: rmRow?.name ?? null }), changed: saved.fields });
});

/* ---------- profile ---------- */

r.get("/customers/:id", can("customers.view"), async (req, res) => {
  const id = uuidOr404(req.params.id);
  const sensitive = seesSensitive(req.staff);
  const [row] = await db
    .select({ u: users, rmName: rm.name, createdByName: creator.name })
    .from(users)
    .leftJoin(rm, eq(users.relationshipManagerId, rm.id))
    .leftJoin(creator, eq(users.createdBy, creator.id))
    .where(and(eq(users.id, id), isCustomer))
    .limit(1);
  if (!row) throw new HttpError(404, "Customer not found");

  const leadOwner = alias(users, "lead_owner");
  const converter = alias(users, "converter");
  const leadRows = await db
    .select({
      id: leads.id, ref: leads.ref, kind: leads.kind, status: leads.status, source: leads.source, loanType: leads.loanType, loanAmount: leads.loanAmount,
      createdAt: leads.createdAt, convertedAt: leads.convertedAt, ownerName: leadOwner.name, convertedByName: converter.name,
      applicationRef: applications.ref, deletedAt: leads.deletedAt,
    })
    .from(leads)
    .leftJoin(leadOwner, eq(leads.ownerId, leadOwner.id))
    .leftJoin(converter, eq(leads.convertedBy, converter.id))
    .leftJoin(applications, eq(applications.leadId, leads.id))
    .where(eq(leads.userId, id))
    .orderBy(desc(leads.createdAt));
  const leadIds = leadRows.map((l) => l.id);
  const leadRef = Object.fromEntries(leadRows.map((l) => [l.id, l.ref]));
  const appLead = alias(leads, "app_lead");
  const assignee = alias(users, "assignee");
  const uploader = alias(users, "uploader");
  const reviewer = alias(users, "reviewer");

  const [apps, docs, fups, events] = await Promise.all([
    db
      .select({
        id: applications.id, ref: applications.ref, lenderName: applications.lenderName, type: applications.type, loanAmount: applications.loanAmount,
        tenureMonths: applications.tenureMonths, status: applications.status, createdAt: applications.createdAt, updatedAt: applications.updatedAt,
        leadRef: appLead.ref, createdByName: creator.name, source: sql`${applications.details}->>'source'`,
      })
      .from(applications)
      .leftJoin(appLead, eq(applications.leadId, appLead.id))
      .leftJoin(creator, eq(applications.createdBy, creator.id))
      .where(eq(applications.userId, id))
      .orderBy(desc(applications.createdAt)),
    db
      .select({
        id: documents.id, docType: documents.docType, fileName: documents.fileName, mimeType: documents.mimeType, sizeBytes: documents.sizeBytes,
        status: documents.status, note: documents.note, createdAt: documents.createdAt, reviewedAt: documents.reviewedAt,
        uploadedByName: uploader.name, reviewedByName: reviewer.name,
      })
      .from(documents)
      .leftJoin(uploader, eq(documents.uploadedBy, uploader.id))
      .leftJoin(reviewer, eq(documents.reviewedBy, reviewer.id))
      .where(and(eq(documents.customerId, id), isNull(documents.deletedAt)))
      .orderBy(desc(documents.createdAt)),
    db
      .select({ id: followups.id, leadId: followups.leadId, type: followups.type, dueAt: followups.dueAt, note: followups.note, status: followups.status, outcome: followups.outcome, assignedName: assignee.name })
      .from(followups)
      .leftJoin(assignee, eq(followups.assignedTo, assignee.id))
      .where(or(eq(followups.customerId, id), ...(leadIds.length ? [inArray(followups.leadId, leadIds)] : [])))
      .orderBy(desc(followups.dueAt)),
    db
      .select({ id: timelineEvents.id, entityType: timelineEvents.entityType, entityId: timelineEvents.entityId, type: timelineEvents.type, body: timelineEvents.body, meta: timelineEvents.meta, createdAt: timelineEvents.createdAt, actorName: actor.name })
      .from(timelineEvents)
      .leftJoin(actor, eq(timelineEvents.actorId, actor.id))
      .where(or(and(eq(timelineEvents.entityType, "customer"), eq(timelineEvents.entityId, id)), ...(leadIds.length ? [and(eq(timelineEvents.entityType, "lead"), inArray(timelineEvents.entityId, leadIds))] : [])))
      .orderBy(desc(timelineEvents.createdAt))
      .limit(300),
  ]);

  const now = new Date();
  // One history: stored events, plus the moments that are rows of their own (lead received, application logged, sign-up).
  const history = [
    ...events.map((e) => ({ ...e, leadRef: e.entityType === "lead" ? leadRef[e.entityId] : undefined, at: e.createdAt })),
    ...leadRows.map((l) => ({ id: `lead-origin:${l.id}`, entityType: "lead", type: "lead_received", leadRef: l.ref, at: l.createdAt, meta: { kind: l.kind, source: SOURCE_LABELS[l.source] ?? l.source } })),
    ...apps.map((a) => ({ id: `application:${a.id}`, entityType: "application", type: "application_created", at: a.createdAt, actorName: a.createdByName, meta: { ref: a.ref, lender: a.lenderName, loanType: typeLabel(a.type), loanAmount: a.loanAmount, status: a.status, website: !a.createdByName, leadRef: a.leadRef } })),
    ...(events.some((e) => e.entityType === "customer" && e.type === "created") ? [] : [{ id: `registered:${id}`, entityType: "customer", type: "registered", at: row.u.createdAt, meta: {} }]),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  res.json({
    customer: customerView(row.u, { sensitive, rmName: row.rmName, createdByName: row.createdByName }),
    canSeeSensitive: sensitive,
    stats: {
      applications: apps.length,
      activeApplications: apps.filter((a) => ["submitted", "in_review", "approved"].includes(a.status)).length,
      disbursed: apps.filter((a) => a.status === "disbursed").reduce((n, a) => n + a.loanAmount, 0),
      disbursedCount: apps.filter((a) => a.status === "disbursed").length,
      documents: docs.length,
      firstLeadSource: leadRows.at(-1) ? SOURCE_LABELS[leadRows.at(-1).source] : null,
    },
    applications: apps.map((a) => ({ ...a, loanType: typeLabel(a.type) })),
    leads: leadRows.filter((l) => !l.deletedAt).map((l) => ({ ...l, statusLabel: STATUS_LABELS[l.status], sourceLabel: SOURCE_LABELS[l.source], loanTypeLabel: l.loanType ? typeLabel(l.loanType) : null })),
    followups: fups.map((f) => ({ ...f, leadRef: leadRef[f.leadId], state: f.status === "pending" && f.dueAt < now ? "overdue" : f.status })),
    documents: docs.map((d) => ({ ...d, label: DOC_LABELS[d.docType] })),
    history,
  });
});

r.post("/customers/:id/notes", can("customers.edit"), async (req, res) => {
  const id = uuidOr404(req.params.id);
  const { body } = parse(noteBody, req.body);
  await loadCustomer(id);
  const [event] = await customerEvent(db, id, "note", req.staff.id, { body }).returning();
  res.status(201).json({ event: { ...event, actorName: req.staff.name } });
});

/* ---------- documents ---------- */

const MAX_BYTES = 5 * 1024 * 1024;

/** POST /api/crm/customers/:id/documents?docType=pan&fileName=pan.pdf — body is the raw file (PDF, JPG or PNG, ≤ 5 MB). */
r.post("/customers/:id/documents", can("customers.edit"), express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res) => {
  const id = uuidOr404(req.params.id);
  const q = parse(documentUploadQuery, req.query);
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buf?.length) throw new HttpError(400, "Choose a file to upload");
  const mime = sniffMime(buf);
  if (!mime) throw new HttpError(400, "Upload a PDF, JPG or PNG file");
  await loadCustomer(id);
  if (q.applicationId) {
    const [app] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.id, q.applicationId), eq(applications.userId, id))).limit(1);
    if (!app) throw new HttpError(400, "That application isn’t this customer’s", { fields: { applicationId: "Not this customer’s application" } });
  }
  const hash = createHash("sha256").update(buf).digest("hex");
  const [dup] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.customerId, id), eq(documents.sha256, hash), isNull(documents.deletedAt))).limit(1);
  if (dup) throw new HttpError(409, "This exact file is already in the customer’s documents");
  const fileName = q.fileName.replace(/[^\w.\- ()]/g, "_");
  const [doc] = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(documents)
      .values({ customerId: id, applicationId: q.applicationId ?? null, docType: q.docType, fileName, mimeType: mime, sizeBytes: buf.length, sha256: hash, content: buf, note: q.note ?? null, uploadedBy: req.staff.id })
      .returning({ id: documents.id, docType: documents.docType, fileName: documents.fileName, mimeType: documents.mimeType, sizeBytes: documents.sizeBytes, status: documents.status, note: documents.note, createdAt: documents.createdAt });
    await customerEvent(tx, id, "document_uploaded", req.staff.id, { meta: { documentId: rows[0].id, docType: q.docType, label: DOC_LABELS[q.docType], fileName, applicationId: q.applicationId } });
    return rows;
  });
  await audit(req, "document.uploaded", { entityType: "customer", entityId: id, meta: { documentId: doc.id, docType: q.docType, size: buf.length } });
  res.status(201).json({ document: { ...doc, label: DOC_LABELS[doc.docType], uploadedByName: req.staff.name } });
});

async function loadDocument(customerId, docId) {
  const [doc] = await db.select({ id: documents.id, docType: documents.docType, fileName: documents.fileName, status: documents.status })
    .from(documents).where(and(eq(documents.id, docId), eq(documents.customerId, customerId), isNull(documents.deletedAt))).limit(1);
  if (!doc) throw new HttpError(404, "Document not found");
  return doc;
}

r.get("/customers/:id/documents/:docId/file", can("customers.kyc"), async (req, res) => {
  const id = uuidOr404(req.params.id);
  const docId = uuidOr404(req.params.docId, "Document");
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, docId), eq(documents.customerId, id), isNull(documents.deletedAt))).limit(1);
  if (!doc) throw new HttpError(404, "Document not found");
  await audit(req, "document.downloaded", { entityType: "customer", entityId: id, meta: { documentId: docId, docType: doc.docType } });
  res.setHeader("Content-Type", doc.mimeType);
  res.setHeader("Content-Length", String(doc.sizeBytes));
  res.setHeader("Content-Disposition", `attachment; filename="${doc.fileName.replace(/"/g, "")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(doc.content);
});

r.patch("/customers/:id/documents/:docId", can("customers.kyc"), async (req, res) => {
  const id = uuidOr404(req.params.id);
  const docId = uuidOr404(req.params.docId, "Document");
  const body = parse(documentUpdateBody, req.body);
  const doc = await loadDocument(id, docId);
  const reviewed = body.status !== "uploaded";
  await db.transaction(async (tx) => {
    await tx.update(documents).set({ status: body.status, ...(body.note !== undefined && { note: body.note }), reviewedBy: reviewed ? req.staff.id : null, reviewedAt: reviewed ? new Date() : null }).where(eq(documents.id, docId));
    if (body.status !== doc.status) await customerEvent(tx, id, `document_${body.status}`, req.staff.id, { body: body.note ?? null, meta: { documentId: docId, docType: doc.docType, label: DOC_LABELS[doc.docType], fileName: doc.fileName } });
  });
  await audit(req, "document.reviewed", { entityType: "customer", entityId: id, meta: { documentId: docId, status: body.status } });
  res.json({ ok: true });
});

r.delete("/customers/:id/documents/:docId", can("customers.kyc"), async (req, res) => {
  const id = uuidOr404(req.params.id);
  const docId = uuidOr404(req.params.docId, "Document");
  const doc = await loadDocument(id, docId);
  await db.transaction(async (tx) => {
    await tx.update(documents).set({ deletedAt: new Date(), deletedBy: req.staff.id }).where(eq(documents.id, docId));
    await customerEvent(tx, id, "document_deleted", req.staff.id, { meta: { documentId: docId, docType: doc.docType, label: DOC_LABELS[doc.docType], fileName: doc.fileName } });
  });
  await audit(req, "document.deleted", { entityType: "customer", entityId: id, meta: { documentId: docId } });
  res.json({ ok: true });
});

export default r;
