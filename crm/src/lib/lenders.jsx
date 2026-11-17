import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "../components/ui";
import { initials } from "./format";

// Lender labels and shared bits for the lender screens.

export const KIND_TONE = { "PSU Bank": "blue", "PVT Bank": "purple", HFC: "green", NBFC: "orange" };
export const KindBadge = ({ kind }) => <Badge tone={KIND_TONE[kind] ?? "gray"}>{kind ?? "—"}</Badge>;
export const ActiveBadge = ({ active }) => <Badge tone={active ? "green" : "gray"} dot>{active ? "Active" : "Inactive"}</Badge>;

export const pct = (n, digits = 2) => (n == null ? "—" : `${+Number(n).toFixed(digits)}%`);
export const years = (min, max) => (min ? `${min}–${max} yrs` : `${max} yrs`);

// Logos are site paths (/bank-logos/x.png) served by the public website, or full https links.
const SITE = import.meta.env.VITE_SITE_URL ?? "";
export function LenderLogo({ lender, size = "md" }) {
  const src = lender.logo ? (lender.logo.startsWith("/") ? SITE + lender.logo : lender.logo) : null;
  const [broken, setBroken] = useState(null);
  const box = size === "lg" ? "h-12 w-20" : "h-8 w-12";
  if (!src || broken === src)
    return <span aria-hidden className={`${box} grid shrink-0 place-items-center rounded-md bg-brand-50 text-xs font-bold text-brand-700`}>{initials(lender.name)}</span>;
  return <img src={src} alt="" loading="lazy" onError={() => setBroken(src)} className={`${box} shrink-0 rounded-md object-contain`} />;
}

/** Refreshes every view a lender change can affect: lists, the drawer, and the lender pickers in applications and leads. */
export function useLenderRefresh() {
  const qc = useQueryClient();
  return (id) => {
    for (const key of ["lenders", "applications-meta", "leads-meta", "dashboard"]) qc.invalidateQueries({ queryKey: [key] });
    if (id) qc.invalidateQueries({ queryKey: ["lender", id] });
  };
}
