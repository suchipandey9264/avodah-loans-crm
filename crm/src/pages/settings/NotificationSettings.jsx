import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Card, CardHeader, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

const TYPES = [
  ["leads", "New leads", "New website enquiries waiting for a first call.", "leads.view"],
  ["applications", "New applications", "Applications submitted for review.", "applications.view"],
  ["followups", "Follow-up reminders", "Your follow-ups that are due soon or overdue.", "followups.view"],
  ["security", "Security alerts", "Accounts locked after failed sign-ins.", "audit.view"],
];

/** Settings → Notifications: which items this user's bell shows. */
export default function NotificationSettings() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["notification-prefs"], queryFn: api.notificationPreferences });
  const [error, setError] = useState(null);
  const save = useMutation({
    mutationFn: api.updateNotificationPreferences,
    onSuccess: (d) => { setError(null); queryClient.setQueryData(["notification-prefs"], d); queryClient.invalidateQueries({ queryKey: ["notifications"] }); },
    onError: (e) => setError(e.message),
  });
  const types = TYPES.filter(([, , , perm]) => can(perm));

  return (
    <Card className="max-w-2xl">
      <CardHeader title="Notifications" description="Choose what appears in your notification bell. This only affects you." />
      {error && <div className="px-5 pt-4"><Alert>{error}</Alert></div>}
      {q.isPending ? <Spinner /> : q.isError ? <div className="p-5"><Alert>{q.error.message}</Alert></div> : (
        <ul className="divide-y divide-line">
          {types.map(([key, label, hint]) => {
            const on = (save.isPending && save.variables?.[key] !== undefined) ? save.variables[key] : q.data.preferences[key];
            return (
              <li key={key} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="text-sm"><p className="font-semibold" id={`pref-${key}`}>{label}</p><p className="text-xs text-muted">{hint}</p></div>
                <button type="button" role="switch" aria-checked={on} aria-labelledby={`pref-${key}`} disabled={save.isPending}
                  onClick={() => save.mutate({ [key]: !on })}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-brand-700" : "bg-line"}`}>
                  <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </li>
            );
          })}
          {!types.length && <li className="px-5 py-6 text-sm text-muted">Your role doesn’t receive notifications.</li>}
        </ul>
      )}
    </Card>
  );
}
