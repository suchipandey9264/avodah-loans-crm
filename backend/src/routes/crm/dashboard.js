import { sql } from "drizzle-orm";
import { Router } from "express";
import { can } from "../../crm/middleware.js";
import { leadScopeSql } from "../../crm/leads.js";
import { hasPermission } from "../../crm/permissions.js";
import { dashboardQuery } from "../../crm/validate.js";
import { LOAN_TYPES } from "../../data/loans.js";
import { db } from "../../lib/db.js";
import { parse } from "../../lib/validate.js";

// GET /api/crm/dashboard?from=&to= — every figure is computed from PostgreSQL for the period [from, to),
// compared with the period of the same length just before it. Sections the role can't see are not computed.

const r = Router();
const TZ = process.env.CRM_TIMEZONE ?? "Asia/Kolkata"; // day/week/month buckets follow this clock
const typeLabel = (id) => LOAN_TYPES.find((t) => t.id === id)?.label ?? id;
const rows = async (query) => (await db.execute(query)).rows;
const when = (flag, fn) => (flag ? fn() : null);

/**
 * What a role may see. Totals and charts need the module's view permission or reports.view;
 * record lists (names, phone numbers) need the module's own view permission.
 */
export function dashboardAccess(permissions) {
  const has = (p) => hasPermission(permissions, p);
  const stats = (m) => has(`${m}.view`) || has("reports.view");
  return {
    leadStats: stats("leads"),
    customerStats: stats("customers"),
    applicationStats: stats("applications"),
    lenderStats: stats("lenders"),
    leadRecords: has("leads.view"),
    customerRecords: has("customers.view"),
    applicationRecords: has("applications.view"),
  };
}

const bucketUnit = (from, to) => {
  const days = (to - from) / 86400000;
  return days <= 35 ? "day" : days <= 200 ? "week" : "month";
};

const between = (column, from, to) => sql`${sql.raw(column)} >= ${from} and ${sql.raw(column)} < ${to}`;

