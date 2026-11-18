import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import PasswordInput from "../../components/PasswordInput";
import { Alert, Button, Field, Input } from "../../components/ui";
import AuthLayout from "../../layouts/AuthLayout";
import { api } from "../../lib/api";
import { check, email, newPassword, personName, PASSWORD_RULES } from "../../lib/validation";

const schema = z.object({ name: personName, email, password: newPassword });

const back = (
  <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
    <ArrowLeft className="size-4" aria-hidden /> Back to sign in
  </Link>
);

/** Requests a CRM account. It stays pending, with no access, until an admin approves it in Settings → Users. */
export default function Signup() {
  const [values, setValues] = useState({ name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setFormError("");
    const { data, fields } = check(schema, values);
    const next = { ...fields };
    if (data && values.confirm !== values.password) next.confirm = "Passwords don’t match";
    setErrors(next);
    if (!data || next.confirm) return;
    setBusy(true);
    try {
      await api.signup(data);
      setSent(true);
    } catch (err) {
      setFormError(err.message);
      setErrors(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout title="Request sent">
        <div className="space-y-6">
          <div className="flex gap-3 rounded-xl border border-line bg-white p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
            <p className="text-sm text-muted">
              An administrator will review the request for <strong className="text-ink">{values.email.trim().toLowerCase()}</strong>. Once it’s approved, sign in
              with this email and the password you just chose.
            </p>
          </div>
          {back}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" subtitle="An administrator approves every new account before it can sign in.">
      <form onSubmit={submit} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Full name" error={errors.name}>
          {(a) => <Input {...a} autoComplete="name" value={values.name} onChange={set("name")} autoFocus />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" value={values.email} onChange={set("email")} />}
        </Field>
        <Field label="Password" error={errors.password} hint={PASSWORD_RULES.join(" · ")}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" value={values.password} onChange={set("password")} />}
        </Field>
        <Field label="Confirm password" error={errors.confirm}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" value={values.confirm} onChange={set("confirm")} />}
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Create account
        </Button>
        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
