import { z } from "zod";
import { APPLICATION_STAGES, DOCUMENT_STATUSES, DOCUMENT_TYPES, LENDER_KINDS, FOLLOWUP_TYPES, KYC_STATUSES, LEAD_SOURCES, LEAD_STATUSES, USER_STATUSES } from "../db/schema.js";
import { EMPLOYMENT, LOAN_TYPES } from "../data/loans.js";
import { email, pan, personName, phone, pincode } from "../lib/validate.js";

// Request schemas for the CRM API. Keep the password rule in sync with crm/src/lib/validation.js.

export const newPassword = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Password is too long")
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/\d/, "Include at least one number");

export const loginBody = z.object({ email, password: z.string().min(1, "Enter your password").max(128) });
export const forgotBody = z.object({ email });
export const resetBody = z.object({ uid: z.uuid("Invalid reset link"), token: z.string().regex(/^[a-f0-9]{64}$/, "Invalid reset link"), password: newPassword });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1, "Enter your current password").max(128), newPassword });

const roleId = z.string().trim().min(1, "Choose a role").max(40);
/** Employee profile, kept in users.profile (staff rows only). null clears a field. */
const workText = z.string().trim().max(60).nullable();
export const employeeProfile = {
  department: workText,
  designation: workText,
  branch: workText,
  monthlyTarget: z.coerce.number().min(0, "Target can’t be negative").max(1e11).nullable(),
  joinedOn: z.iso.date("Use a valid date").nullable(),
};
export const createUserBody = z.object({
  ...Object.fromEntries(Object.entries(employeeProfile).map(([k, v]) => [k, v.optional()])),
  name: personName,
  email,
  phone: phone.optional(),
  roleId,
  password: newPassword.optional(), // omitted: the user gets an invite link to set their own
});
export const signupBody = z.object({ name: personName, email, password: newPassword });
export const updateUserBody = z
  .object({ name: personName, phone: phone.nullable(), roleId, status: z.enum(["active", "suspended"]), ...employeeProfile })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const employeeListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.string().max(40).optional(),
  branch: z.string().trim().max(60).optional(),
  status: z.enum(USER_STATUSES).optional(),
});
export const reassignBody = z
  .object({ to: z.uuid("Choose who takes over"), leads: z.boolean().default(false), applications: z.boolean().default(false) })
  .refine((b) => b.leads || b.applications, "Choose leads, applications or both");
export const userListQuery = listQuery.extend({ role: z.string().max(40).optional(), status: z.enum(USER_STATUSES).optional() });
const DAY_MS = 24 * 60 * 60 * 1000;
/** Dashboard period: [from, to). Defaults to the last 30 days; at most ~3 years. */
export const dashboardQuery = z
  .object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
  .transform(({ from, to }) => {
    const end = to ?? new Date();
    return { from: from ?? new Date(end.getTime() - 30 * DAY_MS), to: end };
  })
  .refine(({ from, to }) => from < to, { message: "The start date must be before the end date", path: ["from"] })
  .refine(({ from, to }) => to - from <= 1100 * DAY_MS, { message: "Choose a period of 3 years or less", path: ["from"] });

