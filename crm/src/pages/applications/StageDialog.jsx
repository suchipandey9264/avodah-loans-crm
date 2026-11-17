import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Button, Field, Input, Modal, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { emi, STAGES, useApplicationRefresh } from "../../lib/applications";
import { formatMoney } from "../../lib/format";

const num = (v) => (v === "" || v == null ? undefined : Number(String(v).replace(/[,\s₹]/g, "")));

/**
 * Move an application. `moves` comes from the server (only moves this user may make); `target` preselects one.
 * Each kind asks only for what the server needs: sanction → amount (+rate/tenure), disburse → amount, reject → reason, back → note.
 */
export default function StageDialog({ application, moves, target, onClose, onDone }) {
  const refresh = useApplicationRefresh();
  const [stage, setStage] = useState(target ?? moves[0]?.stage);
  const kind = moves.find((m) => m.stage === stage)?.kind;
  const [v, setV] = useState({
    sanctionedAmount: String(application.loanAmount), rate: application.rate != null ? String(application.rate) : "", tenureMonths: String(application.tenureMonths ?? ""),
    disbursedAmount: String(application.sanctionedAmount ?? application.loanAmount), rejectionReason: "", note: "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));

  const go = useMutation({
    mutationFn: () => api.moveApplication(application.id, {
      stage,
      ...(v.note.trim() && { note: v.note.trim() }),
      ...(kind === "sanction" && { sanctionedAmount: num(v.sanctionedAmount), rate: num(v.rate), tenureMonths: num(v.tenureMonths) }),
      ...(kind === "disburse" && { disbursedAmount: num(v.disbursedAmount) }),
      ...(kind === "reject" && { rejectionReason: v.rejectionReason.trim() }),
    }),
    onSuccess: (data) => { refresh(application.id, data.customer.id); onDone?.(data, stage); },
    onError: (err) => { setFormError(err.message); setErrors(err.fields ?? {}); },
  });

  const submit = (e) => {
    e.preventDefault();
    setFormError("");
    const next = {};
    if (kind === "sanction" && !(num(v.sanctionedAmount) > 0)) next.sanctionedAmount = "Enter the sanctioned amount";
    if (kind === "disburse" && !(num(v.disbursedAmount) > 0)) next.disbursedAmount = "Enter the disbursed amount";
    if (kind === "reject" && v.rejectionReason.trim().length < 3) next.rejectionReason = "Say why the application was rejected";
    if (kind === "back" && !v.note.trim()) next.note = "Say why it’s going back";
    setErrors(next);
    if (!Object.keys(next).length) go.mutate();
  };
  const label = STAGES[stage]?.[0] ?? stage;
  const preview = kind === "sanction" ? emi(num(v.sanctionedAmount), num(v.rate), num(v.tenureMonths)) : null;

  return (
    <Modal open onClose={onClose} title={kind === "reject" ? `Reject ${application.ref}` : `Move to ${label}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="stage-form" variant={kind === "reject" ? "danger" : "primary"} loading={go.isPending}>{kind === "reject" ? "Reject application" : "Confirm"}</Button></>}>
      <form id="stage-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        {!target && moves.length > 1 && (
          <Field label="Move to">{(a) => <Select {...a} value={stage} onChange={(e) => { setStage(e.target.value); setErrors({}); setFormError(""); }}>{moves.map((m) => <option key={m.stage} value={m.stage}>{m.label}{m.kind === "back" ? " (back)" : ""}</option>)}</Select>}</Field>
        )}
        {kind === "sanction" && (
          <>
            <Field label="Sanctioned amount (₹)" error={errors.sanctionedAmount} hint={`Requested ${formatMoney(application.loanAmount)}`}>{(a) => <Input {...a} inputMode="numeric" value={v.sanctionedAmount} onChange={set("sanctionedAmount")} autoFocus />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sanctioned rate (% p.a.)" error={errors.rate}>{(a) => <Input {...a} inputMode="decimal" value={v.rate} onChange={set("rate")} />}</Field>
              <Field label="Tenure (months)" error={errors.tenureMonths}>{(a) => <Input {...a} inputMode="numeric" value={v.tenureMonths} onChange={set("tenureMonths")} />}</Field>
            </div>
            {preview && <p className="text-sm text-muted">EMI on these terms: <strong className="text-ink">{formatMoney(preview)}</strong> a month.</p>}
          </>
        )}
        {kind === "disburse" && (
          <Field label="Disbursed amount (₹)" error={errors.disbursedAmount} hint={`Sanctioned ${formatMoney(application.sanctionedAmount ?? application.loanAmount)}`}>{(a) => <Input {...a} inputMode="numeric" value={v.disbursedAmount} onChange={set("disbursedAmount")} autoFocus />}</Field>
        )}
        {kind === "reject" && (
          <Field label="Reason" error={errors.rejectionReason} hint="Recorded on the file and in the audit log">{(a) => <Input {...a} value={v.rejectionReason} onChange={set("rejectionReason")} autoFocus placeholder="e.g. FOIR above lender limit" />}</Field>
        )}
        <Field label={kind === "back" ? "Why is it going back?" : "Note (optional)"} error={errors.note}>
          {(a) => <textarea {...a} rows={3} value={v.note} onChange={set("note")} className="block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />}
        </Field>
      </form>
    </Modal>
  );
}
