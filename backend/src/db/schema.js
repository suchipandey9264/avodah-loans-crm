import { sql } from "drizzle-orm";
import { boolean, check, customType, date, doublePrecision, index, integer, jsonb, pgSequence, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

// PostgreSQL schema. After changing it, run `npm run db:generate` to write a migration into ./drizzle.

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
const inList = (column, values) => sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;

/* ---------- Lender catalogue ---------- */

export const LENDER_KINDS = ["PVT Bank", "PSU Bank", "HFC", "NBFC"];

// products: [{ type, rate, maxAmount, maxTenure (years), features: [], minTenure?, processingFee?, minCibil?, minIncome? }]
// contacts: [{ name, role?, phone?, email? }]
export const lenders = pgTable(
  "lenders",
  {
    id: text("id").primaryKey(), // slug, e.g. "sbi"
    name: text("name").notNull(), // short brand name
    fullName: text("full_name"), // full / registered name
    logo: text("logo"),
    kind: text("kind"),
    tier: integer("tier"),
    sortOrder: integer("sort_order").notNull().default(0), // display order
    products: jsonb("products").notNull().default([]),
    contacts: jsonb("contacts").notNull().default([]),
    fee: text("fee"),
    // Partnership terms (CRM only): our payout as % of the disbursed amount, the lender's usual turnaround, agreement end.
    payoutPct: doublePrecision("payout_pct"),
    tatDays: integer("tat_days"),
    agreementUntil: date("agreement_until"),
    about: text("about"),
    lowestRate: doublePrecision("lowest_rate"),
    active: boolean("active").notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("lenders_sort_order_idx").on(t.sortOrder),
    index("lenders_kind_idx").on(t.kind),
    index("lenders_products_idx").using("gin", t.products), // fast `products @> '[{"type": …}]'`
    check("lenders_kind_check", inList(t.kind, LENDER_KINDS)),
  ]
);

/* ---------- Users & auth ---------- */

// CRM roles. `permissions` holds "module.action" strings (see src/crm/permissions.js); "*" grants everything.
// System roles are inserted on start (insert-if-missing), so edits made later in Settings are kept.
export const roles = pgTable("roles", {
  id: text("id").primaryKey(), // slug, e.g. "manager"
  name: text("name").notNull(),
  description: text("description"),
  rank: integer("rank").notNull().default(0), // higher = more senior; a user can only manage lower ranks
  permissions: jsonb("permissions").notNull().default([]),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt,
  updatedAt,
});

export const USER_STATUSES = ["active", "suspended", "pending"]; // pending: signed up on the CRM, waiting for an admin
export const KYC_STATUSES = ["pending", "verified", "re_kyc"];
export const customerCodeSeq = pgSequence("customer_code_seq", { startWith: 5001 });

// One table for everyone. Customers sign in with a mobile number OR an email address via OTP (role_id is null).
// CRM staff are users with a role_id and a password_hash and sign in with email + password.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 80 }),
    phone: text("phone").unique(),
    email: text("email").unique(), // stored lower-cased
    profile: jsonb("profile").notNull().default({}), // personal, address + employment details (website dashboard and CRM share these keys)
    // Customers (CRM). Every row gets a code; only customers show it.
    customerCode: text("customer_code").unique().default(sql`'C-' || nextval('customer_code_seq')`),
    kycStatus: text("kyc_status").notNull().default("pending"),
    creditScore: integer("credit_score"),
    creditScoreUpdatedAt: timestamp("credit_score_updated_at", { withTimezone: true }),
    relationshipManagerId: uuid("relationship_manager_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }), // staff member, for customers added in the CRM
    // CRM staff only
    roleId: text("role_id").references(() => roles.id, { onDelete: "restrict" }),
    passwordHash: text("password_hash"),
    status: text("status").notNull().default("active"),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("users_role_id_idx").on(t.roleId),
    index("users_rm_idx").on(t.relationshipManagerId),
    check("users_status_check", inList(t.status, USER_STATUSES)),
    check("users_kyc_status_check", inList(t.kycStatus, KYC_STATUSES)),
    check("users_credit_score_check", sql`${t.creditScore} is null or ${t.creditScore} between 300 and 900`),
  ]
);

