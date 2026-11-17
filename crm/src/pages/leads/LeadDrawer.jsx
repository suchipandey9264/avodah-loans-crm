import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarPlus, CheckCircle2, Mail, MessageCircle, Pencil, Phone, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Field, Input, Modal, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate, formatMoney, formatTime, timeAgo } from "../../lib/format";
import { FOLLOWUP_TYPES, FU_STATE, fuType, inAnHour } from "../../lib/followups";
import { CONVERTIBLE, LEAD_STATUS, StatusBadge, useLabels, useLeadMeta, useLeadRefresh } from "../../lib/leads";
import LeadForm from "./LeadForm";


/** One readable line per history entry. */
function describe(e, labels) {
  const m = e.meta ?? {};
  switch (e.type) {
    case "note": return e.body;
    case "status_changed": return `Moved from ${LEAD_STATUS[m.from]?.[0] ?? m.from} to ${LEAD_STATUS[m.to]?.[0] ?? m.to}${m.reason ? ` — ${m.reason}` : ""}${m.bulk ? " (bulk)" : ""}`;
    case "assigned": return m.to ? `Assigned to ${m.toName ?? "an employee"}${m.auto ? " automatically" : ""}${m.bulk ? " (bulk)" : ""}` : "Moved to the unassigned pool";
    case "updated": return `Updated ${Object.keys(m.changes ?? {}).map((k) => ({ loanType: "loan type", loanAmount: "loan amount", annualIncome: "annual income", lostReason: "lost reason" })[k] ?? k).join(", ")}`;
    case "followup_scheduled": return `Scheduled a ${fuType(m.type).toLowerCase()} for ${formatDate(m.dueAt)}, ${formatTime(m.dueAt)}${e.body ? ` — ${e.body}` : ""}`;
    case "followup_done": return `Completed a ${fuType(m.type).toLowerCase()} follow-up${e.body ? ` — ${e.body}` : ""}`;
    case "followup_cancelled": return `Cancelled a ${fuType(m.type).toLowerCase()} follow-up${e.body ? ` — ${e.body}` : ""}`;
    case "followup_rescheduled": return `Rescheduled a ${fuType(m.type).toLowerCase()} to ${formatDate(m.dueAt)}, ${formatTime(m.dueAt)}${e.body ? ` — ${e.body}` : ""}`;
    case "followup_updated": return `Updated a ${fuType(m.type).toLowerCase()} follow-up${e.body ? ` — ${e.body}` : ""}`;
    case "converted": return `Converted: ${m.createdCustomer ? "new customer created" : "linked to existing customer"}, application ${m.applicationRef} with ${m.lender} (${labels.loanType(m.loanType)}, ${formatMoney(m.loanAmount)})`;
    case "deleted": return "Deleted";
    default: return e.type;
  }
}

