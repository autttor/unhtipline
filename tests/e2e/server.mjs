// End-to-end test server. NOT part of the site and never deployed.
//
// One local origin that plays every part of the system so the real site can be driven in a browser:
//   /open/...   the site with intake open        /closed/...  the site as committed (intake closed)
//   /functions/v1/*   the REAL Edge Function handlers, backed by a local PostgreSQL
//   /rest/v1/rpc/*    runs the REAL staff_* database functions as the signed-in caller
//   /auth/v1/*        a STAND-IN for Supabase Auth (passwords, authenticator step, invitations)
//   /__test/*         helpers for the test script (read the sandbox mailbox, make email fail)
//
// The database, its access rules and the handlers are the real ones. Only sign-in is simulated, so
// this proves the dashboard and the access rules work together, not that Supabase Auth is set up.
// Every account and every submission here is fictional.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { handleSubmit, handleDispatch, handleAdminUsers, handleTrack } from "../../supabase/functions/_shared/handlers.ts";
import { sandboxProvider, MailError } from "../../supabase/functions/_shared/mail.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const PORT = Number(process.env.E2E_PORT || 8791);
const ORIGIN = `http://localhost:${PORT}`;
const PG = ["-h", process.env.PGHOST, "-p", process.env.PGPORT, "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"];
const ANON_KEY = "test-anon-key";
const MFA_CODE = "123456";

/* ---------- database ---------- */

