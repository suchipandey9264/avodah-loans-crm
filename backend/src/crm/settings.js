import { eq, sql } from "drizzle-orm";
import { appSettings } from "../db/schema.js";
import { db } from "../lib/db.js";

// Settings → General. Stored as one JSON row ("general") in app_settings; missing keys fall back to these defaults.
export const GENERAL_DEFAULTS = {
  companyName: "AvodahLoans",
  notificationEmail: null,
  leadAssignment: "manual", // manual = website leads wait in the unassigned pool; auto = fewest open leads
  followupReminderMinutes: 60, // the bell shows a follow-up this long before it's due
};

export async function getGeneral(tx = db) {
  const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, "general")).limit(1);
  return { ...GENERAL_DEFAULTS, ...row?.value, updatedAt: row?.updatedAt ?? null };
}

export async function saveGeneral(changes, actorId) {
  const [row] = await db
    .insert(appSettings)
    .values({ key: "general", value: changes, updatedBy: actorId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`${appSettings.value} || ${JSON.stringify(changes)}::jsonb`, updatedBy: actorId, updatedAt: new Date() } })
    .returning();
  return { ...GENERAL_DEFAULTS, ...row.value, updatedAt: row.updatedAt };
}

/** Per-user bell preferences (users.profile.notificationPrefs); everything is on by default. */
export const NOTIFICATION_TYPES = ["leads", "applications", "followups", "security"];
export const notificationPrefs = (profile) => Object.fromEntries(NOTIFICATION_TYPES.map((k) => [k, profile?.notificationPrefs?.[k] !== false]));
