import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import PasswordInput from "../../components/PasswordInput";
import { Alert, Button, Field, Input } from "../../components/ui";
import AuthLayout from "../../layouts/AuthLayout";
import { useAuth } from "../../lib/auth";
import { check, email } from "../../lib/validation";

const schema = z.object({ email, password: z.string().min(1, "Enter your password") });

export default function Login() {
  const { login, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setFormError("");
    const { data, fields } = check(schema, values);
    setErrors(fields ?? {});
    if (!data) return;
    setBusy(true);
    try {
      await login(data.email, data.password);
      navigate(location.state?.from ?? "/", { replace: true });
    } catch (err) {
      setFormError(err.message);
      setErrors(err.fields ?? {});
      setValues((v) => ({ ...v, password: "" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Sign in to the CRM" subtitle="Use the work email your administrator set up for you.">
      <form onSubmit={submit} noValidate className="space-y-5">
        {location.state?.reset && <Alert tone="success">Password updated. Sign in with your new password.</Alert>}
        {notice && !formError && <Alert tone="info">{notice}</Alert>}
        {formError && <Alert>{formError}</Alert>}
        <Field label="Work email" error={errors.email}>
          {(a) => <Input {...a} type="email" autoComplete="username" inputMode="email" value={values.email} onChange={set("email")} autoFocus />}
        </Field>
        <Field label="Password" error={errors.password}>
          {(a) => <PasswordInput {...a} autoComplete="current-password" value={values.password} onChange={set("password")} />}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" state={{ email: values.email }} className="text-sm font-semibold text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
