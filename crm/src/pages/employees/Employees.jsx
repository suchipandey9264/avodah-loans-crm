import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Search, Target, Trophy, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Avatar, Badge, Button, Card, EmptyState, Input, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatCount, formatMoney } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";
import EmployeeDrawer from "./EmployeeDrawer";
import EmployeeForm from "./EmployeeForm";

const FILTERS = ["q", "role", "branch", "status"];
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);

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

function TargetBar({ e }) {
  if (!e.monthlyTarget) return <span className="text-xs text-muted">No target</span>;
  const p = e.stats.disbursedMonth / e.monthlyTarget;
  return (
    <span className="block min-w-28" title={`${Math.round(p * 100)}% of this month's target`}>
      <span className="block h-1.5 overflow-hidden rounded-full bg-canvas"><span className={`block h-full rounded-full ${p >= 1 ? "bg-emerald-500" : "bg-brand-600"}`} style={{ width: `${Math.min(100, p * 100)}%` }} /></span>
      <span className="mt-1 block text-[11px] text-muted">{formatMoney(e.stats.disbursedMonth)} of {formatMoney(e.monthlyTarget)}</span>
    </span>
  );
}

const csvCell = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function exportCsv(rows) {
  const head = ["Name", "Email", "Phone", "Role", "Department", "Designation", "Branch", "Status", "Leads", "Open leads", "Converted", "Conversion %", "Files", "Open files", "Disbursed", "Disbursed this month", "Monthly target", "Overdue follow-ups"];
  const lines = rows.map((e) => [e.name, e.email, e.phone, e.role.name, e.department, e.designation, e.branch, e.status, e.stats.leads, e.stats.openLeads, e.stats.converted,
    e.stats.conversion == null ? "" : Math.round(e.stats.conversion * 100), e.stats.files, e.stats.openFiles, Math.round(e.stats.disbursed), Math.round(e.stats.disbursedMonth), e.monthlyTarget, e.stats.overdueFollowups]);
  const url = URL.createObjectURL(new Blob(["﻿" + [head, ...lines].map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `employees-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Employees() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const term = useDebounced(q.trim());
  const [form, setForm] = useState(null); // {} add, { employee } edit
  const [flash, setFlash] = useState(null);

  // Builds on window.location: two quick changes would otherwise start from a stale copy of the URL.
  const setParam = (changes) => {
    const n = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) (v === "" || v == null ? n.delete(k) : n.set(k, v));
    setParams(n);
  };
  useEffect(() => { if ((params.get("q") ?? "") !== term) setParam({ q: term }); }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ""]).filter(([, v]) => v));
  const list = useQuery({ queryKey: ["employees", filters], queryFn: () => api.employees(filters), placeholderData: keepPreviousData });
  const all = useQuery({ queryKey: ["employees", {}], queryFn: () => api.employees({}), enabled: Object.keys(filters).length > 0 }); // reassign targets
  const team = list.data?.team;
  const rows = list.data?.employees ?? [];
  const openId = params.get("employee");
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["employees"] }); queryClient.invalidateQueries({ queryKey: ["employee"] }); };
  const canAdd = can("users.create") || can("employees.create");

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">Employee Management</h1>
          <p className="mt-1 text-sm text-muted">Your team, their workload, targets and results.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Download} disabled={!rows.length} onClick={() => exportCsv(rows)}>Export</Button>
          {canAdd && <Button icon={Plus} onClick={() => setForm({})}>Add employee</Button>}
        </div>
      </div>
      {flash && <div className="mb-4"><Alert tone={flash.tone}>{flash.text}</Alert></div>}

      <section aria-label="Team totals" className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label="Team members" value={team ? formatCount(team.members) : "…"} note={team && `${team.inactive} inactive`} icon={Users} tint="bg-brand-50 text-brand-700" />
        <Stat label="Team target" value={team ? formatMoney(team.target) : "…"} note="Monthly, active members" icon={Target} tint="bg-sky-50 text-sky-700" />
        <Stat label="Achieved" value={team ? formatMoney(team.achieved) : "…"} note={team && (team.target ? `${Math.round((team.achieved / team.target) * 100)}% of target this month` : "Disbursed this month")} icon={Trophy} tint="bg-emerald-50 text-emerald-700" />
        <Stat label="Unassigned leads" value={team ? formatCount(team.unassigned) : "…"} note="Open, waiting for an owner" icon={UserPlus} tint="bg-orange-50 text-orange-700" />
      </section>

      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" placeholder="Search name, email or phone…" aria-label="Search employees" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select aria-label="Role" value={filters.role ?? ""} onChange={(e) => setParam({ role: e.target.value })}>
            <option value="">All roles</option>
            {list.data?.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Select aria-label="Branch" value={filters.branch ?? ""} onChange={(e) => setParam({ branch: e.target.value })}>
            <option value="">All branches</option>
            {list.data?.branches.map((b) => <option key={b}>{b}</option>)}
          </Select>
          <Select aria-label="Status" value={filters.status ?? ""} onChange={(e) => setParam({ status: e.target.value })}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Inactive</option>
          </Select>
        </div>
        {list.isPending ? <Spinner label="Loading employees" /> : list.isError ? <div className="p-5"><Alert>{list.error.message}</Alert></div> : !rows.length ? (
          <EmptyState icon={Users} title="No employees found">{Object.keys(filters).length ? "Try clearing a filter." : "Add your first team member."}</EmptyState>
        ) : (
          <div className={list.isFetching ? "opacity-60 transition-opacity" : ""}>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] font-bold uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    {["Employee", "Role", "Open leads", "Conversion", "Files", "Disbursed", "Target progress", "Status"].map((h, i) => (
                      <th key={h} scope="col" className={`px-3 py-3 ${i === 0 ? "pl-5" : ""} ${i === 7 ? "pr-5" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((e) => (
                    <tr key={e.id} className="cursor-pointer hover:bg-canvas/70" onClick={() => setParam({ employee: e.id })}>
                      <td className="px-3 py-3 pl-5">
                        <div className="flex items-center gap-3">
                          <Avatar name={e.name} />
                          <div className="min-w-0">
                            <button type="button" className="font-semibold hover:text-brand-700" onClick={(ev) => { ev.stopPropagation(); setParam({ employee: e.id }); }}>{e.name}</button>
                            <p className="max-w-56 truncate text-xs text-muted">{[e.designation, e.branch].filter(Boolean).join(" · ") || e.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3"><Badge tone="purple">{e.role.name}</Badge></td>
                      <td className="px-3 py-3">{e.stats.openLeads} <span className="text-xs text-muted">/ {e.stats.leads}</span></td>
                      <td className="px-3 py-3">{pct(e.stats.conversion)}</td>
                      <td className="px-3 py-3">{e.stats.files}</td>
                      <td className="px-3 py-3">{e.stats.disbursed ? formatMoney(e.stats.disbursed) : "—"}</td>
                      <td className="px-3 py-3"><TargetBar e={e} /></td>
                      <td className="px-3 py-3 pr-5"><Badge tone={e.status === "active" ? "green" : "gray"}>{e.status === "active" ? "Active" : "Inactive"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line lg:hidden">
              {rows.map((e) => (
                <li key={e.id}>
                  <button type="button" className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setParam({ employee: e.id })}>
                    <Avatar name={e.name} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold">{e.name}</span>
                        <Badge tone={e.status === "active" ? "green" : "gray"}>{e.status === "active" ? "Active" : "Inactive"}</Badge>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted">{e.role.name} · {e.stats.openLeads} open leads · {e.stats.files} files · {pct(e.stats.conversion)} conversion</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <EmployeeDrawer employeeId={openId} team={(all.data ?? list.data)?.employees} onClose={() => setParam({ employee: "" })}
        onEdit={(employee) => setForm({ employee })} onChanged={refresh} />
      <EmployeeForm open={!!form} employee={form?.employee} roles={list.data?.roles ?? []} branches={list.data?.branches ?? []}
        onClose={() => setForm(null)} onSaved={(text) => { setForm(null); setFlash({ tone: "success", text }); refresh(); }} />
    </>
  );
}
