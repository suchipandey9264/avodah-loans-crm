import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../components/ui";
import { api } from "./api";

export const KYC = { pending: ["Pending", "amber"], verified: ["Verified", "green"], re_kyc: ["Re-KYC", "red"] };
export function KycBadge({ status }) {
  const [label, tone] = KYC[status] ?? [status, "gray"];
  return <Badge tone={tone} dot>{label}</Badge>;
}

/** CIBIL bands used across the CRM: 750+ good, 650–749 fair, below 650 poor. */
export const scoreBand = (s) => (s == null ? null : s >= 750 ? { label: "Good", text: "text-emerald-700", fill: "#0ca30c" } : s >= 650 ? { label: "Fair", text: "text-amber-700", fill: "#fab219" } : { label: "Poor", text: "text-red-700", fill: "#d03b3b" });
export function Score({ value }) {
  const band = scoreBand(value);
  return band ? <span className={`font-bold ${band.text}`} title={`${band.label} (CIBIL)`}>{value}</span> : <span className="text-muted">—</span>;
}

export function useCustomerMeta() {
  return useQuery({ queryKey: ["customers-meta"], queryFn: api.customersMeta, staleTime: 5 * 60_000 });
}

export function useCustomerRefresh() {
  const qc = useQueryClient();
  return (id) => {
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["customers-meta"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    if (id) qc.invalidateQueries({ queryKey: ["customer", id] });
  };
}

export const empLabel = (meta, id) => meta?.employment.find((e) => e.id === id)?.label ?? id ?? null;
