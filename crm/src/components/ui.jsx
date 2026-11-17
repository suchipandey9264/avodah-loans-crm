import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { initials } from "../lib/format";

const cx = (...c) => c.filter(Boolean).join(" ");

const BUTTON = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-300",
  secondary: "border border-line bg-white text-ink hover:bg-brand-50 disabled:text-muted",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300",
  ghost: "text-brand-700 hover:bg-brand-50 disabled:text-muted",
};

export function Button({ variant = "primary", size = "md", loading = false, icon: Icon, className, children, disabled, ...props }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        BUTTON[variant],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </button>
  );
}

/** Label + control + hint/error. The control gets id / aria-invalid / aria-describedby wired up. */
export function Field({ label, error, hint, children, className }) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-ink">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error || hint ? msgId : undefined })}
      {(error || hint) && (
        <p id={msgId} className={cx("mt-1.5 text-[13px]", error ? "text-red-700" : "text-muted")}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  "block w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/70 transition-colors hover:border-brand-200 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 aria-[invalid=true]:border-red-400 disabled:bg-canvas disabled:text-muted";

export const Input = ({ className, ...props }) => <input className={cx(CONTROL, "h-10", className)} {...props} />;
export const Select = ({ className, compact = false, children, ...props }) => (
  <select className={cx(CONTROL, compact ? "h-9" : "h-10", "pr-8", className)} {...props}>
    {children}
  </select>
);

const TONES = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  purple: "bg-brand-50 text-brand-700 ring-brand-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  gray: "bg-slate-50 text-slate-600 ring-slate-200",
};
export function Badge({ tone = "gray", dot = false, children }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", TONES[tone])}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

const AVATAR_TONES = ["bg-brand-100 text-brand-700", "bg-emerald-100 text-emerald-700", "bg-orange-100 text-orange-700", "bg-sky-100 text-sky-700", "bg-pink-100 text-pink-700"];
export function Avatar({ name, size = "md" }) {
  const tone = AVATAR_TONES[[...(name ?? "")].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span aria-hidden className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-bold", size === "sm" ? "size-7 text-[11px]" : "size-9 text-xs", tone)}>
      {initials(name)}
    </span>
  );
}

export const Card = ({ className, children }) => <section className={cx("rounded-2xl border border-line bg-white", className)}>{children}</section>;

export function CardHeader({ title, action, description }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-[15px] font-bold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({ tone = "error", children }) {
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
        tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : tone === "info" ? "border-brand-200 bg-brand-50 text-brand-800" : "border-red-200 bg-red-50 text-red-800"
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export const Spinner = ({ label = "Loading" }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted" role="status">
    <Loader2 className="size-5 animate-spin" aria-hidden /> {label}…
  </div>
);

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="px-6 py-14 text-center">
      {Icon && <Icon className="mx-auto size-8 text-brand-300" aria-hidden />}
      <p className="mt-3 font-semibold text-ink">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{children}</p>}
    </div>
  );
}

/** Native <dialog> modal: focus trapping, Esc to close and the backdrop come from the browser. */
export function Modal({ open, onClose, title, children, footer, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      // React passes a dialog's close event up its component tree; stop it so a parent drawer doesn't close too.
      onClose={(e) => { e.stopPropagation(); onClose(); }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={titleId}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-night/50`}
    >
      {open && (
        <>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-base font-bold">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className="px-5 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted" aria-label="Pagination">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-1">
        <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" />
        <Button variant="secondary" size="sm" icon={ChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" />
      </div>
    </nav>
  );
}
