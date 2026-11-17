import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Download, FileText, Plus, Search, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Avatar, Button, Card, EmptyState, Input, Pagination, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { STAGE_ORDER, STAGES, StageBadge, useApplicationMeta } from "../../lib/applications";
import { formatCount, formatMoney, timeAgo } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";
import ApplicationForm from "./ApplicationForm";
import StageDialog from "./StageDialog";

const PAGE_SIZE = 25;
const FILTERS = ["q", "stage", "lenderId", "loanType", "assignee"];
const ageDays = (d) => Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000));

export default function Applications() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const meta = useApplicationMeta().data;
  const view = params.get("view") === "pipeline" ? "pipeline" : "table";
  const [q, setQ] = useState(params.get("q") ?? "");
  const term = useDebounced(q.trim());
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState(null);

  // Builds on window.location: two quick changes would otherwise start from a stale copy of the URL.
  const setParam = (changes) => {
    const n = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) (v === "" || v == null ? n.delete(k) : n.set(k, v));
    if (Object.keys(changes).some((k) => k !== "page" && k !== "view")) n.delete("page");
    setParams(n);
  };
  useEffect(() => { if ((params.get("q") ?? "") !== term) setParam({ q: term }); }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ""]).filter(([, v]) => v));
  const sort = params.get("sort") ?? "updated";
  const dir = params.get("dir") ?? "desc";
  const page = Number(params.get("page") ?? 1);
  const list = useQuery({
    queryKey: ["applications", { ...filters, sort, dir, page }],
    queryFn: () => api.applications({ ...filters, sort, dir, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const boardFilters = { ...filters };
  delete boardFilters.stage;
  const board = useQuery({ queryKey: ["applications-board", boardFilters], queryFn: () => api.applicationsBoard(boardFilters), placeholderData: keepPreviousData, enabled: view === "pipeline" });
  const exporting = useMutation({ mutationFn: () => api.exportApplications({ ...filters, sort, dir }), onError: (e) => setFlash({ tone: "error", text: e.message }) });

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">Application Management</h1>
          <p className="mt-1 text-sm text-muted">Track every loan file through login, verification, credit, sanction and disbursal.</p>
        </div>
        <div className="flex gap-2">
          {can("applications.export") && <Button variant="secondary" icon={Download} loading={exporting.isPending} onClick={() => exporting.mutate()}>Export</Button>}
          {can("applications.create") && <Button icon={Plus} onClick={() => setCreating(true)}>New application</Button>}
        </div>
      </div>
      {flash && <div className="mb-4"><Alert tone={flash.tone}>{flash.text}</Alert></div>}

      <section aria-label="Applications by stage" className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {(list.data?.stages ?? STAGE_ORDER.map((s) => ({ stage: s, count: null, amount: null }))).map((s) => {
          const active = filters.stage === s.stage;
          return (
            <button key={s.stage} type="button" aria-pressed={active} onClick={() => setParam({ stage: active ? "" : s.stage })}
              className={`rounded-2xl border bg-white p-3 text-left transition-colors ${active ? "border-brand-500 ring-2 ring-brand-100" : "border-line hover:border-brand-200"}`}>
              <span className="text-xs font-semibold text-muted">{STAGES[s.stage][0]}</span>
              <span className="mt-0.5 block text-xl font-extrabold">{s.count == null ? "…" : formatCount(s.count)}</span>
              <span className="block text-xs text-muted">{s.amount == null ? "" : formatMoney(s.amount)}</span>
            </button>
          );
        })}
      </section>

      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-0 flex-1 basis-60">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input type="search" placeholder="Search application ID, customer, phone, lender…" aria-label="Search applications" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="View">
              {[["table", "Table", Table2], ["pipeline", "Pipeline", Columns3]].map(([id, label, Icon]) => (
                <button key={id} type="button" aria-pressed={view === id} onClick={() => setParam({ view: id === "table" ? "" : id })}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${view === id ? "bg-brand-700 text-white" : "text-muted hover:text-ink"}`}>
                  <Icon className="size-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select aria-label="Product" value={filters.loanType ?? ""} onChange={(e) => setParam({ loanType: e.target.value })}>
              <option value="">All products</option>
              {meta?.loanTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
            <Select aria-label="Lender" value={filters.lenderId ?? ""} onChange={(e) => setParam({ lenderId: e.target.value })}>
              <option value="">All lenders</option>
              {meta?.lenders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select aria-label="Handled by" value={filters.assignee ?? ""} onChange={(e) => setParam({ assignee: e.target.value })}>
              <option value="">Everyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
              {meta?.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
        </div>
        {view === "table" ? (
          <AppTable list={list} filters={filters} sort={sort} dir={dir} page={page} setParam={setParam} onOpen={(id) => navigate(`/applications/${id}`)} />
        ) : (
          <Pipeline board={board} onFlash={setFlash} />
        )}
      </Card>

      {creating && <ApplicationForm onClose={() => setCreating(false)} onSaved={(d) => { setCreating(false); navigate(`/applications/${d.application.id}`, { state: { flash: `${d.application.ref} created.` } }); }} />}
    </>
  );
}

function SortHeader({ label, field, sort, dir, setParam, className = "" }) {
  const active = sort === field;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className={`px-3 py-3 ${className}`} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-ink" onClick={() => setParam({ sort: field, dir: active && dir === "desc" ? "asc" : "desc" })}>
        {label} <Icon className="size-3.5" aria-hidden />
      </button>
    </th>
  );
}

function AppTable({ list, filters, sort, dir, page, setParam, onOpen }) {
  const rows = list.data?.applications ?? [];
  if (list.isPending) return <Spinner label="Loading applications" />;
  if (list.isError) return <div className="p-5"><Alert>{list.error.message}</Alert></div>;
  if (!rows.length) return <EmptyState icon={FileText} title="No applications found">{Object.keys(filters).length ? "Try clearing a filter or searching for something else." : "Applications appear when customers apply on the website, a lead is converted, or you create one."}</EmptyState>;
  return (
    <div className={list.isFetching ? "opacity-60 transition-opacity" : ""}>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] font-bold uppercase tracking-wider text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="px-3 py-3 pl-5">Application</th>
              <th scope="col" className="px-3 py-3">Customer</th>
              <th scope="col" className="px-3 py-3">Product</th>
              <SortHeader label="Amount" field="amount" sort={sort} dir={dir} setParam={setParam} />
              <th scope="col" className="px-3 py-3">Lender</th>
              <th scope="col" className="px-3 py-3">Stage</th>
              <th scope="col" className="px-3 py-3">Owner</th>
              <SortHeader label="Age" field="created" sort={sort} dir={dir} setParam={setParam} />
              <SortHeader label="Updated" field="updated" sort={sort} dir={dir} setParam={setParam} className="pr-5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-canvas/70" onClick={() => onOpen(a.id)}>
                <td className="px-3 py-3 pl-5"><Link to={`/applications/${a.id}`} onClick={(e) => e.stopPropagation()} className="font-bold text-brand-700 hover:underline">{a.ref}</Link></td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2.5"><Avatar name={a.customerName} size="sm" /><div className="min-w-0"><p className="truncate font-semibold">{a.customerName}</p><p className="text-xs text-muted">{a.customerCity ?? a.customerCode}</p></div></div>
                </td>
                <td className="px-3 py-3">{a.loanType.replace(/ Loan$/, "")}</td>
                <td className="whitespace-nowrap px-3 py-3 font-semibold">{formatMoney(a.loanAmount)}</td>
                <td className="px-3 py-3">{a.lenderName}</td>
                <td className="px-3 py-3"><StageBadge stage={a.stage} /></td>
                <td className="px-3 py-3">{a.assigneeName ?? <span className="text-muted">Unassigned</span>}</td>
                <td className="px-3 py-3 text-muted">{ageDays(a.createdAt)}d</td>
                <td className="whitespace-nowrap px-3 py-3 pr-5 text-muted">{timeAgo(a.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line lg:hidden">
        {rows.map((a) => (
          <li key={a.id}>
            <button type="button" className="w-full p-4 text-left" onClick={() => onOpen(a.id)}>
              <span className="flex items-start justify-between gap-2"><span className="font-bold text-brand-700">{a.ref}</span><StageBadge stage={a.stage} /></span>
              <span className="mt-1 block font-semibold">{a.customerName} · {formatMoney(a.loanAmount)}</span>
              <span className="block truncate text-xs text-muted">{a.loanType} · {a.lenderName} · {a.assigneeName ?? "Unassigned"} · updated {timeAgo(a.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setParam({ page: p === 1 ? "" : p })} />
    </div>
  );
}

function Pipeline({ board, onFlash }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [pending, setPending] = useState(null); // { application (full detail), moves, target }
  // Dropping only opens the move dialog: the server decides whether the move is allowed and what it needs.
  const drop = async (stage) => {
    setOver(null);
    const card = drag;
    setDrag(null);
    if (!card || card.stage === stage) return;
    try {
      const d = await api.application(card.id);
      const m = d.moves.find((x) => x.stage === stage);
      if (!m) return onFlash({ tone: "error", text: d.moves.length ? `${card.ref} can’t move to ${STAGES[stage][0]} from ${STAGES[card.stage][0]}. Allowed: ${d.moves.map((x) => x.label).join(", ")}.` : `${card.ref} can’t be moved by your role, or it’s closed.` });
      setPending({ application: d.application, moves: d.moves, target: stage });
    } catch (e) { onFlash({ tone: "error", text: e.message }); }
  };
  if (board.isPending) return <Spinner label="Loading pipeline" />;
  if (board.isError) return <div className="p-5"><Alert>{board.error.message}</Alert></div>;
  return (
    <>
      <p className="px-4 pt-3 text-xs text-muted">Drag a card to its next stage; you’ll be asked for anything the stage needs. Each column shows its 50 most recently updated files.</p>
      <div className={`flex gap-3 overflow-x-auto p-4 ${board.isFetching ? "opacity-60" : ""}`}>
        {board.data.columns.map((col) => (
          <section key={col.stage} aria-label={`${col.label}: ${col.count} applications`}
            onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(col.stage); } }}
            onDragLeave={() => setOver((o) => (o === col.stage ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(col.stage); }}
            className={`flex w-72 shrink-0 flex-col rounded-2xl border bg-canvas/60 ${over === col.stage ? "border-brand-500 bg-brand-50" : "border-line"}`}>
            <header className="flex items-center justify-between gap-2 px-3 py-2.5"><StageBadge stage={col.stage} /><span className="text-xs text-muted">{formatCount(col.count)} · {formatMoney(col.amount)}</span></header>
            <ul className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
              {col.applications.map((a) => (
                <li key={a.id} draggable={!["disbursed", "rejected"].includes(a.stage)} onDragStart={(e) => { setDrag(a); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", a.id); }} onDragEnd={() => { setDrag(null); setOver(null); }}
                  className={`rounded-xl border border-line bg-white p-3 shadow-sm ${drag?.id === a.id ? "opacity-50" : ""}`}>
                  <Link to={`/applications/${a.id}`} className="block">
                    <span className="flex justify-between gap-2"><span className="font-bold text-brand-700">{a.ref}</span><span className="text-sm font-semibold">{formatMoney(a.loanAmount)}</span></span>
                    <span className="mt-1 block truncate text-sm font-semibold">{a.customerName}</span>
                    <span className="block truncate text-xs text-muted">{a.loanType.replace(/ Loan$/, "")} · {a.lenderName}</span>
                    <span className="mt-2 flex justify-between text-[11px] text-muted"><span>{a.assigneeName?.split(" ")[0] ?? "Unassigned"}</span><span>{timeAgo(a.updatedAt)}</span></span>
                  </Link>
                </li>
              ))}
              {!col.applications.length && <li className="px-2 py-6 text-center text-xs text-muted">No applications</li>}
            </ul>
          </section>
        ))}
      </div>
      {pending && <StageDialog application={pending.application} moves={pending.moves} target={pending.target} onClose={() => setPending(null)}
        onDone={(d, stage) => { setPending(null); onFlash({ tone: "success", text: `${d.application.ref} moved to ${STAGES[stage][0]}.` }); }} />}
    </>
  );
}
