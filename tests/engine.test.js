import test from "node:test";
import assert from "node:assert/strict";
import { engineLib, flow, reply, incidentToReview } from "./helpers.js";

const fresh = (saved) => engineLib.createEngine(flow, saved);
const allNeeds = { needs: { values: ["advocate", "office", "support", "conflict"] } };

function everyLine() {
  const answers = { ...allNeeds, path: { value: "incident" }, contact_mode: { value: "portal" } };
  const out = [];
  for (const mode of ["demo", "email", "backend"]) {
    flow.context.mode = mode;
    flow.context.tracking = mode !== "email";
    for (const node of Object.values(flow.nodes)) {
      out.push(...(typeof node.say === "function" ? node.say(answers) : node.say || []));
      out.push(...(node.options || []).map((o) => o.label), ...(node.links || []).map((l) => l.label));
      if (node.placeholder) out.push(node.placeholder);
    }
  }
  flow.context.mode = "demo";
  flow.context.tracking = true;
  return out;
}

test("every branch leads to a node that exists", () => {
  const probes = [{}, { path: { value: "incident" } }, { path: { value: "concern" } }, allNeeds,
    { needs: { values: ["document"] } }, { needs: { values: ["conflict"] } },
    { contact_mode: { value: "identified" } }, { contact_mode: { value: "anonymous" } }];
  for (const [id, node] of Object.entries(flow.nodes)) {
    const targets = [];
    for (const option of node.options || []) if (option.next) targets.push(option.next);
    if (typeof node.next === "string") targets.push(node.next);
    if (typeof node.next === "function") {
      for (const answers of probes) { try { targets.push(node.next(answers)); } catch { /* probe doesn't apply */ } }
    }
    if (node.type !== "end") assert.ok(targets.length, `${id} has no way forward`);
    for (const target of targets) assert.ok(flow.nodes[target], `${id} points at missing node ${target}`);
  }
});

test("help comes first: the first question after the safety check is what we can do", () => {
  const e = fresh();
  reply(e, "continue");
  reply(e, "safe");
  assert.equal(e.id, "needs");
  assert.match(e.lines()[0], /^What can we do for you\?/);
  assert.deepEqual(e.node.options.slice(0, 4).map((o) => o.label),
    ["Advocate for me", "Help me with a University office", "Support me", "Help me resolve a conflict"]);
  assert.equal(e.answer({ values: [], labels: [] }).ok, false, "at least one choice is required");
});

test("each kind of help gets its own follow-up, in order, and only when chosen", () => {
  const walk = (needs) => {
    const e = fresh();
    reply(e, "continue"); reply(e, "safe"); reply(e, needs);
    const seen = [];
    while (e.id !== "path") { seen.push(e.id); reply(e, "skip"); }
    return seen;
  };
  assert.deepEqual(walk(["advocate", "office", "support", "conflict"]),
    ["advocate_consent", "office_which", "support_kind", "conflict_with", "conflict_contact"]);
  assert.deepEqual(walk(["conflict"]), ["conflict_with", "conflict_contact"]);
  assert.deepEqual(walk(["office", "document"]), ["office_which"]);
  assert.deepEqual(walk(["document"]), []);
  assert.deepEqual(walk(["unsure", "official"]), []);
});

test("every detail question can be skipped", () => {
  for (const id of ["advocate_consent", "office_which", "support_kind", "conflict_with", "conflict_contact", "category", "what",
    "when", "where", "who", "frequency", "role", "reported", "outcome", "timing", "anything_else", "contact_name", "contact_discreet"]) {
    assert.equal(flow.nodes[id].optional, true, `${id} must be optional`);
  }
});

test("the script never asks about the student's own identity", () => {
  const everything = everyLine().join(" ").toLowerCase();
  for (const phrase of ["your sexual orientation", "your gender identity", "are you gay", "are you trans", "your pronouns"]) {
    assert.ok(!everything.includes(phrase), `script contains "${phrase}"`);
  }
});

test("no em dashes anywhere in the script", () => {
  for (const line of everyLine()) assert.ok(!line.includes("\u2014"), line);
});

test("emergency contacts list University Public Safety before 911", () => {
  for (const choice of ["danger", "unsure"]) {
    const e = fresh();
    reply(e, "continue");
    reply(e, choice);
    assert.equal(e.id, "emergency");
    const text = e.lines().join(" ");
    assert.ok(text.indexOf("(203) 932-7070") !== -1 && text.indexOf("(203) 932-7070") < text.indexOf("911"), "Public Safety comes first");
    assert.match(text, /can’t call anyone/);
    assert.deepEqual(e.node.links.map((l) => l.label), ["Call Public Safety", "Call 911", "Call or text 988"]);
  }
});

