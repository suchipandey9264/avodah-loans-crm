import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Download, Lock, Mail, MapPin, Pencil, Phone, Plus, Trash2, Upload, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ApplicationForm from "../applications/ApplicationForm";
import { Alert, Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { empLabel, KycBadge, Score, scoreBand, useCustomerMeta, useCustomerRefresh } from "../../lib/customers";
import { formatDate, formatMoney, formatTime, timeAgo } from "../../lib/format";
import { FU_STATE, fuType } from "../../lib/followups";
import FollowupForm from "../followups/FollowupForm";
import { LEAD_STATUS, StatusBadge } from "../../lib/leads";
import CustomerForm from "./CustomerForm";

const APP_STATUS = { submitted: ["Submitted", "gray"], in_review: ["In review", "amber"], approved: ["Approved", "green"], disbursed: ["Disbursed", "purple"], rejected: ["Rejected", "red"] };
const DOC_STATUS = { uploaded: ["Awaiting review", "amber"], verified: ["Verified", "green"], rejected: ["Rejected", "red"] };
const FIELD_LABEL = {
  name: "name", phone: "mobile", email: "email", alternatePhone: "alternate mobile", dob: "date of birth", gender: "gender", marital: "marital status",
  pan: "PAN", aadhaarLast4: "Aadhaar", address: "address", city: "city", state: "state", pincode: "pincode", permanentSame: "permanent address",
  permanentAddress: "permanent address", permanentCity: "permanent city", permanentState: "permanent state", permanentPincode: "permanent pincode",
  emp: "employment", company: "employer", annualIncome: "annual income",
};
const KYC_LABEL = { pending: "Pending", verified: "Verified", re_kyc: "Re-KYC" };
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** One readable line for every kind of history entry. */
function describe(h) {
  const m = h.meta ?? {};
  const lead = h.leadRef ? `${h.leadRef}: ` : "";
  switch (h.type) {
    case "registered": return "Signed up on the website";
    case "created": return m.source === "lead" ? `Became a customer when lead ${m.leadRef} was converted` : "Customer added in the CRM";
    case "lead_linked": return `Lead ${m.leadRef} linked to this customer on conversion`;
    case "updated": return `Updated ${(m.fields ?? []).map((f) => FIELD_LABEL[f] ?? f).join(", ")}`;
    case "kyc_changed": return `KYC changed from ${KYC_LABEL[m.from]} to ${KYC_LABEL[m.to]}`;
    case "credit_score_updated": return m.to == null ? "CIBIL score removed" : `CIBIL score ${m.from == null ? "recorded" : `updated from ${m.from}`} as ${m.to}`;
    case "rm_assigned": return m.to ? `Relationship manager set to ${m.toName}` : "Relationship manager removed";
    case "note": return `${lead}${h.body}`; // a note on one of the customer's leads carries its lead ID
    case "document_uploaded": return `Uploaded ${m.label} (${m.fileName})`;
    case "document_verified": return `Verified ${m.label} (${m.fileName})`;
    case "document_rejected": return `Rejected ${m.label} (${m.fileName})${h.body ? ` — ${h.body}` : ""}`;
    case "document_uploaded_back": return `Marked ${m.label} as awaiting review`;
    case "document_deleted": return `Removed ${m.label} (${m.fileName})`;
    case "lead_received": return `${lead}${m.kind === "crm" ? `Lead added (${m.source})` : `Enquiry received via ${m.source}`}`;
    case "application_created": return `${m.ref}: application ${m.website ? "submitted on the website" : "logged"} with ${m.lender} — ${m.loanType}, ${formatMoney(m.loanAmount)}${m.leadRef ? ` (from ${m.leadRef})` : ""}`;
    case "status_changed": return `${lead}moved from ${LEAD_STATUS[m.from]?.[0] ?? m.from} to ${LEAD_STATUS[m.to]?.[0] ?? m.to}${m.reason ? ` — ${m.reason}` : ""}`;
    case "assigned": return `${lead}${m.to ? `assigned to ${m.toName ?? "an employee"}` : "moved to the unassigned pool"}`;
    case "followup_scheduled": return `${lead}${fuType(m.type)} scheduled for ${formatDate(m.dueAt)}${h.body ? ` — ${h.body}` : ""}`;
    case "followup_done": return `${lead}${fuType(m.type)} follow-up done${h.body ? ` — ${h.body}` : ""}`;
    case "followup_cancelled": return `${lead}${fuType(m.type)} follow-up cancelled${h.body ? ` — ${h.body}` : ""}`;
    case "followup_rescheduled": return `${lead}${fuType(m.type)} rescheduled to ${formatDate(m.dueAt)}${h.body ? ` — ${h.body}` : ""}`;
    case "followup_updated": return `${lead}${fuType(m.type)} follow-up updated`;
    case "converted": return `${lead}converted — application ${m.applicationRef} with ${m.lender}`;
    case "deleted": return `${lead}lead deleted`;
    default: return `${lead}${h.type.replace(/_/g, " ")}`;
  }
}

const TABS = [
  ["overview", "Overview"], ["details", "Details"], ["applications", "Applications"], ["documents", "Documents"], ["leads", "Leads & follow-ups"], ["history", "History"],
];

export default function CustomerProfile() {
  const { id } = useParams();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const tab = TABS.some(([t]) => t === params.get("tab")) ? params.get("tab") : "overview";
  const q = useQuery({ queryKey: ["customer", id], queryFn: () => api.customer(id) });
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState(location.state?.flash ? { tone: "success", text: location.state.flash } : null);
  const refresh = useCustomerRefresh();
  const done = (text) => { setFlash({ tone: "success", text }); refresh(id); };
  const failed = (e) => setFlash({ tone: "error", text: e.message });

  if (q.isPending) return <Spinner label="Loading customer" />;
  if (q.isError) return (
    <div className="space-y-4">
      <Link to="/customers" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Customers</Link>
      <Alert>{q.error.message}</Alert>
    </div>
  );
  const { customer: c, stats } = q.data;
  const counts = { applications: q.data.applications.length, documents: q.data.documents.length, leads: q.data.leads.length + q.data.followups.length, history: q.data.history.length };

  return (
    <>
      <Link to="/customers" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Customers</Link>

      <Card className="mb-5 flex flex-wrap items-center gap-5 p-5">
        <span className="hidden sm:block"><Avatar name={c.name || c.phone} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl">{c.name || "Unnamed customer"} <KycBadge status={c.kycStatus} /></h1>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span>{c.code}</span>
            {c.phone && <a href={`tel:+91${c.phone}`} className="inline-flex items-center gap-1 hover:text-ink"><Phone className="size-3.5" aria-hidden />+91 {c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-ink"><Mail className="size-3.5" aria-hidden />{c.email}</a>}
            {c.city && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{c.city}</span>}
          </p>
        </div>
        <dl className="flex gap-6 text-right">
          <div><dt className="text-xs text-muted">CIBIL</dt><dd className="text-xl"><Score value={c.creditScore} /></dd></div>
          <div><dt className="text-xs text-muted">Applications</dt><dd className="text-xl font-bold">{stats.applications}</dd></div>
          <div><dt className="text-xs text-muted">Disbursed</dt><dd className="text-xl font-bold">{formatMoney(stats.disbursed)}</dd></div>
        </dl>
      </Card>

      {flash && <div className="mb-4"><Alert tone={flash.tone}>{flash.text}</Alert></div>}

      <nav aria-label="Customer sections" className="-mx-4 mb-5 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1">
          {TABS.map(([t, label]) => (
            <li key={t}>
              <button type="button" onClick={() => setParams(t === "overview" ? {} : { tab: t }, { replace: true })} aria-current={tab === t ? "page" : undefined}
                className={`flex items-center gap-1.5 border-b-2 px-3 pb-3 pt-1 text-sm font-semibold ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink"}`}>
                {label}{counts[t] != null && <span className={`rounded-full px-1.5 text-[11px] ${tab === t ? "bg-brand-700 text-white" : "bg-canvas text-muted"}`}>{counts[t]}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "overview" && <Overview data={q.data} canEdit={can("customers.edit")} onEdit={() => setEditing(true)} />}
      {tab === "details" && <Details data={q.data} canEdit={can("customers.edit")} canKyc={can("customers.kyc")} onEdit={() => setEditing(true)} onDone={done} onError={failed} />}
      {tab === "applications" && <Applications apps={q.data.applications} customer={c} />}
      {tab === "documents" && <Documents data={q.data} canEdit={can("customers.edit")} canKyc={can("customers.kyc")} onDone={done} onError={failed} />}
      {tab === "leads" && <LeadsTab data={q.data} canSchedule={can("followups.create")} onDone={done} />}
      {tab === "history" && <History data={q.data} canNote={can("customers.edit")} onDone={done} onError={failed} />}

      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} onSaved={({ changed }) => { setEditing(false); done(changed?.length ? "Customer updated." : "No changes to save."); }} />}
    </>
  );
}

function Pairs({ rows }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 px-5 py-4 text-sm sm:grid-cols-2">
      {rows.map(([k, val]) => (
        <div key={k} className="min-w-0"><dt className="text-xs text-muted">{k}</dt><dd className="break-words font-semibold">{val || <span className="font-normal text-muted">—</span>}</dd></div>
      ))}
    </dl>
  );
}

function Overview({ data, canEdit, onEdit }) {
  const meta = useCustomerMeta().data;
  const { customer: c, stats } = data;
  const band = scoreBand(c.creditScore);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="min-w-0">
        <CardHeader title="Personal & KYC" action={canEdit && <Button variant="secondary" size="sm" icon={Pencil} onClick={onEdit}>Edit</Button>} />
        <Pairs rows={[
          ["Date of birth", c.dob && formatDate(c.dob)],
          ["PAN", c.pan && <span className="inline-flex items-center gap-1.5">{c.pan}{c.panMasked && <Lock className="size-3.5 text-muted" aria-label="Masked for your role" />}</span>],
          ["Address", [c.address, c.city, c.pincode].filter(Boolean).join(", ")],
          ["Employment", empLabel(meta, c.emp)],
          ["Employer / business", c.company],
          ["Annual income", c.annualIncome && formatMoney(c.annualIncome)],
          ["Relationship manager", c.relationshipManagerName],
          ["Customer since", formatDate(c.createdAt)],
        ]} />
      </Card>
      <Card className="min-w-0">
        <CardHeader title="Credit snapshot" />
        <div className="px-5 py-4">
          {band ? (
            <>
              <p className={`text-center text-5xl font-extrabold ${band.text}`}>{c.creditScore}</p>
              <p className="mt-1 text-center text-xs text-muted">CIBIL · {band.label}{c.creditScoreUpdatedAt ? ` · recorded ${formatDate(c.creditScoreUpdatedAt)}` : ""}</p>
              <div className="relative mt-4 h-2 rounded-full bg-canvas" role="img" aria-label={`CIBIL ${c.creditScore} on a scale of 300 to 900`}>
                <div className="h-full rounded-full" style={{ width: `${((c.creditScore - 300) / 600) * 100}%`, background: band.fill }} />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted"><span>300</span><span>900</span></div>
            </>
          ) : <p className="py-6 text-center text-sm text-muted">No CIBIL score recorded yet.</p>}
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">Disbursed loans with us</dt><dd className="font-semibold">{stats.disbursedCount}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Active applications</dt><dd className="font-semibold">{stats.activeApplications}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Lead source</dt><dd className="font-semibold">{stats.firstLeadSource ?? (data.leads.length ? "—" : c.createdByName ? "Added in the CRM" : "Website sign-up")}</dd></div>
          </dl>
        </div>
      </Card>
      <div className="lg:col-span-2"><Applications apps={data.applications.slice(0, 3)} title="Latest applications" /></div>
    </div>
  );
}

function Details({ data, canEdit, canKyc, onEdit, onDone, onError }) {
  const meta = useCustomerMeta().data;
  const c = data.customer;
  const update = useMutation({ mutationFn: (body) => api.updateCustomer(c.id, body), onSuccess: () => onDone("Saved."), onError });
  const permanent = c.permanentSame === false ? [c.permanentAddress, c.permanentCity, c.permanentState, c.permanentPincode].filter(Boolean).join(", ") : c.address ? "Same as current" : null;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="min-w-0 lg:col-span-2">
        <CardHeader title="KYC & ownership" description="Changes are recorded in the history." />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="KYC status">
            {(a) => (
              <Select {...a} value={c.kycStatus} disabled={!canKyc || update.isPending} onChange={(e) => update.mutate({ kycStatus: e.target.value })}>
                {meta?.kycStatuses.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Relationship manager">
            {(a) => (
              <Select {...a} value={c.relationshipManagerId ?? ""} disabled={!canEdit || update.isPending} onChange={(e) => update.mutate({ relationshipManagerId: e.target.value || null })}>
                <option value="">None</option>
                {meta?.relationshipManagers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
      </Card>
      <Card className="min-w-0">
        <CardHeader title="Personal information" action={canEdit && <Button variant="secondary" size="sm" icon={Pencil} onClick={onEdit}>Edit</Button>} />
        <Pairs rows={[
          ["Full name", c.name], ["Date of birth", c.dob && formatDate(c.dob)], ["Gender", c.gender], ["Marital status", c.marital],
          ["PAN", c.pan], ["Aadhaar", c.aadhaarLast4 && `XXXX XXXX ${c.aadhaarLast4}`],
        ]} />
      </Card>
      <Card className="min-w-0">
        <CardHeader title="Contact information" />
        <Pairs rows={[
          ["Mobile", c.phone && `+91 ${c.phone}`], ["Alternate mobile", c.alternatePhone && `+91 ${c.alternatePhone}`], ["Email", c.email],
          ["Customer ID", c.code], ["Added by", c.createdByName ?? "Website sign-up"], ["Last updated", timeAgo(c.updatedAt)],
        ]} />
      </Card>
      <Card className="min-w-0">
        <CardHeader title="Address" />
        <Pairs rows={[
          ["Current address", c.address], ["City", c.city], ["State", c.state], ["Pincode", c.pincode], ["Permanent address", permanent],
        ]} />
      </Card>
      <Card className="min-w-0">
        <CardHeader title="Employment & credit" />
        <Pairs rows={[
          ["Employment", empLabel(meta, c.emp)], ["Employer / business", c.company], ["Annual income", c.annualIncome && formatMoney(c.annualIncome)],
          ["CIBIL score", c.creditScore], ["Score recorded", c.creditScoreUpdatedAt && formatDate(c.creditScoreUpdatedAt)],
        ]} />
      </Card>
    </div>
  );
}

function Applications({ apps, title = "Loan applications", customer }) {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <Card className="min-w-0">
      <CardHeader title={title} description="Applications made on the website, files logged from converted leads, and files created here."
        action={customer && can("applications.create") && <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>New application</Button>} />
      {creating && <ApplicationForm customer={customer} onClose={() => setCreating(false)} onSaved={(d) => navigate(`/applications/${d.application.id}`, { state: { flash: `${d.application.ref} created.` } })} />}
      {!apps.length ? <EmptyState title="No applications yet">They appear here when the customer applies on the website or a lead is converted.</EmptyState> : (
        <ul className="divide-y divide-line">
          {apps.map((a) => {
            const [label, tone] = APP_STATUS[a.status] ?? [a.status, "gray"];
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{can("applications.view") ? <Link to={`/applications/${a.id}`} className="text-brand-700 hover:underline">{a.ref}</Link> : a.ref} · {a.lenderName}</p>
                  <p className="text-xs text-muted">
                    {a.loanType}{a.tenureMonths ? ` · ${a.tenureMonths} months` : ""} · {formatDate(a.createdAt)} ·{" "}
                    {a.leadRef ? <>from lead {a.leadRef}{a.createdByName ? ` by ${a.createdByName}` : ""}</> : a.createdByName ? `logged by ${a.createdByName}` : "applied on the website"}
                  </p>
                </div>
                <p className="font-bold">{formatMoney(a.loanAmount)}</p>
                <Badge tone={tone}>{label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Documents({ data, canEdit, canKyc, onDone, onError }) {
  const meta = useCustomerMeta().data;
  const c = data.customer;
  const fileRef = useRef(null);
  const [docType, setDocType] = useState("pan");
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [reject, setReject] = useState(null); // { doc, note }
  const [remove, setRemove] = useState(null);
  const upload = useMutation({
    mutationFn: () => api.uploadDocument(c.id, file, { docType, note: note.trim() }),
    onSuccess: ({ document }) => { setFile(null); setNote(""); if (fileRef.current) fileRef.current.value = ""; onDone(`${document.label} uploaded.`); },
    onError: (e) => setError(e.message),
  });
  const review = useMutation({ mutationFn: ({ doc, status, note }) => api.reviewDocument(c.id, doc.id, { status, ...(note ? { note } : {}) }), onSuccess: (_d, x) => { setReject(null); onDone(`${x.doc.label} ${x.status === "verified" ? "verified" : x.status === "rejected" ? "rejected" : "updated"}.`); }, onError });
  const del = useMutation({ mutationFn: (doc) => api.deleteDocument(c.id, doc.id), onSuccess: (_d, doc) => { setRemove(null); onDone(`${doc.label} removed. It stays in the history.`); }, onError });
  const download = useMutation({ mutationFn: (doc) => api.downloadDocument(c.id, doc.id, doc.fileName), onError });

  const submit = (e) => {
    e.preventDefault();
    setError("");
    if (!file) return setError("Choose a file to upload");
    if (file.size > 5 * 1024 * 1024) return setError("Files can be up to 5 MB");
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return setError("Upload a PDF, JPG or PNG file");
    upload.mutate();
  };

  return (
    <div className="space-y-5">
      {canEdit ? (
        <Card className="min-w-0">
          <CardHeader title="Upload a document" description="PDF, JPG or PNG, up to 5 MB. Files are stored securely with the customer’s record." />
          <form onSubmit={submit} className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            <Field label="Document type">
              {(a) => <Select {...a} value={docType} onChange={(e) => setDocType(e.target.value)}>{meta?.documentTypes.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</Select>}
            </Field>
            <Field label="File" error={error}>
              {(a) => <input {...a} ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(""); }} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100" />}
            </Field>
            <Field label="Note (optional)">{(a) => <Input {...a} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Self-attested copy" />}</Field>
            <Button type="submit" icon={Upload} loading={upload.isPending}>Upload</Button>
          </form>
        </Card>
      ) : (
        <Alert tone="info">Your role can see which documents are held but can’t open or change them.</Alert>
      )}
      {canEdit && !canKyc && <Alert tone="info">You can upload documents. Opening, verifying and removing them needs KYC access.</Alert>}

      <Card className="min-w-0">
        <CardHeader title="Documents" />
        {!data.documents.length ? <EmptyState title="No documents yet">Upload KYC and income documents here.</EmptyState> : (
          <ul className="divide-y divide-line">
            {data.documents.map((d) => {
              const [label, tone] = DOC_STATUS[d.status];
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{d.label} <span className="font-normal text-muted">· {d.fileName}</span></p>
                    <p className="text-xs text-muted">
                      {fmtSize(d.sizeBytes)} · uploaded {timeAgo(d.createdAt)}{d.uploadedByName ? ` by ${d.uploadedByName}` : ""}
                      {d.reviewedByName ? ` · reviewed by ${d.reviewedByName}` : ""}{d.note ? ` · ${d.note}` : ""}
                    </p>
                  </div>
                  <Badge tone={tone}>{label}</Badge>
                  {canKyc && (
                    <span className="flex flex-wrap gap-1">
                      <Button variant="ghost" size="sm" icon={Download} loading={download.isPending && download.variables?.id === d.id} onClick={() => download.mutate(d)}>Download</Button>
                      {d.status !== "verified" && <Button variant="ghost" size="sm" icon={CheckCircle2} onClick={() => review.mutate({ doc: d, status: "verified" })}>Verify</Button>}
                      {d.status !== "rejected" && <Button variant="ghost" size="sm" icon={XCircle} className="text-red-700 hover:bg-red-50" onClick={() => setReject({ doc: d, note: "" })}>Reject</Button>}
                      <Button variant="ghost" size="sm" icon={Trash2} className="text-muted" onClick={() => setRemove(d)} aria-label={`Remove ${d.label}`} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal open={Boolean(reject)} onClose={() => setReject(null)} title={`Reject ${reject?.doc.label ?? ""}?`}
        footer={<><Button variant="secondary" onClick={() => setReject(null)}>Cancel</Button><Button variant="danger" disabled={(reject?.note ?? "").trim().length < 2} loading={review.isPending} onClick={() => review.mutate({ doc: reject.doc, status: "rejected", note: reject.note.trim() })}>Reject</Button></>}>
        <Field label="Reason" hint="e.g. Blurry copy, expired, name mismatch">{(a) => <Input {...a} value={reject?.note ?? ""} onChange={(e) => setReject({ ...reject, note: e.target.value })} autoFocus />}</Field>
      </Modal>
      <Modal open={Boolean(remove)} onClose={() => setRemove(null)} title={`Remove ${remove?.label ?? ""}?`}
        footer={<><Button variant="secondary" onClick={() => setRemove(null)}>Cancel</Button><Button variant="danger" loading={del.isPending} onClick={() => del.mutate(remove)}>Remove</Button></>}>
        <p className="text-sm text-muted">It leaves the customer’s documents; the upload and removal stay in the history and audit log.</p>
      </Modal>
    </div>
  );
}

function LeadsTab({ data, canSchedule, onDone }) {
  const [scheduling, setScheduling] = useState(false);
  return (
    <div className="space-y-5">
      <Card className="min-w-0">
        <CardHeader title="Leads" description="Enquiries and leads linked to this customer, and how they were converted." />
        {!data.leads.length ? <EmptyState title="No linked leads">This customer signed up directly or was added in the CRM.</EmptyState> : (
          <ul className="divide-y divide-line">
            {data.leads.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link to={`/leads?lead=${l.id}`} className="font-semibold hover:text-brand-700 hover:underline">{l.ref}</Link>
                  <span className="text-muted"> · {l.sourceLabel}{l.loanTypeLabel ? ` · ${l.loanTypeLabel}` : ""}{l.loanAmount ? ` · ${formatMoney(l.loanAmount)}` : ""}</span>
                  <p className="text-xs text-muted">
                    Received {formatDate(l.createdAt)}{l.ownerName ? ` · owner ${l.ownerName}` : ""}
                    {l.convertedAt && ` · converted ${formatDate(l.convertedAt)}${l.convertedByName ? ` by ${l.convertedByName}` : ""}${l.applicationRef ? ` → ${l.applicationRef}` : ""}`}
                  </p>
                </div>
                <StatusBadge status={l.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="min-w-0">
        <CardHeader title="Follow-ups" description="Scheduled with this customer and on their leads."
          action={canSchedule && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setScheduling(true)}>Schedule</Button>} />
        <FollowupForm open={scheduling} onClose={() => setScheduling(false)} onSaved={(text) => { setScheduling(false); onDone(text); }}
          target={{ kind: "customer", id: data.customer.id, label: data.customer.name }} />
        {!data.followups.length ? <EmptyState title="No follow-ups" /> : (
          <ul className="divide-y divide-line">
            {data.followups.map((f) => {
              const [label, tone] = FU_STATE[f.state];
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{fuType(f.type)}{f.note ? ` · ${f.note}` : ""}</p>
                    <p className="text-xs text-muted">{formatDate(f.dueAt)}, {formatTime(f.dueAt)}{f.leadRef ? ` · ${f.leadRef}` : ""}{f.assignedName ? ` · ${f.assignedName}` : ""}{f.outcome ? ` · ${f.outcome}` : ""}</p>
                  </div>
                  <Badge tone={tone}>{label}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function History({ data, canNote, onDone, onError }) {
  const [note, setNote] = useState("");
  const save = useMutation({ mutationFn: () => api.addCustomerNote(data.customer.id, note.trim()), onSuccess: () => { setNote(""); onDone("Note saved."); }, onError });
  const dot = { customer: "bg-brand-500", lead: "bg-orange-500", application: "bg-emerald-500" };
  return (
    <Card className="min-w-0">
      <CardHeader title="Complete history" description="Customer changes, documents, linked leads and their follow-ups, and applications — newest first." />
      <div className="px-5 py-4">
        {canNote && (
          <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) save.mutate(); }} className="mb-5 flex gap-2">
            <Input aria-label="Add a note to the customer" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button type="submit" loading={save.isPending} disabled={!note.trim()}>Save</Button>
          </form>
        )}
        <ol className="space-y-4 border-l border-line pl-5">
          {data.history.map((h) => (
            <li key={h.id} className="relative text-sm">
              <span className={`absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-white ${dot[h.entityType] ?? "bg-slate-300"}`} aria-hidden />
              <p className={h.type === "note" ? "whitespace-pre-line" : ""}>{describe(h)}</p>
              <p className="text-xs text-muted">{formatDate(h.at)}, {formatTime(h.at)}{h.actorName ? ` · ${h.actorName}` : ""}</p>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
