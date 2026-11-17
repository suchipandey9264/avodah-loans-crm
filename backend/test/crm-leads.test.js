// CRM lead management: CRUD, search/filters/sort, scope & permissions, history, follow-ups, bulk, export, conversion.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startStack } from "./harness.js";

const PW = "Strong-pass-123";
let s;
const t = {}; // tokens by key
const id = {}; // staff user ids by key

const api = (key, path, opts = {}) => s.api(path, { ...opts, token: t[key] });
const create = async (key, body) => { const r = await api(key, "/crm/leads", { method: "POST", body: { source: "walk_in", ...body } }); if (process.env.DEBUG_LEADS && r.status !== 201) console.log("CREATE", r.status, JSON.stringify(r.body)); return r; };
const patch = (key, leadId, body) => api(key, `/crm/leads/${leadId}`, { method: "PATCH", body });
const detail = (key, leadId) => api(key, `/crm/leads/${leadId}`);
const list = (key, q = {}) => api(key, `/crm/leads?${new URLSearchParams(q)}`);
let phoneSeq = 0;
const phone = () => `98765${String(++phoneSeq).padStart(5, "0")}`;

before(async () => {
  s = await startStack();
  await s.run(["src/scripts/crm-admin.js", "owner@avodah.test", "Owner Name"], { CRM_ADMIN_PASSWORD: "Owner-pass-2026" });
  t.owner = (await s.api("/crm/auth/login", { method: "POST", body: { email: "owner@avodah.test", password: "Owner-pass-2026" } })).body.token;
  id.owner = (await api("owner", "/crm/auth/me")).body.user.id;
  // Names chosen so auto-assign tie-breaks (by name) are predictable: Asha < Bina < Chetan.
  for (const [key, name, role] of [
    ["manager", "Meera Manager", "manager"], ["emp1", "Asha Sales", "employee"], ["emp2", "Bina Sales", "employee"],
    ["tele", "Chetan Caller", "telecaller"], ["analyst", "Dev Analyst", "credit_analyst"], ["viewer", "Vik Viewer", "viewer"],
  ]) {
    const res = await api("owner", "/crm/users", { method: "POST", body: { name, email: `${key}@avodah.test`, roleId: role, password: PW } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    id[key] = res.body.user.id;
    t[key] = (await s.api("/crm/auth/login", { method: "POST", body: { email: `${key}@avodah.test`, password: PW } })).body.token;
  }
  await s.pg.exec(`insert into lenders (id, name, kind, active) values ('sbi','SBI','PSU Bank',true), ('hdfc','HDFC','PVT Bank',true), ('gone','Gone Bank','NBFC',false)`);
});
after(() => s?.stop());

describe("create", () => {
  test("manager adds a lead with every field; it gets an L- reference and history", async () => {
    const res = await create("manager", {
      name: "Rohan Joshi", phone: phone(), email: "rohan@example.com", city: "Indore", loanType: "home", loanAmount: 4050000,
      annualIncome: 1800000, employment: "freelancer", source: "facebook_ads", temperature: "hot", ownerId: id.emp1,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const lead = res.body.lead;
    assert.match(lead.ref, /^L-\d{4,}$/);
    assert.equal(lead.status, "new");
    assert.equal(lead.kind, "crm");
    assert.equal(lead.ownerName, "Asha Sales");
    const d = (await detail("manager", lead.id)).body;
    assert.equal(d.lead.createdByName, "Meera Manager");
    assert.deepEqual(d.timeline.map((e) => e.type), ["assigned"]);
  });

  test("validation: name, phone, amounts and enums are checked", async () => {
    const res = await create("manager", { name: "X", phone: "12345", loanAmount: -5, source: "carrier-pigeon" });
    assert.equal(res.status, 400);
    for (const f of ["name", "phone", "loanAmount", "source"]) assert.ok(res.body.fields[f], `field ${f}`);
  });

  test("an open lead with the same phone is refused; a lost one isn't", async () => {
    const p = phone();
    const first = await create("manager", { name: "Dup One", phone: p });
    const dup = await create("manager", { name: "Dup Two", phone: p });
    assert.equal(dup.status, 409);
    assert.match(dup.body.fields.phone, new RegExp(first.body.lead.ref));
    await patch("manager", first.body.lead.id, { status: "lost", lostReason: "Not reachable" });
    assert.equal((await create("manager", { name: "Dup Three", phone: p })).status, 201);
  });

  test("auto-assign gives each new lead to the least-busy front-line employee", async () => {
    const openCounts = async () =>
      Object.fromEntries((await s.pg.query(
        `select u.name, count(l.id)::int as n from users u left join leads l on l.owner_id = u.id and l.deleted_at is null
           and l.status in ('new','contacted','interested','docs_pending','qualified')
         where u.id = any($1) group by u.name`, [[id.emp1, id.emp2, id.tele]])).rows.map((r) => [r.name, r.n]));
    for (let i = 0; i < 4; i++) {
      const before = await openCounts();
      const owner = (await create("owner", { name: `Auto Lead ${"ABCD"[i]}`, phone: phone(), ownerId: "auto" })).body.lead.ownerName;
      assert.ok(["Asha Sales", "Bina Sales", "Chetan Caller"].includes(owner), `front-line only, got ${owner}`);
      assert.equal(before[owner], Math.min(...Object.values(before)), `picked ${owner} with ${before[owner]} open, counts ${JSON.stringify(before)}`);
    }
    const after = Object.values(await openCounts());
    assert.ok(Math.max(...after) - Math.min(...after) <= 1, "workload stays balanced");
  });

  test("a role without leads.assign creates leads for itself only", async () => {
    const mine = await create("tele", { name: "Tele Lead", phone: phone() });
    assert.equal(mine.status, 201);
    assert.equal(mine.body.lead.ownerId, id.tele);
    assert.equal((await create("tele", { name: "Other Lead", phone: phone(), ownerId: id.emp1 })).status, 403);
  });

  test("roles without leads.create can't add leads", async () => {
    assert.equal((await create("analyst", { name: "Nope Lead", phone: phone() })).status, 403);
    assert.equal((await create("viewer", { name: "Nope Lead", phone: phone() })).status, 403);
  });
});

describe("list: search, filters, sorting, pagination", () => {
  let base;
  before(async () => {
    base = [];
    const rows = [
      ["Kiran Mehta", "Pune", "website", "personal", 300000, id.emp2, "kiran@mail.test"],
      ["Neha Iyer", "Mumbai", "referral", "home", 9000000, id.emp2, "neha@mail.test"],
      ["Zubin Shah", "mumbai", "walk_in", "car", 800000, null, null],
    ];
    for (const [name, city, source, loanType, loanAmount, ownerId, email] of rows) {
      base.push((await create("owner", { name, phone: phone(), city, source, loanType, loanAmount, ownerId, email })).body.lead);
    }
  });

  test("search by name, phone, email and lead ID", async () => {
    assert.deepEqual((await list("owner", { q: "neha" })).body.leads.map((l) => l.name), ["Neha Iyer"]);
    assert.deepEqual((await list("owner", { q: base[0].phone.slice(-6) })).body.leads.map((l) => l.name), ["Kiran Mehta"]);
    assert.deepEqual((await list("owner", { q: "kiran@mail" })).body.leads.map((l) => l.name), ["Kiran Mehta"]);
    assert.deepEqual((await list("owner", { q: base[2].ref })).body.leads.map((l) => l.name), ["Zubin Shah"]);
    assert.equal((await list("owner", { q: "%" })).body.total, 0, "wildcards are literal");
  });

  test("filters by status, source, city (case-insensitive) and employee", async () => {
    assert.deepEqual((await list("owner", { source: "referral" })).body.leads.map((l) => l.name), ["Neha Iyer"]);
    assert.deepEqual((await list("owner", { city: "MUMBAI", sort: "name", dir: "asc" })).body.leads.map((l) => l.name), ["Neha Iyer", "Zubin Shah"]);
    const emp2 = (await list("owner", { owner: id.emp2 })).body.leads.map((l) => l.name);
    assert.ok(emp2.includes("Kiran Mehta") && emp2.includes("Neha Iyer") && !emp2.includes("Zubin Shah"));
    assert.ok((await list("owner", { owner: "unassigned" })).body.leads.every((l) => l.ownerId === null));
    assert.ok((await list("emp2", { owner: "me" })).body.leads.every((l) => l.ownerId === id.emp2));
    const lost = (await list("owner", { status: "lost" })).body;
    assert.ok(lost.leads.length >= 1 && lost.leads.every((l) => l.status === "lost"));
    assert.equal(lost.statusCounts.lost, lost.total);
    assert.ok(lost.statusCounts.new > 0, "counts ignore the status filter so the tabs stay filled");
  });

  test("sorting and pagination", async () => {
    const byAmount = (await list("owner", { sort: "amount", dir: "desc", pageSize: 3 })).body;
    assert.equal(byAmount.leads[0].name, "Neha Iyer");
    assert.equal(byAmount.leads.length, 3);
    const p1 = (await list("owner", { sort: "name", dir: "asc", pageSize: 4, page: 1 })).body;
    const p2 = (await list("owner", { sort: "name", dir: "asc", pageSize: 4, page: 2 })).body;
    assert.equal(p1.total, p2.total);
    const names = [...p1.leads, ...p2.leads].map((l) => l.name);
    assert.deepEqual(names, [...names].sort()); // plain code-point order, as PostgreSQL's C collation sorts
    assert.equal(new Set([...p1.leads, ...p2.leads].map((l) => l.id)).size, names.length, "pages don't overlap");
    assert.equal((await list("owner", { sort: "bogus" })).status, 400);
  });

  test("board groups the same filtered leads by status with counts and amounts", async () => {
    const b = (await api("owner", "/crm/leads/board?city=mumbai")).body;
    assert.deepEqual(b.columns.map((c) => c.status), ["new", "contacted", "interested", "docs_pending", "qualified", "converted", "lost"]);
    const n = b.columns.find((c) => c.status === "new");
    assert.equal(n.count, 2);
    assert.equal(n.amount, 9800000);
  });
});

describe("who sees which leads", () => {
  test("front-line staff see their own and unassigned leads only; managers see all", async () => {
    const theirs = (await create("owner", { name: "Emp One Only", phone: phone(), ownerId: id.emp1 })).body.lead;
    const pool = (await create("owner", { name: "Pool Lead", phone: phone(), ownerId: null })).body.lead;
    const emp2 = (await list("emp2", { pageSize: 100 })).body.leads;
    assert.ok(emp2.every((l) => l.ownerId === id.emp2 || l.ownerId === null));
    assert.ok(emp2.some((l) => l.id === pool.id));
    assert.equal((await detail("emp2", theirs.id)).status, 404);
    assert.equal((await patch("emp2", theirs.id, { temperature: "cold" })).status, 404);
    assert.equal((await detail("manager", theirs.id)).status, 200);
    assert.equal((await list("viewer")).status, 403);
    assert.equal((await detail("owner", "not-a-uuid")).status, 404);
  });
});

describe("edit, status and history", () => {
  let lead;
  before(async () => {
    lead = (await create("owner", { name: "Deepak Pillai", phone: phone(), city: "Bengaluru", loanType: "home", loanAmount: 5350000, ownerId: id.emp1 })).body.lead;
  });

  test("edit fields; each change is recorded with old and new values", async () => {
    const res = await patch("emp1", lead.id, { city: "Mysuru", loanAmount: 6000000, temperature: "hot" });
    assert.equal(res.status, 200);
    assert.equal(res.body.lead.city, "Mysuru");
    const ev = (await detail("emp1", lead.id)).body.timeline.find((e) => e.type === "updated");
    assert.deepEqual(ev.meta.changes.city, { from: "Bengaluru", to: "Mysuru" });
    assert.equal(ev.actorName, "Asha Sales");
  });

  test("status changes are recorded; leaving New stamps last contact", async () => {
    const res = await patch("emp1", lead.id, { status: "contacted" });
    assert.equal(res.body.lead.status, "contacted");
    assert.ok(res.body.lead.lastContactedAt);
    const ev = (await detail("emp1", lead.id)).body.timeline.find((e) => e.type === "status_changed");
    assert.deepEqual([ev.meta.from, ev.meta.to], ["new", "contacted"]);
  });

  test("lost needs a reason; converted can only be set by converting", async () => {
    assert.equal((await patch("emp1", lead.id, { status: "lost" })).status, 400);
    assert.equal((await patch("emp1", lead.id, { status: "converted" })).status, 400);
  });

  test("only roles with leads.assign can reassign", async () => {
    assert.equal((await patch("emp1", lead.id, { ownerId: id.emp2 })).status, 403);
    const res = await patch("manager", lead.id, { ownerId: id.emp2 });
    assert.equal(res.status, 200);
    assert.equal(res.body.lead.ownerName, "Bina Sales");
    assert.equal((await patch("manager", lead.id, { ownerId: id.viewer })).status, 400, "viewers can't own leads");
  });

  test("notes and follow-ups: schedule, overdue state, complete once", async () => {
    const note = await api("emp2", `/crm/leads/${lead.id}/notes`, { method: "POST", body: { body: "Called, wants rate comparison" } });
    assert.equal(note.status, 201);
    const soon = new Date(Date.now() + 3600e3).toISOString();
    const fu = await api("emp2", `/crm/leads/${lead.id}/followups`, { method: "POST", body: { type: "whatsapp", dueAt: soon, note: "Share document checklist" } });
    assert.equal(fu.status, 201);
    assert.equal(fu.body.followup.assignedTo, id.emp2, "defaults to the lead's owner");
    assert.equal((await api("emp2", `/crm/leads/${lead.id}/followups`, { method: "POST", body: { type: "call", dueAt: "2020-01-01T00:00:00Z" } })).status, 400);
    // A follow-up that slipped past its time shows as overdue.
    await s.pg.query(`insert into followups (lead_id, type, due_at, assigned_to) values ($1, 'call', now() - interval '1 day', $2)`, [lead.id, id.emp2]);
    const d1 = (await detail("emp2", lead.id)).body;
    assert.deepEqual(d1.followups.map((f) => f.state).sort(), ["overdue", "pending"]);
    const done = await api("emp2", `/crm/leads/${lead.id}/followups/${fu.body.followup.id}`, { method: "PATCH", body: { status: "done", outcome: "Sent" } });
    assert.equal(done.status, 200);
    assert.equal((await api("emp2", `/crm/leads/${lead.id}/followups/${fu.body.followup.id}`, { method: "PATCH", body: { status: "cancelled" } })).status, 409);
    const types = (await detail("emp2", lead.id)).body.timeline.map((e) => e.type);
    for (const ty of ["note", "followup_scheduled", "followup_done", "assigned", "status_changed", "updated"]) assert.ok(types.includes(ty), ty);
  });
});

describe("delete (soft) and bulk", () => {
  test("delete hides the lead but keeps the row and its history", async () => {
    const lead = (await create("owner", { name: "Delete Me", phone: phone() })).body.lead;
    await api("owner", `/crm/leads/${lead.id}/notes`, { method: "POST", body: { body: "keep this" } });
    assert.equal((await api("emp1", `/crm/leads/${lead.id}`, { method: "DELETE" })).status, 403, "sales executives can't delete");
    assert.equal((await api("manager", `/crm/leads/${lead.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await detail("owner", lead.id)).status, 404);
    assert.equal((await list("owner", { q: lead.ref })).body.total, 0);
    const row = (await s.pg.query("select deleted_at, deleted_by from leads where id = $1", [lead.id])).rows[0];
    assert.ok(row.deleted_at && row.deleted_by === id.manager);
    const hist = (await s.pg.query("select type from timeline_events where entity_id = $1 order by created_at", [lead.id])).rows.map((r) => r.type);
    assert.deepEqual(hist, ["assigned", "note", "deleted"]); // everything before the delete is kept
  });

  test("bulk assign, status and delete; converted leads and unseen leads are skipped", async () => {
    const a = (await create("owner", { name: "Bulk A", phone: phone(), ownerId: null })).body.lead;
    const b = (await create("owner", { name: "Bulk B", phone: phone(), ownerId: null })).body.lead;
    const assign = await api("manager", "/crm/leads/bulk", { method: "POST", body: { action: "assign", ids: [a.id, b.id], ownerId: id.emp1 } });
    assert.deepEqual([assign.status, assign.body.changed], [200, 2]);
    assert.equal((await detail("owner", a.id)).body.lead.ownerName, "Asha Sales");
    assert.equal((await api("emp1", "/crm/leads/bulk", { method: "POST", body: { action: "assign", ids: [a.id], ownerId: id.emp2 } })).status, 403);
    const st = await api("emp1", "/crm/leads/bulk", { method: "POST", body: { action: "status", ids: [a.id, b.id], status: "interested" } });
    assert.equal(st.body.changed, 2);
    assert.equal((await api("emp1", "/crm/leads/bulk", { method: "POST", body: { action: "status", ids: [a.id], status: "lost" } })).status, 400);
    const del = await api("owner", "/crm/leads/bulk", { method: "POST", body: { action: "delete", ids: [a.id, b.id] } });
    assert.equal(del.body.changed, 2);
  });
});

describe("export", () => {
  test("CSV of the filtered list, safe against spreadsheet formulas, audited", async () => {
    await create("owner", { name: "Formula Lead", phone: phone(), city: "=HYPERLINK(1)" });
    const res = await fetch(s.base + "/crm/leads/export?q=Formula", { headers: { authorization: `Bearer ${t.owner}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    const text = await res.text();
    const [head, row] = text.replace(/^﻿/, "").split("\r\n");
    assert.ok(head.startsWith("Lead ID,Name,Phone"));
    assert.ok(row.includes("'=HYPERLINK(1)"));
    assert.equal((await fetch(s.base + "/crm/leads/export", { headers: { authorization: `Bearer ${t.emp1}` } })).status, 403);
    const logs = (await api("owner", "/crm/audit-logs?action=leads.exported")).body.logs;
    assert.equal(logs[0].meta.rows, 1);
  });
});

describe("convert to customer + application", () => {
  const convert = (key, leadId, body) => api(key, `/crm/leads/${leadId}/convert`, { method: "POST", body: { lenderId: "sbi", loanType: "home", loanAmount: 5000000, ...body } });

  test("only interested / docs pending / qualified leads convert", async () => {
    const lead = (await create("owner", { name: "Too Early", phone: phone(), ownerId: id.emp1 })).body.lead;
    const res = await convert("emp1", lead.id);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /New/);
  });

  test("creates a customer and an application, marks the lead converted, keeps its history", async () => {
    const p = phone();
    const lead = (await create("owner", { name: "Gurpreet Kulkarni", phone: p, email: "gk@example.com", city: "Pune", loanType: "personal", loanAmount: 900000, employment: "salaried", ownerId: id.emp1 })).body.lead;
    await api("emp1", `/crm/leads/${lead.id}/notes`, { method: "POST", body: { body: "Docs collected" } });
    await patch("emp1", lead.id, { status: "qualified" });

    assert.equal((await convert("emp2", lead.id)).status, 404, "another sales executive can't see emp1's lead");
    assert.equal((await convert("emp1", lead.id, { lenderId: "gone" })).status, 400, "inactive lender");
    const res = await convert("emp1", lead.id, { lenderId: "hdfc", loanType: "personal", loanAmount: 850000, tenureMonths: 48, note: "Priority file" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.application.ref, /^AVD/);
    assert.equal(res.body.customer.created, true);

    const d = (await detail("emp1", lead.id)).body;
    assert.equal(d.lead.status, "converted");
    assert.equal(d.lead.applicationRef, res.body.application.ref);
    assert.equal(d.customer.phone, p);
    assert.deepEqual(d.timeline.map((e) => e.type).slice(0, 1), ["converted"]);
    assert.ok(d.timeline.some((e) => e.type === "note" && e.body === "Docs collected"), "earlier history is kept");

    const app = (await s.pg.query("select * from applications where ref = $1", [res.body.application.ref])).rows[0];
    assert.equal(app.lead_id, lead.id);
    assert.equal(app.lender_name, "HDFC");
    assert.equal(app.loan_amount, 850000);
    assert.equal(app.tenure_months, 48);
    assert.equal(app.created_by, id.emp1);
    assert.equal(app.status, "submitted");
    const cust = (await s.pg.query("select name, email, role_id, profile from users where id = $1", [app.user_id])).rows[0];
    assert.deepEqual([cust.name, cust.email, cust.role_id, cust.profile.city], ["Gurpreet Kulkarni", "gk@example.com", null, "Pune"]);

    // Converted leads are locked: no second conversion, no edits, no delete — but notes still work.
    assert.equal((await convert("emp1", lead.id)).status, 409);
    assert.equal((await patch("emp1", lead.id, { city: "Nagpur" })).status, 409);
    assert.equal((await api("owner", `/crm/leads/${lead.id}`, { method: "DELETE" })).status, 409);
    assert.equal((await api("emp1", `/crm/leads/${lead.id}/notes`, { method: "POST", body: { body: "Sent to lender" } })).status, 201);
    assert.equal((await api("owner", "/crm/leads/bulk", { method: "POST", body: { action: "status", ids: [lead.id], status: "new" } })).body.changed, 0);
  });

  test("two conversions at the same moment produce exactly one application", async () => {
    const lead = (await create("owner", { name: "Race Lead", phone: phone(), ownerId: id.emp1 })).body.lead;
    await patch("emp1", lead.id, { status: "interested" });
    const results = await Promise.all([convert("emp1", lead.id), convert("owner", lead.id), convert("manager", lead.id)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    const n = (await s.pg.query("select count(*)::int as n from applications where lead_id = $1", [lead.id])).rows[0].n;
    assert.equal(n, 1);
  });

  test("an existing website customer with the same phone is reused, not duplicated", async () => {
    const p = phone();
    await s.pg.query(`insert into users (phone, name) values ($1, 'Web Customer')`, [p]);
    const lead = (await create("owner", { name: "Web Customer Lead", phone: p, ownerId: id.emp1 })).body.lead;
    await patch("emp1", lead.id, { status: "docs_pending" });
    const res = await convert("emp1", lead.id);
    assert.equal(res.status, 201);
    assert.equal(res.body.customer.created, false);
    assert.equal(res.body.customer.name, "Web Customer");
    assert.equal((await s.pg.query("select count(*)::int as n from users where phone = $1", [p])).rows[0].n, 1);
  });

  test("a staff member's phone or email can't become a customer; telecallers can't convert", async () => {
    const lead = (await create("owner", { name: "Staff Lookalike", phone: phone(), email: "emp2@avodah.test", ownerId: id.emp1 })).body.lead;
    await patch("emp1", lead.id, { status: "qualified" });
    const res = await convert("emp1", lead.id);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /staff/);
    const mine = (await create("tele", { name: "Tele Qualified", phone: phone() })).body.lead;
    await patch("tele", mine.id, { status: "qualified" });
    assert.equal((await convert("tele", mine.id)).status, 403);
  });

  test("conversion is audited and the dashboard counts the new application", async () => {
    const logs = (await api("owner", "/crm/audit-logs?action=lead.converted")).body.logs;
    assert.ok(logs.length >= 3);
    assert.match(logs[0].meta.application, /^AVD/);
    const dash = (await api("owner", "/crm/dashboard")).body;
    assert.ok(dash.statuses.total >= 3);
  });
});
