import test from "node:test";
import assert from "node:assert/strict";
import { generateCode, normalizeCode, hmacHex, validateReport, validateMessage, reportToText, CODE_ALPHABET } from "../supabase/functions/_shared/validate.ts";
import { handleSubmit, handleTrack } from "../supabase/functions/_shared/handlers.ts";

const ORIGIN = "https://example.github.io";
const PEPPER = "p".repeat(48);
const good = () => ({
  version: 2, needs: ["advocate", "support"], advocate_consent: { value: "without_name" }, office_which: null,
  support_kind: { value: "talk" }, conflict_with: null, conflict_contact: null, path: "incident",
  category: { value: "housing" }, what: "Fictional report text.", when: { value: "week" }, where: { value: "residence" },
  who: { value: "student" }, frequency: { value: "repeated" }, role: { value: "experienced" }, reported: { value: "no" },
  outcome: "Fictional outcome wanted.", timing: { value: "days" }, anything_else: null,
  contact_mode: "portal", contact_name: null, contact_method: null, contact_discreet: null
});
const identified = () => ({ ...good(), contact_mode: "identified", contact_name: "Sam", contact_method: "sam@example.com", contact_discreet: { value: "discreet" } });

function fakeDeps(result = { data: { id: "PR-1043" }, error: null }, extra = {}) {
  const calls = [];
  return {
    calls,
    deps: { rpc: async (fn, args) => { calls.push({ fn, args }); return typeof result === "function" ? result(fn, args) : result; },
      pepper: PEPPER, allowedOrigin: ORIGIN, now: () => new Date("2026-11-12T12:00:00Z"), ...extra }
  };
}
function post(body, headers = {}) {
  return new Request("https://project.supabase.co/functions/v1/x", {
    method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "203.0.113.7, 10.0.0.1", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}
const meta = { hp: "", elapsed_ms: 60000 };

test("validateReport accepts a good report and strips unknown fields", () => {
  const result = validateReport({ ...good(), is_admin: true, status: "closed" });
  assert.ok(result.ok);
  assert.deepEqual(result.value, good());
});

test("validateReport rejects bad input", () => {
  const cases = {
    "not an object": "text", "array": [], "old version": { ...good(), version: 1 },
    "unknown path": { ...good(), path: "support" }, "unknown category": { ...good(), category: { value: "guilty" } },
    "free text where not allowed": { ...good(), who: { value: "other", text: "A named person" } },
    "empty free text": { ...good(), category: { value: "other", text: "  " } },
    "long free text": { ...good(), where: { value: "other", text: "x".repeat(301) } },
    "long narrative": { ...good(), what: "x".repeat(4001) }, "non-string narrative": { ...good(), what: { $ne: null } },
    "long outcome": { ...good(), outcome: "x".repeat(2001) },
    "unknown need": { ...good(), needs: ["discipline"] }, "needs not a list": { ...good(), needs: "advocate" },
    "no needs": { ...good(), needs: [] }, "missing needs": { ...good(), needs: undefined },
    "unknown advocacy consent": { ...good(), advocate_consent: { value: "do_anything" } },
    "unknown contact mode": { ...good(), contact_mode: "public" },
    "identified without contact": { ...good(), contact_mode: "identified", contact_name: "Sam" },
    "long contact": { ...good(), contact_mode: "identified", contact_method: "x".repeat(201) }
  };
  for (const [label, input] of Object.entries(cases)) assert.equal(validateReport(input).ok, false, label);
});

test("validateReport keeps only what belongs: contact details, follow-ups and incident answers", () => {
  const anon = validateReport({ ...identified(), contact_mode: "anonymous" });
  assert.equal(anon.value.contact_name, null);
  assert.equal(anon.value.contact_method, null);
  assert.equal(anon.value.contact_discreet, null);
  assert.deepEqual(validateReport(identified()).value, identified());

  const concern = validateReport({ ...good(), path: "concern" });
  assert.equal(concern.value.who, null);
  assert.equal(concern.value.when, null);

  // Follow-up answers for help that wasn't requested are discarded.
  const stray = validateReport({ ...good(), needs: ["document"], office_which: { value: "housing" }, conflict_contact: { value: "ok" } });
  assert.equal(stray.value.advocate_consent, null);
  assert.equal(stray.value.office_which, null);
  assert.equal(stray.value.conflict_contact, null);

  const tidy = validateReport({ ...good(), what: "  line one\u0000\u0007\nline two  ", needs: ["support", "advocate", "support"] });
  assert.equal(tidy.value.what, "line one\nline two");
  assert.deepEqual(tidy.value.needs, ["advocate", "support"]);
});

test("reportToText is readable and skips unanswered questions", () => {
  const text = reportToText(validateReport(identified()).value);
  assert.match(text, /^What we can do for you: advocate, support$/m);
  assert.match(text, /^How to advocate: without name$/m);
  assert.match(text, /^In their words:\nFictional report text\.$/m);
  assert.match(text, /^Contact: sam@example\.com$/m);
  assert.match(text, /^OK to mention Pride Report: discreet$/m);
  assert.ok(!text.includes("Office or service") && !text.includes("Anything else") && !text.includes("null"));
});

test("validateMessage", () => {
  assert.equal(validateMessage("  hello ").value, "hello");
  for (const bad of ["", "   ", null, 42, "x".repeat(4001)]) assert.equal(validateMessage(bad).ok, false);
});

test("access codes: format, alphabet, uniqueness, normalization", () => {
  const seen = new Set();
  const counts = {};
  for (let i = 0; i < 5000; i++) {
    const code = generateCode();
    assert.match(code, /^PR-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(normalizeCode(code), code);
    seen.add(code);
    for (const ch of code.slice(3).replace(/-/g, "")) counts[ch] = (counts[ch] || 0) + 1;
  }
  assert.equal(seen.size, 5000);
  assert.equal(Object.keys(counts).length, CODE_ALPHABET.length, "every symbol is used");
  const expected = (5000 * 12) / CODE_ALPHABET.length;
  for (const [ch, n] of Object.entries(counts)) assert.ok(Math.abs(n - expected) < expected * 0.15, `symbol ${ch} is skewed: ${n}`);

  assert.equal(normalizeCode(" pr 7k9m 2q4x h3tn "), "PR-7K9M-2Q4X-H3TN");
  assert.equal(normalizeCode("7K9M2Q4XH3TN"), "PR-7K9M-2Q4X-H3TN");
  for (const bad of ["", "PR-7K9M-2Q4X", "PR-0000-0000-0000", "PR-7K9M-2Q4X-H3TL", null, 12, "x".repeat(100)]) assert.equal(normalizeCode(bad), null);
});

test("hmacHex matches a known HMAC-SHA-256 vector", async () => {
  // RFC 4231 test case 2.
  assert.equal(await hmacHex("Jefe", "what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
});

test("submit: stores a keyed hash of the code, never the code or the IP", async () => {
  const { deps, calls } = fakeDeps();
  const res = await handleSubmit(post({ report: good(), meta }), deps);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.id, "PR-1043");
  assert.equal(normalizeCode(body.code), body.code);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(res.headers.get("cache-control"), "no-store");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, "submit_report");
  assert.equal(calls[0].args.p_code_hash, await hmacHex(PEPPER, "code|" + body.code));
  assert.deepEqual(calls[0].args.p_report, good());
  const sent = JSON.stringify(calls[0].args);
  assert.ok(!sent.includes(body.code), "plain code must not reach the database");
  assert.ok(!sent.includes("203.0.113.7"), "raw IP must not reach the database");
  assert.match(calls[0].args.p_bucket, /^[0-9a-f]{64}$/);
});

test("submit: the rate-limit bucket follows the IP and rotates daily", async () => {
  const run = async (ip, day) => {
    const { deps, calls } = fakeDeps(undefined, { now: () => new Date(day) });
    await handleSubmit(post({ report: good(), meta }, { "x-forwarded-for": ip }), deps);
    return calls[0].args.p_bucket;
  };
  const a = await run("203.0.113.7", "2026-11-12T01:00:00Z");
  assert.equal(a, await run("203.0.113.7", "2026-11-12T23:00:00Z"));
  assert.notEqual(a, await run("203.0.113.8", "2026-11-12T01:00:00Z"));
  assert.notEqual(a, await run("203.0.113.7", "2026-11-13T01:00:00Z"));
});

test("submit: rejects bots, bad origins, bad methods, oversized and malformed bodies", async () => {
  const check = async (req, status, error, depsOverride) => {
    const { deps, calls } = depsOverride || fakeDeps();
    const res = await handleSubmit(req, deps);
    assert.equal(res.status, status, error);
    if (error) assert.equal((await res.json()).error, error);
    assert.equal(calls.length, 0, `${error}: database must not be called`);
  };
  await check(post({ report: good(), meta: { hp: "http://spam.example", elapsed_ms: 60000 } }), 400, "rejected");
  await check(post({ report: good(), meta: { hp: "", elapsed_ms: 200 } }), 400, "rejected");
  await check(post({ report: good() }), 400, "rejected");
  await check(post({ report: good(), meta }, { origin: "https://evil.example" }), 403, "forbidden_origin");
  await check(post({ report: { ...good(), category: { value: "nope" } }, meta }), 400, "invalid_report");
  await check(post("{not json"), 400, "invalid_json");
  await check(post("[1,2,3]"), 400, "invalid_json");
  await check(post({ report: { ...good(), what: "x".repeat(40000) }, meta }), 413, "too_large");
  await check(new Request("https://x/y", { method: "GET", headers: { origin: ORIGIN } }), 405, "method_not_allowed");
  await check(new Request("https://x/y", { method: "OPTIONS", headers: { origin: ORIGIN } }), 204, null);
  await check(post({ report: good(), meta }), 500, "server_not_configured", fakeDeps(undefined, { pepper: "short" }));
  await check(post({ report: good(), meta }), 500, "server_not_configured", fakeDeps(undefined, { allowedOrigin: "" }));
});

test("submit: database outcomes map to HTTP statuses without leaking details", async () => {
  let res = await handleSubmit(post({ report: good(), meta }), fakeDeps({ data: { error: "rate_limited" }, error: null }).deps);
  assert.equal(res.status, 429);
  res = await handleSubmit(post({ report: good(), meta }), fakeDeps({ data: null, error: { message: "relation private.reports does not exist" } }).deps);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "server_error" });
});

test("submit: the reviewer notification contains the reference number and nothing from the report", async () => {
  const sent = [];
  const { deps } = fakeDeps(undefined, { notifyWebhookUrl: "https://hooks.example/abc", fetch: async (url, init) => { sent.push({ url, init }); return new Response("ok"); } });
  const res = await handleSubmit(post({ report: good(), meta }), deps);
  const { code } = await res.json();
  assert.equal(sent.length, 1);
  assert.match(sent[0].init.body, /PR-1043/);
  for (const secret of [code, "Fictional report text", "housing", "203.0.113.7"]) assert.ok(!sent[0].init.body.includes(secret), secret);

  const failing = fakeDeps(undefined, { notifyWebhookUrl: "https://hooks.example/abc", fetch: async () => { throw new Error("down"); } });
  assert.equal((await handleSubmit(post({ report: good(), meta }), failing.deps)).status, 201, "a failed notification must not fail the submission");
});

test("track: view and message", async () => {
  const view = { id: "PR-1043", status: "received", messages: [] };
  const { deps, calls } = fakeDeps({ data: view, error: null });
  let res = await handleTrack(post({ action: "view", code: "pr 7k9m 2q4x h3tn" }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), view);
  assert.equal(calls[0].fn, "track_view");
  assert.equal(calls[0].args.p_code_hash, await hmacHex(PEPPER, "code|PR-7K9M-2Q4X-H3TN"));

  res = await handleTrack(post({ action: "message", code: "PR-7K9M-2Q4X-H3TN", body: "  more detail " }), deps);
  assert.equal(res.status, 200);
  assert.equal(calls[1].fn, "track_message");
  assert.equal(calls[1].args.p_body, "more detail");

  res = await handleTrack(post({ action: "message", code: "PR-7K9M-2Q4X-H3TN", body: "" }), deps);
  assert.equal(res.status, 400);
  res = await handleTrack(post({ action: "delete", code: "PR-7K9M-2Q4X-H3TN" }), deps);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 2);
});

