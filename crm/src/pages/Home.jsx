import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardHeader, PageHeader } from "../components/ui";
import { useAuth } from "../lib/auth";
import { formatDate, formatTime } from "../lib/format";
import { NAV, SETTINGS_TABS } from "../lib/navigation";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

/** Start page until the Dashboard module ships: who you are, what your role opens, and your security shortcuts. */
export default function Home() {
  const { user, can } = useAuth();
  const modules = NAV.flatMap((s) => s.items).filter((i) => i.perm && can(i.perm));
  const settings = SETTINGS_TABS.filter((t) => !t.perm || can(t.perm));
  const firstName = user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={`Signed in as ${user.role?.name}.${user.lastLoginAt ? ` This sign-in: ${formatDate(user.lastLoginAt)}, ${formatTime(user.lastLoginAt)}.` : ""}`}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Your access" description="Modules your role can open. The dashboard and sales modules arrive in the next phases." />
          {modules.length ? (
            <ul className="divide-y divide-line">
              {modules.map(({ to, label, icon: Icon }) => (
                <li key={to} className="flex items-center gap-3 px-5 py-3">
                  <Icon className="size-[18px] text-brand-600" aria-hidden />
                  <span className="flex-1 text-sm font-semibold">{label}</span>
                  <span className="text-xs text-muted">Coming soon</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-muted">Your role doesn’t include any CRM modules yet.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Security & settings" />
          <ul className="divide-y divide-line">
            {settings.map((t) => (
              <li key={t.to}>
                <Link to={t.to} className="flex items-center gap-3 px-5 py-3 text-sm font-semibold hover:bg-canvas">
                  <ShieldCheck className="size-[18px] text-brand-600" aria-hidden />
                  <span className="flex-1">{t.label}</span>
                  <ArrowRight className="size-4 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
