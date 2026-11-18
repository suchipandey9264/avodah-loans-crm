# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Staff of AvodahLoans, a loan distribution business in India, working on laptops in the office: sales executives and telecallers working leads, credit analysts reviewing files, branch managers assigning work and watching targets, admins managing users and settings, and read-only viewers. They spend the working day inside the CRM, moving many leads and loan files a day.

## Product Purpose
The AvodahLoans CRM is the staff portal for the whole loan pipeline: capture and work leads, convert them into customers and loan applications, move applications through lender stages to disbursal, schedule follow-ups, manage lender partners and their rate cards, and report on team and lender performance. Success: no lead or file falls through the cracks, and managers can see where every rupee in the pipeline stands.

## Positioning
One place for the loan desk: lead → customer → application → lender → disbursal, with role-based access enforced on the server and a full history of every change.

## Operating Context
- Lead pipeline: New → Contacted → Interested → Docs pending → Qualified → Converted / Lost; table and Kanban views; call / WhatsApp / email from the lead.
- Application pipeline: New → Login → Document verification → Credit review → Sanctioned → Disbursed, or Rejected; document checklist gates credit review; approvals restricted by role.
- Customers with KYC status, documents (PDF/JPG/PNG), credit score and relationship manager; PAN masked for roles without edit rights.
- Follow-ups (calls, meetings) with overdue / today / upcoming views and a calendar; reminders in the notification bell.
- Lenders (PSU / private banks, HFCs, NBFCs) with products, rates, payouts and contacts; employees with monthly targets; reports with CSV export; audit logs.
- Money in Indian rupees (lakh / crore), dates on the Asia/Kolkata clock.

## Capabilities and Constraints
- React 19 + Vite + Tailwind CSS v4 + React Router + TanStack Query; API in `backend/` under `/api/crm`.
- Six roles (Admin, Branch Manager, Credit Analyst, Sales Executive, Telecaller, Viewer); the UI hides what a role can't do, the server enforces it.
- Every existing feature, permission check, filter-in-URL behaviour, export and API call must keep working through any redesign.
- No public website in this repo any more; leads and applications are created inside the CRM.

## Brand Commitments
- AvodahLoans logo (`crm/public/logo-light.png`, `logo-dark.png`) is binding.
- Brand colours are binding: deep purple (brand) and orange (accent).

## Evidence on Hand
- Reference design sheet of the 32 screens: `design/crm-portal-reference.png`.
- Lender logos: `crm/public/bank-logos/`.
- No real customer data, testimonials or metrics to show; sample lender rates in `backend/src/data/loans.js` are placeholders.

## Product Principles
- Speed over ceremony: the next action on a lead or file is always one click away.
- Nothing silent: every status, owner, due date and overdue item is visible where the work happens.
- Show only what the role may do.
- Numbers you can trust: figures come from real records, with the period they cover.

## Accessibility & Inclusion
Keyboard-operable throughout, visible focus, WCAG AA contrast, respects reduced motion.
