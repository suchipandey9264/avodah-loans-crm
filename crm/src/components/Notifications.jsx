import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Bell, FileText, PhoneCall, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";

const ICONS = { lead: [PhoneCall, "bg-brand-50 text-brand-700"], application: [FileText, "bg-orange-50 text-orange-700"], security: [ShieldAlert, "bg-red-50 text-red-700"], followup: [AlarmClock, "bg-amber-50 text-amber-700"] };

/** Bell with unread count. Opening it marks everything read (per user, stored on the server). */
export default function Notifications() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [seenBefore, setSeenBefore] = useState(null); // highlight what was new when the panel opened
  const ref = useRef(null);
  const q = useQuery({ queryKey: ["notifications"], queryFn: api.notifications, refetchInterval: 60_000 });
  const markSeen = useMutation({
    mutationFn: api.markNotificationsSeen,
    onSuccess: ({ seenAt }) => queryClient.setQueryData(["notifications"], (d) => (d ? { ...d, unread: 0, seenAt } : d)),
  });

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const unread = q.data?.unread ?? 0;
  const toggle = () => {
    if (!open) {
      setSeenBefore(q.data?.seenAt ?? null);
      if (unread) markSeen.mutate();
    }
    setOpen((o) => !o);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative rounded-xl p-2 text-ink hover:bg-canvas"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-flame-600 px-1 text-[10px] font-bold text-white" aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-white shadow-xl" role="region" aria-label="Notifications">
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-bold">Notifications</p>
            <p className="text-xs text-muted">The last 14 days</p>
          </div>
          {q.isPending ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>
          ) : q.isError ? (
            <p className="px-4 py-6 text-center text-sm text-red-700">{q.error.message}</p>
          ) : !q.data.items.length ? (
            <p className="px-4 py-8 text-center text-sm text-muted">You’re all caught up.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {q.data.items.map((n) => {
                const [Icon, tint] = ICONS[n.type] ?? ICONS.lead;
                const fresh = seenBefore && new Date(n.createdAt) > new Date(seenBefore);
                return (
                  <li key={n.id} className={`flex gap-3 px-4 py-3 ${fresh ? "bg-brand-50/60" : ""}`}>
                    <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${tint}`} aria-hidden><Icon className="size-4" /></span>
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold">
                        {n.to || n.leadId ? <Link to={n.to ?? `/leads?lead=${n.leadId}`} onClick={() => setOpen(false)} className="hover:text-brand-700 hover:underline">{n.title}</Link> : n.title}
                        {fresh && <span className="sr-only"> (new)</span>}
                      </p>
                      <p className="truncate text-muted">{n.body}</p>
                      <p className="mt-0.5 text-xs text-muted">{timeAgo(n.createdAt)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
