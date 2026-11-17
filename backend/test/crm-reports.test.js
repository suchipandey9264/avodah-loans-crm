// CRM reports: figures from known rows, period filter, permissions, CSV export.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startStack } from "./harness.js";

const PW = "Strong-pass-123";
let s;
const t = {};
const id = {};
const api = (key, path, opts = {}) => s.api(path, { ...opts, token: t[key] });
const DAY = 86400000;
const iso = (d) => new Date(d).toISOString();
const period = () => `from=${iso(Date.now() - 30 * DAY)}&to=${iso(Date.now() + 60000)}`;

before(async () => {
  s = await startStack();
  await s.run(["src/scripts/crm-admin.js", "owner@avodah.test", "Owner Name"], { CRM_ADMIN_PASSWORD: "Owner-pass-2026" });
  t.owner = (await s.api("/crm/auth/login", { method: "POST", body: { email: "owner@avodah.test", password: "Owner-pass-2026" } })).body.token;
  for (const [key, name, role] of [["manager", "Meera Manager", "manager"], ["emp1", "Asha Sales", "employee"], ["viewer", "Vik Viewer", "viewer"], ["analyst", "Dev Analyst", "credit_analyst"]]) {
    const res = await api("owner", "/crm/users", { method: "POST", body: { name, email: `${key}@avodah.test`, roleId: role, password: PW, ...(key === "emp1" ? { monthlyTarget: 1000000, branch: "Pune" } : {}) } });
    id[key] = res.body.user.id;
    t[key] = (await s.api("/crm/auth/login", { method: "POST", body: { email: `${key}@avodah.test`, password: PW } })).body.token;
  }
  const emp = id.emp1;
  // 4 leads in the period (1 converted, 1 lost "Rate too high", 1 contacted, 1 new) + 1 old lead outside it.
  await s.pg.exec(`
    insert into lenders (id, name, kind, active, payout_pct) values ('sbi','SBI','PSU Bank',true,1.5), ('hdfc','HDFC','PVT Bank',true,null);
    insert into leads (kind, name, phone, source, status, owner_id, lost_reason, city, created_at) values
      ('crm','A','9000000001','walk_in','converted','${emp}',null,'pune',now() - interval '2 days'),
      ('crm','B','9000000002','walk_in','lost','${emp}','Rate too high',null,now() - interval '3 days'),
      ('crm','C','9000000003','referral','contacted',null,null,null,now() - interval '4 days'),
      ('crm','D','9000000004','referral','new',null,null,null,now() - interval '5 days'),
      ('crm','Old','9000000005','walk_in','converted',null,null,null,now() - interval '90 days');
    insert into users (name, phone, profile) values ('Cust One','9100000001','{"city":"pune"}'), ('Cust Two','9100000002','{}');`);
  const c1 = (await s.pg.query("select id from users where phone='9100000001'")).rows[0].id;
  const c2 = (await s.pg.query("select id from users where phone='9100000002'")).rows[0].id;
  const leadA = (await s.pg.query("select id from leads where name='A'")).rows[0].id;
  // Files: SBI home disbursed 20L after 10 days; SBI home sanctioned; HDFC personal rejected; HDFC personal new.
  await s.pg.query(`insert into applications (ref, user_id, contact, lender_id, lender_name, type, loan_amount, stage, status, assigned_to, disbursed_amount, disbursed_at, lead_id, created_at) values
    ('R1', $1, '{}', 'sbi', 'SBI', 'home', 2500000, 'disbursed', 'disbursed', $3, 2000000, now() - interval '2 days', $4, now() - interval '12 days'),
    ('R2', $1, '{}', 'sbi', 'SBI', 'home', 1500000, 'sanctioned', 'approved', $3, null, null, null, now() - interval '6 days'),
    ('R3', $2, '{}', 'hdfc', 'HDFC', 'personal', 500000, 'rejected', 'rejected', null, null, null, null, now() - interval '5 days'),
    ('R4', $2, '{}', 'hdfc', 'HDFC', 'personal', 300000, 'new', 'submitted', null, null, null, null, now() - interval '1 day')`, [c1, c2, emp, leadA]);
});
after(() => s?.stop());

