// CRM loan applications: create/edit against lender products, scope, the full stage lifecycle with its gates, lists, export.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { emi } from "../src/lib/emi.js";
import { startStack } from "./harness.js";

const PW = "Strong-pass-123";
let s;
const t = {};
const id = {};
const api = (key, path, opts = {}) => s.api(path, { ...opts, token: t[key] });
const create = (key, body) => api(key, "/crm/applications", { method: "POST", body: { lenderId: "sbi", loanType: "home", loanAmount: 5000000, tenureMonths: 240, ...body } });
const move = (key, appId, body) => api(key, `/crm/applications/${appId}/stage`, { method: "POST", body });
const detail = (key, appId) => api(key, `/crm/applications/${appId}`);
let docSeq = 0;
const upload = (key, customerId, docType, applicationId) =>
  fetch(`${s.base}/crm/customers/${customerId}/documents?${new URLSearchParams({ docType, fileName: `${docType}.pdf`, ...(applicationId && { applicationId }) })}`, {
    method: "POST",
    headers: { authorization: `Bearer ${t[key]}`, "content-type": "application/pdf", "x-forwarded-for": `10.8.0.${++docSeq}` },
    body: Buffer.from(`%PDF-1.4 ${docType} ${docSeq}\n%%EOF`),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

before(async () => {
  s = await startStack();
  await s.run(["src/scripts/crm-admin.js", "owner@avodah.test", "Owner Name"], { CRM_ADMIN_PASSWORD: "Owner-pass-2026" });
  t.owner = (await s.api("/crm/auth/login", { method: "POST", body: { email: "owner@avodah.test", password: "Owner-pass-2026" } })).body.token;
  for (const [key, name, role] of [["manager", "Meera Manager", "manager"], ["analyst", "Deepa Krishnan", "credit_analyst"], ["emp", "Imran Sheikh", "employee"], ["emp2", "Amit Desai", "employee"], ["tele", "Kavita Menon", "telecaller"]]) {
    const res = await api("owner", "/crm/users", { method: "POST", body: { name, email: `${key}@avodah.test`, roleId: role, password: PW } });
    id[key] = res.body.user.id;
    t[key] = (await s.api("/crm/auth/login", { method: "POST", body: { email: `${key}@avodah.test`, password: PW } })).body.token;
  }
  await s.pg.query(`insert into lenders (id, name, kind, active, products) values
    ('sbi', 'SBI', 'PSU Bank', true, $1), ('hdfc', 'HDFC', 'PVT Bank', true, $2), ('gone', 'Gone Bank', 'NBFC', false, $2)`, [
    JSON.stringify([{ type: "home", rate: 8.5, maxAmount: 100000000, maxTenure: 30 }, { type: "personal", rate: 11, maxAmount: 2500000, maxTenure: 5 }]),
    JSON.stringify([{ type: "personal", rate: 10.5, maxAmount: 4000000, maxTenure: 5 }, { type: "home", rate: 8.75, maxAmount: 50000000, maxTenure: 25 }]),
  ]);
  const c = await api("emp", "/crm/customers", { method: "POST", body: { name: "Aarav Verma", phone: "9234567890", emp: "salaried", city: "Kolkata" } });
  id.customer = c.body.customer.id;
});
after(() => s?.stop());

describe("create", () => {
  test("validated against the customer, lender and product; rate from the product; EMI worked out by the server", async () => {
    const bad = await create("emp", { customerId: "x", loanType: "boat", loanAmount: 0, tenureMonths: 900 });
    assert.equal(bad.status, 400);
    for (const f of ["customerId", "loanType", "loanAmount", "tenureMonths"]) assert.ok(bad.body.fields[f], f);
    assert.equal((await create("emp", { customerId: id.manager })).status, 400, "staff aren't customers");
    assert.equal((await create("emp", { customerId: id.customer, lenderId: "gone" })).body.fields.lenderId, "Choose an active lender");
    assert.match((await create("emp", { customerId: id.customer, loanType: "gold" })).body.fields.loanType, /SBI doesn’t offer Gold Loan/);
    assert.ok((await create("emp", { customerId: id.customer, loanType: "personal", loanAmount: 3000000, tenureMonths: 36 })).body.fields.loanAmount);
    assert.ok((await create("emp", { customerId: id.customer, loanType: "personal", loanAmount: 100000, tenureMonths: 72 })).body.fields.tenureMonths);

    const res = await create("emp", { customerId: id.customer, processingFee: 10000, lenderRef: "SBI/HL/0042" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const a = res.body.application;
    id.app = a.id;
    assert.match(a.ref, /^AVD/);
    assert.deepEqual([a.stage, a.status, a.rate, a.assignedTo, a.processingFee, a.lenderRef], ["new", "submitted", 8.5, id.emp, 10000, "SBI/HL/0042"]);
    assert.equal(a.emi, Math.round(emi(5000000, 8.5, 240) * 100) / 100);
    assert.equal(res.body.customer.name, "Aarav Verma");
    assert.equal(res.body.lender.product.maxTenure, 30);
    assert.deepEqual(res.body.checklist.map((c) => c.docType), ["pan", "aadhaar", "address_proof", "salary_slip", "bank_statement", "property"]);
    assert.ok(res.body.checklist.every((c) => c.status === "missing"));
  });

  test("assignment: sales executives assign to themselves only; approvers assign anyone", async () => {
    assert.equal((await create("emp", { customerId: id.customer, assignedTo: id.emp2 })).status, 403);
    const res = await create("analyst", { customerId: id.customer, assignedTo: id.emp2 });
    assert.equal(res.body.application.assigneeName, "Amit Desai");
    assert.equal((await create("tele", { customerId: id.customer })).status, 403);
  });
});

describe("who sees which application", () => {
  test("own, created-by-me or unassigned files for sales executives; everything for approvers", async () => {
    assert.equal((await detail("emp2", id.app)).status, 404);
    assert.equal((await detail("manager", id.app)).status, 200);
    const mine = (await api("emp2", "/crm/applications")).body.applications;
    assert.ok(mine.every((a) => a.assignedTo === id.emp2 || a.assignedTo === null));
    assert.equal((await api("tele", "/crm/applications")).status, 403);
  });
});

describe("edit", () => {
  test("approvers edit loan details; EMI recalculated; changing lender brings its rate; recorded in history", async () => {
    assert.equal((await api("emp", `/crm/applications/${id.app}`, { method: "PATCH", body: { loanAmount: 4000000 } })).status, 403, "sales executives can't edit");
    let res = await api("analyst", `/crm/applications/${id.app}`, { method: "PATCH", body: { loanAmount: 4500000, tenureMonths: 180 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.application.emi, Math.round(emi(4500000, 8.5, 180) * 100) / 100);
    res = await api("analyst", `/crm/applications/${id.app}`, { method: "PATCH", body: { lenderId: "hdfc" } });
    assert.deepEqual([res.body.application.lenderName, res.body.application.rate], ["HDFC", 8.75]);
    assert.ok((await api("analyst", `/crm/applications/${id.app}`, { method: "PATCH", body: { tenureMonths: 360 } })).body.fields.tenureMonths, "HDFC home allows 300 months");
    await api("analyst", `/crm/applications/${id.app}`, { method: "PATCH", body: { lenderId: "sbi" } });
    const ev = res.body.history.find((h) => h.type === "updated");
    assert.deepEqual(ev.meta.changes.lenderId, { from: "sbi", to: "hdfc" });
  });
});

describe("the application lifecycle", () => {
  test("forward one stage at a time; skipping and wrong roles are refused", async () => {
    assert.equal((await move("emp", id.app, { stage: "login" })).status, 403, "sales executives can't move files");
    const skip = await move("analyst", id.app, { stage: "documents" });
    assert.equal(skip.status, 409);
    assert.match(skip.body.error, /next stage is Advisor call/);
    let res = await move("analyst", id.app, { stage: "login", note: "Logged with SBI branch" });
    assert.deepEqual([res.status, res.body.application.stage, res.body.application.status], [200, "login", "submitted"]);
    res = await move("analyst", id.app, { stage: "documents" });
    assert.deepEqual([res.body.application.stage, res.body.application.status], ["documents", "in_review"]);
  });

  test("credit review needs every required document verified", async () => {
    let res = await move("analyst", id.app, { stage: "credit_review" });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /PAN card, Aadhaar, Address proof, Salary slips, Bank statement, Property papers/);
    const uploaded = [];
    for (const docType of ["pan", "aadhaar", "address_proof", "salary_slip", "bank_statement", "property"]) {
      const up = await upload("emp", id.customer, docType, id.app);
      assert.equal(up.status, 201, JSON.stringify(up.body));
      uploaded.push(up.body.document.id);
    }
    res = await detail("analyst", id.app);
    assert.ok(res.body.checklist.every((c) => c.status === "uploaded" && c.document.applicationId === id.app));
    assert.equal((await move("analyst", id.app, { stage: "credit_review" })).status, 409, "uploaded isn't verified");
    for (const docId of uploaded) await api("analyst", `/crm/customers/${id.customer}/documents/${docId}`, { method: "PATCH", body: { status: "verified" } });
    res = await move("analyst", id.app, { stage: "credit_review" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.application.stage, "credit_review");
  });

  test("going back needs a reason", async () => {
    assert.equal((await move("analyst", id.app, { stage: "documents" })).body.fields.note, "Say why the application is going back a stage");
    assert.equal((await move("analyst", id.app, { stage: "documents", note: "Lender wants a newer bank statement" })).body.application.stage, "documents");
    assert.equal((await move("analyst", id.app, { stage: "credit_review" })).status, 200);
  });

  test("sanction: approvers only, amount required and capped at the request, EMI on the sanctioned terms", async () => {
    assert.equal((await move("emp", id.app, { stage: "sanctioned", sanctionedAmount: 4000000 })).status, 403);
    assert.equal((await move("analyst", id.app, { stage: "sanctioned" })).body.fields.sanctionedAmount, "Enter the sanctioned amount");
    assert.ok((await move("analyst", id.app, { stage: "sanctioned", sanctionedAmount: 9000000 })).body.fields.sanctionedAmount);
    const res = await move("analyst", id.app, { stage: "sanctioned", sanctionedAmount: 4000000, rate: 8.25, note: "Sanction letter issued" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const a = res.body.application;
    assert.deepEqual([a.stage, a.status, a.sanctionedAmount, a.rate, a.tenureMonths], ["sanctioned", "approved", 4000000, 8.25, 180]);
    assert.equal(a.emi, Math.round(emi(4000000, 8.25, 180) * 100) / 100);
    assert.ok(a.sanctionedAt);
    assert.equal(a.editable, false);
  });

  test("after sanction: details locked, no going back, only disburse or reject", async () => {
    assert.equal((await api("analyst", `/crm/applications/${id.app}`, { method: "PATCH", body: { loanAmount: 1000000 } })).status, 409);
    assert.equal((await api("analyst", `/crm/applications/${id.app}`, { method: "PATCH", body: { assignedTo: id.emp2 } })).status, 200, "reassigning still works");
    assert.match((await move("analyst", id.app, { stage: "credit_review", note: "x" })).body.error, /only be disbursed or rejected/);
    const moves = (await detail("analyst", id.app)).body.moves.map((m) => m.stage);
    assert.deepEqual(moves.sort(), ["disbursed", "rejected"]);
  });

  test("disburse: capped at the sanctioned amount; the file then closes", async () => {
    assert.ok((await move("analyst", id.app, { stage: "disbursed", disbursedAmount: 4100000 })).body.fields.disbursedAmount);
    assert.equal((await move("manager", id.app, { stage: "disbursed", disbursedAmount: 4000000 })).status, 403, "branch managers don't record lender decisions");
    const res = await move("analyst", id.app, { stage: "disbursed", disbursedAmount: 4000000 });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.application.stage, res.body.application.status, res.body.application.disbursedAmount], ["disbursed", "disbursed", 4000000]);
    assert.deepEqual(res.body.moves, []);
    assert.equal((await move("owner", id.app, { stage: "rejected", rejectionReason: "too late" })).status, 409);
  });

  test("the whole journey is in the history, newest first, and in the audit log", async () => {
    const h = (await detail("manager", id.app)).body.history;
    const stages = h.filter((e) => e.type === "stage_changed").map((e) => `${e.meta.from}>${e.meta.to}`).reverse();
    assert.deepEqual(stages, ["new>login", "login>documents", "documents>credit_review", "credit_review>documents", "documents>credit_review", "credit_review>sanctioned", "sanctioned>disbursed"]);
    const sanction = h.find((e) => e.meta?.to === "sanctioned");
    assert.deepEqual([sanction.meta.sanctionedAmount, sanction.meta.rate, sanction.body, sanction.actorName], [4000000, 8.25, "Sanction letter issued", "Deepa Krishnan"]);
    assert.equal(h.at(-1).type, "created");
    assert.equal((await api("owner", "/crm/audit-logs?action=application.stage_changed")).body.total, 7);
    const dash = (await api("owner", "/crm/dashboard")).body;
    assert.equal(dash.amounts.disbursed, 4500000, "dashboard follows the customer-facing status (requested amount)");
  });

  test("reject from an open stage needs a reason and closes the file", async () => {
    const a = (await create("analyst", { customerId: id.customer, loanType: "personal", loanAmount: 500000, tenureMonths: 36 })).body.application;
    assert.equal((await move("analyst", a.id, { stage: "rejected" })).body.fields.rejectionReason, "Say why the application was rejected");
    const res = await move("analyst", a.id, { stage: "rejected", rejectionReason: "FOIR above lender limit" });
    assert.deepEqual([res.body.application.stage, res.body.application.status, res.body.application.rejectionReason], ["rejected", "rejected", "FOIR above lender limit"]);
    assert.equal((await move("analyst", a.id, { stage: "login" })).status, 409);
  });
});

describe("entry points and links", () => {
  test("a converted lead arrives at Advisor call (login stage), assigned to the lead's owner", async () => {
    const lead = (await api("owner", "/crm/leads", { method: "POST", body: { name: "Lead Person", phone: "9345678901", source: "walk_in", ownerId: id.emp } })).body.lead;
    await api("emp", `/crm/leads/${lead.id}`, { method: "PATCH", body: { status: "qualified" } });
    const conv = (await api("emp", `/crm/leads/${lead.id}/convert`, { method: "POST", body: { lenderId: "sbi", loanType: "home", loanAmount: 3000000 } })).body;
    const d = (await detail("emp", conv.application.id)).body;
    assert.deepEqual([d.application.stage, d.application.assigneeName, d.application.leadRef], ["login", "Imran Sheikh", lead.ref]);
  });

  test("documents can only be attached to the customer's own applications", async () => {
    const other = (await api("emp", "/crm/customers", { method: "POST", body: { name: "Other Person", phone: "9567890123" } })).body.customer;
    const up = await upload("emp", other.id, "pan", id.app);
    assert.equal(up.status, 400);
  });
});

describe("lists", () => {
  test("search, filters, stage totals, sort and pagination", async () => {
    const all = (await api("manager", "/crm/applications?pageSize=100")).body;
    const ref = (await detail("manager", id.app)).body.application.ref;
    assert.deepEqual((await api("manager", `/crm/applications?q=${ref}`)).body.applications.map((a) => a.id), [id.app]);
    assert.ok((await api("manager", "/crm/applications?q=aarav")).body.applications.every((a) => a.customerName === "Aarav Verma"));
    assert.ok((await api("manager", "/crm/applications?q=SBI/HL")).body.total >= 1, "lender reference");
    assert.ok((await api("manager", "/crm/applications?stage=disbursed")).body.applications.every((a) => a.stage === "disbursed"));
    assert.ok((await api("manager", "/crm/applications?lenderId=hdfc")).body.applications.every((a) => a.lenderName === "HDFC"));
    assert.ok((await api("manager", "/crm/applications?loanType=personal")).body.applications.every((a) => a.type === "personal"));
    assert.ok((await api("manager", `/crm/applications?assignee=${id.emp2}`)).body.applications.every((a) => a.assigneeName === "Amit Desai"));
    assert.ok((await api("manager", "/crm/applications?assignee=unassigned")).body.applications.every((a) => a.assignedTo === null));
    assert.equal(all.stages.reduce((n, x) => n + x.count, 0), all.total);
    assert.equal(all.stages.find((x) => x.stage === "disbursed").count, 1);
    const amounts = (await api("manager", "/crm/applications?sort=amount&dir=desc")).body.applications.map((a) => a.loanAmount);
    assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
    const p1 = (await api("manager", "/crm/applications?pageSize=2&page=1")).body.applications;
    const p2 = (await api("manager", "/crm/applications?pageSize=2&page=2")).body.applications;
    assert.equal(new Set([...p1, ...p2].map((a) => a.id)).size, p1.length + p2.length);
  });

  test("pipeline board and export", async () => {
    const b = (await api("manager", "/crm/applications/board")).body;
    assert.deepEqual(b.columns.map((c) => c.stage), ["new", "login", "documents", "credit_review", "sanctioned", "disbursed", "rejected"]);
    assert.equal(b.columns.find((c) => c.stage === "disbursed").applications[0].id, id.app);
    assert.equal((await fetch(`${s.base}/crm/applications/export`, { headers: { authorization: `Bearer ${t.emp}` } })).status, 403);
    const res = await fetch(`${s.base}/crm/applications/export?stage=disbursed`, { headers: { authorization: `Bearer ${t.manager}` } });
    const [head, row] = (await res.text()).replace(/^﻿/, "").split("\r\n");
    assert.ok(head.startsWith("Application,Customer"));
    assert.ok(row.includes("Aarav Verma") && row.includes("Disbursed"));
  });
});
