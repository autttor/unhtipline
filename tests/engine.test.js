import test from "node:test";
import assert from "node:assert/strict";
import { engineLib, flow, reply, walk, WALKS } from "./helpers.js";

const fresh = (saved) => engineLib.createEngine(flow, saved);
const BRANCHES = Object.keys(WALKS);
const PREFIX = { report: "a_", office: "b_", peer: "c_", advocate: "d_", info: "e_", other: "f_" };

function everyLine() {
  const out = [];
  const probes = [{}, { help: { value: "office" } }, { help: { value: "advocate" } }, { help: { value: "peer" } }];
  for (const preview of [true, false]) {
    for (const on of [true, false]) {
      flow.context.preview = preview;
      flow.context.services = { PEER_SUPPORT: on, ADVOCACY: on, ACCOMPANIMENT: on };
      for (const node of Object.values(flow.nodes)) {
        for (const a of probes) out.push(...(typeof node.say === "function" ? node.say(a) : node.say || []));
        out.push(...(node.options || []).flatMap((o) => [o.label, o.desc || ""]), ...(node.links || []).map((l) => l.label));
        if (node.placeholder) out.push(node.placeholder);
      }
    }
  }
  flow.context.preview = true;
  flow.context.services = { PEER_SUPPORT: false, ADVOCACY: false, ACCOMPANIMENT: false };
  return out;
}

/* ---------- The fixed order ---------- */

test("the first screen says student-run, unaffiliated, not 24/7, not an emergency service, and asks about safety", () => {
  const e = fresh();
  assert.equal(e.id, "intro");
  const text = e.lines().join(" ");
  assert.match(text, /run by students/);
  assert.match(text, /not affiliated with, operated by, or endorsed by the University of New Haven/);
  assert.match(text, /not monitored 24\/7/);
  assert.match(text, /not an emergency service/);
  assert.match(text, /not an official University report/);
  assert.match(text, /can’t guarantee full anonymity or confidentiality/);
  assert.equal(e.lines().at(-1), "Are you safe right now?");
  assert.deepEqual(e.node.options.map((o) => o.label), ["Yes", "No", "I’m not sure"]);
});

test("safe = yes leads straight to exactly \"How can we help?\" with the report option first and primary", () => {
  const e = fresh();
  reply(e, "yes");
  assert.equal(e.id, "help");
  assert.deepEqual(e.lines(), ["How can we help?"]);
  assert.deepEqual(e.node.options.map((o) => o.label), [
    "I need to report something",
    "I need help with a University office",
    "I need peer support",
    "I need an advocate / someone to help me speak up",
    "I need information or resources",
    "Something else / I’m not sure"
  ]);
  assert.deepEqual(e.node.options.map((o) => !!o.primary), [true, false, false, false, false, false]);
  for (const o of e.node.options) assert.ok(o.desc && o.desc.length > 10, `${o.value} needs a description`);
});

for (const branch of BRANCHES) {
  test(`order for "${branch}": intro, help, its own questions, contact, privacy, permission, review`, () => {
    const e = fresh();
    const asked = walk(e, branch);
    assert.equal(asked[0], "intro");
    assert.equal(asked[1], "help");
    assert.equal(asked.at(-1), "review", `ended at ${asked.at(-1)}`);

    const contact = asked.indexOf("contact_want");
    const privacy = asked.indexOf("privacy");
    assert.ok(contact > 2, "contact comes after the branch questions");
    assert.ok(privacy > contact, "the privacy notice comes after the contact question");

    // Between "help" and "contact" only this branch's own questions are asked.
    const own = asked.slice(2, contact);
    assert.ok(own.length >= 2, "the branch asks its own questions");
    for (const id of own) assert.ok(id.startsWith(PREFIX[branch]), `${id} does not belong to the ${branch} branch`);

    // After the privacy notice: optional permission question, then review. Nothing else.
    const tail = asked.slice(privacy + 1);
    assert.ok(tail.every((id) => ["consent", "consent_scope", "review"].includes(id)), `unexpected step after privacy: ${tail}`);
    if (asked.includes("consent")) assert.ok(asked.indexOf("consent") > privacy, "permission is asked after the privacy notice");
    assert.equal(e.node.type, "review");
  });
}

test("the six branches ask different questions", () => {
  const seen = BRANCHES.map((b) => walk(fresh(), b).filter((id) => /^[a-f]_/.test(id)).join(","));
  assert.equal(new Set(seen).size, BRANCHES.length);
});

