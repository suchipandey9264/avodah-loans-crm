import { createHash } from "node:crypto";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

// In-memory counters: fine for a single server. With several instances, give each limiter a shared store (e.g. Redis).

const limiter = ({ minutes, limit, message, keyGenerator }) =>
  rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(keyGenerator && { keyGenerator }),
    handler: (_req, res, _next, options) => {
      res.set("Retry-After", String(Math.ceil(options.windowMs / 1000)));
      res.status(429).json({ error: message });
    },
  });

/** CRM API, per signed-in session (per IP when signed out; staff often share one office IP). */
export const crmLimiter = limiter({
  minutes: 15,
  limit: 3000,
  message: "Too many requests — please slow down and try again shortly.",
  keyGenerator: (req) => {
    const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
    return token ? `token:${createHash("sha256").update(token).digest("hex")}` : ipKeyGenerator(req.ip);
  },
});

/** CRM sign-in attempts, per IP (accounts also lock after 5 wrong passwords). */
export const crmLoginLimiter = limiter({ minutes: 15, limit: 20, message: "Too many sign-in attempts — please wait 15 minutes and try again." });

/** CRM forgot-password requests, per IP. */
export const crmForgotLimiter = limiter({ minutes: 60, limit: 5, message: "Too many reset requests — please try again in an hour." });

/** CRM reset-password submissions, per IP. */
export const crmResetLimiter = limiter({ minutes: 15, limit: 10, message: "Too many attempts — please wait 15 minutes and try again." });
