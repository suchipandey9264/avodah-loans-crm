import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Router } from "express";
import { applications, LENDER_KINDS, lenders } from "../../db/schema.js";
import { applicationScope, STAGE_LABELS } from "../../crm/applications.js";
import { audit } from "../../crm/audit.js";
import { can } from "../../crm/middleware.js";
import { hasPermission } from "../../crm/permissions.js";
import { lenderCreateBody, lenderListQuery, lenderUpdateBody } from "../../crm/validate.js";
import { LOAN_TYPES } from "../../data/loans.js";
import { db } from "../../lib/db.js";
import { HttpError } from "../../lib/http.js";
import { parse } from "../../lib/validate.js";

// CRM lender management. Products stay in lenders.products — the same list the website's offers and
// CRM applications read — so editing here changes what customers see and what new applications accept.

const r = Router();
const OPEN = ["new", "login", "documents", "credit_review", "sanctioned"];
const like = (q) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const lowestRate = (products) => (products.length ? Math.min(...products.map((p) => p.rate)) : null);

/** Per-lender figures from real applications: files, open files, approval rate of decided files, disbursed. */
const stats = (where = undefined) =>
  db
    .select({
      lenderId: applications.lenderId,
      files: sql`count(*)`.mapWith(Number),
      open: sql`count(*) filter (where ${applications.stage} in ('new','login','documents','credit_review','sanctioned'))`.mapWith(Number),
      approved: sql`count(*) filter (where ${applications.stage} in ('sanctioned','disbursed'))`.mapWith(Number),
      decided: sql`count(*) filter (where ${applications.stage} in ('sanctioned','disbursed','rejected'))`.mapWith(Number),
      disbursed: sql`coalesce(sum(coalesce(${applications.disbursedAmount}, ${applications.loanAmount})) filter (where ${applications.stage} = 'disbursed'), 0)`.mapWith(Number),
    })
    .from(applications)
    .where(where)
    .groupBy(applications.lenderId);
// shortcut: payout earned uses the lender's current payout %, not the rate on the day of disbursal; store it per file if rates change often.
const withStats = (l, s) => ({
  ...l,
  stats: { files: s?.files ?? 0, open: s?.open ?? 0, disbursed: s?.disbursed ?? 0, approvalRate: s?.decided ? s.approved / s.decided : null, payoutEarned: ((s?.disbursed ?? 0) * (l.payoutPct ?? 0)) / 100 },
});
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

r.get("/lenders", can("lenders.view"), async (req, res) => {
  const f = parse(lenderListQuery, req.query);
  const w = [];
  if (f.q) w.push(or(ilike(lenders.name, like(f.q)), ilike(lenders.fullName, like(f.q)), ilike(lenders.id, like(f.q))));
  if (f.kind) w.push(eq(lenders.kind, f.kind));
  if (f.status) w.push(eq(lenders.active, f.status === "active"));
  if (f.loanType) w.push(sql`${lenders.products} @> ${JSON.stringify([{ type: f.loanType }])}::jsonb`);
  // shortcut: no pagination — fine for a partner list of a few hundred lenders; add paging if it grows past that.
  const [rows, everyone, s] = await Promise.all([
    db.select().from(lenders).where(w.length ? and(...w) : undefined).orderBy(asc(lenders.sortOrder), asc(lenders.name)),
    db.select({ id: lenders.id, active: lenders.active, payoutPct: lenders.payoutPct, tatDays: lenders.tatDays }).from(lenders),
    stats(),
  ]);
  const byId = new Map(s.map((x) => [x.lenderId, x]));
  // Totals cover the whole network, whatever the filters.
  const net = everyone.map((l) => withStats(l, byId.get(l.id)));
  const live = everyone.filter((l) => l.active);
  res.json({
    lenders: rows.map((l) => withStats(l, byId.get(l.id))),
    totals: {
      total: everyone.length,
      active: live.length,
      disbursed: net.reduce((n, l) => n + l.stats.disbursed, 0),
      open: net.reduce((n, l) => n + l.stats.open, 0),
      payoutEarned: net.reduce((n, l) => n + l.stats.payoutEarned, 0),
      avgTatDays: avg(live.map((l) => l.tatDays).filter((x) => x != null)),
      avgPayoutPct: avg(live.map((l) => l.payoutPct).filter((x) => x != null)),
    },
    kinds: LENDER_KINDS,
    loanTypes: LOAN_TYPES.map((t) => ({ id: t.id, label: t.label })),
  });
});