test("nothing is submitted without the review step: review is the only way to the receipt", () => {
  const leadsToSubmitted = Object.entries(flow.nodes).filter(([, n]) => n.next === "submitted" || (n.options || []).some((o) => o.next === "submitted"));
  assert.deepEqual(leadsToSubmitted.map(([id]) => id), ["review"]);
  const e = fresh();
  walk(e, "peer");
  assert.equal(e.answer({ skipped: true }).ok, false, "review cannot be skipped");
  assert.equal(e.answer({ confirmed: false }).ok, false, "review needs an explicit confirmation");
  assert.ok(e.answer({ confirmed: true }).ok);
  assert.equal(e.id, "submitted");
});

/* ---------- Danger branch ---------- */

for (const choice of ["no", "unsure"]) {
  test(`safe = ${choice}: emergency resources, no dispatch claim, acknowledge to continue, and an exit`, () => {
    const e = fresh();
    reply(e, choice);
    assert.equal(e.id, "emergency");
    const text = e.lines().join(" ");
    assert.match(text, /cannot call anyone or send help/);
    assert.ok(text.indexOf("(203) 932-7070") !== -1 && text.indexOf("(203) 932-7070") < text.indexOf("911"), "Public Safety comes before 911");
    assert.match(text, /988/);
    assert.match(text, /don’t need to tell us anything/);
    assert.deepEqual(e.node.links.map((l) => l.label), ["Call Public Safety", "Call 911", "Call or text 988", "Leave this site now"]);
    assert.equal(e.node.links.at(-1).action, "exit");
    assert.equal(e.node.type, "choice", "the student is not asked to describe the danger");
    assert.match(e.node.options[0].label, /^I understand this can’t send help/);
    reply(e, "continue");
    assert.equal(e.id, "help");
    assert.equal(flow.toReport(e.answers).safe, choice, "the safety answer is kept so reviewers see it");
  });
}

test("the danger screen can also end the conversation without sending anything", () => {
  const e = fresh();
  reply(e, "no");
  reply(e, "stop");
  assert.equal(e.id, "bye");
  assert.equal(e.node.type, "end");
  assert.ok(!e.node.receipt);
});

test("writing about a threat or self-harm, or choosing the safety category, raises an alert at once", () => {
  assert.equal(flow.alertFor(flow.nodes.a_what, { text: "I want to kill myself" }), "crisis");
  assert.equal(flow.alertFor(flow.nodes.a_what, { text: "He threatened to hurt me after class" }), "danger");
  assert.equal(flow.alertFor(flow.nodes.a_what, { text: "I'm afraid for my safety" }), "danger");
  assert.equal(flow.alertFor(flow.nodes.a_categories, { values: ["housing", "safety"] }), "danger");
  assert.equal(flow.alertFor(flow.nodes.a_categories, { values: ["housing"] }), null);
  assert.equal(flow.alertFor(flow.nodes.a_what, { text: "My roommate keeps misgendering me" }), null);
  assert.equal(flow.alertFor(flow.nodes.a_what, { text: "They said they'd kill the mood" }), null);
  assert.equal(flow.alertFor(flow.nodes.a_what, { skipped: true }), null);
});

/* ---------- Skip, Back, Edit ---------- */

test("every detail question can be skipped", () => {
  for (const [id, node] of Object.entries(flow.nodes)) {
    if (/^[a-f]_/.test(id) && !["a_skip", "e_resources"].includes(id)) assert.equal(node.optional, true, `${id} must be optional`);
  }
  for (const id of ["contact_name", "contact_discreet", "consent_scope"]) assert.equal(flow.nodes[id].optional, true, id);
});

test("skip: a student can skip everything in a branch and still reach review", () => {
  for (const [branch, first] of Object.entries({ office: "b_office", peer: "c_kind", advocate: "d_concern", other: "f_what" })) {
    const e = fresh();
    reply(e, "yes"); reply(e, branch);
    assert.equal(e.id, first);
    while (/^[a-f]_/.test(e.id)) reply(e, "skip");
    assert.equal(e.id, "contact_want", branch);
  }
});

test("skip: a report with no description offers resources instead of forcing one", () => {
  const e = fresh();
  reply(e, "yes"); reply(e, "report"); reply(e, "skip");
  assert.equal(e.id, "a_skip");
  reply(e, "resources");
  assert.equal(e.id, "end_resources");
  assert.equal(e.node.type, "end");
  assert.ok(!e.node.receipt, "nothing is submitted");

  const again = fresh();
  reply(again, "yes"); reply(again, "report"); reply(again, "skip"); reply(again, "write");
  assert.equal(again.id, "a_what");
});

