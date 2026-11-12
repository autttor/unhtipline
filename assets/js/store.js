/* Submission. There is exactly one path: the Supabase Edge Function "submit-report".
 * There is no demo store and no browser-side email. If intake is not fully configured, nothing is
 * sent and nothing is saved, and the site says so.
 */
(function () {
  "use strict";
  var PR = (window.PR = window.PR || {});
  var cfg = window.PR_CONFIG || {};
  var policy = cfg.POLICY || {};
  var REQUIRED_POLICY = ["REVIEW_HOURS", "RESPONSE_TIME", "RETENTION", "CONFIDENTIALITY_LIMITS", "CONTACT_EMAIL"];
  var CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

  var base = String(cfg.SUPABASE_URL || "").replace(/\/+$/, "");

  /** Every reason intake is closed, in plain words. Empty means open. */
  function closedReasons() {
    var reasons = [];
    if (cfg.INTAKE_ENABLED !== true) reasons.push("INTAKE_ENABLED is off");
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
      reasons.push("SUPABASE_URL is not set");
    }
    REQUIRED_POLICY.forEach(function (key) {
      if (!String(policy[key] || "").trim()) reasons.push("POLICY." + key + " is empty");
    });
    if (PR.resources && !PR.resources.coreVerified()) reasons.push("core campus contacts are not marked verified");
    return reasons;
  }

  function postJson(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
      referrerPolicy: "no-referrer",
      credentials: "omit"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "request_failed");
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /** One random key per report, so a retry after a dropped connection can never create a duplicate. */
  function newIdempotencyKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  /** Accepts an earlier access code typed with spaces, lower case or missing dashes. */
  function normalizeCode(input) {
    var s = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s.slice(0, 2) === "PR") s = s.slice(2);
    if (s.length !== 12) return null;
    for (var i = 0; i < s.length; i++) if (CODE_ALPHABET.indexOf(s[i]) === -1) return null;
    return "PR-" + s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
  }

  var store = {
    base: base,
    functionsUrl: base + "/functions/v1",
    closedReasons: closedReasons,
    /** True only when submissions will really be stored. Evaluated late so resources-data.js has loaded. */
    isOpen: function () { return closedReasons().length === 0; },
    newIdempotencyKey: newIdempotencyKey,
    normalizeCode: normalizeCode,

    /**
     * Resolves to { id, received_at } only after the server confirms the report was stored.
     * Rejects otherwise. There is no local fallback: a failure is shown to the student as a failure.
     */
    submit: function (report, meta, idem) {
      if (!store.isOpen()) return Promise.reject(new Error("intake_closed"));
      return postJson(store.functionsUrl + "/submit-report", { report: report, meta: meta || {}, idem: idem, privacy_ack: true })
        .then(function (data) {
          if (!data || typeof data.id !== "string") throw new Error("unconfirmed");
          return { id: data.id, received_at: data.received_at };
        });
    },

    /* Earlier access codes only. New reports do not get one. */
    lookup: function (code) {
      var clean = normalizeCode(code);
      if (!clean) return Promise.reject(new Error("bad_code"));
      if (!base) return Promise.reject(new Error("not_configured"));
      return postJson(store.functionsUrl + "/track-report", { action: "view", code: clean });
    },
    sendMessage: function (code, body) {
      var clean = normalizeCode(code);
      if (!clean) return Promise.reject(new Error("bad_code"));
      return postJson(store.functionsUrl + "/track-report", { action: "message", code: clean, body: body });
    }
  };

  PR.store = store;
})();
