import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Building2, Download, IndianRupee, Percent, Plus, Search, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Button, Card, EmptyState, Input, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatCount, formatMoney } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";
import { ActiveBadge, KindBadge, LenderLogo, pct, years } from "../../lib/lenders";
import LenderDrawer from "./LenderDrawer";
import LenderForm from "./LenderForm";

const FILTERS = ["q", "kind", "status", "loanType"];
const SORTS = {
  business: ["Sort: business", (a, b) => b.stats.disbursed - a.stats.disbursed || b.stats.files - a.stats.files],
  files: ["Sort: files", (a, b) => b.stats.files - a.stats.files],
  approval: ["Sort: approval rate", (a, b) => (b.stats.approvalRate ?? -1) - (a.stats.approvalRate ?? -1)],
  rate: ["Sort: lowest rate", (a, b) => (a.lowestRate ?? 99) - (b.lowestRate ?? 99)],
  name: ["Sort: name", (a, b) => a.name.localeCompare(b.name)],
};

function Stat({ label, value, note, icon: Icon, tint }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold text-muted">{label}</p>
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${tint}`} aria-hidden><Icon className="size-[18px]" /></span>
      </div>
      <p className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </Card>
  );
}

function ApprovalBar({ rate }) {
  if (rate == null) return <span className="text-muted">—</span>;
  const p = Math.round(rate * 100);
  return (
    <span className="flex items-center gap-2" title={`${p}% of decided files approved`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-canvas" aria-hidden><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${p}%` }} /></span>
      <span className="text-xs font-semibold">{p}%</span>
    </span>
  );
}

