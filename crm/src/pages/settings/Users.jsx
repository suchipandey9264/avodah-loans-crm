import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, Search, UserPlus, Users as UsersIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import PasswordInput from "../../components/PasswordInput";
import { Alert, Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, Pagination, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";
import { check, email, newPassword, personName, phone, PASSWORD_RULES } from "../../lib/validation";

const PAGE_SIZE = 25;

function StatusBadge({ user }) {
  if (user.status === "pending") return <Badge tone="orange" dot>Waiting for approval</Badge>;
  if (user.status === "suspended") return <Badge tone="red" dot>Suspended</Badge>;
  if (user.locked) return <Badge tone="amber" dot>Locked</Badge>;
  if (!user.lastLoginAt) return <Badge tone="purple" dot>Never signed in</Badge>;
  return <Badge tone="green" dot>Active</Badge>;
}

export default function Users() {
  const { user: me, can } = useAuth();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(null); // { title, body, label, run }
  const [flash, setFlash] = useState(null); // { tone, text }
  const search = useDebounced(q);

  const roles = useQuery({ queryKey: ["roles"], queryFn: api.roles });
  const list = useQuery({
    queryKey: ["users", { search, role, status, page }],
    queryFn: () => api.users({ q: search, role, status, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const canEdit = can("users.edit");
  // Mirrors the backend rule: only roles ranked below your own (an Admin manages everyone).
  const manageable = (rank) => me.role.id === "admin" || rank < me.role.rank;
  const assignable = (roles.data?.roles ?? []).filter((r) => manageable(r.rank));

  const done = (text) => {
    setFlash({ tone: "success", text });
    queryClient.invalidateQueries({ queryKey: ["users"] });
  };
  const failed = (err) => setFlash({ tone: "error", text: err.message });

  const update = useMutation({
    mutationFn: ({ id, patch }) => api.updateUser(id, patch),
    onSuccess: ({ user, sessionsSignedOut }, { patch, signup }) =>
      done(
        patch.roleId
          ? `${user.name} is now ${user.role.name}.${sessionsSignedOut ? " They’ve been signed out to pick up the new access." : ""}`
          : signup
            ? patch.status === "active" ? `${user.name} is approved and can sign in now as ${user.role.name}.` : `${user.name}’s sign-up was declined.`
            : patch.status === "suspended"
              ? `${user.name} is suspended and signed out.`
              : `${user.name} is active again.`
      ),
    onError: failed,
  });
  const reset = useMutation({ mutationFn: (u) => api.sendReset(u.id), onSuccess: (_d, u) => done(`Reset link sent to ${u.email}.`), onError: failed });
  const signOut = useMutation({ mutationFn: (u) => api.signOutUser(u.id), onSuccess: (d, u) => done(`${u.name} signed out of ${d.signedOut} session${d.signedOut === 1 ? "" : "s"}.`), onError: failed });

  const actionsFor = (u) => {
    const self = u.id === me.id;
    const allowed = canEdit && (self || manageable(u.role.rank));
    if (!allowed) return null;
    if (u.status === "pending") {
      return (
        <div className="flex flex-wrap justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setConfirm({ title: `Approve ${u.name}?`, body: `${u.email} will be able to sign in as ${u.role.name}. To give more access, change their role first.`, label: "Approve", run: () => update.mutate({ id: u.id, patch: { status: "active" }, signup: true }) })}>
            Approve
          </Button>
          <Button variant="ghost" size="sm" className="text-red-700 hover:bg-red-50" onClick={() => setConfirm({ title: `Decline ${u.name}?`, body: "They won’t be able to sign in. The request stays in the list as suspended.", label: "Decline", danger: true, run: () => update.mutate({ id: u.id, patch: { status: "suspended" }, signup: true }) })}>
            Decline
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap justify-end gap-1">
        {u.status === "active" && (
          <Button variant="ghost" size="sm" icon={KeyRound} onClick={() => setConfirm({ title: "Send a reset link?", body: `${u.email} will get a link to set a new password. Their current password keeps working until they use it.`, label: "Send link", run: () => reset.mutate(u) })}>
            Reset
          </Button>
        )}
        {!self && u.activeSessions > 0 && (
          <Button variant="ghost" size="sm" icon={LogOut} onClick={() => setConfirm({ title: `Sign ${u.name} out?`, body: `This ends their ${u.activeSessions} active session${u.activeSessions === 1 ? "" : "s"} on every device.`, label: "Sign out", run: () => signOut.mutate(u) })}>
            Sign out
          </Button>
        )}
        {!self &&
          (u.status === "active" ? (
            <Button variant="ghost" size="sm" className="text-red-700 hover:bg-red-50" onClick={() => setConfirm({ title: `Suspend ${u.name}?`, body: "They’ll be signed out immediately and can’t sign in until reactivated. Their records stay.", label: "Suspend", danger: true, run: () => update.mutate({ id: u.id, patch: { status: "suspended" } }) })}>
              Suspend
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: u.id, patch: { status: "active" } })}>
              Reactivate
            </Button>
          ))}
      </div>
    );
  };

  const roleControl = (u, id) => {
    const editable = canEdit && u.id !== me.id && manageable(u.role.rank);
    if (!editable) return <span className="text-sm">{u.role.name}</span>;
    return (
      <Select
        id={id}
        aria-label={`Role for ${u.name}`}
        compact
        className="max-w-48"
        value={u.role.id}
        disabled={update.isPending}
        onChange={(e) => {
          const next = assignable.find((r) => r.id === e.target.value);
          setConfirm({ title: `Make ${u.name} ${next.name}?`, body: "They’ll be signed out and get the new role’s access when they sign in again.", label: "Change role", run: () => update.mutate({ id: u.id, patch: { roleId: next.id } }) });
        }}
      >
        {assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Select>
    );
  };

  const users = list.data?.users ?? [];

  return (
    <div className="space-y-4">
      {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_10rem_auto]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" placeholder="Search name, email or phone" aria-label="Search users" className="pl-9" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <Select aria-label="Filter by role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <option value="">All roles</option>
            {(roles.data?.roles ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="pending">Waiting for approval</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
          {can("users.create") && <Button icon={UserPlus} onClick={() => setAdding(true)} className="sm:col-span-2 lg:col-span-1">Add user</Button>}
        </div>

        {list.isPending ? (
          <Spinner label="Loading users" />
        ) : list.isError ? (
          <div className="p-5"><Alert>{list.error.message}</Alert></div>
        ) : !users.length ? (
          <EmptyState icon={UsersIcon} title="No users match">Try a different search or filter.</EmptyState>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] font-bold uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-5 py-3">User</th>
                    <th scope="col" className="px-3 py-3">Email</th>
                    <th scope="col" className="px-3 py-3">Role</th>
                    <th scope="col" className="px-3 py-3">Last sign-in</th>
                    <th scope="col" className="px-3 py-3">Status</th>
                    <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {users.map((u) => (
                    <tr key={u.id} className="align-middle">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} />
                          <div className="min-w-0">
                            <p className="font-semibold">{u.name}{u.id === me.id && <span className="ml-1.5 text-xs font-medium text-muted">(you)</span>}</p>
                            {u.phone && <p className="text-xs text-muted">+91 {u.phone}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted">{u.email}</td>
                      <td className="px-3 py-3">{roleControl(u, `role-${u.id}`)}</td>
                      <td className="px-3 py-3 text-muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never"}</td>
                      <td className="px-3 py-3"><StatusBadge user={u} /></td>
                      <td className="px-5 py-3">{actionsFor(u)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile & tablet cards */}
            <ul className="divide-y divide-line lg:hidden">
              {users.map((u) => (
                <li key={u.id} className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={u.name} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{u.name}{u.id === me.id && <span className="ml-1.5 text-xs font-medium text-muted">(you)</span>}</p>
                      <p className="truncate text-[13px] text-muted">{u.email}</p>
                      <p className="text-xs text-muted">Last sign-in: {u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never"}</p>
                    </div>
                    <StatusBadge user={u} />
                  </div>
                  <div>{roleControl(u, `role-m-${u.id}`)}</div>
                  {actionsFor(u)}
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <AddUserModal
        open={adding}
        roles={assignable}
        onClose={() => setAdding(false)}
        onCreated={({ user, invited }) => {
          setAdding(false);
          done(invited ? `${user.name} added. An invite link was sent to ${user.email}.` : `${user.name} added and can sign in now.`);
        }}
      />

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm?.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm?.danger ? "danger" : "primary"} onClick={() => { confirm.run(); setConfirm(null); }}>{confirm?.label}</Button>
          </>
        }
      >
        <p className="text-sm text-muted">{confirm?.body}</p>
      </Modal>
    </div>
  );
}

const EMPTY = { name: "", email: "", phone: "", roleId: "", mode: "invite", password: "" };

function AddUserModal({ open, roles, onClose, onCreated }) {
  const [v, setV] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const create = useMutation({
    mutationFn: api.createUser,
    onSuccess: (data) => { setV(EMPTY); setErrors({}); onCreated(data); },
    onError: (err) => { setFormError(err.message); setErrors(err.fields ?? {}); },
  });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const close = () => { setV(EMPTY); setErrors({}); setFormError(""); onClose(); };

  function submit(e) {
    e.preventDefault();
    setFormError("");
    const schema = z.object({
      name: personName,
      email,
      phone: v.phone.trim() ? phone : z.any().transform(() => undefined),
      roleId: z.string().min(1, "Choose a role"),
      password: v.mode === "password" ? newPassword : z.any().transform(() => undefined),
    });
    const { data, fields } = check(schema, v);
    setErrors(fields ?? {});
    if (data) create.mutate(Object.fromEntries(Object.entries(data).filter(([, x]) => x !== undefined)));
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a CRM user"
      footer={
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit" form="add-user" loading={create.isPending}>Add user</Button>
        </>
      }
    >
      <form id="add-user" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Full name" error={errors.name}>{(a) => <Input {...a} value={v.name} onChange={set("name")} autoComplete="off" />}</Field>
        <Field label="Work email" error={errors.email}>{(a) => <Input {...a} type="email" value={v.email} onChange={set("email")} autoComplete="off" />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile (optional)" error={errors.phone}>{(a) => <Input {...a} inputMode="numeric" maxLength={10} value={v.phone} onChange={set("phone")} />}</Field>
          <Field label="Role" error={errors.roleId}>
            {(a) => (
              <Select {...a} value={v.roleId} onChange={set("roleId")}>
                <option value="">Choose…</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold">How will they get in?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ["invite", "Email an invite link", "They choose their own password (link valid 72 hours)."],
              ["password", "Set a password now", "Share it with them securely."],
            ].map(([value, title, desc]) => (
              <label key={value} className={`cursor-pointer rounded-xl border p-3 text-sm ${v.mode === value ? "border-brand-500 bg-brand-50" : "border-line hover:border-brand-200"}`}>
                <input type="radio" name="mode" value={value} checked={v.mode === value} onChange={set("mode")} className="sr-only" />
                <span className="block font-semibold">{title}</span>
                <span className="mt-0.5 block text-xs text-muted">{desc}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {v.mode === "password" && (
          <Field label="Password" error={errors.password} hint={PASSWORD_RULES.join(" · ")}>
            {(a) => <PasswordInput {...a} autoComplete="new-password" value={v.password} onChange={set("password")} />}
          </Field>
        )}
      </form>
    </Modal>
  );
}
