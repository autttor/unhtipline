// Server-side handlers, run against a fake database and the sandbox mail provider.
// No real submissions and no real email: every address and every report here is fictional.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCode, hmacHex, sameSecret, validateReport, validateMessage, reportToText } from "../supabase/functions/_shared/validate.ts";
import { handleSubmit, handleTrack, handleDispatch, handleAdminUsers, dispatchOutbox, notificationFor } from "../supabase/functions/_shared/handlers.ts";
import { resendProvider, sandboxProvider, MailError } from "../supabase/functions/_shared/mail.ts";
import { engineLib, flow, walk } from "./helpers.js";

const ORIGIN = "https://example.github.io";
const PEPPER = "p".repeat(48);
const IDEM = "3f2b6c1e-0000-4000-8000-000000000001";
const meta = { hp: "", elapsed_ms: 60000 };

function reportFor(branch) {
  const e = engineLib.createEngine(flow);
  walk(e, branch);
  return flow.toReport(e.answers);
}
const good = () => reportFor("report");

function fakeDeps(result = { data: { id: "PR-1043", received_at: "2026-11-12T12:00:00Z", duplicate: false }, error: null }, extra = {}) {
  const calls = [];
  const mail = sandboxProvider();
  return {
    calls, mail,
    deps: {
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (typeof result === "function") return result(fn, args);
        if (fn === "outbox_claim") return { data: [], error: null };
        return result;
      },
      pepper: PEPPER, allowedOrigin: ORIGIN, recipients: ["reviewers@example.org"], mail, mailFrom: "Pride Line <reports@example.org>",
      includeDetails: false, dashboardUrl: "https://example.github.io/unhtipline/admin/", dispatchSecret: "d".repeat(40),
      now: () => new Date("2026-11-12T12:00:00Z"), ...extra
    }
  };
}
function post(body, headers = {}) {
  return new Request("https://project.supabase.co/functions/v1/x", {
    method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "203.0.113.7, 10.0.0.1", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}
const submission = (over = {}) => ({ report: good(), meta, idem: IDEM, privacy_ack: true, ...over });

/* ---------- Validation ---------- */

test("every branch's report from the conversation is accepted unchanged", () => {
  for (const branch of ["report", "office", "peer", "advocate", "info", "other"]) {
    const report = reportFor(branch);
    const result = validateReport(report);
    assert.ok(result.ok, `${branch}: ${result.error}`);
    assert.deepEqual(result.value, report, branch);
  }
});

test("validateReport strips unknown fields and answers that belong to another branch", () => {
  const result = validateReport({ ...good(), is_admin: true, status: "closed", office: { value: "housing" }, outcome: "x", advocacy_kind: ["general"] });
  assert.ok(result.ok);
  assert.deepEqual(result.value, good());
});

test("validateReport rejects bad input", () => {
  const cases = {
    "not an object": "text", "array": [], "old version": { ...good(), version: 2 },
    "unknown help": { ...good(), help: "discipline" }, "missing safe": { ...good(), safe: undefined },
    "unknown category": { ...good(), categories: ["guilty"] }, "categories not a list": { ...good(), categories: "housing" },
    "free text where not allowed": { ...good(), frequency: { value: "other", text: "A named person" } },
    "long free text": { ...good(), where: { value: "other", text: "x".repeat(301) } },
    "long narrative": { ...good(), narrative: "x".repeat(4001) }, "non-string narrative": { ...good(), narrative: { $ne: null } },
    "contact without email": { ...good(), contact_want: "yes" },
    "contact with a bad email": { ...good(), contact_want: "yes", contact_email: "not-an-email" },
    "unknown contact answer": { ...good(), contact_want: "maybe" },
    "unknown permission": { ...reportFor("office"), external_contact: "everyone" }
  };
  for (const [label, input] of Object.entries(cases)) assert.equal(validateReport(input).ok, false, label);
});

test("permission to contact others cannot be granted where it was never asked, and defaults to no", () => {
  // A peer-support request never asks the permission question, so a forged "named" is ignored.
  const forged = validateReport({ ...reportFor("peer"), external_contact: "named", external_contact_scope: "everyone" });
  assert.equal(forged.value.external_contact, "no");
  assert.equal(forged.value.external_contact_scope, null);
  // An advocacy request with the field missing is stored as "no".
  const missing = validateReport({ ...reportFor("advocate"), external_contact: undefined, external_contact_scope: "x" });
  assert.equal(missing.value.external_contact, "no");
  assert.equal(missing.value.external_contact_scope, null);
  // A scope is only kept alongside a yes.
  const asked = validateReport({ ...reportFor("advocate"), external_contact: "ask", external_contact_scope: "the registrar" });
  assert.equal(asked.value.external_contact_scope, null);
  assert.equal(validateReport(reportFor("advocate")).value.external_contact, "anonymous");
});

test("contact details are discarded when the student declined contact", () => {
  const result = validateReport({ ...good(), contact_email: "student@example.com", contact_name: "Sam", contact_discreet: { value: "ok" } });
  assert.equal(result.value.contact_email, null);
  assert.equal(result.value.contact_name, null);
  assert.equal(result.value.contact_discreet, null);
  const tidy = validateReport({ ...good(), narrative: "  line one\u0000\u0007\nline two  ", categories: ["online", "housing", "online"] });
  assert.equal(tidy.value.narrative, "line one\nline two");
  assert.deepEqual(tidy.value.categories, ["housing", "online"]);
});

test("validateMessage, hmacHex and sameSecret", async () => {
  assert.equal(validateMessage("  hello ").value, "hello");
  for (const bad of ["", "   ", null, 42, "x".repeat(4001)]) assert.equal(validateMessage(bad).ok, false);
  // RFC 4231 test case 2.
  assert.equal(await hmacHex("Jefe", "what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  assert.equal(await sameSecret("abc", "abc"), true);
  assert.equal(await sameSecret("abc", "abd"), false);
  assert.equal(await sameSecret("", ""), false, "an unset secret never matches");
});

/* ---------- Submission ---------- */

test("submit: success is reported only with the id the database returned", async () => {
  const { deps, calls } = fakeDeps();
  const res = await handleSubmit(post(submission()), deps);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { id: "PR-1043", received_at: "2026-11-12T12:00:00Z" });
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(res.headers.get("cache-control"), "no-store");

  assert.equal(calls[0].fn, "submit_report");
  assert.equal(calls[0].args.p_idem_hash, await hmacHex(PEPPER, "idem|" + IDEM));
  assert.deepEqual(calls[0].args.p_report, good());
  assert.deepEqual(calls[0].args.p_recipients, ["reviewers@example.org"]);
  const sent = JSON.stringify(calls[0].args);
  assert.ok(!sent.includes(IDEM), "the raw idempotency key is not stored");
  assert.ok(!sent.includes("203.0.113.7"), "the raw IP address is not stored");
  assert.match(calls[0].args.p_bucket, /^[0-9a-f]{64}$/);
});

test("submit: a database failure or an unconfirmed result is never reported as success", async () => {
  let res = await handleSubmit(post(submission()), fakeDeps({ data: null, error: { message: "relation private.reports does not exist" } }).deps);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "server_error" });
  res = await handleSubmit(post(submission()), fakeDeps({ data: {}, error: null }).deps);
  assert.equal(res.status, 500, "no id from the database means no receipt");
  res = await handleSubmit(post(submission()), fakeDeps({ data: { error: "rate_limited" }, error: null }).deps);
  assert.equal(res.status, 429);
});

test("submit: a repeated request returns the same report and is marked as a repeat", async () => {
  const { deps } = fakeDeps({ data: { id: "PR-1043", received_at: "2026-11-12T12:00:00Z", duplicate: true }, error: null });
  const res = await handleSubmit(post(submission()), deps);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).id, "PR-1043");
});

