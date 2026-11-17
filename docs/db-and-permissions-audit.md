# AvodahLoans CRM — database field and role-permission audit

Audit date: 17 Nov 2026. Scope: `backend/src/db/schema.js` (12 tables), `backend/src/crm/permissions.js`, every route in `backend/src/routes/`, the CRM and website front ends, the migrations and tests.
**Nothing has been changed yet** — this is the review and the proposed change list for approval.

## Summary

- **No column can be dropped safely right now.** Every column is either used, an audit/history field, or still read by the **old `avodahloan` app, which uses the same Neon database** (it selects `lenders.tier`, `lenders.lowest_rate` and filters on `leads.handled`). Dropping any of them would break that app's API immediately. Recommendation: keep them, mark the redundant ones as deprecated, and drop them in a later migration once the old app is switched off.
- **Five permissions are defined but never checked anywhere** (no API, no screen): `customers.delete`, `applications.delete`, `followups.delete`, `roles.edit`, `audit.export`.
- **Sensitive customer data is tied to `customers.edit`.** Anyone who can edit a customer — including Sales Executives — sees the full PAN, downloads KYC documents, marks documents verified/rejected, deletes documents and changes KYC status. That should be a separate permission.
- **Role permissions in the database never update when the code changes** (startup only inserts missing roles). Today Neon matches the code (checked read-only), but any permission change would silently not apply. Fix: synchronise the built-in roles on every start.

## 1. Field audit

Legend — **Verdict**: Keep · Keep (audit) = history/accountability field, never remove · Deprecated = redundant, keep until the old app is retired.

### lenders (lender catalogue; CRM Lenders module, public `/api/lenders`, `/api/offers`, application form)
| Field | Stores | Written by | Read by | Verdict |
|---|---|---|---|---|
| id | slug (`sbi`) — key used by applications.lender_id | seed, CRM add lender | everywhere | Keep |
| name, full_name, logo, kind, about, fee | brand, registered name, logo file, PSU/PVT/HFC/NBFC, blurb, fee text | seed, CRM lender form | CRM lenders, website API, reports | Keep |
| **tier** | size band 1–n from the sample catalogue | seed only (`data/loans.js`) | public `/api/lenders` select only; not editable, not shown in CRM; the new website uses its own static copy. **Old app reads it.** | **Deprecated** (see §2) |
| sort_order | display order | seed, CRM add (appends) | ordering in CRM lists, application/lead forms, public API | Keep |
| products (jsonb) | rate card per loan type | seed, CRM product form | offers, application validation, reports, CRM | Keep |
| contacts (jsonb) | lender RM / contacts | CRM lender form | CRM drawer | Keep |
| payout_pct, tat_days, agreement_until | partnership terms | CRM lender form | CRM lenders, reports (payout earned) | Keep |
| **lowest_rate** | min rate across products (a maintained cache) | seed; **recalculated on every product change** (`routes/crm/lenders.js`) | CRM list + "sort by lowest rate" + CSV, public API, website lender pages; **old app reads it** | **Keep** — used, and kept correct |
| active | listed or not | CRM status switch | public API, forms, reports | Keep |
| created_at, updated_at | timestamps | automatic | — | Keep (audit) |

### roles
| Field | Stores | Written by | Read by | Verdict |
|---|---|---|---|---|
| id, name, description, rank | role key, label, text, seniority | startup (`ensureSystemRoles`), migration 0008 | Users/Roles screens, rank rules (`outranks`) | Keep |
| permissions (jsonb) | `module.action` list | startup insert only; migration 0004 | every request (`http.js` loads it per request) | Keep — **needs sync** (§4) |
| is_system | built-in role flag | startup | not read yet | Keep — will be used by the role sync |
| created_at, updated_at | timestamps | automatic | — | Keep (audit) |

