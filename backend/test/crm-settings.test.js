// CRM Settings → General and Notifications: permissions, validation, audit, lead auto-assignment, bell preferences.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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
    id[key] = res.body.user.id;
    t[key] = (await s.api("/crm/auth/login", { method: "POST", body: { email: `${key}@avodah.test`, password: PW } })).body.token;
  }
});
after(() => s?.stop());

test("general settings: defaults, admin-only changes, validation, audit trail", async () => {
  const d = await api("admin", "/crm/settings/general");
  assert.equal(d.status, 200);
  assert.equal(d.body.settings.leadAssignment, "manual");
  assert.equal(d.body.settings.followupReminderMinutes, 60);
  assert.equal((await api("manager", "/crm/settings/general")).status, 403, "managers can't see organisation settings");
  assert.equal((await api("emp1", "/crm/settings/general", { method: "PATCH", body: { companyName: "X Co" } })).status, 403);
  const bad = await api("admin", "/crm/settings/general", { method: "PATCH", body: { companyName: "", notificationEmail: "nope", followupReminderMinutes: 7, leadAssignment: "random" } });
  assert.equal(bad.status, 400);
  for (const f of ["companyName", "notificationEmail", "followupReminderMinutes", "leadAssignment"]) assert.ok(bad.body.fields[f], f);
  const ok = await api("admin", "/crm/settings/general", { method: "PATCH", body: { companyName: "AvodahLoans Pvt. Ltd.", notificationEmail: "crm@avodahloans.in" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.settings.companyName, "AvodahLoans Pvt. Ltd.");
  assert.equal(ok.body.settings.leadAssignment, "manual", "untouched keys keep their value");
  const log = (await s.pg.query(`select meta from audit_logs where action = 'settings.updated' order by created_at desc limit 1`)).rows[0];
  assert.deepEqual(log.meta.fields.sort(), ["companyName", "notificationEmail"]);
});

test("notification preferences switch bell items off for that user only", async () => {
  await s.pg.query(`insert into leads (kind, name, phone, status) values ('crm', 'Bell Lead', '9833333333', 'new')`);
  assert.deepEqual((await api("manager", "/crm/notifications/preferences")).body.preferences, { leads: true, applications: true, followups: true, security: true });
  assert.ok((await api("manager", "/crm/notifications")).body.items.some((n) => n.type === "lead"));
  const put = await api("manager", "/crm/notifications/preferences", { method: "PUT", body: { leads: false } });
  assert.equal(put.status, 200);
  assert.equal(put.body.preferences.leads, false);
  assert.equal((await api("manager", "/crm/notifications")).body.items.filter((n) => n.type === "lead").length, 0);
  assert.ok((await api("admin", "/crm/notifications")).body.items.some((n) => n.type === "lead"), "other users unaffected");
  assert.equal((await api("manager", "/crm/notifications/preferences", { method: "PUT", body: { leads: "no" } })).status, 400);
  // The seen-at marker and the preferences share users.profile without overwriting each other.
  await api("manager", "/crm/notifications/seen", { method: "POST" });
  assert.equal((await api("manager", "/crm/notifications/preferences")).body.preferences.leads, false);
});

test("follow-up reminder window follows the setting", async () => {
  const lead = (await s.pg.query(`select id from leads where name = 'Bell Lead'`)).rows[0].id;
  await s.pg.query(`insert into followups (lead_id, type, due_at, assigned_to) values ($1, 'call', now() + interval '100 minutes', $2)`, [lead, id.emp2]);
  const due = async () => (await api("emp2", "/crm/notifications")).body.items.filter((n) => n.title === "Follow-up due soon").length;
  assert.equal(await due(), 0, "60-minute window by default");
  await api("admin", "/crm/settings/general", { method: "PATCH", body: { followupReminderMinutes: 120 } });
  assert.equal(await due(), 1);
});