test("submit: the rate-limit bucket follows the IP and rotates daily", async () => {
  const run = async (ip, day) => {
    const { deps, calls } = fakeDeps(undefined, { now: () => new Date(day) });
    await handleSubmit(post(submission(), { "x-forwarded-for": ip }), deps);
    return calls[0].args.p_bucket;
  };
  const a = await run("203.0.113.7", "2026-11-12T01:00:00Z");
  assert.equal(a, await run("203.0.113.7", "2026-11-12T23:00:00Z"));
  assert.notEqual(a, await run("203.0.113.8", "2026-11-12T01:00:00Z"));
  assert.notEqual(a, await run("203.0.113.7", "2026-11-13T01:00:00Z"));
});

test("submit: rejects bots, bad origins, missing privacy acknowledgement, and malformed requests without touching the database", async () => {
  const check = async (req, status, error, made) => {
    const { deps, calls } = made || fakeDeps();
    const res = await handleSubmit(req, deps);
    assert.equal(res.status, status, error);
    if (error) assert.equal((await res.json()).error, error);
    assert.equal(calls.length, 0, `${error}: database must not be called`);
  };
  await check(post(submission({ meta: { hp: "http://spam.example", elapsed_ms: 60000 } })), 400, "rejected");
  await check(post(submission({ meta: { hp: "", elapsed_ms: 200 } })), 400, "rejected");
  await check(post(submission({ meta: undefined })), 400, "rejected");
  await check(post(submission({ idem: undefined })), 400, "invalid_request");
  await check(post(submission({ idem: "short" })), 400, "invalid_request");
  await check(post(submission({ privacy_ack: false })), 400, "privacy_not_acknowledged");
  await check(post(submission({ privacy_ack: undefined })), 400, "privacy_not_acknowledged");
  await check(post(submission(), { origin: "https://evil.example" }), 403, "forbidden_origin");
  await check(post(submission({ report: { ...good(), help: "nope" } })), 400, "invalid_report");
  await check(post("{not json"), 400, "invalid_json");
  await check(post(submission({ report: { ...good(), narrative: "x".repeat(40000) } })), 413, "too_large");
  await check(new Request("https://x/y", { method: "GET", headers: { origin: ORIGIN } }), 405, "method_not_allowed");
  await check(new Request("https://x/y", { method: "OPTIONS", headers: { origin: ORIGIN } }), 204, null);
  await check(post(submission()), 500, "server_not_configured", fakeDeps(undefined, { pepper: "short" }));
  await check(post(submission()), 500, "server_not_configured", fakeDeps(undefined, { allowedOrigin: "" }));
});

