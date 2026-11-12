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

/** Answer the current question by option value, typed text, or "skip". */
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

export const INCIDENT_STEPS = ["continue", "safe", ["advocate", "support"], "without_name", "talk", "incident", "housing",
  "Fictional: something happened.", "week", "residence", "student", "repeated", "experienced", "no",
  "Fictional: I want it to stop.", "days", "skip", "portal"];

export function incidentToReview(engine) {
  for (const step of INCIDENT_STEPS) reply(engine, step);
}
