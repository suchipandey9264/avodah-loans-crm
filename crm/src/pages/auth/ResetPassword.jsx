import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import PasswordInput from "../../components/PasswordInput";
import { Alert, Button, Field } from "../../components/ui";
import AuthLayout from "../../layouts/AuthLayout";
import { api } from "../../lib/api";
import { check, newPassword, PASSWORD_RULES } from "../../lib/validation";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const uid = params.get("uid");
  const token = params.get("token");
  const invite = params.get("invite") === "1";
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!uid || !token) {
    return (
      <AuthLayout title="This link isn’t complete">
        <Alert>Open the link from your email again, or request a new one.</Alert>
        <Link to="/forgot-password" className="mt-6 inline-block text-sm font-semibold text-brand-700 hover:underline">Request a new link</Link>
      </AuthLayout>
    );
  }

  async function submit(e) {
    e.preventDefault();
    setFormError("");
    const { data, fields } = check(newPassword, values.password);
    const next = {};
    if (fields) next.password = fields[""];
    if (data && values.confirm !== values.password) next.confirm = "Passwords don’t match";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await api.reset(uid, token, values.password);
      navigate("/login", { replace: true, state: { reset: true } });
    } catch (err) {
      setFormError(err.message);
      setErrors(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={invite ? "Welcome — set your password" : "Choose a new password"}
      subtitle={invite ? "Set a password to finish setting up your CRM account." : "After this, you’ll be signed out everywhere and can sign in with the new password."}
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {formError && (
          <Alert>
            {formError} <Link to="/forgot-password" className="font-semibold underline">Request a new link</Link>
          </Alert>
        )}
        <Field label="New password" error={errors.password} hint={PASSWORD_RULES.join(" · ")}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" value={values.password} onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} autoFocus />}
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" value={values.confirm} onChange={(e) => setValues((v) => ({ ...v, confirm: e.target.value }))} />}
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          {invite ? "Set password" : "Update password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