/* ---------- Email outbox ---------- */

const claimed = (over = {}) => ({
  outbox_id: 7, recipient: "reviewers@example.org", kind: "new_report", attempt: 1, id: "PR-1046", received_at: "2026-11-12T12:00:00Z",
  help: "advocate", advocacy_requested: true, safety_flag: true, has_deadline: true, contact_requested: true, report: null, ...over
});

/** A fake database with one claimable notification and a record of how it was marked. */
function outboxDeps(rows, extra = {}) {
  const marks = [];
  let handedOut = false;
  const made = fakeDeps(async (fn, args) => {
    if (fn === "outbox_claim") { const data = handedOut ? [] : rows; handedOut = true; return { data, error: null }; }
    if (fn === "outbox_mark") { marks.push(args); return { data: args.p_ok ? "sent" : "queued", error: null }; }
    return { data: { id: "PR-1046", received_at: "2026-11-12T12:00:00Z", duplicate: false }, error: null };
  }, extra);
  return { ...made, marks };
}

test("notification email is metadata only by default: reference, request type and flags, never what the student wrote", () => {
  const report = reportFor("advocate");
  const mail = notificationFor(claimed({ report }), { includeDetails: false, dashboardUrl: "https://example.github.io/unhtipline/admin/" });
  assert.equal(mail.subject, "New Pride Line PR-1046");
  assert.match(mail.text, /Reference: PR-1046/);
  assert.match(mail.text, /Request type: Advocacy requested/);
  assert.match(mail.text, /Advocacy requested: yes/);
  assert.match(mail.text, /Safety:/);
  assert.match(mail.text, /https:\/\/example\.github\.io\/unhtipline\/admin\//);
  assert.match(mail.text, /nothing the student wrote is included/);
  for (const secret of [report.narrative, report.outcome, report.contact_email, report.contact_name, report.external_contact_scope]) {
    assert.ok(secret && !mail.text.includes(secret), `email leaked: ${secret}`);
  }
  assert.ok(!mail.text.includes("\u2014"));
  assert.ok(!/advocate|roster/i.test(mail.subject), "the subject carries no details");
});

test("an advocacy request is flagged without being called an emergency; a plain report is not flagged", () => {
  const advocacy = notificationFor(claimed({ safety_flag: false }), { includeDetails: false, dashboardUrl: "" });
  assert.match(advocacy.text, /Advocacy requested: yes/);
  assert.ok(!/emergency|urgent|Safety:/i.test(advocacy.text));
  const plain = notificationFor(claimed({ help: "report", advocacy_requested: false, safety_flag: false, has_deadline: false, contact_requested: false }), { includeDetails: false, dashboardUrl: "" });
  assert.match(plain.text, /Request type: Incident report/);
  assert.ok(!/Advocacy requested|Safety:|deadline/.test(plain.text));
  assert.match(plain.text, /did not ask to be contacted/);
});

test("the full-detail email exists only as an explicit opt-in", () => {
  const report = validateReport(reportFor("advocate")).value;
  const on = notificationFor(claimed({ report }), { includeDetails: true, dashboardUrl: "" });
  assert.ok(on.text.includes(report.narrative));
  assert.match(on.text, /confidential student report/);
  assert.equal(on.subject, "New Pride Line PR-1046", "even then the subject has no details");
  const text = reportToText(report);
  assert.match(text, /^Request type: Advocacy requested$/m);
  assert.match(text, /^Permission to contact others: anonymous$/m);
});

test("submit: one notification per recipient is sent after the report is stored, and recorded as sent", async () => {
  const { deps, mail, marks, calls } = outboxDeps([claimed()]);
  const res = await handleSubmit(post(submission({ report: reportFor("advocate") })), deps);
  assert.equal(res.status, 201);
  assert.deepEqual(calls.map((c) => c.fn), ["submit_report", "outbox_claim", "outbox_mark"], "the report is stored before any email is attempted");
  assert.equal(calls[1].args.p_include_details, false);
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, "reviewers@example.org");
  assert.equal(mail.sent[0].idempotencyKey, "pride-report-7", "the provider is given a stable key so a repeat is dropped");
  assert.deepEqual(marks, [{ p_outbox_id: 7, p_ok: true, p_provider_message_id: "sandbox-1", p_error_category: null }]);
});

