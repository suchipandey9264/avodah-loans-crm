// Client for the CRM API (/api/crm on the backend). In dev, Vite proxies /api to http://localhost:4000.

const BASE = (import.meta.env.VITE_API_URL ?? "") + "/api/crm";
const TOKEN_KEY = "avodah.crm.token"; // separate from the public site's customer token

export const tokenStore = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t) => {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
  },
  key: TOKEN_KEY,
};

/** Fired when a signed-in request comes back 401 (session expired, revoked, or user suspended). */
export const UNAUTHORIZED_EVENT = "crm:unauthorized";

export async function request(path, { method = "GET", body, query } = {}) {
  const clean = query && Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const qs = clean && Object.keys(clean).length ? "?" + new URLSearchParams(clean) : "";
  const token = tokenStore.get();
  let res;
  try {
    res = await fetch(BASE + path + qs, {
      method,
      headers: {
        ...(body && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error("Can’t reach the server. Check your connection and try again."), { status: 0, fields: {} });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status, fields: data.fields ?? {} });
  }
  return data;
}

const clean = (query = {}) => Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/** Fetches a file with the session token and saves it (exports, documents). */
async function download(path, fileName) {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  // Auth
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),
  signup: (body) => request("/auth/signup", { method: "POST", body }),
  forgot: (email) => request("/auth/forgot", { method: "POST", body: { email } }),
  reset: (uid, token, password) => request("/auth/reset", { method: "POST", body: { uid, token, password } }),
  changePassword: (currentPassword, newPassword) => request("/auth/password", { method: "POST", body: { currentPassword, newPassword } }),
  sessions: () => request("/auth/sessions"),
  revokeSession: (id) => request(`/auth/sessions/${id}`, { method: "DELETE" }),
  revokeOtherSessions: () => request("/auth/sessions", { method: "DELETE" }),

  // Users & roles
  roles: () => request("/roles"),
  users: (query) => request("/users", { query }),
  createUser: (user) => request("/users", { method: "POST", body: user }),
  updateUser: (id, patch) => request(`/users/${id}`, { method: "PATCH", body: patch }),
  sendReset: (id) => request(`/users/${id}/reset-password`, { method: "POST" }),
  signOutUser: (id) => request(`/users/${id}/sessions`, { method: "DELETE" }),

  // Audit
  auditLogs: (query) => request("/audit-logs", { query }),
  exportAuditLogs: (query) => download(`/audit-logs/export?${new URLSearchParams(clean(query))}`, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`),

  // Leads
  leadsMeta: () => request("/leads/meta"),
  leads: (query) => request("/leads", { query }),
  leadsBoard: (query) => request("/leads/board", { query }),
  lead: (id) => request(`/leads/${id}`),
  createLead: (body) => request("/leads", { method: "POST", body }),
  updateLead: (id, body) => request(`/leads/${id}`, { method: "PATCH", body }),
  deleteLead: (id) => request(`/leads/${id}`, { method: "DELETE" }),
  addLeadNote: (id, body) => request(`/leads/${id}/notes`, { method: "POST", body: { body } }),
  addFollowup: (id, body) => request(`/leads/${id}/followups`, { method: "POST", body }),
  closeFollowup: (id, fid, body) => request(`/leads/${id}/followups/${fid}`, { method: "PATCH", body }),
  convertLead: (id, body) => request(`/leads/${id}/convert`, { method: "POST", body }),
  bulkLeads: (body) => request("/leads/bulk", { method: "POST", body }),
  /** Downloads the filtered leads as CSV (needs leads.export). */
  async exportLeads(query) {
    const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    const res = await fetch(`${BASE}/leads/export?${new URLSearchParams(clean)}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Export failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `leads-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  },

  // Follow-ups (leads and customers)
  followupsMeta: () => request("/followups/meta"),
  followups: (query) => request("/followups", { query }),
  scheduleFollowup: (body) => request("/followups", { method: "POST", body }),
  updateFollowup: (id, body) => request(`/followups/${id}`, { method: "PATCH", body }),

  // Employees (staff users; create/edit go through createUser / updateUser)
  employees: (query) => request("/employees", { query }),
  employee: (id) => request(`/employees/${id}`),
  reassignEmployee: (id, body) => request(`/employees/${id}/reassign`, { method: "POST", body }),

  // Reports
  reports: (query) => request("/reports", { query }),
  exportReport: (tab, query) => download(`/reports/export?${new URLSearchParams({ tab, ...query })}`, `report-${tab}-${new Date().toISOString().slice(0, 10)}.csv`),

  // Settings → General / Notifications
  generalSettings: () => request("/settings/general"),
  updateGeneralSettings: (body) => request("/settings/general", { method: "PATCH", body }),
  notificationPreferences: () => request("/notifications/preferences"),
  updateNotificationPreferences: (body) => request("/notifications/preferences", { method: "PUT", body }),

  // Customers
  customersMeta: () => request("/customers/meta"),
  customers: (query) => request("/customers", { query }),
  customer: (id) => request(`/customers/${id}`),
  createCustomer: (body) => request("/customers", { method: "POST", body }),
  updateCustomer: (id, body) => request(`/customers/${id}`, { method: "PATCH", body }),
  addCustomerNote: (id, body) => request(`/customers/${id}/notes`, { method: "POST", body: { body } }),
  reviewDocument: (id, docId, body) => request(`/customers/${id}/documents/${docId}`, { method: "PATCH", body }),
  deleteDocument: (id, docId) => request(`/customers/${id}/documents/${docId}`, { method: "DELETE" }),
  /** Sends the file itself as the request body (PDF, JPG or PNG, up to 5 MB). */
  async uploadDocument(id, file, { docType, note, applicationId }) {
    const qs = new URLSearchParams({ docType, fileName: file.name, ...(note ? { note } : {}), ...(applicationId ? { applicationId } : {}) });
    const res = await fetch(`${BASE}/customers/${id}/documents?${qs}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenStore.get()}`, "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `Upload failed (${res.status})`), { status: res.status, fields: data.fields ?? {} });
    return data;
  },
  downloadDocument: (id, docId, fileName) => download(`/customers/${id}/documents/${docId}/file`, fileName),
  exportCustomers: (query) => download(`/customers/export?${new URLSearchParams(clean(query))}`, `customers-${new Date().toISOString().slice(0, 10)}.csv`),

  // Applications
  applicationsMeta: () => request("/applications/meta"),
  applications: (query) => request("/applications", { query }),
  applicationsBoard: (query) => request("/applications/board", { query }),
  application: (id) => request(`/applications/${id}`),
  createApplication: (body) => request("/applications", { method: "POST", body }),
  updateApplication: (id, body) => request(`/applications/${id}`, { method: "PATCH", body }),
  moveApplication: (id, body) => request(`/applications/${id}/stage`, { method: "POST", body }),
  addApplicationNote: (id, body) => request(`/applications/${id}/notes`, { method: "POST", body: { body } }),
  exportApplications: (query) => download(`/applications/export?${new URLSearchParams(clean(query))}`, `applications-${new Date().toISOString().slice(0, 10)}.csv`),

  // Lenders
  lenders: (query) => request("/lenders", { query }),
  lender: (id) => request(`/lenders/${encodeURIComponent(id)}`),
  createLender: (body) => request("/lenders", { method: "POST", body }),
  updateLender: (id, body) => request(`/lenders/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  deleteLender: (id) => request(`/lenders/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Dashboard & top bar
  dashboard: ({ from, to }) => request("/dashboard", { query: { from: from.toISOString(), to: to.toISOString() } }),
  search: (q) => request("/search", { query: { q } }),
  notifications: () => request("/notifications"),
  markNotificationsSeen: () => request("/notifications/seen", { method: "POST" }),
};
