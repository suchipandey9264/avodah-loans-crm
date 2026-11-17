// Dashboard periods. Every period is [from, to) in the browser's local time; `to` is the start of the day after.

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
};

export const PRESETS = [
  { id: "today", label: "Today", range: (t) => [t, addDays(t, 1)] },
  { id: "7d", label: "Last 7 days", range: (t) => [addDays(t, -6), addDays(t, 1)] },
  { id: "30d", label: "Last 30 days", range: (t) => [addDays(t, -29), addDays(t, 1)] },
  { id: "90d", label: "Last 90 days", range: (t) => [addDays(t, -89), addDays(t, 1)] },
  { id: "month", label: "This month", range: (t) => [new Date(t.getFullYear(), t.getMonth(), 1), addDays(t, 1)] },
  { id: "lastmonth", label: "Last month", range: (t) => [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 1)] },
  { id: "year", label: "This year", range: (t) => [new Date(t.getFullYear(), 0, 1), addDays(t, 1)] },
];
export const DEFAULT_PRESET = "30d";

/**
 * Reads the period from URL params: ?range=7d, or ?from=2026-10-01&to=2026-10-31 (inclusive days).
 * Returns { id, from, to, fromDay, toDay } — fromDay/toDay are inclusive YYYY-MM-DD for the date inputs.
 */
export function rangeFromParams(params, now = new Date()) {
  const today = startOfDay(now);
  const from = parseYmd(params.get("from"));
  const to = parseYmd(params.get("to"));
  if (from && to && from <= to) return { id: "custom", from, to: addDays(to, 1), fromDay: ymd(from), toDay: ymd(to) };
  const preset = PRESETS.find((p) => p.id === params.get("range")) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET);
  const [f, t] = preset.range(today);
  return { id: preset.id, from: f, to: t, fromDay: ymd(f), toDay: ymd(addDays(t, -1)) };
}

const longDay = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
export const describeRange = (r) =>
  r.fromDay === r.toDay ? longDay.format(r.from) : `${longDay.format(r.from)} – ${longDay.format(addDays(r.to, -1))}`;
