import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { z } from "zod";
import { Alert, Button, Field, Input, Modal, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useLenderRefresh } from "../../lib/lenders";
import { check, email, phone } from "../../lib/validation";

// Client checks mirror backend/src/crm/validate.js (lenderCreateBody / lenderUpdateBody); the server checks everything again.
const KINDS = ["PSU Bank", "PVT Bank", "HFC", "NBFC"];
const optional = (schema) => z.union([z.literal(""), schema]);
const decimal = (min, max, msg) => optional(z.string().trim().refine((v) => /^\d+(\.\d+)?$/.test(v) && +v >= min && +v <= max, msg));
const schema = z.object({
  id: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "2–40 lowercase letters, digits or dashes (e.g. sbi)"),
  name: z.string().trim().min(2, "Enter the lender’s name").max(60),
  fullName: z.string().trim().max(120),
  kind: z.enum(KINDS, { error: "Choose bank, HFC or NBFC" }),
  logo: optional(z.string().trim().max(300).regex(/^(\/|https:\/\/)\S+$/, "Use a site path like /bank-logos/sbi.png or an https:// link")),
  about: z.string().trim().max(1000, "Keep this under 1,000 characters"),
  fee: z.string().trim().max(60, "Keep this under 60 characters"),
  payoutPct: decimal(0, 10, "0 to 10%"),
  tatDays: optional(z.string().trim().regex(/^\d+$/, "Whole days").refine((v) => +v >= 1 && +v <= 180, "1 to 180 days")),
  agreementUntil: z.string(),
  active: z.boolean(),
  contacts: z
    .array(z.object({ name: z.string().trim().min(2, "Enter the contact’s name").max(80), role: z.string().trim().max(60), phone: optional(phone), email: optional(email) }))
    .max(10),
});

const blankContact = { name: "", role: "", phone: "", email: "" };
const slug = (name) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const s = (v) => (v == null ? "" : String(v));

