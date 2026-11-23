import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../components/ui";
import { api } from "./api";
import { formatMoney } from "./format";

// Lead labels, colours and shared hooks for the leads screens.

export const LEAD_STATUS = {
  new: ["New", "blue"],
  contacted: ["Contacted", "purple"],
  interested: ["Interested", "purple"],
  docs_pending: ["Docs pending", "amber"],
  qualified: ["Qualified", "orange"],
  converted: ["Converted", "green"],
  lost: ["Lost", "red"],
};
export const STATUS_ORDER = Object.keys(LEAD_STATUS);
export const CONVERTIBLE = ["interested", "docs_pending", "qualified"];

export function StatusBadge({ status }) {
  const [label, tone] = LEAD_STATUS[status] ?? [status, "gray"];
  return <Badge tone={tone} dot>{label}</Badge>;
}


export function useLeadMeta() {
  return useQuery({ queryKey: ["leads-meta"], queryFn: api.leadsMeta, staleTime: 5 * 60_000 });
}

/** Label lookups built from the server's lists (so new options never need a frontend change). */
export function useLabels() {
  const meta = useLeadMeta().data;
  const find = (list, id) => list?.find((x) => x.id === id)?.label ?? id ?? "";
  return {
    source: (id) => find(meta?.sources, id),
    loanType: (id) => find(meta?.loanTypes, id),
    employment: (id) => find(meta?.employment, id),
  };
}

/** "Home Loan · ₹40.5 L" and "Indore · Freelancer" for table rows and cards. */
export function requirement(lead, labels) {
  const product = [lead.loanType && labels.loanType(lead.loanType).replace(/ Loan$/, ""), lead.loanAmount && formatMoney(lead.loanAmount)].filter(Boolean).join(" · ");
  const where = [lead.city, lead.employment && labels.employment(lead.employment)].filter(Boolean).join(" · ");
  return { product: product || "—", where };
}

/** Refreshes every view a lead change can affect. */
export function useLeadRefresh() {
  const qc = useQueryClient();
  return (id) => {
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["leads-board"] });
    qc.invalidateQueries({ queryKey: ["leads-meta"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
    if (id) qc.invalidateQueries({ queryKey: ["lead", id] });
  };
}
