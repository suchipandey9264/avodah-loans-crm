import { timelineEvents } from "../db/schema.js";
import { hasPermission } from "./permissions.js";

// Customers are `users` rows without a role. Their personal, address and employment details live in
// users.profile under the same keys the website dashboard uses, so a change on either side shows on both.

/** Roles without customers.edit see PAN masked and can't download documents (KYC data stays with those who work it). */
export const seesSensitive = (staff) => hasPermission(staff.permissions, "customers.kyc");
export const maskPan = (pan) => (pan && pan.length === 10 ? `${pan.slice(0, 2)}XXXXX${pan.slice(-3)}` : pan ?? null);

const PROFILE_KEYS = ["dob", "gender", "marital", "pan", "aadhaarLast4", "alternatePhone", "address", "city", "state", "pincode", "emp", "permanentSame"];
const PERMANENT = { permanentAddress: "address", permanentCity: "city", permanentState: "state", permanentPincode: "pincode" };

/**
 * Merges validated CRM fields into an existing profile without dropping any website-only keys.
 * `undefined` = untouched, `null` = cleared. Returns { profile, changed: [field names] }.
 */
export function mergeProfile(current = {}, body) {
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const next = { ...current, employment: { ...obj(current.employment) }, permanentAddress: { ...obj(current.permanentAddress) } };
  const changed = [];
  const set = (obj, key, value, label) => {
    if (value === undefined || obj[key] === value || (obj[key] == null && value === null)) return;
    if (value === null) delete obj[key];
    else obj[key] = value;
    changed.push(label);
  };
  for (const k of PROFILE_KEYS) set(next, k, body[k], k);
  for (const [k, inner] of Object.entries(PERMANENT)) set(next.permanentAddress, inner, body[k], k);
  set(next.employment, "company", body.company, "company");
  set(next.employment, "annualIncome", body.annualIncome, "annualIncome");
  // The website shows its own copies of these on the profile form.
  for (const k of ["name", "phone", "email"]) if (body[k] !== undefined && next[k] !== undefined) set(next, k, body[k], `profile.${k}`);
  if (!Object.keys(next.employment).length) delete next.employment;
  if (!Object.keys(next.permanentAddress).length) delete next.permanentAddress;
  return { profile: next, changed: changed.filter((c) => !c.startsWith("profile.")) };
}

/** The customer as the CRM sees it. */
export function customerView(u, { sensitive, rmName = null, createdByName = null } = {}) {
  const p = u.profile ?? {};
  const perm = p.permanentAddress ?? {};
  return {
    id: u.id,
    code: u.customerCode,
    name: u.name ?? "",
    phone: u.phone,
    email: u.email,
    alternatePhone: p.alternatePhone ?? null,
    dob: p.dob ?? null,
    gender: p.gender ?? null,
    marital: p.marital ?? null,
    pan: sensitive ? p.pan ?? null : maskPan(p.pan),
    panMasked: !sensitive && Boolean(p.pan),
    aadhaarLast4: p.aadhaarLast4 ?? null,
    address: p.address ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    pincode: p.pincode ?? null,
    permanentSame: p.permanentSame ?? null,
    permanentAddress: perm.address ?? null,
    permanentCity: perm.city ?? null,
    permanentState: perm.state ?? null,
    permanentPincode: perm.pincode ?? null,
    emp: p.emp ?? null,
    company: p.employment?.company ?? null,
    annualIncome: p.employment?.annualIncome != null && p.employment.annualIncome !== "" ? Number(p.employment.annualIncome) : null,
    kycStatus: u.kycStatus,
    creditScore: u.creditScore,
    creditScoreUpdatedAt: u.creditScoreUpdatedAt,
    relationshipManagerId: u.relationshipManagerId,
    relationshipManagerName: rmName,
    createdByName,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export const customerEvent = (tx, customerId, type, actorId, { body = null, meta = {} } = {}) =>
  tx.insert(timelineEvents).values({ entityType: "customer", entityId: customerId, type, actorId, body, meta });

/** Accepts PDF, JPEG and PNG by their actual bytes (not the extension or the browser's claim). */
export function sniffMime(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}