test("information branch: resources come first and no submission is required", () => {
  const e = fresh();
  reply(e, "yes"); reply(e, "info"); reply(e, "mental_health");
  assert.equal(e.id, "e_resources");
  assert.equal(e.node.resources(e.answers), "mental_health");
  reply(e, "no");
  assert.equal(e.id, "end_info");
  assert.ok(!e.node.receipt);
});

test("required questions cannot be skipped", () => {
  const e = fresh();
  assert.equal(e.answer({ skipped: true }).ok, false);
  reply(e, "yes");
  assert.equal(e.answer({ skipped: true }).ok, false, "How can we help? needs an answer");
  reply(e, "peer"); reply(e, "skip"); reply(e, "skip");
  assert.equal(e.id, "contact_want");
  assert.equal(e.answer({ skipped: true }).ok, false, "the contact question needs an answer");
});

test("back undoes one answer at a time, across the help choice", () => {
  const e = fresh();
  reply(e, "yes"); reply(e, "office"); reply(e, "housing"); reply(e, "Fictional goal.");
  assert.equal(e.id, "b_contacted");
  e.back(); assert.equal(e.id, "b_goal"); assert.equal(e.answers.narrative, undefined);
  e.back(); assert.equal(e.id, "b_office");
  e.back(); assert.equal(e.id, "help"); assert.equal(e.answers.help, undefined);
  e.back(); assert.equal(e.id, "intro");
  assert.equal(e.canGoBack, false);
});

test("edit: one answer can be changed from review without redoing the rest", () => {
  const e = fresh();
  walk(e, "report");
  assert.ok(e.edit("a_where"));
  reply(e, "online");
  assert.equal(e.id, "review");
  const report = flow.toReport(e.answers);
  assert.deepEqual(report.where, { value: "online" });
  assert.deepEqual(report.categories, ["housing", "online"]);
  assert.equal(report.narrative, "Fictional: someone kept making comments in my hall.");
});

test("edit: changing the kind of help asks the new branch and discards the old answers", () => {
  const e = fresh();
  walk(e, "report");
  e.edit("help");
  reply(e, "peer");
  assert.equal(e.id, "c_kind");
  reply(e, ["community"]); reply(e, "skip");
  assert.equal(e.id, "review");
  const report = flow.toReport(e.answers);
  assert.equal(report.help, "peer");
  assert.deepEqual(report.peer_kind, ["community"]);
  assert.equal(report.narrative, null, "the incident description is not carried into a different request");
  assert.deepEqual(report.categories, []);
  assert.equal(report.contact_want, "no", "contact preference is kept");
});

test("edit: cancelling an edit with back leaves the answer untouched", () => {
  const e = fresh();
  walk(e, "report");
  e.edit("a_what");
  assert.ok(e.back());
  assert.equal(e.id, "review");
  assert.equal(e.answers.narrative.text, "Fictional: someone kept making comments in my hall.");
});

test("multiple categories can be chosen and are kept in a stable order", () => {
  const e = fresh();
  reply(e, "yes"); reply(e, "report"); reply(e, "Fictional text.");
  assert.equal(e.node.type, "multi");
  assert.equal(e.node.options.length, 11);
  reply(e, ["online", "harassment", "safety"]);
  assert.deepEqual(e.answers.categories.values, ["harassment", "safety", "online"]);
});

/* ---------- Contact, opt-out and permissions ---------- */

test("opt-out: choosing not to be contacted asks for no contact details and stores none", () => {
  const e = fresh();
  const asked = walk(e, "report");
  assert.ok(!asked.includes("contact_email") && !asked.includes("contact_name"));
  const report = flow.toReport(e.answers);
  assert.equal(report.contact_want, "no");
  assert.equal(report.contact_email, null);
  assert.equal(report.contact_name, null);
});

