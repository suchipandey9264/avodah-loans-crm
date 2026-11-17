import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { applications, leads, roles, users } from "../../db/schema.js";
import { staffView } from "../../crm/accounts.js";
import { applicationEvent, OPEN_STAGES } from "../../crm/applications.js";
import { audit } from "../../crm/audit.js";
import { leadEvent, OPEN, STATUS_LABELS } from "../../crm/leads.js";
import { can } from "../../crm/middleware.js";
import { hasPermission } from "../../crm/permissions.js";
import { employeeListQuery, reassignBody } from "../../crm/validate.js";
import { db } from "../../lib/db.js";
import { HttpError } from "../../lib/http.js";
import { parse } from "../../lib/validate.js";

// Employee Management: staff are the same `users` rows as Settings → Users (role_id set); profile fields
// (department, designation, branch, monthly target, joined on) live in users.profile. Creating and editing
// go through POST/PATCH /users, which accept employees.create / employees.edit. Figures come from real rows.

const r = Router();
const TZ = process.env.CRM_TIMEZONE ?? "Asia/Kolkata";
const monthStart = sql`(date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ})`;
const rows = async (q) => (await db.execute(q)).rows;
const open = sql.join(OPEN.map((s) => sql`${s}`), sql`, `);
const openStages = sql.join(OPEN_STAGES.map((s) => sql`${s}`), sql`, `);
const staffId = (raw) => {
  const ok = z.uuid().safeParse(raw);
  if (!ok.success) throw new HttpError(404, "Employee not found");
  return ok.data;
};

/** Per-employee workload and results. `where` narrows the staff rows (alias u). */
const statsSql = (where) => sql`
  select u.id,
    (select count(*)::int from leads l where l.owner_id = u.id and l.deleted_at is null) as leads,
    (select count(*)::int from leads l where l.owner_id = u.id and l.deleted_at is null and l.status in (${open})) as open_leads,
    (select count(*)::int from leads l where l.owner_id = u.id and l.deleted_at is null and l.status = 'converted') as converted,
    (select count(*)::int from applications a where a.assigned_to = u.id) as files,
    (select count(*)::int from applications a where a.assigned_to = u.id and a.stage in (${openStages})) as open_files,
    (select coalesce(sum(a.disbursed_amount), 0)::float8 from applications a where a.assigned_to = u.id and a.stage = 'disbursed') as disbursed,
    (select coalesce(sum(a.disbursed_amount), 0)::float8 from applications a where a.assigned_to = u.id and a.stage = 'disbursed' and a.disbursed_at >= ${monthStart}) as disbursed_month,
    (select count(*)::int from followups f where f.assigned_to = u.id and f.status = 'pending' and f.due_at < now()) as overdue_followups
  from users u join roles r on r.id = u.role_id where ${where}`;

const withStats = (user, role, s = {}) => ({
  ...staffView(user, role),
  stats: {
    leads: s.leads ?? 0, openLeads: s.open_leads ?? 0, converted: s.converted ?? 0,
    conversion: s.leads ? s.converted / s.leads : null,
    files: s.files ?? 0, openFiles: s.open_files ?? 0, disbursed: s.disbursed ?? 0, disbursedMonth: s.disbursed_month ?? 0,
    overdueFollowups: s.overdue_followups ?? 0,
  },
});

async function loadStaff(id) {
  const [row] = await db.select({ user: users, role: roles }).from(users).innerJoin(roles, eq(users.roleId, roles.id)).where(eq(users.id, id)).limit(1);
  if (!row) throw new HttpError(404, "Employee not found");
  return row;
}

