import cors from "cors";
import express from "express";
import { connectDB, pool } from "./lib/db.js";
import { HttpError, session } from "./lib/http.js";
import { captchaEnabled } from "./lib/captcha.js";
import { apiLimiter, crmLimiter } from "./lib/limits.js";
import { ensureSystemRoles } from "./crm/accounts.js";
import activity from "./routes/activity.js";
import auth from "./routes/auth.js";
import crm from "./routes/crm/index.js";
import loans from "./routes/loans.js";

const app = express();
// Behind a proxy (Render, Nginx…) set TRUST_PROXY=1 so rate limits see the visitor's IP, not the proxy's.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 0));
const PORT = Number(process.env.PORT ?? 4000);
const origins = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim());

app.disable("x-powered-by");
// JSON-only API: no sniffing, no framing, no referrer leaks.
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
  next();
});
app.use(cors({ origin: origins }));
app.use(express.json({ limit: "100kb" }));
app.use("/api", apiLimiter);
app.use("/api/crm", crmLimiter);
app.use(session);

app.get("/api/health", async (_req, res) => {
  const db = await pool.query("select 1").then(() => true, () => false);
  res.json({ ok: true, db });
});
app.use("/api", loans);
app.use("/api/auth", auth);
app.use("/api", activity);
app.use("/api/crm", crm);

app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  let status = err.status ?? 500;
  let message = err.message;
  // PostgreSQL errors (Drizzle wraps them; the driver's error is in err.cause)
  const pgCode = err.cause?.code ?? err.code;
  if (pgCode === "23505") { status = 409; message = "Already exists"; } // unique violation
  if (pgCode === "23503" || pgCode === "23514" || pgCode === "22P02") { status = 400; message = "Invalid request"; } // foreign key, check, bad uuid
  if (err.type === "entity.parse.failed") { status = 400; message = "Invalid JSON"; }
  if (err.type === "entity.too.large") { status = 413; message = "Request is too large"; }
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && status !== 503 ? "Something went wrong" : message, ...(err.fields && { fields: err.fields }) });
});

try {
  await connectDB();
  await ensureSystemRoles();
  // Express 5 passes listen errors (e.g. port already in use) to this callback instead of throwing.
  app.listen(PORT, (err) => {
    if (err) {
      console.error(err.code === "EADDRINUSE" ? `Port ${PORT} is already in use — another copy of the API is probably running. Stop it or set PORT.` : err);
      process.exit(1);
    }
    console.log(`AvodahLoans API on http://localhost:${PORT}`);
    if (!captchaEnabled) console.warn("[captcha] TURNSTILE_SECRET_KEY is not set — captcha checks are OFF");
  });
} catch (err) {
  console.error("Could not start — PostgreSQL error:", err.cause?.message ?? err.message);
  process.exit(1);
}
