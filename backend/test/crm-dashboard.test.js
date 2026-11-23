// CRM dashboard, search and notifications — exact figures from seeded PostgreSQL data, per role.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startStack } from "./harness.js";

const PW = "Strong-pass-123";
const L = 1e5;
// October 2026 in India Standard Time; the previous period is the 31 days before it.
const OCT = { from: "2026-09-30T18:30:00.000Z", to: "2026-10-31T18:30:00.000Z" };
const qs = (o) => "?" + new URLSearchParams(o);

let s, owner;
const tokens = {};

async function seed(pg) {
  const ist = (d) => new Date(`${d}+05:30`).toISOString();
  await pg.query(`insert into lenders (id, name, kind, active) values
    ('sbi','SBI','PSU Bank',true), ('hdfc','HDFC','PVT Bank',true), ('icici','ICICI','PVT Bank',true), ('old','Old Bank','NBFC',false)`);
  // Customers (no role): 3 in October, 1 in the previous period, 1 older.
  const cust = async (name, phone, at) =>
    (await pg.query(`insert into users (name, phone, created_at) values ($1, $2, $3) returning id`, [name, phone, at])).rows[0].id;
  const asha = await cust("Asha Verma", "9811111111", ist("2026-10-03T10:00:00"));
  await cust("Ravi Kumar", "9822222222", ist("2026-10-12T10:00:00"));
  await cust("Meena Iyer", "9833333333", ist("2026-10-28T10:00:00"));
  await cust("Prev Customer", "9844444444", ist("2026-09-15T10:00:00"));
  await cust("Old Customer", "9855555555", ist("2026-01-15T10:00:00"));

  const lead = (kind, name, phone, at, handled = false) =>
    pg.query(`insert into leads (kind, name, phone, handled, created_at) values ($1,$2,$3,$4,$5)`, [kind, name, phone, handled, at]);
  // 02:00 IST on 1 Oct is still 30 Sep in UTC — must land in the 1 Oct bucket.
  await lead("callback", "Asha Verma", "9811111111", ist("2026-10-01T02:00:00"));
  await lead("callback", "Kiran Rao", "9866666666", ist("2026-10-05T11:00:00"), true);
  await lead("credit-report", "Sunil Das", "9877777777", ist("2026-10-05T15:00:00"));
  await lead("callback", "Latest Lead", "9888888888", ist("2026-10-31T20:00:00"));
  await lead("callback", "Prev Lead 1", "9899999991", ist("2026-09-10T10:00:00"));
  await lead("callback", "Prev Lead 2", "9899999992", ist("2026-09-20T10:00:00"));
  await lead("callback", "Ancient Lead", "9899999993", ist("2026-06-01T10:00:00"));

  let n = 0;
  const app = (status, amount, type, lender, at) =>
    pg.query(
      `insert into applications (ref, user_id, contact, lender_id, lender_name, type, loan_amount, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [`AVDTEST${++n}`, asha, JSON.stringify({ name: "Asha Verma", phone: "9811111111" }), lender, lender.toUpperCase(), type, amount, status, at]
    );
  await app("submitted", 1 * L, "home", "sbi", ist("2026-10-02T10:00:00"));
  await app("in_review", 2 * L, "home", "sbi", ist("2026-10-06T10:00:00"));
  await app("approved", 3 * L, "personal", "hdfc", ist("2026-10-10T10:00:00"));
  await app("rejected", 4 * L, "car", "icici", ist("2026-10-15T10:00:00"));
  await app("disbursed", 5 * L, "home", "sbi", ist("2026-10-20T10:00:00"));
  await app("disbursed", 6 * L, "personal", "hdfc", ist("2026-10-30T10:00:00"));
  await app("disbursed", 10 * L, "home", "sbi", ist("2026-09-12T10:00:00")); // previous period
  await app("submitted", 5 * L, "car", "icici", ist("2026-09-25T10:00:00")); // previous period
  await pg.query(`update applications set rate = case type when 'home' then 8.5 when 'personal' then 11 else 9.5 end`);
  await pg.query(`update leads set city = case phone when '9811111111' then 'mumbai' when '9866666666' then ' Mumbai ' when '9877777777' then 'Delhi' end`);
  await pg.query(`update users set credit_score = 780 where id = $1`, [asha]);
}

before(async () => {
  s = await startStack();
  await s.run(["src/scripts/crm-admin.js", "owner@avodah.test", "Owner Name"], { CRM_ADMIN_PASSWORD: "Owner-pass-2026" });
  owner = (await s.api("/crm/auth/login", { method: "POST", body: { email: "owner@avodah.test", password: "Owner-pass-2026" } })).body.token;
  for (const role of ["telecaller", "viewer", "credit_analyst", "employee"]) {
    await s.api("/crm/users", { method: "POST", token: owner, body: { name: `Test ${role}`, email: `${role}@avodah.test`, roleId: role, password: PW } });
    tokens[role] = (await s.api("/crm/auth/login", { method: "POST", body: { email: `${role}@avodah.test`, password: PW } })).body.token;
  }
  await seed(s.pg);
});
after(() => s?.stop());

const dash = (token, range = OCT) => s.api(`/crm/dashboard${qs(range)}`, { token });

describe("dashboard figures (super admin, October 2026)", () => {
  let d;
  before(async () => {
    const res = await dash(owner);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    d = res.body;
  });

  test("KPI cards with the previous period", () => {
    assert.deepEqual(d.kpis.leads, { value: 4, previous: 2 });
    assert.deepEqual(d.kpis.customers, { value: 3, previous: 1, total: 5 }); // staff accounts are not customers
    assert.deepEqual(d.kpis.applications, { value: 6, previous: 2 });
    assert.deepEqual(d.kpis.lenders, { active: 3, withApplications: 3 });
  });

  test("application statuses", () => {
    assert.deepEqual(d.statuses, { total: 6, approved: 1, disbursed: 2, pending: 2, inReview: 1, rejected: 1 });
  });

  test("loan amounts", () => {
    assert.deepEqual(d.amounts, { requested: 21 * L, approved: 14 * L, disbursed: 11 * L, average: 3.5 * L, previousRequested: 15 * L, previousDisbursed: 10 * L });
  });

  test("interest rate trend: daily, in India time, empty days have no rate", () => {
    const ir = d.interestRates;
    assert.equal(d.range.unit, "day");
    assert.deepEqual([ir.average, ir.previous], [9.5, 9]);
    assert.equal(ir.series.length, 31);
    assert.equal(ir.series[0].bucket, "2026-10-01");
    assert.equal(ir.series.at(-1).bucket, "2026-10-31");
    const day = (b) => ir.series.find((x) => x.bucket === b);
    assert.deepEqual(day("2026-10-10"), { bucket: "2026-10-10", applications: 1, rate: 11 });
    assert.deepEqual(day("2026-10-01"), { bucket: "2026-10-01", applications: 0, rate: null });
    assert.equal(ir.series.reduce((n, x) => n + x.applications, 0), 6);
  });

  test("loan-type distribution and top lenders", () => {
    assert.deepEqual(d.loanTypes.map((t) => [t.label, t.count, t.amount]), [["Home Loan", 3, 8 * L], ["Personal Loan", 2, 9 * L], ["Car Loan", 1, 4 * L]]);
    assert.deepEqual(d.topLenders.map((x) => [x.name, x.count, x.disbursed]), [["SBI", 3, 5 * L], ["HDFC", 2, 6 * L], ["ICICI", 1, 0]]);
  });

  test("city-wise enquiries: names tidied, missing cities counted", () => {
    assert.deepEqual(d.cities, { total: 4, list: [{ city: "Mumbai", count: 2 }, { city: "Delhi", count: 1 }, { city: "Not given", count: 1 }] });
  });

  test("eligibility: outcomes by credit-score band, every band listed", () => {
    assert.deepEqual(d.eligibility.map((e) => e.band), ["750+", "700-749", "650-699", "below-650", "unknown"]);
    assert.deepEqual(d.eligibility[0], { band: "750+", label: "750 and above", applications: 6, approved: 3, rejected: 1 });
    assert.equal(d.eligibility[4].applications, 0);
  });
});

describe("date filters", () => {
  test("a period with no data returns zeros and empty lists, not errors", async () => {
    const res = await dash(owner, { from: "2025-02-28T18:30:00Z", to: "2025-03-07T18:30:00Z" }); // 1–7 March, IST
    assert.equal(res.status, 200);
    assert.equal(res.body.kpis.leads.value, 0);
    assert.equal(res.body.statuses.total, 0);
    assert.equal(res.body.amounts.average, 0);
    assert.deepEqual(res.body.loanTypes, []);
    assert.deepEqual(res.body.topLenders, []);
    assert.deepEqual(res.body.cities, { total: 0, list: [] });
    assert.equal(res.body.interestRates.average, null);
    assert.equal(res.body.interestRates.series.length, 7);
    assert.ok(res.body.interestRates.series.every((x) => x.applications === 0 && x.rate === null));
  });

  test("longer periods group by week, then by month", async () => {
    const q = await dash(owner, { from: "2026-08-01T00:00:00Z", to: "2026-11-01T00:00:00Z" });
    assert.equal(q.body.range.unit, "week");
    assert.equal(q.body.interestRates.series.reduce((n, x) => n + x.applications, 0), 8);
    const y = await dash(owner, { from: "2025-11-01T00:00:00Z", to: "2026-11-01T00:00:00Z" });
    assert.equal(y.body.range.unit, "month");
    assert.ok(y.body.interestRates.series.length >= 12 && y.body.interestRates.series.length <= 13);
    assert.equal(y.body.kpis.leads.value, 7);
  });

  test("defaults to the last 30 days", async () => {
    const res = await s.api("/crm/dashboard", { token: owner });
    assert.equal(res.status, 200);
    assert.equal(Math.round((new Date(res.body.range.to) - new Date(res.body.range.from)) / 86400000), 30);
  });

  test("bad ranges are rejected", async () => {
    assert.equal((await dash(owner, { from: OCT.to, to: OCT.from })).status, 400);
    assert.equal((await dash(owner, { from: "2020-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" })).status, 400);
    assert.equal((await dash(owner, { from: "not-a-date", to: OCT.to })).status, 400);
  });
});

describe("dashboard respects roles (enforced by the server)", () => {
  test("signed out is 401", async () => {
    assert.equal((await s.api("/crm/dashboard")).status, 401);
  });

  test("telecaller: leads and customers only — no application, amount or lender figures", async () => {
    const d = (await dash(tokens.telecaller)).body;
    assert.deepEqual(d.kpis.leads, { value: 4, previous: 2 });
    assert.equal(d.kpis.customers.value, 3);
    assert.equal(d.kpis.applications, null);
    assert.equal(d.kpis.lenders, null);
    for (const k of ["statuses", "amounts", "interestRates", "loanTypes", "topLenders", "eligibility"]) assert.equal(d[k], null, k);
    assert.equal(d.cities.total, 4);
  });

  test("viewer (reports): every total and chart, and no phone numbers", async () => {
    const d = (await dash(tokens.viewer)).body;
    assert.equal(d.kpis.applications.value, 6);
    assert.equal(d.amounts.requested, 21 * L);
    assert.equal(d.topLenders.length, 3);
    assert.equal(d.cities.total, 4);
    assert.equal(JSON.stringify(d).includes("9811111111"), false);
  });

  test("sales executive: sales and lender figures", async () => {
    const d = (await dash(tokens.employee)).body;
    assert.equal(d.kpis.applications.value, 6);
    assert.deepEqual(d.kpis.lenders, { active: 3, withApplications: 3 });
    assert.ok(d.eligibility.length > 0);
  });
});

describe("global search", () => {
  test("finds leads, customers and applications by name, phone and reference", async () => {
    const byName = (await s.api("/crm/search?q=asha", { token: owner })).body;
    assert.equal(byName.leads.length, 1);
    assert.equal(byName.customers.length, 1);
    assert.equal(byName.applications.length, 5); // capped at 5 per type
    const byPhone = (await s.api("/crm/search?q=98777", { token: owner })).body;
    assert.equal(byPhone.leads[0].name, "Sunil Das");
    const byRef = (await s.api("/crm/search?q=AVDTEST3", { token: owner })).body;
    assert.equal(byRef.applications[0].status, "approved");
  });

  test("only searches what the role may open", async () => {
    const tc = (await s.api("/crm/search?q=asha", { token: tokens.telecaller })).body;
    assert.equal(tc.leads.length, 1);
    assert.equal(tc.applications, null);
    const v = (await s.api("/crm/search?q=asha", { token: tokens.viewer })).body;
    assert.deepEqual([v.leads, v.customers, v.applications], [null, null, null]);
  });

  test("wildcards are literal and short queries are refused", async () => {
    const res = await s.api("/crm/search?q=%25%25", { token: owner }); // "%%"
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.leads, res.body.customers, res.body.applications], [[], [], []]);
    assert.equal((await s.api("/crm/search?q=a", { token: owner })).status, 400);
    assert.equal((await s.api("/crm/search?q=asha")).status, 401);
  });
});

describe("notifications", () => {
  test("new unhandled leads and new applications, per role; opening the bell marks them read", async () => {
    await s.pg.query(`insert into leads (kind, name, phone, handled) values ('callback', 'Fresh Lead', '9700000001', false), ('callback', 'Handled Lead', '9700000002', true)`);
    const userId = (await s.pg.query(`select id from users where phone = '9811111111'`)).rows[0].id;
    await s.pg.query(
      `insert into applications (ref, user_id, contact, lender_id, lender_name, type, loan_amount, status) values ('AVDFRESH', $1, '{"name":"Asha Verma"}', 'sbi', 'SBI', 'home', 700000, 'submitted')`,
      [userId]
    );

    const mine = (await s.api("/crm/notifications", { token: owner })).body;
    assert.deepEqual(mine.items.map((i) => i.title).sort(), ["New application to review", "New callback request"]);
    assert.equal(mine.unread, 2);
    assert.match(mine.items.find((i) => i.type === "application").body, /Home Loan · SBI \(AVDFRESH\)/);

    const tc = (await s.api("/crm/notifications", { token: tokens.telecaller })).body;
    assert.deepEqual(tc.items.map((i) => i.type), ["lead"]);
    assert.deepEqual((await s.api("/crm/notifications", { token: tokens.viewer })).body.items, []);

    assert.equal((await s.api("/crm/notifications/seen", { method: "POST", token: owner })).status, 200);
    assert.equal((await s.api("/crm/notifications", { token: owner })).body.unread, 0);
    assert.equal((await s.api("/crm/notifications", { token: tokens.telecaller })).body.unread, 1); // read state is per user

    await new Promise((r) => setTimeout(r, 20));
    await s.pg.query(`insert into leads (kind, name, phone) values ('credit-report', 'Another Lead', '9700000003')`);
    assert.equal((await s.api("/crm/notifications", { token: owner })).body.unread, 1);
  });

  test("admins are told about locked accounts", async () => {
    for (let i = 0; i < 5; i++) await s.api("/crm/auth/login", { method: "POST", body: { email: "employee@avodah.test", password: "Wrong-pass-999" } });
    const items = (await s.api("/crm/notifications", { token: owner })).body.items;
    assert.ok(items.some((i) => i.type === "security" && i.body === "employee@avodah.test"));
    assert.ok((await s.api("/crm/notifications", { token: tokens.telecaller })).body.items.every((i) => i.type !== "security"));
  });
});