test("incident path reaches review and produces the expected report", () => {
  const e = fresh();
  incidentToReview(e);
  assert.equal(e.id, "review");
  assert.deepEqual(flow.toReport(e.answers), {
    version: 2, needs: ["advocate", "support"], advocate_consent: { value: "without_name" }, office_which: null,
    support_kind: { value: "talk" }, conflict_with: null, conflict_contact: null, path: "incident",
    category: { value: "housing" }, what: "Fictional: something happened.", when: { value: "week" },
    where: { value: "residence" }, who: { value: "student" }, frequency: { value: "repeated" },
    role: { value: "experienced" }, reported: { value: "no" }, outcome: "Fictional: I want it to stop.",
    timing: { value: "days" }, anything_else: null, contact_mode: "portal", contact_name: null, contact_method: null,
    contact_discreet: null
  });
});

test("concern path skips the incident-only questions", () => {
  const e = fresh();
  const seen = [];
  for (const step of ["continue", "safe", ["office"], "records", "concern", "facilities", "My ID shows the wrong name.", "office", "ongoing", "skip", "none", "skip", "anonymous"]) {
    seen.push(e.id);
    reply(e, step);
  }
  assert.equal(e.id, "review");
  for (const id of ["when", "who", "role", "reported"]) assert.ok(!seen.includes(id), `${id} should not be asked`);
  const nodes = flow.summary(e.answers).map((r) => r.node);
  assert.ok(!nodes.includes("when") && !nodes.includes("who"));
  assert.ok(nodes.includes("office_which") && !nodes.includes("support_kind"));
});

test("a student can skip every optional question and still submit", () => {
  const e = fresh();
  for (const step of ["continue", "safe", ["document"], "incident", "skip", "skip", "skip", "skip", "skip", "skip", "skip", "skip", "skip", "skip", "skip", "anonymous"]) reply(e, step);
  assert.equal(e.id, "review");
  const report = flow.toReport(e.answers);
  assert.equal(report.what, null);
  assert.equal(report.category, null);
  assert.deepEqual(report.needs, ["document"]);
});

test("required questions cannot be skipped", () => {
  const e = fresh();
  assert.equal(e.answer({ skipped: true }).ok, false);
  assert.equal(e.id, "welcome");
});

test("typed answers: aliases, own words, and nudges", () => {
  const e = fresh();
  assert.deepEqual(e.interpret("  YES "), { answer: { value: "continue", label: "Yes, continue" } });
  assert.deepEqual(e.interpret("tell me a joke"), { error: "choose_option" });
  assert.deepEqual(e.interpret("   "), { error: "empty" });
  for (const step of ["continue", "safe", ["office"]]) reply(e, step);
  assert.equal(e.interpret("registrar").answer.value, "records");
  const office = e.interpret("The ID card office");
  assert.deepEqual(office.answer, { value: "other", label: "The ID card office", text: "The ID card office" });
  assert.equal(e.interpret("x".repeat(301)).error, "too_long");
  assert.ok(e.answer(office.answer).ok);
  reply(e, "incident");
  assert.equal(e.interpret("housing").answer.value, "housing");
  reply(e, "housing");
  assert.equal(e.interpret("y".repeat(4001)).error, "too_long");
  assert.deepEqual(flow.toReport(e.answers).office_which, { value: "other", text: "The ID card office" });
});

test("back undoes one answer at a time", () => {
  const e = fresh();
  for (const step of ["continue", "safe", ["document"], "incident", "housing"]) reply(e, step);
  assert.equal(e.id, "what");
  assert.ok(e.back());
  assert.equal(e.id, "category");
  assert.equal(e.answers.category, undefined);
  assert.ok(e.back());
  assert.equal(e.id, "path");
  assert.equal(e.answers.path, undefined);
});

test("editing from review returns to review and keeps other answers", () => {
  const e = fresh();
  incidentToReview(e);
  assert.ok(e.edit("where"));
  assert.equal(e.id, "where");
  reply(e, "online");
  assert.equal(e.id, "review");
  assert.equal(e.answers.where.value, "online");
  assert.equal(e.answers.who.value, "student");
});

test("changing what you need asks the new follow-ups and forgets the old ones", () => {
  const e = fresh();
  incidentToReview(e);
  e.edit("needs");
  reply(e, ["conflict"]);
  assert.equal(e.id, "conflict_with");
  reply(e, "roommate");
  assert.equal(e.id, "conflict_contact");
  reply(e, "ask_first");
  assert.equal(e.id, "review");
  const report = flow.toReport(e.answers);
  assert.deepEqual(report.needs, ["conflict"]);
  assert.equal(report.advocate_consent, null);
  assert.equal(report.support_kind, null);
  assert.deepEqual(report.conflict_contact, { value: "ask_first" });
  assert.equal(report.what, "Fictional: something happened.", "the rest of the report is untouched");
});