test("submit: when email fails the student still gets a receipt, and the failure is recorded for retry", async () => {
  for (const [label, mail, category] of [
    ["provider down", { name: "x", send: async () => { throw new MailError("provider_error", "500"); } }, "provider_error"],
    ["bad key", { name: "x", send: async () => { throw new MailError("auth", "401"); } }, "auth"],
    ["unexpected crash", { name: "x", send: async () => { throw new Error("boom"); } }, "provider_error"],
    ["no provider configured", null, "not_configured"]
  ]) {
    const { deps, marks } = outboxDeps([claimed()], { mail });
    const res = await handleSubmit(post(submission()), deps);
    assert.equal(res.status, 201, label);
    assert.equal((await res.json()).id, "PR-1046", label);
    assert.deepEqual(marks, [{ p_outbox_id: 7, p_ok: false, p_provider_message_id: null, p_error_category: category }], label);
  }
});

test("dispatch summary counts what happened to each claimed notification", async () => {
  const outcomes = { 1: "sent", 2: "queued", 3: "failed" };
  const { deps } = fakeDeps(async (fn, args) => {
    if (fn === "outbox_claim") return { data: [claimed({ outbox_id: 1 }), claimed({ outbox_id: 2 }), claimed({ outbox_id: 3 })], error: null };
    return { data: outcomes[args.p_outbox_id], error: null };
  }, { mail: { name: "x", send: async (m) => { if (m.idempotencyKey !== "pride-report-1") throw new MailError("rate_limited", "429"); return { id: "ok" }; } } });
  assert.deepEqual(await dispatchOutbox(deps, 10), { claimed: 3, sent: 1, requeued: 1, failed: 1 });
  const broken = fakeDeps(async () => ({ data: null, error: { message: "down" } }));
  assert.deepEqual(await dispatchOutbox(broken.deps, 10), { claimed: 0, sent: 0, requeued: 0, failed: 0 });
});

