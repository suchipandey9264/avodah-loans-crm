// CRM authentication, sessions, RBAC and audit logging — against a real server and a throwaway PostgreSQL.
// Run: npm test   (from backend/)
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startStack } from "./harness.js";

const ADMIN = { email: "owner@avodah.test", password: "Owner-pass-2026" };
const PW = "Strong-pass-123";

let s;
const login = async (email, password = PW, ip) => s.api("/crm/auth/login", { method: "POST", body: { email, password }, ip });
const tokenFor = async (email, password = PW) => {
  const res = await login(email, password);
  assert.equal(res.status, 200, `login ${email}: ${JSON.stringify(res.body)}`);
  return res.body.token;
};
const createUser = async (token, user) => s.api("/crm/users", { method: "POST", token, body: { password: PW, ...user } });
const auditActions = async (token, query = "") =>
  (await s.api(`/crm/audit-logs?pageSize=100${query}`, { token })).body.logs.map((l) => l.action);

let owner; // admin token (from the crm-admin script)
const ids = {};

before(async () => {
  s = await startStack();
  const out = await s.run(["src/scripts/crm-admin.js", ADMIN.email, "Owner Name"], { CRM_ADMIN_PASSWORD: ADMIN.password });
  assert.match(out, /Created Admin/);
  owner = await tokenFor(ADMIN.email, ADMIN.password);
  for (const [key, roleId] of [["admin", "admin"], ["manager", "manager"], ["ops", "credit_analyst"], ["telecaller", "telecaller"], ["employee", "employee"], ["viewer", "viewer"]]) {
    const res = await createUser(owner, { name: `Test ${key}`, email: `${key}@avodah.test`, roleId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ids[key] = res.body.user.id;
  }
});
after(() => s?.stop());

describe("existing website API still works", () => {
  test("health, lender list and customer OTP login", async () => {
    assert.deepEqual((await s.api("/health")).body, { ok: true, db: true });
    assert.equal((await s.api("/lenders")).status, 200);
    const otp = await s.api("/auth/otp", { method: "POST", body: { phone: "9876543210" } });
    assert.equal(otp.status, 200);
    const verify = await s.api("/auth/verify", { method: "POST", body: { phone: "9876543210", otp: otp.body.devOtp } });
    assert.equal(verify.status, 200);
    assert.equal((await s.api("/auth/me", { token: verify.body.token })).status, 200);
    assert.equal((await s.api("/me/activity", { token: verify.body.token })).status, 200);
  });
});

describe("login and logout", () => {
  test("wrong password and unknown email get the same 401", async () => {
    const wrong = await login(ADMIN.email, "nope-nope-1");
    const unknown = await login("ghost@avodah.test", "nope-nope-1");
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error, unknown.body.error);
  });

  test("bad input is rejected with field errors", async () => {
    const res = await s.api("/crm/auth/login", { method: "POST", body: { email: "not-an-email", password: "" } });
    assert.equal(res.status, 400);
    assert.ok(res.body.fields.email);
  });

  test("successful login returns a token, role and permissions — never the password hash", async () => {
    const res = await login(ADMIN.email, ADMIN.password);
    assert.equal(res.status, 200);
    assert.match(res.body.token, /^[a-f0-9]{64}$/);
    assert.equal(res.body.user.role.id, "admin");
    assert.ok(res.body.user.permissions.includes("users.edit") && res.body.user.permissions.includes("settings.edit"));
    assert.equal(JSON.stringify(res.body).includes("scrypt"), false);
    const me = await s.api("/crm/auth/me", { token: res.body.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, ADMIN.email);
    assert.equal("passwordHash" in me.body.user, false);
    assert.deepEqual(me.body.policy, { idleMinutes: 60, sessionHours: 12, minPasswordLength: 10, lockoutAttempts: 5, lockoutMinutes: 15, resetLinkMinutes: 30 });
  });

  test("missing or forged token is 401", async () => {
    assert.equal((await s.api("/crm/auth/me")).status, 401);
    assert.equal((await s.api("/crm/auth/me", { token: "f".repeat(64) })).status, 401);
  });

  test("logout ends the session", async () => {
    const token = await tokenFor("viewer@avodah.test");
    assert.equal((await s.api("/crm/auth/logout", { method: "POST", token })).status, 200);
    assert.equal((await s.api("/crm/auth/me", { token })).status, 401);
  });

  test("email is case-insensitive", async () => {
    assert.equal((await login("VIEWER@Avodah.test")).status, 200);
  });
});

describe("customer and staff sessions are kept apart", () => {
  test("a customer OTP token can't open the CRM, and a staff token can't act as a customer", async () => {
    // Customer OTP login with a staff member's email (OTP_DEMO accepts any code) must not reach the CRM.
    const otp = await s.api("/auth/otp", { method: "POST", body: { email: "employee@avodah.test" } });
    const cust = await s.api("/auth/verify", { method: "POST", body: { email: "employee@avodah.test", otp: otp.body.devOtp } });
    assert.equal(cust.status, 200);
    assert.equal((await s.api("/crm/auth/me", { token: cust.body.token })).status, 401);
    assert.equal((await s.api("/crm/users", { token: cust.body.token })).status, 401);

    const staff = await tokenFor("employee@avodah.test");
    assert.equal((await s.api("/auth/me", { token: staff })).status, 401);
    assert.equal((await s.api("/me/activity", { token: staff })).status, 401);
  });

  test("a website customer can't sign in to the CRM or appear in its user list", async () => {
    const otp = await s.api("/auth/otp", { method: "POST", body: { email: "buyer@example.com" } });
    await s.api("/auth/verify", { method: "POST", body: { email: "buyer@example.com", otp: otp.body.devOtp } });
    assert.equal((await login("buyer@example.com", "Anything-123")).status, 401);
    assert.equal((await s.api("/crm/users?q=buyer@example.com", { token: owner })).body.total, 0);
  });
});

describe("role-based access control (checked on the backend)", () => {
  test("each role sees exactly its own permissions", async () => {
    const me = async (email) => (await s.api("/crm/auth/me", { token: await tokenFor(email) })).body.user;
    const emp = await me("employee@avodah.test");
    assert.equal(emp.role.id, "employee");
    assert.ok(emp.permissions.includes("leads.create"));
    assert.ok(!emp.permissions.includes("leads.delete"));
    assert.ok(!emp.permissions.includes("users.view"));
    const viewer = await me("viewer@avodah.test");
    assert.deepEqual(viewer.permissions.sort(), ["dashboard.view", "reports.view"]);
  });

  test("users list: admin and manager yes; credit analyst, telecaller, employee and viewer no", async () => {
    for (const [who, status] of [["admin", 200], ["manager", 200], ["ops", 403], ["telecaller", 403], ["employee", 403], ["viewer", 403]]) {
      const res = await s.api("/crm/users", { token: await tokenFor(`${who}@avodah.test`) });
      assert.equal(res.status, status, `${who} → GET /crm/users`);
    }
  });

  test("creating users: manager can't; admin can create any role, other admins included; there is no super admin role", async () => {
    const manager = await tokenFor("manager@avodah.test");
    assert.equal((await createUser(manager, { name: "Nope Person", email: "x1@avodah.test", roleId: "employee" })).status, 403);

    const admin = await tokenFor("admin@avodah.test");
    assert.equal((await createUser(admin, { name: "Sales Person", email: "sales2@avodah.test", roleId: "employee" })).status, 201);
    const peer = await createUser(admin, { name: "Peer Admin", email: "x2@avodah.test", roleId: "admin" });
    assert.equal(peer.status, 201);
    ids.peer = peer.body.user.id;
    assert.equal((await createUser(admin, { name: "Big Boss", email: "x3@avodah.test", roleId: "super_admin" })).status, 400, "role no longer exists");
    assert.equal((await s.pg.query("select count(*)::int n from roles where id = 'super_admin'")).rows[0].n, 0);
    assert.equal((await createUser(admin, { name: "Bad Role", email: "x4@avodah.test", roleId: "wizard" })).status, 400);
  });

  test("admin manages other admins; a manager can't touch an admin; nobody changes their own role or status", async () => {
    const admin = await tokenFor("admin@avodah.test");
    const ownerId = (await s.api("/crm/auth/me", { token: owner })).body.user.id;
    assert.equal((await s.api(`/crm/users/${ids.peer}`, { method: "PATCH", token: admin, body: { status: "suspended" } })).status, 200);
    assert.equal((await s.api(`/crm/users/${ids.peer}/sessions`, { method: "DELETE", token: admin })).status, 200);
    assert.equal((await s.api(`/crm/users/${ids.admin}`, { method: "PATCH", token: await tokenFor("manager@avodah.test"), body: { status: "suspended" } })).status, 403);
    assert.equal((await s.api(`/crm/users/${ids.admin}`, { method: "PATCH", token: admin, body: { roleId: "viewer" } })).status, 403);
    assert.equal((await s.api(`/crm/users/${ownerId}`, { method: "PATCH", token: owner, body: { roleId: "viewer" } })).status, 403);
  });

  test("duplicate emails are refused, including a website customer's", async () => {
    assert.equal((await createUser(owner, { name: "Dup Person", email: "viewer@avodah.test", roleId: "viewer" })).status, 409);
    const otp = await s.api("/auth/otp", { method: "POST", body: { email: "shopper@example.com" } });
    await s.api("/auth/verify", { method: "POST", body: { email: "shopper@example.com", otp: otp.body.devOtp } });
    const res = await createUser(owner, { name: "Shopper Person", email: "shopper@example.com", roleId: "viewer" });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /customer/);
  });

  test("weak passwords are rejected", async () => {
    const res = await createUser(owner, { name: "Weak Person", email: "weak@avodah.test", roleId: "viewer", password: "short1" });
    assert.equal(res.status, 400);
    assert.ok(res.body.fields.password);
  });

  test("changing a role takes effect immediately: old sessions end, new login has new permissions", async () => {
    const res = await createUser(owner, { name: "Role Changer", email: "rolechange@avodah.test", roleId: "employee" });
    const token = await tokenFor("rolechange@avodah.test");
    const patch = await s.api(`/crm/users/${res.body.user.id}`, { method: "PATCH", token: owner, body: { roleId: "manager" } });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.sessionsSignedOut, 1);
    assert.equal((await s.api("/crm/auth/me", { token })).status, 401);
    const fresh = await tokenFor("rolechange@avodah.test");
    assert.equal((await s.api("/crm/users", { token: fresh })).status, 200);
  });

  test("suspending a user signs them out and blocks sign-in; reactivating restores it", async () => {
    const res = await createUser(owner, { name: "Suspend Me", email: "suspend@avodah.test", roleId: "employee" });
    const token = await tokenFor("suspend@avodah.test");
    await s.api(`/crm/users/${res.body.user.id}`, { method: "PATCH", token: owner, body: { status: "suspended" } });
    assert.equal((await s.api("/crm/auth/me", { token })).status, 401);
    const blocked = await login("suspend@avodah.test");
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error, /suspended/);
    assert.equal((await login("suspend@avodah.test", "Wrong-pass-999")).status, 401); // wrong password doesn't reveal suspension
    await s.api(`/crm/users/${res.body.user.id}`, { method: "PATCH", token: owner, body: { status: "active" } });
    assert.equal((await login("suspend@avodah.test")).status, 200);
  });

  test("denied requests are written to the audit log", async () => {
    await s.api("/crm/audit-logs", { token: await tokenFor("viewer@avodah.test") });
    const logs = (await s.api("/crm/audit-logs?action=permission.denied", { token: owner })).body.logs;
    assert.ok(logs.some((l) => l.actorEmail === "viewer@avodah.test" && l.meta.permission === "audit.view"));
  });
});

