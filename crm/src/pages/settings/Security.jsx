import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, ShieldCheck } from "lucide-react";
import { useState } from "react";
import PasswordInput from "../../components/PasswordInput";
import { Alert, Badge, Button, Card, CardHeader, Field, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { deviceLabel, timeAgo } from "../../lib/format";
import { check, newPassword, PASSWORD_RULES } from "../../lib/validation";

/** Every signed-in user: the rules in force, change password, and their own sessions. */
export default function Security() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const p = me.data?.policy;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ChangePassword />
      <Card>
        <CardHeader title="Session & password policy" description="Enforced by the server for every CRM user." />
        {p ? (
          <ul className="space-y-3 px-5 py-4 text-sm">
            {[
              `Signed out automatically after ${p.idleMinutes} minutes without activity`,
              `Every session ends after ${p.sessionHours} hours, even when active`,
              `Passwords need at least ${p.minPasswordLength} characters, with a letter and a number`,
              `${p.lockoutAttempts} wrong passwords lock the account for ${p.lockoutMinutes} minutes`,
              `Reset links work once and expire after ${p.resetLinkMinutes} minutes`,
              "Changing or resetting a password signs out your other sessions",
              "Every sign-in, failed attempt and access change is recorded in the audit log",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        ) : (
          <Spinner />
        )}
      </Card>
      <div className="xl:col-span-2"><Sessions /></div>
    </div>
  );
}

function ChangePassword() {
  const [v, setV] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: () => api.changePassword(v.currentPassword, v.newPassword),
    onSuccess: ({ otherSessionsSignedOut: n }) => {
      setV({ currentPassword: "", newPassword: "", confirm: "" });
      setResult({ tone: "success", text: `Password changed.${n ? ` ${n} other session${n === 1 ? " was" : "s were"} signed out.` : ""}` });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err) => { setResult({ tone: "error", text: err.message }); setErrors(err.fields ?? {}); },
  });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    setResult(null);
    const next = {};
    if (!v.currentPassword) next.currentPassword = "Enter your current password";
    const { fields } = check(newPassword, v.newPassword);
    if (fields) next.newPassword = fields[""];
    else if (v.confirm !== v.newPassword) next.confirm = "Passwords don’t match";
    setErrors(next);
    if (!Object.keys(next).length) change.mutate();
  }

  return (
    <Card>
      <CardHeader title="Change password" />
      <form onSubmit={submit} noValidate className="space-y-4 px-5 py-4">
        {result && <Alert tone={result.tone}>{result.text}</Alert>}
        <Field label="Current password" error={errors.currentPassword}>
          {(a) => <PasswordInput {...a} autoComplete="current-password" value={v.currentPassword} onChange={set("currentPassword")} />}
        </Field>
        <Field label="New password" error={errors.newPassword} hint={PASSWORD_RULES.join(" · ")}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" value={v.newPassword} onChange={set("newPassword")} />}
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" value={v.confirm} onChange={set("confirm")} />}
        </Field>
        <Button type="submit" loading={change.isPending}>Change password</Button>
      </form>
    </Card>
  );
}

function Sessions() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sessions"] });
  const revoke = useMutation({ mutationFn: api.revokeSession, onSuccess: refresh });
  const revokeOthers = useMutation({ mutationFn: api.revokeOtherSessions, onSuccess: refresh });
  const list = sessions.data?.sessions ?? [];
  const others = list.filter((s) => !s.current).length;

  return (
    <Card>
      <CardHeader
        title="Your active sessions"
        description="Devices signed in to your account. Sign out any you don’t recognise, then change your password."
        action={others > 0 && <Button variant="secondary" size="sm" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>Sign out other sessions</Button>}
      />
      {sessions.isPending ? (
        <Spinner />
      ) : sessions.isError ? (
        <div className="p-5"><Alert>{sessions.error.message}</Alert></div>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <Laptop className="size-5 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {deviceLabel(s.userAgent ?? "")}
                  {s.current && <Badge tone="green">This device</Badge>}
                </p>
                <p className="text-xs text-muted">
                  <span className="font-mono">{s.ip ?? "Unknown IP"}</span> · signed in {timeAgo(s.createdAt)} · last active {timeAgo(s.lastSeenAt ?? s.createdAt)}
                </p>
              </div>
              {!s.current && (
                <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