test("resend adapter: request shape, idempotency key, and error categories", async () => {
  const seen = [];
  const ok = resendProvider("re_test_key", async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }); });
  const result = await ok.send({ to: "reviewers@example.org", from: "Pride Line <r@example.org>", subject: "s", text: "t", idempotencyKey: "pride-report-7" });
  assert.equal(result.id, "msg_1");
  assert.equal(seen[0].url, "https://api.resend.com/emails");
  assert.equal(seen[0].init.headers.Authorization, "Bearer re_test_key");
  assert.equal(seen[0].init.headers["Idempotency-Key"], "pride-report-7");
  assert.deepEqual(JSON.parse(seen[0].init.body), { from: "Pride Line <r@example.org>", to: ["reviewers@example.org"], subject: "s", text: "t" });
  for (const [status, category] of [[401, "auth"], [403, "auth"], [429, "rate_limited"], [422, "invalid_request"], [500, "provider_error"]]) {
    const failing = resendProvider("k", async () => new Response("no", { status }));
    await assert.rejects(failing.send({ to: "a@example.org", from: "b", subject: "s", text: "t", idempotencyKey: "k" }), (e) => e instanceof MailError && e.category === category);
  }
  const offline = resendProvider("k", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(offline.send({ to: "a@example.org", from: "b", subject: "s", text: "t", idempotencyKey: "k" }), (e) => e.category === "network");
});

/* ---------- Protected endpoints ---------- */

const staff = (role, over = {}) => async () => ({ user_id: "00000000-0000-0000-0000-000000000001", role, is_staff: true, mfa_ok: true, ...over });

test("send-notifications: only the scheduled job's secret or an admin with a second factor may trigger it", async () => {
  const run = async (headers, extra) => (await handleDispatch(post({}, headers), fakeDeps(undefined, extra).deps)).status;
  assert.equal(await run({}), 403, "no credentials");
  assert.equal(await run({ "x-dispatch-secret": "wrong" }), 403);
  assert.equal(await run({ "x-dispatch-secret": "d".repeat(40) }), 200, "scheduled job");
  assert.equal(await run({ "x-dispatch-secret": "" }, { dispatchSecret: "" }), 403, "an unset secret never matches an empty header");
  assert.equal(await run({ authorization: "Bearer t" }, { verifyStaff: staff("admin") }), 200, "admin");
  assert.equal(await run({ authorization: "Bearer t" }, { verifyStaff: staff("reviewer") }), 403, "reviewer");
  assert.equal(await run({ authorization: "Bearer t" }, { verifyStaff: staff("admin", { mfa_ok: false }) }), 403, "admin without second factor");
  assert.equal(await run({ authorization: "Bearer t" }, { verifyStaff: staff("admin", { is_staff: false }) }), 403, "removed admin");
  assert.equal(await run({ authorization: "Bearer t" }, { verifyStaff: async () => null }), 403, "invalid token");
});

