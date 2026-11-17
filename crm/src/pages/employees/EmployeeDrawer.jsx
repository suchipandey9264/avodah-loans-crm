import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, Pencil, Phone, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Field, Modal, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { StageBadge } from "../../lib/applications";
import { useAuth } from "../../lib/auth";
import { formatDate, formatMoney, timeAgo } from "../../lib/format";

const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const ACTIVITY = {
  note: "Added a note", status_changed: "Changed a status", assigned: "Assigned a record", created: "Created a record", updated: "Updated a record",
  followup_scheduled: "Scheduled a follow-up", followup_done: "Completed a follow-up", followup_cancelled: "Cancelled a follow-up", followup_rescheduled: "Rescheduled a follow-up",
  converted: "Converted a lead", stage_changed: "Moved an application", document_uploaded: "Uploaded a document", document_verified: "Verified a document",
  "auth.login": "Signed in", "auth.logout": "Signed out", "auth.password_changed": "Changed their password",
};

function Tile({ label, value }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-3 text-center">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-[15px] font-extrabold">{value}</p>
    </div>
  );
}

export default function EmployeeDrawer({ employeeId, team, onClose, onEdit, onChanged }) {
  const ref = useRef(null);
  const { can, user: me } = useAuth();
  const q = useQuery({ queryKey: ["employee", employeeId], queryFn: () => api.employee(employeeId), enabled: Boolean(employeeId) });
  const [flash, setFlash] = useState(null);
  const [handover, setHandover] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (employeeId && !d.open) d.showModal();
    if (!employeeId && d.open) d.close();
  }, [employeeId]);
  useEffect(() => { setFlash(null); }, [employeeId]);

  const done = (text) => { setFlash({ tone: "success", text }); q.refetch(); onChanged(); };
  const status = useMutation({
    mutationFn: (s) => api.updateUser(employeeId, { status: s }),
    onSuccess: (_d, s) => done(s === "active" ? "Account reactivated." : "Account deactivated — they’ve been signed out."),
    onError: (e) => setFlash({ tone: "error", text: e.message }),
  });

  const e = q.data?.employee;
  const canEdit = can("users.edit") || can("employees.edit");
  const self = e?.id === me?.id;
  const target = e?.monthlyTarget;

  return (
    <dialog ref={ref} onClose={onClose} onClick={(ev) => ev.target === ref.current && onClose()} aria-label={e ? `Employee ${e.name}` : "Employee"}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl border-l border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-night/40">
      {employeeId && (
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            {e ? (
              <div className="min-w-0">
                <h2 className="truncate text-lg font-extrabold">{e.name}</h2>
                <p className="mt-0.5 truncate text-xs text-muted">{[e.designation ?? e.role.name, e.department, e.branch].filter(Boolean).join(" · ")}</p>
              </div>
            ) : <span className="text-sm text-muted">Employee</span>}
            <div className="flex items-center gap-1">
              {e && canEdit && <Button variant="secondary" size="sm" icon={Pencil} onClick={() => onEdit(e)}>Edit</Button>}
              <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Close"><X className="size-5" /></button>
            </div>
          </header>
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}
            {q.isPending ? <Spinner label="Loading employee" /> : q.isError ? <Alert>{q.error.message}</Alert> : (
              <>
                <div className="flex flex-wrap gap-2">
                  {e.phone && <a href={`tel:${e.phone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-canvas"><Phone className="size-4" aria-hidden />{e.phone}</a>}
                  <a href={`mailto:${e.email}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-canvas"><Mail className="size-4" aria-hidden />{e.email}</a>
                  <Badge tone={e.status === "active" ? "green" : "gray"}>{e.status === "active" ? "Active" : "Inactive"}</Badge>
                  <Badge tone="purple">{e.role.name}</Badge>
                </div>
                <section aria-label="Performance" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Tile label="Leads" value={e.stats.leads} />
                  <Tile label="Converted" value={`${e.stats.converted} (${pct(e.stats.conversion)})`} />
                  <Tile label="Files" value={e.stats.files} />
                  <Tile label="Disbursed" value={formatMoney(e.stats.disbursed)} />
                </section>
                <section aria-label="Target" className="rounded-xl border border-line p-4 text-sm">
                  <div className="flex justify-between"><span className="font-semibold">This month</span><span className="text-muted">{target ? `${formatMoney(e.stats.disbursedMonth)} of ${formatMoney(target)}` : "No target set"}</span></div>
                  {target > 0 && <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, (e.stats.disbursedMonth / target) * 100)}%` }} /></div>}
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div><dt className="text-muted">Open leads</dt><dd className="font-semibold">{e.stats.openLeads}</dd></div>
                    <div><dt className="text-muted">Files in process</dt><dd className="font-semibold">{e.stats.openFiles}</dd></div>
                    <div><dt className="text-muted">Overdue follow-ups</dt><dd className={`font-semibold ${e.stats.overdueFollowups ? "text-red-700" : ""}`}>{e.stats.overdueFollowups}</dd></div>
                    <div><dt className="text-muted">Joined</dt><dd className="font-semibold">{e.joinedOn ? formatDate(e.joinedOn) : "—"}</dd></div>
                    <div><dt className="text-muted">Last sign-in</dt><dd className="font-semibold">{e.lastLoginAt ? timeAgo(e.lastLoginAt) : "Never"}</dd></div>
                  </dl>
                </section>

                {canEdit && !self && (
                  <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
                    <div className="text-sm"><p className="font-semibold">Account active</p><p className="text-xs text-muted">Inactive users can’t sign in or receive leads.</p></div>
                    <div className="flex gap-2">
                      {can("employees.edit") && (e.stats.openLeads > 0 || e.stats.openFiles > 0) && <Button variant="secondary" size="sm" onClick={() => setHandover(true)}>Reassign work</Button>}
                      <button type="button" role="switch" aria-checked={e.status === "active"} aria-label="Account active" disabled={status.isPending}
                        onClick={() => status.mutate(e.status === "active" ? "suspended" : "active")}
                        className={`relative h-6 w-11 rounded-full transition-colors ${e.status === "active" ? "bg-brand-700" : "bg-line"}`}>
                        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${e.status === "active" ? "left-[22px]" : "left-0.5"}`} />
                      </button>
                    </div>
                  </section>
                )}

                <section aria-label="Assigned leads">
                  <h3 className="mb-2 text-sm font-bold">Open leads ({e.stats.openLeads})</h3>
                  {!q.data.openLeads.length ? <p className="text-sm text-muted">None.</p> : (
                    <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                      {q.data.openLeads.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
                          <Link to={`/leads?lead=${l.id}`} className="min-w-0 truncate font-semibold hover:text-brand-700 hover:underline">{l.name} <span className="font-normal text-muted">· {l.ref}</span></Link>
                          <Badge tone="blue">{l.statusLabel}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section aria-label="Assigned applications">
                  <h3 className="mb-2 text-sm font-bold">Files in process ({e.stats.openFiles})</h3>
                  {!q.data.openApplications.length ? <p className="text-sm text-muted">None.</p> : (
                    <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                      {q.data.openApplications.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
                          <Link to={`/applications/${a.id}`} className="min-w-0 truncate font-semibold hover:text-brand-700 hover:underline">{a.ref} <span className="font-normal text-muted">· {a.name} · {a.lenderName} · {formatMoney(a.loanAmount)}</span></Link>
                          <StageBadge stage={a.stage} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section aria-label="Activity">
                  <h3 className="mb-2 text-sm font-bold">Recent activity</h3>
                  {!q.data.activity.length ? <p className="text-sm text-muted">No activity yet.</p> : (
                    <ol className="space-y-2 text-sm">
                      {q.data.activity.map((a, i) => (
                        <li key={i} className="flex justify-between gap-3">
                          <span>{ACTIVITY[a.type] ?? a.type.replace(/[._]/g, " ")}{a.ref ? <span className="text-muted"> · {a.ref}</span> : ""}</span>
                          <span className="shrink-0 text-xs text-muted">{timeAgo(a.createdAt)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      )}
      <Handover open={handover} employee={e} team={team} onClose={() => setHandover(false)} onDone={(text) => { setHandover(false); done(text); }} />
    </dialog>
  );
}

/** Move this employee's open leads / files to a colleague (e.g. before deactivating them). */
function Handover({ open, employee, team, onClose, onDone }) {
  const { can } = useAuth();
  const [to, setTo] = useState("");
  const [what, setWhat] = useState({ leads: can("leads.assign"), applications: can("applications.edit") });
  const [error, setError] = useState(null);
  const run = useMutation({
    mutationFn: () => api.reassignEmployee(employee.id, { to, ...what }),
    onSuccess: ({ moved }) => onDone(`Moved ${moved.leads} lead${moved.leads === 1 ? "" : "s"} and ${moved.applications} file${moved.applications === 1 ? "" : "s"}.`),
    onError: (e) => setError(e.message),
  });
  const others = (team ?? []).filter((x) => x.id !== employee?.id && x.status === "active");
  return (
    <Modal open={open} onClose={onClose} title="Reassign work"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={run.isPending} disabled={!to || !(what.leads || what.applications)} onClick={() => run.mutate()}>Reassign</Button></>}>
      <div className="space-y-4 text-sm">
        {error && <Alert>{error}</Alert>}
        <Field label="Give to">{(p) => <Select {...p} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose an employee</option>{others.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.role.name}</option>)}</Select>}</Field>
        {[["leads", `Open leads (${employee?.stats.openLeads ?? 0})`, "leads.assign"], ["applications", `Files in process (${employee?.stats.openFiles ?? 0})`, "applications.edit"]].map(([k, label, perm]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={what[k]} disabled={!can(perm)} onChange={(e) => setWhat((w) => ({ ...w, [k]: e.target.checked }))} />{label}
          </label>
        ))}
      </div>
    </Modal>
  );
}
