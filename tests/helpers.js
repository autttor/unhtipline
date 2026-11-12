// The browser scripts are plain <script> files with a small UMD wrapper. This loads one the way
// CommonJS would, without needing a bundler.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));

export function loadScript(relativePath) {
  const module = { exports: {} };
  new Function("module", "exports", readFileSync(root + relativePath, "utf8"))(module, module.exports);
  return module.exports;
}

export const engineLib = loadScript("assets/js/engine.js");
export const flow = loadScript("assets/js/flow.js");
export const resources = loadScript("assets/js/resources-data.js");

/** Answer the current question by option value, typed text, a list (multi-select), or "skip". */
export function reply(engine, what) {
  const node = engine.node;
  let answer;
  if (what === "skip") answer = { skipped: true };
  else if (Array.isArray(what)) {
    const chosen = node.options.filter((o) => what.includes(o.value));
    answer = { values: chosen.map((o) => o.value), labels: chosen.map((o) => o.label) };
  } else if (node.type === "text") answer = { text: what };
  else {
    const option = node.options.find((o) => o.value === what);
    if (!option) throw new Error(`No option "${what}" at ${engine.id}`);
    answer = { value: option.value, label: option.label };
  }
  const result = engine.answer(answer);
  if (!result.ok) throw new Error(`Answer rejected at ${engine.id}: ${result.error}`);
}

// One complete, fictional walk through each kind of help. Every entry answers one question.
export const WALKS = {
  report: ["yes", "report", "Fictional: someone kept making comments in my hall.", ["housing", "online"], "residence", "week",
    "repeated", "yes", ["document"], "no", "ok"],
  office: ["yes", "office", "housing", "Fictional: I need a room change.", "yes", "Fictional: they said to wait.", "days", ["draft"],
    "yes", "student@example.com", "skip", "discreet", "ok", "no"],
  peer: ["yes", "peer", ["listen"], "skip", "no", "ok"],
  advocate: ["yes", "advocate", "Fictional: my name is wrong on the roster.", "Fictional: the roster fixed.", "weeks", ["options", "general"],
    "yes", "student@example.com", "Sam", "ok", "ok", "anonymous", "Fictional: the registrar, about the roster."],
  info: ["yes", "info", "reporting", "yes", "Fictional: how do official reports work?", "no", "ok"],
  other: ["yes", "other", "Fictional: not sure where this fits.", ["advocacy"], "no", "ok", "no"]
};

/** Walks a branch to the review screen and returns the ids of the questions asked, in order. */
export function walk(engine, branch) {
  const asked = [];
  for (const step of WALKS[branch]) {
    asked.push(engine.id);
    reply(engine, step);
  }
  asked.push(engine.id);
  return asked;
}