### users (customers and staff in one table)
| Field | Stores | Written by | Read by | Verdict |
|---|---|---|---|---|
| id, name, phone, email | identity; phone/email unique | website OTP sign-up, CRM customer & user forms | everywhere | Keep |
| profile (jsonb) | personal, address, employment; staff: department, designation, branch, monthly target, joined on, notification prefs | website profile, CRM customer form, employee form, settings | CRM, website dashboard, reports (city), eligibility | Keep |
| customer_code | `C-5001…` | DB default | CRM customers, search, reports | Keep |
| kyc_status | pending / verified / re-KYC | CRM customer form | customers list/filters/profile, CSV | Keep |
| credit_score, credit_score_updated_at | CIBIL and when recorded | CRM customer form | customer profile | Keep |
| relationship_manager_id | staff RM | CRM customer form, defaults | customers, follow-up default assignee | Keep |
| created_by | staff who added the customer | CRM | customer profile | Keep (audit) |
| role_id | staff role (null = customer) | users/employee forms, admin script | auth, every permission check | Keep (security) |
| password_hash, failed_logins, locked_until, last_login_at, password_changed_at | staff sign-in, lockout, history | CRM auth, admin script | CRM auth, Users/Employees screens | Keep (security) |
| status | active / suspended | users/employee forms | auth | Keep (security) |
| created_at, updated_at | timestamps | automatic | reports, lists | Keep (audit) |

### otps · sessions · audit_logs
| Field | Verdict |
|---|---|
| otps: identifier, code_hash, tries, expires_at — website OTP and CRM reset/invite tokens (hashed) | Keep (security) |
| sessions: token_hash, id, user_id, kind, ip, user_agent, last_seen_at, expires_at, created_at — customer and staff sessions, "your sessions" list, revoke | Keep (security) |
| audit_logs: id, actor_id, actor_email, action, entity_type, entity_id, ip, user_agent, meta, created_at — append-only audit trail (sign-ins, denials, user/role/settings/document changes) | Keep (audit) |

### activities (website dashboard)
| Field | Verdict |
|---|---|
| user_id, searches, saved, compares, credit, callbacks, created_at, updated_at — the signed-in visitor's recent searches, saved offers, comparisons, credit checks and callback requests; read/written by `/api/me/activity` and the website Dashboard | Keep |

### applications
| Field | Stores | Verdict |
|---|---|---|
| id, ref, user_id, lender_id, type, loan_amount, tenure_months, rate, emi, emp, pincode, details | the file and its offer snapshot (website Apply and CRM form) | Keep |
| contact (jsonb), lender_name | name/phone and lender name **snapshots** at the time of application — keep history correct if a customer or lender is later edited/removed | Keep |
| status | customer-facing status shown on the website; derived from `stage` on every move | Keep (website reads it) |
| stage | CRM pipeline (source of truth) | Keep |
| lead_id (unique), created_by, assigned_to | relationships: originating lead, creator, owner | Keep |
| processing_fee, lender_ref | CRM application form | Keep |
| sanctioned_amount, sanctioned_at, disbursed_amount, disbursed_at, rejected_at, rejection_reason | decision record from the stage dialog; disbursals drive reports, targets, payouts | Keep (audit) — `sanctioned_at` is only written today, but it is the sanction date of record |
| created_at, updated_at | timestamps; reports count files by created_at | Keep |

### leads
| Field | Stores | Verdict |
|---|---|---|
| id, ref, kind, name, phone, email, message, details, user_id | the enquiry (website forms or CRM) and linked customer | Keep |
| **handled** | true when status ≠ "new" | **Deprecated** — redundant with `status`; kept in step on every status change (single, bulk, convert); read by the CRM bell and dashboard, **and by the old app's bell/dashboard**. See §2 |
| status, source, temperature, loan_type, loan_amount, annual_income, employment, city | pipeline and qualification | Keep |
| owner_id, assigned_at, last_contacted_at | ownership and activity (auto-assign tie-break uses assigned_at) | Keep |
| lost_reason, converted_at, converted_by | outcome (reports "why leads were lost"; customer profile shows who converted) | Keep (audit) |
| created_by, deleted_at, deleted_by | creator and soft delete | Keep (audit) |
| created_at, updated_at | timestamps; reports | Keep |

