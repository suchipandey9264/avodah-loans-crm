import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Button, Field, Input, Modal, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { FOLLOWUP_TYPES, inAnHour, toLocalInput } from "../../lib/followups";
import { useDebounced } from "../../lib/hooks";

/**
 * Schedule a follow-up (pick a lead or customer, or pass `target` to fix it) or edit a pending one (`followup`).
 * target: { kind: "lead" | "customer", id, label }
 */
export default function FollowupForm({ open, onClose, onSaved, followup, target }) {
  return (
    <Modal open={open} onClose={onClose} title={followup ? "Edit follow-up" : "Schedule follow-up"}>
      {open && <FormBody onClose={onClose} onSaved={onSaved} followup={followup} target={target} />}
    </Modal>
  );
}

function FormBody({ onClose, onSaved, followup, target: fixed }) {
  const { can } = useAuth();
  const meta = useQuery({ queryKey: ["followups-meta"], queryFn: api.followupsMeta, staleTime: 5 * 60_000 });
  const [v, setV] = useState(() => ({
    type: followup?.type ?? "call",
    dueAt: followup ? toLocalInput(followup.dueAt) : inAnHour(),
    note: followup?.note ?? "",
    assignedTo: followup?.assignedTo ?? "",
  }));
  const [target, setTarget] = useState(fixed ?? null);
  const [kind, setKind] = useState(can("leads.view") ? "lead" : "customer");
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim());
  const [errors, setErrors] = useState({});
  const change = (k, val) => { setV((x) => ({ ...x, [k]: val })); setErrors((e) => ({ ...e, [k]: undefined, form: undefined })); };

  const found = useQuery({
    queryKey: ["followup-target", kind, term],
    queryFn: () => (kind === "lead" ? api.leads({ q: term, pageSize: 6 }).then((d) => d.leads.map((l) => ({ id: l.id, label: l.name, sub: `${l.ref} · ${l.phone}` })))
      : api.customers({ q: term, pageSize: 6 }).then((d) => d.customers.map((c) => ({ id: c.id, label: c.name, sub: `${c.code} · ${c.phone ?? ""}` })))),
    enabled: !followup && !target && term.length >= 2,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { type: v.type, dueAt: new Date(v.dueAt).toISOString(), ...(v.assignedTo ? { assignedTo: v.assignedTo } : {}) };
      if (followup) return api.updateFollowup(followup.id, { ...body, note: v.note.trim() || null });
      return api.scheduleFollowup({ ...body, [target.kind === "lead" ? "leadId" : "customerId"]: target.id, ...(v.note.trim() ? { note: v.note.trim() } : {}) });
    },
    onSuccess: () => onSaved(followup ? "Follow-up updated." : "Follow-up scheduled."),
    onError: (e) => setErrors({ ...e.fields, form: Object.keys(e.fields ?? {}).length ? null : e.message }),
  });
  const submit = (e) => {
    e.preventDefault();
    if (!followup && !target) return setErrors({ target: "Choose the lead or customer it’s for" });
    if (!v.dueAt) return setErrors({ dueAt: "Choose a date and time" });
    save.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {errors.form && <Alert>{errors.form}</Alert>}
      {!followup && (
        target ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-canvas px-3 py-2 text-sm">
            <span><span className="text-muted">{target.kind === "lead" ? "Lead" : "Customer"}:</span> <strong>{target.label}</strong></span>
            {!fixed && <Button type="button" variant="ghost" size="sm" onClick={() => setTarget(null)}>Change</Button>}
          </div>
        ) : (
          <Field label="Lead or customer" error={errors.target}>
            {(p) => (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {can("leads.view") && can("customers.view") && (
                    <Select compact aria-label="For a" className="w-32 shrink-0" value={kind} onChange={(e) => { setKind(e.target.value); setQ(""); }}>
                      <option value="lead">Lead</option>
                      <option value="customer">Customer</option>
                    </Select>
                  )}
                  <Input {...p} className="h-9" type="search" placeholder={`Search ${kind === "lead" ? "leads" : "customers"} by name, phone or ID…`} value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                {term.length >= 2 && (
                  <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label="Matches">
                    {found.isPending ? <li className="px-3 py-2 text-sm text-muted">Searching…</li> : !found.data?.length ? <li className="px-3 py-2 text-sm text-muted">No matches.</li> : found.data.map((x) => (
                      <li key={x.id}>
                        <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-canvas" onClick={() => { setTarget({ kind, ...x }); setErrors({}); }}>
                          <span className="font-semibold">{x.label}</span> <span className="text-xs text-muted">{x.sub}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
        )
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" error={errors.type}>
          {(p) => <Select {...p} value={v.type} onChange={(e) => change("type", e.target.value)}>{FOLLOWUP_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select>}
        </Field>
        <Field label="Date and time" error={errors.dueAt}>
          {(p) => <Input {...p} type="datetime-local" value={v.dueAt} onChange={(e) => change("dueAt", e.target.value)} required />}
        </Field>
      </div>
      {meta.data?.canAssign && (
        <Field label="Assign to" error={errors.assignedTo} hint={followup ? undefined : "Leave as default to give it to the lead owner or relationship manager."}>
          {(p) => (
            <Select {...p} value={v.assignedTo} onChange={(e) => change("assignedTo", e.target.value)}>
              {!followup && <option value="">Default</option>}
              {meta.data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
        </Field>
      )}
      <Field label="Notes" error={errors.note}>
        {(p) => <textarea {...p} rows={3} maxLength={500} className="block w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" placeholder="What’s it about?" value={v.note} onChange={(e) => change("note", e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>{followup ? "Save changes" : "Schedule"}</Button>
      </div>
    </form>
  );
}