test("admin-users: only an admin with a second factor can invite, and input is validated", async () => {
  const invited = [];
  const extra = (verify) => ({ verifyStaff: verify, inviteUser: async (email) => { invited.push(email); return { user_id: "00000000-0000-0000-0000-000000000009" }; } });
  const body = { email: " New.Person@Example.org ", display_name: "New Person", role: "reviewer" };
  const run = async (b, verify, headers = { authorization: "Bearer t" }) => {
    const made = fakeDeps({ data: null, error: null }, extra(verify));
    const res = await handleAdminUsers(post(b, headers), made.deps);
    return { status: res.status, calls: made.calls };
  };
  for (const [label, verify, headers] of [["no token", staff("admin"), {}], ["reviewer", staff("reviewer")], ["advocate", staff("advocate")],
    ["admin without second factor", staff("admin", { mfa_ok: false })], ["removed admin", staff("admin", { is_staff: false })]]) {
    const r = await run(body, verify, headers);
    assert.equal(r.status, 403, label);
    assert.equal(r.calls.length, 0, label);
  }
  assert.equal(invited.length, 0, "nobody was invited by an unauthorized caller");

  const okRun = await run(body, staff("admin"));
  assert.equal(okRun.status, 201);
  assert.deepEqual(invited, ["new.person@example.org"]);
  assert.deepEqual(okRun.calls[0], { fn: "admin_upsert_staff", args: { p_actor: "00000000-0000-0000-0000-000000000001",
    p_user_id: "00000000-0000-0000-0000-000000000009", p_email: "new.person@example.org", p_display_name: "New Person", p_role: "reviewer" } });

  assert.equal((await run({ ...body, email: "nope" }, staff("admin"))).status, 400);
  assert.equal((await run({ ...body, display_name: "" }, staff("admin"))).status, 400);
  assert.equal((await run({ ...body, role: "owner" }, staff("admin"))).status, 400);
  assert.equal(invited.length, 1, "invalid requests invite nobody");
});

/* ---------- Earlier access codes ---------- */

test("track (earlier codes): view, message, and identical answers for wrong and malformed codes", async () => {
  assert.equal(normalizeCode(" pr 7k9m 2q4x h3tn "), "PR-7K9M-2Q4X-H3TN");
  for (const bad of ["", "PR-7K9M-2Q4X", "PR-0000-0000-0000", null, "x".repeat(100)]) assert.equal(normalizeCode(bad), null);

  const view = { id: "PR-1043", status: "in_review", messages: [] };
  const { deps, calls, mail } = fakeDeps({ data: view, error: null });
  let res = await handleTrack(post({ action: "view", code: "pr 7k9m 2q4x h3tn" }), deps);
  assert.equal(res.status, 200);
  assert.equal(calls[0].args.p_code_hash, await hmacHex(PEPPER, "code|PR-7K9M-2Q4X-H3TN"));
  res = await handleTrack(post({ action: "message", code: "PR-7K9M-2Q4X-H3TN", body: "  more detail " }), deps);
  assert.equal(calls[1].args.p_body, "more detail");
  assert.equal(mail.sent.length, 0);

  const notFound = fakeDeps({ data: { error: "not_found" }, error: null });
  assert.equal((await handleTrack(post({ action: "view", code: "PR-2222-2222-2222" }), notFound.deps)).status, 404);
  assert.equal((await handleTrack(post({ action: "view", code: "'; drop table reports; --" }), notFound.deps)).status, 404);
  assert.equal(notFound.calls.length, 2, "a malformed code is still counted by the rate limiter");
  assert.equal((await handleTrack(post({ action: "delete", code: "PR-7K9M-2Q4X-H3TN" }), deps)).status, 400);
});
