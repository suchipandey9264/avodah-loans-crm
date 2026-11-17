import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { users } from "../../db/schema.js";
import { audit } from "../../crm/audit.js";
import { can, requireStaff } from "../../crm/middleware.js";
import { getGeneral, NOTIFICATION_TYPES, notificationPrefs, saveGeneral } from "../../crm/settings.js";
import { db } from "../../lib/db.js";
import { email, parse } from "../../lib/validate.js";

// Settings → General (organisation-wide, settings.view / settings.edit) and Settings → Notifications (each user's own).

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
const prefsBody = z.object(Object.fromEntries(NOTIFICATION_TYPES.map((k) => [k, z.boolean()]))).partial();

r.get("/settings/general", can("settings.view"), async (_req, res) => {
  res.json({ settings: await getGeneral() });
});

r.patch("/settings/general", can("settings.edit"), async (req, res) => {
  const body = parse(generalBody, req.body);
  const before = await getGeneral();
  const settings = await saveGeneral(body, req.staff.id);
  const changed = Object.keys(body).filter((k) => before[k] !== body[k]);
  if (changed.length) await audit(req, "settings.updated", { entityType: "settings", entityId: null, meta: { fields: changed, from: Object.fromEntries(changed.map((k) => [k, before[k]])), to: Object.fromEntries(changed.map((k) => [k, body[k]])) } });
  res.json({ settings });
});

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