// OTPs and sessions store a SHA-256 hash, never the raw value. Expired rows are purged by lib/db.js.
// otps also holds CRM password-reset tokens under the identifier "reset:<user id>".
export const otps = pgTable(
  "otps",
  {
    identifier: text("identifier").primaryKey(), // phone number or lower-cased email
    codeHash: text("code_hash").notNull(),
    tries: integer("tries").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("otps_expires_at_idx").on(t.expiresAt)]
);

export const SESSION_KINDS = ["customer", "staff"];

// `kind` keeps the two logins apart: a customer OTP session never opens the CRM API, even for a staff email.
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    id: uuid("id").notNull().unique().defaultRandom(), // public handle for "revoke this session"
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("customer"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
    check("sessions_kind_check", inList(t.kind, SESSION_KINDS)),
  ]
);

/* ---------- Audit log ---------- */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"), // kept when the actor is unknown (failed login) or later deleted
    action: text("action").notNull(), // e.g. "auth.login", "user.role_changed"
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    meta: jsonb("meta").notNull().default({}),
    createdAt,
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_actor_created_idx").on(t.actorId, t.createdAt),
    index("audit_logs_action_created_idx").on(t.action, t.createdAt),
  ]
);

/* ---------- Dashboard activity ---------- */

export const ACTIVITY_LISTS = ["searches", "saved", "compares", "credit", "callbacks"];

// One row per user; each list is a JSON array, newest first, capped at 100 items.
export const activities = pgTable("activities", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  searches: jsonb("searches").notNull().default([]),
  saved: jsonb("saved").notNull().default([]),
  compares: jsonb("compares").notNull().default([]),
  credit: jsonb("credit").notNull().default([]),
  callbacks: jsonb("callbacks").notNull().default([]),
  createdAt,
  updatedAt,
});

/* ---------- Applications & leads ---------- */

export const APPLICATION_STATUSES = ["submitted", "in_review", "approved", "rejected", "disbursed"];
// CRM stages, in pipeline order (rejected can follow any open stage). Each maps to one customer-facing status.
export const APPLICATION_STAGES = ["new", "login", "documents", "credit_review", "sanctioned", "disbursed", "rejected"];
export const STAGE_STATUS = {
  new: "submitted", login: "submitted", documents: "in_review", credit_review: "in_review",
  sanctioned: "approved", disbursed: "disbursed", rejected: "rejected",
};

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ref: text("ref").notNull().unique(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    contact: jsonb("contact").notNull().default({}), // { name, phone, email } snapshot for the ops team
    lenderId: text("lender_id").notNull(),
    lenderName: text("lender_name"),
    type: text("type").notNull(),
    loanAmount: doublePrecision("loan_amount").notNull(),
    tenureMonths: integer("tenure_months"),
    rate: doublePrecision("rate"),
    emi: doublePrecision("emi"),
    emp: text("emp"),
    pincode: text("pincode"),
    status: text("status").notNull().default("submitted"),
    details: jsonb("details").notNull().default({}), // anything else the offer snapshot carried
    // Set when a CRM lead was converted. Unique: a lead can become at most one application.
    leadId: uuid("lead_id").unique().references(() => leads.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }), // staff member, for CRM-created files
    // CRM pipeline. `stage` is the source of truth; `status` (shown to the customer on the website) follows it.
    stage: text("stage").notNull().default("new"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    processingFee: doublePrecision("processing_fee"),
    lenderRef: text("lender_ref"), // the lender's own file / application number
    sanctionedAmount: doublePrecision("sanctioned_amount"),
    sanctionedAt: timestamp("sanctioned_at", { withTimezone: true }),
    disbursedAmount: doublePrecision("disbursed_amount"),
    disbursedAt: timestamp("disbursed_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("applications_user_created_idx").on(t.userId, t.createdAt),
    index("applications_stage_created_idx").on(t.stage, t.createdAt),
    index("applications_assigned_idx").on(t.assignedTo),
    check("applications_status_check", inList(t.status, APPLICATION_STATUSES)),
    check("applications_stage_check", inList(t.stage, APPLICATION_STAGES)),
  ]
);

export const LEAD_KINDS = ["callback", "credit-report", "crm"]; // how the lead arrived: website forms, or added in the CRM
export const LEAD_STATUSES = ["new", "contacted", "interested", "docs_pending", "qualified", "converted", "lost"];
export const LEAD_SOURCES = ["website", "walk_in", "call_centre", "referral", "partner_dsa", "facebook_ads", "google_ads", "other"];
export const LEAD_TEMPERATURES = ["hot", "warm", "cold"];