/** GET /employees — the team with figures, plus totals for the tiles. */
r.get("/employees", can("employees.view"), async (req, res) => {
  const f = parse(employeeListQuery, req.query);
  const like = f.q && `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
  const w = [sql`true`];
  if (like) w.push(sql`(u.name ilike ${like} or u.email ilike ${like} or u.phone ilike ${like})`);
  if (f.role) w.push(sql`u.role_id = ${f.role}`);
  if (f.branch) w.push(sql`u.profile->>'branch' = ${f.branch}`);
  if (f.status) w.push(sql`u.status = ${f.status}`);
  const [list, stats, [team], branches, roleList] = await Promise.all([
    db.select({ user: users, role: roles }).from(users).innerJoin(roles, eq(users.roleId, roles.id)),
    rows(statsSql(sql.join(w, sql` and `))),
    rows(sql`select
      count(*) filter (where u.status = 'active')::int as active, count(*) filter (where u.status <> 'active')::int as inactive,
      coalesce(sum((u.profile->>'monthlyTarget')::float8) filter (where u.status = 'active'), 0)::float8 as target,
      (select coalesce(sum(disbursed_amount), 0)::float8 from applications where stage = 'disbursed' and disbursed_at >= ${monthStart}) as achieved,
      (select count(*)::int from leads where owner_id is null and deleted_at is null and status in (${open})) as unassigned
      from users u where u.role_id is not null`),
    rows(sql`select distinct profile->>'branch' as b from users where role_id is not null and coalesce(profile->>'branch', '') <> '' order by 1`),
    db.select({ id: roles.id, name: roles.name, rank: roles.rank }).from(roles),
  ]);
  const byId = Object.fromEntries(stats.map((s) => [s.id, s]));
  const employees = list
    .filter(({ user }) => byId[user.id])
    .map(({ user, role }) => withStats(user, role, byId[user.id]))
    .sort((a, b) => b.role.rank - a.role.rank || a.name.localeCompare(b.name));
  res.json({
    employees,
    team: { ...team, members: team.active + team.inactive },
    branches: branches.map((x) => x.b),
    roles: roleList.sort((a, b) => b.rank - a.rank),
  });
});

/** GET /employees/:id — profile, figures, what's on their desk, and recent activity. */
r.get("/employees/:id", can("employees.view"), async (req, res) => {
  const id = staffId(req.params.id);
  const { user, role } = await loadStaff(id);
  const has = (p) => hasPermission(req.staff.permissions, p);
  const [[s], openLeads, openApps, activity] = await Promise.all([
    rows(statsSql(sql`u.id = ${id}`)),
    has("leads.view")
      ? db.select({ id: leads.id, ref: leads.ref, name: leads.name, status: leads.status, loanAmount: leads.loanAmount }).from(leads)
          .where(and(eq(leads.ownerId, id), isNull(leads.deletedAt), inArray(leads.status, OPEN))).orderBy(sql`${leads.createdAt} desc`).limit(10)
      : [],
    has("applications.view")
      ? db.select({ id: applications.id, ref: applications.ref, name: sql`${applications.contact}->>'name'`, stage: applications.stage, loanAmount: applications.loanAmount, lenderName: applications.lenderName }).from(applications)
          .where(and(eq(applications.assignedTo, id), inArray(applications.stage, OPEN_STAGES))).orderBy(sql`${applications.createdAt} desc`).limit(10)
      : [],
    rows(sql`select * from (
        select 'record' as kind, t.type, t.entity_type as "entityType", t.entity_id as "entityId", t.created_at as "createdAt", coalesce(l.ref, a.ref, c.customer_code) as ref
        from timeline_events t left join leads l on t.entity_type = 'lead' and l.id = t.entity_id
          left join applications a on t.entity_type = 'application' and a.id = t.entity_id
          left join users c on t.entity_type = 'customer' and c.id = t.entity_id
        where t.actor_id = ${id}
        union all
        select 'account', action, entity_type, null, created_at, null from audit_logs where actor_id = ${id} and action like 'auth.%'
      ) x order by "createdAt" desc limit 15`),
  ]);
  res.json({ employee: withStats(user, role, s), openLeads: openLeads.map((l) => ({ ...l, statusLabel: STATUS_LABELS[l.status] })), openApplications: openApps, activity });
});

/** POST /employees/:id/reassign — hands this employee's open leads and/or open files to someone else (e.g. before deactivating). */
r.post("/employees/:id/reassign", can("employees.edit"), async (req, res) => {
  const id = staffId(req.params.id);
  const body = parse(reassignBody, req.body);
  const has = (p) => hasPermission(req.staff.permissions, p);
  if (body.leads && !has("leads.assign")) throw new HttpError(403, "You can’t reassign leads");
  if (body.applications && !has("applications.edit")) throw new HttpError(403, "You can’t reassign applications");
  if (body.to === id) throw new HttpError(400, "Choose someone else", { fields: { to: "Choose someone else" } });
  await loadStaff(id);
  const { user: to } = await loadStaff(body.to);
  if (to.status !== "active") throw new HttpError(400, "Choose an active employee", { fields: { to: "Choose an active employee" } });

  const moved = await db.transaction(async (tx) => {
    let leadRows = [], appRows = [];
    if (body.leads) {
      leadRows = await tx.update(leads).set({ ownerId: to.id, assignedAt: new Date() })
        .where(and(eq(leads.ownerId, id), isNull(leads.deletedAt), inArray(leads.status, OPEN))).returning({ id: leads.id });
      for (const l of leadRows) await leadEvent(tx, l.id, "assigned", req.staff.id, { meta: { from: id, to: to.id, toName: to.name, bulk: true } });
    }
    if (body.applications) {
      appRows = await tx.update(applications).set({ assignedTo: to.id })
        .where(and(eq(applications.assignedTo, id), inArray(applications.stage, OPEN_STAGES))).returning({ id: applications.id });
      for (const a of appRows) await applicationEvent(tx, a.id, "assigned", req.staff.id, { meta: { from: id, to: to.id, toName: to.name } });
    }
    return { leads: leadRows.length, applications: appRows.length };
  });
  await audit(req, "employee.work_reassigned", { entityType: "user", entityId: id, meta: { to: to.id, ...moved } });
  res.json({ moved });
});

export default r;
