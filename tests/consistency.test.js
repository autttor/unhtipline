// The browser script (flow.js) and the server validator (validate.ts) each list the allowed answers.
// These tests fail if the two drift apart.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { engineLib, flow, resources, reply, incidentToReview, root } from "./helpers.js";
import { ALLOWED, FREE_TEXT_CHOICES, HELP_NEEDS, LIMITS, CODE_ALPHABET, validateReport, reportToText } from "../supabase/functions/_shared/validate.ts";

test("option values match the server's allow-list", () => {
  for (const field of Object.keys(ALLOWED)) {
    assert.ok(flow.nodes[field], `flow.js has no "${field}" question`);
    assert.deepEqual(flow.nodes[field].options.map((o) => o.value).sort(), [...ALLOWED[field]].sort(), field);
  }
  assert.deepEqual([...flow.helpNeeds], [...HELP_NEEDS]);
});

test("free-text rules and length limits match", () => {
  const typed = Object.entries(flow.nodes).filter(([, n]) => n.type === "choice" && n.allowText).map(([id]) => id);
  assert.deepEqual(typed.sort(), [...FREE_TEXT_CHOICES].sort());
  for (const id of typed) assert.equal(flow.nodes[id].maxLength, LIMITS.choiceText, id);
  assert.equal(flow.maxLength, LIMITS.longText);
  assert.equal(flow.nodes.outcome.maxLength, LIMITS.outcome);
  assert.equal(flow.nodes.contact_name.maxLength, LIMITS.name);
  assert.equal(flow.nodes.contact_method.maxLength, LIMITS.contact);
});

test("reports built by the conversation pass server validation unchanged", () => {
  const e = engineLib.createEngine(flow);
  incidentToReview(e);
  const report = flow.toReport(e.answers);
  const result = validateReport(report);
  assert.ok(result.ok, result.error);
  assert.deepEqual(result.value, report);

  const all = engineLib.createEngine(flow);
  for (const step of ["continue", "safe", ["advocate", "office", "support", "conflict", "official"], "ask_first"]) reply(all, step);
  all.answer(all.interpret("my own office").answer);
  for (const step of ["accompany", "group", "no", "concern"]) reply(all, step);
  all.answer(all.interpret("my own category").answer);
  for (const step of ["skip", "skip", "skip", "skip"]) reply(all, step);
  all.answer(all.interpret("before housing selection on March 3").answer);
  for (const step of ["skip", "identified", "skip", "555-0100", "discreet"]) reply(all, step);
  assert.equal(all.id, "review");
  const second = flow.toReport(all.answers);
  const checked = validateReport(second);
  assert.ok(checked.ok, checked.error);
  assert.deepEqual(checked.value, second);
});

test("the emailed text and the on-screen summary cover the same fields", () => {
  const e = engineLib.createEngine(flow);
  incidentToReview(e);
  const report = flow.toReport(e.answers);
  const text = reportToText(report);
  for (const [label] of flow.describeReport(report)) {
    if (label === "What happened") continue; // the email calls this "In their words"
    assert.ok(text.includes(label + ":"), `email is missing "${label}"`);
  }
  assert.ok(text.includes("Fictional: something happened."));
});

test("every category routes to resources that exist", () => {
  for (const option of flow.nodes.category.options) {
    const list = resources.forCategory(option.value);
    assert.ok(list.length >= 1, option.value);
    for (const item of list) assert.ok(item && item.name && item.contacts.length, option.value);
  }
  for (const keys of Object.values(resources.byCategory)) for (const k of keys) assert.ok(resources.items[k], k);
  for (const group of resources.groups) for (const k of group.keys) assert.ok(resources.items[k], k);
});

test("browser and server use the same access-code alphabet", () => {
  const store = readFileSync(root + "assets/js/store.js", "utf8");
  assert.ok(store.includes(`var ALPHABET = "${CODE_ALPHABET}"`));
});

const SITE_FILES = ["index.html", "report.html", "resources.html", "track.html", "about.html", "404.html", "admin/index.html",
  "assets/js/common.js", "assets/js/flow.js", "assets/js/report-page.js", "assets/js/track-page.js", "assets/js/admin.js",
  "assets/js/resources-data.js", "assets/js/resources-page.js", "assets/js/store.js", "assets/js/config.js", "README.md", "SETUP.md"];

test("no em dashes anywhere on the site or in the docs", () => {
  for (const file of SITE_FILES) {
    const lines = readFileSync(root + file, "utf8").split("\n");
    lines.forEach((line, i) => assert.ok(!line.includes("\u2014"), `${file}:${i + 1} has an em dash`));
  }
});

test("wherever both appear, University Public Safety is listed before 911", () => {
  for (const file of SITE_FILES.filter((f) => !f.endsWith(".md"))) {
    const text = readFileSync(root + file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // Check each block of text on its own (a paragraph, list or string), not the file as a whole.
    for (const block of text.split(/<\/p>|<\/ul>|\n\s*\n|\];/)) {
      const safety = block.search(/Public Safety|932-7070|\+12039327070/);
      const nine = block.search(/\b911\b/);
      if (safety !== -1 && nine !== -1) assert.ok(safety < nine, `${file}: 911 comes before Public Safety in: ${block.trim().slice(0, 90)}`);
    }
  }
});

test("the site makes no third-party requests and has no inline scripts or styles", () => {
  for (const page of ["index.html", "report.html", "resources.html", "track.html", "about.html", "admin/index.html"]) {
    const html = readFileSync(root + page, "utf8");
    assert.match(html, /Content-Security-Policy/, page);
    assert.ok(!/<script(?![^>]*\bsrc=)/.test(html), `${page} has an inline script`);
    assert.ok(!/\sstyle="/.test(html) && !/<style/.test(html), `${page} has inline styles`);
    for (const [, url] of html.matchAll(/<(?:script|link|img)[^>]+(?:src|href)="([^"]+)"/g)) {
      assert.ok(!/^(https?:)?\/\//.test(url), `${page} loads ${url} from another origin`);
    }
  }
});
