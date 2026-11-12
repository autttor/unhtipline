/* Pride Guide conversation engine.
 *
 * A small deterministic state machine. It knows nothing about the DOM, so the same code runs in the
 * browser and under `node --test`. It never generates text: every word the bot says comes from flow.js.
 *
 * Node shape (see flow.js):
 *   { type: "choice" | "multi" | "text" | "review" | "end",
 *     say: [string] | (answers) => [string],
 *     field: "name"            where the answer is stored (optional for pure navigation nodes)
 *     options: [{ value, label, aliases?, next? }]
 *     allowText: true          a typed answer is accepted on a choice node and stored as "other"
 *     optional: true           the student may skip
 *     next: "id" | (answers) => "id"
 *     partOf: "nodeId"         follow-up question that belongs to another node when editing }
 *
 * Answer shapes:
 *   choice -> { value, label } or { value: "other", label, text }   text -> { text }
 *   multi  -> { values: [], labels: [] }                             skip -> { skipped: true }
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.PR = root.PR || {}).engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }

  function createEngine(flow, saved) {
    var state = saved && saved.current && flow.nodes[saved.current]
      ? clone(saved)
      : { current: flow.start, answers: {}, trail: [], editing: null };

    function node(id) {
      var n = flow.nodes[id || state.current];
      if (!n) throw new Error("Unknown node: " + (id || state.current));
      return n;
    }

    function resolve(target) { return typeof target === "function" ? target(state.answers) : target; }

    function lines(id) {
      var n = node(id);
      var say = typeof n.say === "function" ? n.say(state.answers) : n.say;
      return (say || []).slice();
    }

    /** Turn typed text into an answer for the current node, or return { error } if it doesn't fit. */
    function interpret(text) {
      var n = node();
      var raw = String(text == null ? "" : text).trim();
      if (!raw) return { error: "empty" };
      var max = n.maxLength || flow.maxLength || 4000;
      if (raw.length > max) return { error: "too_long", max: max };
      if (n.type === "text") return { answer: { text: raw } };
      if (n.type === "choice") {
        var typed = norm(raw);
        for (var i = 0; i < n.options.length; i++) {
          var o = n.options[i];
          var names = [o.label].concat(o.aliases || []).map(norm);
          if (names.indexOf(typed) !== -1) return { answer: { value: o.value, label: o.label } };
        }
        if (n.allowText) return { answer: { value: "other", label: raw, text: raw } };
        return { error: "choose_option" };
      }
      return { error: "choose_option" };
    }

    function validate(n, ans) {
      if (!ans || typeof ans !== "object") return "invalid";
      if (ans.skipped) return n.optional ? null : "required";
      if (n.type === "text") return typeof ans.text === "string" && ans.text.trim() ? null : "empty";
      if (n.type === "choice") {
        if (ans.value === "other" && n.allowText && ans.text) return null;
        return n.options.some(function (o) { return o.value === ans.value; }) ? null : "choose_option";
      }
      if (n.type === "multi") {
        if (!Array.isArray(ans.values)) return "invalid";
        var known = n.options.map(function (o) { return o.value; });
        if (!ans.values.every(function (v) { return known.indexOf(v) !== -1; })) return "choose_option";
        return ans.values.length || n.optional ? null : "required";
      }
      if (n.type === "review") return ans.confirmed ? null : "required";
      return "invalid";
    }

    function answer(ans) {
      var id = state.current;
      var n = node();
      var problem = validate(n, ans);
      if (problem) return { ok: false, error: problem };

      state.trail.push({ node: id, answers: clone(state.answers), editing: state.editing ? clone(state.editing) : null });
      if (n.field) state.answers[n.field] = clone(ans);
      if (typeof n.onAnswer === "function") n.onAnswer(state.answers, ans);

      var chosen = n.type === "choice" && !ans.skipped
        ? n.options.filter(function (o) { return o.value === ans.value; })[0]
        : null;
      var next = resolve((chosen && chosen.next) || n.next);
      if (!next || !flow.nodes[next]) throw new Error("Node " + id + " has no valid next step");

      if (state.editing) {
        // While editing from the review screen, only follow-up questions that belong to the edited
        // node are asked; anything else returns straight to the review.
        if (flow.nodes[next].partOf === state.editing.root) {
          state.current = next;
        } else {
          state.current = state.editing.returnTo;
          state.editing = null;
        }
      } else {
        state.current = next;
      }
      return { ok: true };
    }

    function back() {
      if (state.editing && state.trail.length <= state.editing.mark) {
        // Nothing answered since this edit began: cancel the edit.
        state.current = state.editing.returnTo;
        state.editing = null;
        return true;
      }
      var last = state.trail.pop();
      if (!last) return false;
      state.answers = last.answers;
      state.editing = last.editing;
      state.current = last.node;
      return true;
    }

    /** From the review node, jump to one earlier question and come back afterwards. */
    function edit(nodeId) {
      if (node().type !== "review") return false;
      var target = flow.nodes[nodeId];
      if (!target || target.type === "review" || target.type === "end") return false;
      // `mark` remembers how long the trail was, so back() can tell this edit apart from earlier ones.
      state.editing = { root: nodeId, returnTo: state.current, mark: state.trail.length };
      state.current = nodeId;
      return true;
    }

    function reset() {
      state = { current: flow.start, answers: {}, trail: [], editing: null };
    }

    return {
      get id() { return state.current; },
      get node() { return node(); },
      get answers() { return state.answers; },
      get editing() { return !!state.editing; },
      get canGoBack() { return state.trail.length > 0 || !!state.editing; },
      lines: lines,
      interpret: interpret,
      answer: answer,
      back: back,
      edit: edit,
      reset: reset,
      snapshot: function () { return clone(state); }
    };
  }

  /** Human-readable form of a stored answer, for the transcript and the review screen. */
  function describe(ans) {
    if (!ans) return "";
    if (ans.skipped) return "Skipped";
    if (Array.isArray(ans.labels)) return ans.labels.join(", ");
    if (typeof ans.text === "string" && ans.value === undefined) return ans.text;
    return ans.label || ans.text || "";
  }

  return { createEngine: createEngine, describe: describe };
});
