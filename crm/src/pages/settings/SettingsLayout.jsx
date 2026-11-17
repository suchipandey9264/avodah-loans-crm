import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { SETTINGS_TABS } from "../../lib/navigation";

export default function SettingsLayout() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const tabs = SETTINGS_TABS.filter((t) => !t.perm || can(t.perm));
  if (pathname.replace(/\/$/, "") === "/settings") return <Navigate to={tabs[0].to} replace />;

  return (
    <>
      <PageHeader title="Security & Settings" description="Who can do what, who did what, and how the portal is protected." />
      <nav aria-label="Settings" className="-mx-4 mb-6 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                className={({ isActive }) =>
                  `block border-b-2 px-3 pb-3 pt-1 text-sm font-semibold transition-colors ${
                    isActive ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink"
                  }`
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