r.get("/dashboard", can("dashboard.view"), async (req, res) => {
  const { from, to } = parse(dashboardQuery, req.query);
  const prevFrom = new Date(from.getTime() - (to - from));
  const unit = bucketUnit(from, to);
  const a = dashboardAccess(req.staff.permissions);
  const inRange = (col) => between(col, from, to);
  const inPrev = (col) => between(col, prevFrom, from);

  const [kpis, statuses, prevAmounts, series, loanTypes, recentLeads, recentApps, recentCustomers] = await Promise.all([
    rows(sql`select
      ${a.leadStats ? sql`(select count(*)::int from leads where deleted_at is null and ${inRange("created_at")})` : sql`null`} as leads,
      ${a.leadStats ? sql`(select count(*)::int from leads where deleted_at is null and ${inPrev("created_at")})` : sql`null`} as leads_prev,
      ${a.customerStats ? sql`(select count(*)::int from users where role_id is null and ${inRange("created_at")})` : sql`null`} as customers,
      ${a.customerStats ? sql`(select count(*)::int from users where role_id is null and ${inPrev("created_at")})` : sql`null`} as customers_prev,
      ${a.customerStats ? sql`(select count(*)::int from users where role_id is null)` : sql`null`} as customers_total,
      ${a.applicationStats ? sql`(select count(*)::int from applications where ${inRange("created_at")})` : sql`null`} as applications,
      ${a.applicationStats ? sql`(select count(*)::int from applications where ${inPrev("created_at")})` : sql`null`} as applications_prev,
      ${a.lenderStats ? sql`(select count(*)::int from lenders where active)` : sql`null`} as lenders_active,
      ${a.lenderStats && a.applicationStats ? sql`(select count(distinct lender_id)::int from applications where ${inRange("created_at")})` : sql`null`} as lenders_used`).then((x) => x[0]),
    when(a.applicationStats, () =>
      rows(sql`select status, count(*)::int as count, coalesce(sum(loan_amount), 0)::float8 as amount
               from applications where ${inRange("created_at")} group by status`)),
    when(a.applicationStats, () =>
      rows(sql`select coalesce(sum(loan_amount), 0)::float8 as requested,
                      coalesce(sum(loan_amount) filter (where status = 'disbursed'), 0)::float8 as disbursed
               from applications where ${inPrev("created_at")}`).then((x) => x[0])),
    when(a.leadStats || a.applicationStats, () =>
      rows(sql`with b as (
                 select generate_series(
                   date_trunc(${unit}, ${from}::timestamptz at time zone ${TZ}),
                   date_trunc(${unit}, (${to}::timestamptz - interval '1 millisecond') at time zone ${TZ}),
                   ('1 ' || ${unit})::interval) as k),
               l as (select date_trunc(${unit}, created_at at time zone ${TZ}) as k, count(*)::int as n
                     from leads where deleted_at is null and ${inRange("created_at")} group by 1),
               ap as (select date_trunc(${unit}, created_at at time zone ${TZ}) as k, count(*)::int as n,
                             sum(loan_amount)::float8 as requested,
                             (sum(loan_amount) filter (where status = 'disbursed'))::float8 as disbursed
                      from applications where ${inRange("created_at")} group by 1)
               select to_char(b.k, 'YYYY-MM-DD') as bucket, coalesce(l.n, 0) as leads, coalesce(ap.n, 0) as applications,
                      coalesce(ap.requested, 0) as requested, coalesce(ap.disbursed, 0) as disbursed
               from b left join l on l.k = b.k left join ap on ap.k = b.k order by b.k`)),
    when(a.applicationStats, () =>
      rows(sql`select type, count(*)::int as count, coalesce(sum(loan_amount), 0)::float8 as amount
               from applications where ${inRange("created_at")} group by type order by count desc, amount desc`)),
    when(a.leadRecords, () =>
      rows(sql`select id, ref, kind, name, phone, email, status, source, created_at as "createdAt"
               from leads where deleted_at is null and ${leadScopeSql(req.staff)} and ${inRange("created_at")}
               order by created_at desc limit 10`)),
    when(a.applicationRecords, () =>
      rows(sql`select id, ref, contact->>'name' as name, contact->>'phone' as phone, lender_name as "lenderName", type,
                      loan_amount::float8 as "loanAmount", status, created_at as "createdAt"
               from applications where ${inRange("created_at")} order by created_at desc limit 10`)),
    when(a.customerRecords, () =>
      rows(sql`select id, name, phone, email, created_at as "createdAt"
               from users where role_id is null and ${inRange("created_at")} order by created_at desc limit 10`)),
  ]);

  // ---- shape the response ----
  const byStatus = Object.fromEntries((statuses ?? []).map((s) => [s.status, s]));
  const count = (...keys) => keys.reduce((n, k) => n + (byStatus[k]?.count ?? 0), 0);
  const amount = (...keys) => keys.reduce((n, k) => n + (byStatus[k]?.amount ?? 0), 0);
  const totalApps = count("submitted", "in_review", "approved", "rejected", "disbursed");

  const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));
  const seriesKeys = ["bucket", ...(a.leadStats ? ["leads"] : []), ...(a.applicationStats ? ["applications", "requested", "disbursed"] : [])];

  const activity = [
    ...(recentLeads ?? []).map((l) => ({ type: "lead", id: l.id, at: l.createdAt, name: l.name, kind: l.kind })),
    ...(recentApps ?? []).map((x) => ({ type: "application", id: x.id, at: x.createdAt, name: x.name, ref: x.ref, lenderName: x.lenderName, loanType: typeLabel(x.type), loanAmount: x.loanAmount })),
    ...(recentCustomers ?? []).map((c) => ({ type: "customer", id: c.id, at: c.createdAt, name: c.name || c.phone || c.email })),
  ]
    .sort((x, y) => new Date(y.at) - new Date(x.at))
    .slice(0, 10);

  res.json({
    range: { from, to, previousFrom: prevFrom, previousTo: from, unit, timezone: TZ },
    kpis: {
      leads: a.leadStats ? { value: kpis.leads, previous: kpis.leads_prev } : null,
      customers: a.customerStats ? { value: kpis.customers, previous: kpis.customers_prev, total: kpis.customers_total } : null,
      applications: a.applicationStats ? { value: kpis.applications, previous: kpis.applications_prev } : null,
      lenders: a.lenderStats ? { active: kpis.lenders_active, withApplications: kpis.lenders_used } : null,
    },
    statuses: a.applicationStats
      ? { total: totalApps, approved: count("approved"), disbursed: count("disbursed"), pending: count("submitted", "in_review"), inReview: count("in_review"), rejected: count("rejected") }
      : null,
    amounts: a.applicationStats
      ? {
          requested: amount("submitted", "in_review", "approved", "rejected", "disbursed"),
          approved: amount("approved", "disbursed"),
          disbursed: amount("disbursed"),
          average: totalApps ? amount("submitted", "in_review", "approved", "rejected", "disbursed") / totalApps : 0,
          previousRequested: prevAmounts.requested,
          previousDisbursed: prevAmounts.disbursed,
        }
      : null,
    series: series ? series.map((row) => pick(row, seriesKeys)) : null,
    funnel: a.applicationStats
      ? [
          ...(a.leadStats ? [{ stage: "leads", label: "Leads", value: kpis.leads }] : []),
          { stage: "applications", label: "Applications", value: totalApps },
          { stage: "approved", label: "Approved", value: count("approved", "disbursed") },
          { stage: "disbursed", label: "Disbursed", value: count("disbursed") },
        ]
      : null,
    loanTypes: loanTypes ? loanTypes.map((t) => ({ type: t.type, label: typeLabel(t.type), count: t.count, amount: t.amount })) : null,
    recentLeads: recentLeads ? recentLeads.slice(0, 6) : null,
    recentApplications: recentApps ? recentApps.slice(0, 6).map((x) => ({ ...x, loanType: typeLabel(x.type) })) : null,
    activity: a.leadRecords || a.applicationRecords || a.customerRecords ? activity : null,
  });
});

export default r;
