// `npm run dev` from the project root: starts the API (port 4000) and the CRM (port 5174) together. Ctrl+C stops both.
import { spawn } from "node:child_process";

for (const app of ["backend", "crm"]) spawn(`npm --prefix ${app} run dev`, { stdio: "inherit", shell: true });
