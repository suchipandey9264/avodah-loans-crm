import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { z } from "zod";
import { Alert, Button, Field, Input, Modal, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCustomerMeta, useCustomerRefresh } from "../../lib/customers";
import { check, email, personName, phone } from "../../lib/validation";

// Client checks mirror backend/src/crm/validate.js; the server checks everything again.
const optional = (schema) => z.union([z.literal(""), schema]);
const amount = z.string().trim().transform((v) => v.replace(/[,\s₹]/g, "")).refine((v) => v === "" || (/^\d+(\.\d+)?$/.test(v) && Number(v) > 0), "Enter an amount in rupees");
const adult = z.string().refine((s) => {
  if (!s) return true;
  const age = (Date.now() - new Date(`${s}T00:00:00Z`).getTime()) / (365.25 * 86400000);
  return age >= 18 && age <= 100;
}, "Customer must be between 18 and 100 years old");
const pincode = optional(z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit pincode"));
const schema = z.object({
  name: personName,
  phone,
  email: optional(email),
  alternatePhone: optional(phone),
  dob: adult,
  gender: z.string(),
  marital: z.string(),
  pan: optional(z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN format: ABCDE1234F")),
  aadhaarLast4: optional(z.string().trim().regex(/^\d{4}$/, "Only the last 4 digits")),
  address: z.string().trim().max(200),
  city: z.string().trim().max(60),
  state: z.string().trim().max(60),
  pincode,
  permanentSame: z.boolean(),
  permanentAddress: z.string().trim().max(200),
  permanentCity: z.string().trim().max(60),
  permanentState: z.string().trim().max(60),
  permanentPincode: pincode,
  emp: z.string(),
  company: z.string().trim().max(120),
  annualIncome: amount,
  creditScore: z.string().trim().refine((v) => v === "" || (/^\d+$/.test(v) && +v >= 300 && +v <= 900), "CIBIL scores run from 300 to 900"),
  kycStatus: z.string(),
  relationshipManagerId: z.string(),
});

const FIELDS = Object.keys(schema.shape);
const fromCustomer = (c) =>
  Object.fromEntries(
    FIELDS.map((k) => {
      if (k === "permanentSame") return [k, c ? c.permanentSame !== false : true];
      if (k === "kycStatus") return [k, c?.kycStatus ?? "pending"];
      const v = c?.[k];
      return [k, v == null ? "" : String(v)];
    })
  );

// Outside the form component: a component defined inside would remount its inputs on every keystroke.
function Section({ title, children }) {
  return (
    <fieldset className="grid gap-4 border-t border-line pt-4 first:border-0 first:pt-0 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-bold text-ink sm:col-span-2">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Add (no `customer`) or edit a customer. */
export default function CustomerForm({ customer, onClose, onSaved }) {
  const { user, can } = useAuth();
  const kyc = can("customers.kyc");
  const panLocked = Boolean(customer?.panMasked); // shown masked: only staff with KYC access can change it
  const meta = useCustomerMeta().data;
  const refresh = useCustomerRefresh();
  const editing = Boolean(customer);
  const [v, setV] = useState(() => ({ ...fromCustomer(customer), ...(!editing && { relationshipManagerId: user.id }) }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const formId = useId();
  const statesId = useId();
  const citiesId = useId();
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = useMutation({
    mutationFn: (body) => (editing ? api.updateCustomer(customer.id, body) : api.createCustomer(body)),
    onSuccess: (data) => { refresh(data.customer.id); onSaved?.(data); },
    onError: (err) => { setFormError(err.message); setErrors(err.fields ?? {}); },
  });

  function submit(e) {
    e.preventDefault();
    setFormError("");
    const { data, fields } = check(schema, panLocked ? { ...v, pan: "" } : v);
    setErrors(fields ?? {});
    if (!data) return;
    const n = (x) => (x === "" ? null : x);
    const body = Object.fromEntries(FIELDS.map((k) => [k, typeof data[k] === "boolean" ? data[k] : n(data[k])]));
    body.annualIncome = data.annualIncome ? Number(data.annualIncome) : null;
    body.creditScore = data.creditScore ? Number(data.creditScore) : null;
    body.kycStatus = data.kycStatus || "pending";
    if (panLocked) delete body.pan;
    if (!kyc) delete body.kycStatus; // the server keeps the current status (new customers start as pending)
    if (data.permanentSame) for (const k of ["permanentAddress", "permanentCity", "permanentState", "permanentPincode"]) body[k] = null;
    save.mutate(body);
  }

  const T = ({ label, k, ...rest }) => (
    <Field label={label} error={errors[k]}>{(a) => <Input {...a} value={v[k]} onChange={set(k)} {...rest} />}</Field>
  );
  const S = ({ label, k, children }) => (
    <Field label={label} error={errors[k]}>{(a) => <Select {...a} value={v[k]} onChange={set(k)}>{children}</Select>}</Field>
  );

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={editing ? `Edit ${customer.code}` : "Add customer"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} loading={save.isPending}>{editing ? "Save changes" : "Add customer"}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
        {formError && <Alert>{formError}</Alert>}
        <datalist id={statesId}>{meta?.states.map((s) => <option key={s} value={s} />)}</datalist>
        <datalist id={citiesId}>{meta?.cities.map((s) => <option key={s} value={s} />)}</datalist>
        <Section title="Personal">
          {T({ label: "Full name", k: "name", autoComplete: "off", autoFocus: true })}
          {T({ label: "Date of birth", k: "dob", type: "date", max: new Date().toISOString().slice(0, 10) })}
          {S({ label: "Gender", k: "gender", children: [<option key="" value="">Not given</option>, ...(meta?.genders ?? []).map((g) => <option key={g}>{g}</option>)] })}
          {S({ label: "Marital status", k: "marital", children: [<option key="" value="">Not given</option>, ...(meta?.marital ?? []).map((g) => <option key={g}>{g}</option>)] })}
          {panLocked
            ? <Field label="PAN" hint="Changing a PAN needs KYC access.">{(a) => <Input {...a} value={customer.pan ?? ""} disabled />}</Field>
            : T({ label: "PAN", k: "pan", maxLength: 10, autoCapitalize: "characters", placeholder: "ABCDE1234F" })}
          {T({ label: "Aadhaar (last 4 digits only)", k: "aadhaarLast4", inputMode: "numeric", maxLength: 4, placeholder: "1234" })}
        </Section>
        <Section title="Contact">
          {T({ label: "Mobile number", k: "phone", inputMode: "numeric", maxLength: 10, autoComplete: "off" })}
          {T({ label: "Alternate mobile (optional)", k: "alternatePhone", inputMode: "numeric", maxLength: 10 })}
          <div className="sm:col-span-2">{T({ label: "Email (optional)", k: "email", type: "email", autoComplete: "off" })}</div>
        </Section>
        <Section title="Current address">
          <div className="sm:col-span-2">{T({ label: "Address", k: "address", placeholder: "House / flat, street, area" })}</div>
          {T({ label: "City", k: "city", list: citiesId })}
          {T({ label: "State", k: "state", list: statesId })}
          {T({ label: "Pincode", k: "pincode", inputMode: "numeric", maxLength: 6 })}
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold">
            <input type="checkbox" checked={v.permanentSame} onChange={set("permanentSame")} className="size-4 accent-brand-700" />
            Permanent address is the same
          </label>
          {!v.permanentSame && (
            <>
              <div className="sm:col-span-2">{T({ label: "Permanent address", k: "permanentAddress" })}</div>
              {T({ label: "Permanent city", k: "permanentCity", list: citiesId })}
              {T({ label: "Permanent state", k: "permanentState", list: statesId })}
              {T({ label: "Permanent pincode", k: "permanentPincode", inputMode: "numeric", maxLength: 6 })}
            </>
          )}
        </Section>
        <Section title="Employment & credit">
          {S({ label: "Employment", k: "emp", children: [<option key="" value="">Not known</option>, ...(meta?.employment ?? []).map((e) => <option key={e.id} value={e.id}>{e.label}</option>)] })}
          {T({ label: "Employer / business", k: "company" })}
          {T({ label: "Annual income (₹)", k: "annualIncome", inputMode: "numeric", placeholder: "e.g. 1200000" })}
          {T({ label: "CIBIL score", k: "creditScore", inputMode: "numeric", maxLength: 3, placeholder: "300–900" })}
        </Section>
        <Section title="KYC & relationship manager">
          {kyc
            ? S({ label: "KYC status", k: "kycStatus", children: (meta?.kycStatuses ?? []).map((k) => <option key={k.id} value={k.id}>{k.label}</option>) })
            : <Field label="KYC status" hint="Changing KYC status needs KYC access.">{(a) => <Select {...a} value={v.kycStatus} disabled>{(meta?.kycStatuses ?? []).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select>}</Field>}
          {S({ label: "Relationship manager", k: "relationshipManagerId", children: [<option key="" value="">None</option>, ...(meta?.relationshipManagers ?? []).map((m) => <option key={m.id} value={m.id}>{m.name} · {m.roleName}</option>)] })}
        </Section>
      </form>
    </Modal>
  );
}