export default function LeadDrawer({ leadId, onClose }) {
  const ref = useRef(null);
  const { can } = useAuth();
  const labels = useLabels();
  const meta = useLeadMeta().data;
  const refresh = useLeadRefresh();
  const q = useQuery({ queryKey: ["lead", leadId], queryFn: () => api.lead(leadId), enabled: Boolean(leadId) });
  const [flash, setFlash] = useState(null);
  const [editing, setEditing] = useState(false);
  const [askLost, setAskLost] = useState(null); // { reason } while the "mark lost" prompt is open
  const [converting, setConverting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (leadId && !d.open) d.showModal();
    if (!leadId && d.open) d.close();
  }, [leadId]);
  useEffect(() => { setFlash(null); setConverting(false); }, [leadId]);

  const done = (text) => { setFlash({ tone: "success", text }); refresh(leadId); };
  const failed = (err) => setFlash({ tone: "error", text: err.message });
  const update = useMutation({ mutationFn: (body) => api.updateLead(leadId, body), onSuccess: () => done("Saved."), onError: failed });
  const remove = useMutation({ mutationFn: () => api.deleteLead(leadId), onSuccess: () => { setConfirmDelete(false); refresh(leadId); onClose(); }, onError: (e) => { setConfirmDelete(false); failed(e); } });

  const lead = q.data?.lead;
  const converted = lead?.status === "converted";
  const canEdit = can("leads.edit") && !converted;
  const canConvert = can("leads.edit") && can("applications.create") && lead && CONVERTIBLE.includes(lead.status);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={lead ? `Lead ${lead.name}` : "Lead"}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl border-l border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-night/40"
    >
      {leadId && (
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            {lead ? (
              <div className="min-w-0">
                <h2 className="truncate text-lg font-extrabold">{lead.name}</h2>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {lead.ref} · created {formatDate(lead.createdAt)} <StatusBadge status={lead.status} />
                </p>
              </div>
            ) : <span className="text-sm text-muted">Lead</span>}
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Close">
              <X className="size-5" />
            </button>
          </header>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            {q.isPending ? <Spinner label="Loading lead" /> : q.isError ? <Alert>{q.error.message}</Alert> : (
              <>
                {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}

                <div className="grid grid-cols-3 gap-2">
                  <a href={`tel:+91${lead.phone}`} className="flex flex-col items-center gap-1 rounded-xl border border-line py-2.5 text-xs font-semibold hover:bg-brand-50"><Phone className="size-4 text-brand-700" aria-hidden />Call</a>
                  <a href={`https://wa.me/91${lead.phone}`} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 rounded-xl border border-line py-2.5 text-xs font-semibold hover:bg-brand-50"><MessageCircle className="size-4 text-emerald-600" aria-hidden />WhatsApp</a>
                  {lead.email ? (
                    <a href={`mailto:${lead.email}`} className="flex flex-col items-center gap-1 rounded-xl border border-line py-2.5 text-xs font-semibold hover:bg-brand-50"><Mail className="size-4 text-orange-600" aria-hidden />Email</a>
                  ) : (
                    <span className="flex flex-col items-center gap-1 rounded-xl border border-line py-2.5 text-xs font-semibold text-muted/60" aria-disabled="true"><Mail className="size-4" aria-hidden />No email</span>
                  )}
                </div>

                {converted && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
                    <p className="flex items-center gap-2 font-bold text-emerald-800"><CheckCircle2 className="size-4" aria-hidden /> Converted {timeAgo(lead.convertedAt)}</p>
                    <p className="mt-1 text-emerald-900">
                      Application <Link to={`/applications/${lead.applicationId}`} className="font-bold underline">{lead.applicationRef}</Link>
                      {q.data.customer && <> for customer <Link to={`/customers/${q.data.customer.id}`} className="font-bold underline">{q.data.customer.name}</Link> (+91 {q.data.customer.phone})</>}. The lead’s details are kept as they were.
                    </p>
                  </div>
                )}

                {converting && <ConvertPanel lead={lead} meta={meta} onCancel={() => setConverting(false)} onDone={(r) => { setConverting(false); done(`Converted. Application ${r.application.ref} logged with ${r.application.lenderName}${r.customer.created ? "; new customer created." : "; linked to the existing customer."}`); }} />}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  {[
                    ["Phone", `+91 ${lead.phone}`], ["Email", lead.email || "—"],
                    ["City", lead.city || "—"], ["Employment", lead.employment ? labels.employment(lead.employment) : "—"],
                    ["Loan required", lead.loanType ? labels.loanType(lead.loanType) : "—"], ["Amount", lead.loanAmount ? formatMoney(lead.loanAmount) : "—"],
                    ["Annual income", lead.annualIncome ? formatMoney(lead.annualIncome) : "—"], ["Source", labels.source(lead.source)],
                    ["Last contact", lead.lastContactedAt ? timeAgo(lead.lastContactedAt) : "Not yet"], ["Added by", lead.createdByName ?? (lead.kind === "crm" ? "—" : "Website form")],
                  ].map(([k, val]) => (
                    <div key={k} className="min-w-0"><dt className="text-xs text-muted">{k}</dt><dd className="truncate font-semibold">{val}</dd></div>
                  ))}
                  {lead.message && <div className="col-span-2"><dt className="text-xs text-muted">Notes from enquiry</dt><dd className="whitespace-pre-line">{lead.message}</dd></div>}
                  {lead.status === "lost" && lead.lostReason && <div className="col-span-2"><dt className="text-xs text-muted">Lost reason</dt><dd>{lead.lostReason}</dd></div>}
                </dl>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Status">
                    {(a) => (
                      <Select {...a} compact value={lead.status} disabled={!canEdit || update.isPending} onChange={(e) => {
                        const status = e.target.value;
                        if (status === "lost") return setAskLost({ reason: "" });
                        update.mutate({ status });
                      }}>
                        {Object.entries(LEAD_STATUS).map(([id, [label]]) => <option key={id} value={id} disabled={id === "converted" && !converted}>{label}</option>)}
                      </Select>
                    )}
                  </Field>
                  <Field label="Temperature">
                    {(a) => (
                      <Select {...a} compact value={lead.temperature ?? ""} disabled={!canEdit || update.isPending} onChange={(e) => update.mutate({ temperature: e.target.value || null })}>
                        <option value="">—</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Owner">
                    {(a) => (
                      <Select {...a} compact value={lead.ownerId ?? ""} disabled={!canEdit || !can("leads.assign") || update.isPending} onChange={(e) => update.mutate({ ownerId: e.target.value || null })}>
                        <option value="">Unassigned</option>
                        {(meta?.owners ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        {lead.ownerId && !meta?.owners.some((o) => o.id === lead.ownerId) && <option value={lead.ownerId}>{lead.ownerName}</option>}
                      </Select>
                    )}
                  </Field>
                </div>

                <FollowUps leadId={leadId} followups={q.data.followups} canAdd={can("followups.create")} canClose={can("followups.edit")} onChange={done} onError={failed} />
                <Activity leadId={leadId} lead={lead} timeline={q.data.timeline} canNote={can("leads.edit")} labels={labels} onChange={done} onError={failed} />
              </>
            )}
          </div>

          {lead && (
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
              <div className="flex gap-1">
                {canEdit && <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
                {can("leads.delete") && !converted && <Button variant="ghost" size="sm" icon={Trash2} className="text-red-700 hover:bg-red-50" onClick={() => setConfirmDelete(true)}>Delete</Button>}
              </div>
              <div className="flex gap-2">
                {canEdit && lead.status !== "lost" && <Button variant="danger" size="sm" onClick={() => setAskLost({ reason: "" })}>Mark lost</Button>}
                {!converted && can("leads.edit") && can("applications.create") && (
                  <Button
                    size="sm"
                    className="bg-flame-600 hover:bg-orange-700"
                    disabled={!canConvert}
                    title={canConvert ? undefined : "Move the lead to Interested, Docs pending or Qualified first"}
                    onClick={() => setConverting(true)}
                  >
                    Convert to application <ArrowRight className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
              {!converted && can("leads.edit") && can("applications.create") && !canConvert && (
                <p className="w-full text-right text-xs text-muted">Only Interested, Docs pending or Qualified leads can be converted.</p>
              )}
            </footer>
          )}
        </div>
      )}

      {editing && lead && <LeadForm open lead={lead} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); done("Lead updated."); }} />}

      <Modal
        open={Boolean(askLost)}
        onClose={() => setAskLost(null)}
        title="Mark this lead lost?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAskLost(null)}>Cancel</Button>
            <Button variant="danger" disabled={(askLost?.reason ?? "").trim().length < 2} loading={update.isPending}
              onClick={() => update.mutate({ status: "lost", lostReason: askLost.reason.trim() }, { onSuccess: () => setAskLost(null) })}>
              Mark lost
            </Button>
          </>
        }
      >
        <Field label="Why was it lost?" hint="e.g. Not eligible, chose another lender, not reachable">
          {(a) => <Input {...a} value={askLost?.reason ?? ""} onChange={(e) => setAskLost({ reason: e.target.value })} autoFocus />}
        </Field>
      </Modal>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${lead?.ref ?? "lead"}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Delete lead</Button>
          </>
        }
      >
        <p className="text-sm text-muted">The lead disappears from lists and the board. Its history is kept and the deletion is recorded in the audit log.</p>
      </Modal>
    </dialog>
  );
}

