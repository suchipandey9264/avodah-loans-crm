import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Button, Card, CardHeader, Field, Input, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";

const FIELDS = [
  ["phone", "Phone", { type: "tel", placeholder: "+91 98765 43210" }, "Shown in the footer and on the Support page, with a tap-to-call link."],
  ["email", "Email", { type: "email", placeholder: "help@avodahloans.in" }, "Where the site's “Email us” links go."],
  ["city", "City", { placeholder: "Mumbai, Maharashtra" }, "Shown under the contact details in the footer."],
  ["supportHours", "Support hours", { placeholder: "Mon–Sat, 9am–7pm" }, "Shown next to the phone number on the Support page."],
];

/** Settings → Website: contact details shown on the public Avodah Loans site. Empty fields keep the site's built-in value. */
export default function Website() {
  const q = useQuery({ queryKey: ["settings-website"], queryFn: api.websiteSettings });
  if (q.isPending) return <Spinner label="Loading settings" />;
  if (q.isError) return <Alert>{q.error.message}</Alert>;
  return <Form settings={q.data.settings} />;
}

function Form({ settings }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const editable = can("settings.edit");
  const [v, setV] = useState(Object.fromEntries(FIELDS.map(([k]) => [k, settings[k] ?? ""])));
  const [errors, setErrors] = useState({});
  const [flash, setFlash] = useState(null);
  const set = (k) => (e) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const save = useMutation({
    mutationFn: () => api.updateWebsiteSettings(Object.fromEntries(FIELDS.map(([k]) => [k, v[k].trim() || null]))),
    onSuccess: (d) => { setFlash({ tone: "success", text: "Website details saved. The site picks them up on its next page load." }); queryClient.setQueryData(["settings-website"], d); },
    onError: (e) => { setErrors(e.fields ?? {}); setFlash({ tone: "error", text: e.message }); },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate className="space-y-5">
      {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}
      <Card className="max-w-2xl">
        <CardHeader title="Contact details" description="Shown to visitors on the public website. Leave a field empty to keep the site's built-in value." />
        <div className="space-y-4 px-5 py-4">
          {FIELDS.map(([k, label, props, hint]) => (
            <Field key={k} label={label} error={errors[k]} hint={hint}>
              {(p) => <Input {...p} {...props} value={v[k]} onChange={set(k)} disabled={!editable} />}
            </Field>
          ))}
        </div>
      </Card>
      <div className="flex max-w-2xl flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{settings.updatedAt ? `Last changed ${timeAgo(settings.updatedAt)}` : "Not set yet — the site shows its built-in details"}{editable ? "" : " · Only administrators can change these."}</p>
        {editable && <Button type="submit" loading={save.isPending}>Save website details</Button>}
      </div>
    </form>
  );
}
