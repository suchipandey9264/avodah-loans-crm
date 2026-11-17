import { auditLogs } from "../db/schema.js";
import { db } from "../lib/db.js";

export const clientInfo = (req) => ({ ip: req.ip ?? null, userAgent: req.get("user-agent")?.slice(0, 300) ?? null });

/**
 * Records a security-relevant action. Never throws: a failed audit write is logged to the console
 * but does not fail the request it describes.
 * opts: { actor?: user row, actorEmail?, entityType?, entityId?, meta? } — actor defaults to req.staff.
 */
export async function audit(req, action, opts = {}) {
  const actor = opts.actor ?? req.staff ?? null;
  try {
    await db.insert(auditLogs).values({
      action,
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? opts.actorEmail ?? null,
      entityType: opts.entityType ?? null,
      entityId: opts.entityId != null ? String(opts.entityId) : null,
      meta: opts.meta ?? {},
      ...clientInfo(req),
    });
  } catch (err) {
    console.error(`[audit] could not record ${action}:`, err.message);
  }
}
