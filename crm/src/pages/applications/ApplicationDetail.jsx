import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCircle2, Download, FileText, Pencil, Undo2, Upload, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Modal, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { FLOW, STAGES, StageBadge, useApplicationMeta, useApplicationRefresh } from "../../lib/applications";
import { useAuth } from "../../lib/auth";
import { KycBadge, Score } from "../../lib/customers";
import { formatDate, formatMoney, formatTime } from "../../lib/format";
import ApplicationForm from "./ApplicationForm";
import StageDialog from "./StageDialog";

const DOC_STATUS = { missing: ["Missing", "gray"], uploaded: ["Awaiting review", "amber"], verified: ["Verified", "green"], rejected: ["Rejected", "red"] };
const FIELD = { lenderId: "lender", loanType: "product", loanAmount: "amount", tenureMonths: "tenure", rate: "rate", processingFee: "processing fee", lenderRef: "lender reference" };

function describe(h) {
  const m = h.meta ?? {};
  const st = (s) => STAGES[s]?.[0] ?? s;
  switch (h.type) {
    case "created": return m.leadRef ? `Logged from lead ${m.leadRef}` : m.website ? "Submitted by the customer on the website" : "Application created";
    case "stage_changed":
      if (m.to === "sanctioned") return `Sanctioned ${formatMoney(m.sanctionedAmount)} at ${m.rate}% for ${m.tenureMonths} months (EMI ${formatMoney(m.emi)})`;
      if (m.to === "disbursed") return `Disbursed ${formatMoney(m.disbursedAmount)}`;
      if (m.to === "rejected") return `Rejected — ${m.reason}`;
      return FLOW.indexOf(m.to) < FLOW.indexOf(m.from) ? `Sent back from ${st(m.from)} to ${st(m.to)}` : `Moved from ${st(m.from)} to ${st(m.to)}`;
    case "assigned": return m.to ? `Assigned to ${m.toName ?? "an employee"}` : "Unassigned";
    case "updated": return `Updated ${Object.keys(m.changes ?? {}).map((k) => FIELD[k] ?? k).join(", ")}`;
    case "note": return h.body;
    default: return h.type.replace(/_/g, " ");
  }
}

