import { Router } from "express";
import audit from "./audit.js";
import applications from "./applications.js";
import auth from "./auth.js";
import customers from "./customers.js";
import dashboard from "./dashboard.js";
import employees from "./employees.js";
import followups from "./followups.js";
import leads from "./leads.js";
import reports from "./reports.js";
import settings from "./settings.js";
import lenders from "./lenders.js";
import topbar from "./topbar.js";
import users from "./users.js";

// Everything under /api/crm. Each route checks its own permission (src/crm/middleware.js `can`).
const crm = Router();
crm.use("/auth", auth);
crm.use(users);
crm.use(audit);
crm.use(dashboard);
crm.use(leads);
crm.use(customers);
crm.use(applications);
crm.use(lenders);
crm.use(followups);
crm.use(employees);
crm.use(reports);
crm.use(settings);
crm.use(topbar);

export default crm;
