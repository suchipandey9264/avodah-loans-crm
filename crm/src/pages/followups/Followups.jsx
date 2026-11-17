import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, List, Pencil, Phone, Plus, Search, Timer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, Pagination, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatCount, formatDate, formatTime } from "../../lib/format";
import { dayKey, FOLLOWUP_TYPES, FU_STATE, fuType } from "../../lib/followups";
import { useDebounced } from "../../lib/hooks";
import FollowupForm from "./FollowupForm";

const TABS = [["overdue", "Overdue"], ["today", "Today"], ["upcoming", "Upcoming"], ["done", "Completed"], ["all", "All"]];
const PAGE_SIZE = 25;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

export default function Followups() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const term = useDebounced(q.trim());
  const [form, setForm] = useState(null); // {} = new, { followup } = edit
  const [closing, setClosing] = useState(null);
  const [flash, setFlash] = useState(null);

  // Builds on window.location: two quick changes would otherwise start from a stale copy of the URL.
  const setParam = (changes) => {
    const n = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) (v === "" || v == null ? n.delete(k) : n.set(k, v));
    setParams(n);
  };
  useEffect(() => { if ((params.get("q") ?? "") !== term) setParam({ q: term, page: "" }); }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const mode = params.get("mode") === "calendar" ? "calendar" : "list";
  const view = TABS.some(([id]) => id === params.get("view")) ? params.get("view") : "overdue";
  const page = Number(params.get("page")) || 1;
  const filters = { q: term, type: params.get("type") ?? "", assignee: params.get("assignee") ?? "" };
  const meta = useQuery({ queryKey: ["followups-meta"], queryFn: api.followupsMeta, staleTime: 5 * 60_000 });
  const list = useQuery({
    queryKey: ["followups", view, page, filters],
    queryFn: () => api.followups({ ...filters, view, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000, // overdue is time-based
  });
  const c = list.data?.counts;

  const refresh = (text) => {
    setForm(null);
    setClosing(null);
    setFlash({ tone: "success", text });
    queryClient.invalidateQueries({ queryKey: ["followups"] });
    queryClient.invalidateQueries({ queryKey: ["followups-month"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };
  const rowProps = { canEdit: can("followups.edit"), onEdit: (f) => setForm({ followup: f }), onClose: setClosing };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">Follow-ups</h1>
          <p className="mt-1 text-sm text-muted">Calls, meetings and visits scheduled with leads and customers.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="Layout">
            {[["list", "List", List], ["calendar", "Calendar", CalendarDays]].map(([id, label, Icon]) => (
              <button key={id} type="button" aria-pressed={mode === id} onClick={() => setParam({ mode: id === "list" ? "" : id })}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${mode === id ? "bg-brand-50 text-brand-700" : "text-muted hover:text-ink"}`}>
                <Icon className="size-4" aria-hidden />{label}
              </button>
            ))}
          </div>
          {can("followups.create") && <Button icon={Plus} onClick={() => setForm({})}>Schedule follow-up</Button>}
        </div>
      </div>
      {flash && <div className="mb-4"><Alert tone={flash.tone}>{flash.text}</Alert></div>}

      <section aria-label="Follow-up totals" className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label="Overdue" value={c ? formatCount(c.overdue) : "…"} note="Past their time, still pending" icon={AlarmClock} tint="bg-red-50 text-red-700" />
        <Stat label="Due today" value={c ? formatCount(c.today) : "…"} note="Later today" icon={Timer} tint="bg-amber-50 text-amber-700" />
        <Stat label="Upcoming" value={c ? formatCount(c.upcoming) : "…"} note="From tomorrow" icon={CalendarCheck} tint="bg-sky-50 text-sky-700" />
        <Stat label="Completion rate" value={list.data ? (list.data.completionRate == null ? "—" : `${list.data.completionRate}%`) : "…"} note="Due in the last 30 days" icon={CircleCheck} tint="bg-emerald-50 text-emerald-700" />
      </section>

      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" placeholder="Search name, phone, lead or customer ID…" aria-label="Search follow-ups" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select aria-label="Type" value={filters.type} onChange={(e) => setParam({ type: e.target.value, page: "" })}>
            <option value="">All types</option>
            {FOLLOWUP_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </Select>
          {meta.data?.canAssign ? (
            <Select aria-label="Assigned to" value={filters.assignee} onChange={(e) => setParam({ assignee: e.target.value, page: "" })}>
              <option value="">Everyone</option>
              <option value="me">Me</option>
              {meta.data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          ) : <p className="self-center text-sm text-muted">Showing follow-ups assigned to you</p>}
        </div>

        {mode === "calendar" ? <Calendar filters={filters} rowProps={rowProps} /> : (
          <>
            <div className="flex flex-wrap gap-1 border-b border-line px-4 pt-3" role="tablist" aria-label="Status">
              {TABS.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setParam({ view: id === "overdue" ? "" : id, page: "" })}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2.5 text-sm font-semibold ${view === id ? "border-brand-700 text-brand-700" : "border-transparent text-muted hover:text-ink"}`}>
                  {label}
                  {c && <span className={`rounded-full px-1.5 text-xs ${id === "overdue" && c.overdue ? "bg-red-50 text-red-700" : "bg-canvas text-muted"}`}>{c[id]}</span>}
                </button>
              ))}
            </div>
            {list.isPending ? <Spinner label="Loading follow-ups" /> : list.isError ? <div className="p-5"><Alert>{list.error.message}</Alert></div> : !list.data.items.length ? (
              <EmptyState icon={CalendarCheck} title={view === "overdue" ? "Nothing overdue" : "No follow-ups here"}>
                {filters.q || filters.type || filters.assignee ? "Try clearing a filter." : view === "overdue" ? "Every follow-up is on time." : "Schedule one from a lead, a customer, or the button above."}
              </EmptyState>
            ) : (
              <>
                <ul className="divide-y divide-line">{list.data.items.map((f) => <Row key={f.id} f={f} {...rowProps} />)}</ul>
                <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setParam({ page: p === 1 ? "" : p })} />
              </>
            )}
          </>
        )}
      </Card>

      <FollowupForm open={!!form} followup={form?.followup} onClose={() => setForm(null)} onSaved={refresh} />
      <CloseDialog followup={closing} onClose={() => setClosing(null)} onDone={refresh} />
    </>
  );
}