export default function ApplicationDetail() {
  const { id } = useParams();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["application", id], queryFn: () => api.application(id) });
  const refresh = useApplicationRefresh();
  const [flash, setFlash] = useState(location.state?.flash ? { tone: "success", text: location.state.flash } : null);
  const [dialog, setDialog] = useState(null); // { target?, back? }
  const [editing, setEditing] = useState(false);
  const tab = params.get("tab") === "timeline" ? "timeline" : "documents";

  if (q.isPending) return <Spinner label="Loading application" />;
  if (q.isError) return <div className="space-y-4"><Link to="/applications" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Applications</Link><Alert>{q.error.message}</Alert></div>;

  const { application: a, customer: c, lender, moves, history } = q.data;
  const next = moves.find((m) => ["forward", "sanction", "disburse"].includes(m.kind));
  const reject = moves.find((m) => m.kind === "reject");
  const back = moves.filter((m) => m.kind === "back");
  const done = (text) => { setFlash({ tone: "success", text }); refresh(id, c.id); };
  // When did the file reach each stage? (latest move into it)
  const reached = {};
  for (const h of [...history].reverse()) if (h.type === "stage_changed") reached[h.meta.to] = h.createdAt;
  reached.new ??= a.createdAt;
  const current = FLOW.indexOf(a.stage);
  const lastStage = a.stage === "rejected" ? history.find((h) => h.meta?.to === "rejected")?.meta.from : null;

  return (
    <>
      <Link to="/applications" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Applications</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-extrabold tracking-tight sm:text-[28px]">{a.ref} <StageBadge stage={a.stage} /></h1>
          <p className="mt-1 text-sm text-muted">
            {a.loanType} for <Link to={`/customers/${c.id}`} className="font-semibold text-brand-700 hover:underline">{c.name}</Link> · {a.source === "website" ? "applied on the website" : "logged"} {formatDate(a.createdAt)}
            {a.leadRef && <> · from lead <Link to={`/leads?q=${a.leadRef}`} className="font-semibold text-brand-700 hover:underline">{a.leadRef}</Link></>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("applications.edit") && <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
          {back.length > 0 && <Button variant="secondary" icon={Undo2} onClick={() => setDialog({ back: true })}>Send back</Button>}
          {reject && <Button variant="danger" icon={XCircle} onClick={() => setDialog({ target: "rejected" })}>Reject</Button>}
          {next && <Button icon={Check} onClick={() => setDialog({ target: next.stage })}>Move to {next.label}</Button>}
        </div>
      </div>

      {flash && <div className="mb-4"><Alert tone={flash.tone}>{flash.text}</Alert></div>}
      {a.stage === "rejected" && <div className="mb-4"><Alert>Rejected {formatDate(a.rejectedAt)} at {STAGES[lastStage]?.[0] ?? "an open stage"}: {a.rejectionReason}</Alert></div>}

      <Card className="mb-5 overflow-x-auto px-5 py-4">
        <ol className="flex min-w-[640px] items-start" aria-label="Application stages">
          {FLOW.map((s, i) => {
            const idx = a.stage === "rejected" ? FLOW.indexOf(lastStage) : current;
            const state = i < idx || (i === idx && a.stage === "disbursed") ? "done" : i === idx && a.stage !== "rejected" ? "current" : "todo";
            return (
              <li key={s} className="flex flex-1 items-start last:flex-none" aria-current={state === "current" ? "step" : undefined}>
                <div className="flex w-24 flex-col items-center text-center">
                  <span className={`grid size-8 place-items-center rounded-full text-xs font-bold ${state === "done" ? "bg-emerald-600 text-white" : state === "current" ? "border-2 border-brand-600 bg-white text-brand-700" : "border border-line bg-white text-muted"}`}>
                    {state === "done" ? <Check className="size-4" aria-label="Done" /> : i + 1}
                  </span>
                  <span className={`mt-1.5 text-xs font-semibold ${state === "todo" ? "text-muted" : ""}`}>{STAGES[s][0]}</span>
                  {reached[s] && state !== "todo" && <span className="text-[11px] text-muted">{formatDate(reached[s])}</span>}
                </div>
                {i < FLOW.length - 1 && <span className={`mt-4 h-0.5 flex-1 ${i < idx ? "bg-emerald-500" : "bg-line"}`} aria-hidden />}
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Requested", formatMoney(a.loanAmount)], ["Sanctioned", a.sanctionedAmount ? formatMoney(a.sanctionedAmount) : "—"],
              ["Rate", a.rate != null ? `${a.rate}% p.a.` : "—"], ["Tenure", a.tenureMonths ? `${a.tenureMonths} months` : "—"],
              ["EMI", a.emi ? formatMoney(a.emi) : "—"], ["Disbursed", a.disbursedAmount ? formatMoney(a.disbursedAmount) : "—"],
              ["Processing fee", a.processingFee != null ? formatMoney(a.processingFee) : "—"], ["Lender ref", a.lenderRef ?? "—"],
            ].map(([k, v]) => (
              <Card key={k} className="min-w-0 px-4 py-3"><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 truncate text-lg font-extrabold">{v}</dd></Card>
            ))}
          </dl>

          <Card className="min-w-0">
            <nav aria-label="Application sections" className="border-b border-line px-3">
              <ul className="flex">
                {[["documents", `Documents`, q.data.checklist.filter((x) => x.status === "verified").length + "/" + q.data.checklist.length], ["timeline", "Timeline", history.length]].map(([t, label, n]) => (
                  <li key={t}>
                    <button type="button" onClick={() => setParams(t === "documents" ? {} : { tab: t }, { replace: true })} aria-current={tab === t ? "page" : undefined}
                      className={`flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-semibold ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink"}`}>
                      {label} <span className={`rounded-full px-1.5 text-[11px] ${tab === t ? "bg-brand-700 text-white" : "bg-canvas text-muted"}`}>{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            {tab === "documents" ? <Documents data={q.data} canEdit={can("customers.edit")} canKyc={can("customers.kyc")} onDone={done} onError={(e) => setFlash({ tone: "error", text: e.message })} />
              : <Timeline data={q.data} canNote={can("applications.edit")} onDone={done} onError={(e) => setFlash({ tone: "error", text: e.message })} />}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Customer" />
            <div className="space-y-3 px-5 py-4 text-sm">
              <Link to={`/customers/${c.id}`} className="block font-semibold text-brand-700 hover:underline">{c.name}</Link>
              <p className="-mt-2 text-xs text-muted">{c.code} · +91 {c.phone}{c.city ? ` · ${c.city}` : ""}</p>
              <dl className="space-y-2">
                <div className="flex justify-between gap-3"><dt className="text-muted">CIBIL</dt><dd><Score value={c.creditScore} /></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Annual income</dt><dd className="font-semibold">{c.annualIncome ? formatMoney(c.annualIncome) : "—"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">KYC</dt><dd><KycBadge status={c.kycStatus} /></dd></div>
              </dl>
            </div>
          </Card>
          <Card>
            <CardHeader title="Lender" />
            <div className="space-y-2 px-5 py-4 text-sm">
              <p className="font-semibold">{lender.name}{lender.kind ? <span className="font-normal text-muted"> · {lender.kind}</span> : null}</p>
              {lender.active === false && <Badge tone="red">Inactive lender</Badge>}
              <dl className="space-y-2">
                <div className="flex justify-between gap-3"><dt className="text-muted">Product rate</dt><dd className="font-semibold">{lender.product ? `${lender.product.rate}% p.a.` : "—"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Product limit</dt><dd className="font-semibold">{lender.product ? `${formatMoney(lender.product.maxAmount)} · ${lender.product.maxTenure * 12} mo` : "—"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Usual processing fee</dt><dd className="font-semibold">{lender.fee ?? "—"}</dd></div>
              </dl>
            </div>
          </Card>
          <Assignment application={a} onDone={done} onError={(e) => setFlash({ tone: "error", text: e.message })} />
        </div>
      </div>

      {dialog && (
        <StageDialog application={a} moves={dialog.back ? back : moves} target={dialog.back ? undefined : dialog.target} onClose={() => setDialog(null)}
          onDone={(_d, stage) => { setDialog(null); done(stage === "rejected" ? `${a.ref} rejected.` : `${a.ref} moved to ${STAGES[stage][0]}.`); }} />
      )}
      {editing && <ApplicationForm application={a} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); done("Application updated."); }} />}
    </>
  );
}

function Assignment({ application: a, onDone, onError }) {
  const { can } = useAuth();
  const meta = useApplicationMeta().data;
  const canAssign = can("applications.edit") && (can("applications.approve") || can("leads.assign"));
  const save = useMutation({ mutationFn: (assignedTo) => api.updateApplication(a.id, { assignedTo }), onSuccess: () => onDone("Saved."), onError });
  return (
    <Card>
      <CardHeader title="Handled by" />
      <div className="px-5 py-4">
        {canAssign ? (
          <Field label="Employee">
            {(f) => (
              <Select {...f} value={a.assignedTo ?? ""} disabled={save.isPending} onChange={(e) => save.mutate(e.target.value || null)}>
                <option value="">Unassigned</option>
                {meta?.staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.roleName}</option>)}
              </Select>
            )}
          </Field>
        ) : <p className="text-sm font-semibold">{a.assigneeName ?? "Unassigned"}</p>}
        {a.createdByName && <p className="mt-2 text-xs text-muted">Created by {a.createdByName}</p>}
      </div>
    </Card>
  );
}

function Documents({ data, canEdit, canKyc, onDone, onError }) {
  const { application: a, customer: c } = data;
  const fileRefs = useRef({});
  const [reject, setReject] = useState(null);
  const upload = useMutation({
    mutationFn: ({ docType, file }) => api.uploadDocument(c.id, file, { docType, applicationId: a.id }),
    onSuccess: ({ document }) => onDone(`${document.label} uploaded.`),
    onError,
  });
  const review = useMutation({ mutationFn: ({ doc, status, note }) => api.reviewDocument(c.id, doc.id, { status, ...(note ? { note } : {}) }), onSuccess: (_d, x) => { setReject(null); onDone(`${x.label} ${x.status}.`); }, onError });
  const download = useMutation({ mutationFn: (doc) => api.downloadDocument(c.id, doc.id, doc.fileName), onError });
  const pick = (docType) => (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return onError(new Error("Files can be up to 5 MB"));
    upload.mutate({ docType, file });
  };
  const all = [...data.checklist, ...data.otherDocuments.map((d) => ({ docType: d.docType, label: d.label, document: d, status: d.status, extra: true }))];
  return (
    <>
      <p className="px-5 pt-4 text-xs text-muted">Documents needed before credit review for this customer’s employment type and product. Files are kept on the customer’s record.</p>
      <ul className="divide-y divide-line">
        {all.map((x, i) => {
          const [label, tone] = DOC_STATUS[x.status];
          const doc = x.document;
          return (
            <li key={doc?.id ?? `${x.docType}-${i}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <FileText className="size-4 shrink-0 text-brand-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{x.label}{x.extra && <span className="font-normal text-muted"> (other)</span>}</p>
                {doc && <p className="truncate text-xs text-muted">{doc.fileName}{doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}{doc.note ? ` · ${doc.note}` : ""}</p>}
              </div>
              <Badge tone={tone}>{label}</Badge>
              {canEdit && (
                <span className="flex flex-wrap gap-1">
                  {doc && canKyc && <Button variant="ghost" size="sm" icon={Download} onClick={() => download.mutate(doc)} aria-label={`Download ${x.label}`} />}
                  {doc && canKyc && doc.status !== "verified" && <Button variant="ghost" size="sm" icon={CheckCircle2} onClick={() => review.mutate({ doc, status: "verified", label: x.label })}>Verify</Button>}
                  {doc && canKyc && doc.status === "uploaded" && <Button variant="ghost" size="sm" icon={XCircle} className="text-red-700 hover:bg-red-50" onClick={() => setReject({ doc, label: x.label, note: "" })}>Reject</Button>}
                  {!x.extra && (x.status === "missing" || x.status === "rejected") && (
                    <>
                      <input ref={(el) => (fileRefs.current[x.docType] = el)} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" aria-label={`Upload ${x.label}`} onChange={pick(x.docType)} />
                      <Button variant="secondary" size="sm" icon={Upload} loading={upload.isPending && upload.variables?.docType === x.docType} onClick={() => fileRefs.current[x.docType]?.click()}>Upload</Button>
                    </>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!canEdit && <p className="px-5 pb-4 text-xs text-muted">Your role can see document status but can’t open or change documents.</p>}
      {canEdit && !canKyc && <p className="px-5 pb-4 text-xs text-muted">You can upload documents. Opening, verifying and rejecting them needs KYC access.</p>}
      <Modal open={Boolean(reject)} onClose={() => setReject(null)} title={`Reject ${reject?.label ?? ""}?`}
        footer={<><Button variant="secondary" onClick={() => setReject(null)}>Cancel</Button><Button variant="danger" disabled={(reject?.note ?? "").trim().length < 2} loading={review.isPending} onClick={() => review.mutate({ doc: reject.doc, status: "rejected", note: reject.note.trim(), label: reject.label })}>Reject</Button></>}>
        <Field label="Reason" hint="e.g. Blurry copy, expired, name mismatch">{(f) => <Input {...f} value={reject?.note ?? ""} onChange={(e) => setReject({ ...reject, note: e.target.value })} autoFocus />}</Field>
      </Modal>
    </>
  );
}

function Timeline({ data, canNote, onDone, onError }) {
  const [note, setNote] = useState("");
  const save = useMutation({ mutationFn: () => api.addApplicationNote(data.application.id, note.trim()), onSuccess: () => { setNote(""); onDone("Note saved."); }, onError });
  return (
    <div className="px-5 py-4">
      {canNote && (
        <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) save.mutate(); }} className="mb-5 flex gap-2">
          <Input aria-label="Add a note to the application" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" loading={save.isPending} disabled={!note.trim()}>Save</Button>
        </form>
      )}
      <ol className="space-y-4 border-l border-line pl-5">
        {data.history.map((h) => (
          <li key={h.id} className="relative text-sm">
            <span className={`absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-white ${h.type === "stage_changed" ? (h.meta.to === "rejected" ? "bg-red-500" : "bg-emerald-500") : h.type === "note" ? "bg-brand-500" : "bg-slate-300"}`} aria-hidden />
            <p className={h.type === "note" ? "whitespace-pre-line" : ""}>{describe(h)}</p>
            {h.type === "stage_changed" && h.body && <p className="text-muted">“{h.body}”</p>}
            <p className="text-xs text-muted">{formatDate(h.createdAt)}, {formatTime(h.createdAt)}{h.actorName ? ` · ${h.actorName}` : ""}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