const csvCell = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function exportCsv(rows, typeLabel) {
  const head = ["ID", "Lender", "Full name", "Type", "Status", "Products", "Rate from %", "Processing fee", "Payout %", "TAT days", "Agreement till", "Files", "Open files", "Approval %", "Disbursed", "Payout earned", "Relationship manager", "RM phone"];
  const lines = rows.map((l) => [
    l.id, l.name, l.fullName, l.kind, l.active ? "Active" : "Inactive", l.products.map((p) => typeLabel(p.type)).join("; "), l.lowestRate, l.fee, l.payoutPct, l.tatDays, l.agreementUntil,
    l.stats.files, l.stats.open, l.stats.approvalRate == null ? "" : Math.round(l.stats.approvalRate * 100), Math.round(l.stats.disbursed), Math.round(l.stats.payoutEarned), l.contacts[0]?.name, l.contacts[0]?.phone,
  ]);
  const blob = new Blob(["﻿" + [head, ...lines].map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: `lenders-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Lenders() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const term = useDebounced(q.trim());
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState(null);

  // Builds on window.location: two quick changes would otherwise start from a stale copy of the URL.
  const setParam = (changes) => {
    const n = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) (v === "" || v == null ? n.delete(k) : n.set(k, v));
    setParams(n);
  };
  useEffect(() => { if ((params.get("q") ?? "") !== term) setParam({ q: term }); }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ""]).filter(([, v]) => v));
  const sort = SORTS[params.get("sort")] ? params.get("sort") : "business";
  const view = params.get("view") === "products" ? "products" : "lenders";
  const openId = params.get("lender");
  const list = useQuery({ queryKey: ["lenders", filters], queryFn: () => api.lenders(filters), placeholderData: keepPreviousData });

  const t = list.data?.totals;
  const loanTypes = list.data?.loanTypes ?? [];
  const typeLabel = (id) => loanTypes.find((x) => x.id === id)?.label ?? id;
  const rows = [...(list.data?.lenders ?? [])].sort(SORTS[sort][1]);
  // Products view: one row per lender product (only the chosen product when filtered), cheapest first.
  const products = rows
    .flatMap((l) => l.products.filter((p) => !filters.loanType || p.type === filters.loanType).map((p) => ({ l, p })))
    .sort((a, b) => a.p.rate - b.p.rate);
  const open = (id) => setParam({ lender: id });

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">Lender Management</h1>
          <p className="mt-1 text-sm text-muted">Banks, NBFCs and housing finance partners — rates, products, payouts, turnaround and approval performance.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Download} disabled={!rows.length} onClick={() => exportCsv(rows, typeLabel)}>Export</Button>
          {can("lenders.create") && <Button icon={Plus} onClick={() => setAdding(true)}>Add lender</Button>}
        </div>
      </div>
      {flash && <div className="mb-4"><Alert tone={flash.tone}>{flash.text}</Alert></div>}

      <section aria-label="Lender totals" className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label="Partner lenders" value={t ? formatCount(t.total) : "…"} note={t && `${formatCount(t.active)} active`} icon={Building2} tint="bg-brand-50 text-brand-700" />
        <Stat label="Avg. turnaround" value={t ? (t.avgTatDays == null ? "—" : `${Math.round(t.avgTatDays)} days`) : "…"} note="Active lenders" icon={Timer} tint="bg-sky-50 text-sky-700" />
        <Stat label="Avg. payout" value={t ? pct(t.avgPayoutPct) : "…"} note="Of the disbursed amount" icon={Percent} tint="bg-orange-50 text-orange-700" />
        <Stat label="Payout earned" value={t ? formatMoney(t.payoutEarned) : "…"} note={t && `On ${formatMoney(t.disbursed)} disbursed`} icon={IndianRupee} tint="bg-emerald-50 text-emerald-700" />
      </section>

      <Card>
        <div className="flex flex-wrap gap-1 border-b border-line px-4 pt-3" role="tablist" aria-label="View">
          {[["lenders", "Lenders"], ["products", "Products & rates"]].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setParam({ view: id === "lenders" ? "" : id })}
              className={`-mb-px border-b-2 px-3 pb-2.5 text-sm font-semibold ${view === id ? "border-brand-700 text-brand-700" : "border-transparent text-muted hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" placeholder="Search lender…" aria-label="Search lenders" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select aria-label="Lender type" value={filters.kind ?? ""} onChange={(e) => setParam({ kind: e.target.value })}>
            <option value="">All lender types</option>
            {list.data?.kinds.map((k) => <option key={k}>{k}</option>)}
          </Select>
          <Select aria-label="Status" value={filters.status ?? ""} onChange={(e) => setParam({ status: e.target.value })}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
          <Select aria-label="Loan product" value={filters.loanType ?? ""} onChange={(e) => setParam({ loanType: e.target.value })}>
            <option value="">All products</option>
            {loanTypes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </Select>
          <Select aria-label="Sort" value={sort} onChange={(e) => setParam({ sort: e.target.value === "business" ? "" : e.target.value })} disabled={view === "products"}>
            {Object.entries(SORTS).map(([id, [label]]) => <option key={id} value={id}>{label}</option>)}
          </Select>
        </div>

        {list.isPending ? <Spinner label="Loading lenders" /> : list.isError ? <div className="p-5"><Alert>{list.error.message}</Alert></div> : !rows.length ? (
          <EmptyState icon={Building2} title="No lenders found">{Object.keys(filters).length ? "Try clearing a filter or searching for something else." : can("lenders.create") ? "Add your first partner bank or NBFC." : "No lenders have been added yet."}</EmptyState>
        ) : view === "lenders" ? (
          <div className={list.isFetching ? "opacity-60 transition-opacity" : ""}>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] font-bold uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    {["Lender", "Type", "Products", "From", "Payout", "TAT", "Files", "Approval", "Disbursed", "Status"].map((h, i) => (
                      <th key={h} scope="col" className={`px-3 py-3 ${i === 0 ? "pl-5" : ""} ${i === 9 ? "pr-5" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((l) => (
                    <tr key={l.id} className="cursor-pointer hover:bg-canvas/70" onClick={() => open(l.id)}>
                      <td className="px-3 py-3 pl-5">
                        <div className="flex items-center gap-3">
                          <LenderLogo lender={l} />
                          <div className="min-w-0">
                            <button type="button" className="font-semibold hover:text-brand-700" onClick={(e) => { e.stopPropagation(); open(l.id); }}>{l.name}</button>
                            <p className="max-w-64 truncate text-xs text-muted">{l.fullName ?? l.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3"><KindBadge kind={l.kind} /></td>
                      <td className="px-3 py-3">{l.products.length}</td>
                      <td className="px-3 py-3 font-semibold">{pct(l.lowestRate)}</td>
                      <td className="px-3 py-3">{pct(l.payoutPct)}</td>
                      <td className="px-3 py-3">{l.tatDays == null ? "—" : `${l.tatDays}d`}</td>
                      <td className="px-3 py-3">{l.stats.files}{l.stats.open > 0 && <span className="ml-1 text-xs text-muted">({l.stats.open} open)</span>}</td>
                      <td className="px-3 py-3"><ApprovalBar rate={l.stats.approvalRate} /></td>
                      <td className="px-3 py-3">{l.stats.disbursed ? formatMoney(l.stats.disbursed) : "—"}</td>
                      <td className="px-3 py-3 pr-5"><ActiveBadge active={l.active} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line lg:hidden">
              {rows.map((l) => (
                <li key={l.id}>
                  <button type="button" className="flex w-full items-center gap-3 p-4 text-left" onClick={() => open(l.id)}>
                    <LenderLogo lender={l} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold">{l.name}</span>
                        <ActiveBadge active={l.active} />
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted">{l.kind} · {l.products.length} products · from {pct(l.lowestRate)} · {l.stats.files} files</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : !products.length ? (
          <EmptyState icon={Building2} title="No products match">Try another product or clear the filters.</EmptyState>
        ) : (
          <div className={list.isFetching ? "opacity-60 transition-opacity" : ""}>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] font-bold uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    {["Product", "Lender", "Rate from", "Max amount", "Tenure", "Processing fee", "Eligibility", "Status"].map((h, i) => (
                      <th key={h} scope="col" className={`px-3 py-3 ${i === 0 ? "pl-5" : ""} ${i === 7 ? "pr-5" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {products.map(({ l, p }) => (
                    <tr key={`${l.id}-${p.type}`} className="cursor-pointer hover:bg-canvas/70" onClick={() => open(l.id)}>
                      <td className="px-3 py-3 pl-5 font-semibold">{typeLabel(p.type)}</td>
                      <td className="px-3 py-3"><span className="flex items-center gap-2"><LenderLogo lender={l} /><button type="button" className="font-semibold hover:text-brand-700" onClick={(e) => { e.stopPropagation(); open(l.id); }}>{l.name}</button></span></td>
                      <td className="px-3 py-3 font-bold">{pct(p.rate)}</td>
                      <td className="px-3 py-3">{formatMoney(p.maxAmount)}</td>
                      <td className="whitespace-nowrap px-3 py-3">{years(p.minTenure, p.maxTenure)}</td>
                      <td className="px-3 py-3">{p.processingFee ?? l.fee ?? "—"}</td>
                      <td className="px-3 py-3 text-xs text-muted">{[p.minCibil && `CIBIL ${p.minCibil}+`, p.minIncome && `${formatMoney(p.minIncome)}+/yr`].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-3 py-3 pr-5"><ActiveBadge active={l.active} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line lg:hidden">
              {products.map(({ l, p }) => (
                <li key={`${l.id}-${p.type}`}>
                  <button type="button" className="flex w-full items-center gap-3 p-4 text-left" onClick={() => open(l.id)}>
                    <LenderLogo lender={l} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2"><span className="truncate font-semibold">{typeLabel(p.type)} · {l.name}</span><span className="font-bold">{pct(p.rate)}</span></span>
                      <span className="mt-1 block truncate text-xs text-muted">Up to {formatMoney(p.maxAmount)} · {years(p.minTenure, p.maxTenure)}{p.minCibil ? ` · CIBIL ${p.minCibil}+` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <LenderDrawer
        lenderId={openId}
        loanTypes={loanTypes}
        onClose={() => setParam({ lender: "" })}
        onDeleted={() => { setParam({ lender: "" }); setFlash({ tone: "success", text: "Lender deleted." }); }}
      />
      {adding && <LenderForm onClose={() => setAdding(false)} onSaved={({ lender }) => { setAdding(false); setFlash({ tone: "success", text: `${lender.name} added. Add its products from the rate card.` }); open(lender.id); }} />}
    </>
  );
}
