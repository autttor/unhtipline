/* Report delivery and storage. Three modes, chosen in config.js:
 *
 *   demo     everything lives in this browser's localStorage under one key
 *   email    each report is emailed to the reviewers' inbox through Web3Forms or Formspree
 *   backend  the browser talks to two Supabase Edge Functions, submit-report and track-report
 *
 * The reviewer dashboard only works in demo mode; see README.
 */
(function () {
  "use strict";
  var PR = (window.PR = window.PR || {});
  var cfg = window.PR_CONFIG || {};
  var KEY = "pride-report-demo-v2";
  // No 0/O, 1/I/L or U: easier to read aloud and copy by hand.
  // 30 symbols x 12 characters is about 59 bits, the same scheme the server uses.
  var ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ".split("");
  var CODE_GROUPS = 3;

  var mode = cfg.API_BASE ? "backend" : (cfg.EMAIL_WEB3FORMS_KEY || cfg.EMAIL_FORMSPREE_ID) ? "email" : "demo";

  function randomSymbols(count) {
    var out = [];
    var bytes = new Uint8Array(32);
    var i = bytes.length;
    while (out.length < count) {
      if (i >= bytes.length) { crypto.getRandomValues(bytes); i = 0; }
      var b = bytes[i++];
      // Rejection sampling (240 = 8 x 30) keeps every symbol equally likely.
      if (b < 240) out.push(ALPHABET[b % ALPHABET.length]);
    }
    return out.join("");
  }

  function generateCode() {
    var s = randomSymbols(CODE_GROUPS * 4);
    return "PR-" + s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
  }

  /** Accepts codes typed with spaces, lower case or missing dashes. Returns null if it can't be a code. */
  function normalizeCode(input) {
    var s = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s.slice(0, 2) === "PR") s = s.slice(2);
    if (s.length !== CODE_GROUPS * 4) return null;
    for (var i = 0; i < s.length; i++) if (ALPHABET.indexOf(s[i]) === -1) return null;
    return "PR-" + s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
  }

  function sha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    });
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* storage blocked or corrupt: fall through to an empty store */ }
    return { seq: 1042, reports: [], audit: [] };
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch (e) { return false; }
  }
  function now() { return new Date().toISOString(); }

  function publicView(r) {
    return {
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      contact_mode: r.report.contact_mode,
      report: r.report,
      messages: r.messages.map(function (m) { return { sender: m.sender, body: m.body, created_at: m.created_at }; })
    };
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
        if (!res.ok || data.success === false) {
          var err = new Error(data.error || data.message || "request_failed");
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function api(name, body) { return postJson(cfg.API_BASE.replace(/\/$/, "") + "/" + name, body); }

  /* ---- Email mode -------------------------------------------------------------------------- */

  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** The fields of the email, in reading order. Exposed so tests can check exactly what is sent. */
  function emailFields(report, reference) {
    var fields = { "Reference": reference };
    PR.flow.describeReport(report).forEach(function (row) { fields[row[0]] = row[1]; });
    fields["Submitted"] = new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
    return fields;
  }

  function emailSubmit(report, meta) {
    // A filled hidden field or an instant submission means a bot: drop it without sending anything.
    if ((meta && meta.hp) || !meta || !(meta.elapsed_ms >= 3000)) return Promise.reject(new Error("rejected"));

    var reference = "PR-" + randomSymbols(4) + "-" + randomSymbols(4);
    var fields = emailFields(report, reference);
    // The subject shows up in notifications and lock screens, so it carries no details.
    var subject = "New Pride Report submission " + reference;
    var replyTo = report.contact_method && EMAIL_PATTERN.test(report.contact_method) ? report.contact_method : null;
    var url, payload;

    if (cfg.EMAIL_WEB3FORMS_KEY) {
      url = "https://api.web3forms.com/submit";
      payload = { access_key: cfg.EMAIL_WEB3FORMS_KEY, subject: subject, from_name: "Pride Report", botcheck: "" };
    } else {
      url = "https://formspree.io/f/" + encodeURIComponent(cfg.EMAIL_FORMSPREE_ID);
      payload = { _subject: subject };
    }
    Object.keys(fields).forEach(function (k) { payload[k] = fields[k]; });
    // Lets a reviewer press Reply in their mail app. Only added when the student gave an email address.
    if (replyTo) payload.email = replyTo;

    return postJson(url, payload).then(function () { return { id: reference, code: null }; });
  }

  var store = {
    mode: mode,
    isDemo: mode === "demo",
    /** True when students can return with an access code. */
    tracking: mode !== "email",
    generateCode: generateCode,
    normalizeCode: normalizeCode,
    emailFields: emailFields,

    /** Resolves to { id, code }. `meta` carries the anti-bot signals (honeypot, elapsed time). */
    submit: function (report, meta) {
      if (mode === "backend") return api("submit-report", { report: report, meta: meta || {} });
      if (mode === "email") return emailSubmit(report, meta);
      var code = generateCode();
      return sha256(code).then(function (hash) {
        var db = load();
        db.seq += 1;
        var rec = {
          id: "PR-" + db.seq, code_hash: hash, created_at: now(), status: "received",
          report: report, messages: [], notes: [], referrals: [], fictional: false
        };
        db.reports.unshift(rec);
        if (!save(db)) throw new Error("storage_unavailable");
        return { id: rec.id, code: code };
      });
    },

    /** Resolves to the student's view of a report, or rejects with error "not_found". */
    lookup: function (code) {
      var clean = normalizeCode(code);
      if (!clean) return Promise.reject(new Error("bad_code"));
      if (mode === "backend") return api("track-report", { action: "view", code: clean });
      if (mode === "email") return Promise.reject(new Error("tracking_unavailable"));
      return sha256(clean).then(function (hash) {
        var rec = load().reports.filter(function (r) { return r.code_hash === hash; })[0];
        if (!rec) throw new Error("not_found");
        return publicView(rec);
      });
    },

    sendMessage: function (code, body) {
      var clean = normalizeCode(code);
      if (!clean) return Promise.reject(new Error("bad_code"));
      if (mode === "backend") return api("track-report", { action: "message", code: clean, body: body });
      if (mode === "email") return Promise.reject(new Error("tracking_unavailable"));
      return sha256(clean).then(function (hash) {
        var db = load();
        var rec = db.reports.filter(function (r) { return r.code_hash === hash; })[0];
        if (!rec) throw new Error("not_found");
        if (rec.report.contact_mode === "anonymous") throw new Error("messaging_disabled");
        if (rec.status === "closed") throw new Error("closed");
        rec.messages.push({ sender: "student", body: body, created_at: now() });
        save(db);
        return publicView(rec);
      });
    },

    clearDemo: function () {
      try { localStorage.removeItem(KEY); } catch (e) { /* nothing to clear */ }
    },

    /* ---- Demo-only reviewer functions. In production these are database functions
            (see supabase/migrations) that require an authenticated reviewer with MFA. ---- */
    admin: {
      load: load,
      seed: function (records) {
        var db = load();
        if (db.reports.some(function (r) { return r.fictional; })) return db;
        db.reports = db.reports.concat(records);
        save(db);
        return db;
      },
      mutate: function (id, action, fn) {
        var db = load();
        var rec = db.reports.filter(function (r) { return r.id === id; })[0];
        if (!rec && action !== "viewed_statistics") return null;
        if (rec && fn) fn(rec, db);
        db.audit.unshift({ at: now(), actor: "Demo reviewer", action: action, report: id || null });
        db.audit = db.audit.slice(0, 200);
        save(db);
        return rec;
      },
      remove: function (id) {
        var db = load();
        db.reports = db.reports.filter(function (r) { return r.id !== id; });
        db.audit.unshift({ at: now(), actor: "Demo reviewer", action: "deleted_report", report: id });
        save(db);
      }
    }
  };

  PR.store = store;
})();
