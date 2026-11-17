import { isNull, or, eq, sql } from "drizzle-orm";
import { leads, timelineEvents } from "../db/schema.js";
import { db } from "../lib/db.js";
import { hasPermission } from "./permissions.js";

/**
 * Which leads a staff member works with. Roles that can assign leads (managers, admins) see all of them;
 * everyone else sees leads assigned to them plus the unassigned pool.
 */
export const seesAllLeads = (staff) => hasPermission(staff.permissions, "leads.assign");
export const leadScope = (staff) => (seesAllLeads(staff) ? undefined : or(eq(leads.ownerId, staff.id), isNull(leads.ownerId)));
/** The same rule as raw SQL for hand-written queries (table alias `leads`). */
export const leadScopeSql = (staff) => (seesAllLeads(staff) ? sql`true` : sql`(leads.owner_id = ${staff.id} or leads.owner_id is null)`);

export const STATUS_LABELS = {
  new: "New", contacted: "Contacted", interested: "Interested", docs_pending: "Docs pending",
  qualified: "Qualified", converted: "Converted", lost: "Lost",
};
export const SOURCE_LABELS = {
  website: "Website", walk_in: "Walk-in", call_centre: "Call centre", referral: "Referral",
  partner_dsa: "Partner DSA", facebook_ads: "Facebook Ads", google_ads: "Google Ads", other: "Other",
};
/** A lead in one of these stages can be converted into a customer + application. */
export const CONVERTIBLE = ["interested", "docs_pending", "qualified"];
export const OPEN = ["new", "contacted", "interested", "docs_pending", "qualified"];

/** Appends one history entry for a lead. */
export const leadEvent = (tx, leadId, type, actorId, { body = null, meta = {} } = {}) =>
  tx.insert(timelineEvents).values({ entityType: "lead", entityId: leadId, type, actorId, body, meta });

/** "Auto": the front-line employee (can edit leads, can't assign them) with the fewest open leads. */
export async function autoOwner(tx = db) {
  const { rows } = await tx.execute(sql`
    select u.id, u.name from users u join roles r on r.id = u.role_id
    where u.status = 'active' and r.permissions @> '["leads.edit"]'
      and not (r.permissions @> '["leads.assign"]') and not (r.permissions @> '["*"]')
    order by (select count(*) from leads l where l.owner_id = u.id and l.deleted_at is null and l.status in ('new','contacted','interested','docs_pending','qualified')) asc,
             (select max(assigned_at) from leads l where l.owner_id = u.id) asc nulls first, u.name asc
    limit 1`);
  return rows[0] ?? null;
}
