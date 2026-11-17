import { sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { SOURCE_LABELS } from "../../crm/leads.js";
import { can } from "../../crm/middleware.js";
import { dashboardQuery } from "../../crm/validate.js";
import { LOAN_TYPES } from "../../data/loans.js";
import { db } from "../../lib/db.js";
import { parse } from "../../lib/validate.js";

// Reports & Analytics: every figure is computed from PostgreSQL for the period [from, to).
// Leads count by created_at; applications by created_at (files logged) except disbursals, which count by disbursed_at.
// "Approved" = sanctioned or disbursed; approval rate = approved ÷ (approved + rejected).

const r = Router();
const TZ = process.env.CRM_TIMEZONE ?? "Asia/Kolkata";
const typeLabel = (id) => LOAN_TYPES.find((t) => t.id === id)?.label ?? id;
const rows = async (q) => (await db.execute(q)).rows;
const DAY = 86400000;
const unitFor = (from, to) => ((to - from) / DAY <= 35 ? "day" : (to - from) / DAY <= 200 ? "week" : "month");
const rate = (a, b) => (b ? a / b : null);

async function build({ from, to }) {
  const unit = unitFor(from, to);
  const leadIn = sql`l.deleted_at is null and l.created_at >= ${from} and l.created_at < ${to}`;
  const appIn = sql`a.created_at >= ${from} and a.created_at < ${to}`;
  const disbIn = sql`a.stage = 'disbursed' and a.disbursed_at >= ${from} and a.disbursed_at < ${to}`;
  const months = Math.max(1, (to - from) / (30.44 * DAY));

  const [[summary], trend, [funnel], lost, sources, team, lenders, products, cities] = await Promise.all([
    rows(sql`select
      (select coalesce(sum(a.disbursed_amount), 0)::float8 from applications a where ${disbIn}) as disbursed,
      (select count(*)::int from applications a where ${disbIn}) as disbursed_files,
      (select count(*)::int from leads l where ${leadIn}) as leads,
      (select count(*)::int from leads l where ${leadIn} and l.status = 'converted') as converted,
      (select count(*)::int from applications a where ${appIn}) as files,
      (select count(*)::int from applications a where ${appIn} and a.stage in ('sanctioned', 'disbursed')) as approved,
      (select count(*)::int from applications a where ${appIn} and a.stage = 'rejected') as rejected,
      (select avg(extract(epoch from (a.disbursed_at - a.created_at)) / 86400)::float8 from applications a where ${disbIn}) as avg_days`),
    rows(sql`with b as (
        select generate_series(date_trunc(${unit}, ${from}::timestamptz at time zone ${TZ}),
                               date_trunc(${unit}, (${to}::timestamptz - interval '1 millisecond') at time zone ${TZ}), ('1 ' || ${unit})::interval) as k),
      d as (select date_trunc(${unit}, a.disbursed_at at time zone ${TZ}) as k, sum(a.disbursed_amount)::float8 as v from applications a where ${disbIn} group by 1),
      l as (select date_trunc(${unit}, l.created_at at time zone ${TZ}) as k, count(*)::int as v from leads l where ${leadIn} group by 1),
      f as (select date_trunc(${unit}, a.created_at at time zone ${TZ}) as k, count(*)::int as v from applications a where ${appIn} group by 1)
      select to_char(b.k, 'YYYY-MM-DD') as bucket, coalesce(d.v, 0) as disbursed, coalesce(l.v, 0) as leads, coalesce(f.v, 0) as files
      from b left join d on d.k = b.k left join l on l.k = b.k left join f on f.k = b.k order by b.k`),
    // Funnel by how far each lead got (current status; lost leads count as contacted).
    rows(sql`select count(*)::int as enquiries,
      count(*) filter (where l.status <> 'new')::int as contacted,
      count(*) filter (where l.status in ('interested', 'docs_pending', 'qualified', 'converted'))::int as interested,
      count(*) filter (where l.status in ('qualified', 'converted'))::int as qualified,
      count(*) filter (where l.status = 'converted')::int as converted
      from leads l where ${leadIn}`),
    rows(sql`select coalesce(nullif(trim(l.lost_reason), ''), 'Not given') as reason, count(*)::int as n from leads l where ${leadIn} and l.status = 'lost' group by 1 order by n desc limit 8`),
    rows(sql`select l.source, count(*)::int as leads, count(*) filter (where l.status = 'converted')::int as converted from leads l where ${leadIn} group by 1 order by leads desc`),
    rows(sql`select u.id, u.name, u.status, r.name as role, u.profile->>'branch' as branch, (u.profile->>'monthlyTarget')::float8 as monthly_target,
        (select count(*)::int from leads l where l.owner_id = u.id and ${leadIn}) as leads,
        (select count(*)::int from leads l where l.owner_id = u.id and ${leadIn} and l.status = 'converted') as converted,
        (select count(*)::int from applications a where a.assigned_to = u.id and ${appIn}) as files,
        (select coalesce(sum(a.disbursed_amount), 0)::float8 from applications a where a.assigned_to = u.id and ${disbIn}) as disbursed
      from users u join roles r on r.id = u.role_id
      where u.status = 'active' or exists (select 1 from applications a where a.assigned_to = u.id and ${appIn})`),
    rows(sql`select a.lender_id as id, coalesce(max(le.name), max(a.lender_name), a.lender_id) as name, max(le.payout_pct)::float8 as payout_pct,
        count(*) filter (where ${appIn})::int as files,
        count(*) filter (where ${appIn} and a.stage in ('sanctioned', 'disbursed'))::int as approved,
        count(*) filter (where ${appIn} and a.stage = 'rejected')::int as rejected,
        coalesce(sum(a.disbursed_amount) filter (where ${disbIn}), 0)::float8 as disbursed
      from applications a left join lenders le on le.id = a.lender_id
      where ${appIn} or ${disbIn} group by a.lender_id`),
    rows(sql`select a.type, count(*) filter (where ${appIn})::int as files,
        coalesce(avg(a.loan_amount) filter (where ${appIn}), 0)::float8 as avg_ticket,
        count(*) filter (where ${appIn} and a.stage in ('sanctioned', 'disbursed'))::int as approved,
        count(*) filter (where ${appIn} and a.stage = 'rejected')::int as rejected,
        count(*) filter (where ${disbIn})::int as disbursed_files,
        coalesce(sum(a.disbursed_amount) filter (where ${disbIn}), 0)::float8 as disbursed
      from applications a where ${appIn} or ${disbIn} group by a.type`),
    // City: the customer's profile city, else the lead's city.
    rows(sql`select coalesce(nullif(initcap(trim(c.profile->>'city')), ''), nullif(initcap(trim(l.city)), ''), 'Unknown') as city,
        count(*) filter (where ${appIn})::int as files,
        count(*) filter (where ${appIn} and a.stage in ('sanctioned', 'disbursed'))::int as approved,
        coalesce(sum(a.disbursed_amount) filter (where ${disbIn}), 0)::float8 as disbursed
      from applications a left join users c on c.id = a.user_id left join leads l on l.id = a.lead_id
      where ${appIn} or ${disbIn} group by 1`),
  ]);

  const decided = summary.approved + summary.rejected;
  return {
    range: { from, to, unit, timezone: TZ },
    summary: {
      disbursed: summary.disbursed, disbursedFiles: summary.disbursed_files, leads: summary.leads, converted: summary.converted,
      leadConversion: rate(summary.converted, summary.leads), files: summary.files, approvalRate: rate(summary.approved, decided),
      avgDaysToDisburse: summary.avg_days,
    },
    sales: {
      trend,
      funnel: ["enquiries", "contacted", "interested", "qualified", "converted"].map((k) => ({ stage: k, count: funnel[k] })),
      lostReasons: lost.map((x) => ({ reason: x.reason, count: x.n })),
      sources: sources.map((x) => ({ source: x.source, label: SOURCE_LABELS[x.source] ?? x.source, leads: x.leads, converted: x.converted, conversion: rate(x.converted, x.leads) })),
    },
    team: team
      .map((u) => {
        const target = u.monthly_target ? u.monthly_target * months : null;
        return { id: u.id, name: u.name, role: u.role, branch: u.branch, active: u.status === "active", leads: u.leads, converted: u.converted, conversion: rate(u.converted, u.leads), files: u.files, disbursed: u.disbursed, target, targetPct: target ? u.disbursed / target : null };
      })
      .sort((a, b) => b.disbursed - a.disbursed || b.converted - a.converted || b.files - a.files || a.name.localeCompare(b.name)),
    lenders: lenders
      .map((l) => ({ id: l.id, name: l.name, files: l.files, approved: l.approved, rejected: l.rejected, approvalRate: rate(l.approved, l.approved + l.rejected), disbursed: l.disbursed, payoutPct: l.payout_pct, payout: l.payout_pct ? (l.disbursed * l.payout_pct) / 100 : 0 }))
      .sort((a, b) => b.disbursed - a.disbursed || b.files - a.files),
    products: products
      .map((p) => ({ type: p.type, label: typeLabel(p.type), files: p.files, avgTicket: p.avg_ticket, approved: p.approved, rejected: p.rejected, approvalRate: rate(p.approved, p.approved + p.rejected), disbursedFiles: p.disbursed_files, disbursed: p.disbursed }))
      .sort((a, b) => b.disbursed - a.disbursed || b.files - a.files),
    cities: cities.map((c) => ({ city: c.city, files: c.files, approved: c.approved, disbursed: c.disbursed })).sort((a, b) => b.disbursed - a.disbursed || b.files - a.files),
  };
}

/** GET /reports?from=&to= — all report tabs for the period (default: last 30 days). */
r.get("/reports", can("reports.view"), async (req, res) => {
  res.json(await build(parse(dashboardQuery, req.query)));
});

const pct = (x) => (x == null ? "" : Math.round(x * 1000) / 10);
const round = (x) => (x == null ? "" : Math.round(x));
const EXPORTS = {
  sales: (d) => [["Period start", "Leads", "Files logged", "Disbursed (₹)"], ...d.sales.trend.map((t) => [t.bucket, t.leads, t.files, round(t.disbursed)]),
    [], ["Funnel stage", "Leads"], ...d.sales.funnel.map((f) => [f.stage, f.count]),
    [], ["Source", "Leads", "Converted", "Conversion %"], ...d.sales.sources.map((s) => [s.label, s.leads, s.converted, pct(s.conversion)]),
    [], ["Lost reason", "Leads"], ...d.sales.lostReasons.map((x) => [x.reason, x.count])],
  team: (d) => [["Employee", "Role", "Branch", "Leads", "Converted", "Conversion %", "Files", "Disbursed (₹)", "Target (₹)", "Target %"],
    ...d.team.map((u) => [u.name, u.role, u.branch, u.leads, u.converted, pct(u.conversion), u.files, round(u.disbursed), round(u.target), pct(u.targetPct)])],
  lenders: (d) => [["Lender", "Files", "Approved", "Rejected", "Approval %", "Disbursed (₹)", "Payout %", "Payout earned (₹)"],
    ...d.lenders.map((l) => [l.name, l.files, l.approved, l.rejected, pct(l.approvalRate), round(l.disbursed), l.payoutPct ?? "", round(l.payout)])],
  products: (d) => [["Product", "Files", "Avg ticket (₹)", "Approved", "Rejected", "Approval %", "Disbursed files", "Disbursed (₹)"],
    ...d.products.map((p) => [p.label, p.files, round(p.avgTicket), p.approved, p.rejected, pct(p.approvalRate), p.disbursedFiles, round(p.disbursed)])],
  cities: (d) => [["City", "Files", "Approved", "Disbursed (₹)"], ...d.cities.map((c) => [c.city, c.files, c.approved, round(c.disbursed)])],
};
const cell = (v) => (v == null ? "" : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** GET /reports/export?tab=&from=&to= — one tab as CSV (opens in Excel). Needs reports.export. */
r.get("/reports/export", can("reports.export"), async (req, res) => {
  const { tab } = parse(z.object({ tab: z.enum(Object.keys(EXPORTS)) }), { tab: req.query.tab });
  const period = parse(dashboardQuery, { from: req.query.from, to: req.query.to });
  const d = await build(period);
  const lines = [[`AvodahLoans CRM — ${tab} report`, `${period.from.toISOString().slice(0, 10)} to ${period.to.toISOString().slice(0, 10)}`], [], ...EXPORTS[tab](d)];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="report-${tab}-${period.to.toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n"));
});

export default r;
