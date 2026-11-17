import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Button, Card, CardHeader, Field, Input, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";

/** Settings → General: organisation details, how new website leads are assigned, and the reminder window. */
export default function General() {
  const q = useQuery({ queryKey: ["settings-general"], queryFn: api.generalSettings });
  if (q.isPending) return <Spinner label="Loading settings" />;
  if (q.isError) return <Alert>{q.error.message}</Alert>;
  return <Form settings={q.data.settings} />;
}

function Form({ settings }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const editable = can("settings.edit");
  const [v, setV] = useState({ companyName: settings.companyName, notificationEmail: settings.notificationEmail ?? "", leadAssignment: settings.leadAssignment, followupReminderMinutes: String(settings.followupReminderMinutes) });
  const [errors, setErrors] = useState({});
  const [flash, setFlash] = useState(null);
  const set = (k) => (e) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const save = useMutation({
    mutationFn: () => api.updateGeneralSettings({ companyName: v.companyName.trim(), notificationEmail: v.notificationEmail.trim() || null, leadAssignment: v.leadAssignment, followupReminderMinutes: Number(v.followupReminderMinutes) }),
    onSuccess: (d) => { setFlash({ tone: "success", text: "Settings saved." }); queryClient.setQueryData(["settings-general"], d); },
    onError: (e) => { setErrors(e.fields ?? {}); setFlash({ tone: "error", text: e.message }); },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate className="space-y-5">
      {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Organisation" description="Shown on exports and used for CRM email." />
          <div className="space-y-4 px-5 py-4">
            <Field label="Company name" error={errors.companyName}>{(p) => <Input {...p} value={v.companyName} onChange={set("companyName")} disabled={!editable} />}</Field>
            <Field label="CRM notification email" error={errors.notificationEmail} hint="Where system emails come from once an email provider is connected.">
              {(p) => <Input {...p} type="email" placeholder="crm@yourcompany.in" value={v.notificationEmail} onChange={set("notificationEmail")} disabled={!editable} />}
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Leads & reminders" description="Applies to everyone in the CRM." />
          <div className="space-y-4 px-5 py-4">
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold">New website leads</legend>
              {[["manual", "Manual", "Leads wait in the unassigned pool until a manager picks an owner."], ["auto", "Automatic", "Each lead goes to the active sales executive with the fewest open leads."]].map(([id, label, hint]) => (
                <label key={id} className={`mb-2 flex items-start gap-2.5 rounded-lg border p-3 text-sm ${v.leadAssignment === id ? "border-brand-500 bg-brand-50/50" : "border-line"}`}>
                  <input type="radio" name="leadAssignment" value={id} checked={v.leadAssignment === id} onChange={set("leadAssignment")} disabled={!editable} className="mt-1" />
                  <span><span className="font-semibold">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
                </label>
              ))}
            </fieldset>
            <Field label="Follow-up reminder" error={errors.followupReminderMinutes} hint="How early the notification bell shows an upcoming follow-up.">
              {(p) => (
                <Select {...p} value={v.followupReminderMinutes} onChange={set("followupReminderMinutes")} disabled={!editable}>
                  {[15, 30, 60, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`} before</option>)}
                </Select>
              )}
            </Field>
          </div>
        </Card>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{settings.updatedAt ? `Last changed ${timeAgo(settings.updatedAt)}` : "Using the default settings"}{editable ? "" : " · Only administrators can change these."}</p>
        {editable && <Button type="submit" loading={save.isPending}>Save settings</Button>}
      </div>
    </form>
  );
}