test("track: wrong, malformed and rate-limited lookups", async () => {
  const notFound = fakeDeps({ data: { error: "not_found" }, error: null });
  let res = await handleTrack(post({ action: "view", code: "PR-2222-2222-2222" }), notFound.deps);
  assert.equal(res.status, 404);
  // A malformed code is still counted by the rate limiter and gets the same answer as an unknown one.
  res = await handleTrack(post({ action: "view", code: "'; drop table reports; --" }), notFound.deps);
  assert.equal(res.status, 404);
  assert.equal(notFound.calls.length, 2);
  assert.match(notFound.calls[1].args.p_code_hash, /^[0-9a-f]{64}$/);

  res = await handleTrack(post({ action: "view", code: "PR-2222-2222-2222" }), fakeDeps({ data: { error: "rate_limited" }, error: null }).deps);
  assert.equal(res.status, 429);
  res = await handleTrack(post({ action: "message", code: "PR-2222-2222-2222", body: "hi" }), fakeDeps({ data: { error: "messaging_disabled" }, error: null }).deps);
  assert.equal(res.status, 409);
});

const emailDeps = (extra = {}, includeDetails = true) => {
  const sent = [];
  const made = fakeDeps(undefined, {
    email: { resendApiKey: "re_test_key", to: ["reviewers@example.org"], from: "Pride Report <reports@example.org>", includeDetails },
    fetch: async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); },
    ...extra
  });
  return { ...made, sent };
};

