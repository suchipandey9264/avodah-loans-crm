// CRM lenders: list figures and filters, create/edit with products and contacts, links to the website and applications.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startStack } from "./harness.js";

const PW = "Strong-pass-123";
let s;
const t = {};
const api = (key, path, opts = {}) => s.api(path, { ...opts, token: t[key] });
const HOME = { type: "home", rate: 8.4, maxAmount: 50000000, maxTenure: 30, minTenure: 5, processingFee: "0.35%", minCibil: 700, minIncome: 600000, features: ["Balance transfer"] };
const PERSONAL = { type: "personal", rate: 10.9, maxAmount: 2500000, maxTenure: 5 };

before(async () => {
  s = await startStack();
  await s.run(["src/scripts/crm-admin.js", "owner@avodah.test", "Owner Name"], { CRM_ADMIN_PASSWORD: "Owner-pass-2026" });
  t.owner = (await s.api("/crm/auth/login", { method: "POST", body: { email: "owner@avodah.test", password: "Owner-pass-2026" } })).body.token;
  for (const [key, role] of [["analyst", "credit_analyst"], ["manager", "manager"], ["emp", "employee"], ["tele", "telecaller"]]) {
    await api("owner", "/crm/users", { method: "POST", body: { name: `Test ${role.replace("_", " ")}`, email: `${key}@avodah.test`, roleId: role, password: PW } });
    t[key] = (await s.api("/crm/auth/login", { method: "POST", body: { email: `${key}@avodah.test`, password: PW } })).body.token;
  }
});
after(() => s?.stop());

