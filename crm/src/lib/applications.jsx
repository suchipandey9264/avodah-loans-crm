import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../components/ui";
import { api } from "./api";

export const STAGES = {
  new: ["Submitted", "gray"], login: ["Advisor call", "blue"], documents: ["Documents", "amber"], credit_review: ["Credit review", "purple"],
  sanctioned: ["Sanctioned", "orange"], disbursed: ["Disbursed", "green"], rejected: ["Rejected", "red"],
};
export const STAGE_ORDER = Object.keys(STAGES);
export const FLOW = ["new", "login", "documents", "credit_review", "sanctioned", "disbursed"];

export function StageBadge({ stage }) {
  const [label, tone] = STAGES[stage] ?? [stage, "gray"];
  return <Badge tone={tone} dot>{label}</Badge>;
}

/** Same reducing-balance formula as the server (backend/src/lib/emi.js) — for previews only; the server's figure is stored. */
export function emi(principal, annualRate, months) {
  if (!(principal > 0) || !(months > 0) || annualRate == null || annualRate === "") return null;
  const r = Number(annualRate) / 12 / 100;
  if (r === 0) return principal / months;
  const f = (1 + r) ** months;
  return (principal * r * f) / (f - 1);
}

export function useApplicationMeta() {
  return useQuery({ queryKey: ["applications-meta"], queryFn: api.applicationsMeta, staleTime: 5 * 60_000 });
}

export function useApplicationRefresh() {
  const qc = useQueryClient();
  return (id, customerId) => {
    for (const key of ["applications", "applications-board", "dashboard", "customers", "notifications"]) qc.invalidateQueries({ queryKey: [key] });
    if (id) qc.invalidateQueries({ queryKey: ["application", id] });
    if (customerId) qc.invalidateQueries({ queryKey: ["customer", customerId] });
  };
}
