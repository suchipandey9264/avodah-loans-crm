import { z } from "zod";

// Mirrors backend/src/crm/validate.js so forms catch problems before the request. The backend still checks everything.

export const email = z.string().trim().toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Enter a valid email address");
export const newPassword = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Password is too long")
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/\d/, "Include at least one number");
export const personName = z.string().trim().min(2, "Enter the full name").max(80, "Name is too long");
export const phone = z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number");

export const PASSWORD_RULES = ["At least 10 characters", "At least one letter and one number"];

/** Runs a zod schema over form values; returns { data } or { fields } (first message per field). */
export function check(schema, values) {
  const r = schema.safeParse(values);
  if (r.success) return { data: r.data };
  const fields = {};
  for (const i of r.error.issues) fields[i.path.join(".")] ??= i.message;
  return { fields };
}