describe("lenders", () => {
  let customerId, appId;

  test("create with contacts and products; validation; duplicate ID refused; appears on the public website", async () => {
    const bad = await api("owner", "/crm/lenders", { method: "POST", body: { id: "Bad Id", name: "", kind: "Bank", products: [HOME, HOME] } });
    assert.equal(bad.status, 400);
    for (const f of ["id", "name", "kind", "products"]) assert.ok(bad.body.fields[f], f);
    const res = await api("owner", "/crm/lenders", { method: "POST", body: {
      id: "acme", name: "Acme Bank", fullName: "Acme Bank Ltd", kind: "PVT Bank", fee: "0.5% – 1%", about: "Test partner",
      contacts: [{ name: "Gurpreet Agarwal", role: "Relationship manager", phone: "9170410818", email: "g@acme.test" }], products: [HOME, PERSONAL],
    } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual([res.body.lender.lowestRate, res.body.lender.contacts[0].name, res.body.lender.active], [8.4, "Gurpreet Agarwal", true]);
    assert.equal((await api("owner", "/crm/lenders", { method: "POST", body: { id: "acme", name: "Acme Again", kind: "NBFC" } })).status, 409);
    const pub = await s.api("/lenders/acme");
    assert.equal(pub.status, 200);
    assert.equal(pub.body.lender.products.find((p) => p.type === "home").rate, 8.4);
    const offers = await s.api("/offers?type=home&amount=3000000&tenure=20&income=1200000");
    assert.ok(offers.body.offers.some((o) => o.id === "acme"), "the website's offers include the new lender");
  });

  test("applications follow the product: min tenure enforced, figures roll up to the lender", async () => {
    customerId = (await api("owner", "/crm/customers", { method: "POST", body: { name: "Asha Verma", phone: "9811111111", emp: "salaried" } })).body.customer.id;
    const short = await api("owner", "/crm/applications", { method: "POST", body: { customerId, lenderId: "acme", loanType: "home", loanAmount: 3000000, tenureMonths: 36 } });
    assert.match(short.body.fields.tenureMonths, /at least 60 months/);
    const ok = await api("owner", "/crm/applications", { method: "POST", body: { customerId, lenderId: "acme", loanType: "home", loanAmount: 3000000, tenureMonths: 240 } });
    assert.equal(ok.status, 201);
    appId = ok.body.application.id;
    assert.equal(ok.body.application.rate, 8.4);
    const d = (await api("owner", "/crm/lenders/acme")).body;
    assert.deepEqual([d.lender.stats.files, d.lender.stats.open, d.lender.stats.approvalRate], [1, 1, null]);
    assert.equal(d.applications[0].id, appId);
  });

  test("edit: rate change updates the website's lowest rate; removing a product with open files is refused", async () => {
    assert.equal((await api("analyst", "/crm/lenders/acme", { method: "PATCH", body: { products: [{ ...HOME, rate: 8.1 }, PERSONAL] } })).status, 403, "rate cards and payouts are Admin-only");
    let res =await api("owner", "/crm/lenders/acme", { method: "PATCH", body: { products: [{ ...HOME, rate: 8.1 }, PERSONAL] } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.lender.lowestRate, 8.1);
    assert.equal((await s.api("/lenders/acme")).body.lender.lowestRate, 8.1);
    res = await api("owner", "/crm/lenders/acme", { method: "PATCH", body: { products: [PERSONAL] } });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Home Loan \(1 open application\)/);
    assert.equal((await api("owner", "/crm/lenders/acme", { method: "PATCH", body: { products: [{ ...HOME, rate: 8.1 }] } })).status, 200, "an unused product can go");
  });

  test("deactivate: hidden from the website and new applications, existing files still open", async () => {
    const res = await api("owner", "/crm/lenders/acme", { method: "PATCH", body: { active: false } });
    assert.equal(res.body.lender.active, false);
    assert.equal((await s.api("/lenders/acme")).status, 404);
    const neu = await api("owner", "/crm/applications", { method: "POST", body: { customerId, lenderId: "acme", loanType: "home", loanAmount: 3000000, tenureMonths: 240 } });
    assert.equal(neu.body.fields.lenderId, "Choose an active lender");
    assert.equal((await api("owner", `/crm/applications/${appId}`)).body.lender.active, false);
    assert.equal((await api("owner", "/crm/audit-logs?action=lender.deactivated")).body.total, 1);
  });

  test("list: totals, search and filters, approval rate from decided files", async () => {
    await api("owner", "/crm/lenders", { method: "POST", body: { id: "nbfc-one", name: "Quick Finance", kind: "NBFC", products: [PERSONAL] } });
    await s.pg.query("update applications set stage = 'rejected', status = 'rejected' where id = $1", [appId]);
    const all = (await api("emp", "/crm/lenders")).body;
    assert.deepEqual([all.totals.total, all.totals.active], [2, 1]);
    assert.equal(all.lenders.find((l) => l.id === "acme").stats.approvalRate, 0);
    assert.deepEqual((await api("emp", "/crm/lenders?q=quick")).body.lenders.map((l) => l.id), ["nbfc-one"]);
    assert.deepEqual((await api("emp", "/crm/lenders?kind=NBFC")).body.lenders.map((l) => l.id), ["nbfc-one"]);
    assert.deepEqual((await api("emp", "/crm/lenders?status=inactive")).body.lenders.map((l) => l.id), ["acme"]);
    assert.deepEqual((await api("emp", "/crm/lenders?loanType=home")).body.lenders.map((l) => l.id), ["acme"]);
  });

  test("partnership terms: payout, turnaround, agreement; payout earned and network averages", async () => {
    const bad = await api("owner", "/crm/lenders/acme", { method: "PATCH", body: { payoutPct: 25, tatDays: 0, agreementUntil: "31-08-2027", logo: "javascript:alert(1)" } });
    assert.equal(bad.status, 400);
    for (const f of ["payoutPct", "tatDays", "agreementUntil", "logo"]) assert.ok(bad.body.fields[f], f);
    const ok = await api("owner", "/crm/lenders/acme", { method: "PATCH", body: { payoutPct: 0.5, tatDays: 12, agreementUntil: "2027-08-31", logo: "/bank-logos/sbi.png", active: true } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.lender.payoutPct, ok.body.lender.tatDays, ok.body.lender.agreementUntil], [0.5, 12, "2027-08-31"]);
    await api("owner", "/crm/lenders/nbfc-one", { method: "PATCH", body: { tatDays: 6, payoutPct: 1.5 } });
    await s.pg.query("update applications set stage = 'disbursed', status = 'disbursed', disbursed_amount = 2000000 where id = $1", [appId]);
    const list = (await api("emp", "/crm/lenders?kind=NBFC")).body;
    assert.equal(list.lenders.length, 1, "filters narrow the rows…");
    assert.deepEqual([list.totals.total, list.totals.avgTatDays, list.totals.avgPayoutPct, list.totals.payoutEarned, list.totals.disbursed], [2, 9, 1, 10000, 2000000], "…but totals cover the network");
    assert.equal((await api("emp", "/crm/lenders/acme")).body.lender.stats.payoutEarned, 10000);
    assert.equal((await s.api("/lenders/acme")).body.lender.payoutPct, undefined, "partnership terms stay off the public website");
  });

  test("delete: only lenders without applications; needs lenders.delete", async () => {
    assert.equal((await api("analyst", "/crm/lenders/nbfc-one", { method: "DELETE" })).status, 403);
    const used = await api("owner", "/crm/lenders/acme", { method: "DELETE" });
    assert.equal(used.status, 409);
    assert.match(used.body.error, /Deactivate it instead/);
    assert.equal((await api("owner", "/crm/lenders/nbfc-one", { method: "DELETE" })).status, 200);
    assert.equal((await api("owner", "/crm/lenders/nbfc-one")).status, 404);
    assert.equal((await api("owner", "/crm/audit-logs?action=lender.deleted")).body.total, 1);
  });

  test("seed adds missing lenders but never overwrites CRM edits", async () => {
    await s.run(["src/scripts/seed.js"]);
    const sbi = (await api("owner", "/crm/lenders/sbi")).body.lender;
    await api("owner", "/crm/lenders/sbi", { method: "PATCH", body: { fee: "Edited in CRM" } });
    await s.run(["src/scripts/seed.js"]);
    assert.ok(sbi.products.length > 0);
    assert.equal((await api("owner", "/crm/lenders/sbi")).body.lender.fee, "Edited in CRM");
    assert.equal((await api("owner", "/crm/lenders/acme")).body.lender.name, "Acme Bank", "CRM-only lenders untouched");
  });

  test("permissions: view for sales, edit for credit analysts, create/edit for admins only", async () => {
    assert.equal((await api("emp", "/crm/lenders", { method: "POST", body: { id: "x1", name: "X Bank", kind: "NBFC" } })).status, 403);
    assert.equal((await api("manager", "/crm/lenders/acme", { method: "PATCH", body: { active: true } })).status, 403);
    assert.equal((await api("analyst", "/crm/lenders", { method: "POST", body: { id: "x2", name: "Y Bank", kind: "NBFC" } })).status, 403);
    assert.equal((await api("tele", "/crm/lenders")).status, 403);
    assert.equal((await api("emp", "/crm/lenders/nope")).status, 404);
  });
});