### followups · timeline_events · documents · app_settings
| Field | Verdict |
|---|---|
| followups: id, lead_id, customer_id, type, due_at, note, status, outcome, assigned_to, created_by, completed_at, completed_by, created_at, updated_at | Keep — completed_by/created_by are accountability fields |
| timeline_events: id, entity_type, entity_id, type, actor_id, body, meta, created_at — append-only history of leads, customers, applications | Keep (audit) |
| documents: id, customer_id, application_id, doc_type, file_name, mime_type, size_bytes, sha256, content (bytea), status, note, uploaded_by, reviewed_by, reviewed_at, deleted_at, deleted_by, created_at, updated_at | Keep — file storage, integrity hash, review trail, soft delete |
| app_settings: key, value, updated_by, updated_at | Keep |

## 2. Cleanup candidates — conclusion

| Candidate | Finding | Recommendation |
|---|---|---|
| `lenders.tier` | Not editable or shown anywhere in the CRM; only written by the seed and returned by the public lenders API (the new website doesn't read it from the API). The old app selects it. | **Keep the column for now** (dropping it breaks the old app's `/api/lenders`). Stop returning it from the new public API. Drop it in a later migration once the old app is retired. |
| `lenders.lowest_rate` | Actively used (CRM list, sort, export, website API) and recalculated on every product change. | **Keep.** Not redundant in practice; it is a correct, maintained cache. |
| `leads.handled` | Fully redundant with `status` and always kept in step. | **Keep the column and keep writing it** (old app depends on it). Make the new code read `status` only, so the column can be dropped later without touching business logic. |

**Fields safe to remove now: none.** Removing columns is postponed until the old `avodahloan` app no longer connects to this database; at that point `lenders.tier` and `leads.handled` can be dropped with a two-line migration.

## 3. Permission audit

### Defined but not implemented
| Permission | Today | Recommendation | Why |
|---|---|---|---|
| `customers.delete` | no API, no button | **Remove** | Customers carry applications, KYC and financial history; hard deletes are not wanted and there is no business requirement for soft-deleting customers. |
| `applications.delete` | no API, no button | **Remove** | Financial records must be retained; "Rejected" is the terminal state for unwanted files. |
| `followups.delete` | no API; Cancel exists | **Remove** | Cancelling keeps the history; deleting would lose it. |
| `roles.edit` | Roles page is read-only | **Remove** (recommended) | Role permissions become code-defined and synchronised on start (§4), which keeps them reviewable and testable. Building a role editor is possible later, but it conflicts with automatic sync. |
| `audit.export` | no export | **Implement** | Small (CSV of the filtered audit log, like other exports) and useful for compliance reviews. |

### Sensitive customer data
Today `customers.edit` alone unlocks: full PAN on screen and in exports, downloading KYC documents, verifying/rejecting documents, deleting documents, and changing KYC status. Sales Executives have `customers.edit`.

**Proposal:** add **`customers.kyc` — "KYC & documents"**, required for: full PAN (otherwise masked `AB XXXXX 34F`), document download, document verify/reject/delete, changing KYC status. Uploading a document and editing ordinary details stay under `customers.edit`, so Sales Executives can still collect documents. Credit Analysts need `customers.kyc` for credit review; Sales Executives don't.

(Code note: `customers.edit` is also used to decide "the creator becomes the relationship manager by default" — that behaviour stays on `customers.edit`.)

### Other role checks
| Question | Finding | Recommendation |
|---|---|---|
| Branch Manager — delete | Only `leads.delete` is real (soft delete with history). The other deletes don't exist. | Keep `leads.delete`; the dead deletes disappear with the catalogue cleanup. |
| Branch Manager — export | Exports leads, customers (incl. PAN) and applications. | **Your decision.** Recommended: keep leads and applications export; **remove customer export** (bulk personal data) — Admin keeps it. |
| Branch Manager — sanction/disburse/reject (`applications.approve`) | A sales manager whose team is measured on disbursals can record sanctions and disbursals. | **Your decision.** Recommended: **remove** — Credit Analysts and Admins record lender decisions (separation of duties). Managers still see everything and move files forward. |
| Credit Analyst — `lenders.edit` | Can change rate cards, payout % and lender status (affects the website and payout reports). | **Remove** — Admin only. Credit Analysts keep `lenders.view`. |

