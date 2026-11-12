import test from "node:test";
import assert from "node:assert/strict";
import { engineLib, flow, reply, incidentToReview } from "./helpers.js";

const fresh = (saved) => engineLib.createEngine(flow, saved);

test("every branch leads to a node that exists", () => {
  const probes = [{}, { path: { value: "incident" } }, { path: { value: "concern" } },
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

test("every incident-detail question can be skipped", () => {
  for (const id of ["category", "what", "when", "where", "who", "frequency", "role", "reported", "anything_else", "wants", "contact_name"]) {
    assert.equal(flow.nodes[id].optional, true, `${id} must be optional`);
  }
});

test("the script never asks about the student's own identity", () => {
  const everything = Object.values(flow.nodes).flatMap((n) =>
    (typeof n.say === "function" ? n.say({ path: { value: "incident" }, contact_mode: { value: "portal" } }) : n.say || [])
      .concat((n.options || []).map((o) => o.label))).join(" ").toLowerCase();
  for (const phrase of ["your sexual orientation", "your gender identity", "are you gay", "are you trans", "your pronouns"]) {
    assert.ok(!everything.includes(phrase), `script contains "${phrase}"`);
  }
});

test("incident path reaches review and produces the expected report", () => {
  const e = fresh();
  incidentToReview(e);
  assert.equal(e.id, "review");
  assert.deepEqual(flow.toReport(e.answers), {
    version: 1, path: "incident", category: { value: "housing" }, what: "Fictional: something happened.",
    when: { value: "week" }, where: { value: "residence" }, who: { value: "student" }, frequency: { value: "repeated" },
    role: { value: "experienced" }, reported: { value: "no" }, anything_else: null, wants: ["document", "reply"],
    contact_mode: "portal", contact_name: null, contact_method: null
  });
});

test("concern path skips the incident-only questions", () => {
  const e = fresh();
  const seen = [];
  for (const step of ["continue", "safe", "concern", "facilities", "No all-gender restroom nearby.", "athletics", "ongoing", "skip", "skip", "anonymous"]) {
    seen.push(e.id);
    reply(e, step);
  }
  assert.equal(e.id, "review");
  for (const id of ["when", "who", "role", "reported"]) assert.ok(!seen.includes(id), `${id} should not be asked`);
  const labels = flow.summary(e.answers).map((r) => r.node);
  assert.ok(!labels.includes("when") && !labels.includes("who"));
});

test("a student can skip every optional question and still submit", () => {
  const e = fresh();
  for (const step of ["continue", "safe", "incident", "skip", "skip", "skip", "skip", "skip", "skip", "skip", "skip", "skip", "skip", "anonymous"]) reply(e, step);
  assert.equal(e.id, "review");
  const report = flow.toReport(e.answers);
  assert.equal(report.what, null);
  assert.equal(report.category, null);
  assert.deepEqual(report.wants, []);
});

test("required questions cannot be skipped", () => {
  const e = fresh();
  assert.equal(e.answer({ skipped: true }).ok, false);
  assert.equal(e.id, "welcome");
});

test("danger answers show emergency information before anything else", () => {
  for (const choice of ["danger", "unsure"]) {
    const e = fresh();
    reply(e, "continue");
    reply(e, choice);
    assert.equal(e.id, "emergency");
    const text = e.lines().join(" ");
    assert.match(text, /911/);
    assert.match(text, /\(203\) 932-7070/);
    assert.match(text, /can’t call anyone/);
  }
});

test("typed answers: aliases, own words, and nudges", () => {
  const e = fresh();
  assert.deepEqual(e.interpret("  YES "), { answer: { value: "continue", label: "Yes, continue" } });
  assert.deepEqual(e.interpret("tell me a joke"), { error: "choose_option" });
  assert.deepEqual(e.interpret("   "), { error: "empty" });
  for (const step of ["continue", "safe", "incident"]) reply(e, step);
  assert.equal(e.interpret("housing").answer.value, "housing");
  const own = e.interpret("Something that doesn't fit your list");
  assert.deepEqual(own.answer, { value: "other", label: "Something that doesn't fit your list", text: "Something that doesn't fit your list" });
  assert.equal(e.interpret("x".repeat(301)).error, "too_long");
  assert.ok(e.answer(own.answer).ok);
  assert.equal(e.interpret("y".repeat(4001)).error, "too_long");
  assert.deepEqual(flow.toReport(e.answers).category, { value: "other", text: "Something that doesn't fit your list" });
});

test("back undoes one answer at a time", () => {
  const e = fresh();
  for (const step of ["continue", "safe", "incident", "housing"]) reply(e, step);
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

test("switching to identified asks for contact details, switching away removes them", () => {
  const e = fresh();
  incidentToReview(e);
  e.edit("contact_mode");
  reply(e, "identified");
  assert.equal(e.id, "contact_name");
  reply(e, "Sam");
  assert.equal(e.id, "contact_method");
  assert.equal(e.answer({ skipped: true }).ok, false, "contact method is required once identified");
  reply(e, "sam@example.com");
  assert.equal(e.id, "review");
  assert.equal(flow.toReport(e.answers).contact_method, "sam@example.com");

  e.edit("contact_mode");
  reply(e, "anonymous");
  assert.equal(e.id, "review");
  const report = flow.toReport(e.answers);
  assert.equal(report.contact_name, null);
  assert.equal(report.contact_method, null);
  assert.ok(!flow.summary(e.answers).some((r) => r.node === "contact_name"));

  e.back();
  e.back();
  assert.equal(e.id, "review");
  assert.equal(e.answers.contact_name.text, "Sam", "undo restores the removed details");
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
  for (const step of ["continue", "safe", "incident", "housing"]) reply(e, step);
  const resumed = fresh(JSON.parse(JSON.stringify(e.snapshot())));
  assert.equal(resumed.id, "what");
  assert.equal(resumed.answers.category.value, "housing");
  assert.equal(fresh({ current: "no_such_node", answers: {}, trail: [] }).id, "welcome");
});

test("support and follow-up paths end without a report", () => {
  for (const path of ["support", "followup"]) {
    const e = fresh();
    for (const step of ["continue", "safe", path, "done"]) reply(e, step);
    assert.equal(e.id, "bye");
    assert.equal(e.node.type, "end");
  }
});

test("crisis language is detected, ordinary reports are not", () => {
  for (const text of ["I want to kill myself", "i've been feeling suicidal", "I don't want to be here anymore", "thinking about self-harm"]) {
    assert.ok(flow.detectCrisis(text), text);
  }
  for (const text of ["My roommate keeps misgendering me", "They said they'd kill the mood", "It hurt to hear that", ""]) {
    assert.ok(!flow.detectCrisis(text), text);
  }
});