/** One follow-up: who, when, what, and what can be done with it. */
function Row({ f, canEdit, onEdit, onClose }) {
  const [label, tone] = FU_STATE[f.state];
  const open = f.state === "pending" || f.state === "overdue";
  const href = f.customerId ? `/customers/${f.customerId}` : `/leads?lead=${f.leadId}`;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm sm:px-5">
      <div className="w-24 shrink-0">
        <p className={`font-semibold ${f.state === "overdue" ? "text-red-700" : ""}`}>{formatTime(f.dueAt)}</p>
        <p className="text-xs text-muted">{formatDate(f.dueAt)}</p>
      </div>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-semibold">
          <Link to={href} className="hover:text-brand-700 hover:underline">{f.name}</Link>
          <span className="font-normal text-muted"> · {f.customerId ? f.customerCode : f.leadRef}</span>
        </p>
        <p className="truncate text-xs text-muted">
          {fuType(f.type)}{f.note ? ` · ${f.note}` : ""}{f.assignedName ? ` · ${f.assignedName}` : ""}{f.outcome ? ` · Outcome: ${f.outcome}` : ""}
        </p>
      </div>
      <Badge tone={tone}>{label}</Badge>
      <div className="flex gap-1">
        {f.phone && open && <a href={`tel:${f.phone}`} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50" aria-label={`Call ${f.name}`}><Phone className="size-3.5" aria-hidden />Call</a>}
        {canEdit && open && (
          <>
            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => onEdit(f)} aria-label={`Edit follow-up with ${f.name}`} />
            <Button variant="secondary" size="sm" onClick={() => onClose(f)}>Complete</Button>
          </>
        )}
      </div>
    </li>
  );
}