test("contact: yes needs a real email address; changing to no removes it", () => {
  const e = fresh();
  reply(e, "yes"); reply(e, "peer"); reply(e, "skip"); reply(e, "skip"); reply(e, "yes");
  assert.equal(e.id, "contact_email");
  assert.equal(e.answer({ skipped: true }).ok, false);
  assert.deepEqual(e.interpret("not an email"), { error: "invalid_format" });
  assert.equal(e.answer({ text: "still not one" }).ok, false);
  reply(e, "student@example.com"); reply(e, "skip"); reply(e, "discreet"); reply(e, "ok");
  assert.equal(e.id, "review");
  assert.deepEqual(flow.toReport(e.answers).contact_discreet, { value: "discreet" });
  e.edit("contact_want"); reply(e, "no");
  assert.equal(e.id, "review");
  const report = flow.toReport(e.answers);
  assert.equal(report.contact_email, null);
  assert.equal(report.contact_discreet, null);
});

test("asking for an office or an advocate is not consent: permission is a separate question that defaults to no", () => {
  for (const branch of ["office", "advocate"]) {
    const e = fresh();
    const steps = WALKS[branch].slice(0, WALKS[branch].lastIndexOf("ok") + 1); // up to and including the privacy notice
    for (const step of steps) reply(e, step);
    assert.equal(e.id, "consent", branch);
    assert.equal(e.node.options[0].value, "no", "No is the first option");
    assert.match(e.lines().join(" "), /does not give us this permission/);
    assert.equal(flow.toReport(e.answers).external_contact, "no", "until answered, the stored permission is no");
  }
});

test("permission is only asked where it applies, and its scope only when it was given", () => {
  assert.ok(!walk(fresh(), "peer").includes("consent"));
  assert.ok(!walk(fresh(), "report").includes("consent"));
  assert.ok(!walk(fresh(), "info").includes("consent"));
  assert.ok(walk(fresh(), "other").includes("consent"), "something-else + asking for advocacy asks for permission");
  assert.ok(!walk(fresh(), "office").includes("consent_scope"), "answering no does not ask who may be contacted");
  const e = fresh();
  assert.ok(walk(e, "advocate").includes("consent_scope"));
  const report = flow.toReport(e.answers);
  assert.equal(report.external_contact, "anonymous");
  assert.equal(report.external_contact_scope, "Fictional: the registrar, about the roster.");
  e.edit("consent"); reply(e, "no");
  assert.equal(flow.toReport(e.answers).external_contact_scope, null);
});

test("a report that asks for advocacy inside it also gets the permission question", () => {
  const e = fresh();
  for (const step of ["yes", "report", "Fictional text.", "skip", "skip", "skip", "skip", "skip", ["advocacy"], "no", "ok"]) reply(e, step);
  assert.equal(e.id, "consent");
});

test("the privacy notice covers readers, storage, response time, retention, limits and the University", () => {
  flow.context.policy = { REVIEW_HOURS: "on weekdays", RESPONSE_TIME: "within three days", RETENTION: "12 months", CONFIDENTIALITY_LIMITS: "Fictional limits." };
  const e = fresh();
  for (const step of ["yes", "peer", "skip", "skip", "no"]) reply(e, step);
  assert.equal(e.id, "privacy");
  const text = e.lines().join(" ");
  for (const phrase of ["Who can read it", "student reviewers", "private database", "does not contain what you wrote", "on weekdays",
    "within three days", "12 months", "Fictional limits.", "not necessarily been read", "not a University report"]) {
    assert.ok(text.includes(phrase), `privacy notice is missing "${phrase}"`);
  }
  reply(e, "stop");
  assert.equal(e.id, "bye", "the student can stop at the privacy notice without submitting");
  flow.context.policy = {};
  assert.match(fresh().lines().join(" "), /Preview only/);
});

test("undecided policies are shown as undecided, never invented", () => {
  flow.context.policy = {};
  const e = fresh();
  for (const step of ["yes", "peer", "skip", "skip", "no"]) reply(e, step);
  assert.equal((e.lines().join(" ").match(/\[to be confirmed before this service opens\]/g) || []).length, 4);
});

/* ---------- Honesty about what is staffed ---------- */

test("services that are not staffed are never promised", () => {
  const e = fresh();
  reply(e, "yes"); reply(e, "peer");
  assert.match(e.lines().join(" "), /can’t promise that a trained peer supporter is available/);
  assert.match(e.lines().join(" "), /not counseling/);
  const d = fresh();
  for (const step of ["yes", "advocate", "skip", "skip", "skip"]) reply(d, step);
  assert.equal(d.id, "d_kind");
  assert.match(d.lines().join(" "), /can’t promise an advocate is available yet/);
  assert.match(d.lines().join(" "), /act as your lawyer, guarantee an outcome, or override/);
  assert.ok(d.node.options.find((o) => o.value === "attend").label.endsWith("if a reviewer is available"));
  const b = fresh();
  for (const step of ["yes", "office", "skip", "skip", "skip", "skip"]) reply(b, step);
  assert.equal(b.id, "b_assist");
  assert.match(b.lines().join(" "), /can’t represent you legally, guarantee a decision, or override University policy/);
});

