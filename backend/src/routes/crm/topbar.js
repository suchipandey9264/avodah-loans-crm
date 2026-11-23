import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import { users } from "../../db/schema.js";
import { requireStaff } from "../../crm/middleware.js";
import { leadScopeSql } from "../../crm/leads.js";
import { hasPermission } from "../../crm/permissions.js";
import { getSettings, notificationPrefs } from "../../crm/settings.js";
import { searchQuery } from "../../crm/validate.js";
import { LOAN_TYPES } from "../../data/loans.js";
import { db } from "../../lib/db.js";
import { parse } from "../../lib/validate.js";

// The CRM top bar: global search and notifications. Both only include record types the role can view.

const r = Router();
const rows = async (query) => (await db.execute(query)).rows;
const typeLabel = (id) => LOAN_TYPES.find((t) => t.id === id)?.label ?? id;
const NOTIFY_DAYS = 14;

/** GET /api/crm/search?q= — up to 5 leads, customers and applications matching name, phone, email or reference. */
r.get("/search", requireStaff, async (req, res) => {
  const { q } = parse(searchQuery, req.query);
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const has = (p) => hasPermission(req.staff.permissions, p);
  const [leads, customers, applications] = await Promise.all([
    has("leads.view")
      ? rows(sql`select id, ref, kind, name, phone, email, status, created_at as "createdAt" from leads
                 where deleted_at is null and ${leadScopeSql(req.staff)}
                   and (name ilike ${like} or phone ilike ${like} or email ilike ${like} or ref ilike ${like})
                 order by created_at desc limit 5`)
      : null,
    has("customers.view")
      ? rows(sql`select id, customer_code as code, name, phone, email, created_at as "createdAt" from users
                 where role_id is null and (name ilike ${like} or phone ilike ${like} or email ilike ${like} or customer_code ilike ${like})
                 order by created_at desc limit 5`)
      : null,
    has("applications.view")
      ? rows(sql`select id, ref, contact->>'name' as name, contact->>'phone' as phone, lender_name as "lenderName", type,
                        loan_amount::float8 as "loanAmount", status, created_at as "createdAt" from applications
                 where ref ilike ${like} or contact->>'name' ilike ${like} or contact->>'phone' ilike ${like} or lender_name ilike ${like}
                 order by created_at desc limit 5`).then((list) => list.map((x) => ({ ...x, loanType: typeLabel(x.type) })))
      : null,
  ]);
  res.json({ q, leads, customers, applications });
});

/** GET /api/crm/notifications — recent events for this role; `unread` counts those newer than the last time the bell was opened. */
r.get("/notifications", requireStaff, async (req, res) => {
  const prefs = notificationPrefs(req.staff.profile); // Settings → Notifications switches types off per user
  const has = (p) => hasPermission(req.staff.permissions, p);
  const since = new Date(Date.now() - NOTIFY_DAYS * 86400000);
  const soon = new Date(Date.now() + (await getSettings("general")).followupReminderMinutes * 60000);
  const [leads, applications, locks, reminders] = await Promise.all([
    // handled: the old app marks leads handled without changing status. (No SQL `--` comment here: it would swallow the scope clause.)
    prefs.leads && has("leads.view")
      ? rows(sql`select id, kind, name, created_at as "createdAt" from leads
                 where status = 'new' and handled = false and deleted_at is null and ${leadScopeSql(req.staff)}
                   and created_at >= ${since} order by created_at desc limit 10`)
      : [],
    prefs.applications && has("applications.view")
      ? rows(sql`select id, ref, contact->>'name' as name, lender_name as "lenderName", type, created_at as "createdAt"
                 from applications where status = 'submitted' and created_at >= ${since} order by created_at desc limit 10`)
      : [],
    prefs.security && has("audit.view")
      ? rows(sql`select id, actor_email as email, created_at as "createdAt" from audit_logs
                 where action = 'auth.account_locked' and created_at >= ${since} order by created_at desc limit 5`)
      : [],
    // Reminders: my pending follow-ups due within the hour or already overdue (lead deleted → dropped unless on a customer).
    prefs.followups && has("followups.view")
      ? rows(sql`select f.id, f.type, f.due_at as "dueAt", coalesce(c.name, l.name) as name from followups f
                 left join leads l on l.id = f.lead_id left join users c on c.id = f.customer_id
                 where f.assigned_to = ${req.staff.id} and f.status = 'pending' and f.due_at >= ${since} and f.due_at < ${soon}
                   and (f.customer_id is not null or l.deleted_at is null)
                 order by f.due_at desc limit 10`)
      : [],
  ]);
  const now = new Date();
  const items = [
    ...leads.map((l) => ({ id: `lead:${l.id}`, leadId: l.id, type: "lead", title: { callback: "New callback request", "credit-report": "New credit report request" }[l.kind] ?? "New lead", body: l.name, createdAt: l.createdAt })),
    ...applications.map((x) => ({ id: `application:${x.id}`, type: "application", title: "New application to review", body: `${x.name ?? "Customer"} · ${typeLabel(x.type)} · ${x.lenderName ?? ""} (${x.ref})`, createdAt: x.createdAt })),
    ...reminders.map((x) => {
      const overdue = new Date(x.dueAt) < now;
      return { id: `followup:${x.id}`, type: "followup", to: `/follow-ups?view=${overdue ? "overdue" : "today"}`, title: overdue ? "Follow-up overdue" : "Follow-up due soon", body: `${x.name ?? "—"} · ${x.type}`, createdAt: x.dueAt };
    }),
    ...locks.map((x) => ({ id: `security:${x.id}`, type: "security", title: "Account locked after failed sign-ins", body: x.email, createdAt: x.createdAt })),
  ]
    .sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt))
    .slice(0, 20);
  const seenAt = new Date(req.staff.profile?.crmNotificationsSeenAt ?? req.staff.createdAt);
  res.json({ items, unread: items.filter((i) => new Date(i.createdAt) > seenAt).length, seenAt });
});

/** POST /api/crm/notifications/seen — marks everything up to now as read (stored in the user's profile). */
r.post("/notifications/seen", requireStaff, async (req, res) => {
  const seenAt = new Date().toISOString();
  await db
    .update(users)
    .set({ profile: sql`${users.profile} || jsonb_build_object('crmNotificationsSeenAt', ${seenAt}::text)` })
    .where(eq(users.id, req.staff.id));
  res.json({ ok: true, seenAt });
});

export default r;
