// Test harness: an in-memory PostgreSQL (PGlite) behind a real socket, and the real API server as a child process.
// backend/.env is never loaded here, so tests can't touch the Neon database.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

export async function startStack(envOverrides = {}) {
  const pg = await PGlite.create();
  const dbPort = await freePort();
  const pgServer = new PGLiteSocketServer({ db: pg, port: dbPort, host: "127.0.0.1", maxConnections: 10 });
  await pgServer.start();

  const env = {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT, // needed by Node on Windows
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`,
    PG_POOL_MAX: "1", // PGlite is a single session; one connection keeps transactions isolated
    NODE_ENV: "test",
    OTP_DEMO: "true",
    TURNSTILE_SECRET_KEY: "",
    TRUST_PROXY: "1", // lets each test request pick its own client IP via X-Forwarded-For
    CRM_URL: "http://crm.test",
    ...envOverrides,
  };

  const run = (args, extraEnv = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...env, ...extraEnv } });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`${args.join(" ")} exited ${code}:\n${out}`))));
    });

  const apiPort = await freePort();
  const server = spawn(process.execPath, ["src/server.js"], { cwd: ROOT, env: { ...env, PORT: String(apiPort) } });
  const logs = [];
  const onData = (d) => logs.push(...String(d).split("\n").filter(Boolean));
  server.stdout.on("data", onData);
  server.stderr.on("data", onData);
  const base = `http://127.0.0.1:${apiPort}/api`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      if (server.exitCode != null || i > 150) throw new Error(`API did not start:\n${logs.join("\n")}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  let ipSeq = 1;
  /** Calls the API. Each call gets a fresh client IP unless `ip` is given, so IP rate limits don't interfere. */
  async function api(path, { method = "GET", body, token, ip } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "x-forwarded-for": ip ?? `10.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`,
        ...(body && { "content-type": "application/json" }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  /** Waits for a server log line matching `re` that appeared after `since` lines. */
  async function waitForLog(re, since = 0) {
    for (let i = 0; i < 100; i++) {
      const hit = logs.slice(since).find((l) => re.test(l));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`No log line matching ${re}`);
  }

  async function stop() {
    server.kill();
    await once(server, "exit").catch(() => {});
    await pgServer.stop();
    await pg.close();
  }

  return { api, run, pg, logs, waitForLog, stop, base };
}
