import { ArrowLeft, MailCheck } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { z } from "zod";
import { Alert, Button, Field, Input } from "../../components/ui";
import AuthLayout from "../../layouts/AuthLayout";
import { api } from "../../lib/api";
import { check, email } from "../../lib/validation";

export default function ForgotPassword() {
  const location = useLocation();
  const [value, setValue] = useState(location.state?.email ?? "");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setFormError("");
    const { data, fields } = check(z.object({ email }), { email: value });
    setError(fields?.email ?? "");
    if (!data) return;
    setBusy(true);
    try {
      await api.forgot(data.email);
      setSent(true);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
      <ArrowLeft className="size-4" aria-hidden /> Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <div className="space-y-6">
          <div className="flex gap-3 rounded-xl border border-line bg-white p-4">
            <MailCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
            <p className="text-sm text-muted">
              If <strong className="text-ink">{value.trim().toLowerCase()}</strong> belongs to a CRM account, we’ve sent a link to reset the password. It
              works once and expires in 30 minutes.
            </p>
          </div>
          {back}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your work email and we’ll send you a link to set a new password.">
      <form onSubmit={submit} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Work email" error={error}>
          {(a) => <Input {...a} type="email" autoComplete="username" inputMode="email" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />}
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Send reset link
        </Button>
        {back}
      </form>
    </AuthLayout>
  );
}