/* ---------- leads ---------- */
const money = z.coerce.number({ error: "Enter an amount in rupees" }).positive("Must be more than 0").max(1e10, "That amount is too large");
const leadFields = {
  name: personName,
  phone,
  email: email.optional(),
  city: z.string().trim().max(60).optional(),
  loanType: z.enum(LOAN_TYPES.map((t) => t.id), { error: "Choose a loan type" }).optional(),
  loanAmount: money.optional(),
  annualIncome: money.optional(),
  employment: z.enum(EMPLOYMENT.map((e) => e.id), { error: "Choose an employment type" }).optional(),
  source: z.enum(LEAD_SOURCES, { error: "Choose a lead source" }),
  message: z.string().trim().max(2000).optional(),
};
const ownerRef = z.union([z.literal("auto"), z.uuid("Choose an employee"), z.null()]);
// On create, an empty optional field may come as null or be left out.
const nullish = (schema) => schema.nullish().transform((v) => v ?? undefined);
export const leadCreateBody = z.object({
  ...leadFields,
  email: nullish(email),
  city: nullish(z.string().trim().max(60)),
  loanType: nullish(z.enum(LOAN_TYPES.map((t) => t.id), { error: "Choose a loan type" })),
  loanAmount: nullish(money),
  annualIncome: nullish(money),
  employment: nullish(z.enum(EMPLOYMENT.map((e) => e.id), { error: "Choose an employment type" })),
  message: nullish(z.string().trim().max(2000)),
  source: leadFields.source.default("walk_in"),
  ownerId: ownerRef.optional(),
});
export const leadUpdateBody = z
  .object({
    ...leadFields,
    email: email.nullable(),
    city: leadFields.city.nullable(),
    loanType: leadFields.loanType.nullable(),
    loanAmount: money.nullable(),
    annualIncome: money.nullable(),
    employment: leadFields.employment.nullable(),
    message: leadFields.message.nullable(),
    status: z.enum(LEAD_STATUSES),
    lostReason: z.string().trim().min(2, "Say why the lead was lost").max(300),
    ownerId: z.uuid("Choose an employee").nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

export const LEAD_SORTS = ["created", "updated", "name", "amount", "lastContact"];
export const leadListQuery = listQuery.extend({
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  city: z.string().trim().max(60).optional(),
  loanType: z.string().max(40).optional(),
  owner: z.union([z.literal("unassigned"), z.literal("me"), z.uuid()]).optional(),
  sort: z.enum(LEAD_SORTS).default("created"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

export const noteBody = z.object({ body: z.string().trim().min(1, "Write a note first").max(2000, "Keep notes under 2,000 characters") });
export const followupBody = z.object({
  type: z.enum(FOLLOWUP_TYPES, { error: "Choose a follow-up type" }),
  dueAt: z.coerce.date({ error: "Choose a date and time" }).refine((d) => d > new Date(Date.now() - 5 * 60000), "Pick a time in the future"),
  note: z.string().trim().max(500).optional(),
  assignedTo: z.uuid().optional(),
});
export const followupUpdateBody = z.object({ status: z.enum(["done", "cancelled"]), outcome: z.string().trim().max(500).optional() });
export const convertBody = z.object({
  lenderId: z.string().trim().min(1, "Choose a lender").max(60),
  loanType: z.enum(LOAN_TYPES.map((t) => t.id), { error: "Choose a loan type" }),
  loanAmount: money,
  tenureMonths: z.coerce.number().int().min(1).max(600).optional(),
  note: z.string().trim().max(500).optional(),
});
export const bulkLeadBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ids: z.array(z.uuid()).min(1).max(200), ownerId: z.uuid().nullable() }),
  z.object({ action: z.literal("status"), ids: z.array(z.uuid()).min(1).max(200), status: z.enum(LEAD_STATUSES.filter((s) => s !== "converted")), lostReason: z.string().trim().min(2).max(300).optional() }),
  z.object({ action: z.literal("delete"), ids: z.array(z.uuid()).min(1).max(200) }),
]);

/* ---------- customers ---------- */
// Values match what the website dashboard saves, so both sides read the same profile.
export const GENDERS = ["Female", "Male", "Other", "Prefer not to say"];
export const MARITAL = ["Single", "Married", "Divorced", "Widowed"];
const dob = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return false;
    const age = (Date.now() - d.getTime()) / (365.25 * 86400000);
    return age >= 18 && age <= 100;
  }, "Customer must be between 18 and 100 years old");
const text = (max) => z.string().trim().max(max, `Keep this under ${max} characters`);
const customerFields = {
  name: personName,
  phone,
  email,
  alternatePhone: phone,
  dob,
  gender: z.enum(GENDERS, { error: "Choose a gender" }),
  marital: z.enum(MARITAL, { error: "Choose a marital status" }),
  pan,
  aadhaarLast4: z.string().trim().regex(/^\d{4}$/, "Only the last 4 digits of Aadhaar"),
  address: text(200),
  city: text(60),
  state: text(60),
  pincode,
  permanentSame: z.boolean(),
  permanentAddress: text(200),
  permanentCity: text(60),
  permanentState: text(60),
  permanentPincode: pincode,
  emp: z.enum(EMPLOYMENT.map((e) => e.id), { error: "Choose an employment type" }),
  company: text(120),
  annualIncome: money,
  creditScore: z.coerce.number({ error: "Enter a score" }).int("Whole numbers only").min(300, "CIBIL scores run from 300 to 900").max(900, "CIBIL scores run from 300 to 900"),
  kycStatus: z.enum(KYC_STATUSES),
  relationshipManagerId: z.uuid("Choose an employee"),
};
const nullable = Object.fromEntries(Object.entries(customerFields).map(([k, v]) => [k, v.nullable()]));
export const customerCreateBody = z.object({
  ...Object.fromEntries(Object.entries(customerFields).map(([k, v]) => [k, nullish(v)])),
  name: personName,
  phone,
  kycStatus: nullish(customerFields.kycStatus).transform((v) => v ?? "pending"),
});
export const customerUpdateBody = z
  .object({ ...nullable, name: personName, phone })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