describe("account lockout and rate limits", () => {
  test("5 wrong passwords lock the account for 15 minutes, even for the right password", async () => {
    await createUser(owner, { name: "Lock Me", email: "lock@avodah.test", roleId: "viewer" });
    for (let i = 0; i < 5; i++) assert.equal((await login("lock@avodah.test", "Wrong-pass-999")).status, 401);
    const res = await login("lock@avodah.test");
    assert.equal(res.status, 429);
    assert.match(res.body.error, /Try again in 15 minutes/);
    const list = (await s.api("/crm/users?q=lock@avodah.test", { token: owner })).body.users;
    assert.equal(list[0].locked, true);
  });

  test("more than 20 sign-in attempts from one IP in 15 minutes are throttled", async () => {
    let last;
    for (let i = 0; i < 21; i++) last = await login("ghost@avodah.test", "Wrong-pass-999", "10.99.0.1");
    assert.equal(last.status, 429);
  });
});

describe("forgot and reset password", () => {
  test("forgot gives the same reply for known and unknown emails", async () => {
    const known = await s.api("/crm/auth/forgot", { method: "POST", body: { email: "manager@avodah.test" } });
    const unknown = await s.api("/crm/auth/forgot", { method: "POST", body: { email: "nobody@avodah.test" } });
    assert.equal(known.status, 200);
    assert.deepEqual(known.body, unknown.body);
  });

  test("reset link works once, signs out old sessions, and the new password signs in", async () => {
    await createUser(owner, { name: "Forgetful Person", email: "forgot@avodah.test", roleId: "employee" });
    const oldSession = await tokenFor("forgot@avodah.test");
    const mark = s.logs.length;
    await s.api("/crm/auth/forgot", { method: "POST", body: { email: "forgot@avodah.test" } });
    const link = new URL((await s.waitForLog(/Password reset for .*forgot@avodah\.test/, mark)).match(/http\S+/)[0]);
    const uid = link.searchParams.get("uid");
    const token = link.searchParams.get("token");

    const wrong = await s.api("/crm/auth/reset", { method: "POST", body: { uid, token: "0".repeat(64), password: "Brand-new-pass-1" } });
    assert.equal(wrong.status, 400);
    const weak = await s.api("/crm/auth/reset", { method: "POST", body: { uid, token, password: "weak" } });
    assert.equal(weak.status, 400);

    const ok = await s.api("/crm/auth/reset", { method: "POST", body: { uid, token, password: "Brand-new-pass-1" } });
    assert.equal(ok.status, 200);
    assert.equal((await s.api("/crm/auth/me", { token: oldSession })).status, 401);
    assert.equal((await s.api("/crm/auth/reset", { method: "POST", body: { uid, token, password: "Another-pass-22" } })).status, 400);
    assert.equal((await login("forgot@avodah.test")).status, 401);
    assert.equal((await login("forgot@avodah.test", "Brand-new-pass-1")).status, 200);
  });

  test("a reset clears an account lockout", async () => {
    const mark = s.logs.length;
    await s.api("/crm/auth/forgot", { method: "POST", body: { email: "lock@avodah.test" } });
    const link = new URL((await s.waitForLog(/lock@avodah\.test/, mark)).match(/http\S+/)[0]);
    await s.api("/crm/auth/reset", { method: "POST", body: { uid: link.searchParams.get("uid"), token: link.searchParams.get("token"), password: "Unlocked-pass-1" } });
    assert.equal((await login("lock@avodah.test", "Unlocked-pass-1")).status, 200);
  });

  test("invited users can't sign in until they set a password from the invite link", async () => {
    const mark = s.logs.length;
    const res = await s.api("/crm/users", { method: "POST", token: owner, body: { name: "New Joiner", email: "invite@avodah.test", roleId: "employee" } });
    assert.equal(res.status, 201);
    assert.equal(res.body.invited, true);
    assert.equal((await login("invite@avodah.test", "Anything-123")).status, 401);
    const link = new URL((await s.waitForLog(/Invite for .*invite@avodah\.test/, mark)).match(/http\S+/)[0]);
    assert.equal(link.searchParams.get("invite"), "1");
    await s.api("/crm/auth/reset", { method: "POST", body: { uid: link.searchParams.get("uid"), token: link.searchParams.get("token"), password: "My-first-pass-1" } });
    assert.equal((await login("invite@avodah.test", "My-first-pass-1")).status, 200);
  });
});

