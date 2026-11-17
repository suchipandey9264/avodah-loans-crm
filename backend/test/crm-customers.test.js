// CRM customer management: listing, add/edit, validation, masking & permissions, documents, website/lead/application links, history.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startStack } from "./harness.js";

const PW = "Strong-pass-123";
let s;
const t = {};
const id = {};
const api = (key, path, opts = {}) => s.api(path, { ...opts, token: t[key] });
const createCustomer = (key, body) => api(key, "/crm/customers", { method: "POST", body });
const detail = (key, cid) => api(key, `/crm/customers/${cid}`);
const list = (key, q = {}) => api(key, `/crm/customers?${new URLSearchParams(q)}`);
const upload = (key, cid, buf, q, type = "application/pdf") =>
  fetch(`${s.base}/crm/customers/${cid}/documents?${new URLSearchParams(q)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${t[key]}`, "content-type": type, "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: buf,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body")]);

let phoneSeq = 0;
const phone = () => `97531${String(++phoneSeq).padStart(5, "0")}`;

before(async () => {
  s = await startStack();
  await s.run(["src/scripts/crm-admin.js", "owner@avodah.test", "Owner Name"], { CRM_ADMIN_PASSWORD: "Owner-pass-2026" });
  t.owner = (await s.api("/crm/auth/login", { method: "POST", body: { email: "owner@avodah.test", password: "Owner-pass-2026" } })).body.token;
  id.owner = (await api("owner", "/crm/auth/me")).body.user.id;
  for (const [key, name, role] of [["manager", "Meera Manager", "manager"], ["analyst", "Deepa Krishnan", "credit_analyst"], ["emp", "Imran Sheikh", "employee"], ["tele", "Kavita Menon", "telecaller"], ["viewer", "Vik Viewer", "viewer"]]) {
    const res = await api("owner", "/crm/users", { method: "POST", body: { name, email: `${key}@avodah.test`, roleId: role, password: PW } });
    id[key] = res.body.user.id;
    t[key] = (await s.api("/crm/auth/login", { method: "POST", body: { email: `${key}@avodah.test`, password: PW } })).body.token;
  }
  await s.pg.exec(`insert into lenders (id, name, kind, active) values ('sbi','SBI','PSU Bank',true), ('hdfc','HDFC','PVT Bank',true)`);
});
after(() => s?.stop());