test("email: a new report is emailed to reviewers in full, with a detail-free subject", async () => {
  const { deps, sent } = emailDeps();
  const res = await handleSubmit(post({ report: identified(), meta }), deps);
  assert.equal(res.status, 201);
  const { code } = await res.json();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.equal(sent[0].init.headers.Authorization, "Bearer re_test_key");
  const mail = sent[0].body;
  assert.deepEqual(mail.to, ["reviewers@example.org"]);
  assert.equal(mail.from, "Pride Report <reports@example.org>");
  assert.equal(mail.subject, "New Pride Report PR-1043");
  assert.equal(mail.reply_to, "sam@example.com");
  assert.match(mail.text, /asking for help, so a reply is needed/);
  assert.match(mail.text, /Fictional report text\./);
  assert.match(mail.text, /OK to mention Pride Report: discreet/);
  assert.ok(!mail.text.includes(code), "the access code is never emailed");
  assert.ok(!mail.text.includes("\u2014"));
});

test("email: details can be switched off, leaving only the reference number", async () => {
  const { deps, sent } = emailDeps({}, false);
  await handleSubmit(post({ report: identified(), meta }), deps);
  const mail = sent[0].body;
  assert.match(mail.text, /PR-1043/);
  assert.equal(mail.reply_to, undefined);
  for (const secret of ["Fictional report text", "sam@example.com", "Sam", "housing"]) assert.ok(!mail.text.includes(secret), secret);
});

