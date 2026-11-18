import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { GuestOnly, RequireAuth, RequirePermission } from "./components/guards";
import AppShell from "./layouts/AppShell";
import { useAuth } from "./lib/auth";
import { NAV } from "./lib/navigation";
import ComingSoon from "./pages/ComingSoon";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";
import ForgotPassword from "./pages/auth/ForgotPassword";
import Login from "./pages/auth/Login";
import ResetPassword from "./pages/auth/ResetPassword";
import Signup from "./pages/auth/Signup";
import SettingsLayout from "./pages/settings/SettingsLayout";

// Bigger pages load on demand (AppShell shows a spinner meanwhile).
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Leads = lazy(() => import("./pages/leads/Leads"));
const Customers = lazy(() => import("./pages/customers/Customers"));
const CustomerProfile = lazy(() => import("./pages/customers/CustomerProfile"));
const Applications = lazy(() => import("./pages/applications/Applications"));
const ApplicationDetail = lazy(() => import("./pages/applications/ApplicationDetail"));
const Lenders = lazy(() => import("./pages/lenders/Lenders"));
const Followups = lazy(() => import("./pages/followups/Followups"));
const Employees = lazy(() => import("./pages/employees/Employees"));
const Reports = lazy(() => import("./pages/Reports"));
const AuditLogs = lazy(() => import("./pages/settings/AuditLogs"));
const Roles = lazy(() => import("./pages/settings/Roles"));
const Security = lazy(() => import("./pages/settings/Security"));
const General = lazy(() => import("./pages/settings/General"));
const NotificationSettings = lazy(() => import("./pages/settings/NotificationSettings"));
const Users = lazy(() => import("./pages/settings/Users"));

// Modules built in later phases: routed and permission-checked now, so access rules are in place.
const upcoming = NAV.flatMap((s) => s.items).filter((i) => !i.ready && i.to !== "/");

function StartPage() {
  const { can } = useAuth();
  return can("dashboard.view") ? <Dashboard /> : <Home />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="login" element={<Login />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="signup" element={<Signup />} />
      </Route>
      {/* Reachable signed in or out: a reset link must work either way. */}
      <Route path="reset-password" element={<ResetPassword />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          {/* Roles without dashboard.view (custom roles later) get the simple start page instead. */}
          <Route index element={<StartPage />} />
          <Route path="leads" element={<RequirePermission perm="leads.view"><Leads /></RequirePermission>} />
          <Route path="customers" element={<RequirePermission perm="customers.view"><Customers /></RequirePermission>} />
          <Route path="customers/:id" element={<RequirePermission perm="customers.view"><CustomerProfile /></RequirePermission>} />
          <Route path="applications" element={<RequirePermission perm="applications.view"><Applications /></RequirePermission>} />
          <Route path="applications/:id" element={<RequirePermission perm="applications.view"><ApplicationDetail /></RequirePermission>} />
          <Route path="lenders" element={<RequirePermission perm="lenders.view"><Lenders /></RequirePermission>} />
          <Route path="reports" element={<RequirePermission perm="reports.view"><Reports /></RequirePermission>} />
          <Route path="employees" element={<RequirePermission perm="employees.view"><Employees /></RequirePermission>} />
          <Route path="follow-ups" element={<RequirePermission perm="followups.view"><Followups /></RequirePermission>} />
          {upcoming.map((i) => (
            <Route key={i.to} path={i.to.slice(1)} element={<RequirePermission perm={i.perm}><ComingSoon title={i.label} /></RequirePermission>} />
          ))}
          <Route path="settings" element={<SettingsLayout />}>
            <Route path="roles" element={<RequirePermission perm="roles.view"><Roles /></RequirePermission>} />
            <Route path="users" element={<RequirePermission perm="users.view"><Users /></RequirePermission>} />
            <Route path="audit-logs" element={<RequirePermission perm="audit.view"><AuditLogs /></RequirePermission>} />
            <Route path="security" element={<Security />} />
            <Route path="general" element={<RequirePermission perm="settings.view"><General /></RequirePermission>} />
            <Route path="notifications" element={<NotificationSettings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