function literal(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return `array[${v.map(literal).join(",")}]::text[]`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sql(statements) {
  return new Promise((resolve) => {
    execFile("psql", [...PG, "-c", statements], (err, stdout, stderr) => {
      if (err) {
        const message = (stderr.match(/ERROR:\s+(.*)/) || [null, stderr.trim()])[1];
        return resolve({ data: null, error: { message } });
      }
      const last = stdout.trim().split("\n").pop() ?? "";
      let data = null;
      if (last !== "") { try { data = JSON.parse(last); } catch { data = last; } }
      resolve({ data, error: null });
    });
  });
}

function callAs(role, claims, fn, args) {
  if (!/^[a-z_]+$/.test(fn)) return Promise.resolve({ data: null, error: { message: "bad function name" } });
  const named = Object.entries(args || {}).map(([k, v]) => `${k} => ${literal(v)}`).join(", ");
  const setClaims = claims ? `select set_config('request.jwt.claims', ${literal(JSON.stringify(claims))}, false);` : "";
  return sql(`set role ${role}; ${setClaims} select public.${fn}(${named});`);
}

/* ---------- stand-in for Supabase Auth ---------- */

const users = new Map(); // email -> { id, email, password, factors: [{ id, status, friendly_name }] }
function addUser(id, email, password, verifiedFactor) {
  users.set(email, { id, email, password, factors: verifiedFactor ? [{ id: randomUUID(), status: "verified", friendly_name: "seeded" }] : [] });
}
addUser("00000000-0000-0000-0000-000000000001", "admin@example.org", "correct horse battery 1", true);
addUser("00000000-0000-0000-0000-000000000002", "reviewer@example.org", "correct horse battery 2", false);
addUser("00000000-0000-0000-0000-000000000003", "advocate@example.org", "correct horse battery 3", true);
addUser("00000000-0000-0000-0000-000000000005", "outsider@example.org", "correct horse battery 5", true);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(user, aal) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    sub: user.id, email: user.email, role: "authenticated", aal, iat: now, exp: now + 3600, session_id: randomUUID(),
    amr: [{ method: "password", timestamp: now }].concat(aal === "aal2" ? [{ method: "totp", timestamp: now }] : []),
  })}.test-signature`;
}
function claimsFrom(authorization) {
  const raw = (authorization || "").replace(/^Bearer /, "");
  if (raw.split(".").length !== 3) return null;
  try { return JSON.parse(Buffer.from(raw.split(".")[1], "base64url").toString()); } catch { return null; }
}
function userView(user) {
  const stamp = new Date().toISOString();
  return {
    id: user.id, aud: "authenticated", role: "authenticated", email: user.email, email_confirmed_at: stamp, created_at: stamp, updated_at: stamp,
    app_metadata: { provider: "email" }, user_metadata: {},
    factors: user.factors.map((f) => ({ id: f.id, factor_type: "totp", status: f.status, friendly_name: f.friendly_name, created_at: stamp, updated_at: stamp })),
  };
}
function session(user, aal) {
  return { access_token: token(user, aal), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `refresh.${user.email}.${aal}`, user: userView(user) };
}
function userFor(req) {
  const claims = claimsFrom(req.headers.authorization);
  return claims ? [...users.values()].find((u) => u.id === claims.sub) || null : null;
}

async function auth(req, res, path, body) {
  const send = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data ?? {})); };
  const url = new URL(req.url, ORIGIN);
  if (path === "/token" && url.searchParams.get("grant_type") === "password") {
    const user = users.get(String(body.email || "").toLowerCase());
    if (!user || user.password !== body.password) return send(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
    return send(200, session(user, "aal1"));
  }
  if (path === "/token" && url.searchParams.get("grant_type") === "refresh_token") {
    const [, email, aal] = String(body.refresh_token || "").match(/^refresh\.(.+)\.(aal[12])$/) || [];
    const user = users.get(email);
    return user ? send(200, session(user, aal)) : send(400, { msg: "Invalid Refresh Token" });
  }
  if (path === "/recover") return send(200, {});
  if (path === "/logout") { res.writeHead(204); return res.end(); }

  const user = userFor(req);
  if (!user) return send(401, { msg: "invalid token" });
  const claims = claimsFrom(req.headers.authorization);
  if (path === "/user" && req.method === "GET") return send(200, userView(user));
  if (path === "/user" && req.method === "PUT") { if (body.password) user.password = body.password; return send(200, userView(user)); }
  if (path === "/factors" && req.method === "POST") {
    const factor = { id: randomUUID(), status: "unverified", friendly_name: body.friendly_name };
    user.factors.push(factor);
    return send(200, { id: factor.id, type: "totp", friendly_name: factor.friendly_name,
      totp: { qr_code: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><rect width='10' height='10' fill='black'/></svg>", secret: "TESTSECRETTESTSECRET", uri: "otpauth://totp/test" } });
  }
  const factorPath = path.match(/^\/factors\/([^/]+)(\/challenge|\/verify)?$/);
  if (factorPath) {
    const factor = user.factors.find((f) => f.id === factorPath[1]);
    if (!factor) return send(404, { msg: "factor not found" });
    if (!factorPath[2] && req.method === "DELETE") { user.factors = user.factors.filter((f) => f !== factor); return send(200, { id: factor.id }); }
    if (factorPath[2] === "/challenge") return send(200, { id: randomUUID(), type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 });
    if (factorPath[2] === "/verify") {
      if (body.code !== MFA_CODE) return send(400, { msg: "Invalid TOTP code entered" });
      factor.status = "verified";
      return send(200, session(user, "aal2"));
    }
  }
  void claims;
  send(404, { msg: "not found: " + path });
}

/* ---------- the real handlers, wired to the local database and a sandbox mailbox ---------- */

const mailbox = sandboxProvider();
let mailFails = false;
const deps = {
  rpc: (fn, args) => callAs("service_role", null, fn, args),
  pepper: "end-to-end-test-pepper-0123456789abcdef", allowedOrigin: ORIGIN,
  recipients: ["reviewers@example.org"],
  mail: { name: "sandbox", send: (m) => mailFails ? Promise.reject(new MailError("provider_error", "simulated outage")) : mailbox.send(m) },
  mailFrom: "Pride Line <reports@example.org>", includeDetails: false, dashboardUrl: `${ORIGIN}/open/admin/`,
  dispatchSecret: "end-to-end-dispatch-secret-0123456789",
  verifyStaff: async (authorization) => {
    const claims = claimsFrom(authorization);
    if (!claims) return null;
    const { data } = await callAs("authenticated", claims, "staff_me", {});
    return data;
  },
  inviteUser: async (email) => {
    if (users.has(email)) return { error: "already registered" };
    const id = randomUUID();
    addUser(id, email, randomUUID(), false);
    await sql(`insert into auth.users (id, email) values ('${id}', ${literal(email)});`);
    return { user_id: id };
  },
};
const functions = { "submit-report": handleSubmit, "send-notifications": handleDispatch, "admin-users": handleAdminUsers, "track-report": handleTrack };

/* ---------- the site, with test configuration ---------- */

const POLICY = `{ REVIEW_HOURS: "on weekdays during the semester", RESPONSE_TIME: "within three days", RETENTION: "12 months",
  CONFIDENTIALITY_LIMITS: "If you tell us someone is in immediate danger, a reviewer may contact University Public Safety.", CONTACT_EMAIL: "team@example.org" }`;
function configFor(mode, original) {
  if (mode === "closed") return original.replace("INTAKE_ENABLED: true", "INTAKE_ENABLED: false"); // the kill switch, thrown
  return original
    .replace("INTAKE_ENABLED: false", "INTAKE_ENABLED: true")
    .replace(/SUPABASE_URL: "[^"]*"/, `SUPABASE_URL: "${ORIGIN}"`)
    .replace('SUPABASE_ANON_KEY: ""', `SUPABASE_ANON_KEY: "${ANON_KEY}"`)
    .replace(/POLICY: \{[\s\S]*?\n  \},/, `POLICY: ${POLICY},`);
}
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css", svg: "image/svg+xml", md: "text/plain" };

async function site(res, mode, path) {
  if (path.endsWith("/")) path += "index.html";
  if (path.includes("..")) { res.writeHead(400); return res.end(); }
  try {
    let content = await readFile(root + path.replace(/^\//, ""));
    if (path === "/assets/js/config.js") content = configFor(mode, content.toString());
    // In the "open" site, the core contacts count as verified, as they must be before a real launch.
    if (path === "/assets/js/resources-data.js" && mode === "open") content = content.toString().replace(/core: true, verified: false/g, "core: true, verified: true");
    res.writeHead(200, { "content-type": TYPES[path.split(".").pop()] || "application/octet-stream", "cache-control": "no-store" });
    res.end(content);
  } catch { res.writeHead(404); res.end("not found"); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const body = (() => { try { return JSON.parse(raw.toString() || "{}"); } catch { return {}; } })();
  const path = url.pathname;

  if (path.startsWith("/open/")) return site(res, "open", path.slice(5));
  if (path.startsWith("/closed/")) return site(res, "closed", path.slice(7));

  if (path.startsWith("/functions/v1/")) {
    const handler = functions[path.split("/").pop()];
    if (!handler) { res.writeHead(404); return res.end(); }
    const request = new Request(ORIGIN + path, {
      method: req.method, headers: { ...req.headers, "x-forwarded-for": req.headers["x-test-ip"] || "198.51.100.1" },
      body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : raw,
    });
    const out = await handler(request, deps);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    return res.end(await out.text());
  }

  if (path.startsWith("/rest/v1/rpc/")) {
    const claims = claimsFrom(req.headers.authorization);
    const { data, error } = await callAs(claims ? "authenticated" : "anon", claims, path.split("/").pop(), body);
    res.writeHead(error ? (/permission denied|not_authorized|admin_only|not_permitted|claim_first/.test(error.message) ? 403 : 400) : 200, { "content-type": "application/json" });
    return res.end(JSON.stringify(error ? { message: error.message, code: "P0001", details: null, hint: null } : data));
  }

  if (path.startsWith("/auth/v1/")) return auth(req, res, path.slice(8), body);

  if (path === "/__test/mail") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(mailbox.sent)); }
  if (path === "/__test/mail-fails") { mailFails = url.searchParams.get("on") === "1"; res.writeHead(204); return res.end(); }
  if (path === "/__test/sql") { // read-only peeks at the database for assertions
    const out = await sql(String(body.query));
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(out));
  }
  if (path === "/__test/invite-link") { // what the invitation email's link would do
    const user = users.get(url.searchParams.get("email"));
    const s = session(user, "aal1");
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end(`${ORIGIN}/open/admin/index.html#access_token=${s.access_token}&expires_in=3600&refresh_token=${s.refresh_token}&token_type=bearer&type=invite`);
  }
  res.writeHead(404); res.end("not found");
}).listen(PORT, () => console.log(`e2e server on ${ORIGIN}`));
