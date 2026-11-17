import { z } from "zod";
import { HttpError } from "./http.js";

// Shared field rules for the CRM's request schemas (backend/src/crm/validate.js).

export const phone = z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number");
export const email = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Enter a valid email address");
export const personName = z
  .string()
  .trim()
  .min(2, "Enter your full name")
  .max(80, "Name is too long")
  .regex(/^[\p{L}][\p{L} .'-]*$/u, "Name can only contain letters, spaces and . ' -");
export const pan = z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN format: ABCDE1234F");
export const pincode = z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit pincode");

/** Parses `data` with `schema`, or throws a 400 with the first message plus every field's message. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid request", { fields });
}
