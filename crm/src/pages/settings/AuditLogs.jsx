import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Download, ScrollText, Search } from "lucide-react";
import { useState } from "react";
import { Alert, Avatar, Badge, Button, Card, EmptyState, Input, Pagination, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { deviceLabel, formatDate, formatTime } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";

const PAGE_SIZE = 50;

const GROUPS = [
  { value: "", label: "All activity" },
  { value: "auth.", label: "Sign-ins & passwords" },
  { value: "user.", label: "User changes" },
  { value: "session.", label: "Sessions" },
  { value: "permission.denied", label: "Access denied" },
];

const MODULE = {
  auth: ["Login", "gray"],
  user: ["Users", "purple"],
  session: ["Session", "gray"],
  permission: ["Access", "red"],
};

const actorLabel = (log) => log.actorName ?? (log.actorEmail === "cli" ? "Server console" : log.actorEmail) ?? "Unknown";

const REASONS = { wrong_password: "wrong password", unknown_account: "no such account", suspended: "account suspended" };

/** Plain-English line for an audit entry. */
function describe(log, roleName) {
  const m = log.meta ?? {};
  const who = log.targetName ?? log.targetEmail ?? m.email ?? "a user";
  switch (log.action) {
    case "auth.login": return `Signed in from ${deviceLabel(log.userAgent ?? "")}`;
    case "auth.login_failed": return `Failed sign-in (${REASONS[m.reason] ?? "rejected"})`;
    case "auth.login_blocked": return "Sign-in blocked: account is locked";
    case "auth.account_locked": return `Account locked for ${m.minutes} minutes after repeated wrong passwords`;
    case "auth.logout": return "Signed out";
    case "auth.password_changed": return "Changed their password";
    case "auth.password_change_failed": return "Entered the wrong current password while changing password";
    case "auth.password_reset_requested": return m.matched === false ? "Password reset requested for an unknown email" : "Requested a password reset link";
    case "auth.password_reset": return "Set a new password using a reset link";
    case "session.revoked": return "Signed out one of their other sessions";
    case "session.revoked_others": return `Signed out of ${m.count} other session${m.count === 1 ? "" : "s"}`;
    case "user.created": return `Added ${who} as ${roleName(m.role)}${m.invited ? " (invite sent)" : ""}`;
    case "user.role_changed": return `Changed ${who}’s role from ${roleName(m.from)} to ${roleName(m.to)}`;
    case "user.suspended": return `Suspended ${who}`;
    case "user.reactivated": return `Reactivated ${who}`;
    case "user.updated": return `Updated ${who}’s ${(m.fields ?? []).join(" and ")}`;
    case "user.password_reset_sent": return `Sent a password reset link to ${who}`;
    case "user.sessions_revoked": return `Signed ${who} out of ${m.count} session${m.count === 1 ? "" : "s"}`;
    case "user.admin_created_by_script": return `Admin ${who} created from the server console`;
    case "user.admin_reset_by_script": return `Admin ${who} reset from the server console`;
    case "permission.denied": return `Tried to ${m.method} ${m.path} without “${m.permission}”`;
    default: return log.action;
  }
}

export default function AuditLogs() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  const reset = (setter) => (e) => { setter(e.target.value); setPage(1); };

  const roles = useQuery({ queryKey: ["roles"], queryFn: api.roles, enabled: can("users.view") || can("roles.view") });
  const staff = useQuery({ queryKey: ["users", "all-for-filter"], queryFn: () => api.users({ pageSize: 100 }), enabled: can("users.view") });
  const filters = {
    q: search, action, actorId,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  };
  const logs = useQuery({
    queryKey: ["audit", { ...filters, page }],
    queryFn: () => api.auditLogs({ ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const exp = useMutation({ mutationFn: () => api.exportAuditLogs(filters) });
  const roleName = (id) => roles.data?.roles.find((r) => r.id === id)?.name ?? id ?? "—";
  const rows = logs.data?.logs ?? [];

  return (
    <Card>
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_auto_auto]">
        <div className="relative sm:col-span-2 xl:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" placeholder="Search email, activity or IP" aria-label="Search activity" className="pl-9" value={q} onChange={reset(setQ)} />
        </div>
        <Select aria-label="Activity type" value={action} onChange={reset(setAction)}>
          {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </Select>
        {can("users.view") ? (
          <Select aria-label="User" value={actorId} onChange={reset(setActorId)}>
            <option value="">All users</option>
            {(staff.data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        ) : <div className="hidden xl:block" />}
        <Input type="date" aria-label="From date" value={from} max={to || undefined} onChange={reset(setFrom)} />
        <Input type="date" aria-label="To date" value={to} min={from || undefined} onChange={reset(setTo)} />
      </div>
      {can("audit.export") && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-b border-line px-4 py-2">
          {exp.isError && <span className="text-sm text-red-700">{exp.error.message}</span>}
          <Button variant="secondary" size="sm" icon={Download} loading={exp.isPending} onClick={() => exp.mutate()}>Export CSV</Button>
        </div>
      )}

      {logs.isPending ? (
        <Spinner label="Loading activity" />
      ) : logs.isError ? (
        <div className="p-5"><Alert>{logs.error.message}</Alert></div>
      ) : !rows.length ? (
        <EmptyState icon={ScrollText} title="No activity found">Try widening the dates or clearing the filters.</EmptyState>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] font-bold uppercase tracking-wider text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="px-5 py-3">When</th>
                  <th scope="col" className="px-3 py-3">User</th>
                  <th scope="col" className="px-3 py-3">Module</th>
                  <th scope="col" className="px-3 py-3">Activity</th>
                  <th scope="col" className="px-5 py-3">IP address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((log) => {
                  const [mod, tone] = MODULE[log.action.split(".")[0]] ?? ["Other", "gray"];
                  const name = actorLabel(log);
                  return (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap px-5 py-3">
                        <p>{formatDate(log.createdAt)}</p>
                        <p className="text-xs text-muted">{formatTime(log.createdAt)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{name}</p>
                            {log.actorName && log.actorEmail && <p className="truncate text-xs text-muted">{log.actorEmail}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3"><Badge tone={tone}>{mod}</Badge></td>
                      <td className="px-3 py-3">{describe(log, roleName)}</td>
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-muted">{log.ip ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line md:hidden">
            {rows.map((log) => {
              const [mod, tone] = MODULE[log.action.split(".")[0]] ?? ["Other", "gray"];
              return (
                <li key={log.id} className="space-y-1.5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{actorLabel(log)}</p>
                    <Badge tone={tone}>{mod}</Badge>
                  </div>
                  <p className="text-sm">{describe(log, roleName)}</p>
                  <p className="text-xs text-muted">
                    {formatDate(log.createdAt)}, {formatTime(log.createdAt)} · <span className="font-mono">{log.ip ?? "—"}</span>
                  </p>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={logs.data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}
