# AvodahLoans — staff CRM

```
crm/        Staff CRM: React 19 + Vite + Tailwind CSS v4 + React Router + TanStack Query
backend/    Node + Express + PostgreSQL (Drizzle ORM) API: CRM auth & RBAC, leads, customers, applications, lenders, follow-ups, reports
```

The public website (search, offers, customer OTP login, lead forms) was removed from this repo; it's in the git history if you need it. Customers, leads and applications it created stay in the database and show in the CRM as before.

```bash
npm run install:all   # installs backend and CRM
npm --prefix backend run seed   # creates the tables (migrations) and loads the lender catalogue into PostgreSQL (safe to re-run)
npm run dev:backend   # API on http://localhost:4000   (terminal 1)
npm run dev:crm       # CRM on http://localhost:5174   (terminal 2) — /api is proxied to the backend
npm run build:crm     # builds crm/dist
npm test              # backend tests — run on a throwaway in-memory PostgreSQL, never on your database
```

Needs **Node 22.12 or newer** (tested on Node 24).

Backend config lives in `backend/.env` (copy from `backend/.env.example`): `DATABASE_URL` (PostgreSQL connection string — hosted databases need `?sslmode=require`), `PORT`, `CORS_ORIGIN`, `TRUST_PROXY`, `NODE_ENV`, `CRM_URL`, `CRM_IDLE_MINUTES`, `CRM_SESSION_HOURS`, `CRM_TIMEZONE`.

