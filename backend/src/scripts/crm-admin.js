// Creates (or resets) a CRM Admin — use it once to get into the CRM, then add everyone else from Settings → Users.
// Run: npm run crm:admin -- admin@yourcompany.com "Full Name"
// Password: taken from CRM_ADMIN_PASSWORD if set, otherwise a strong one is generated and printed once.
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { auditLogs, users } from "../db/schema.js";
import { ensureSystemRoles, revokeStaffSessions } from "../crm/accounts.js";
import { newPassword } from "../crm/validate.js";
import { closeDB, connectDB, db } from "../lib/db.js";
import { hashPassword } from "../lib/password.js";
import { email as emailSchema } from "../lib/validate.js";

const [rawEmail, ...nameParts] = process.argv.slice(2);
const email = emailSchema.safeParse(rawEmail ?? "");
if (!email.success) {
  console.error('Usage: npm run crm:admin -- admin@yourcompany.com "Full Name"');
  process.exit(1);
}
const generated = !process.env.CRM_ADMIN_PASSWORD;
const password = process.env.CRM_ADMIN_PASSWORD ?? `${randomBytes(12).toString("base64url")}9a`;
const check = newPassword.safeParse(password);
if (!check.success) {
  console.error(`CRM_ADMIN_PASSWORD: ${check.error.issues[0].message}`);
  process.exit(1);
}

await connectDB();
await ensureSystemRoles();
const [existing] = await db.select().from(users).where(eq(users.email, email.data)).limit(1);
if (existing && !existing.roleId) {
  console.error(`${email.data} belongs to a customer account on the website. Use a different email for CRM staff.`);
  await closeDB();
  process.exit(1);
}
const values = { roleId: "admin", status: "active", passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null };
const name = nameParts.join(" ").trim();
const [user] = existing
  ? await db.update(users).set({ ...values, ...(name && { name }) }).where(eq(users.id, existing.id)).returning()
  : await db.insert(users).values({ email: email.data, name: name || "Administrator", ...values }).returning();
if (existing) await revokeStaffSessions(user.id);
await db.insert(auditLogs).values({ action: existing ? "user.admin_reset_by_script" : "user.admin_created_by_script", actorEmail: "cli", entityType: "user", entityId: user.id, meta: { email: user.email } });
await closeDB();

console.log(`${existing ? "Updated" : "Created"} Admin: ${user.email}`);
if (generated) console.log(`Temporary password (shown once — change it after signing in): ${password}`);