/** Add (no `lender`) or edit a lender's details, partnership terms and contacts. Products are edited from the rate card. */
export default function LenderForm({ lender, onClose, onSaved }) {
  const editing = Boolean(lender);
  const refresh = useLenderRefresh();
  const formId = useId();
  const [v, setV] = useState(() => ({
    id: lender?.id ?? "", name: s(lender?.name), fullName: s(lender?.fullName), kind: lender?.kind ?? "", logo: s(lender?.logo),
    about: s(lender?.about), fee: s(lender?.fee), payoutPct: s(lender?.payoutPct), tatDays: s(lender?.tatDays),
    agreementUntil: s(lender?.agreementUntil), active: lender?.active ?? true,
    contacts: (lender?.contacts ?? []).map((c) => ({ ...blankContact, ...Object.fromEntries(Object.entries(c).map(([k, x]) => [k, s(x)])) })),
  }));
  const [idTouched, setIdTouched] = useState(editing);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");

  const set = (k) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setV((x) => ({ ...x, [k]: value, ...(k === "name" && !idTouched && { id: slug(value) }) }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const setContact = (i, k) => (e) => {
    setV((x) => ({ ...x, contacts: x.contacts.map((c, j) => (j === i ? { ...c, [k]: e.target.value } : c)) }));
    setErrors((x) => ({ ...x, [`contacts.${i}.${k}`]: undefined }));
  };

  const save = useMutation({
    mutationFn: (body) => (editing ? api.updateLender(lender.id, body) : api.createLender(body)),
    onSuccess: (data) => { refresh(data.lender.id); onSaved?.(data); },
    onError: (err) => { setFormError(err.message); setErrors(err.fields ?? {}); },
  });

  function submit(e) {
    e.preventDefault();
    setFormError("");
    const { data, fields } = check(schema, v);
    setErrors(fields ?? {});
    if (!data) return;
    const n = (x) => (x === "" ? null : x);
    const body = {
      name: data.name, fullName: n(data.fullName), kind: data.kind, logo: n(data.logo), about: n(data.about), fee: n(data.fee),
      payoutPct: data.payoutPct === "" ? null : Number(data.payoutPct), tatDays: data.tatDays === "" ? null : Number(data.tatDays),
      agreementUntil: n(data.agreementUntil), active: data.active,
      contacts: data.contacts.map((c) => Object.fromEntries(Object.entries(c).filter(([, x]) => x !== ""))),
    };
    if (!editing) body.id = data.id;
    save.mutate(body);
  }

  const T = (label, k, { hint, ...props } = {}) => (
    <Field label={label} error={errors[k]} hint={hint}>{(a) => <Input {...a} value={v[k]} onChange={set(k)} {...props} />}</Field>
  );

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={editing ? `Edit ${lender.name}` : "Add lender"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} loading={save.isPending}>{editing ? "Save changes" : "Add lender"}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
        {formError && <Alert>{formError}</Alert>}
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-bold sm:col-span-2">Lender</legend>
          {T("Short name", "name", { autoFocus: true, placeholder: "e.g. HDFC Bank", autoComplete: "off" })}
          {editing ? (
            <Field label="Lender ID" hint="Fixed: applications and website links use it.">{(a) => <Input {...a} value={v.id} disabled />}</Field>
          ) : (
            <Field label="Lender ID" error={errors.id} hint="Used in website links (/lenders/…). Can’t be changed later.">
              {(a) => <Input {...a} value={v.id} onChange={(e) => { setIdTouched(true); set("id")(e); }} autoComplete="off" />}
            </Field>
          )}
          <div className="sm:col-span-2">{T("Full / registered name", "fullName", { placeholder: "e.g. HDFC Bank Ltd." })}</div>
          <Field label="Type" error={errors.kind}>
            {(a) => (
              <Select {...a} value={v.kind} onChange={set("kind")}>
                <option value="">Choose…</option>
                {KINDS.map((k) => <option key={k}>{k}</option>)}
              </Select>
            )}
          </Field>
          {T("Logo", "logo", { placeholder: "/bank-logos/hdfs.png", hint: "A site path or an https:// link" })}
          <Field label="About" error={errors.about} className="sm:col-span-2">
            {(a) => <textarea {...a} rows={3} value={v.about} onChange={set("about")} className="block w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" placeholder="Shown on the lender’s page on the website" />}
          </Field>
          <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2">
            <input type="checkbox" checked={v.active} onChange={set("active")} className="size-4 accent-brand-700" />
            Active — shown on the website and available for new applications
          </label>
        </fieldset>

        <fieldset className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-bold sm:col-span-2">Partnership</legend>
          {T("Processing fee", "fee", { placeholder: "e.g. 0.35% – 0.50%", hint: "Shown to customers on the website" })}
          {T("Our payout (% of disbursal)", "payoutPct", { inputMode: "decimal", placeholder: "e.g. 0.75" })}
          {T("Turnaround (days)", "tatDays", { inputMode: "numeric", placeholder: "e.g. 10" })}
          {T("Agreement valid till", "agreementUntil", { type: "date" })}
        </fieldset>

        <fieldset className="space-y-3 border-t border-line pt-4">
          <legend className="mb-1 text-sm font-bold">Contacts</legend>
          {!v.contacts.length && <p className="text-sm text-muted">No contacts yet. The first contact shows as the relationship manager.</p>}
          {v.contacts.map((c, i) => (
            <div key={i} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
              <Field label={i === 0 ? "Name (relationship manager)" : "Name"} error={errors[`contacts.${i}.name`]}>{(a) => <Input {...a} value={c.name} onChange={setContact(i, "name")} />}</Field>
              <Field label="Role" error={errors[`contacts.${i}.role`]}>{(a) => <Input {...a} value={c.role} onChange={setContact(i, "role")} placeholder="e.g. Sales manager" />}</Field>
              <Field label="Mobile" error={errors[`contacts.${i}.phone`]}>{(a) => <Input {...a} value={c.phone} onChange={setContact(i, "phone")} inputMode="numeric" maxLength={10} />}</Field>
              <Field label="Email" error={errors[`contacts.${i}.email`]}>{(a) => <Input {...a} type="email" value={c.email} onChange={setContact(i, "email")} />}</Field>
              <div className="sm:col-span-2">
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setV((x) => ({ ...x, contacts: x.contacts.filter((_, j) => j !== i) }))}>Remove contact</Button>
              </div>
            </div>
          ))}
          {v.contacts.length < 10 && <Button variant="secondary" size="sm" icon={Plus} onClick={() => setV((x) => ({ ...x, contacts: [...x.contacts, { ...blankContact }] }))}>Add contact</Button>}
        </fieldset>
        {!editing && <p className="text-[13px] text-muted">After saving, add the lender’s loan products (rates, limits, tenure, eligibility) from its rate card.</p>}
      </form>
    </Modal>
  );
}