### Local setup, step by step
1. `npm run install:all`
2. Copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL` (your Neon connection string, or a local PostgreSQL). **Never commit `.env`.**
3. `npm --prefix backend run seed` — runs all migrations and loads the lender catalogue. (The API also runs pending migrations every time it starts.)
4. `npm --prefix backend run crm:admin -- you@company.com "Your Name"` — your first CRM login (prints a one-time password).
5. Start the two dev servers (commands above) and open the CRM at http://localhost:5174.
6. `npm test` — the backend test suite, on a throwaway in-memory database.

## CRM sign-in, roles and security
- **First admin:** `npm --prefix backend run crm:admin -- you@company.com "Your Name"` creates an Admin and prints a one-time password (or set `CRM_ADMIN_PASSWORD` first). Add everyone else in the CRM under **Security & Settings → Users** — by invite link or with a password.
- **Staff are rows in `users`** with a `role_id` and a `password_hash` (scrypt). Customers have no role and can't sign in to the CRM. Staff sessions live in `sessions` with `kind = 'staff'`; any other session (e.g. a customer session left over from the old website) is ignored.
- **Roles** (`roles` table, built-ins inserted on start): Admin, Branch Manager, Credit Analyst, Sales Executive, Telecaller, Viewer. Permissions are `module.action` strings defined in `backend/src/crm/permissions.js`; every CRM route checks one with `can("…")`. A user can only create, edit or sign out users whose role ranks below theirs; Admin, the top role, manages everyone including other admins. (The former Super Admin role was removed in migration `0008`; its accounts became Admins.)
- **Protection:** 5 wrong passwords lock an account for 15 minutes; sign-in, forgot and reset are rate-limited per IP; sessions end after `CRM_IDLE_MINUTES` idle or `CRM_SESSION_HOURS` total; role changes, suspensions and password resets sign the user out everywhere.
- **Forgot password:** single-use links stored hashed in `otps` (identifier `reset:<user id>`), valid 30 minutes (invites 72 hours). No email provider is wired in yet: in development the link is printed in the backend console; wire your provider in `backend/src/lib/mailer.js` before production.
- **Audit log** (`audit_logs`): sign-ins, failed attempts, lockouts, sign-outs, password changes and resets, user and role changes, session revocations and every permission denial — with actor, IP and user agent. View it under **Security & Settings → Audit logs**.

| CRM API (`/api/crm`) | Permission |
|---|---|
| `POST auth/login`, `auth/logout`, `auth/forgot`, `auth/reset` | — |
| `GET auth/me`, `POST auth/password`, `GET/DELETE auth/sessions`, `DELETE auth/sessions/:id` | signed in |
| `GET roles` | `users.view` or `roles.view` |
| `GET users` · `POST users` · `PATCH users/:id`, `POST users/:id/reset-password`, `DELETE users/:id/sessions` | `users.view` · `users.create` · `users.edit` |
| `GET audit-logs` | `audit.view` |
| `GET dashboard?from=&to=` | `dashboard.view` (each section also checked — see below) |
| `GET search?q=` · `GET notifications`, `POST notifications/seen` | signed in (results limited to what the role can view) |

## CRM leads
- **One `leads` table** for website enquiries (callback / credit report forms) and leads added in the CRM. Every lead gets a readable ID (`L-1001`…, from the `lead_ref_seq` sequence) and moves through **New → Contacted → Interested → Docs pending → Qualified → Converted / Lost**. Website leads arrive as New, unassigned, source "Website".
- **Screens** (`crm/src/pages/leads/`): table with search (name, phone, email, lead ID), filters (status, source, product, employee, city, temperature), sorting, pagination, bulk assign / status / delete and CSV export; Kanban board (drag a card to change status); detail drawer with call / WhatsApp / email, status, temperature and owner, follow-ups, notes and full history; add and edit forms; convert to application. Filters and the open lead live in the URL, so links and the back button work.
- **Who sees what:** roles with `leads.assign` (Branch Manager, Admin) see and assign every lead; everyone else sees leads assigned to them plus the unassigned pool, and creates leads for themselves. "Auto" assignment picks the front-line employee (can edit leads, can't assign them) with the fewest open leads.
- **History is never lost:** every change, note, status move, assignment, follow-up and conversion is a row in `timeline_events`; deleting a lead is soft (`deleted_at`), and converted leads are locked (notes and follow-ups still allowed). A phone number can't have two open leads at once.
- **Follow-ups** live in the `followups` table, shared with the Follow-ups module (below); a pending follow-up past its time shows as overdue.
- **Convert** (Interested, Docs pending or Qualified leads; needs `leads.edit` + `applications.create`): in one transaction it locks the lead, reuses the website customer with the same mobile (or email) or creates one, logs an application with the chosen lender (`applications.lead_id`), and marks the lead converted. `applications.lead_id` is unique, so a lead can never become two applications — even if two people click Convert at the same moment.

| Leads API (`/api/crm`) | Permission |
|---|---|
| `GET leads`, `GET leads/board`, `GET leads/:id`, `GET leads/meta` | `leads.view` (scoped as above) |
| `POST leads` · `PATCH leads/:id` · `DELETE leads/:id` | `leads.create` · `leads.edit` (reassigning needs `leads.assign`) · `leads.delete` |
| `POST leads/:id/notes` · `POST leads/:id/followups` · `PATCH leads/:id/followups/:fid` | `leads.edit` · `followups.create` · `followups.edit` |
| `POST leads/bulk` (assign / status / delete) | `leads.assign` / `leads.edit` / `leads.delete` |
| `GET leads/export` (CSV) | `leads.export` |
| `POST leads/:id/convert` | `leads.edit` + `applications.create` |

## CRM customers
- **Customers are `users` rows without a role** — website sign-ups, converted leads, and customers added in the CRM. Each gets a customer ID (`C-5001`…). Personal, contact, address and employment details live in `users.profile` under the **same keys the website dashboard uses** (`dob`, `gender`, `marital`, `pan`, `address`, `city`, `pincode`, `emp`, `employment.*`), so an edit on either side shows on both and website-only fields are never dropped. CRM-only fields: `state`, `aadhaarLast4` (only the last 4 digits are stored), `alternatePhone`, `permanentAddress`; columns `kyc_status`, `credit_score`, `relationship_manager_id`.
- **Screens** (`crm/src/pages/customers/`): listing with totals (customers, KYC verified, with an active file, total disbursed), search (name, phone, email, PAN, customer ID), filters (KYC, relationship manager, city), sorting, pagination and CSV export; add / edit form; profile with Overview, Details, Applications, Documents, Leads & follow-ups and History tabs.
- **Links:** applications are those with `applications.user_id` = the customer (website and converted); leads are those with `leads.user_id` = the customer. Converting a lead creates or links the customer, makes the lead's owner the relationship manager if there's none, and fills in missing profile details without overwriting.
- **History** merges the customer's own events, every event on their leads (prefixed with the lead ID), lead arrivals, and applications. Changes record which fields changed — never the PAN, Aadhaar or income values themselves.
- **Documents** (`documents` table): PDF, JPG or PNG up to 5 MB, checked by content (not file name), stored in PostgreSQL, duplicate files refused, verify / reject (with reason) / remove (soft — history keeps it). Every download is audited. To move files to object storage later (S3, R2), only the upload and download routes change.
- **Permissions:** `customers.view` to see; `customers.create` to add; `customers.edit` to edit, add notes, and upload, download, review or remove documents; `customers.export` to export. Roles without `customers.edit` (e.g. Telecaller) see PAN masked (e.g. `APXXXXX45A`) and can't open documents.

| Customers API (`/api/crm`) | Permission |
|---|---|
| `GET customers`, `GET customers/:id`, `GET customers/meta` | `customers.view` |
| `POST customers` · `PATCH customers/:id` · `POST customers/:id/notes` | `customers.create` · `customers.edit` · `customers.edit` |
| `POST customers/:id/documents?docType=&fileName=` (raw file body) · `GET …/documents/:docId/file` · `PATCH`/`DELETE …/documents/:docId` | `customers.edit` |
| `GET customers/export` (CSV) | `customers.export` |

## CRM loan applications
- **One `applications` table** for website applications, converted leads and files created in the CRM. `stage` drives the pipeline — **New → Login → Document verification → Credit review → Sanctioned → Disbursed**, or **Rejected** from any open stage — and the customer-facing `status` the website shows is kept in step (`STAGE_STATUS` in `schema.js`).
- **Rules** (`backend/src/crm/applications.js`, enforced on the server): move forward one stage at a time; send back only before sanction, with a reason; **credit review needs every required document verified** (KYC, income proof by employment type, property papers for home/LAP); **sanction, disbursal and rejection need `applications.approve`** (Admin, Branch Manager, Credit Analyst) — sanction needs an amount ≤ the request, disbursal ≤ the sanction, rejection a reason; sanctioned/disbursed/rejected files keep their loan details locked; closed files can't move. EMI is always calculated by the server.
- **Links:** customer = `applications.user_id`; lender + product = `lender_id` + `type`, validated against the lender's product (rate, max amount, max tenure in `lenders.products`); employee = `assigned_to`; lead = `lead_id`. Documents are the customer's (`documents`), optionally tagged with the application.
- **Who sees what:** approvers and lead managers see every file; others see files assigned to them, created by them, or unassigned.
- **History:** every stage move (with sanction/disbursal amounts, reasons and notes), edit, assignment and note is in `timeline_events` (entity `application`) and the audit log.
- **Screens** (`crm/src/pages/applications/`): table with stage totals, search (ID, customer, phone, lender, lender reference), filters (stage, product, lender, employee), sorting, pagination, export; pipeline board (dropping a card opens the move dialog); detail with stage stepper, figures, document checklist, timeline, customer, lender and assignment; create/edit form with live EMI; move-stage dialog.

| Applications API (`/api/crm`) | Permission |
|---|---|
| `GET applications`, `GET applications/board`, `GET applications/:id`, `GET applications/meta` | `applications.view` (scoped as above) |
| `POST applications` · `PATCH applications/:id` · `POST applications/:id/notes` | `applications.create` · `applications.edit` · `applications.edit` |
| `POST applications/:id/stage` | `applications.edit` (forward / back) or `applications.approve` (sanction, disburse, reject) |
| `GET applications/export` (CSV) | `applications.export` |

## CRM lenders
- **Products stay in `lenders.products`** — the list the website's offers and CRM applications already read — so a rate, limit or tenure change here shows on the website and applies to new applications straight away. Each product: `type`, `rate`, `maxAmount`, `maxTenure` (years), optional `minTenure`, `processingFee`, `minCibil`, `minIncome`, `features`. `lowestRate` (shown on the website) is recalculated on every product change.
- **Lender fields:** name, full name, type (PSU / private bank, HFC, NBFC), logo, about, processing fee, status, plus `contacts` (first = relationship manager), `payout_pct`, `tat_days`, `agreement_until` (migration `0005`).
- **Links to applications:** new applications are checked against the lender's product (active lender, product offered, amount ≤ max, tenure within min–max). A product with open applications can't be removed; a lender with any applications can't be deleted (deactivate it instead — it leaves the website and new applications, existing files carry on).
- **Figures** (from real applications): files, open files, approval rate (sanctioned + disbursed ÷ decided), disbursed, and payout earned (disbursed × current payout %).
- **Screens** (`crm/src/pages/lenders/`): listing with totals, search, type / status / product filters, sort and CSV export; **Products & rates** view comparing one product across lenders; detail drawer (partnership, rate card, contacts, recent applications); add / edit lender form; product form.

| Lenders API (`/api/crm`) | Permission |
|---|---|
| `GET lenders`, `GET lenders/:id` | `lenders.view` |
| `POST lenders` · `PATCH lenders/:id` (details, status, products) · `DELETE lenders/:id` | `lenders.create` · `lenders.edit` · `lenders.delete` |

## CRM follow-ups
- **One table, two kinds of target:** a row in `followups` belongs to a lead (`lead_id`), a customer (`customer_id`, migration `0006`), or both (a converted lead's follow-up keeps its lead). A check constraint makes sure it has at least one.
- **Statuses:** Pending, Completed (`done`), Cancelled. **Overdue** isn't stored — it's a pending follow-up whose time has passed, so it can never go stale. "Today" follows the `CRM_TIMEZONE` clock (default Asia/Kolkata).
- **Who sees what:** roles that can assign leads (managers, admins) see and assign everyone's follow-ups; other staff see and act on the ones assigned to them, and can only schedule for themselves. A new follow-up goes to the chosen employee, else the lead's owner / customer's relationship manager (for managers), else the person scheduling it.
- **History:** scheduling, rescheduling, editing, completing (with an outcome) and cancelling are written to the lead's or customer's timeline; completing a lead follow-up also marks the lead as contacted.
- **Reminders:** the notification bell lists your own follow-ups that are overdue or due within the hour, linked to the right tab.
- **Screens** (`crm/src/pages/followups/`): tiles (overdue, due today, upcoming, 30-day completion rate), Overdue / Today / Upcoming / Completed / All tabs with counts, search (name, phone, lead or customer ID), type and employee filters, click-to-call, edit / reschedule, complete-or-cancel dialog, and a month calendar with per-day counts. Schedule from the page, the lead drawer or the customer profile.

| Follow-ups API (`/api/crm`) | Permission |
|---|---|
| `GET followups` (`view`, `q`, `type`, `assignee`, `leadId`, `customerId`, `from`, `to`) · `GET followups/meta` | `followups.view` |
| `POST followups` (lead or customer) · `PATCH followups/:id` (reschedule / reassign / edit, or `status: done\|cancelled`) | `followups.create` · `followups.edit` |

## CRM employees
- **No second set of user records:** employees are the same `users` rows as Settings → Users (`role_id` set). Department, designation, branch, monthly target and joining date are stored in `users.profile`; adding or editing an employee goes through `POST/PATCH users`, which accept `employees.create` / `employees.edit` as well as `users.*`. Role rank rules apply as in Settings.
- **Figures** come from real rows: leads owned (open, converted, conversion), applications assigned (files, in process), disbursed (total and this month vs the monthly target), overdue follow-ups. Team tiles: members, team target, achieved this month, unassigned open leads.
- **Reassign work:** hand an employee's open leads and/or in-process files to an active colleague (e.g. before deactivating them); every move is written to the record's history and the audit log. Deactivating signs the user out.
- **Screens** (`crm/src/pages/employees/`): listing with search, role / branch / status filters and CSV export; detail drawer (contact, performance, target progress, open leads, files in process, recent activity, active switch); add / edit form.

| Employees API (`/api/crm`) | Permission |
|---|---|
| `GET employees` (`q`, `role`, `branch`, `status`) · `GET employees/:id` | `employees.view` |
| `POST employees/:id/reassign` (`to`, `leads`, `applications`) | `employees.edit` (+ `leads.assign` / `applications.edit`) |

## CRM reports
- **Five reports** for any period (presets or custom dates): sales & conversion (disbursal trend, lead funnel, leads vs files, lost reasons, conversion by source), team performance (leaderboard with target progress — the monthly target is scaled to the period), lenders (files, approved, rejected, approval rate, disbursed, payout earned), products (files, average ticket, approval rate, disbursed) and cities (customer's city, else the lead's).
- **Definitions:** leads and files count by creation date, disbursals by disbursal date; approved = sanctioned or disbursed; approval rate = approved ÷ (approved + rejected). Summary cards: total disbursed, lead conversion, lender approval rate, average days from login to disbursal.
- **Export:** each report downloads as CSV (UTF-8, opens in Excel), built on the server so `reports.export` is enforced.

| Reports API (`/api/crm`) | Permission |
|---|---|
| `GET reports?from=&to=` | `reports.view` |
| `GET reports/export?tab=sales\|team\|lenders\|products\|cities&from=&to=` | `reports.export` |

## CRM settings, notifications and quick add
- **Settings → General** (`app_settings` table, migration `0007`): company name, CRM notification email, how new website leads are assigned (manual pool, or automatically to the active sales executive with the fewest open leads; no effect while there is no public website sending leads), and how early follow-up reminders appear. Admins only; every change is audited with before/after values.
- **Settings → Notifications:** each user switches bell items on or off (new leads, applications, follow-up reminders, security alerts); stored in `users.profile.notificationPrefs`.
- **Quick add** (top bar, every page): new lead, customer, application or follow-up — the same forms as the modules, filtered by the user's permissions.
- Roles & permissions, Users, Audit logs and Security are described under "CRM sign-in, roles and security" above.

| Settings API (`/api/crm`) | Permission |
|---|---|
| `GET settings/general` · `PATCH settings/general` | `settings.view` · `settings.edit` |
| `GET/PUT notifications/preferences` | signed in (own preferences) |

## CRM dashboard
- Every figure comes from PostgreSQL for the chosen period `[from, to)` and is compared with the period of the same length just before. Default: last 30 days; presets, a custom range and the browser back button all work (the period lives in the URL).
- Sources: **leads** = website callback and credit-report requests (`leads`), **customers** = `users` without a role, **applications** = `applications` (pending = submitted + in review), **lenders** = active rows in `lenders`. Loan amounts are the requested `loan_amount`; "approved value" covers approved and disbursed applications.
- Charts bucket by day (≤ 35 days), week (≤ 200 days) or month, on the `CRM_TIMEZONE` clock, with empty buckets shown as zero. Every chart has a table view.
- **Roles:** totals and charts need the module's `view` permission or `reports.view`; lists with names and phone numbers (recent leads, applications, activity) need the module's own `view` permission. Sections a role can't see are never computed or sent — e.g. a Viewer gets the figures but no customer details, a Telecaller gets leads and customers only.
- **Search** (top bar) looks up leads, customers and applications by name, phone, email or reference. **Notifications** list new unhandled leads, new applications awaiting review and (for `audit.view`) locked accounts from the last 14 days; opening the bell marks them read for that user (stored in `users.profile`).
- No schema changes were needed for the dashboard.

### Database (PostgreSQL + Drizzle)
- Tables are defined in `backend/src/db/schema.js`: lenders, roles, users, otps, sessions, activities, applications, leads, followups, timeline_events, documents, audit_logs. Free-form data (profile, activity lists, offer details, lender products) is stored as JSONB.
- The server applies pending migrations from `backend/drizzle/` on start. After changing the schema: `npm --prefix backend run db:generate` (writes a new SQL migration), then restart or run `db:migrate`.
- `npm --prefix backend run db:studio` opens Drizzle Studio to browse the data.
- Expired OTPs and sessions are deleted every 30 minutes (PostgreSQL has no TTL indexes).

## Where things live
- `backend/src/routes/crm/` – one file per CRM module; `backend/src/crm/` – their shared rules (permissions, leads, applications, customers, audit)
- `backend/src/data/loans.js` – loan types, employment types and the sample lender catalogue (`npm run seed`)
- `crm/src/pages/` – one folder per module; `crm/src/lib/` – API client, labels, formatting
- `crm/public/bank-logos/` – lender logos (a lender's `logo` is a path like `/bank-logos/sbi.png`)

## Production deployment
The API (`backend/`, a Node process) and the CRM (`crm/dist`, static files) deploy separately.

1. **Database (Neon):** use the connection string with `?sslmode=require` as `DATABASE_URL`. Migrations run automatically when the API starts (or run `npm --prefix backend run db:migrate`); they only add tables, columns and constraints. Create a Neon branch (backup) before deploying a new version.
2. **API:** on any Node 22.12+ host (Render, Railway, a VM…): `npm --prefix backend ci --omit=dev`, then `npm --prefix backend start`. Set these in the host's environment settings, never in a committed file:
   - `NODE_ENV=production` — reset links stay out of logs
   - `DATABASE_URL`; `PORT` if the host requires it; `TRUST_PROXY=1` behind the host's load balancer
   - `CORS_ORIGIN=https://crm.yoursite.in` (the CRM's origin)
   - `CRM_URL=https://crm.yoursite.in` (invite and reset links), `CRM_TIMEZONE=Asia/Kolkata`, `CRM_IDLE_MINUTES`, `CRM_SESSION_HOURS`
   - Health check: `GET /api/health` returns `{ "ok": true, "db": true }`.
3. **First admin:** run `npm --prefix backend run crm:admin -- you@company.com "Your Name"` once against the production database.
4. **CRM:** `npm run build:crm` with `VITE_API_URL=https://api.yoursite.in` set at build time (optionally `VITE_SITE_URL` for the sidebar's website link). Host `crm/dist` on any static host (Render Static Site, Netlify, Vercel, Cloudflare Pages) with a single-page-app fallback (unknown paths serve `index.html`), over HTTPS.
5. **Smoke test:** sign in to the CRM and open each module.

## Before launch
- **Email provider:** CRM invites and password resets are not emailed in production until a provider is wired into `backend/src/lib/mailer.js`. Until then, set a password when adding a user.
- Lender rates, limits and features in `backend/src/data/loans.js` are **sample data** — edit lenders in the CRM, or replace the catalogue before seeding.