test("email: no reply-to unless the student gave an email address; document-only reports say so", async () => {
  const { deps, sent } = emailDeps();
  await handleSubmit(post({ report: { ...identified(), contact_method: "203-555-0100" }, meta }), deps);
  assert.equal(sent[0].body.reply_to, undefined);
  await handleSubmit(post({ report: { ...good(), needs: ["document"] }, meta }), deps);
  assert.match(sent[1].body.text, /did not ask for direct help/);
});

test("email: a failing or missing mail service never fails the submission", async () => {
  const down = emailDeps({ fetch: async () => { throw new Error("mail down"); } });
  assert.equal((await handleSubmit(post({ report: good(), meta }), down.deps)).status, 201);
  const rejected = emailDeps({ fetch: async () => new Response("bad key", { status: 401 }) });
  assert.equal((await handleSubmit(post({ report: good(), meta }), rejected.deps)).status, 201);
  const none = fakeDeps(undefined, { fetch: async () => { throw new Error("should not be called"); } });
  assert.equal((await handleSubmit(post({ report: good(), meta }), none.deps)).status, 201);
});

test("email: a student message alerts reviewers, with the text only when details are on", async () => {
  const run = async (includeDetails) => {
    const sent = [];
    const { deps } = fakeDeps({ data: { id: "PR-1043", status: "under_review", messages: [] }, error: null }, {
      email: { resendApiKey: "k", to: ["reviewers@example.org"], from: "x@example.org", includeDetails },
      fetch: async (url, init) => { sent.push(JSON.parse(init.body)); return new Response("{}"); }
    });
    const res = await handleTrack(post({ action: "message", code: "PR-7K9M-2Q4X-H3TN", body: "private follow-up text" }), deps);
    assert.equal(res.status, 200);
    await handleTrack(post({ action: "view", code: "PR-7K9M-2Q4X-H3TN" }), deps);
    assert.equal(sent.length, 1, "viewing a report sends nothing");
    assert.equal(sent[0].subject, "New message on Pride Report PR-1043");
    return sent[0].text;
  };
  assert.ok((await run(true)).includes("private follow-up text"));
  assert.ok(!(await run(false)).includes("private follow-up text"));
});
