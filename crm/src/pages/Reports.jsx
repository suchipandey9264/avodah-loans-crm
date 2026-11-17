import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { BadgePercent, Banknote, Download, Timer, TrendingUp } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { BarList, ColumnChart, DataTable, ORDINAL } from "../components/charts";
import { ChartCard, DateRangeControl } from "../components/ReportBlocks";
import { Alert, Button, Card, EmptyState, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { describeRange, rangeFromParams } from "../lib/dateRange";
import { bucketLabel, formatCount, formatMoney, formatMoneyTick } from "../lib/format";

const TABS = [["sales", "Sales & conversion"], ["team", "Team performance"], ["lenders", "Lenders"], ["products", "Products"], ["cities", "Cities"]];
const pct = (x) => (x == null ? "—" : `${Math.round(x * 1000) / 10}%`);
const FUNNEL = { enquiries: "Enquiries", contacted: "Contacted", interested: "Interested", qualified: "Qualified", converted: "Converted" };

function Stat({ label, value, note, icon: Icon, tint }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold text-muted">{label}</p>
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${tint}`} aria-hidden><Icon className="size-[18px]" /></span>
      </div>
      <p className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </Card>
  );
}

/** A plain data table card (the main view of the team / lender tabs). */
function TableCard({ title, description, columns, rows, empty }) {
  return (
    <Card className="min-w-0">
      <div className="px-5 pt-4"><h2 className="text-[15px] font-bold">{title}</h2>{description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}</div>
      <div className="p-5 pt-3">
        {!rows.length ? <p className="py-8 text-center text-sm text-muted">{empty}</p> : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead className="bg-canvas text-left text-[11px] font-bold uppercase tracking-wider text-muted">
                <tr>{columns.map((c) => <th key={c.key} scope="col" className={`whitespace-nowrap px-3 py-2 ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => (
                  <tr key={r.id ?? r.type ?? r.city ?? i}>
                    {columns.map((c) => <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.align === "right" ? "text-right tabular-nums" : ""}`}>{c.render ? c.render(r, i) : r[c.key]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function Progress({ value }) {
  if (value == null) return <span className="text-muted">No target</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-canvas" aria-hidden><span className={`block h-full rounded-full ${value >= 1 ? "bg-emerald-500" : "bg-brand-600"}`} style={{ width: `${Math.min(100, value * 100)}%` }} /></span>
      <span className="text-xs font-semibold">{Math.round(value * 100)}%</span>
    </span>
  );
}

export default function Reports() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const range = rangeFromParams(params);
  const tab = TABS.some(([id]) => id === params.get("tab")) ? params.get("tab") : "sales";
  const query = { from: range.from.toISOString(), to: range.to.toISOString() };
  const q = useQuery({ queryKey: ["reports", query], queryFn: () => api.reports(query), placeholderData: keepPreviousData });
  const exp = useMutation({ mutationFn: () => api.exportReport(tab, query) });
  // Keep the tab when the period changes, and the period when the tab changes.
  const setPeriod = (p) => setParams({ ...p, ...(tab !== "sales" ? { tab } : {}) });
  const setTab = (id) => { const n = new URLSearchParams(window.location.search); id === "sales" ? n.delete("tab") : n.set("tab", id); setParams(n); };

  const d = q.data;
  const unit = d?.range.unit ?? "day";
  const xLabel = (row) => bucketLabel(row.bucket, unit);
  const xLabelLong = (row) => bucketLabel(row.bucket, unit, true);
  const per = unit;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">Reports &amp; Analytics</h1>
          <p className="mt-1 text-sm text-muted">Conversion, team performance, lender approvals and disbursals · {describeRange(range)}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <DateRangeControl key={params.toString()} range={range} setParams={setPeriod} />
          {can("reports.export") && <Button variant="secondary" icon={Download} loading={exp.isPending} onClick={() => exp.mutate()}>Export CSV</Button>}
        </div>
      </div>
      {exp.isError && <div className="mb-4"><Alert>{exp.error.message}</Alert></div>}
      {q.isError && <div className="mb-4"><Alert>{q.error.message}</Alert></div>}

      <section aria-label="Summary" className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label="Total disbursed" value={d ? formatMoney(d.summary.disbursed) : "…"} note={d && `${formatCount(d.summary.disbursedFiles)} files`} icon={Banknote} tint="bg-emerald-50 text-emerald-700" />
        <Stat label="Lead conversion" value={d ? pct(d.summary.leadConversion) : "…"} note={d && `${formatCount(d.summary.converted)} of ${formatCount(d.summary.leads)} leads`} icon={BadgePercent} tint="bg-brand-50 text-brand-700" />
        <Stat label="Lender approval rate" value={d ? pct(d.summary.approvalRate) : "…"} note={d && `${formatCount(d.summary.files)} files logged`} icon={TrendingUp} tint="bg-sky-50 text-sky-700" />
        <Stat label="Avg. login → disbursal" value={d ? (d.summary.avgDaysToDisburse == null ? "—" : `${Math.round(d.summary.avgDaysToDisburse)} days`) : "…"} note="Disbursed files" icon={Timer} tint="bg-orange-50 text-orange-700" />
      </section>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-line" role="tablist" aria-label="Report">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 pb-2.5 text-sm font-semibold ${tab === id ? "border-brand-700 text-brand-700" : "border-transparent text-muted hover:text-ink"}`}>{label}</button>
        ))}
      </div>

      {!d ? <Spinner label="Loading reports" /> : (
        <div className={`space-y-5 ${q.isFetching ? "opacity-60 transition-opacity" : ""}`}>
          {tab === "sales" && (
            <>
              <div className="grid gap-5 lg:grid-cols-2">
                <ChartCard title="Disbursal trend" description={`Per ${per}, by disbursal date`} empty={!d.summary.disbursed} emptyText="Nothing disbursed in this period."
                  table={<DataTable caption="Disbursal trend" columns={[{ key: "bucket", label: "Period", render: xLabelLong }, { key: "disbursed", label: "Disbursed", align: "right", render: (r) => formatMoney(r.disbursed) }]} rows={d.sales.trend} />}>
                  <ColumnChart data={d.sales.trend} valueKey="disbursed" label="Disbursed" xLabel={xLabel} xLabelLong={xLabelLong} formatValue={formatMoney} formatTick={formatMoneyTick} />
                </ChartCard>
                <ChartCard title="Lead conversion funnel" description="Leads received in the period, by how far they got" empty={!d.summary.leads} emptyText="No leads in this period."
                  table={<DataTable caption="Funnel" columns={[{ key: "stage", label: "Stage", render: (r) => FUNNEL[r.stage] }, { key: "count", label: "Leads", align: "right" }]} rows={d.sales.funnel} />}>
                  <BarList colors={[...ORDINAL, ORDINAL.at(-1)]} items={d.sales.funnel.map((f, i) => ({ key: f.stage, label: FUNNEL[f.stage], value: f.count, display: formatCount(f.count), note: i ? pct(f.count / (d.sales.funnel[0].count || 1)) : undefined }))} />
                </ChartCard>
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <ChartCard title="Leads vs files logged" description={`Per ${per}`} empty={!d.summary.leads && !d.summary.files} emptyText="No leads or files in this period."
                  table={<DataTable caption="Leads vs files" columns={[{ key: "bucket", label: "Period", render: xLabelLong }, { key: "leads", label: "Leads", align: "right" }, { key: "files", label: "Files", align: "right" }]} rows={d.sales.trend} />}>
                  <ColumnChart data={d.sales.trend} valueKey="leads" label="Leads" xLabel={xLabel} xLabelLong={xLabelLong} formatValue={formatCount} extraRows={(r) => [{ label: "Files logged", value: formatCount(r.files) }]} />
                </ChartCard>
                <ChartCard title="Why leads were lost" description="Reasons recorded on lost leads" empty={!d.sales.lostReasons.length} emptyText="No lost leads in this period.">
                  <BarList items={d.sales.lostReasons.map((x) => ({ key: x.reason, label: x.reason, value: x.count, display: formatCount(x.count) }))} />
                </ChartCard>
              </div>
              <TableCard title="Conversion by source" columns={[
                { key: "label", label: "Source" }, { key: "leads", label: "Leads", align: "right" }, { key: "converted", label: "Converted", align: "right" },
                { key: "conversion", label: "Conversion", align: "right", render: (r) => pct(r.conversion) },
              ]} rows={d.sales.sources} empty="No leads in this period." />
            </>
          )}
          {tab === "team" && (
            <TableCard title="Employee leaderboard" description="Leads received, files logged and disbursals in the period; target scaled to the period" columns={[
              { key: "rank", label: "#", render: (_r, i) => i + 1 },
              { key: "name", label: "Employee", render: (r) => <span><span className="font-semibold">{r.name}</span><span className="block text-xs text-muted">{[r.role, r.branch].filter(Boolean).join(" · ")}{r.active ? "" : " · inactive"}</span></span> },
              { key: "leads", label: "Leads", align: "right" }, { key: "converted", label: "Converted", align: "right" },
              { key: "conversion", label: "Conversion", align: "right", render: (r) => pct(r.conversion) }, { key: "files", label: "Files", align: "right" },
              { key: "disbursed", label: "Disbursed", align: "right", render: (r) => formatMoney(r.disbursed) },
              { key: "targetPct", label: "Target", render: (r) => <Progress value={r.targetPct} /> },
            ]} rows={d.team} empty="No team members yet." />
          )}
          {tab === "lenders" && (
            <TableCard title="Lender-wise approvals & payouts" description="Files logged in the period; disbursals by disbursal date" columns={[
              { key: "name", label: "Lender", render: (r) => <span className="font-semibold">{r.name}</span> },
              { key: "files", label: "Files", align: "right" }, { key: "approved", label: "Approved", align: "right" }, { key: "rejected", label: "Rejected", align: "right" },
              { key: "approvalRate", label: "Approval", align: "right", render: (r) => pct(r.approvalRate) },
              { key: "disbursed", label: "Disbursed", align: "right", render: (r) => formatMoney(r.disbursed) },
              { key: "payout", label: "Payout earned", align: "right", render: (r) => (r.payoutPct == null ? "—" : formatMoney(r.payout)) },
            ]} rows={d.lenders} empty="No applications in this period." />
          )}
          {tab === "products" && (
            <>
              <ChartCard title="Disbursal by product" empty={!d.products.length} emptyText="No applications in this period.">
                <BarList items={d.products.map((p) => ({ key: p.type, label: p.label, value: p.disbursed, display: formatMoney(p.disbursed), note: `${p.disbursedFiles} files` }))} />
              </ChartCard>
              <TableCard title="Product-wise analysis" columns={[
                { key: "label", label: "Product", render: (r) => <span className="font-semibold">{r.label}</span> },
                { key: "files", label: "Files", align: "right" }, { key: "avgTicket", label: "Avg ticket", align: "right", render: (r) => formatMoney(r.avgTicket) },
                { key: "approvalRate", label: "Approval", align: "right", render: (r) => pct(r.approvalRate) },
                { key: "disbursedFiles", label: "Disbursed files", align: "right" }, { key: "disbursed", label: "Disbursed", align: "right", render: (r) => formatMoney(r.disbursed) },
              ]} rows={d.products} empty="No applications in this period." />
            </>
          )}
          {tab === "cities" && (
            <>
              <ChartCard title="Top cities by disbursal" description="Customer’s city, else the lead’s city" empty={!d.cities.length} emptyText="No applications in this period.">
                <BarList items={d.cities.slice(0, 10).map((c) => ({ key: c.city, label: c.city, value: c.disbursed, display: formatMoney(c.disbursed), note: `${c.files} files` }))} />
              </ChartCard>
              <TableCard title="City-wise analysis" columns={[
                { key: "city", label: "City", render: (r) => <span className="font-semibold">{r.city}</span> },
                { key: "files", label: "Files", align: "right" }, { key: "approved", label: "Approved", align: "right" },
                { key: "disbursed", label: "Disbursed", align: "right", render: (r) => formatMoney(r.disbursed) },
              ]} rows={d.cities} empty="No applications in this period." />
            </>
          )}
          {!d.summary.leads && !d.summary.files && !d.summary.disbursed && <EmptyState title="No activity in this period">Pick a longer period to see more.</EmptyState>}
        </div>
      )}
    </>
  );
}