describe("add customer", () => {
  test("full profile: code, RM defaults to the creator, history starts with 'created'", async () => {
    const body = {
      name: "Gurpreet Kulkarni", phone: phone(), email: "gurpreet@example.com", alternatePhone: "9123456780", dob: "1997-04-17",
      gender: "Male", marital: "Single", pan: "aplpa8345a", aadhaarLast4: "4321", address: "184, Ring Road", city: "Pune",
      state: "Maharashtra", pincode: "411001", permanentSame: false, permanentAddress: "12 MG Road", permanentCity: "Nagpur",
      permanentState: "Maharashtra", permanentPincode: "440001", emp: "freelancer", company: "Self", annualIncome: 3300000,
      creditScore: 814,
    };
    assert.equal((await createCustomer("emp", { ...body, kycStatus: "verified" })).status, 403, "setting KYC status needs KYC access");
    const res = await createCustomer("emp", body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const c = res.body.customer;
    assert.match(c.code, /^C-\d{4,}$/);
    assert.equal(c.pan, "APXXXXX45A", "sales executives see a masked PAN");
    assert.equal(c.panMasked, true);
    assert.equal(c.relationshipManagerName, "Imran Sheikh");
    id.gurpreet = c.id;
    const d = (await detail("emp", c.id)).body;
    assert.deepEqual(
      [d.customer.dob, d.customer.city, d.customer.permanentCity, d.customer.company, d.customer.annualIncome, d.customer.creditScore, d.customer.kycStatus],
      ["1997-04-17", "Pune", "Nagpur", "Self", 3300000, 814, "pending"]
    );
    assert.deepEqual(d.history.map((h) => h.type), ["created"]);
    assert.equal(d.history[0].actorName, "Imran Sheikh");
    // The credit desk (KYC access) sees the full PAN and verifies KYC.
    assert.equal((await detail("analyst", c.id)).body.customer.pan, "APLPA8345A");
    assert.equal((await api("analyst", `/crm/customers/${c.id}`, { method: "PATCH", body: { kycStatus: "verified" } })).status, 200);
  });

  test("validation: age, PAN, pincode, Aadhaar, CIBIL range, enums", async () => {
    const res = await createCustomer("emp", {
      name: "Q", phone: "123", dob: "2015-01-01", pan: "1234", pincode: "000111", aadhaarLast4: "123456789012", creditScore: 950, gender: "Robot", emp: "astronaut",
    });
    assert.equal(res.status, 400);
    for (const f of ["name", "phone", "dob", "pan", "pincode", "aadhaarLast4", "creditScore", "gender", "emp"]) assert.ok(res.body.fields[f], `field ${f}`);
  });

  test("duplicates: an existing customer's or staff member's phone/email is refused", async () => {
    const p = phone();
    const first = await createCustomer("emp", { name: "First Person", phone: p });
    const dup = await createCustomer("emp", { name: "Second Person", phone: p });
    assert.equal(dup.status, 409);
    assert.match(dup.body.fields.phone, new RegExp(first.body.customer.code));
    const staffEmail = await createCustomer("emp", { name: "Staff Lookalike", phone: phone(), email: "tele@avodah.test" });
    assert.equal(staffEmail.status, 409);
    assert.match(staffEmail.body.error, /staff/);
  });

  test("permissions: telecaller and viewer can't add customers", async () => {
    assert.equal((await createCustomer("tele", { name: "Nope Person", phone: phone() })).status, 403);
    assert.equal((await createCustomer("viewer", { name: "Nope Person", phone: phone() })).status, 403);
  });
});

describe("website and CRM share one customer profile", () => {
  let cid, token;
  const p = phone();
  before(async () => {
    const otp = await s.api("/auth/otp", { method: "POST", body: { phone: p } });
    token = (await s.api("/auth/verify", { method: "POST", body: { phone: p, otp: otp.body.devOtp, name: "Neha Iyer" } })).body.token;
    // The customer fills in their website profile.
    await s.api("/me/profile", { method: "PATCH", token, body: { dob: "1992-02-02", pan: "BCDPE1234F", city: "Mumbai", employment: { company: "Infosys", designation: "Engineer" } } });
    cid = (await list("emp", { q: p })).body.customers[0].id;
  });

  test("a website sign-up is a customer with a code, and the CRM sees their website details", async () => {
    const d = (await detail("analyst", cid)).body;
    assert.match(d.customer.code, /^C-/);
    assert.deepEqual([d.customer.name, d.customer.dob, d.customer.pan, d.customer.city, d.customer.company], ["Neha Iyer", "1992-02-02", "BCDPE1234F", "Mumbai", "Infosys"]);
    assert.equal(d.history.at(-1).type, "registered");
  });

  test("CRM edits show on the website, and website-only fields are kept", async () => {
    const res = await api("emp", `/crm/customers/${cid}`, { method: "PATCH", body: { city: "Thane", pincode: "400601", company: "Infosys BPM", annualIncome: 1500000 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const web = (await s.api("/me/activity", { token })).body.profile;
    assert.equal(web.city, "Thane");
    assert.equal(web.pincode, "400601");
    assert.equal(web.employment.company, "Infosys BPM");
    assert.equal(web.employment.designation, "Engineer", "the website's own field survives");
    assert.equal(web.pan, "BCDPE1234F");
  });
});

describe("edit, KYC, credit score, RM and history", () => {
  test("each kind of change is its own history entry; sensitive values aren't copied into history", async () => {
    const res = await api("analyst", `/crm/customers/${id.gurpreet}`, { method: "PATCH", body: { pan: "APLPA8345B", kycStatus: "re_kyc", creditScore: 790, relationshipManagerId: id.manager, address: "22 New Road" } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.changed.sort(), ["address", "creditScore", "kycStatus", "pan", "relationshipManager"].sort());
    const h = (await detail("emp", id.gurpreet)).body.history;
    const byType = Object.fromEntries([...h].reverse().map((e) => [e.type, e])); // newest of each type
    assert.deepEqual(byType.kyc_changed.meta, { from: "verified", to: "re_kyc" });
    assert.deepEqual(byType.credit_score_updated.meta, { from: 814, to: 790 });
    assert.equal(byType.rm_assigned.meta.toName, "Meera Manager");
    assert.deepEqual(byType.updated.meta.fields.sort(), ["address", "pan"]);
    assert.equal(JSON.stringify(h).includes("APLPA8345B"), false);
    const logs = (await api("owner", "/crm/audit-logs?action=customer.updated")).body.logs;
    assert.ok(logs[0].meta.fields.includes("kycStatus"));
  });

  test("without KYC access: a PAN can be added but not changed, and KYC status can't be changed", async () => {
    assert.equal((await api("emp", `/crm/customers/${id.gurpreet}`, { method: "PATCH", body: { pan: "ZZZZZ9999Z" } })).status, 403);
    assert.equal((await api("emp", `/crm/customers/${id.gurpreet}`, { method: "PATCH", body: { kycStatus: "verified" } })).status, 403);
    assert.equal((await api("emp", `/crm/customers/${id.gurpreet}`, { method: "PATCH", body: { kycStatus: "re_kyc", city: "Pune" } })).status, 200, "sending the unchanged status is fine");
    const fresh = (await createCustomer("emp", { name: "No Pan Yet", phone: phone() })).body.customer;
    assert.equal((await api("emp", `/crm/customers/${fresh.id}`, { method: "PATCH", body: { pan: "ABCDE1234F" } })).status, 200, "adding a missing PAN is allowed");
    assert.equal((await detail("emp", fresh.id)).body.customer.pan, "ABXXXXX34F");
  });

  test("phone change can't take another customer's number; RM must be active staff; nothing to update is refused", async () => {
    const other = (await createCustomer("emp", { name: "Other Person", phone: phone() })).body.customer;
    assert.equal((await api("emp", `/crm/customers/${id.gurpreet}`, { method: "PATCH", body: { phone: other.phone } })).status, 409);
    assert.equal((await api("emp", `/crm/customers/${id.gurpreet}`, { method: "PATCH", body: { relationshipManagerId: "00000000-0000-4000-8000-000000000000" } })).status, 400);
    assert.equal((await api("emp", `/crm/customers/${id.gurpreet}`, { method: "PATCH", body: {} })).status, 400);
  });

  test("notes are added to the customer's history", async () => {
    assert.equal((await api("emp", `/crm/customers/${id.gurpreet}/notes`, { method: "POST", body: { body: "Prefers calls after 6pm" } })).status, 201);
    const h = (await detail("emp", id.gurpreet)).body.history;
    assert.ok(h.some((e) => e.type === "note" && e.body === "Prefers calls after 6pm"));
  });

  test("staff accounts and unknown ids are not customers", async () => {
    assert.equal((await detail("owner", id.manager)).status, 404);
    assert.equal((await detail("owner", "00000000-0000-4000-8000-000000000000")).status, 404);
    assert.equal((await detail("owner", "nope")).status, 404);
  });
});

describe("masking and permissions", () => {
  test("telecaller sees customers with PAN masked and can't edit", async () => {
    const d = (await detail("tele", id.gurpreet)).body;
    assert.equal(d.customer.pan, "APXXXXX45B");
    assert.equal(d.customer.panMasked, true);
    assert.equal(d.canSeeSensitive, false);
    const row = (await list("tele", { q: "Gurpreet" })).body.customers[0];
    assert.equal(row.pan, "APXXXXX45B");
    assert.equal((await api("tele", `/crm/customers/${id.gurpreet}`, { method: "PATCH", body: { city: "Goa" } })).status, 403);
    assert.equal((await api("tele", `/crm/customers/${id.gurpreet}/notes`, { method: "POST", body: { body: "x" } })).status, 403);
  });

  test("viewer has no customer access; export needs customers.export", async () => {
    assert.equal((await list("viewer")).status, 403);
    assert.equal((await fetch(`${s.base}/crm/customers/export`, { headers: { authorization: `Bearer ${t.emp}` } })).status, 403);
    assert.equal((await fetch(`${s.base}/crm/customers/export`, { headers: { authorization: `Bearer ${t.manager}` } })).status, 403, "customer export is Admin-only");
    const res = await fetch(`${s.base}/crm/customers/export?q=Gurpreet`, { headers: { authorization: `Bearer ${t.owner}` } });
    assert.equal(res.status, 200);
    const [head, row] = (await res.text()).replace(/^﻿/, "").split("\r\n");
    assert.ok(head.startsWith("Customer ID,Name,Phone"));
    assert.ok(row.includes("Gurpreet Kulkarni") && row.includes("APLPA8345B"));
  });
});

describe("documents", () => {
  let docId;
  test("upload a PDF; it's listed without its bytes and recorded in history", async () => {
    const res = await upload("emp", id.gurpreet, PDF, { docType: "pan", fileName: "pan card.pdf", note: "Self-attested" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    docId = res.body.document.id;
    assert.deepEqual([res.body.document.mimeType, res.body.document.sizeBytes, res.body.document.status], ["application/pdf", PDF.length, "uploaded"]);
    const d = (await detail("emp", id.gurpreet)).body;
    assert.equal(d.documents.length, 1);
    assert.equal("content" in d.documents[0], false);
    assert.ok(d.history.some((e) => e.type === "document_uploaded" && e.meta.fileName === "pan card.pdf"));
  });

  test("file type is checked by content; duplicates, empty and oversized files are refused", async () => {
    assert.equal((await upload("emp", id.gurpreet, Buffer.from("just text, renamed"), { docType: "pan", fileName: "fake.pdf" })).status, 400);
    assert.equal((await upload("emp", id.gurpreet, PDF, { docType: "pan", fileName: "again.pdf" })).status, 409);
    assert.equal((await upload("emp", id.gurpreet, Buffer.alloc(0), { docType: "pan", fileName: "empty.pdf" })).status, 400);
    const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    assert.equal((await upload("emp", id.gurpreet, big, { docType: "itr", fileName: "big.pdf" })).status, 413);
    assert.equal((await upload("emp", id.gurpreet, PNG, { docType: "spaceship", fileName: "x.png" }, "image/png")).status, 400);
    assert.equal((await upload("emp", id.gurpreet, PNG, { docType: "photo", fileName: "photo.png" }, "image/png")).status, 201);
  });

  test("download returns the exact bytes, safely, and is audited; only KYC access can download", async () => {
    assert.equal((await fetch(`${s.base}/crm/customers/${id.gurpreet}/documents/${docId}/file`, { headers: { authorization: `Bearer ${t.emp}` } })).status, 403, "sales executives upload but can't open documents");
    const res = await fetch(`${s.base}/crm/customers/${id.gurpreet}/documents/${docId}/file`, { headers: { authorization: `Bearer ${t.analyst}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-disposition"), /attachment; filename="pan card.pdf"/);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(PDF));
    assert.equal((await fetch(`${s.base}/crm/customers/${id.gurpreet}/documents/${docId}/file`, { headers: { authorization: `Bearer ${t.tele}` } })).status, 403);
    assert.equal((await upload("tele", id.gurpreet, PNG, { docType: "photo", fileName: "x.png" }, "image/png")).status, 403);
    assert.equal((await api("owner", "/crm/audit-logs?action=document.downloaded")).body.logs.length, 1);
  });

  test("verify and delete; deleted documents leave the list but stay in history", async () => {
    assert.equal((await api("emp", `/crm/customers/${id.gurpreet}/documents/${docId}`, { method: "PATCH", body: { status: "verified" } })).status, 403);
    assert.equal((await api("emp", `/crm/customers/${id.gurpreet}/documents/${docId}`, { method: "DELETE" })).status, 403);
    assert.equal((await api("analyst", `/crm/customers/${id.gurpreet}/documents/${docId}`, { method: "PATCH", body: { status: "verified" } })).status, 200);
    let d = (await detail("emp", id.gurpreet)).body;
    const doc = d.documents.find((x) => x.id === docId);
    assert.deepEqual([doc.status, doc.reviewedByName], ["verified", "Deepa Krishnan"]);
    assert.equal((await api("analyst", `/crm/customers/${id.gurpreet}/documents/${docId}`, { method: "DELETE" })).status, 200);
    d = (await detail("emp", id.gurpreet)).body;
    assert.equal(d.documents.some((x) => x.id === docId), false);
    const types = d.history.map((e) => e.type);
    assert.ok(types.includes("document_verified") && types.includes("document_deleted"));
    assert.equal((await fetch(`${s.base}/crm/customers/${id.gurpreet}/documents/${docId}/file`, { headers: { authorization: `Bearer ${t.analyst}` } })).status, 404);
  });
});

describe("linked leads and applications", () => {
  const convertLead = async (name, p, extra = {}) => {
    const lead = (await api("owner", "/crm/leads", { method: "POST", body: { name, phone: p, source: "call_centre", city: "Jaipur", employment: "salaried", annualIncome: 1200000, ownerId: id.emp, ...extra } })).body.lead;
    await api("emp", `/crm/leads/${lead.id}/notes`, { method: "POST", body: { body: "Interested in home loan" } });
    await api("emp", `/crm/leads/${lead.id}`, { method: "PATCH", body: { status: "qualified" } });
    const conv = await api("emp", `/crm/leads/${lead.id}/convert`, { method: "POST", body: { lenderId: "sbi", loanType: "home", loanAmount: 4000000 } });
    assert.equal(conv.status, 201, JSON.stringify(conv.body));
    return { lead, conv: conv.body };
  };

  test("a converted lead creates a linked customer: RM, profile, applications, leads and full history", async () => {
    const { lead, conv } = await convertLead("Vikram Reddy", phone());
    const cid = conv.customer.id;
    const d = (await detail("emp", cid)).body;
    assert.equal(d.customer.relationshipManagerName, "Imran Sheikh", "the lead's owner looks after the customer");
    assert.deepEqual([d.customer.city, d.customer.emp, d.customer.annualIncome], ["Jaipur", "salaried", 1200000]);
    assert.deepEqual(d.applications.map((a) => [a.ref, a.leadRef, a.lenderName, a.status]), [[conv.application.ref, lead.ref, "SBI", "submitted"]]);
    assert.equal(d.leads.length, 1);
    assert.deepEqual([d.leads[0].ref, d.leads[0].status, d.leads[0].convertedByName, d.leads[0].applicationRef], [lead.ref, "converted", "Imran Sheikh", conv.application.ref]);
    assert.equal(d.stats.applications, 1);
    assert.equal(d.stats.activeApplications, 1);
    assert.equal(d.stats.firstLeadSource, "Call centre");
    const types = d.history.map((e) => e.type);
    for (const ty of ["created", "lead_received", "note", "status_changed", "converted", "application_created"]) assert.ok(types.includes(ty), ty);
    assert.ok(d.history.find((e) => e.type === "note").leadRef === lead.ref, "lead events carry the lead ID");
    const times = d.history.map((e) => new Date(e.at).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first");
  });

  test("converting a second lead for the same customer links it and fills (never overwrites) details", async () => {
    const p = phone();
    const created = (await createCustomer("emp", { name: "Harpreet Shah", phone: p, city: "Chennai" })).body.customer;
    await api("emp", `/crm/customers/${created.id}`, { method: "PATCH", body: { relationshipManagerId: null } });
    const { lead } = await convertLead("Harpreet Shah", p, { city: "Delhi" });
    const d = (await detail("emp", created.id)).body;
    assert.equal(d.customer.city, "Chennai", "existing value kept");
    assert.equal(d.customer.emp, "salaried", "missing value filled from the lead");
    assert.equal(d.customer.relationshipManagerName, "Imran Sheikh", "RM given because there was none");
    assert.ok(d.history.some((e) => e.type === "lead_linked" && e.meta.leadRef === lead.ref));
    assert.equal(d.applications.length, 1);
  });

  test("follow-ups from the customer's leads show on the customer", async () => {
    const { lead, conv } = await convertLead("Kabir Malhotra", phone());
    await api("emp", `/crm/leads/${lead.id}/followups`, { method: "POST", body: { type: "visit", dueAt: new Date(Date.now() + 86400e3).toISOString(), note: "Collect property papers" } });
    const d = (await detail("emp", conv.customer.id)).body;
    assert.equal(d.followups.length, 1);
    assert.deepEqual([d.followups[0].leadRef, d.followups[0].note, d.followups[0].state], [lead.ref, "Collect property papers", "pending"]);
  });
});

describe("listing: stats, search, filters, sort, pagination", () => {
  test("stats count customers only, with KYC share, active files and disbursed total", async () => {
    const res = (await list("emp")).body;
    const total = (await s.pg.query("select count(*)::int as n from users where role_id is null")).rows[0].n;
    assert.equal(res.stats.total, total);
    assert.equal(res.total, total);
    assert.ok(res.stats.activeFile >= 3);
    await s.pg.query(`update applications set status = 'disbursed' where ref = (select ref from applications order by created_at limit 1)`);
    assert.equal((await list("emp")).body.stats.disbursed, 4000000);
  });

  test("search by name, phone, email, customer ID and PAN", async () => {
    const g = (await detail("emp", id.gurpreet)).body.customer;
    for (const q of ["gurpreet", g.phone.slice(-5), "gurpreet@exam", g.code, "APLPA8345B"]) {
      assert.deepEqual((await list("emp", { q })).body.customers.map((c) => c.id), [id.gurpreet], `search ${q}`);
    }
  });

  test("filters by KYC, relationship manager and city", async () => {
    assert.ok((await list("emp", { kyc: "re_kyc" })).body.customers.every((c) => c.kycStatus === "re_kyc"));
    const mine = (await list("manager", { rm: "me" })).body.customers;
    assert.ok(mine.some((c) => c.id === id.gurpreet) && mine.every((c) => c.relationshipManagerName === "Meera Manager"));
    assert.ok((await list("emp", { rm: id.emp })).body.customers.every((c) => c.relationshipManagerName === "Imran Sheikh"));
    assert.ok((await list("emp", { rm: "none" })).body.customers.every((c) => c.relationshipManagerName === null));
    assert.deepEqual((await list("emp", { city: "THANE" })).body.customers.map((c) => c.name), ["Neha Iyer"]);
  });

  test("sorting and pagination", async () => {
    const byName = (await list("emp", { sort: "name", dir: "asc", pageSize: 100 })).body.customers.map((c) => c.name);
    assert.deepEqual(byName, [...byName].sort());
    const byApps = (await list("emp", { sort: "applications", dir: "desc" })).body.customers;
    assert.ok(byApps[0].applications >= byApps.at(-1).applications);
    const p1 = (await list("emp", { pageSize: 3, page: 1 })).body;
    const p2 = (await list("emp", { pageSize: 3, page: 2 })).body;
    assert.equal(p1.customers.length, 3);
    assert.equal(new Set([...p1.customers, ...p2.customers].map((c) => c.id)).size, p1.customers.length + p2.customers.length);
  });
});
