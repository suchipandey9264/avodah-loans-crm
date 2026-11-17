import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight, ArrowUpRight, Banknote, Building2, CheckCircle2, Clock, FileText, Minus, PhoneCall, RefreshCw,
  UserPlus, Users, XCircle,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { StatusBadge } from "../lib/leads";
import { BarList, ColumnChart, DataTable, LineChart, ORDINAL, SegmentedBar, SERIES } from "../components/charts";
import { ChartCard, DateRangeControl } from "../components/ReportBlocks";
import { Alert, Avatar, Badge, Button, Card } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { describeRange, rangeFromParams } from "../lib/dateRange";
import { bucketLabel, change, formatCount, formatMoney, formatMoneyTick, timeAgo } from "../lib/format";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

/* ---------- building blocks ---------- */

function Delta({ value, previous, money = false }) {
  const { pct, direction } = change(value, previous);
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  const tone = direction === "up" ? "text-emerald-700" : direction === "down" ? "text-red-700" : "text-muted";
  const text =
    pct == null
      ? value > 0 ? "New this period" : "No change"
      : `${pct > 0 ? "+" : ""}${Math.abs(pct) >= 100 ? Math.round(pct) : pct.toFixed(1)}%`;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1 text-xs">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${tone}`}>
        <Icon className="size-3.5" aria-hidden /> {text}
      </span>
      <span className="text-muted">vs previous {money ? formatMoney(previous) : formatCount(previous)}</span>
    </p>
  );
}