test("summary cards: disbursed, lead conversion, approval rate, days to disburse", async () => {
  const res = await api("manager", `/crm/reports?${period()}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const x = res.body.summary;
  assert.equal(x.disbursed, 2000000);
  assert.equal(x.leads, 4, "the 90-day-old lead is outside the period");
  assert.equal(x.leadConversion, 0.25);
  assert.equal(x.files, 4);
  assert.equal(x.approvalRate, 2 / 3, "2 approved (sanctioned + disbursed), 1 rejected");
  assert.ok(Math.abs(x.avgDaysToDisburse - 10) < 0.01);
});

test("sales: funnel, lost reasons, sources and trend add up", async () => {
  const { sales } = (await api("manager", `/crm/reports?${period()}`)).body;
  assert.deepEqual(sales.funnel.map((f) => f.count), [4, 3, 1, 1, 1]);
  assert.deepEqual(sales.lostReasons, [{ reason: "Rate too high", count: 1 }]);
  assert.deepEqual(sales.sources.find((x) => x.source === "walk_in"), { source: "walk_in", label: "Walk-in", leads: 2, converted: 1, conversion: 0.5 });
  assert.equal(sales.trend.reduce((n, b) => n + b.leads, 0), 4);
  assert.equal(sales.trend.reduce((n, b) => n + b.files, 0), 4);
  assert.equal(sales.trend.reduce((n, b) => n + b.disbursed, 0), 2000000);
});

test("team, lenders, products and cities", async () => {
  const d = (await api("manager", `/crm/reports?${period()}`)).body;
  const asha = d.team[0];
  assert.equal(asha.name, "Asha Sales", "top of the leaderboard");
  assert.deepEqual({ leads: asha.leads, converted: asha.converted, files: asha.files, disbursed: asha.disbursed }, { leads: 2, converted: 1, files: 2, disbursed: 2000000 });
  assert.ok(asha.target > 900000 && asha.targetPct > 1, "monthly target scaled to the ~1-month period");
  const sbi = d.lenders.find((l) => l.id === "sbi");
  assert.deepEqual({ files: sbi.files, approved: sbi.approved, rejected: sbi.rejected, approvalRate: sbi.approvalRate, disbursed: sbi.disbursed, payout: sbi.payout }, { files: 2, approved: 2, rejected: 0, approvalRate: 1, disbursed: 2000000, payout: 30000 });
  assert.equal(d.lenders.find((l) => l.id === "hdfc").approvalRate, 0);
  const home = d.products.find((p) => p.type === "home");
  assert.deepEqual({ label: home.label, files: home.files, avgTicket: home.avgTicket, disbursed: home.disbursed }, { label: home.label, files: 2, avgTicket: 2000000, disbursed: 2000000 });
  assert.deepEqual(d.cities.find((c) => c.city === "Pune"), { city: "Pune", files: 2, approved: 2, disbursed: 2000000 });
  assert.equal(d.cities.find((c) => c.city === "Unknown").files, 2);
});

test("period filter: last 3 days only", async () => {
  const d = (await api("manager", `/crm/reports?from=${iso(Date.now() - 3.5 * DAY)}&to=${iso(Date.now() + 60000)}`)).body;
  assert.equal(d.summary.leads, 2);
  assert.equal(d.summary.files, 1, "only R4 was logged in the last 3 days");
  assert.equal(d.summary.disbursed, 2000000, "disbursals count by disbursal date");
  assert.equal((await api("manager", `/crm/reports?from=${iso(Date.now())}&to=${iso(Date.now() - DAY)}`)).status, 400);
});

test("permissions: reports.view to read, reports.export to export", async () => {
  assert.equal((await api("emp1", "/crm/reports")).status, 403);
  assert.equal((await api("viewer", "/crm/reports")).status, 200);
  assert.equal((await api("viewer", "/crm/reports/export?tab=team")).status, 403, "viewers can read, not export");
  assert.equal((await api("analyst", "/crm/reports/export?tab=team")).status, 403);
});

test("CSV export of each tab", async () => {
  for (const tab of ["sales", "team", "lenders", "products", "cities"]) {
    const res = await fetch(`${s.base}/crm/reports/export?tab=${tab}&${period()}`, { headers: { authorization: `Bearer ${t.manager}` } });
    assert.equal(res.status, 200, tab);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    assert.match(res.headers.get("content-disposition"), new RegExp(`report-${tab}-`));
    const text = await res.text();
    if (tab === "lenders") assert.match(text, /SBI,2,2,0,100,2000000,1\.5,30000/);
  }
  assert.equal((await api("manager", "/crm/reports/export?tab=nope")).status, 400);
});
