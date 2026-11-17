// CRM employees: same user records as Settings → Users, profile fields, figures, reassigning work, permissions.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startStack } from "./harness.js";

const PW = "Strong-pass-123";
let s;
const t = {};
const id = {};
const api = (key, path, opts = {}) => s.api(path, { ...opts, token: t[key] });

before(async () => {
  s = await startStack();
  await s.run(["src/scripts/crm-admin.js", "owner@avodah.test", "Owner Name"], { CRM_ADMIN_PASSWORD: "Owner-pass-2026" });
  t.owner = (await s.api("/crm/auth/login", { method: "POST", body: { email: "owner@avodah.test", password: "Owner-pass-2026" } })).body.token;
  for (const [key, name, role] of [["admin", "Ada Admin", "admin"], ["manager", "Meera Manager", "manager"], ["emp1", "Asha Sales", "employee"], ["emp2", "Bina Sales", "employee"]]) {
    const res = await api("owner", "/crm/users", { method: "POST", body: { name, email: `${key}@avodah.test`, roleId: role, password: PW } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    id[key] = res.body.user.id;
    t[key] = (await s.api("/crm/auth/login", { method: "POST", body: { email: `${key}@avodah.test`, password: PW } })).body.token;
  }
  await s.pg.exec(`insert into lenders (id, name, kind, active, products) values ('sbi','SBI','PSU Bank',true,'[{"type":"home","rate":8.5,"maxAmount":100000000,"maxTenure":30}]')`);
});
after(() => s?.stop());

describe("profiles", () => {
  test("add an employee with department, designation, branch, target and joining date — one user row", async () => {
    const res = await api("admin", "/crm/users", { method: "POST", body: {
      name: "Imran Sheikh", email: "imran@avodah.test", phone: "9820011003", roleId: "employee", password: PW,
      department: "Sales", designation: "Senior Executive", branch: "Delhi NCR", monthlyTarget: 15000000, joinedOn: "2022-01-10",
    } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    id.imran = res.body.user.id;
    assert.equal(res.body.user.branch, "Delhi NCR");
    assert.equal(res.body.user.monthlyTarget, 15000000);
    assert.equal((await s.pg.query("select count(*)::int n from users where email = 'imran@avodah.test'")).rows[0].n, 1);
    assert.ok((await api("admin", "/crm/users?q=Imran")).body.users.some((u) => u.id === id.imran), "same person in Settings → Users");
  });

  test("edit profile fields; the merge keeps other profile keys", async () => {
    await s.pg.query(`update users set profile = profile || '{"crmNotificationsSeenAt":"2026-01-01T00:00:00Z"}' where id = $1`, [id.imran]);
    const res = await api("admin", `/crm/users/${id.imran}`, { method: "PATCH", body: { designation: "Team Lead", monthlyTarget: 20000000, branch: null } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.user.designation, "Team Lead");
    assert.equal(res.body.user.branch, null);
    const p = (await s.pg.query("select profile from users where id = $1", [id.imran])).rows[0].profile;
    assert.equal(p.crmNotificationsSeenAt, "2026-01-01T00:00:00Z");
    assert.equal(p.department, "Sales");
  });

  test("validation: negative target, bad date", async () => {
    const res = await api("admin", `/crm/users/${id.imran}`, { method: "PATCH", body: { monthlyTarget: -5, joinedOn: "10/01/2022" } });
    assert.equal(res.status, 400);
    assert.ok(res.body.fields.monthlyTarget && res.body.fields.joinedOn, JSON.stringify(res.body));
  });
});

describe("listing and detail", () => {
  test("figures come from real leads, applications and follow-ups", async () => {
    const lead = (await api("manager", "/crm/leads", { method: "POST", body: { name: "Ravi Kumar", phone: "9876500001", source: "walk_in", ownerId: id.imran } })).body.lead;
    await api("manager", "/crm/leads", { method: "POST", body: { name: "Sona Rao", phone: "9876500002", source: "walk_in", ownerId: id.imran } });
    await s.pg.query(`update leads set status = 'converted' where id = $1`, [lead.id]);
    const cust = (await api("manager", "/crm/customers", { method: "POST", body: { name: "Kavya Iyer", phone: "9876500003" } })).body.customer;
    const app = await api("manager", "/crm/applications", { method: "POST", body: { customerId: cust.id, lenderId: "sbi", loanType: "home", loanAmount: 2500000, tenureMonths: 240, assignedTo: id.imran } });
    assert.equal(app.status, 201, JSON.stringify(app.body));
    await s.pg.query(`update applications set stage = 'disbursed', status = 'disbursed', disbursed_amount = 2400000, disbursed_at = now() where id = $1`, [app.body.application.id]);
    await s.pg.query(`insert into followups (lead_id, type, due_at, assigned_to) values ($1, 'call', now() - interval '1 hour', $2)`, [lead.id, id.imran]);

    const list = await api("manager", "/crm/employees");
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const e = list.body.employees.find((x) => x.id === id.imran);
    assert.deepEqual(
      { leads: e.stats.leads, openLeads: e.stats.openLeads, converted: e.stats.converted, conversion: e.stats.conversion, files: e.stats.files, disbursedMonth: e.stats.disbursedMonth, overdue: e.stats.overdueFollowups },
      { leads: 2, openLeads: 1, converted: 1, conversion: 0.5, files: 1, disbursedMonth: 2400000, overdue: 1 },
    );
    assert.equal(list.body.team.target, 20000000);
    assert.equal(list.body.team.achieved, 2400000);
    assert.ok(list.body.employees[0].role.rank >= list.body.employees.at(-1).role.rank, "sorted by role rank");
  });

  test("filters: search, role, status", async () => {
    assert.deepEqual((await api("manager", "/crm/employees?q=imran")).body.employees.map((e) => e.id), [id.imran]);
    assert.ok((await api("manager", "/crm/employees?role=employee")).body.employees.every((e) => e.role.id === "employee"));
    assert.equal((await api("manager", "/crm/employees?status=suspended")).body.employees.length, 0);
  });

  test("detail: open leads, open files and activity", async () => {
    const d = await api("manager", `/crm/employees/${id.imran}`);
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal(d.body.openLeads.length, 1);
    assert.equal(d.body.openApplications.length, 0, "the only file is disbursed");
    assert.ok(Array.isArray(d.body.activity));
    assert.equal((await api("manager", "/crm/employees/not-a-uuid")).status, 404);
  });
});

describe("reassign and permissions", () => {
  test("hand open leads to someone else, then deactivate", async () => {
    assert.equal((await api("manager", `/crm/employees/${id.imran}/reassign`, { method: "POST", body: { to: id.emp1, leads: true } })).status, 403, "managers only view employees");
    const res = await api("admin", `/crm/employees/${id.imran}/reassign`, { method: "POST", body: { to: id.emp1, leads: true, applications: true } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.moved, { leads: 1, applications: 0 });
    assert.equal((await api("admin", `/crm/employees/${id.imran}`)).body.employee.stats.openLeads, 0);
    const ev = (await s.pg.query(`select meta from timeline_events where type = 'assigned' and meta->>'bulk' = 'true' order by created_at desc limit 1`)).rows[0];
    assert.equal(ev.meta.to, id.emp1);
    assert.equal((await api("admin", `/crm/employees/${id.imran}/reassign`, { method: "POST", body: { to: id.imran, leads: true } })).status, 400);
    assert.equal((await api("admin", `/crm/users/${id.imran}`, { method: "PATCH", body: { status: "suspended" } })).status, 200);
    assert.equal((await api("admin", `/crm/employees/${id.emp1}/reassign`, { method: "POST", body: { to: id.imran, leads: true } })).status, 400, "not to an inactive employee");
  });

  test("sales executives can't open Employees or edit profiles", async () => {
    assert.equal((await api("emp1", "/crm/employees")).status, 403);
    assert.equal((await api("emp1", `/crm/users/${id.emp2}`, { method: "PATCH", body: { monthlyTarget: 1 } })).status, 403);
  });
});