// Human-friendly lead IDs: L-1001, L-1002… (existing rows get one when the column is added).
export const leadRefSeq = pgSequence("lead_ref_seq", { startWith: 1001 });

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ref: text("ref").notNull().unique().default(sql`'L-' || nextval('lead_ref_seq')`),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    message: text("message"),
    // The customer: set when the visitor was logged in, or when the lead is converted.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    details: jsonb("details").notNull().default({}),
    handled: boolean("handled").notNull().default(false), // kept in step with status (handled = status is not "new")
    // CRM pipeline
    status: text("status").notNull().default("new"),
    source: text("source").notNull().default("website"),
    temperature: text("temperature"),
    loanType: text("loan_type"),
    loanAmount: doublePrecision("loan_amount"),
    annualIncome: doublePrecision("annual_income"),
    employment: text("employment"),
    city: text("city"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    convertedBy: uuid("converted_by").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    // Soft delete: the row and its history stay; the CRM hides it.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("leads_kind_created_idx").on(t.kind, t.createdAt),
    index("leads_status_created_idx").on(t.status, t.createdAt),
    index("leads_owner_idx").on(t.ownerId),
    index("leads_phone_idx").on(t.phone),
    check("leads_kind_check", inList(t.kind, LEAD_KINDS)),
    check("leads_status_check", inList(t.status, LEAD_STATUSES)),
    check("leads_source_check", inList(t.source, LEAD_SOURCES)),
    check("leads_temperature_check", sql`${t.temperature} is null or ${inList(t.temperature, LEAD_TEMPERATURES)}`),
  ]
);

/* ---------- Follow-ups & history (shared by CRM modules) ---------- */

export const FOLLOWUP_TYPES = ["call", "whatsapp", "meeting", "visit", "email"];
export const FOLLOWUP_STATUSES = ["pending", "done", "cancelled"]; // "overdue" = pending and past due (derived)

export const followups = pgTable(
  "followups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Who it's for: a lead, a customer, or both (a converted lead's follow-up keeps its lead).
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    outcome: text("outcome"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("followups_lead_due_idx").on(t.leadId, t.dueAt),
    index("followups_assigned_due_idx").on(t.assignedTo, t.status, t.dueAt),
    index("followups_customer_due_idx").on(t.customerId, t.dueAt),
    check("followups_target_check", sql`${t.leadId} is not null or ${t.customerId} is not null`),
    check("followups_type_check", inList(t.type, FOLLOWUP_TYPES)),
    check("followups_status_check", inList(t.status, FOLLOWUP_STATUSES)),
  ]
);

// Append-only history for any CRM record (leads now; customers and applications later).
export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(), // "lead"
    entityId: uuid("entity_id").notNull(),
    type: text("type").notNull(), // "note", "status_changed", "assigned", "converted"…
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body"),
    meta: jsonb("meta").notNull().default({}),
    createdAt,
  },
  (t) => [index("timeline_entity_created_idx").on(t.entityType, t.entityId, t.createdAt)]
);

/* ---------- Customer documents ---------- */

// Files are kept in PostgreSQL (bytea), up to 5 MB each — no extra storage service. Lists never select `content`.
const bytea = customType({ dataType: () => "bytea" });

export const DOCUMENT_TYPES = ["pan", "aadhaar", "photo", "address_proof", "bank_statement", "salary_slip", "itr", "form16", "property", "other"];
export const DOCUMENT_STATUSES = ["uploaded", "verified", "rejected"];

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "set null" }), // optional: the file it's for
    docType: text("doc_type").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    content: bytea("content").notNull(),
    status: text("status").notNull().default("uploaded"),
    note: text("note"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // soft delete keeps the record of what was held
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("documents_customer_idx").on(t.customerId, t.createdAt),
    check("documents_type_check", inList(t.docType, DOCUMENT_TYPES)),
    check("documents_status_check", inList(t.status, DOCUMENT_STATUSES)),
    check("documents_size_check", sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 5242880`),
  ]
);

/* ---------- CRM settings (Settings → General) ---------- */

/** Organisation-wide CRM settings, one JSON value per key (currently just "general"). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt,
});