export const customerListQuery = listQuery.extend({
  kyc: z.enum(KYC_STATUSES).optional(),
  rm: z.union([z.literal("me"), z.literal("none"), z.uuid()]).optional(),
  city: z.string().trim().max(60).optional(),
  sort: z.enum(["created", "name", "score", "applications"]).default("created"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});
export const documentUploadQuery = z.object({
  docType: z.enum(DOCUMENT_TYPES, { error: "Choose a document type" }),
  fileName: z.string().trim().min(1, "File name is missing").max(150, "File name is too long"),
  note: z.string().trim().max(300).optional(),
  applicationId: z.uuid().optional(),
});
export const documentUpdateBody = z.object({ status: z.enum(DOCUMENT_STATUSES), note: z.string().trim().max(300).nullable().optional() });

/* ---------- applications ---------- */
const rate = z.coerce.number({ error: "Enter a rate" }).min(0, "Rate can’t be negative").max(40, "Check the rate (max 40% p.a.)");
const tenure = z.coerce.number({ error: "Enter the tenure in months" }).int("Whole months only").min(1, "At least 1 month").max(600, "At most 600 months");
const fee = z.coerce.number({ error: "Enter an amount in rupees" }).min(0, "Can’t be negative").max(1e8, "That amount is too large");
const appFields = {
  lenderId: z.string().trim().min(1, "Choose a lender").max(60),
  loanType: z.enum(LOAN_TYPES.map((t) => t.id), { error: "Choose a loan product" }),
  loanAmount: money,
  tenureMonths: tenure,
  rate,
  processingFee: fee,
  lenderRef: z.string().trim().max(60, "Keep this under 60 characters"),
  assignedTo: z.uuid("Choose an employee"),
};
export const applicationCreateBody = z.object({
  customerId: z.uuid("Choose a customer"),
  lenderId: appFields.lenderId,
  loanType: appFields.loanType,
  loanAmount: money,
  tenureMonths: tenure,
  rate: nullish(rate),
  processingFee: nullish(fee),
  lenderRef: nullish(appFields.lenderRef),
  assignedTo: nullish(appFields.assignedTo),
  note: nullish(z.string().trim().max(500)),
});
export const applicationUpdateBody = z
  .object({ ...appFields, rate: rate.nullable(), processingFee: fee.nullable(), lenderRef: appFields.lenderRef.nullable(), assignedTo: appFields.assignedTo.nullable() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");
export const stageBody = z.object({
  stage: z.enum(APPLICATION_STAGES, { error: "Choose a stage" }),
  note: z.string().trim().max(500).optional(),
  sanctionedAmount: money.optional(),
  rate: rate.optional(),
  tenureMonths: tenure.optional(),
  disbursedAmount: money.optional(),
  rejectionReason: z.string().trim().min(3, "Say why the application was rejected").max(300).optional(),
});
export const applicationListQuery = listQuery.extend({
  stage: z.enum(APPLICATION_STAGES).optional(),
  lenderId: z.string().max(60).optional(),
  loanType: z.string().max(40).optional(),
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.uuid()]).optional(),
  sort: z.enum(["updated", "created", "amount"]).default("updated"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

/* ---------- lenders ---------- */
const optText = (max) => z.string().trim().max(max, `Keep this under ${max} characters`);
export const lenderProduct = z
  .object({
    type: z.enum(LOAN_TYPES.map((t) => t.id), { error: "Choose a loan product" }),
    rate: z.coerce.number({ error: "Enter a rate" }).min(0).max(40, "Check the rate (max 40% p.a.)"),
    maxAmount: money,
    maxTenure: z.coerce.number({ error: "Enter years" }).int("Whole years").min(1, "At least 1 year").max(40, "At most 40 years"),
    minTenure: z.coerce.number().int("Whole years").min(1).max(40).optional(),
    processingFee: optText(60).optional(),
    minCibil: z.coerce.number().int().min(300, "CIBIL runs from 300 to 900").max(900, "CIBIL runs from 300 to 900").optional(),
    minIncome: money.optional(),
    features: z.array(optText(80).min(1)).max(10).default([]),
  })
  .refine((p) => !p.minTenure || p.minTenure <= p.maxTenure, { message: "Minimum tenure is above the maximum", path: ["minTenure"] });
const products = z.array(lenderProduct).max(LOAN_TYPES.length).refine((ps) => new Set(ps.map((p) => p.type)).size === ps.length, "Each product can be listed once");
const contacts = z
  .array(z.object({ name: z.string().trim().min(2, "Enter the contact’s name").max(80), role: optText(60).optional(), phone: phone.optional(), email: email.optional() }))
  .max(10);
const lenderFields = {
  name: z.string().trim().min(2, "Enter the lender’s name").max(60),
  fullName: optText(120).nullable(),
  kind: z.enum(LENDER_KINDS, { error: "Choose bank, HFC or NBFC" }),
  fee: optText(60).nullable(),
  about: optText(1000).nullable(),
  // A catalogue logo name (sbi → /bank-logos/sbi.png, as the seeded lenders store it), a site path, or an https link.
  logo: z.string().trim().max(300).regex(/^(\/\S+|https:\/\/\S+|\w[\w .-]*)$/, "Use a logo name like sbi, a site path like /bank-logos/sbi.png, or an https:// link").nullable(),
  active: z.boolean(),
  payoutPct: z.coerce.number({ error: "Enter a percentage" }).min(0, "Can’t be negative").max(10, "Check the payout (max 10%)").nullable(),
  tatDays: z.coerce.number({ error: "Enter days" }).int("Whole days").min(1, "At least 1 day").max(180, "At most 180 days").nullable(),
  agreementUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker").refine((s) => !Number.isNaN(Date.parse(s)), "Use the date picker").nullable(),
  contacts,
  products,
};
export const lenderCreateBody = z.object({
  id: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "Short ID: 2–40 lowercase letters, digits or dashes (e.g. sbi)"),
  ...lenderFields,
  fullName: nullish(lenderFields.fullName.unwrap()),
  fee: nullish(lenderFields.fee.unwrap()),
  about: nullish(lenderFields.about.unwrap()),
  logo: nullish(lenderFields.logo.unwrap()),
  payoutPct: nullish(lenderFields.payoutPct.unwrap()),
  tatDays: nullish(lenderFields.tatDays.unwrap()),
  agreementUntil: nullish(lenderFields.agreementUntil.unwrap()),
  active: z.boolean().default(true),
  contacts: contacts.default([]),
  products: products.default([]),
});
export const lenderUpdateBody = z.object(lenderFields).partial().refine((b) => Object.keys(b).length > 0, "Nothing to update");
export const lenderListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  kind: z.enum(LENDER_KINDS).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  loanType: z.string().max(40).optional(),
});

/* ---------- follow-ups ---------- */
const dueAt = z.coerce.date({ error: "Choose a date and time" }).refine((d) => d > new Date(Date.now() - 5 * 60000), "Pick a time in the future");
export const followupScheduleBody = z
  .object({
    leadId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    type: z.enum(FOLLOWUP_TYPES, { error: "Choose a follow-up type" }),
    dueAt,
    note: z.string().trim().max(500).optional(),
    assignedTo: z.uuid("Choose an employee").optional(),
  })
  .refine((b) => Boolean(b.leadId) !== Boolean(b.customerId), { message: "Choose the lead or customer it’s for", path: ["target"] });
export const followupChangeBody = z
  .object({
    type: z.enum(FOLLOWUP_TYPES),
    dueAt,
    note: z.string().trim().max(500).nullable(),
    assignedTo: z.uuid("Choose an employee"),
    status: z.enum(["done", "cancelled"]),
    outcome: z.string().trim().max(500).optional(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update")
  .refine((b) => !b.status || ["type", "dueAt", "note", "assignedTo"].every((k) => b[k] === undefined), "Close a follow-up or change it, not both");
export const followupListQuery = listQuery.extend({
  view: z.enum(["overdue", "today", "upcoming", "done", "cancelled", "all"]).default("all"),
  type: z.enum(FOLLOWUP_TYPES).optional(),
  assignee: z.union([z.literal("me"), z.uuid()]).optional(),
  leadId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export const searchQuery = z.object({ q: z.string().trim().min(2, "Type at least 2 characters").max(100) });

export const auditListQuery = listQuery.extend({
  action: z.string().max(60).optional(),
  actorId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