function StatTile({ label, value, icon: Icon, tint, children }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold text-muted">{label}</p>
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${tint}`} aria-hidden><Icon className="size-[18px]" /></span>
      </div>
      <p className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight text-ink">{value}</p>
      {children}
    </Card>
  );
}

const LineKey = ({ color, label }) => (
  <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: color }} aria-hidden />{label}</span>
);

const APP_STATUS = {
  submitted: ["Submitted", "gray"],
  in_review: ["In review", "amber"],
  approved: ["Approved", "green"],
  disbursed: ["Disbursed", "purple"],
  rejected: ["Rejected", "red"],
};

function ListCard({ title, count, empty, className = "", children }) {
  return (
    // min-w-0: as a grid item the card would otherwise grow to fit its longest (truncated) line.
    <Card className={`flex min-w-0 flex-col ${className}`}>
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {count != null && <span className="text-xs text-muted">{count}</span>}
      </div>
      {empty ? <p className="px-5 py-10 text-center text-sm text-muted">{empty}</p> : <ul className="divide-y divide-line">{children}</ul>}
    </Card>
  );
}

/* ---------- loading skeleton ---------- */

function Skeleton() {
  const block = "animate-pulse rounded-2xl border border-line bg-white";
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className={`${block} h-32`} />)}</div>
      <div className="grid gap-5 lg:grid-cols-2">{[0, 1].map((i) => <div key={i} className={`${block} h-48`} />)}</div>
      <div className="grid gap-5 lg:grid-cols-3"><div className={`${block} h-80 lg:col-span-2`} /><div className={`${block} h-80`} /></div>
    </div>
  );
}

/* ---------- page ---------- */

export default function Dashboard() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const range = rangeFromParams(params);
  const q = useQuery({
    queryKey: ["dashboard", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => api.dashboard(range),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const unit = d?.range.unit ?? "day";
  const xLabel = (row) => bucketLabel(row.bucket, unit);
  const xLabelLong = (row) => bucketLabel(row.bucket, unit, true);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{greeting()}, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted">
            Leads, applications and disbursals for <span className="font-semibold text-ink">{describeRange(range)}</span>, compared with the period before.
          </p>
        </div>
        {/* key resets the custom inputs when the URL changes (back/forward) */}
        <DateRangeControl key={params.toString()} range={range} setParams={setParams} />
      </div>

      {q.isPending ? (
        <Skeleton />
      ) : q.isError && !d ? (
        <Alert>
          Couldn’t load the dashboard: {q.error.message}{" "}
          <Button variant="secondary" size="sm" icon={RefreshCw} className="ml-2 align-middle" onClick={() => q.refetch()}>Try again</Button>
        </Alert>
      ) : (
        <div className={`space-y-5 transition-opacity ${q.isFetching ? "opacity-60" : ""}`} aria-busy={q.isFetching}>
          {q.isError && <Alert>Couldn’t refresh — showing the last loaded figures. {q.error.message}</Alert>}
          <Kpis d={d} />
          <StatusAndAmounts d={d} />
          <Charts d={d} xLabel={xLabel} xLabelLong={xLabelLong} unit={unit} />
          <Recent d={d} />
          {!Object.values(d.kpis).some(Boolean) && !d.series && (
            <Alert tone="info">Your role doesn’t include any dashboard figures yet. Ask an administrator if you need access.</Alert>
          )}
        </div>
      )}
    </>
  );
}

function Kpis({ d }) {
  const { leads, customers, applications, lenders } = d.kpis;
  const tiles = [
    leads && (
      <StatTile key="leads" label="Leads" value={formatCount(leads.value)} icon={UserPlus} tint="bg-brand-50 text-brand-700">
        <Delta value={leads.value} previous={leads.previous} />
      </StatTile>
    ),
    customers && (
      <StatTile key="customers" label="New customers" value={formatCount(customers.value)} icon={Users} tint="bg-sky-50 text-sky-700">
        <Delta value={customers.value} previous={customers.previous} />
        <p className="mt-1 text-xs text-muted">{formatCount(customers.total)} customers in total</p>
      </StatTile>
    ),
    applications && (
      <StatTile key="applications" label="Applications" value={formatCount(applications.value)} icon={FileText} tint="bg-orange-50 text-orange-700">
        <Delta value={applications.value} previous={applications.previous} />
      </StatTile>
    ),
    lenders && (
      <StatTile key="lenders" label="Active lenders" value={formatCount(lenders.active)} icon={Building2} tint="bg-emerald-50 text-emerald-700">
        {lenders.withApplications != null && <p className="mt-2 text-xs text-muted">{formatCount(lenders.withApplications)} received applications this period</p>}
      </StatTile>
    ),
  ].filter(Boolean);
  if (!tiles.length) return null;
  return <section aria-label="Totals" className={`grid grid-cols-2 gap-3 sm:gap-4 ${tiles.length >= 4 ? "xl:grid-cols-4" : tiles.length === 3 ? "xl:grid-cols-3" : ""}`}>{tiles}</section>;
}

const STATUS_PARTS = [
  { key: "approved", label: "Approved", color: "#0ca30c", icon: CheckCircle2, iconClass: "text-emerald-700" },
  { key: "disbursed", label: "Disbursed", color: "#5a2db3", icon: Banknote, iconClass: "text-brand-700" },
  { key: "pending", label: "Pending", color: "#fab219", icon: Clock, iconClass: "text-amber-700" },
  { key: "rejected", label: "Rejected", color: "#d03b3b", icon: XCircle, iconClass: "text-red-700" },
];

function StatusAndAmounts({ d }) {
  const s = d.statuses;
  const a = d.amounts;
  if (!s && !a) return null;
  const pct = (n) => (s.total ? `${Math.round((n / s.total) * 100)}%` : "0%");
  return (
    <section aria-label="Applications and loan amounts" className="grid gap-5 lg:grid-cols-2">
      {s && (
        <Card className="p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-bold">Application status</h2>
            <span className="text-xs text-muted">{formatCount(s.total)} applications</span>
          </div>
          <div className="mt-4">
            <SegmentedBar label="Application status" parts={STATUS_PARTS.map((p) => ({ label: p.label, value: s[p.key], color: p.color }))} />
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STATUS_PARTS.map(({ key, label, color, icon: Icon, iconClass }) => (
              <li key={key} className="rounded-xl bg-canvas px-3 py-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                  <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
                  <Icon className={`size-3.5 ${iconClass}`} aria-hidden /> {label}
                </p>
                <p className="mt-1 text-xl font-extrabold">{formatCount(s[key])}</p>
                <p className="text-xs text-muted">{pct(s[key])}{key === "pending" && s.inReview ? ` · ${s.inReview} in review` : ""}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {a && (
        <Card className="p-5">
          <h2 className="text-[15px] font-bold">Loan amounts</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-canvas px-3 py-3">
              <dt className="text-xs font-semibold text-muted">Requested</dt>
              <dd className="mt-1 text-xl font-extrabold">{formatMoney(a.requested)}</dd>
              <dd><Delta value={a.requested} previous={a.previousRequested} money /></dd>
            </div>
            <div className="rounded-xl bg-canvas px-3 py-3">
              <dt className="text-xs font-semibold text-muted">Disbursed</dt>
              <dd className="mt-1 text-xl font-extrabold">{formatMoney(a.disbursed)}</dd>
              <dd><Delta value={a.disbursed} previous={a.previousDisbursed} money /></dd>
            </div>
            <div className="rounded-xl bg-canvas px-3 py-3">
              <dt className="text-xs font-semibold text-muted">Approved value</dt>
              <dd className="mt-1 text-xl font-extrabold">{formatMoney(a.approved)}</dd>
              <dd className="mt-2 text-xs text-muted">Approved and disbursed applications</dd>
            </div>
            <div className="rounded-xl bg-canvas px-3 py-3">
              <dt className="text-xs font-semibold text-muted">Average ticket size</dt>
              <dd className="mt-1 text-xl font-extrabold">{formatMoney(a.average)}</dd>
              <dd className="mt-2 text-xs text-muted">Per application this period</dd>
            </div>
          </dl>
        </Card>
      )}
    </section>
  );
}

function Charts({ d, xLabel, xLabelLong, unit }) {
  const series = d.series;
  const hasLeads = series?.[0] && "leads" in series[0];
  const hasApps = series?.[0] && "applications" in series[0];
  const lines = [hasLeads && { key: "leads", label: "Leads", color: SERIES[0] }, hasApps && { key: "applications", label: "Applications", color: SERIES[1] }].filter(Boolean);
  const trendEmpty = !series || series.every((r) => lines.every((l) => !r[l.key]));
  const valueEmpty = !hasApps || series.every((r) => !r.requested);
  const per = unit === "month" ? "month" : unit === "week" ? "week" : "day";
  const funnel = d.funnel;
  const types = d.loanTypes;

  return (
    <>
      {(series || funnel) && (
        <section aria-label="Sales conversion" className="grid gap-5 lg:grid-cols-3">
          {series && (
            <ChartCard
              className={funnel ? "lg:col-span-2" : "lg:col-span-3"}
              title={lines.length > 1 ? "Leads and applications" : "Leads"}
              description={`New per ${per}`}
              legend={lines.length > 1 && lines.map((l) => <LineKey key={l.key} color={l.color} label={l.label} />)}
              empty={trendEmpty}
              emptyText="No leads or applications in this period."
              table={
                <DataTable
                  caption="Leads and applications by period"
                  columns={[{ key: "bucket", label: per === "day" ? "Day" : per === "week" ? "Week of" : "Month", render: xLabel }, ...lines.map((l) => ({ key: l.key, label: l.label, align: "right" }))]}
                  rows={series}
                />
              }
            >
              <LineChart data={series} series={lines} xLabel={xLabel} xLabelLong={xLabelLong} formatValue={formatCount} integer label={`Leads and applications per ${per}`} />
            </ChartCard>
          )}
          {funnel && (
            <ChartCard
              title="Sales conversion"
              description="Each step as a share of the step before"
              empty={funnel.every((f) => !f.value)}
              emptyText="Nothing to convert in this period."
              table={
                <DataTable
                  caption="Sales conversion funnel"
                  columns={[{ key: "label", label: "Stage" }, { key: "value", label: "Count", align: "right" }, { key: "rate", label: "Of previous", align: "right", render: (r) => r.rate }]}
                  rows={funnel.map((f, i) => ({ ...f, rate: i ? rateText(f.value, funnel[i - 1].value) : "—" }))}
                />
              }
            >
              <BarList
                colors={ORDINAL.slice(ORDINAL.length - funnel.length)}
                items={funnel.map((f, i) => ({ key: f.stage, label: f.label, value: f.value, display: formatCount(f.value), note: i ? rateText(f.value, funnel[i - 1].value) : null }))}
              />
            </ChartCard>
          )}
        </section>
      )}

      {hasApps && (
        <section aria-label="Loan value and mix" className="grid gap-5 lg:grid-cols-3">
          <ChartCard
            className={types ? "lg:col-span-2" : "lg:col-span-3"}
            title="Loan value requested"
            description={`Per ${per}, by application date`}
            empty={valueEmpty}
            emptyText="No applications in this period."
            table={
              <DataTable
                caption="Loan value by period"
                columns={[
                  { key: "bucket", label: per === "day" ? "Day" : per === "week" ? "Week of" : "Month", render: xLabel },
                  { key: "applications", label: "Applications", align: "right" },
                  { key: "requested", label: "Requested", align: "right", render: (r) => formatMoney(r.requested) },
                  { key: "disbursed", label: "Disbursed", align: "right", render: (r) => formatMoney(r.disbursed) },
                ]}
                rows={series}
              />
            }
          >
            <ColumnChart
              data={series}
              valueKey="requested"
              label="Requested"
              xLabel={xLabel}
              xLabelLong={xLabelLong}
              formatValue={formatMoney}
              formatTick={formatMoneyTick}
              extraRows={(r) => [{ label: "Disbursed", value: formatMoney(r.disbursed) }, { label: "Applications", value: formatCount(r.applications) }]}
            />
          </ChartCard>
          {types && (
            <ChartCard
              title="Loan-type mix"
              description="Applications by product"
              empty={!types.length}
              emptyText="No applications in this period."
              table={
                <DataTable
                  caption="Applications by loan type"
                  columns={[{ key: "label", label: "Loan type" }, { key: "count", label: "Applications", align: "right" }, { key: "amount", label: "Requested", align: "right", render: (r) => formatMoney(r.amount) }]}
                  rows={types}
                />
              }
            >
              <BarList items={types.map((t) => ({ key: t.type, label: t.label, value: t.count, display: formatCount(t.count), note: formatMoney(t.amount) }))} />
            </ChartCard>
          )}
        </section>
      )}
    </>
  );
}

const rateText = (value, prev) => (prev ? `${Math.round((value / prev) * 100)}%` : "—");

function Recent({ d }) {
  const lists = [
    d.recentLeads && (
      <ListCard key="leads" title="Recent leads" empty={!d.recentLeads.length && "No new leads in this period."}>
        {d.recentLeads.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-5 py-3">
            <Avatar name={l.name} size="sm" />
            <div className="min-w-0 flex-1">
              <Link to={`/leads?lead=${l.id}`} className="block truncate text-sm font-semibold hover:text-brand-700 hover:underline">{l.name}</Link>
              <p className="truncate text-xs text-muted">{l.ref} · {l.kind === "crm" ? "Added in CRM" : l.kind === "callback" ? "Callback request" : "Credit report request"} · +91 {l.phone}</p>
            </div>
            <div className="text-right">
              <StatusBadge status={l.status} />
              <p className="mt-1 text-[11px] text-muted">{timeAgo(l.createdAt)}</p>
            </div>
          </li>
        ))}
      </ListCard>
    ),
    d.recentApplications && (
      <ListCard key="apps" title="Recent applications" empty={!d.recentApplications.length && "No applications in this period."}>
        {d.recentApplications.map((x) => {
          const [label, tone] = APP_STATUS[x.status] ?? [x.status, "gray"];
          return (
            <li key={x.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{x.name ?? "Customer"} <Link to={`/applications/${x.id}`} className="font-normal text-brand-700 hover:underline">· {x.ref}</Link></p>
                <p className="truncate text-xs text-muted">{x.loanType} · {x.lenderName}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold">{formatMoney(x.loanAmount)}</p>
                <Badge tone={tone}>{label}</Badge>
              </div>
            </li>
          );
        })}
      </ListCard>
    ),
    d.activity && (
      <ListCard
        key="activity"
        title="Recent activity"
        // With all three lists on a two-column grid, activity takes the full second row.
        className={d.recentLeads && d.recentApplications ? "lg:col-span-2 2xl:col-span-1" : ""}
        empty={!d.activity.length && "No activity in this period."}
      >
        {d.activity.map((a) => <ActivityRow key={`${a.type}:${a.id}`} a={a} />)}
      </ListCard>
    ),
  ].filter(Boolean);
  if (!lists.length) return null;
  return <section aria-label="Recent records" className={`grid gap-5 ${lists.length === 3 ? "lg:grid-cols-2 2xl:grid-cols-3" : lists.length === 2 ? "lg:grid-cols-2" : ""}`}>{lists}</section>;
}

function ActivityRow({ a }) {
  const [Icon, tint, text] =
    a.type === "lead"
      ? [PhoneCall, "bg-brand-50 text-brand-700", <><strong className="font-semibold">{a.name}</strong> asked for {a.kind === "callback" ? "a callback" : "a credit report"}</>]
      : a.type === "application"
        ? [FileText, "bg-orange-50 text-orange-700", <><strong className="font-semibold">{a.name ?? "A customer"}</strong> applied for a {a.loanType} of {formatMoney(a.loanAmount)} with {a.lenderName}</>]
        : [Users, "bg-sky-50 text-sky-700", <><Link to={`/customers/${a.id}`} className="font-semibold hover:text-brand-700 hover:underline">{a.name}</Link> became a customer</>];
  return (
    <li className="flex gap-3 px-5 py-3">
      <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${tint}`} aria-hidden><Icon className="size-4" /></span>
      <div className="min-w-0 text-sm">
        <p>{text}</p>
        <p className="mt-0.5 text-xs text-muted">{timeAgo(a.at)}</p>
      </div>
    </li>
  );
}
