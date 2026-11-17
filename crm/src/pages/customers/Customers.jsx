import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, FileText, IndianRupee, Plus, Search, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Avatar, Button, Card, EmptyState, Input, Pagination, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { KycBadge, Score, useCustomerMeta } from "../../lib/customers";
import { formatCount, formatDate, formatMoney } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";
import CustomerForm from "./CustomerForm";

const PAGE_SIZE = 25;
const FILTERS = ["q", "kyc", "rm", "city"];

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

function SortHeader({ label, field, sort, dir, onSort, className = "" }) {
  const active = sort === field;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className={`px-3 py-3 ${className}`} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-ink" onClick={() => onSort(field, active && dir === "desc" ? "asc" : "desc")}>
        {label} <Icon className="size-3.5" aria-hidden />
      </button>
    </th>
  );
}

export default function Customers() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const meta = useCustomerMeta().data;
  const [q, setQ] = useState(params.get("q") ?? "");
  const term = useDebounced(q.trim());
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState(null);

  // Builds on window.location: two quick changes would otherwise start from a stale copy of the URL.
  const setParam = (changes) => {
    const n = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) (v === "" || v == null ? n.delete(k) : n.set(k, v));
    if (Object.keys(changes).some((k) => k !== "page")) n.delete("page");
    setParams(n);
  };
  useEffect(() => { if ((params.get("q") ?? "") !== term) setParam({ q: term }); }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ""]).filter(([, v]) => v));
  const sort = params.get("sort") ?? "created";
  const dir = params.get("dir") ?? "desc";
  const page = Number(params.get("page") ?? 1);
  const list = useQuery({
    queryKey: ["customers", { ...filters, sort, dir, page }],
    queryFn: () => api.customers({ ...filters, sort, dir, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const exporting = useMutation({ mutationFn: () => api.exportCustomers({ ...filters, sort, dir }), onError: (e) => setFlash({ tone: "error", text: e.message }) });
  const st = list.data?.stats;
  const rows = list.data?.customers ?? [];
  const open = (id) => navigate(`/customers/${id}`);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">Customer Management</h1>
          <p className="mt-1 text-sm text-muted">Profiles, KYC and loan history for every customer — website sign-ups, converted leads and customers added here.</p>
        </div>
        <div className="flex gap-2">
          {can("customers.export") && <Button variant="secondary" icon={Download} loading={exporting.isPending} onClick={() => exporting.mutate()}>Export</Button>}
          {can("customers.create") && <Button icon={Plus} onClick={() => setAdding(true)}>Add customer</Button>}
        </div>
      </div>
      {flash && <div className="mb-4"><Alert tone={flash.tone}>{flash.text}</Alert></div>}

      <section aria-label="Customer totals" className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label="Total customers" value={st ? formatCount(st.total) : "…"} icon={Users} tint="bg-brand-50 text-brand-700" />
        <Stat label="KYC verified" value={st ? (st.total ? `${Math.round((st.verified / st.total) * 100)}%` : "0%") : "…"} note={st && `${formatCount(st.verified)} customers`} icon={ShieldCheck} tint="bg-emerald-50 text-emerald-700" />
        <Stat label="With an active file" value={st ? formatCount(st.activeFile) : "…"} note="Submitted, in review or approved" icon={FileText} tint="bg-sky-50 text-sky-700" />
        <Stat label="Total disbursed" value={st ? formatMoney(st.disbursed) : "…"} icon={IndianRupee} tint="bg-orange-50 text-orange-700" />
      </section>

      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" placeholder="Search name, phone, email, PAN, customer ID…" aria-label="Search customers" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select aria-label="KYC status" value={filters.kyc ?? ""} onChange={(e) => setParam({ kyc: e.target.value })}>
            <option value="">All KYC states</option>
            {meta?.kycStatuses.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </Select>
          <Select aria-label="Relationship manager" value={filters.rm ?? ""} onChange={(e) => setParam({ rm: e.target.value })}>
            <option value="">All RMs</option>
            <option value="me">My customers</option>
            <option value="none">No RM</option>
            {meta?.relationshipManagers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <Select aria-label="City" value={filters.city ?? ""} onChange={(e) => setParam({ city: e.target.value })}>
            <option value="">All cities</option>
            {meta?.cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>

        {list.isPending ? <Spinner label="Loading customers" /> : list.isError ? <div className="p-5"><Alert>{list.error.message}</Alert></div> : !rows.length ? (
          <EmptyState icon={Users} title="No customers found">{Object.keys(filters).length ? "Try clearing a filter or searching for something else." : "Customers appear here when they sign up on the website, when a lead is converted, or when you add one."}</EmptyState>
        ) : (
          <div className={list.isFetching ? "opacity-60 transition-opacity" : ""}>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] font-bold uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    <SortHeader label="Customer" field="name" sort={sort} dir={dir} onSort={(s, d) => setParam({ sort: s, dir: d })} className="pl-5" />
                    <th scope="col" className="px-3 py-3">Contact</th>
                    <SortHeader label="CIBIL" field="score" sort={sort} dir={dir} onSort={(s, d) => setParam({ sort: s, dir: d })} />
                    <th scope="col" className="px-3 py-3">KYC</th>
                    <SortHeader label="Applications" field="applications" sort={sort} dir={dir} onSort={(s, d) => setParam({ sort: s, dir: d })} />
                    <th scope="col" className="px-3 py-3">Disbursed</th>
                    <th scope="col" className="px-3 py-3">RM</th>
                    <SortHeader label="Since" field="created" sort={sort} dir={dir} onSort={(s, d) => setParam({ sort: s, dir: d })} className="pr-5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((c) => (
                    <tr key={c.id} className="cursor-pointer hover:bg-canvas/70" onClick={() => open(c.id)}>
                      <td className="px-3 py-3 pl-5">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name || c.phone} size="sm" />
                          <div className="min-w-0">
                            <button type="button" className="font-semibold hover:text-brand-700" onClick={(e) => { e.stopPropagation(); open(c.id); }}>{c.name || "Unnamed customer"}</button>
                            <p className="text-xs text-muted">{[c.code, c.city].filter(Boolean).join(" · ")}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3"><p>{c.phone ? `+91 ${c.phone}` : "—"}</p><p className="max-w-56 truncate text-xs text-muted">{c.email ?? ""}</p></td>
                      <td className="px-3 py-3"><Score value={c.creditScore} /></td>
                      <td className="px-3 py-3"><KycBadge status={c.kycStatus} /></td>
                      <td className="px-3 py-3">{c.applications}{c.activeApplications > 0 && <span className="ml-1.5 text-xs text-muted">({c.activeApplications} active)</span>}</td>
                      <td className="px-3 py-3">{c.disbursed ? formatMoney(c.disbursed) : "—"}</td>
                      <td className="px-3 py-3">{c.relationshipManagerName ?? <span className="text-muted">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-3 pr-5 text-muted">{formatDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line lg:hidden">
              {rows.map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex w-full gap-3 p-4 text-left" onClick={() => open(c.id)}>
                    <Avatar name={c.name || c.phone} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0"><span className="block truncate font-semibold">{c.name || "Unnamed customer"}</span><span className="block text-xs text-muted">{[c.code, c.city].filter(Boolean).join(" · ")}</span></span>
                        <KycBadge status={c.kycStatus} />
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted">+91 {c.phone} · {c.applications} application{c.applications === 1 ? "" : "s"} · CIBIL {c.creditScore ?? "—"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setParam({ page: p === 1 ? "" : p })} />
          </div>
        )}
      </Card>

      {adding && <CustomerForm onClose={() => setAdding(false)} onSaved={({ customer }) => { setAdding(false); navigate(`/customers/${customer.id}`, { state: { flash: `${customer.code} added.` } }); }} />}
    </>
  );
}
