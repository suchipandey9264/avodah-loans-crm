import { HttpError } from "../lib/http.js";
import { audit } from "./audit.js";
import { hasPermission } from "./permissions.js";

/** 401 unless the request carries a live staff session (set by lib/http.js `session`). */
export function requireStaff(req, _res, next) {
  if (!req.staff) return next(new HttpError(401, "Please sign in to the CRM"));
  next();
}

/** 403 unless the signed-in staff member's role grants one of `perms` ("module.action"). Denials are audited. */
export const can = (...perms) => async (req, _res, next) => {
  if (!req.staff) return next(new HttpError(401, "Please sign in to the CRM"));
  if (perms.some((p) => hasPermission(req.staff.permissions, p))) return next();
  await audit(req, "permission.denied", { meta: { permission: perms.join(" | "), method: req.method, path: req.originalUrl.split("?")[0] } });
  next(new HttpError(403, "You don’t have permission to do that"));
};