### Permission matrix — original → proposed
V view · C create · E edit · D delete · A assign (leads) / approve (applications) · X export · K KYC & documents. ~~struck~~ = removed, **bold** = added.

| Module | Admin | Branch Manager | Credit Analyst | Sales Executive | Telecaller | Viewer |
|---|---|---|---|---|---|---|
| Dashboard | V | V | V | V | V | V |
| Leads | VCEDAX | VCEDAX | V | VCE | VCE | — |
| Customers | VCE~~D~~X**K** | VCE~~D~~ ~~X~~ **K** | VE**K** | VCE | V | — |
| Applications | VCEA~~D~~X | VCE ~~A~~ ~~D~~ X | VCEA | VC | — | — |
| Follow-ups | VCE~~D~~ | VCE~~D~~ | VCE | VCE | VCE | — |
| Lenders | VCED | V | V ~~E~~ | V | — | — |
| Employees | VCE | V | — | — | — | — |
| Reports | VX | VX | V | — | — | V |
| Users | VCE | V | — | — | — | — |
| Roles | V ~~E~~ | — | — | — | — | — |
| Audit logs | VX (X now implemented) | — | — | — | — | — |
| Settings | VE | — | — | — | — | — |

Admin keeps every permission. The two Branch Manager items marked "your decision" are shown with the recommended choice.

## 4. Role synchronisation (the migration requirement)

Problem: `ensureSystemRoles()` inserts missing built-in roles and never updates existing rows, so editing `permissions.js` has no effect on an existing database.

Proposal: on every API start, **upsert the built-in roles** (`is_system = true`): name, description, rank and permissions are set from `permissions.js`. Because roles are not editable in the CRM (once `roles.edit` is removed), the code is the single source of truth, and every future permission change applies on the next deploy. Only the `roles` table changes; no user accounts, records or history are touched. Users keep their role; their new permissions apply on their next request (permissions are loaded per request).

No column migrations are needed for this change set.

## 5. Planned changes (after approval)

| File | Change |
|---|---|
| `backend/src/crm/permissions.js` | Remove the 4 dead permissions, add `customers.kyc`, apply the matrix above |
| `backend/src/crm/accounts.js` | `ensureSystemRoles` upserts built-in roles (sync) |
| `backend/src/crm/customers.js` | `seesSensitive` → `customers.kyc` |
| `backend/src/routes/crm/customers.js` | Document download / review / delete and KYC-status changes require `customers.kyc`; RM default stays on `customers.edit` |
| `backend/src/routes/crm/audit.js` + `crm/src/pages/settings/AuditLogs.jsx` + `crm/src/lib/api.js` | Audit log CSV export (`audit.export`) |
| `backend/src/routes/crm/topbar.js`, `dashboard.js` | Read `status` instead of `handled` |
| `backend/src/routes/loans.js` | Stop returning `tier` from the public API |
| `crm/src/pages/customers/CustomerProfile.jsx` (+ form) | Hide download / verify / delete / KYC-status controls without `customers.kyc` |
| `backend/test/*` | New role-permission and sensitive-data tests; updated expectations |
| `README.md` | Roles table and permission notes |

Tests to add: Admin full access; each restricted role gets 403 on the new boundaries; Sales Executive sees masked PAN and cannot download/verify documents or change KYC; Credit Analyst can; role sync updates a stale role row and leaves users and records untouched; audit export; existing lead → customer → application → sanction → disbursal workflow still passes. Then run all backend tests, browser suites and production builds.

## 6. Other production-readiness issues found

- **Website lender and offer pages use built-in sample data** (`frontend/src/lib/loans.js`), not the database — so lender/rate changes made in the CRM don't appear on those pages, even though the API (`/api/lenders`, `/api/offers`) serves live data. The README states otherwise.
- **The old `avodahloan` app shares the Neon database.** Besides blocking column cleanup, it can still write leads and applications with older rules. Decide when to retire it.
- Website OTP login in production needs an SMS provider; CRM invites/resets need an email provider (already in the README "Before launch").
