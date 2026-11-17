import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Download, Plus, Search, Table2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Avatar, Button, Card, EmptyState, Field, Input, Modal, Pagination, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatCount, formatDate, formatMoney, timeAgo } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";
import { HotIcon, LEAD_STATUS, requirement, STATUS_ORDER, StatusBadge, TemperatureBadge, useLabels, useLeadMeta, useLeadRefresh } from "../../lib/leads";
import LeadDrawer from "./LeadDrawer";
import LeadForm from "./LeadForm";

const PAGE_SIZE = 25;
const FILTER_KEYS = ["q", "status", "source", "loanType", "owner", "temperature", "city"];

export default function Leads() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const meta = useLeadMeta();
  const labels = useLabels();
  const refresh = useLeadRefresh();
  const view = params.get("view") === "board" ? "board" : "table";
  const [q, setQ] = useState(params.get("q") ?? "");
  const term = useDebounced(q.trim());
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState(null);

  /**
   * Updates URL params; any filter change goes back to page 1. Builds on window.location rather than the
   * router's copy: two quick changes in a row would otherwise start from a stale URL and undo the first one.
   */
  const setParam = (changes) => {
    const n = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) (v === "" || v == null ? n.delete(k) : n.set(k, v));
    if (Object.keys(changes).some((k) => FILTER_KEYS.includes(k) || k === "sort" || k === "dir")) n.delete("page");
    setParams(n);
  };
  useEffect(() => { if ((params.get("q") ?? "") !== term) setParam({ q: term }); }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""]).filter(([, v]) => v));
  const sort = params.get("sort") ?? "created";
  const dir = params.get("dir") ?? "desc";
  const page = Number(params.get("page") ?? 1);
  const openLead = params.get("lead");

  const listQ = useQuery({
    queryKey: ["leads", { ...filters, sort, dir, page }],
    queryFn: () => api.leads({ ...filters, sort, dir, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    enabled: view === "table",
  });
  const boardFilters = { ...filters };
  delete boardFilters.status;
  const boardQ = useQuery({ queryKey: ["leads-board", boardFilters], queryFn: () => api.leadsBoard(boardFilters), placeholderData: keepPreviousData, enabled: view === "board" });

  const counts = view === "table" ? listQ.data?.statusCounts : Object.fromEntries((boardQ.data?.columns ?? []).map((c) => [c.status, c.count]));
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;

  const exporting = useMutation({ mutationFn: () => api.exportLeads({ ...filters, sort, dir }), onError: (e) => setFlash({ tone: "error", text: e.message }) });

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">Lead Management</h1>
          <p className="mt-1 text-sm text-muted">
            {total == null ? "Loading…" : `${formatCount(total)} ${total === 1 ? "lead" : "leads"}${filters.q || Object.keys(filters).length ? " match your filters" : ""} · ${formatCount(counts.new ?? 0)} new waiting for first contact`}
          </p>
        </div>
        <div className="flex gap-2">
          {can("leads.export") && <Button variant="secondary" icon={Download} loading={exporting.isPending} onClick={() => exporting.mutate()}>Export</Button>}
          {can("leads.create") && <Button icon={Plus} onClick={() => setAdding(true)}>Add lead</Button>}
        </div>
      </div>

      {flash && <div className="mb-4"><Alert tone={flash.tone}>{flash.text}</Alert></div>}

      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-0 flex-1 basis-60">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input type="search" placeholder="Search name, phone, email, lead ID…" aria-label="Search leads" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="View">
              {[["table", "Table", Table2], ["board", "Board", Columns3]].map(([id, label, Icon]) => (
                <button key={id} type="button" aria-pressed={view === id} onClick={() => setParam({ view: id === "table" ? "" : id })}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${view === id ? "bg-brand-700 text-white" : "text-muted hover:text-ink"}`}>
                  <Icon className="size-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Select aria-label="Source" value={filters.source ?? ""} onChange={(e) => setParam({ source: e.target.value })}>
              <option value="">All sources</option>
              {meta.data?.sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
            <Select aria-label="Product" value={filters.loanType ?? ""} onChange={(e) => setParam({ loanType: e.target.value })}>
              <option value="">All products</option>
              {meta.data?.loanTypes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
            <Select aria-label="Employee" value={filters.owner ?? ""} onChange={(e) => setParam({ owner: e.target.value })}>
              <option value="">All owners</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
              {can("leads.assign") && meta.data?.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
            <Select aria-label="City" value={filters.city ?? ""} onChange={(e) => setParam({ city: e.target.value })}>
              <option value="">All cities</option>
              {meta.data?.cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select aria-label="Temperature" value={filters.temperature ?? ""} onChange={(e) => setParam({ temperature: e.target.value })}>
              <option value="">Hot, warm &amp; cold</option>
              <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
            </Select>
          </div>
        </div>

        {view === "table" ? (
          <LeadTable query={listQ} counts={counts} total={total} filters={filters} sort={sort} dir={dir} page={page} labels={labels} meta={meta.data}
            setParam={setParam} onOpen={(id) => setParam({ lead: id })} onFlash={setFlash} refresh={refresh} />
        ) : (
          <LeadBoard query={boardQ} labels={labels} onOpen={(id) => setParam({ lead: id })} onFlash={setFlash} refresh={refresh} />
        )}
      </Card>

      {adding && (
        <LeadForm open onClose={() => setAdding(false)} onSaved={(lead) => { setAdding(false); setFlash({ tone: "success", text: `${lead.ref} added${lead.ownerName ? ` and assigned to ${lead.ownerName}` : ""}.` }); setParam({ lead: lead.id }); }} />
      )}
      <LeadDrawer leadId={openLead} onClose={() => setParam({ lead: "" })} />
    </>
  );
}

/* ---------- table ---------- */

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

function LeadTable({ query, counts, filters, sort, dir, page, labels, meta, setParam, onOpen, onFlash, refresh }) {
  const { can } = useAuth();
  const [selected, setSelected] = useState(new Set());
  const [bulk, setBulk] = useState(null); // { action, ownerId?, status?, lostReason? }
  const rows = query.data?.leads ?? [];
  const canBulk = can("leads.assign") || can("leads.edit") || can("leads.delete");
  useEffect(() => setSelected(new Set()), [query.data]);

  const runBulk = useMutation({
    mutationFn: (body) => api.bulkLeads({ ...body, ids: [...selected] }),
    onSuccess: (r) => { setBulk(null); refresh(); onFlash({ tone: "success", text: `${r.changed} lead${r.changed === 1 ? "" : "s"} updated${r.skipped ? `; ${r.skipped} skipped (converted or not visible to you)` : ""}.` }); },
    onError: (e) => onFlash({ tone: "error", text: e.message }),
  });
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <>
      <nav aria-label="Status" className="overflow-x-auto border-b border-line px-2">
        <ul className="flex min-w-max">
          {[["", "All"], ...STATUS_ORDER.map((s) => [s, LEAD_STATUS[s][0]])].map(([id, label]) => {
            const active = (filters.status ?? "") === id;
            const n = id ? counts?.[id] : counts && Object.values(counts).reduce((a, b) => a + b, 0);
            return (
              <li key={id || "all"}>
                <button type="button" onClick={() => setParam({ status: id })} aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-semibold ${active ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink"}`}>
                  {label} <span className={`rounded-full px-1.5 text-[11px] ${active ? "bg-brand-700 text-white" : "bg-canvas text-muted"}`}>{n ?? "·"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-50 px-4 py-2.5 text-sm" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          {can("leads.assign") && <Button variant="secondary" size="sm" icon={UserPlus} onClick={() => setBulk({ action: "assign", ownerId: "" })}>Assign</Button>}
          {can("leads.edit") && <Button variant="secondary" size="sm" onClick={() => setBulk({ action: "status", status: "contacted", lostReason: "" })}>Change status</Button>}
          {can("leads.delete") && <Button variant="danger" size="sm" onClick={() => setBulk({ action: "delete" })}>Delete</Button>}
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {query.isPending ? <Spinner label="Loading leads" /> : query.isError ? <div className="p-5"><Alert>{query.error.message}</Alert></div> : !rows.length ? (
        <EmptyState icon={Search} title="No leads found">{Object.keys(filters).length ? "Try clearing a filter or searching for something else." : "Add a lead, or wait for website enquiries to arrive."}</EmptyState>
      ) : (
        <div className={query.isFetching ? "opacity-60 transition-opacity" : ""}>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] font-bold uppercase tracking-wider text-muted">
                <tr className="border-b border-line">
                  {canBulk && (
                    <th scope="col" className="w-10 pl-5 pr-1">
                      <input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))} className="size-4 accent-brand-700" />
                    </th>
                  )}
                  <SortHeader label="Lead" field="name" sort={sort} dir={dir} setParam={setParam} className={canBulk ? "" : "pl-5"} />
                  <SortHeader label="Requirement" field="amount" sort={sort} dir={dir} setParam={setParam} />
                  <th scope="col" className="px-3 py-3">Source</th>
                  <th scope="col" className="px-3 py-3">Status</th>
                  <th scope="col" className="px-3 py-3">Owner</th>
                  <SortHeader label="Last contact" field="lastContact" sort={sort} dir={dir} setParam={setParam} />
                  <SortHeader label="Created" field="created" sort={sort} dir={dir} setParam={setParam} className="pr-5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((l) => {
                  const req = requirement(l, labels);
                  return (
                    <tr key={l.id} className="cursor-pointer hover:bg-canvas/70" onClick={() => onOpen(l.id)}>
                      {canBulk && (
                        <td className="pl-5 pr-1" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="size-4 accent-brand-700" />
                        </td>
                      )}
                      <td className={`px-3 py-3 ${canBulk ? "" : "pl-5"}`}>
                        <div className="flex items-center gap-3">
                          <Avatar name={l.name} size="sm" />
                          <div className="min-w-0">
                            <button type="button" className="flex items-center gap-1.5 text-left font-semibold hover:text-brand-700" onClick={(e) => { e.stopPropagation(); onOpen(l.id); }}>
                              {l.name} <HotIcon value={l.temperature} />
                            </button>
                            <p className="text-xs text-muted">{l.ref} · +91 {l.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3"><p className="font-medium">{req.product}</p><p className="text-xs text-muted">{req.where}</p></td>
                      <td className="px-3 py-3 text-muted">{labels.source(l.source)}</td>
                      <td className="px-3 py-3"><StatusBadge status={l.status} /></td>
                      <td className="px-3 py-3">{l.ownerName ?? <span className="text-muted">Unassigned</span>}</td>
                      <td className="px-3 py-3 text-muted">{l.lastContactedAt ? timeAgo(l.lastContactedAt) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-3 pr-5 text-muted">{formatDate(l.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-line lg:hidden">
            {rows.map((l) => {
              const req = requirement(l, labels);
              return (
                <li key={l.id} className="flex gap-3 p-4">
                  {canBulk && <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="mt-1 size-4 accent-brand-700" />}
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(l.id)}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-semibold">{l.name} <HotIcon value={l.temperature} /></span>
                        <span className="block text-xs text-muted">{l.ref} · +91 {l.phone}</span>
                      </span>
                      <StatusBadge status={l.status} />
                    </span>
                    <span className="mt-1.5 block text-sm">{req.product}</span>
                    <span className="block text-xs text-muted">{[req.where, labels.source(l.source), l.ownerName ?? "Unassigned"].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={query.data.total} onPage={(p) => setParam({ page: p === 1 ? "" : p })} />
        </div>
      )}

      <Modal
        open={Boolean(bulk)}
        onClose={() => setBulk(null)}
        title={bulk?.action === "assign" ? `Assign ${selected.size} leads` : bulk?.action === "status" ? `Change status of ${selected.size} leads` : `Delete ${selected.size} leads?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulk(null)}>Cancel</Button>
            <Button
              variant={bulk?.action === "delete" ? "danger" : "primary"}
              loading={runBulk.isPending}
              disabled={bulk?.action === "status" && bulk.status === "lost" && (bulk.lostReason ?? "").trim().length < 2}
              onClick={() => runBulk.mutate(bulk.action === "assign" ? { action: "assign", ownerId: bulk.ownerId || null } : bulk.action === "status" ? { action: "status", status: bulk.status, ...(bulk.status === "lost" ? { lostReason: bulk.lostReason.trim() } : {}) } : { action: "delete" })}
            >
              {bulk?.action === "delete" ? "Delete" : "Apply"}
            </Button>
          </>
        }
      >
        {bulk?.action === "assign" && (
          <Field label="Assign to">
            {(a) => (
              <Select {...a} value={bulk.ownerId} onChange={(e) => setBulk({ ...bulk, ownerId: e.target.value })}>
                <option value="">Unassigned</option>
                {meta?.owners.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.roleName}</option>)}
              </Select>
            )}
          </Field>
        )}
        {bulk?.action === "status" && (
          <div className="space-y-3">
            <Field label="New status">
              {(a) => (
                <Select {...a} value={bulk.status} onChange={(e) => setBulk({ ...bulk, status: e.target.value })}>
                  {STATUS_ORDER.filter((s) => s !== "converted").map((s) => <option key={s} value={s}>{LEAD_STATUS[s][0]}</option>)}
                </Select>
              )}
            </Field>
            {bulk.status === "lost" && <Field label="Why were they lost?">{(a) => <Input {...a} value={bulk.lostReason} onChange={(e) => setBulk({ ...bulk, lostReason: e.target.value })} />}</Field>}
          </div>
        )}
        {bulk?.action === "delete" && <p className="text-sm text-muted">They disappear from lists and the board; their history is kept. Converted leads are skipped.</p>}
        <p className="mt-3 text-xs text-muted">Converted leads are never changed in bulk.</p>
      </Modal>
    </>
  );
}

/* ---------- board ---------- */

function LeadBoard({ query, labels, onOpen, onFlash, refresh }) {
  const { can } = useAuth();
  const [dragging, setDragging] = useState(null); // lead being dragged
  const [over, setOver] = useState(null);
  const [lost, setLost] = useState(null); // { lead, reason }
  const canMove = can("leads.edit");
  const move = useMutation({
    mutationFn: ({ lead, status, lostReason }) => api.updateLead(lead.id, { status, ...(lostReason ? { lostReason } : {}) }),
    onSuccess: (_r, { lead, status }) => { refresh(lead.id); onFlash({ tone: "success", text: `${lead.name} moved to ${LEAD_STATUS[status][0]}.` }); },
    onError: (e) => onFlash({ tone: "error", text: e.message }),
  });

  const drop = (status) => {
    setOver(null);
    const lead = dragging;
    setDragging(null);
    if (!lead || lead.status === status) return;
    if (lead.status === "converted") return onFlash({ tone: "error", text: "Converted leads stay converted." });
    if (status === "converted") return onFlash({ tone: "error", text: "Open the lead and use “Convert to application” to convert it." });
    if (status === "lost") return setLost({ lead, reason: "" });
    move.mutate({ lead, status });
  };

  if (query.isPending) return <Spinner label="Loading board" />;
  if (query.isError) return <div className="p-5"><Alert>{query.error.message}</Alert></div>;

  return (
    <>
      <p className="px-4 pt-3 text-xs text-muted">{canMove ? "Drag a card to another column to change its status, or open it to make changes." : "Open a card to see the lead."} Each column shows its 50 most recently updated leads.</p>
      <div className={`flex gap-3 overflow-x-auto p-4 ${query.isFetching ? "opacity-60" : ""}`}>
        {query.data.columns.map((col) => (
          <section
            key={col.status}
            aria-label={`${col.label}: ${col.count} leads`}
            onDragOver={(e) => { if (canMove && dragging) { e.preventDefault(); setOver(col.status); } }}
            onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(col.status); }}
            className={`flex w-72 shrink-0 flex-col rounded-2xl border bg-canvas/60 ${over === col.status ? "border-brand-500 bg-brand-50" : "border-line"}`}
          >
            <header className="flex items-center justify-between gap-2 px-3 py-2.5">
              <StatusBadge status={col.status} />
              <span className="text-xs text-muted">{formatCount(col.count)} · {formatMoney(col.amount)}</span>
            </header>
            <ul className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
              {col.leads.map((l) => {
                const req = requirement(l, labels);
                return (
                  <li
                    key={l.id}
                    draggable={canMove && l.status !== "converted"}
                    onDragStart={(e) => { setDragging(l); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", l.id); }}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    className={`rounded-xl border border-line bg-white p-3 shadow-sm ${dragging?.id === l.id ? "opacity-50" : ""} ${canMove && l.status !== "converted" ? "cursor-grab active:cursor-grabbing" : ""}`}
                  >
                    <button type="button" className="w-full text-left" onClick={() => onOpen(l.id)}>
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{l.name}</span>
                        <TemperatureBadge value={l.temperature} />
                      </span>
                      <span className="mt-1 block text-xs text-muted">{[req.product, l.city].filter((x) => x && x !== "—").join(" · ") || "No requirement yet"}</span>
                      <span className="mt-2 flex justify-between text-[11px] text-muted">
                        <span>{l.ownerName?.split(" ")[0] ?? "Unassigned"}</span>
                        <span>{timeAgo(l.updatedAt)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {!col.leads.length && <li className="px-2 py-6 text-center text-xs text-muted">No leads</li>}
            </ul>
          </section>
        ))}
      </div>

      <Modal
        open={Boolean(lost)}
        onClose={() => setLost(null)}
        title={`Mark ${lost?.lead.name ?? "lead"} lost?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLost(null)}>Cancel</Button>
            <Button variant="danger" disabled={(lost?.reason ?? "").trim().length < 2} loading={move.isPending}
              onClick={() => move.mutate({ lead: lost.lead, status: "lost", lostReason: lost.reason.trim() }, { onSuccess: () => setLost(null) })}>Mark lost</Button>
          </>
        }
      >
        <Field label="Why was it lost?">{(a) => <Input {...a} value={lost?.reason ?? ""} onChange={(e) => setLost({ ...lost, reason: e.target.value })} autoFocus />}</Field>
      </Modal>
    </>
  );
}
