import { ChartLine, Table2 } from "lucide-react";
import { useState } from "react";
import { PRESETS } from "../lib/dateRange";
import { Button, Card, Input, Select } from "./ui";

// Shared by the Dashboard and Reports: the period picker and a chart card with a Chart / Table switch.

/* ---------- date filter ---------- */

export function DateRangeControl({ range, setParams }) {
  const [custom, setCustom] = useState(range.id === "custom");
  const [from, setFrom] = useState(range.fromDay);
  const [to, setTo] = useState(range.toDay);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="period" className="mb-1 block text-xs font-semibold text-muted">Period</label>
        <Select
          id="period"
          className="min-w-44"
          value={custom ? "custom" : range.id}
          onChange={(e) => {
            if (e.target.value === "custom") return setCustom(true);
            setCustom(false);
            setParams({ range: e.target.value });
          }}
        >
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value="custom">Custom range…</option>
        </Select>
      </div>
      {custom && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); if (from && to && from <= to) setParams({ from, to }); }}
        >
          <div>
            <label htmlFor="from" className="mb-1 block text-xs font-semibold text-muted">From</label>
            <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-xs font-semibold text-muted">To</label>
            <Input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required />
          </div>
          <Button type="submit" variant="secondary" disabled={!from || !to || from > to}>Apply</Button>
        </form>
      )}
    </div>
  );
}

/** Card for a chart with a Chart / Table switch. */
export function ChartCard({ title, description, legend, table, empty, emptyText, className = "", children }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={`flex min-w-0 flex-col ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-[15px] font-bold">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        {table && !empty && (
          <Button variant="ghost" size="sm" icon={asTable ? ChartLine : Table2} onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? "Chart" : "Table"}
          </Button>
        )}
      </div>
      {legend && !empty && !asTable && <div className="flex flex-wrap gap-4 px-5 pt-3 text-xs text-muted">{legend}</div>}
      <div className="flex-1 px-5 pb-5 pt-3">
        {empty ? <p className="grid h-full min-h-32 place-items-center text-center text-sm text-muted">{emptyText}</p> : asTable ? table : children}
      </div>
    </Card>
  );
}