/** Mark a follow-up done (with what happened) or cancel it. */
function CloseDialog({ followup, onClose, onDone }) {
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState(null);
  useEffect(() => { setOutcome(""); setError(null); }, [followup]);
  const close = useMutation({
    mutationFn: (status) => api.updateFollowup(followup.id, { status, ...(outcome.trim() ? { outcome: outcome.trim() } : {}) }),
    onSuccess: (_d, status) => onDone(status === "done" ? "Follow-up completed." : "Follow-up cancelled."),
    onError: (e) => setError(e.message),
  });
  return (
    <Modal open={!!followup} onClose={onClose} title="Complete follow-up"
      footer={<>
        <Button variant="secondary" icon={X} loading={close.isPending && close.variables === "cancelled"} onClick={() => close.mutate("cancelled")}>Cancel follow-up</Button>
        <Button icon={CircleCheck} loading={close.isPending && close.variables === "done"} onClick={() => close.mutate("done")}>Mark completed</Button>
      </>}>
      {followup && (
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <p className="text-sm"><strong>{fuType(followup.type)}</strong> with <strong>{followup.name}</strong>, {formatDate(followup.dueAt)} {formatTime(followup.dueAt)}</p>
          <label className="block text-[13px] font-semibold" htmlFor="fu-outcome">Outcome / remarks</label>
          <textarea id="fu-outcome" rows={3} maxLength={500} className="block w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            placeholder="What happened? (optional)" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}

/** Month grid with a count per day; picking a day lists its follow-ups. */
function Calendar({ filters, rowProps }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [picked, setPicked] = useState(() => dayKey(new Date()));
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const q = useQuery({
    queryKey: ["followups-month", month.toISOString(), filters],
    queryFn: () => api.followups({ ...filters, view: "all", from: month.toISOString(), to: next.toISOString(), pageSize: 500 }),
    placeholderData: keepPreviousData,
  });
  const byDay = {};
  for (const f of q.data?.items ?? []) if (f.state !== "cancelled") (byDay[dayKey(f.dueAt)] ??= []).push(f);
  const lead = (month.getDay() + 6) % 7; // Monday-first
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const today = dayKey(new Date());
  const shift = (n) => { const m = new Date(month.getFullYear(), month.getMonth() + n, 1); setMonth(m); setPicked(dayKey(m)); };
  const items = [...(byDay[picked] ?? [])].sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));

  return (
    <div className="grid gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold" aria-live="polite">{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2>
          <div className="flex gap-1">
            <Button variant="secondary" size="sm" icon={ChevronLeft} onClick={() => shift(-1)} aria-label="Previous month" />
            <Button variant="secondary" size="sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setPicked(today); }}>Today</Button>
            <Button variant="secondary" size="sm" icon={ChevronRight} onClick={() => shift(1)} aria-label="Next month" />
          </div>
        </div>
        {q.isError && <Alert>{q.error.message}</Alert>}
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted">{WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={`x${i}`} />;
            const key = dayKey(d);
            const list = byDay[key] ?? [];
            const overdue = list.filter((f) => f.state === "overdue").length;
            return (
              <button key={key} type="button" onClick={() => setPicked(key)} aria-pressed={picked === key}
                aria-label={`${d.toLocaleDateString("en-IN", { day: "numeric", month: "long" })}: ${list.length} follow-up${list.length === 1 ? "" : "s"}${overdue ? `, ${overdue} overdue` : ""}`}
                className={`flex min-h-14 flex-col items-center rounded-lg border p-1 text-sm sm:min-h-16 ${picked === key ? "border-brand-500 bg-brand-50" : "border-line hover:bg-canvas"}`}>
                <span className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${key === today ? "bg-brand-700 text-white" : ""}`}>{d.getDate()}</span>
                {list.length > 0 && <span className={`mt-1 rounded-full px-1.5 text-[11px] font-bold ${overdue ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-700"}`} aria-hidden>{list.length}</span>}
              </button>
            );
          })}
        </div>
        {q.data && q.data.total > q.data.items.length && <p className="mt-2 text-xs text-muted">Showing the first {q.data.items.length} of {q.data.total} this month — narrow with a filter.</p>}
      </div>
      <div className="min-w-0">
        <h3 className="border-b border-line px-5 py-3 text-sm font-bold">{new Date(`${picked}T00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</h3>
        {q.isPending ? <Spinner label="Loading" /> : !items.length ? <p className="px-5 py-8 text-center text-sm text-muted">No follow-ups on this day.</p> : (
          <ul className="divide-y divide-line">{items.map((f) => <Row key={f.id} f={f} {...rowProps} />)}</ul>
        )}
      </div>
    </div>
  );
}
