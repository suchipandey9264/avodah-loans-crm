import { useLayoutEffect, useRef, useState } from "react";

// Small, dependency-free charts for the dashboard. Palette validated with the dataviz validator against white:
// series #5a2db3 / #ea580c (all checks pass), funnel ramp #b39de8 → #46208d (ordinal, monotone).
export const SERIES = ["#5a2db3", "#ea580c"];
export const ORDINAL = ["#b39de8", "#8b67df", "#6d3fd0", "#46208d"];
export const BAR = "#6d3fd0";
const GRID = "#ebe8f2";
const AXIS = "#cfc9dd";
const MUTED = "#7a748c";

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Clean ticks from 0 to just above `max`: steps of 1, 2 or 5 × 10^k. */
export function niceTicks(max, count = 4, integer = false) {
  if (!(max > 0)) return [0, 1, 2, 3, 4];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const step = integer ? Math.max(1, nice) : nice; // counts never get 0.5 ticks
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

/** ~`n` evenly spaced indexes out of `length`, always including the first and last. */
const tickIndexes = (length, n) => {
  if (length <= n) return [...Array(length).keys()];
  const step = (length - 1) / (n - 1);
  return [...new Set(Array.from({ length: n }, (_, i) => Math.round(i * step)))];
};

function Tooltip({ x, width, title, rows }) {
  const left = Math.min(Math.max(x, 80), width - 80);
  return (
    <div className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg" style={{ left }}>
      <p className="mb-1 text-muted">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2">
          {r.color && <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} aria-hidden />}
          <strong className="font-bold text-ink">{r.value}</strong>
          <span className="text-muted">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

const PAD = { top: 16, right: 12, bottom: 28, left: 52 };

/**
 * Multi-series line chart over time (one shared axis). Crosshair snaps to the nearest bucket;
 * arrow keys move it when the chart has focus.
 */
export function LineChart({ data, series, xLabel, xLabelLong = xLabel, formatValue, formatTick = formatValue, height = 240, label, integer = false }) {
  const [ref, width] = useWidth();
  const [rawActive, setActive] = useState(null);
  const n = data.length;
  const active = rawActive != null && rawActive < n ? rawActive : null; // data can shrink when the period changes
  const ticks = niceTicks(Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key]))), 4, integer);
  const top = ticks.at(-1);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  const indexAt = (px) => Math.max(0, Math.min(n - 1, Math.round(n === 1 ? 0 : ((px - PAD.left) / plotW) * (n - 1))));

  return (
    <div className="relative" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          className="block rounded-md outline-offset-4"
          onPointerMove={(e) => setActive(indexAt(e.clientX - e.currentTarget.getBoundingClientRect().left))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setActive((i) => Math.min(n - 1, (i ?? -1) + 1));
            if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? n) - 1));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatTick(t)}
              </text>
            </g>
          ))}
          {tickIndexes(n, width < 480 ? 4 : 7).map((i) => (
            <text key={i} x={x(i)} y={height - 8} textAnchor={n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="11" fill={MUTED}>
              {xLabel(data[i])}
            </text>
          ))}
          {series.map((s) => (
            <path
              key={s.key}
              d={data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d[s.key])}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {active != null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} stroke={AXIS} strokeWidth="1" />
              {series.map((s) => (
                <circle key={s.key} cx={x(active)} cy={y(data[active][s.key])} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />
              ))}
            </g>
          )}
        </svg>
      )}
      {active != null && (
        <Tooltip
          x={x(active)}
          width={width}
          title={xLabelLong(data[active])}
          rows={series.map((s) => ({ label: s.label, value: formatValue(data[active][s.key]), color: s.color }))}
        />
      )}
    </div>
  );
}

/** Single-series column chart over time. Each column is its own hover/focus target. */
export function ColumnChart({ data, valueKey, xLabel, xLabelLong = xLabel, formatValue, formatTick = formatValue, extraRows = () => [], height = 240, label }) {
  const [ref, width] = useWidth();
  const [rawActive, setActive] = useState(null);
  const n = data.length;
  const active = rawActive != null && rawActive < n ? rawActive : null;
  const ticks = niceTicks(Math.max(0, ...data.map((d) => d[valueKey])));
  const top = ticks.at(-1);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, n);
  const bw = Math.max(2, Math.min(24, band - 2)); // <= 24px, and at least a 2px gap between columns
  const cx = (i) => PAD.left + band * i + band / 2;
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  const base = PAD.top + plotH;

  const column = (i, v) => {
    const h = base - y(v);
    if (h <= 0) return null;
    const r = Math.min(4, h, bw / 2);
    const l = cx(i) - bw / 2;
    return `M${l},${base} V${base - h + r} Q${l},${base - h} ${l + r},${base - h} H${l + bw - r} Q${l + bw},${base - h} ${l + bw},${base - h + r} V${base} Z`;
  };

  return (
    <div className="relative" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="block" onPointerLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatTick(t)}
              </text>
            </g>
          ))}
          {tickIndexes(n, width < 480 ? 4 : 7).map((i) => (
            <text key={i} x={cx(i)} y={height - 8} textAnchor="middle" fontSize="11" fill={MUTED}>
              {xLabel(data[i])}
            </text>
          ))}
          {data.map((d, i) => (
            <g key={d.bucket ?? i}>
              <path d={column(i, d[valueKey]) ?? ""} fill={BAR} opacity={active == null || active === i ? 1 : 0.45} />
              <rect
                x={cx(i) - band / 2}
                y={PAD.top}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${xLabelLong(d)}: ${formatValue(d[valueKey])}`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="outline-none"
              />
            </g>
          ))}
        </svg>
      )}
      {active != null && (
        <Tooltip x={cx(active)} width={width} title={xLabelLong(data[active])} rows={[{ label, value: formatValue(data[active][valueKey]) }, ...extraRows(data[active])]} />
      )}
    </div>
  );
}

/** Horizontal bars on one baseline, each fully labelled (name left, figures right). */
export function BarList({ items, colors, max = Math.max(1, ...items.map((i) => i.value)) }) {
  return (
    <ul className="space-y-3">
      {items.map((it, i) => (
        <li key={it.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-semibold text-ink">{it.label}</span>
            <span className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
              <strong className="font-bold">{it.display}</strong>
              {it.note && <span className="ml-1.5 text-xs text-muted">{it.note}</span>}
            </span>
          </div>
          <div className="h-5 w-full">
            {it.value > 0 && (
              <div
                className="h-full rounded-r-[4px]"
                style={{ width: `${Math.max(1, (it.value / max) * 100)}%`, background: colors ? colors[i % colors.length] : BAR }}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Thin segmented bar (8px): one whole split into parts. The text beside it carries the figures. */
export function SegmentedBar({ parts, label }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return <div className="h-2 rounded-full bg-canvas" role="img" aria-label={`${label}: none`} />;
  return (
    <div className="flex h-2 gap-0.5" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.label} className="h-full rounded-full first:rounded-l-full" style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />
      ))}
    </div>
  );
}

/** The table behind a chart, for screen readers and anyone who wants exact numbers. */
export function DataTable({ columns, rows, caption }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-canvas text-left text-[11px] font-bold uppercase tracking-wider text-muted">
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={`px-3 py-2 ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-1.5 ${c.align === "right" ? "text-right" : ""}`} style={c.align === "right" ? { fontVariantNumeric: "tabular-nums" } : undefined}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
