import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { z } from "zod";
import { Alert, Button, Field, Input, Modal, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useLeadMeta, useLeadRefresh } from "../../lib/leads";
import { check, email, personName, phone } from "../../lib/validation";

const COMMON_CITIES = ["Ahmedabad", "Bengaluru", "Chennai", "Delhi", "Gurugram", "Hyderabad", "Indore", "Jaipur", "Kolkata", "Lucknow", "Mumbai", "Noida", "Pune", "Surat"];

const amount = z
  .string()
  .trim()
  .transform((v) => v.replace(/[,\s₹]/g, ""))
  .refine((v) => v === "" || (/^\d+(\.\d+)?$/.test(v) && Number(v) > 0), "Enter an amount in rupees, e.g. 2500000");

const schema = z.object({
  name: personName,
  phone,
  email: z.union([z.literal(""), email]),
  city: z.string().trim().max(60),
  loanType: z.string(),
  loanAmount: amount,
  employment: z.string(),
  annualIncome: amount,
  source: z.string().min(1, "Choose a source"),
  temperature: z.string(),
  ownerId: z.string(),
  message: z.string().trim().max(2000),
});

const fromLead = (l) => ({
  name: l?.name ?? "",
  phone: l?.phone ?? "",
  email: l?.email ?? "",
  city: l?.city ?? "",
  loanType: l?.loanType ?? "home",
  loanAmount: l?.loanAmount ? String(l.loanAmount) : "",
  employment: l?.employment ?? "salaried",
  annualIncome: l?.annualIncome ? String(l.annualIncome) : "",
  source: l?.source ?? "walk_in",
  temperature: l?.temperature ?? "warm",
  ownerId: "auto",
  message: l?.message ?? "",
});

/** Add (no `lead`) or edit (`lead` given) a lead. */
export default function LeadForm({ open, lead, onClose, onSaved }) {
  const { can } = useAuth();
  const meta = useLeadMeta().data;
  const refresh = useLeadRefresh();
  const editing = Boolean(lead);
  const [v, setV] = useState(() => fromLead(lead));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const cityListId = useId();
  const formId = useId();
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const canAssign = can("leads.assign");

  const save = useMutation({
    mutationFn: (body) => (editing ? api.updateLead(lead.id, body) : api.createLead(body)),
    onSuccess: ({ lead: saved }) => {
      refresh(saved.id);
      onSaved?.(saved);
    },
    onError: (err) => {
      setFormError(err.message);
      setErrors(err.fields ?? {});
    },
  });

  function submit(e) {
    e.preventDefault();
    setFormError("");
    const { data, fields } = check(schema, v);
    setErrors(fields ?? {});
    if (!data) return;
    const body = {
      name: data.name,
      phone: data.phone,
      email: data.email || null,
      city: data.city || null,
      loanType: data.loanType || null,
      loanAmount: data.loanAmount ? Number(data.loanAmount) : null,
      employment: data.employment || null,
      annualIncome: data.annualIncome ? Number(data.annualIncome) : null,
      source: data.source,
      temperature: data.temperature || null,
      message: data.message || null,
    };
    if (!editing && canAssign) body.ownerId = data.ownerId === "auto" ? "auto" : data.ownerId || null;
    save.mutate(body);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${lead.ref}` : "Add new lead"}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} loading={save.isPending}>{editing ? "Save changes" : "Save lead"}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && <div className="sm:col-span-2"><Alert>{formError}</Alert></div>}
        <Field label="Full name" error={errors.name}>{(a) => <Input {...a} value={v.name} onChange={set("name")} autoComplete="off" autoFocus />}</Field>
        <Field label="Mobile number" error={errors.phone}>{(a) => <Input {...a} inputMode="numeric" maxLength={10} value={v.phone} onChange={set("phone")} autoComplete="off" />}</Field>
        <Field label="Email (optional)" error={errors.email}>{(a) => <Input {...a} type="email" value={v.email} onChange={set("email")} autoComplete="off" />}</Field>
        <Field label="City" error={errors.city}>
          {(a) => (
            <>
              <Input {...a} list={cityListId} value={v.city} onChange={set("city")} autoComplete="off" />
              <datalist id={cityListId}>{[...new Set([...(meta?.cities ?? []), ...COMMON_CITIES])].sort().map((c) => <option key={c} value={c} />)}</datalist>
            </>
          )}
        </Field>
        <Field label="Loan type" error={errors.loanType}>
          {(a) => (
            <Select {...a} value={v.loanType} onChange={set("loanType")}>
              <option value="">Not decided</option>
              {meta?.loanTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Loan amount (₹)" error={errors.loanAmount}>{(a) => <Input {...a} inputMode="numeric" value={v.loanAmount} onChange={set("loanAmount")} placeholder="e.g. 2500000" />}</Field>
        <Field label="Employment" error={errors.employment}>
          {(a) => (
            <Select {...a} value={v.employment} onChange={set("employment")}>
              <option value="">Not known</option>
              {meta?.employment.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Annual income (₹)" error={errors.annualIncome}>{(a) => <Input {...a} inputMode="numeric" value={v.annualIncome} onChange={set("annualIncome")} placeholder="e.g. 1200000" />}</Field>
        <Field label="Lead source" error={errors.source}>
          {(a) => (
            <Select {...a} value={v.source} onChange={set("source")}>
              {meta?.sources.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Temperature" error={errors.temperature}>
          {(a) => (
            <Select {...a} value={v.temperature} onChange={set("temperature")}>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </Select>
          )}
        </Field>
        {!editing && canAssign && (
          <Field label="Assign to" error={errors.ownerId} hint="Auto picks the front-line employee with the fewest open leads">
            {(a) => (
              <Select {...a} value={v.ownerId} onChange={set("ownerId")}>
                <option value="auto">Auto (least busy)</option>
                <option value="">Unassigned</option>
                {meta?.owners.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.roleName}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Notes (optional)" error={errors.message} className="sm:col-span-2">
          {(a) => <textarea {...a} rows={2} value={v.message} onChange={set("message")} className="block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />}
        </Field>
      </form>
    </Modal>
  );
}
