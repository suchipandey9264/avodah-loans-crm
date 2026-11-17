// CRM permission catalogue and the built-in roles. Permissions are "module.action" strings; "*" grants all.
// The backend checks these on every CRM route (middleware `can`); the frontend only uses them to hide UI.

export const MODULES = [
  { id: "dashboard", label: "Dashboard", actions: ["view"] },
  { id: "leads", label: "Leads", actions: ["view", "create", "edit", "delete", "assign", "export"] },
  // kyc = full PAN, open/verify/reject/remove documents, change KYC status (edit alone sees a masked PAN and can only upload)
  { id: "customers", label: "Customers", actions: ["view", "create", "edit", "kyc", "export"] },
  { id: "applications", label: "Applications", actions: ["view", "create", "edit", "approve", "export"] }, // approve = sanction, disburse, reject
  { id: "followups", label: "Follow-ups", actions: ["view", "create", "edit"] }, // closed by cancelling, never deleted
  { id: "lenders", label: "Lenders", actions: ["view", "create", "edit", "delete"] },
  { id: "employees", label: "Employees", actions: ["view", "create", "edit"] },
  { id: "reports", label: "Reports & Analytics", actions: ["view", "export"] },
  { id: "users", label: "Users & access", actions: ["view", "create", "edit"] },
  { id: "roles", label: "Roles & permissions", actions: ["view"] }, // defined in code, synced to the database on start
  { id: "audit", label: "Audit logs", actions: ["view", "export"] },
  { id: "settings", label: "Security & settings", actions: ["view", "edit"] },
];

export const PERMISSIONS = MODULES.flatMap((m) => m.actions.map((a) => `${m.id}.${a}`));

const all = (module) => MODULES.find((m) => m.id === module).actions.map((a) => `${module}.${a}`);
const only = (module, ...actions) => actions.map((a) => `${module}.${a}`);

// rank: a user may only create, edit or sign out users whose role ranks below their own; Admin (the top role) manages everyone.
export const SYSTEM_ROLES = [
  {
    id: "admin",
    name: "Admin",
    rank: 80,
    description: "Runs the CRM: every module, users (including other admins), roles, audit logs and settings.",
    permissions: PERMISSIONS,
  },
  {
    id: "manager",
    name: "Branch Manager",
    rank: 60,
    description: "Leads a sales team: all sales modules, team performance and reports. Lender decisions are recorded by credit.",
    permissions: [
      ...all("dashboard"), ...all("leads"), ...only("customers", "view", "create", "edit", "kyc"),
      ...only("applications", "view", "create", "edit", "export"), ...all("followups"),
      ...only("lenders", "view"), ...only("employees", "view"), ...all("reports"), ...only("users", "view"),
    ],
  },
  {
    id: "credit_analyst",
    name: "Credit Analyst",
    rank: 40,
    description: "Credit and ops desk: processes applications and documents with lenders.",
    permissions: [
      ...only("dashboard", "view"), ...only("leads", "view"), ...only("customers", "view", "edit", "kyc"),
      ...only("applications", "view", "create", "edit", "approve"), ...only("followups", "view", "create", "edit"),
      ...only("lenders", "view"), ...only("reports", "view"),
    ],
  },
  {
    id: "employee",
    name: "Sales Executive",
    rank: 20,
    description: "Works leads and customers, schedules follow-ups and files applications.",
    permissions: [
      ...only("dashboard", "view"), ...only("leads", "view", "create", "edit"), ...only("customers", "view", "create", "edit"),
      ...only("applications", "view", "create"), ...only("followups", "view", "create", "edit"), ...only("lenders", "view"),
    ],
  },
  {
    id: "telecaller",
    name: "Telecaller",
    rank: 15,
    description: "Calls new leads, qualifies them and books follow-ups.",
    permissions: [
      ...only("dashboard", "view"), ...only("leads", "view", "create", "edit"), ...only("customers", "view"),
      ...only("followups", "view", "create", "edit"),
    ],
  },
  {
    id: "viewer",
    name: "Viewer",
    rank: 10,
    description: "Read-only access to the dashboard and reports.",
    permissions: [...only("dashboard", "view"), ...only("reports", "view")],
  },
];

export const hasPermission = (permissions, perm) => permissions.includes("*") || permissions.includes(perm);
