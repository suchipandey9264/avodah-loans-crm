import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight, ArrowUpRight, Banknote, Building2, CheckCircle2, Clock, FileText, Minus, RefreshCw, UserPlus, Users, XCircle,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { BarList, CATEGORICAL, DataTable, DonutChart, LineChart, SegmentedBar, SERIES } from "../components/charts";
import { ChartCard, DateRangeControl } from "../components/ReportBlocks";
import { Alert, Button, Card } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { describeRange, rangeFromParams } from "../lib/dateRange";
import { bucketLabel, change, formatCount, formatMoney } from "../lib/format";

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
          <RatesAndLoanTypes d={d} xLabel={xLabel} xLabelLong={xLabelLong} unit={unit} />
          <Breakdowns d={d} />
          {!Object.values(d.kpis).some(Boolean) && !d.cities && !d.interestRates && (
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
      <StatTile key="applications" label="Total loan applications" value={formatCount(applications.value)} icon={FileText} tint="bg-orange-50 text-orange-700">
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
            <h2 className="text-[15px] font-bold">Application tracking</h2>
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

// Each loan type keeps its colour whatever the period (colour follows the entity, not its rank).
const TYPE_COLOR = Object.fromEntries(["home", "lap", "personal", "education", "gold", "business", "car"].map((t, i) => [t, CATEGORICAL[i]]));
const formatRate = (v) => (v == null ? "No quoted rate" : `${v.toFixed(2)}%`);
const share = (n, total) => (total ? `${Math.round((n / total) * 100)}%` : "0%");

function RatesAndLoanTypes({ d, xLabel, xLabelLong, unit }) {
  const ir = d.interestRates;
  const types = d.loanTypes;
  if (!ir && !types) return null;
  const per = unit === "month" ? "month" : unit === "week" ? "week" : "day";
  const typeTotal = (types ?? []).reduce((n, t) => n + t.count, 0);
  return (
    <section aria-label="Interest rates and loan types" className="grid gap-5 lg:grid-cols-3">
      {ir && (
        <ChartCard
          className={types ? "lg:col-span-2" : "lg:col-span-3"}
          title="Interest rate trends"
          description={
            ir.average == null
              ? `Average quoted rate per ${per}`
              : `Average ${formatRate(ir.average)} this period${ir.previous != null ? ` · ${formatRate(ir.previous)} the period before` : ""}`
          }
          empty={ir.average == null}
          emptyText="No applications with a quoted rate in this period."
          table={
            <DataTable
              caption="Average interest rate by period"
              columns={[
                { key: "bucket", label: per === "day" ? "Day" : per === "week" ? "Week of" : "Month", render: xLabel },
                { key: "applications", label: "Applications", align: "right" },
                { key: "rate", label: "Average rate", align: "right", render: (r) => (r.rate == null ? "—" : formatRate(r.rate)) },
              ]}
              rows={ir.series}
            />
          }
        >
          <LineChart
            data={ir.series}
            series={[{ key: "rate", label: "Average rate", color: SERIES[0] }]}
            xLabel={xLabel}
            xLabelLong={xLabelLong}
            formatValue={formatRate}
            formatTick={(t) => `${t}%`}
            label={`Average interest rate per ${per}`}
          />
        </ChartCard>
      )}
      {types && (
        <ChartCard
          title="Loan type distribution"
          description="Share of applications by product"
          empty={!types.length}
          emptyText="No applications in this period."
          table={
            <DataTable
              caption="Applications by loan type"
              columns={[
                { key: "label", label: "Loan type" },
                { key: "count", label: "Applications", align: "right" },
                { key: "share", label: "Share", align: "right", render: (r) => share(r.count, typeTotal) },
                { key: "amount", label: "Requested", align: "right", render: (r) => formatMoney(r.amount) },
              ]}
              rows={types}
            />
          }
        >
          <DonutChart
            label="Loan type distribution"
            unit="applications"
            parts={types.map((t) => ({ key: t.type, label: t.label, value: t.count, color: TYPE_COLOR[t.type] ?? "#a8a3b5" }))}
          />
        </ChartCard>
      )}
    </section>
  );
}

function Breakdowns({ d }) {
  const { topLenders, cities, eligibility } = d;
  const cards = [
    topLenders && (
      <ChartCard
        key="lenders"
        title="Top lenders"
        description="Most applications this period"
        empty={!topLenders.length}
        emptyText="No applications in this period."
        table={
          <DataTable
            caption="Top lenders"
            columns={[
              { key: "name", label: "Lender" },
              { key: "count", label: "Applications", align: "right" },
              { key: "disbursed", label: "Disbursed", align: "right", render: (r) => formatMoney(r.disbursed) },
            ]}
            rows={topLenders}
          />
        }
      >
        <BarList items={topLenders.map((l) => ({ key: l.id, label: l.name, value: l.count, display: formatCount(l.count), note: `${formatMoney(l.disbursed)} disbursed` }))} />
      </ChartCard>
    ),
    cities && (
      <ChartCard
        key="cities"
        title="City-wise loan enquiries"
        description={`${formatCount(cities.total)} enquiries (leads) this period`}
        empty={!cities.total}
        emptyText="No enquiries in this period."
        table={
          <DataTable
            caption="Loan enquiries by city"
            columns={[
              { key: "city", label: "City" },
              { key: "count", label: "Enquiries", align: "right" },
              { key: "share", label: "Share", align: "right", render: (r) => share(r.count, cities.total) },
            ]}
            rows={cities.list}
          />
        }
      >
        <BarList items={cities.list.map((c) => ({ key: c.city, label: c.city, value: c.count, display: share(c.count, cities.total), note: formatCount(c.count) }))} />
      </ChartCard>
    ),
    eligibility && (
      <ChartCard
        key="eligibility"
        title="Eligibility insights"
        description="Applications by the applicant’s credit score, with approval rate"
        empty={eligibility.every((e) => !e.applications)}
        emptyText="No applications in this period."
        table={
          <DataTable
            caption="Applications by credit score"
            columns={[
              { key: "label", label: "Credit score" },
              { key: "applications", label: "Applications", align: "right" },
              { key: "approved", label: "Approved", align: "right" },
              { key: "rejected", label: "Rejected", align: "right" },
            ]}
            rows={eligibility}
          />
        }
      >
        <BarList
          items={eligibility.map((e) => ({
            key: e.band,
            label: e.label,
            value: e.applications,
            display: formatCount(e.applications),
            note: e.applications ? `${share(e.approved, e.applications)} approved` : null,
          }))}
        />
      </ChartCard>
    ),
  ].filter(Boolean);
  if (!cards.length) return null;
  return (
    <section aria-label="Lenders, cities and eligibility" className={`grid gap-5 ${cards.length === 3 ? "lg:grid-cols-3" : cards.length === 2 ? "lg:grid-cols-2" : ""}`}>
      {cards}
    </section>
  );
}
