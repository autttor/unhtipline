// The browser script (flow.js) and the server validator (validate.ts) each list the allowed answers.
// These tests fail if the two drift apart.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { engineLib, flow, resources, reply, incidentToReview, root } from "./helpers.js";
import { ALLOWED, FREE_TEXT_CHOICES, LIMITS, CODE_ALPHABET, validateReport } from "../supabase/functions/_shared/validate.ts";

test("option values match the server's allow-list", () => {
  for (const field of ["category", "when", "where", "who", "frequency", "role", "reported", "wants", "contact_mode"]) {
    assert.deepEqual(flow.nodes[field].options.map((o) => o.value).sort(), [...ALLOWED[field]].sort(), field);
  }
  const reportPaths = flow.nodes.path.options.map((o) => o.value).filter((v) => flow.nodes.path.options.find((o) => o.value === v).next === "category");
  assert.deepEqual(reportPaths.sort(), [...ALLOWED.path].sort());
});

test("free-text rules and length limits match", () => {
  const typed = Object.entries(flow.nodes).filter(([, n]) => n.type === "choice" && n.allowText).map(([id]) => id);
  assert.deepEqual(typed.sort(), [...FREE_TEXT_CHOICES].sort());
  for (const id of typed) assert.equal(flow.nodes[id].maxLength, LIMITS.choiceText, id);
  assert.equal(flow.maxLength, LIMITS.longText);
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
  for (const step of ["continue", "safe", "concern"]) reply(all, step);
  all.answer(all.interpret("my own category").answer);
  for (const step of ["skip", "skip", "skip", "skip", "skip", "identified", "skip", "555-0100"]) reply(all, step);
  const second = flow.toReport(all.answers);
  const checked = validateReport(second);
  assert.ok(checked.ok, checked.error);
  assert.deepEqual(checked.value, second);
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
