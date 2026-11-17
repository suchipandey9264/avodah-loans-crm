import { createHash } from "node:crypto";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

// In-memory counters: fine for a single server. With several instances, give each limiter a shared store (e.g. Redis).

const limiter = ({ minutes, limit, message, keyGenerator, skip }) =>
  rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(keyGenerator && { keyGenerator }),
    ...(skip && { skip }),
    handler: (_req, res, _next, options) => {
      res.set("Retry-After", String(Math.ceil(options.windowMs / 1000)));
      res.status(429).json({ error: message });
    },
  });

/** Whole public API, per IP. The CRM has its own limiter (staff often share one office IP). */
export const apiLimiter = limiter({
  minutes: 15,
  limit: 300,
  message: "Too many requests — please slow down and try again shortly.",
  skip: (req) => req.path.startsWith("/crm/"),
});

/** CRM API, per signed-in session (per IP when signed out). */
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

/** Sending OTPs, per IP. */
export const otpIpLimiter = limiter({ minutes: 10, limit: 5, message: "Too many codes requested — please wait 10 minutes and try again." });

/** Sending OTPs, per phone number or email (stops one number being spammed from many IPs). */
export const otpContactLimiter = limiter({
  minutes: 10,
  limit: 3,
  message: "Too many codes sent to this number or email — please wait 10 minutes.",
  keyGenerator: (req) => {
    const contact = String(req.body?.email || req.body?.phone || "").trim().toLowerCase();
    return contact ? `contact:${contact}` : ipKeyGenerator(req.ip);
  },
});

/** Verifying OTPs, per IP. */
export const verifyLimiter = limiter({ minutes: 10, limit: 10, message: "Too many attempts — please wait 10 minutes and try again." });

/** Public lead forms (callback, credit report), per IP. */
export const leadLimiter = limiter({ minutes: 60, limit: 5, message: "You’ve sent several requests already — please try again in an hour." });