function ConvertPanel({ lead, meta, onCancel, onDone }) {
  const [v, setV] = useState({ lenderId: "", loanType: lead.loanType ?? "home", loanAmount: lead.loanAmount ? String(lead.loanAmount) : "", tenureMonths: "", note: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const convert = useMutation({
    mutationFn: () => api.convertLead(lead.id, {
      lenderId: v.lenderId, loanType: v.loanType, loanAmount: Number(v.loanAmount.replace(/[,\s₹]/g, "")),
      ...(v.tenureMonths ? { tenureMonths: Number(v.tenureMonths) } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}),
    }),
    onSuccess: onDone,
    onError: (err) => { setFormError(err.message); setErrors(err.fields ?? {}); },
  });
  const submit = (e) => {
    e.preventDefault();
    const next = {};
    if (!v.lenderId) next.lenderId = "Choose a lender";
    if (!(Number(v.loanAmount.replace(/[,\s₹]/g, "")) > 0)) next.loanAmount = "Enter the loan amount";
    setErrors(next);
    if (!Object.keys(next).length) convert.mutate();
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-orange-200 bg-flame-50 p-4">
      <div>
        <p className="font-bold">Create customer &amp; log application</p>
        <p className="text-xs text-muted">Finds the customer by mobile number (or creates one), then logs the file with the lender you pick. This can only happen once per lead.</p>
      </div>
      {formError && <Alert>{formError}</Alert>}
      <Field label="Lender" error={errors.lenderId}>
        {(a) => (
          <Select {...a} value={v.lenderId} onChange={set("lenderId")} autoFocus>
            <option value="">Choose lender…</option>
            {(meta?.lenders ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}{l.kind ? ` · ${l.kind}` : ""}</option>)}
          </Select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Loan type" error={errors.loanType}>
          {(a) => <Select {...a} value={v.loanType} onChange={set("loanType")}>{(meta?.loanTypes ?? []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>}
        </Field>
        <Field label="Amount (₹)" error={errors.loanAmount}>{(a) => <Input {...a} inputMode="numeric" value={v.loanAmount} onChange={set("loanAmount")} />}</Field>
        <Field label="Tenure (months, optional)" error={errors.tenureMonths}>{(a) => <Input {...a} inputMode="numeric" value={v.tenureMonths} onChange={set("tenureMonths")} />}</Field>
        <Field label="Note (optional)">{(a) => <Input {...a} value={v.note} onChange={set("note")} />}</Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" loading={convert.isPending}>Convert</Button>
      </div>
    </form>
  );
}

function FollowUps({ leadId, followups, canAdd, canClose, onChange, onError }) {
  const [v, setV] = useState({ type: "call", dueAt: inAnHour(), note: "" });
  const add = useMutation({
    mutationFn: () => api.addFollowup(leadId, { type: v.type, dueAt: new Date(v.dueAt).toISOString(), ...(v.note.trim() ? { note: v.note.trim() } : {}) }),
    onSuccess: () => { setV({ type: "call", dueAt: inAnHour(), note: "" }); onChange("Follow-up scheduled."); },
    onError,
  });
  const close = useMutation({ mutationFn: ({ id, status }) => api.closeFollowup(leadId, id, { status }), onSuccess: (_d, x) => onChange(x.status === "done" ? "Follow-up marked done." : "Follow-up cancelled."), onError });
  return (
    <section aria-label="Follow-ups">
      <h3 className="mb-2 text-sm font-bold">Follow-ups</h3>
      {canAdd && (
        <form onSubmit={(e) => { e.preventDefault(); if (v.dueAt) add.mutate(); }} className="mb-3 space-y-2">
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
            <Select aria-label="Follow-up type" compact value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
              {FOLLOWUP_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </Select>
            <Input aria-label="Follow-up date and time" type="datetime-local" className="h-9" value={v.dueAt} onChange={(e) => setV({ ...v, dueAt: e.target.value })} required />
          </div>
          <div className="flex gap-2">
            <Input aria-label="What’s it about?" placeholder="What’s it about?" className="h-9 flex-1" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
            <Button type="submit" variant="secondary" size="sm" icon={CalendarPlus} loading={add.isPending} className="h-9 shrink-0">Schedule</Button>
          </div>
        </form>
      )}
      {followups.length ? (
        <ul className="space-y-2">
          {followups.map((f) => {
            const [label, tone] = FU_STATE[f.state];
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-sm">
                <span className="min-w-0 flex-1"><strong className="font-semibold">{fuType(f.type)}</strong>{f.note ? ` · ${f.note}` : ""}<span className="block text-xs text-muted">{formatDate(f.dueAt)}, {formatTime(f.dueAt)}{f.assignedName ? ` · ${f.assignedName}` : ""}{f.outcome ? ` · ${f.outcome}` : ""}</span></span>
                <Badge tone={tone}>{label}</Badge>
                {canClose && (f.state === "pending" || f.state === "overdue") && (
                  <span className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => close.mutate({ id: f.id, status: "done" })}>Done</Button>
                    <Button variant="ghost" size="sm" className="text-muted" onClick={() => close.mutate({ id: f.id, status: "cancelled" })}>Cancel</Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-muted">No follow-ups yet.</p>}
    </section>
  );
}

function Activity({ leadId, lead, timeline, canNote, labels, onChange, onError }) {
  const [note, setNote] = useState("");
  const save = useMutation({ mutationFn: () => api.addLeadNote(leadId, note.trim()), onSuccess: () => { setNote(""); onChange("Note saved."); }, onError });
  const origin = lead.kind === "crm" ? `Lead added${lead.createdByName ? ` by ${lead.createdByName}` : ""} (${labels.source(lead.source)})` : `Enquiry received via the website (${lead.kind === "callback" ? "callback request" : "credit report request"})`;
  return (
    <section aria-label="Notes and activity">
      <h3 className="mb-2 text-sm font-bold">Notes &amp; activity</h3>
      {canNote && (
        <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) save.mutate(); }} className="mb-4 flex gap-2">
          <Input aria-label="Add a note" placeholder="Add a call summary or note…" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" loading={save.isPending} disabled={!note.trim()}>Save</Button>
        </form>
      )}
      <ol className="space-y-3 border-l border-line pl-4">
        {timeline.map((e) => (
          <li key={e.id} className="relative text-sm">
            <span className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-4 ring-white ${e.type === "note" ? "bg-brand-500" : e.type === "converted" ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden />
            <p className={e.type === "note" ? "whitespace-pre-line" : ""}>{describe(e, labels)}</p>
            <p className="text-xs text-muted">{e.actorName ?? "System"} · {formatDate(e.createdAt)}, {formatTime(e.createdAt)}</p>
          </li>
        ))}
        <li className="relative text-sm">
          <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-slate-300 ring-4 ring-white" aria-hidden />
          <p>{origin}</p>
          <p className="text-xs text-muted">{formatDate(lead.createdAt)}, {formatTime(lead.createdAt)}</p>
        </li>
      </ol>
    </section>
  );
}