async function loadLender(id) {
  const [l] = await db.select().from(lenders).where(eq(lenders.id, String(id))).limit(1);
  if (!l) throw new HttpError(404, "Lender not found");
  return l;
}

async function lenderDetail(req, id) {
  const l = await loadLender(id);
  const [s] = await stats(eq(applications.lenderId, l.id));
  let recent = [];
  if (hasPermission(req.staff.permissions, "applications.view")) {
    const scope = applicationScope(req.staff);
    recent = await db
      .select({ id: applications.id, ref: applications.ref, type: applications.type, loanAmount: applications.loanAmount, stage: applications.stage, contactName: sql`${applications.contact}->>'name'`, updatedAt: applications.updatedAt })
      .from(applications).where(and(eq(applications.lenderId, l.id), ...(scope ? [scope] : []))).orderBy(desc(applications.updatedAt)).limit(10);
  }
  const typeLabel = (t) => LOAN_TYPES.find((x) => x.id === t)?.label ?? t;
  return {
    lender: withStats(l, s),
    applications: recent.map((a) => ({ ...a, loanType: typeLabel(a.type), stageLabel: STAGE_LABELS[a.stage] })),
  };
}

r.get("/lenders/:id", can("lenders.view"), async (req, res) => res.json(await lenderDetail(req, req.params.id)));

r.post("/lenders", can("lenders.create"), async (req, res) => {
  const body = parse(lenderCreateBody, req.body);
  const [{ next }] = await db.select({ next: sql`coalesce(max(${lenders.sortOrder}), -1) + 1`.mapWith(Number) }).from(lenders);
  const [row] = await db
    .insert(lenders)
    .values({ ...body, sortOrder: next, lowestRate: lowestRate(body.products) })
    .returning()
    .catch((err) => {
      if ((err.cause?.code ?? err.code) === "23505") throw new HttpError(409, "A lender with this ID already exists", { fields: { id: "This ID is taken" } });
      throw err;
    });
  await audit(req, "lender.created", { entityType: "lender", entityId: row.id, meta: { name: row.name, products: row.products.length } });
  res.status(201).json(await lenderDetail(req, row.id));
});

r.patch("/lenders/:id", can("lenders.edit"), async (req, res) => {
  const body = parse(lenderUpdateBody, req.body);
  const l = await loadLender(req.params.id);
  if (body.products) {
    // A product with open applications can't disappear: those files are validated against it.
    const removed = l.products.map((p) => p.type).filter((t) => !body.products.some((p) => p.type === t));
    if (removed.length) {
      const inUse = await db.select({ type: applications.type, n: sql`count(*)`.mapWith(Number) }).from(applications)
        .where(and(eq(applications.lenderId, l.id), inArray(applications.type, removed), inArray(applications.stage, OPEN))).groupBy(applications.type);
      if (inUse.length) {
        const label = (t) => LOAN_TYPES.find((x) => x.id === t)?.label ?? t;
        throw new HttpError(409, `Can’t remove ${inUse.map((x) => `${label(x.type)} (${x.n} open application${x.n === 1 ? "" : "s"})`).join(", ")}. Close or move those files first.`);
      }
    }
  }
  const set = { ...body, ...(body.products && { lowestRate: lowestRate(body.products) }) };
  await db.update(lenders).set(set).where(eq(lenders.id, l.id));
  const fields = Object.keys(body).filter((k) => JSON.stringify(body[k]) !== JSON.stringify(l[k]));
  if (fields.length) await audit(req, "active" in body && body.active !== l.active ? (body.active ? "lender.activated" : "lender.deactivated") : "lender.updated", { entityType: "lender", entityId: l.id, meta: { name: l.name, fields } });
  res.json(await lenderDetail(req, l.id));
});

// Only a lender that never had an application can be deleted; otherwise deactivate it so its files keep their history.
r.delete("/lenders/:id", can("lenders.delete"), async (req, res) => {
  const l = await loadLender(req.params.id);
  const [{ n }] = await db.select({ n: sql`count(*)`.mapWith(Number) }).from(applications).where(eq(applications.lenderId, l.id));
  if (n) throw new HttpError(409, `${l.name} has ${n} application${n === 1 ? "" : "s"} on record. Deactivate it instead — it disappears from the website and new applications, and its files keep their history.`);
  await db.delete(lenders).where(eq(lenders.id, l.id));
  await audit(req, "lender.deleted", { entityType: "lender", entityId: l.id, meta: { name: l.name } });
  res.json({ ok: true });
});

export default r;