describe("session management", () => {
  test("list my sessions, revoke one by id, revoke all others", async () => {
    await createUser(owner, { name: "Many Devices", email: "devices@avodah.test", roleId: "employee" });
    const a = await tokenFor("devices@avodah.test");
    const b = await tokenFor("devices@avodah.test");
    const c = await tokenFor("devices@avodah.test");
    const list = (await s.api("/crm/auth/sessions", { token: a })).body.sessions;
    assert.equal(list.length, 3);
    assert.equal(list.filter((x) => x.current).length, 1);
    assert.equal("tokenHash" in list[0], false);

    const bId = (await s.api("/crm/auth/sessions", { token: b })).body.sessions.find((x) => x.current).id;
    assert.equal((await s.api(`/crm/auth/sessions/${bId}`, { method: "DELETE", token: a })).status, 200);
    assert.equal((await s.api("/crm/auth/me", { token: b })).status, 401);

    const revoked = await s.api("/crm/auth/sessions", { method: "DELETE", token: a });
    assert.equal(revoked.body.signedOut, 1);
    assert.equal((await s.api("/crm/auth/me", { token: c })).status, 401);
    assert.equal((await s.api("/crm/auth/me", { token: a })).status, 200);
  });

  test("can't revoke someone else's session", async () => {
    const mine = await tokenFor("manager@avodah.test");
    const theirId = (await s.api("/crm/auth/sessions", { token: owner })).body.sessions[0].id;
    assert.equal((await s.api(`/crm/auth/sessions/${theirId}`, { method: "DELETE", token: mine })).status, 404);
  });

  test("change password: wrong current is refused; success keeps this session and ends the others", async () => {
    await createUser(owner, { name: "Pass Changer", email: "change@avodah.test", roleId: "employee" });
    const a = await tokenFor("change@avodah.test");
    const b = await tokenFor("change@avodah.test");
    const bad = await s.api("/crm/auth/password", { method: "POST", token: a, body: { currentPassword: "Wrong-pass-999", newPassword: "Changed-pass-1" } });
    assert.equal(bad.status, 400);
    const ok = await s.api("/crm/auth/password", { method: "POST", token: a, body: { currentPassword: PW, newPassword: "Changed-pass-1" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.otherSessionsSignedOut, 1);
    assert.equal((await s.api("/crm/auth/me", { token: a })).status, 200);
    assert.equal((await s.api("/crm/auth/me", { token: b })).status, 401);
    assert.equal((await login("change@avodah.test", "Changed-pass-1")).status, 200);
  });

  test("an idle session expires", async () => {
    const token = await tokenFor("viewer@avodah.test");
    await s.pg.query("update sessions set last_seen_at = now() - interval '2 hours' where kind = 'staff' and user_id = $1", [ids.viewer]);
    assert.equal((await s.api("/crm/auth/me", { token })).status, 401);
  });

  test("admin can sign a user out everywhere", async () => {
    const token = await tokenFor("ops@avodah.test");
    const res = await s.api(`/crm/users/${ids.ops}/sessions`, { method: "DELETE", token: owner });
    assert.equal(res.status, 200);
    assert.ok(res.body.signedOut >= 1);
    assert.equal((await s.api("/crm/auth/me", { token })).status, 401);
  });
});

describe("audit log", () => {
  test("records the important security actions", async () => {
    const actions = new Set([...(await auditActions(owner, "&action=auth.")), ...(await auditActions(owner, "&action=user.")), ...(await auditActions(owner, "&action=session."))]);
    for (const a of [
      "auth.login", "auth.login_failed", "auth.logout", "auth.account_locked", "auth.login_blocked",
      "auth.password_reset_requested", "auth.password_reset", "auth.password_changed", "auth.password_change_failed",
      "user.created", "user.role_changed", "user.suspended", "user.reactivated", "user.sessions_revoked", "user.admin_created_by_script",
      "session.revoked", "session.revoked_others",
    ]) assert.ok(actions.has(a), `missing audit action ${a}`);
  });

  test("entries carry actor, IP and user agent; filters work", async () => {
    const res = await s.api(`/crm/audit-logs?action=auth.login&actorId=${ids.manager}`, { token: owner });
    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 1);
    const log = res.body.logs[0];
    assert.equal(log.actorEmail, "manager@avodah.test");
    assert.equal(log.actorName, "Test manager");
    assert.match(log.ip, /^10\./);
    assert.ok(log.userAgent);
    assert.ok(res.body.logs.every((l) => l.action === "auth.login"));
  });

  test("user actions name the user they were about", async () => {
    const res = await s.api("/crm/audit-logs?action=user.role_changed", { token: owner });
    const log = res.body.logs.find((l) => l.targetEmail === "rolechange@avodah.test");
    assert.ok(log, "role change entry for rolechange@avodah.test");
    assert.equal(log.targetName, "Role Changer");
    assert.deepEqual(log.meta, { from: "employee", to: "manager" });
  });

  test("only roles with audit.view can read it", async () => {
    assert.equal((await s.api("/crm/audit-logs", { token: await tokenFor("admin@avodah.test") })).status, 200);
    assert.equal((await s.api("/crm/audit-logs", { token: await tokenFor("manager@avodah.test") })).status, 403);
  });
});

test("crm-admin script creates or resets an Admin", async () => {
  const out = await s.run(["src/scripts/crm-admin.js", "plain-admin@avodah.test", "Plain Admin"], { CRM_ADMIN_PASSWORD: "Plain-admin-2026" });
  assert.match(out, /Created Admin: plain-admin@avodah\.test/);
  assert.match(await s.run(["src/scripts/crm-admin.js", "plain-admin@avodah.test"], { CRM_ADMIN_PASSWORD: "Plain-admin-2026" }), /Updated Admin/);
  assert.equal((await s.pg.query("select role_id from users where email = 'plain-admin@avodah.test'")).rows[0].role_id, "admin");
});