test("switching from incident to general concern drops incident-only answers", () => {
  const e = fresh();
  incidentToReview(e);
  e.edit("path");
  reply(e, "concern");
  assert.equal(e.id, "review");
  const report = flow.toReport(e.answers);
  for (const field of ["when", "who", "role", "reported"]) assert.equal(report[field], null, field);
  assert.deepEqual(report.where, { value: "residence" });
});

test("identified asks for contact details and discretion; switching away removes them", () => {
  const e = fresh();
  incidentToReview(e);
  e.edit("contact_mode");
  reply(e, "identified");
  assert.equal(e.id, "contact_name");
  reply(e, "Sam");
  assert.equal(e.id, "contact_method");
  assert.equal(e.answer({ skipped: true }).ok, false, "contact method is required once identified");
  reply(e, "sam@example.com");
  assert.equal(e.id, "contact_discreet");
  reply(e, "discreet");
  assert.equal(e.id, "review");
  assert.deepEqual(flow.toReport(e.answers).contact_discreet, { value: "discreet" });

  e.edit("contact_mode");
  reply(e, "anonymous");
  assert.equal(e.id, "review");
  const report = flow.toReport(e.answers);
  assert.equal(report.contact_name, null);
  assert.equal(report.contact_method, null);
  assert.equal(report.contact_discreet, null);
  assert.ok(!flow.summary(e.answers).some((r) => r.node === "contact_name"));

  e.back();
  e.back();
  assert.equal(e.id, "review");
  assert.equal(e.answers.contact_name.text, "Sam", "undo restores the removed details");
});

test("email mode has no private follow-up option and says so", () => {
  flow.context.mode = "email";
  flow.context.tracking = false;
  try {
    const e = fresh();
    for (const step of ["continue", "safe", ["support"], "talk", "concern", "skip", "skip", "skip", "skip", "skip", "skip", "skip"]) reply(e, step);
    assert.equal(e.id, "contact_mode");
    assert.deepEqual(e.node.options.map((o) => o.value), ["anonymous", "identified"]);
    assert.equal(e.answer({ value: "portal", label: "Private follow-up on this site" }).ok, false);
    const text = e.lines().join(" ");
    assert.match(text, /no way to reply/);
    assert.match(text, /needs a way to reach you/);
    assert.ok(!/access code/.test(text));
  } finally {
    flow.context.mode = "demo";
    flow.context.tracking = true;
  }
});

test("cancelling an edit with back leaves answers untouched", () => {
  const e = fresh();
  incidentToReview(e);
  e.edit("what");
  assert.ok(e.back());
  assert.equal(e.id, "review");
  assert.equal(e.answers.what.text, "Fictional: something happened.");
});

test("a saved draft resumes where it left off", () => {
  const e = fresh();
  for (const step of ["continue", "safe", ["document"], "incident", "housing"]) reply(e, step);
  const resumed = fresh(JSON.parse(JSON.stringify(e.snapshot())));
  assert.equal(resumed.id, "what");
  assert.equal(resumed.answers.category.value, "housing");
  assert.equal(fresh({ current: "no_such_node", answers: {}, trail: [] }).id, "welcome");
});

test("describeReport gives readable rows and leaves out what was skipped", () => {
  const e = fresh();
  incidentToReview(e);
  const rows = flow.describeReport(flow.toReport(e.answers));
  assert.deepEqual(rows[0], ["What we can do for you", "Advocate for me, Support me"]);
  assert.deepEqual(rows[1], ["How to advocate", "Raise it without naming me"]);
  const labels = rows.map((r) => r[0]);
  assert.ok(labels.includes("A good outcome") && labels.includes("Deadline or date"));
  assert.ok(!labels.includes("Anything else") && !labels.includes("Office or service") && !labels.includes("Name"));
  assert.ok(!flow.describeReport(flow.toReport(e.answers), { contact: false }).some((r) => r[0] === "Submitted as"));
});

test("crisis language is detected, ordinary reports are not", () => {
  for (const text of ["I want to kill myself", "i've been feeling suicidal", "I don't want to be here anymore", "thinking about self-harm"]) {
    assert.ok(flow.detectCrisis(text), text);
  }
  for (const text of ["My roommate keeps misgendering me", "They said they'd kill the mood", "It hurt to hear that", ""]) {
    assert.ok(!flow.detectCrisis(text), text);
  }
});
