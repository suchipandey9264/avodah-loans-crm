const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export const formatDate = (d) => (d ? dateFmt.format(new Date(d)) : "—");
export const formatTime = (d) => (d ? timeFmt.format(new Date(d)) : "");

/** "5 min ago", "yesterday", or a date for anything older than a week. */
export function timeAgo(d) {
  if (!d) return "—";
  const secs = Math.round((new Date(d) - Date.now()) / 1000);
  const abs = Math.abs(secs);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(secs / 86400), "day");
  return formatDate(d);
}

const countFmt = new Intl.NumberFormat("en-IN");
export const formatCount = (n) => countFmt.format(n ?? 0);

/** ₹ in Indian units: ₹950, ₹3.5 L, ₹2.22 Cr. */
export function formatMoney(n = 0) {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${+(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${+(n / 1e5).toFixed(2)} L`;
  return `₹${countFmt.format(Math.round(n))}`;
}
/** Short ₹ for axis ticks: ₹0, ₹50K, ₹5L, ₹2Cr. */
export function formatMoneyTick(n = 0) {
  if (n >= 1e7) return `₹${+(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${+(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${+(n / 1e3).toFixed(0)}K`;
  return `₹${n}`;
}

/** Change vs the previous period: { pct, direction } — pct is null when there's nothing to compare against. */
export function change(value, previous) {
  if (!previous) return { pct: null, direction: value > 0 ? "up" : "flat" };
  const pct = ((value - previous) / previous) * 100;
  return { pct, direction: pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat" };
}

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" });
/** Label for a chart bucket ("2026-10-05") at the given unit. `long` adds "Week of" for tooltips. */
export function bucketLabel(bucket, unit, long = false) {
  const d = new Date(`${bucket}T00:00:00`);
  if (unit === "month") return monthFmt.format(d);
  if (unit === "week") return long ? `Week of ${dayFmt.format(d)}` : dayFmt.format(d);
  return dayFmt.format(d);
}

export const initials =(name = "", fallback = "?") =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || fallback;

/** "Chrome · Windows" from a user-agent string (good enough for a session list). */
export function deviceLabel(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}