/* ---------- General rules ---------- */

test("every branch leads to a node that exists", () => {
  const probes = [{}, ...Object.keys(flow.branchStart).map((h) => ({ help: { value: h }, contact_want: { value: "yes" } })),
    { help: { value: "peer" }, contact_want: { value: "no" } }];
  for (const [id, node] of Object.entries(flow.nodes)) {
    const targets = [];
    for (const option of node.options || []) if (option.next) targets.push(option.next);
    if (typeof node.next === "string") targets.push(node.next);
    if (node.skipNext) targets.push(node.skipNext);
    if (typeof node.next === "function") {
      for (const answers of probes) { try { const t = node.next(answers); if (t) targets.push(t); } catch { /* probe doesn't apply */ } }
    }
    if (node.type !== "end") assert.ok(targets.length, `${id} has no way forward`);
    for (const target of targets) assert.ok(flow.nodes[target], `${id} points at missing node ${target}`);
  }
});

test("the script never asks about the student's own identity, and never opens with \"what's your problem\"", () => {
  const everything = everyLine().join(" ").toLowerCase();
  for (const phrase of ["your sexual orientation", "your gender identity", "are you gay", "are you trans", "your pronouns", "what's your problem", "what’s your problem"]) {
    assert.ok(!everything.includes(phrase), `script contains "${phrase}"`);
  }
});

test("the script does not claim to be a person or to dispatch help", () => {
  const everything = everyLine().join(" ");
  assert.match(everything, /scripted program, not a person/);
  for (const phrase of ["I am a counselor", "we will send help", "help is on the way", "monitored 24/7 by"]) assert.ok(!everything.includes(phrase), phrase);
});

test("no em dashes anywhere in the script", () => {
  for (const line of everyLine()) assert.ok(!line.includes("\u2014"), line);
});

test("typed answers: aliases, own words, and nudges", () => {
  const e = fresh();
  assert.deepEqual(e.interpret("  YES "), { answer: { value: "yes", label: "Yes" } });
  assert.deepEqual(e.interpret("tell me a joke"), { error: "choose_option" });
  reply(e, "yes");
  assert.equal(e.interpret("advocate").answer.value, "advocate");
  reply(e, "office");
  assert.equal(e.interpret("registrar").answer.value, "records");
  assert.deepEqual(e.interpret("The ID card office").answer, { value: "other", label: "The ID card office", text: "The ID card office" });
  assert.equal(e.interpret("x".repeat(301)).error, "too_long");
});

test("a saved draft resumes where it left off", () => {
  const e = fresh();
  reply(e, "yes"); reply(e, "office"); reply(e, "housing");
  const resumed = fresh(JSON.parse(JSON.stringify(e.snapshot())));
  assert.equal(resumed.id, "b_goal");
  assert.equal(resumed.answers.office.value, "housing");
  assert.equal(fresh({ current: "no_such_node", answers: {}, trail: [] }).id, "intro");
});

test("the review summary and the dashboard description are readable", () => {
  const e = fresh();
  walk(e, "advocate");
  const rows = flow.summary(e.answers);
  assert.equal(rows[0].label, "How we can help");
  assert.ok(rows.every((r) => r.editable && flow.nodes[r.node]));
  assert.deepEqual(rows.map((r) => r.node).slice(-2), ["consent", "consent_scope"]);
  const described = flow.describeReport(flow.toReport(e.answers));
  assert.deepEqual(described[1], ["How we can help", "I need an advocate / someone to help me speak up"]);
  assert.ok(described.some((r) => r[0] === "The concern" && r[1].startsWith("Fictional")));
  assert.ok(!described.some((r) => r[1] === "" || r[1] === null));
  // A report stored by the earlier version is still shown, field by field.
  const legacy = flow.describeReport({ version: 2, needs: ["advocate"], what: "legacy text", category: { value: "housing" }, timing: null });
  assert.deepEqual(legacy, [["Needs", "advocate"], ["What", "legacy text"], ["Category", "housing"]]);
});
