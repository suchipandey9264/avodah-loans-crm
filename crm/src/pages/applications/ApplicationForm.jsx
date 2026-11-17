import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Alert, Button, Field, Input, Modal, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { emi, useApplicationMeta, useApplicationRefresh } from "../../lib/applications";
import { formatMoney } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";

const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(/[,\s₹]/g, "")));

/** Create (pass `customer` to preset it) or edit (pass `application`) a loan application. */
export default function ApplicationForm({ application, customer, onClose, onSaved }) {
  const { user, can } = useAuth();
  const meta = useApplicationMeta().data;
  const refresh = useApplicationRefresh();
  const editing = Boolean(application);
  const formId = useId();
  const [v, setV] = useState(() => ({
    customerId: customer?.id ?? "",
    lenderId: application?.lenderId ?? "",
    loanType: application?.type ?? "",
    loanAmount: application?.loanAmount ? String(application.loanAmount) : "",
    tenureMonths: application?.tenureMonths ? String(application.tenureMonths) : "",
    rate: application?.rate != null ? String(application.rate) : "",
    processingFee: application?.processingFee != null ? String(application.processingFee) : "",
    lenderRef: application?.lenderRef ?? "",
    assignedTo: application?.assignedTo ?? user.id,
  }));
  const [picked, setPicked] = useState(customer ?? null);
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const found = useQuery({ queryKey: ["customers", { q: term, pick: true }], queryFn: () => api.customers({ q: term, pageSize: 8 }), enabled: !editing && !picked && term.length >= 2 });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  // Editing a field clears its error (and resets whatever depends on it).
  const change = (k, extra = {}) => (e) => {
    setV((x) => ({ ...x, [k]: e.target.value, ...extra }));
    setErrors((x) => ({ ...x, [k]: undefined, ...Object.fromEntries(Object.keys(extra).map((d) => [d, undefined])) }));
  };
  const set = (k) => change(k);

  const lender = meta?.lenders.find((l) => l.id === v.lenderId);
  const product = lender?.products?.find((p) => p.type === v.loanType);
  const typeLabel = (id) => meta?.loanTypes.find((t) => t.id === id)?.label ?? id;
  const canAssignOthers = can("applications.approve") || can("leads.assign");
  const preview = emi(num(v.loanAmount), v.rate !== "" ? num(v.rate) : product?.rate, num(v.tenureMonths));

  const save = useMutation({
    mutationFn: (body) => (editing ? api.updateApplication(application.id, body) : api.createApplication(body)),
    onSuccess: (data) => { refresh(data.application.id, data.customer.id); onSaved?.(data); },
    onError: (err) => { setFormError(err.message); setErrors(err.fields ?? {}); },
  });

  function submit(e) {
    e.preventDefault();
    setFormError("");
    const next = {};
    if (!editing && !v.customerId) next.customerId = "Choose a customer";
    if (!v.lenderId) next.lenderId = "Choose a lender";
    if (!v.loanType) next.loanType = "Choose a loan product";
    if (!(num(v.loanAmount) > 0)) next.loanAmount = "Enter the loan amount";
    if (!Number.isInteger(num(v.tenureMonths)) || num(v.tenureMonths) < 1) next.tenureMonths = "Enter the tenure in whole months";
    if (product?.maxAmount && num(v.loanAmount) > product.maxAmount) next.loanAmount = `This product lends up to ${formatMoney(product.maxAmount)}`;
    if (product?.maxTenure && num(v.tenureMonths) > product.maxTenure * 12) next.tenureMonths = `This product allows up to ${product.maxTenure * 12} months`;
    if (product?.minTenure && num(v.tenureMonths) < product.minTenure * 12) next.tenureMonths = `This product needs at least ${product.minTenure * 12} months`;
    if (v.rate !== "" && !(num(v.rate) >= 0 && num(v.rate) <= 40)) next.rate = "Enter a rate between 0 and 40";
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = {
      lenderId: v.lenderId, loanType: v.loanType, loanAmount: num(v.loanAmount), tenureMonths: num(v.tenureMonths),
      rate: num(v.rate), processingFee: num(v.processingFee), lenderRef: v.lenderRef.trim() || null,
    };
    if (editing) {
      if (!application.editable) for (const k of ["lenderId", "loanType", "loanAmount", "tenureMonths", "rate", "processingFee", "lenderRef"]) delete body[k];
      if (canAssignOthers && v.assignedTo !== (application.assignedTo ?? "")) body.assignedTo = v.assignedTo || null;
      if (!Object.keys(body).length) return onClose();
    } else {
      Object.assign(body, { customerId: v.customerId, assignedTo: v.assignedTo || null });
      for (const k of ["rate", "processingFee", "lenderRef"]) if (body[k] == null) delete body[k];
    }
    save.mutate(body);
  }

  return (
    <Modal open wide onClose={onClose} title={editing ? `Edit ${application.ref}` : "New loan application"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form={formId} loading={save.isPending}>{editing ? "Save changes" : "Create application"}</Button></>}>
      <form id={formId} onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && <div className="sm:col-span-2"><Alert>{formError}</Alert></div>}
        {editing && !application.editable && <div className="sm:col-span-2"><Alert tone="info">Loan details are locked after sanction, disbursal or rejection. You can still change who handles it.</Alert></div>}

        {!editing && (
          <div className="sm:col-span-2">
            {picked ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2 text-sm">
                <span><span className="text-xs text-muted">Customer</span><br /><strong>{picked.name || "Unnamed customer"}</strong> · {picked.code} · +91 {picked.phone}</span>
                {!customer && <Button variant="ghost" size="sm" onClick={() => { setPicked(null); setV((x) => ({ ...x, customerId: "" })); }}>Change</Button>}
              </div>
            ) : (
              <Field label="Customer" error={errors.customerId} hint="Search by name, mobile, email, PAN or customer ID">
                {(a) => (
                  <div className="relative">
                    <Input {...a} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Start typing…" autoFocus autoComplete="off" />
                    {term.length >= 2 && (
                      <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg" role="listbox" aria-label="Matching customers">
                        {found.isFetching && !found.data ? <li className="px-3 py-2 text-sm text-muted">Searching…</li>
                          : !found.data?.customers.length ? <li className="px-3 py-2 text-sm text-muted">No customer matches. Add them under Customers first.</li>
                          : found.data.customers.map((c) => (
                            <li key={c.id}>
                              <button type="button" role="option" aria-selected="false" className="w-full px-3 py-2 text-left text-sm hover:bg-canvas"
                                onClick={() => { setPicked(c); setV((x) => ({ ...x, customerId: c.id })); setErrors((x) => ({ ...x, customerId: undefined })); }}>
                                <strong>{c.name || "Unnamed customer"}</strong> <span className="text-muted">· {c.code} · +91 {c.phone}</span>
                              </button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </Field>
            )}
          </div>
        )}

        <Field label="Lender" error={errors.lenderId}>
          {(a) => (
            <Select {...a} value={v.lenderId} disabled={editing && !application.editable} onChange={change("lenderId", { loanType: "", rate: "" })}>
              <option value="">Choose lender…</option>
              {meta?.lenders.map((l) => <option key={l.id} value={l.id}>{l.name}{l.kind ? ` · ${l.kind}` : ""}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Loan product" error={errors.loanType} hint={product ? [`Up to ${formatMoney(product.maxAmount)}`, `${product.minTenure ? `${product.minTenure * 12}–` : "up to "}${product.maxTenure * 12} months`, `from ${product.rate}% p.a.`, product.minCibil && `CIBIL ${product.minCibil}+`, product.minIncome && `income ${formatMoney(product.minIncome)}+/yr`].filter(Boolean).join(" · ") : lender && !lender.products?.length ? "This lender has no products yet" : undefined}>
          {(a) => (
            <Select {...a} value={v.loanType} disabled={!lender || (editing && !application.editable)} onChange={change("loanType", { rate: "" })}>
              <option value="">{lender ? "Choose product…" : "Choose a lender first"}</option>
              {lender?.products?.map((p) => <option key={p.type} value={p.type}>{typeLabel(p.type)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Loan amount (₹)" error={errors.loanAmount}>{(a) => <Input {...a} inputMode="numeric" value={v.loanAmount} onChange={set("loanAmount")} disabled={editing && !application.editable} placeholder="e.g. 2500000" />}</Field>
        <Field label="Tenure (months)" error={errors.tenureMonths}>{(a) => <Input {...a} inputMode="numeric" value={v.tenureMonths} onChange={set("tenureMonths")} disabled={editing && !application.editable} placeholder="e.g. 240" />}</Field>
        <Field label="Interest rate (% p.a.)" error={errors.rate} hint={product && v.rate === "" ? `Leave blank for the product rate (${product.rate}%)` : undefined}>
          {(a) => <Input {...a} inputMode="decimal" value={v.rate} onChange={set("rate")} disabled={editing && !application.editable} placeholder={product ? String(product.rate) : ""} />}
        </Field>
        <Field label="Processing fee (₹, optional)" error={errors.processingFee} hint={product?.processingFee || lender?.fee ? `Lender’s usual fee: ${product?.processingFee || lender.fee}` : undefined}>
          {(a) => <Input {...a} inputMode="numeric" value={v.processingFee} onChange={set("processingFee")} disabled={editing && !application.editable} />}
        </Field>
        <Field label="Lender’s reference (optional)" error={errors.lenderRef}>{(a) => <Input {...a} value={v.lenderRef} onChange={set("lenderRef")} disabled={editing && !application.editable} placeholder="Lender’s file / application no." />}</Field>
        <Field label="Handled by" error={errors.assignedTo}>
          {(a) => (
            <Select {...a} value={v.assignedTo ?? ""} disabled={!canAssignOthers} onChange={set("assignedTo")}>
              {canAssignOthers && <option value="">Unassigned</option>}
              {(canAssignOthers ? meta?.staff : meta?.staff.filter((s) => s.id === user.id))?.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.roleName}</option>)}
            </Select>
          )}
        </Field>
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900 sm:col-span-2" aria-live="polite">
          {preview ? <>Estimated EMI <strong>{formatMoney(preview)}</strong> per month. The server works out the stored figure.</> : "Enter the amount, tenure and product to see the EMI."}
        </p>
      </form>
    </Modal>
  );
}
