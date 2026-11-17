// CRM follow-ups: schedule for a lead or a customer, tabs & counts, scope, reschedule, complete, reminders, history.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startStack } from "./harness.js";

const PW = "Strong-pass-123";
let s;
const t = {};
const id = {};
const api = (key, path, opts = {}) => s.api(path, { ...opts, token: t[key] });
const list = (key, q = {}) => api(key, `/crm/followups?${new URLSearchParams(q)}`);
const schedule = (key, body) => api(key, "/crm/followups", { method: "POST", body: { type: "call", dueAt: inHours(2), ...body } });
const change = (key, fid, body) => api(key, `/crm/followups/${fid}`, { method: "PATCH", body });
const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
let lead, otherLead, customer;

before(async () => {
  s = await startStack();
  await s.run(["src/scripts/crm-admin.js", "owner@avodah.test", "Owner Name"], { CRM_ADMIN_PASSWORD: "Owner-pass-2026" });
  t.owner = (await s.api("/crm/auth/login", { method: "POST", body: { email: "owner@avodah.test", password: "Owner-pass-2026" } })).body.token;
  for (const [key, name, role] of [["manager", "Meera Manager", "manager"], ["emp1", "Asha Sales", "employee"], ["emp2", "Bina Sales", "employee"], ["viewer", "Vik Viewer", "viewer"]]) {
    const res = await api("owner", "/crm/users", { method: "POST", body: { name, email: `${key}@avodah.test`, roleId: role, password: PW } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    id[key] = res.body.user.id;
    t[key] = (await s.api("/crm/auth/login", { method: "POST", body: { email: `${key}@avodah.test`, password: PW } })).body.token;
  }
  lead = (await api("manager", "/crm/leads", { method: "POST", body: { name: "Ravi Lead", phone: "9876500001", source: "walk_in", ownerId: id.emp1 } })).body.lead;
  otherLead = (await api("manager", "/crm/leads", { method: "POST", body: { name: "Other Lead", phone: "9876500002", source: "walk_in", ownerId: id.emp2 } })).body.lead;
  const c = await api("manager", "/crm/customers", { method: "POST", body: { name: "Kavya Customer", phone: "9876500003", relationshipManagerId: id.emp2 } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  customer = c.body.customer;
});
after(() => s?.stop());

describe("schedule", () => {
  test("for a lead: defaults to the lead's owner and is logged on the lead", async () => {
    const res = await schedule("manager", { leadId: lead.id, note: "Discuss rate" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.followup.assignedTo, id.emp1);
    assert.equal(res.body.followup.leadId, lead.id);
    const tl = (await api("manager", `/crm/leads/${lead.id}`)).body.timeline.map((e) => e.type);
    assert.ok(tl.includes("followup_scheduled"));
  });

  test("for a customer: defaults to the relationship manager, shows on the customer profile", async () => {
    const res = await schedule("manager", { customerId: customer.id, type: "meeting", dueAt: inHours(30) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.followup.assignedTo, id.emp2);
    const d = (await api("manager", `/crm/customers/${customer.id}`)).body;
    assert.ok(d.followups.some((f) => f.id === res.body.followup.id && f.state === "pending"));
    assert.ok(d.history.some((e) => e.type === "followup_scheduled"));
  });

  test("validation: exactly one target, future time, real type, assignable employee", async () => {
    assert.equal((await schedule("manager", {})).body.fields.target !== undefined, true);
    assert.equal((await schedule("manager", { leadId: lead.id, customerId: customer.id })).status, 400);
    assert.ok((await schedule("manager", { leadId: lead.id, dueAt: "2020-01-01T00:00:00Z" })).body.fields.dueAt);
    assert.ok((await schedule("manager", { leadId: lead.id, type: "pigeon" })).body.fields.type);
    assert.equal((await schedule("manager", { leadId: lead.id, assignedTo: id.viewer })).status, 400, "viewers don't work follow-ups");
  });

  test("permissions: sales can't schedule for others or for leads outside their scope; viewers can't schedule", async () => {
    assert.equal((await schedule("emp1", { leadId: lead.id, assignedTo: id.emp2 })).status, 403);
    assert.equal((await schedule("emp1", { leadId: otherLead.id })).status, 400);
    assert.equal((await schedule("viewer", { leadId: lead.id })).status, 403);
    const mine = await schedule("emp1", { customerId: customer.id });
    assert.equal(mine.body.followup.assignedTo, id.emp1, "a sales executive's follow-up is theirs, not the RM's");
  });
});

describe("list, tabs and scope", () => {
  test("overdue, today, upcoming and completed buckets with counts", async () => {
    await s.pg.query(`insert into followups (lead_id, type, due_at, assigned_to) values ($1, 'call', now() - interval '2 hours', $2)`, [lead.id, id.emp1]);
    const all = (await list("manager")).body;
    assert.equal(all.counts.overdue, 1);
    assert.equal(all.counts.all, all.total);
    const overdue = (await list("manager", { view: "overdue" })).body;
    assert.equal(overdue.items.length, 1);
    assert.equal(overdue.items[0].state, "overdue");
    assert.equal(overdue.items[0].name, "Ravi Lead");
    assert.equal(overdue.items[0].assignedName, "Asha Sales");
    const upcoming = (await list("manager", { view: "upcoming" })).body.items;
    assert.ok(upcoming.every((f) => new Date(f.dueAt) > new Date()));
    assert.equal(all.completionRate, 0, "one overdue, none done in the last 30 days");
  });

  test("sales executives only see their own follow-ups", async () => {
    const mine = (await list("emp1")).body.items;
    assert.ok(mine.length > 0 && mine.every((f) => f.assignedTo === id.emp1));
    assert.ok((await list("emp2")).body.items.every((f) => f.assignedTo === id.emp2));
    assert.equal((await list("viewer")).status, 403, "the viewer role has no follow-ups access");
  });

  test("search and filters: name, customer code, type, assignee, date range, lead/customer", async () => {
    assert.ok((await list("manager", { q: "Kavya" })).body.items.every((f) => f.customerId === customer.id));
    assert.ok((await list("manager", { q: customer.code ?? customer.customerCode })).body.total >= 1);
    assert.ok((await list("manager", { type: "meeting" })).body.items.every((f) => f.type === "meeting"));
    assert.ok((await list("manager", { assignee: id.emp2 })).body.items.every((f) => f.assignedTo === id.emp2));
    assert.ok((await list("emp1", { assignee: "me" })).body.items.every((f) => f.assignedTo === id.emp1));
    assert.equal((await list("manager", { from: inHours(24), to: inHours(48) })).body.total, 1, "only the meeting tomorrow");
    assert.ok((await list("manager", { leadId: lead.id })).body.items.every((f) => f.leadId === lead.id));
  });

  test("follow-ups on a deleted lead drop out", async () => {
    const gone = (await api("manager", "/crm/leads", { method: "POST", body: { name: "Gone Lead", phone: "9876500009", source: "walk_in" } })).body.lead;
    await schedule("manager", { leadId: gone.id });
    assert.equal((await list("manager", { q: "Gone Lead" })).body.total, 1);
    await api("manager", `/crm/leads/${gone.id}`, { method: "DELETE" });
    assert.equal((await list("manager", { q: "Gone Lead" })).body.total, 0);
  });
});

describe("update and complete", () => {
  test("reschedule and reassign; history records the move", async () => {
    const fu = (await schedule("manager", { leadId: lead.id })).body.followup;
    const res = await change("manager", fu.id, { dueAt: inHours(50), assignedTo: id.emp2, note: "Moved to Friday" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.followup.assignedTo, id.emp2);
    assert.equal(res.body.followup.note, "Moved to Friday");
    const ev = (await api("manager", `/crm/leads/${lead.id}`)).body.timeline.find((e) => e.type === "followup_rescheduled");
    assert.ok(ev && ev.meta.followupId === fu.id);
    assert.equal((await change("emp1", fu.id, { dueAt: inHours(60) })).status, 404, "no longer theirs");
    assert.equal((await change("emp2", fu.id, { assignedTo: id.emp1 })).status, 403, "sales can't hand it on");
  });

  test("complete once; can't edit a closed follow-up; completion counts", async () => {
    const fu = (await schedule("emp1", { leadId: lead.id })).body.followup;
    assert.equal((await change("emp1", fu.id, { status: "done", dueAt: inHours(3) })).status, 400, "close or change, not both");
    const done = await change("emp1", fu.id, { status: "done", outcome: "Agreed to send papers" });
    assert.equal(done.status, 200);
    assert.equal(done.body.followup.state, "done");
    assert.equal((await change("emp1", fu.id, { status: "cancelled" })).status, 409);
    assert.equal((await change("emp1", fu.id, { dueAt: inHours(4) })).status, 409);
    const tab = (await list("emp1", { view: "done" })).body;
    assert.ok(tab.items.some((f) => f.id === fu.id && f.outcome === "Agreed to send papers"));
    const leadRow = (await s.pg.query("select last_contacted_at from leads where id = $1", [lead.id])).rows[0];
    assert.ok(leadRow.last_contacted_at, "completing marks the lead contacted");
    assert.equal((await change("viewer", fu.id, { status: "done" })).status, 403);
    assert.equal((await change("manager", "not-a-uuid", { status: "done" })).status, 404);
  });

  test("cancelling a customer follow-up is logged on the customer", async () => {
    const fu = (await schedule("manager", { customerId: customer.id })).body.followup;
    assert.equal((await change("manager", fu.id, { status: "cancelled", outcome: "Customer travelling" })).status, 200);
    const tl = (await api("manager", `/crm/customers/${customer.id}`)).body.history;
    assert.ok(tl.some((e) => e.type === "followup_cancelled"));
  });
});

describe("reminders", () => {
  test("the bell shows my overdue and due-within-the-hour follow-ups, linked to the tab", async () => {
    await schedule("emp1", { leadId: lead.id, dueAt: inHours(0.5) });
    await schedule("emp1", { leadId: lead.id, dueAt: inHours(5) });
    const items = (await api("emp1", "/crm/notifications")).body.items.filter((n) => n.type === "followup");
    assert.deepEqual(items.map((n) => n.title).sort(), ["Follow-up due soon", "Follow-up overdue"]);
    assert.ok(items.every((n) => n.to.startsWith("/follow-ups?view=")));
    assert.equal((await api("emp2", "/crm/notifications")).body.items.filter((n) => n.title === "Follow-up overdue").length, 0, "not someone else's");
  });
});
