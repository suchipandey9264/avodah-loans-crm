import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import PasswordInput from "../../components/PasswordInput";
import { Alert, Button, Field, Input, Modal, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { PASSWORD_RULES } from "../../lib/validation";

const WORK = ["department", "designation", "branch", "monthlyTarget", "joinedOn"];

/** Add an employee (a CRM user with a role) or edit one. Saved through the same /users API as Settings → Users. */
export default function EmployeeForm({ open, employee, roles, branches, onClose, onSaved }) {
  return (
    <Modal open={open} onClose={onClose} title={employee ? `Edit ${employee.name}` : "Add employee"} wide>
      {open && <Body employee={employee} roles={roles} branches={branches} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function Body({ employee, roles, branches, onClose, onSaved }) {
  const [v, setV] = useState(() => ({
    name: employee?.name ?? "", email: employee?.email ?? "", phone: employee?.phone ?? "", roleId: employee?.role.id ?? "",
    department: employee?.department ?? "", designation: employee?.designation ?? "", branch: employee?.branch ?? "",
    monthlyTarget: employee?.monthlyTarget ?? "", joinedOn: employee?.joinedOn ?? "", mode: "invite", password: "",
  }));
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined, form: undefined })); };

  const save = useMutation({
    mutationFn: () => {
      const work = Object.fromEntries(WORK.map((k) => [k, String(v[k]).trim() === "" ? null : k === "monthlyTarget" ? Number(v[k]) : String(v[k]).trim()]));
      if (employee) {
        const body = { name: v.name.trim(), phone: v.phone.trim() || null, ...work, ...(v.roleId !== employee.role.id ? { roleId: v.roleId } : {}) };
        return api.updateUser(employee.id, body);
      }
      const body = { name: v.name.trim(), email: v.email.trim(), roleId: v.roleId, ...(v.phone.trim() ? { phone: v.phone.trim() } : {}), ...(v.mode === "password" ? { password: v.password } : {}) };
      for (const [k, x] of Object.entries(work)) if (x != null) body[k] = x;
      return api.createUser(body);
    },
    onSuccess: (d) => onSaved(employee ? "Employee updated." : d.invited ? `Employee added — an invite link was sent to ${v.email.trim()}.` : "Employee added."),
    onError: (e) => setErrors({ ...e.fields, form: e.message }),
  });
  const submit = (e) => {
    e.preventDefault();
    const miss = {};
    if (v.name.trim().length < 2) miss.name = "Enter the full name";
    if (!employee && !v.email.trim()) miss.email = "Enter a work email";
    if (!v.roleId) miss.roleId = "Choose a role";
    if (Object.keys(miss).length) return setErrors(miss);
    save.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {errors.form && <Alert>{errors.form}</Alert>}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold">Profile &amp; contact</legend>
        <Field label="Full name" error={errors.name}>{(p) => <Input {...p} value={v.name} onChange={set("name")} autoComplete="off" />}</Field>
        <Field label="Work email" error={errors.email} hint={employee ? "Email can’t be changed here." : undefined}>
          {(p) => <Input {...p} type="email" value={v.email} onChange={set("email")} disabled={!!employee} />}
        </Field>
        <Field label="Mobile" error={errors.phone}>{(p) => <Input {...p} inputMode="numeric" value={v.phone} onChange={set("phone")} />}</Field>
        <Field label="Role" error={errors.roleId}>
          {(p) => (
            <Select {...p} value={v.roleId} onChange={set("roleId")}>
              <option value="">Choose a role</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          )}
        </Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold">Work</legend>
        <Field label="Department" error={errors.department}>{(p) => <Input {...p} placeholder="e.g. Sales" value={v.department} onChange={set("department")} />}</Field>
        <Field label="Designation" error={errors.designation}>{(p) => <Input {...p} placeholder="e.g. Senior Executive" value={v.designation} onChange={set("designation")} />}</Field>
        <Field label="Branch" error={errors.branch}>
          {(p) => (
            <>
              <Input {...p} list="employee-branches" placeholder="e.g. Mumbai HQ" value={v.branch} onChange={set("branch")} />
              <datalist id="employee-branches">{branches.map((b) => <option key={b} value={b} />)}</datalist>
            </>
          )}
        </Field>
        <Field label="Monthly target (₹ disbursed)" error={errors.monthlyTarget}>{(p) => <Input {...p} type="number" min="0" step="1000" value={v.monthlyTarget} onChange={set("monthlyTarget")} />}</Field>
        <Field label="Joined on" error={errors.joinedOn}>{(p) => <Input {...p} type="date" value={v.joinedOn} onChange={set("joinedOn")} />}</Field>
      </fieldset>
      {!employee && (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-bold">Sign-in</legend>
          {[["invite", "Email an invite link", "They choose their own password (link valid 72 hours)."], ["password", "Set a password now", "Share it with them securely."]].map(([id, label, hint]) => (
            <label key={id} className="flex items-start gap-2 text-sm">
              <input type="radio" name="mode" value={id} checked={v.mode === id} onChange={set("mode")} className="mt-1" />
              <span><span className="font-semibold">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
            </label>
          ))}
          {v.mode === "password" && (
            <Field label="Password" error={errors.password} hint={PASSWORD_RULES.join(" · ")}>
              {(p) => <PasswordInput {...p} autoComplete="new-password" value={v.password} onChange={set("password")} />}
            </Field>
          )}
        </fieldset>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>{employee ? "Save changes" : "Add employee"}</Button>
      </div>
    </form>
  );
}
