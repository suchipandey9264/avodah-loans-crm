import { Building2, ChartColumn, FileText, LayoutGrid, PhoneCall, ShieldCheck, UserCog, UserPlus, Users } from "lucide-react";

// Sidebar sections. `perm` hides items the role can't open; `ready: false` marks modules built in a later phase.
export const NAV = [
  { section: "Overview", items: [{ to: "/", label: "Dashboard", icon: LayoutGrid, perm: "dashboard.view", ready: true, end: true }] },
  {
    section: "Sales",
    items: [
      { to: "/leads", label: "Leads", icon: UserPlus, perm: "leads.view", ready: true },
      { to: "/customers", label: "Customers", icon: Users, perm: "customers.view", ready: true },
      { to: "/applications", label: "Applications", icon: FileText, perm: "applications.view", ready: true },
      { to: "/follow-ups", label: "Follow-ups", icon: PhoneCall, perm: "followups.view", ready: true },
    ],
  },
  {
    section: "Network",
    items: [
      { to: "/lenders", label: "Lenders", icon: Building2, perm: "lenders.view", ready: true },
      { to: "/employees", label: "Employees", icon: UserCog, perm: "employees.view", ready: true },
    ],
  },
  {
    section: "Insights",
    items: [
      { to: "/reports", label: "Reports & Analytics", icon: ChartColumn, perm: "reports.view", ready: true },
      // Every signed-in user can open Settings for their own Security tab; the other tabs check their own permission.
      { to: "/settings", label: "Security & Settings", icon: ShieldCheck, perm: null, ready: true },
    ],
  },
];

export const SETTINGS_TABS = [
  { to: "/settings/roles", label: "Roles & permissions", perm: "roles.view" },
  { to: "/settings/users", label: "Users", perm: "users.view" },
  { to: "/settings/audit-logs", label: "Audit logs", perm: "audit.view" },
  { to: "/settings/security", label: "Security", perm: null },
  { to: "/settings/general", label: "General", perm: "settings.view" },
  { to: "/settings/notifications", label: "Notifications", perm: null },
];
