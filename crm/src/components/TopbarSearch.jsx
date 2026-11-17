import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Search, UserPlus, Users, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatMoney, timeAgo } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { Badge } from "./ui";

const LEAD_STATUS_LABEL = { new: "New", contacted: "Contacted", interested: "Interested", docs_pending: "Docs pending", qualified: "Qualified", converted: "Converted", lost: "Lost" };
const STATUS = { submitted: ["Submitted", "gray"], in_review: ["In review", "amber"], approved: ["Approved", "green"], disbursed: ["Disbursed", "purple"], rejected: ["Rejected", "red"] };

function Group({ title, icon: Icon, items, render }) {
  if (!items?.length) return null;
  return (
    <div className="py-1">
      <p className="flex items-center gap-1.5 px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted">
        <Icon className="size-3.5" aria-hidden /> {title}
      </p>
      <ul>{items.map(render)}</ul>
    </div>
  );
}

/** Global search over leads, customers and applications. The server only searches what the role may view. */
export default function TopbarSearch({ autoFocus = false, onClose }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const term = useDebounced(q.trim(), 250);
  const ref = useRef(null);
  const panelId = useId();
  const enabled = term.length >= 2;
  const res = useQuery({ queryKey: ["search", term], queryFn: () => api.search(term), enabled, staleTime: 10_000 });

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const data = res.data;
  const total = data ? [data.leads, data.customers, data.applications].reduce((n, l) => n + (l?.length ?? 0), 0) : 0;
  const nothingSearchable = data && data.leads === null && data.customers === null && data.applications === null;

  return (
    <div className="relative w-full" ref={ref}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); onClose?.(); } }}
        placeholder="Search name, phone, email or reference…"
        aria-label="Search leads, customers and applications"
        aria-expanded={open && enabled}
        aria-controls={panelId}
        className="h-10 w-full rounded-xl border border-line bg-canvas pl-9 pr-9 text-sm placeholder:text-muted/80 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      {onClose && (
        <button type="button" onClick={onClose} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:text-ink" aria-label="Close search">
          <X className="size-4" />
        </button>
      )}
      {open && enabled && (
        <div id={panelId} role="region" aria-label="Search results" aria-live="polite" className="absolute left-0 right-0 top-12 z-30 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-xl">
          {res.isFetching && !data ? (
            <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Searching…</p>
          ) : res.isError ? (
            <p className="px-4 py-4 text-sm text-red-700">{res.error.message}</p>
          ) : nothingSearchable ? (
            <p className="px-4 py-4 text-sm text-muted">Your role doesn’t include leads, customers or applications.</p>
          ) : total === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">No matches for “{term}”.</p>
          ) : (
            <>
              <Group title="Leads" icon={UserPlus} items={data.leads} render={(l) => (
                <li key={l.id}>
                  <Link to={`/leads?lead=${l.id}`} onClick={() => { setOpen(false); onClose?.(); }} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-canvas focus:bg-canvas focus:outline-none">
                    <span className="min-w-0"><span className="block truncate font-semibold">{l.name}</span><span className="block truncate text-xs text-muted">{l.ref} · +91 {l.phone}{l.email ? ` · ${l.email}` : ""}</span></span>
                    <span className="shrink-0 text-right text-xs text-muted">{STATUS[l.status]?.[0] ?? LEAD_STATUS_LABEL[l.status] ?? l.status}<br />{timeAgo(l.createdAt)}</span>
                  </Link>
                </li>
              )} />
              <Group title="Customers" icon={Users} items={data.customers} render={(c) => (
                <li key={c.id}>
                  <Link to={`/customers/${c.id}`} onClick={() => { setOpen(false); onClose?.(); }} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-canvas focus:bg-canvas focus:outline-none">
                    <span className="min-w-0"><span className="block truncate font-semibold">{c.name || c.phone || c.email}</span><span className="block truncate text-xs text-muted">{[c.code, c.phone && `+91 ${c.phone}`, c.email].filter(Boolean).join(" · ")}</span></span>
                    <span className="shrink-0 text-xs text-muted">Joined {timeAgo(c.createdAt)}</span>
                  </Link>
                </li>
              )} />
              <Group title="Applications" icon={FileText} items={data.applications} render={(x) => {
                const [label, tone] = STATUS[x.status] ?? [x.status, "gray"];
                return (
                  <li key={x.id}>
                    <Link to={`/applications/${x.id}`} onClick={() => { setOpen(false); onClose?.(); }} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-canvas focus:bg-canvas focus:outline-none">
                      <span className="min-w-0"><span className="block truncate font-semibold">{x.name ?? "Customer"} · {x.ref}</span><span className="block truncate text-xs text-muted">{x.loanType} · {x.lenderName} · {formatMoney(x.loanAmount)}</span></span>
                      <Badge tone={tone}>{label}</Badge>
                    </Link>
                  </li>
                );
              }} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
