import { and, count, desc, eq, gte, ilike, like, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Router } from "express";
import { auditLogs, users } from "../../db/schema.js";
import { audit } from "../../crm/audit.js";
import { can } from "../../crm/middleware.js";
import { auditListQuery } from "../../crm/validate.js";
import { db } from "../../lib/db.js";
import { parse } from "../../lib/validate.js";

const r = Router();
const target = alias(users, "target"); // the user an action was about (role change, suspension…)

/** WHERE shared by the list and the export. `action` ending in "." matches a prefix. */
function auditWhere({ q, action, actorId, from, to }) {
  const where = [];
  if (action) where.push(action.endsWith(".") ? like(auditLogs.action, `${action}%`) : eq(auditLogs.action, action));
  if (actorId) where.push(eq(auditLogs.actorId, actorId));
  if (from) where.push(gte(auditLogs.createdAt, from));
  if (to) where.push(lte(auditLogs.createdAt, to));
  if (q) where.push(or(ilike(auditLogs.actorEmail, `%${q}%`), ilike(auditLogs.action, `%${q}%`), ilike(auditLogs.ip, `%${q}%`), ilike(users.name, `%${q}%`)));
  return where.length ? and(...where) : undefined;
}
const withNames = () =>
  db
    .select({ log: auditLogs, actorName: users.name, targetName: target.name, targetEmail: target.email })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .leftJoin(target, and(eq(auditLogs.entityType, "user"), sql`${target.id}::text = ${auditLogs.entityId}`));

/** GET /api/crm/audit-logs?action=auth.&actorId=&from=&to=&q=&page= — newest first. */
r.get("/audit-logs", can("audit.view"), async (req, res) => {
  const f = parse(auditListQuery, req.query);
  const { page, pageSize } = f;
  const filter = auditWhere(f);

  const [rows, [{ total }]] = await Promise.all([
    withNames()
      .where(filter)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(auditLogs).leftJoin(users, eq(auditLogs.actorId, users.id)).where(filter),
  ]);
  res.json({ logs: rows.map(({ log, ...names }) => ({ ...log, ...names })), total, page, pageSize });
});

const EXPORT_MAX = 10000;
const cell = (v) => (v == null ? "" : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** GET /api/crm/audit-logs/export — the filtered log as CSV, newest first. The export itself is audited. */
r.get("/audit-logs/export", can("audit.export"), async (req, res) => {
  const f = parse(auditListQuery, req.query);
  // shortcut: capped at 10,000 rows per file; narrow the dates for more, or stream if logs grow much larger.
  const rows = await withNames().where(auditWhere(f)).orderBy(desc(auditLogs.createdAt)).limit(EXPORT_MAX);
  const head = ["Time (UTC)", "Action", "Actor", "Actor email", "Target", "Entity type", "Entity id", "IP", "User agent", "Details"];
  const lines = rows.map(({ log, actorName, targetName, targetEmail }) => [
    log.createdAt.toISOString(), log.action, actorName, log.actorEmail, targetName ?? targetEmail, log.entityType, log.entityId, log.ip, log.userAgent, JSON.stringify(log.meta),
  ]);
  await audit(req, "audit.exported", { meta: { rows: rows.length, filters: Object.fromEntries(Object.entries({ q: f.q, action: f.action, actorId: f.actorId, from: f.from, to: f.to }).filter(([, v]) => v)) } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + [head, ...lines].map((l) => l.map(cell).join(",")).join("\r\n"));
});

export default r;
