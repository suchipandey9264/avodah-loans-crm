import { sql } from "drizzle-orm";
import { Router } from "express";
import { can } from "../../crm/middleware.js";
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

/** What a role may see: totals and charts need the module's view permission or reports.view. */
export function dashboardAccess(permissions) {
  const has = (p) => hasPermission(permissions, p);
  const stats = (m) => has(`${m}.view`) || has("reports.view");
  return {
    leadStats: stats("leads"),
    customerStats: stats("customers"),
    applicationStats: stats("applications"),
    lenderStats: stats("lenders"),
  };
}

const bucketUnit = (from, to) => {
  const days = (to - from) / 86400000;
  return days <= 35 ? "day" : days <= 200 ? "week" : "month";
};

const between = (column, from, to) => sql`${sql.raw(column)} >= ${from} and ${sql.raw(column)} < ${to}`;

// Credit-score bands for eligibility insights, best first.
const BANDS = [["750+", "750 and above"], ["700-749", "700–749"], ["650-699", "650–699"], ["below-650", "Below 650"], ["unknown", "No credit score"]];

r.get("/dashboard", can("dashboard.view"), async (req, res) => {
  const { from, to } = parse(dashboardQuery, req.query);
  const prevFrom = new Date(from.getTime() - (to - from));
  const unit = bucketUnit(from, to);
  const a = dashboardAccess(req.staff.permissions);
  const inRange = (col) => between(col, from, to);
  const inPrev = (col) => between(col, prevFrom, from);

  const [kpis, statuses, prevAmounts, series, loanTypes, topLenders, cities, eligibility] = await Promise.all([
    rows(sql`select
      ${a.leadStats ? sql`(select count(*)::int from leads where deleted_at is null and ${inRange("created_at")})` : sql`null`} as leads,
      ${a.leadStats ? sql`(select count(*)::int from leads where deleted_at is null and ${inPrev("created_at")})` : sql`null`} as leads_prev,
      ${a.customerStats ? sql`(select count(*)::int from users where role_id is null and ${inRange("created_at")})` : sql`null`} as customers,
      ${a.customerStats ? sql`(select count(*)::int from users where role_id is null and ${inPrev("created_at")})` : sql`null`} as customers_prev,
      ${a.customerStats ? sql`(select count(*)::int from users where role_id is null)` : sql`null`} as customers_total,
      ${a.applicationStats ? sql`(select count(*)::int from applications where ${inRange("created_at")})` : sql`null`} as applications,
      ${a.applicationStats ? sql`(select count(*)::int from applications where ${inPrev("created_at")})` : sql`null`} as applications_prev,
      ${a.applicationStats ? sql`(select round(avg(rate)::numeric, 2)::float8 from applications where ${inRange("created_at")})` : sql`null`} as avg_rate,
      ${a.applicationStats ? sql`(select round(avg(rate)::numeric, 2)::float8 from applications where ${inPrev("created_at")})` : sql`null`} as avg_rate_prev,
      ${a.lenderStats ? sql`(select count(*)::int from lenders where active)` : sql`null`} as lenders_active,
      ${a.lenderStats && a.applicationStats ? sql`(select count(distinct lender_id)::int from applications where ${inRange("created_at")})` : sql`null`} as lenders_used`).then((x) => x[0]),
    when(a.applicationStats, () =>
      rows(sql`select status, count(*)::int as count, coalesce(sum(loan_amount), 0)::float8 as amount
               from applications where ${inRange("created_at")} group by status`)),
    when(a.applicationStats, () =>
      rows(sql`select coalesce(sum(loan_amount), 0)::float8 as requested,
                      coalesce(sum(loan_amount) filter (where status = 'disbursed'), 0)::float8 as disbursed
               from applications where ${inPrev("created_at")}`).then((x) => x[0])),
    // Interest rate trend: average quoted rate of the applications logged in each bucket (null = none had a rate).
    when(a.applicationStats, () =>
      rows(sql`with b as (
                 select generate_series(
                   date_trunc(${unit}, ${from}::timestamptz at time zone ${TZ}),
                   date_trunc(${unit}, (${to}::timestamptz - interval '1 millisecond') at time zone ${TZ}),
                   ('1 ' || ${unit})::interval) as k),
               ap as (select date_trunc(${unit}, created_at at time zone ${TZ}) as k, count(*)::int as n, avg(rate) as rate
                      from applications where ${inRange("created_at")} group by 1)
               select to_char(b.k, 'YYYY-MM-DD') as bucket, coalesce(ap.n, 0) as applications, round(ap.rate::numeric, 2)::float8 as rate
               from b left join ap on ap.k = b.k order by b.k`)),
    when(a.applicationStats, () =>
      rows(sql`select type, count(*)::int as count, coalesce(sum(loan_amount), 0)::float8 as amount
               from applications where ${inRange("created_at")} group by type order by count desc, amount desc`)),
    when(a.applicationStats, () =>
      rows(sql`select lender_id as id, coalesce(max(lender_name), lender_id) as name, count(*)::int as count,
                      coalesce(sum(loan_amount) filter (where status = 'disbursed'), 0)::float8 as disbursed
               from applications where ${inRange("created_at")} group by lender_id order by count desc, disbursed desc limit 5`)),
    when(a.leadStats, () =>
      rows(sql`select coalesce(nullif(initcap(trim(city)), ''), 'Not given') as city, count(*)::int as count
               from leads where deleted_at is null and ${inRange("created_at")} group by 1 order by count desc, 1`)),
    // Eligibility: the applicant's credit score band against how the application ended.
    when(a.applicationStats, () =>
      rows(sql`select case when u.credit_score is null then 'unknown' when u.credit_score >= 750 then '750+'
                           when u.credit_score >= 700 then '700-749' when u.credit_score >= 650 then '650-699' else 'below-650' end as band,
                      count(*)::int as applications,
                      (count(*) filter (where ap.status in ('approved', 'disbursed')))::int as approved,
                      (count(*) filter (where ap.status = 'rejected'))::int as rejected
               from applications ap join users u on u.id = ap.user_id where ${inRange("ap.created_at")} group by 1`)),
  ]);

  // ---- shape the response ----
  const byStatus = Object.fromEntries((statuses ?? []).map((s) => [s.status, s]));
  const count = (...keys) => keys.reduce((n, k) => n + (byStatus[k]?.count ?? 0), 0);
  const amount = (...keys) => keys.reduce((n, k) => n + (byStatus[k]?.amount ?? 0), 0);
  const totalApps = count("submitted", "in_review", "approved", "rejected", "disbursed");

  // Top 6 cities by enquiries; past 7, the rest fold into "Other cities".
  const cityRows = cities ?? [];
  const cityList = cityRows.length > 7
    ? [...cityRows.slice(0, 6), { city: "Other cities", count: cityRows.slice(6).reduce((n, c) => n + c.count, 0) }]
    : cityRows;
  const byBand = Object.fromEntries((eligibility ?? []).map((e) => [e.band, e]));

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
    interestRates: series ? { average: kpis.avg_rate, previous: kpis.avg_rate_prev, series } : null,
    loanTypes: loanTypes ? loanTypes.map((t) => ({ type: t.type, label: typeLabel(t.type), count: t.count, amount: t.amount })) : null,
    topLenders,
    cities: cities ? { total: cityRows.reduce((n, c) => n + c.count, 0), list: cityList } : null,
    eligibility: eligibility ? BANDS.map(([band, label]) => ({ band, label, applications: 0, approved: 0, rejected: 0, ...byBand[band] })) : null,
  });
});

export default r;
