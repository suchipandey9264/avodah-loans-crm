import { eq, isNull, or } from "drizzle-orm";
import { applications, timelineEvents } from "../db/schema.js";
import { EMPLOYMENT } from "../data/loans.js";
import { hasPermission } from "./permissions.js";

// Loan application rules shared by the CRM routes: who sees which files, how a file may move, what it needs.

export const STAGE_LABELS = {
  new: "Submitted", login: "Advisor call", documents: "Documents", credit_review: "Credit review", // first three use the website tracker's step names
  sanctioned: "Sanctioned", disbursed: "Disbursed", rejected: "Rejected",
};
export const FLOW = ["new", "login", "documents", "credit_review", "sanctioned", "disbursed"];
export const OPEN_STAGES = ["new", "login", "documents", "credit_review"]; // details can still be edited

/** Approvers and lead managers see every file; others see files assigned to them, created by them, or unassigned. */
export const seesAllApplications = (staff) => hasPermission(staff.permissions, "applications.approve") || hasPermission(staff.permissions, "leads.assign");
export const applicationScope = (staff) =>
  seesAllApplications(staff) ? undefined : or(eq(applications.assignedTo, staff.id), eq(applications.createdBy, staff.id), isNull(applications.assignedTo));

/**
 * Can a file move from `from` to `to`? Returns { kind } or { error }.
 * kind: "forward" (next open stage), "back" (earlier open stage, needs a note), "sanction", "disburse", "reject".
 */
export function checkMove(from, to) {
  if (from === "disbursed" || from === "rejected") return { error: "This application is closed and can’t move any further." };
  if (to === from) return { error: "The application is already at that stage." };
  if (to === "rejected") return { kind: "reject" };
  const i = FLOW.indexOf(from);
  const j = FLOW.indexOf(to);
  if (j === i + 1) return { kind: to === "sanctioned" ? "sanction" : to === "disbursed" ? "disburse" : "forward" };
  if (j < i && OPEN_STAGES.includes(from)) return { kind: "back" };
  if (from === "sanctioned") return { error: "A sanctioned application can only be disbursed or rejected." };
  return { error: `Move one stage at a time. The next stage is ${STAGE_LABELS[FLOW[i + 1]]}.` };
}
export const MOVE_PERMISSION = { forward: "applications.edit", back: "applications.edit", sanction: "applications.approve", disburse: "applications.approve", reject: "applications.approve" };

/** Every move this staff member may make from `stage` right now (the UI shows only these). */
export const allowedMoves = (staff, stage) =>
  [...FLOW, "rejected"]
    .map((to) => ({ to, ...checkMove(stage, to) }))
    .filter((m) => m.kind && hasPermission(staff.permissions, MOVE_PERMISSION[m.kind]))
    .map(({ to, kind }) => ({ stage: to, kind, label: STAGE_LABELS[to] }));

/** Documents a lender needs before credit review: KYC, income proof by employment type, property papers for secured loans. */
export function requiredDocuments(emp, loanType) {
  const selfEmployed = EMPLOYMENT.find((e) => e.id === emp)?.group === "self";
  return ["pan", "aadhaar", "address_proof", selfEmployed ? "itr" : "salary_slip", "bank_statement", ...(["home", "lap"].includes(loanType) ? ["property"] : [])];
}

/** Best document per required type: verified beats awaiting review beats rejected; this file's own upload wins a tie. */
export function checklist(required, docs, applicationId) {
  const rank = { verified: 3, uploaded: 2, rejected: 1 };
  return required.map((docType) => {
    const best = docs
      .filter((d) => d.docType === docType)
      .sort((a, b) => rank[b.status] - rank[a.status] || (b.applicationId === applicationId) - (a.applicationId === applicationId) || new Date(b.createdAt) - new Date(a.createdAt))[0];
    return { docType, document: best ?? null, status: best?.status ?? "missing" };
  });
}

export const applicationEvent = (tx, applicationId, type, actorId, { body = null, meta = {} } = {}) =>
  tx.insert(timelineEvents).values({ entityType: "application", entityId: applicationId, type, actorId, body, meta });
