import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, Pencil, Phone, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Field, Modal, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { StageBadge } from "../../lib/applications";
import { useAuth } from "../../lib/auth";
import { formatCount, formatDate, formatMoney } from "../../lib/format";
import { LenderLogo, pct, useLenderRefresh, years } from "../../lib/lenders";
import LenderForm from "./LenderForm";
import ProductForm from "./ProductForm";

function Tile({ label, value }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-3 text-center">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-[15px] font-extrabold">{value}</p>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

export default function LenderDrawer({ lenderId, loanTypes, onClose, onDeleted }) {
  const ref = useRef(null);
  const { can } = useAuth();
  const refresh = useLenderRefresh();
  const q = useQuery({ queryKey: ["lender", lenderId], queryFn: () => api.lender(lenderId), enabled: Boolean(lenderId) });
  const [flash, setFlash] = useState(null);
  const [editing, setEditing] = useState(false);
  const [product, setProduct] = useState(null); // { product } while the product form is open (product null = add)
  const [removing, setRemoving] = useState(null); // product type awaiting confirmation
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (lenderId && !d.open) d.showModal();
    if (!lenderId && d.open) d.close();
  }, [lenderId]);
  useEffect(() => { setFlash(null); }, [lenderId]);

  const done = (text) => { setFlash({ tone: "success", text }); refresh(lenderId); };
  const failed = (err) => setFlash({ tone: "error", text: err.message });
  const update = useMutation({ mutationFn: (body) => api.updateLender(lenderId, body), onSuccess: () => done("Saved."), onError: failed });
  const remove = useMutation({ mutationFn: () => api.deleteLender(lenderId), onSuccess: () => { setConfirmDelete(false); refresh(); onDeleted?.(); }, onError: (e) => { setConfirmDelete(false); failed(e); } });

  const l = q.data?.lender;
  const canEdit = can("lenders.edit");
  const typeLabel = (id) => loanTypes?.find((t) => t.id === id)?.label ?? id;
  const rm = l?.contacts?.[0];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={l ? `Lender ${l.name}` : "Lender"}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-2xl border-l border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-night/40"
    >
      {lenderId && (
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            {l ? (
              <div className="min-w-0">
                <h2 className="truncate text-lg font-extrabold">{l.name}</h2>
                <p className="mt-0.5 truncate text-xs text-muted">{[l.fullName, l.kind].filter(Boolean).join(" · ")}</p>
              </div>
            ) : <span className="text-sm text-muted">Lender</span>}
            <div className="flex items-center gap-1">
              {l && canEdit && <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
              {l && can("lenders.delete") && <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)} aria-label="Delete lender" />}
              <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
          </header>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            {q.isPending ? <Spinner label="Loading lender" /> : q.isError ? <Alert>{q.error.message}</Alert> : (
              <>
                {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}

                <div className="flex items-center gap-4 rounded-2xl border border-line p-4">
                  <LenderLogo lender={l} size="lg" />
                  <p className="text-sm text-muted">{l.about || "No description yet."}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Tile label="Files" value={formatCount(l.stats.files)} />
                  <Tile label="Approval" value={l.stats.approvalRate == null ? "—" : `${Math.round(l.stats.approvalRate * 100)}%`} />
                  <Tile label="Disbursed" value={formatMoney(l.stats.disbursed)} />
                  <Tile label="Payout earned" value={formatMoney(l.stats.payoutEarned)} />
                </div>

                <section aria-labelledby="partnership">
                  <h3 id="partnership" className="mb-3 text-sm font-bold">Partnership</h3>
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-3">
                    <Field label="Status">
                      {(a) => (
                        <Select {...a} compact value={l.active ? "active" : "inactive"} disabled={!canEdit || update.isPending} onChange={(e) => update.mutate({ active: e.target.value === "active" })}>
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </Select>
                      )}
                    </Field>
                    <div><p className="mb-1.5 text-[13px] font-semibold">Payout</p><p className="text-sm">{l.payoutPct == null ? "—" : `${pct(l.payoutPct)} of disbursal`}</p></div>
                    <div><p className="mb-1.5 text-[13px] font-semibold">Turnaround</p><p className="text-sm">{l.tatDays == null ? "—" : `${l.tatDays} days`}</p></div>
                    <div><p className="text-xs text-muted">Processing fee</p><p className="text-sm font-semibold">{l.fee || "—"}</p></div>
                    <div>
                      <p className="text-xs text-muted">Agreement valid till</p>
                      <p className="flex items-center gap-2 text-sm font-semibold">{l.agreementUntil ? formatDate(`${l.agreementUntil}T00:00:00`) : "—"}{l.agreementUntil && l.agreementUntil < today() && <Badge tone="red">Expired</Badge>}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted">Relationship manager</p>
                      <p className="truncate text-sm font-semibold">{rm?.name ?? "—"}</p>
                      {rm?.phone && <a href={`tel:+91${rm.phone}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"><Phone className="size-3" aria-hidden />+91 {rm.phone}</a>}
                    </div>
                  </div>
                  {!l.active && <p className="mt-3 text-[13px] text-muted">Inactive: hidden from the website and from new applications. Existing files carry on as normal.</p>}
                </section>

                <section aria-labelledby="ratecard">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 id="ratecard" className="text-sm font-bold">Rate card &amp; products</h3>
                    {canEdit && l.products.length < (loanTypes?.length ?? 7) && <Button variant="secondary" size="sm" icon={Plus} onClick={() => setProduct({ product: null })}>Add product</Button>}
                  </div>
                  {!l.products.length ? (
                    <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">No products yet. Without products this lender can’t be chosen for applications or appear in website offers.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-line">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-canvas text-[11px] font-bold uppercase tracking-wider text-muted">
                          <tr>
                            <th scope="col" className="px-3 py-2.5">Product</th>
                            <th scope="col" className="px-3 py-2.5 text-right">Rate from</th>
                            <th scope="col" className="px-3 py-2.5 text-right">Max amount</th>
                            <th scope="col" className="px-3 py-2.5 text-right">Tenure</th>
                            <th scope="col" className="px-3 py-2.5">Fee · eligibility</th>
                            {canEdit && <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {l.products.map((p) => (
                            <tr key={p.type}>
                              <td className="px-3 py-2.5 font-semibold">{typeLabel(p.type)}</td>
                              <td className="px-3 py-2.5 text-right font-bold">{pct(p.rate)}</td>
                              <td className="px-3 py-2.5 text-right">{formatMoney(p.maxAmount)}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right">{years(p.minTenure, p.maxTenure)}</td>
                              <td className="px-3 py-2.5 text-xs text-muted">
                                {[p.processingFee && `Fee ${p.processingFee}`, p.minCibil && `CIBIL ${p.minCibil}+`, p.minIncome && `Income ${formatMoney(p.minIncome)}+/yr`].filter(Boolean).join(" · ") || "Lender defaults"}
                              </td>
                              {canEdit && (
                                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                                  <button type="button" className="rounded-md p-1.5 text-muted hover:bg-brand-50 hover:text-brand-700" aria-label={`Edit ${typeLabel(p.type)}`} onClick={() => setProduct({ product: p })}><Pencil className="size-4" /></button>
                                  <button type="button" className="rounded-md p-1.5 text-muted hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${typeLabel(p.type)}`} onClick={() => setRemoving(p.type)}><Trash2 className="size-4" /></button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section aria-labelledby="contacts">
                  <h3 id="contacts" className="mb-3 text-sm font-bold">Contacts</h3>
                  {!l.contacts.length ? <p className="text-sm text-muted">No contacts yet{canEdit ? " — add them with Edit." : "."}</p> : (
                    <ul className="divide-y divide-line rounded-xl border border-line">
                      {l.contacts.map((c, i) => (
                        <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                          <div className="min-w-0"><p className="font-semibold">{c.name}</p><p className="text-xs text-muted">{c.role || (i === 0 ? "Relationship manager" : "Contact")}</p></div>
                          <div className="flex flex-wrap gap-3 text-xs font-semibold text-brand-700">
                            {c.phone && <a href={`tel:+91${c.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="size-3.5" aria-hidden />+91 {c.phone}</a>}
                            {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:underline"><Mail className="size-3.5" aria-hidden />{c.email}</a>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {can("applications.view") && (
                  <section aria-labelledby="files">
                    <h3 id="files" className="mb-3 text-sm font-bold">Recent applications</h3>
                    {!q.data.applications.length ? <p className="text-sm text-muted">No applications with this lender yet.</p> : (
                      <ul className="divide-y divide-line rounded-xl border border-line">
                        {q.data.applications.map((a) => (
                          <li key={a.id}>
                            <Link to={`/applications/${a.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-canvas">
                              <span className="min-w-0"><span className="block font-semibold">{a.ref} · {a.contactName ?? "Customer"}</span><span className="block text-xs text-muted">{a.loanType} · {formatMoney(a.loanAmount)}</span></span>
                              <StageBadge stage={a.stage} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {editing && l && <LenderForm lender={l} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); done("Lender updated."); }} />}
      {product && l && (
        <ProductForm lender={l} product={product.product} loanTypes={loanTypes ?? []} onClose={() => setProduct(null)}
          onSaved={() => { setProduct(null); done(product.product ? "Product updated — the website and new applications use it now." : "Product added."); }} />
      )}
      <Modal open={Boolean(removing)} onClose={() => setRemoving(null)} title={`Remove ${typeLabel(removing)}?`}
        footer={<><Button variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" loading={update.isPending} onClick={() => update.mutate({ products: l.products.filter((p) => p.type !== removing) }, { onSettled: () => setRemoving(null) })}>Remove product</Button></>}>
        <p className="text-sm">{l?.name} will stop showing this product on the website and it can’t be chosen for new applications. Products with open applications can’t be removed.</p>
      </Modal>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${l?.name ?? "lender"}?`}
        footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Delete lender</Button></>}>
        <p className="text-sm">This permanently removes the lender. Only lenders that never had an application can be deleted — otherwise set it to Inactive.</p>
      </Modal>
    </dialog>
  );
}
