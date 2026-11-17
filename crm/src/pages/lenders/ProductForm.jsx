import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { z } from "zod";
import { Alert, Button, Field, Input, Modal, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { useLenderRefresh } from "../../lib/lenders";
import { check } from "../../lib/validation";

// Mirrors lenderProduct in backend/src/crm/validate.js. Products live in lenders.products — the list the website's
// offers and CRM applications read — so saving here changes both straight away.
const num = (re, min, max, msg) => z.string().trim().transform((v) => v.replace(/[,\s₹]/g, "")).refine((v) => re.test(v) && +v >= min && +v <= max, msg);
const opt = (schema) => z.union([z.literal(""), schema]);
const DEC = /^\d+(\.\d+)?$/;
const INT = /^\d+$/;
const schema = z
  .object({
    type: z.string().min(1, "Choose a loan product"),
    rate: num(DEC, 0, 40, "Rate between 0 and 40% p.a."),
    maxAmount: num(DEC, 1, 1e10, "Enter an amount in rupees"),
    minTenure: opt(num(INT, 1, 40, "1 to 40 years")),
    maxTenure: num(INT, 1, 40, "1 to 40 years"),
    processingFee: z.string().trim().max(60, "Keep this under 60 characters"),
    minCibil: opt(num(INT, 300, 900, "CIBIL runs from 300 to 900")),
    minIncome: opt(num(DEC, 1, 1e10, "Enter an amount in rupees")),
    features: z.string(),
  })
  .refine((p) => !p.minTenure || +p.minTenure <= +p.maxTenure, { message: "Minimum tenure is above the maximum", path: ["minTenure"] });

const s = (v) => (v == null ? "" : String(v));

/** Add a product to a lender (no `product`) or edit one. `index` is the product's place in lender.products. */
export default function ProductForm({ lender, product, loanTypes, onClose, onSaved }) {
  const editing = Boolean(product);
  const refresh = useLenderRefresh();
  const formId = useId();
  const taken = new Set(lender.products.map((p) => p.type));
  const [v, setV] = useState(() => ({
    type: product?.type ?? "", rate: s(product?.rate), maxAmount: s(product?.maxAmount), minTenure: s(product?.minTenure), maxTenure: s(product?.maxTenure),
    processingFee: s(product?.processingFee), minCibil: s(product?.minCibil), minIncome: s(product?.minIncome), features: (product?.features ?? []).join("\n"),
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const set = (k) => (e) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  const index = editing ? lender.products.findIndex((p) => p.type === product.type) : lender.products.length;
  const save = useMutation({
    mutationFn: (p) => api.updateLender(lender.id, { products: editing ? lender.products.map((x, i) => (i === index ? p : x)) : [...lender.products, p] }),
    onSuccess: (data) => { refresh(lender.id); onSaved?.(data); },
    onError: (err) => {
      // Server field keys look like "products.3.rate": keep the ones for this product.
      const prefix = `products.${index}.`;
      setErrors(Object.fromEntries(Object.entries(err.fields ?? {}).filter(([k]) => k.startsWith(prefix)).map(([k, m]) => [k.slice(prefix.length).split(".")[0], m])));
      setFormError(err.message);
    },
  });

  function submit(e) {
    e.preventDefault();
    setFormError("");
    const { data, fields } = check(schema, v);
    setErrors(fields ?? {});
    if (!data) return;
    const n = (x) => (x === "" ? undefined : Number(x));
    save.mutate({
      type: data.type, rate: Number(data.rate), maxAmount: Number(data.maxAmount), maxTenure: Number(data.maxTenure),
      minTenure: n(data.minTenure), processingFee: data.processingFee || undefined, minCibil: n(data.minCibil), minIncome: n(data.minIncome),
      features: data.features.split("\n").map((f) => f.trim()).filter(Boolean),
    });
  }

  const T = (label, k, { hint, ...props } = {}) => (
    <Field label={label} error={errors[k]} hint={hint}>{(a) => <Input {...a} value={v[k]} onChange={set(k)} {...props} />}</Field>
  );
  const label = (id) => loanTypes.find((t) => t.id === id)?.label ?? id;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={editing ? `${label(product.type)} · ${lender.name}` : `Add product · ${lender.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} loading={save.isPending}>{editing ? "Save product" : "Add product"}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
        {formError && <Alert>{formError}</Alert>}
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-bold sm:col-span-2">Product &amp; pricing</legend>
          <Field label="Loan product" error={errors.type}>
            {(a) => (
              <Select {...a} value={v.type} onChange={set("type")} disabled={editing} autoFocus={!editing}>
                <option value="">Choose…</option>
                {loanTypes.map((t) => <option key={t.id} value={t.id} disabled={!editing && taken.has(t.id)}>{t.label}{!editing && taken.has(t.id) ? " (already listed)" : ""}</option>)}
              </Select>
            )}
          </Field>
          {T("Interest rate from (% p.a.)", "rate", { inputMode: "decimal", placeholder: "e.g. 8.5", autoFocus: editing })}
          {T("Maximum amount (₹)", "maxAmount", { inputMode: "numeric", placeholder: "e.g. 50000000", hint: v.maxAmount && DEC.test(v.maxAmount.replace(/[,\s₹]/g, "")) ? formatMoney(Number(v.maxAmount.replace(/[,\s₹]/g, ""))) : undefined })}
          {T("Processing fee", "processingFee", { placeholder: "e.g. 0.50% or ₹10,000", hint: `Leave blank to use the lender’s fee${lender.fee ? ` (${lender.fee})` : ""}` })}
        </fieldset>
        <fieldset className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-bold sm:col-span-2">Tenure</legend>
          {T("Minimum tenure (years, optional)", "minTenure", { inputMode: "numeric" })}
          {T("Maximum tenure (years)", "maxTenure", { inputMode: "numeric" })}
        </fieldset>
        <fieldset className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-bold sm:col-span-2">Eligibility</legend>
          {T("Minimum CIBIL score (optional)", "minCibil", { inputMode: "numeric", maxLength: 3, placeholder: "e.g. 700" })}
          {T("Minimum annual income (₹, optional)", "minIncome", { inputMode: "numeric", placeholder: "e.g. 300000" })}
          <Field label="Features (one per line, shown on the website)" error={errors.features} className="sm:col-span-2">
            {(a) => <textarea {...a} rows={3} value={v.features} onChange={set("features")} className="block w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />}
          </Field>
        </fieldset>
        <p className="text-[13px] text-muted">New applications with {lender.name} are checked against these limits. Changes show on the website straight away{lender.active ? "" : " once the lender is active"}.</p>
      </form>
    </Modal>
  );
}
