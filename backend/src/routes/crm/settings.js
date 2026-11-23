import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { users } from "../../db/schema.js";
import { audit } from "../../crm/audit.js";
import { can, requireStaff } from "../../crm/middleware.js";
import { getSettings, NOTIFICATION_TYPES, notificationPrefs, saveSettings } from "../../crm/settings.js";
import { db } from "../../lib/db.js";
import { email, parse } from "../../lib/validate.js";

// Settings → General and Website (organisation-wide, settings.view / settings.edit) and Settings → Notifications (each user's own).

const r = Router();
const generalBody = z
  .object({
    companyName: z.string().trim().min(2, "Enter the company name").max(100),
    notificationEmail: email.nullable(),
    leadAssignment: z.enum(["manual", "auto"]),
    followupReminderMinutes: z.coerce.number().int().refine((n) => [15, 30, 60, 120].includes(n), "Choose 15, 30, 60 or 120 minutes"),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");
// Shown on the public site's footer and Support page; null clears a field so the site falls back to its own value.
const optionalText = (max, msg) => z.string().trim().min(2, msg).max(max, `Keep this under ${max} characters`).nullable();
const websiteBody = z
  .object({
    phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{7,19}$/, "Enter a phone number, e.g. +91 98765 43210").nullable(),
    email: email.nullable(),
    city: optionalText(80, "Enter a city"),
    supportHours: optionalText(80, "Enter support hours, e.g. Mon–Sat, 9am–7pm"),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");
const prefsBody = z.object(Object.fromEntries(NOTIFICATION_TYPES.map((k) => [k, z.boolean()]))).partial();

for (const [key, schema] of [["general", generalBody], ["website", websiteBody]]) {
  r.get(`/settings/${key}`, can("settings.view"), async (_req, res) => {
    res.json({ settings: await getSettings(key) });
  });

  r.patch(`/settings/${key}`, can("settings.edit"), async (req, res) => {
    const body = parse(schema, req.body);
    const before = await getSettings(key);
    const settings = await saveSettings(key, body, req.staff.id);
    const changed = Object.keys(body).filter((k) => before[k] !== body[k]);
    if (changed.length) await audit(req, "settings.updated", { entityType: "settings", entityId: null, meta: { section: key, fields: changed, from: Object.fromEntries(changed.map((k) => [k, before[k]])), to: Object.fromEntries(changed.map((k) => [k, body[k]])) } });
    res.json({ settings });
  });
}

r.get("/notifications/preferences", requireStaff, (req, res) => {
  res.json({ preferences: notificationPrefs(req.staff.profile) });
});

r.put("/notifications/preferences", requireStaff, async (req, res) => {
  const body = parse(prefsBody, req.body);
  const preferences = { ...notificationPrefs(req.staff.profile), ...body };
  await db.update(users)
    .set({ profile: sql`${users.profile} || jsonb_build_object('notificationPrefs', ${JSON.stringify(preferences)}::jsonb)` })
    .where(eq(users.id, req.staff.id));
  res.json({ preferences });
});

export default r;
