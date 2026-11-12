/* Reviewer dashboard.
 *
 * This file contains no reports and no secrets. It signs a reviewer in with Supabase Auth
 * (their own email and password, then a code from an authenticator app) and calls the staff_*
 * database functions. Those functions, not this page, decide what each person may see or change:
 * hiding a button here is a convenience, never the access control.
 */
(function () {
  "use strict";
  var PR = window.PR;
  var el = PR.el;
  var flow = PR.flow;
  var cfg = window.PR_CONFIG || {};
  var app = document.getElementById("app");
  var IDLE_MINUTES = 30;
  var MIN_PASSWORD = 12;

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function show(children) { clear(app); [].concat(children).forEach(function (c) { if (c) app.appendChild(c); }); }
  function notice(text, kind) { return el("div", { class: "callout" + (kind ? " callout-" + kind : "") }, el("p", { text: text })); }
  function field(label, control, help) {
    return el("div", { class: "field" }, [el("label", { for: control.id, text: label }), control, help ? el("p", { class: "help", text: help }) : null]);
  }

  if (!PR.store.base || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
    show(notice("The dashboard is not connected yet. The project owner needs to set SUPABASE_URL and SUPABASE_ANON_KEY in assets/js/config.js (see SETUP.md). No reports can be read from this page until then.", "warn"));
    return;
  }

  // An invitation or password-reset link lands here with a token in the address. Note it before the
  // library consumes it, so the person is asked to choose a password.
  var arrivedByLink = /type=(invite|recovery|signup)/.test(window.location.hash + window.location.search);

  var client = window.supabase.createClient(PR.store.base, cfg.SUPABASE_ANON_KEY, {
    // sessionStorage: closing the tab signs the reviewer out, which matters on shared computers.
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var me = null;          // { user_id, role, display_name }
  var team = [];          // staff list, for names and assignment
  var reports = [];       // queue metadata
  var ui = { tab: "queue", status: "new", type: "all", mine: false, selected: null, detail: null, message: null };

  var ERRORS = {
    not_authorized: "Your access has ended or your sign-in has expired.",
    admin_only: "Only an admin can do that.",
    not_permitted: "You can’t open this case. It is assigned to someone else, or reserved for advocates.",
    report_not_found: "That case is not available.",
    claim_first: "Claim the case first. Only the person it is assigned to, or an admin, can change it.",
    already_assigned: "Someone else claimed this case a moment ago.",
    needs_advocate: "Advocacy cases can only be assigned to an advocate or an admin.",
    staff_restricted: "That person is restricted from this case.",
    unknown_staff: "That person is not an active member of the team.",
    contact_not_requested: "The student asked not to be contacted, so contact attempts can’t be logged.",
    cannot_demote_self: "You can’t remove your own admin access. Ask another admin.",
    no_reply_channel: "This case has no reply channel.",
    not_retryable: "That notification can’t be retried.",
    closed: "This case is closed."
  };
  function explain(err) {
    var code = (err && err.message) || "";
    for (var key in ERRORS) if (code.indexOf(key) !== -1) return ERRORS[key];
    return "That didn’t work. Please try again. (" + (code || "unknown error").slice(0, 80) + ")";
  }

  /** Calls a staff_* database function. The database checks who is asking on every call. */
  function call(fn, args) {
    return client.rpc(fn, args || {}).then(function (res) {
      if (res.error) {
        var err = new Error(res.error.message || "request_failed");
        if (err.message.indexOf("not_authorized") !== -1) { signOut(ERRORS.not_authorized); }
        throw err;
      }
      return res.data;
    });
  }

  /** Calls one of the two admin Edge Functions with the reviewer's own sign-in token. */
  function callFunction(name, body) {
    return client.auth.getSession().then(function (res) {
      var token = res.data && res.data.session ? res.data.session.access_token : "";
      return fetch(PR.store.functionsUrl + "/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, "apikey": cfg.SUPABASE_ANON_KEY },
        body: JSON.stringify(body || {})
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || "request_failed");
        return data;
      });
    });
  }

  /* ------------------------------------------------------------------ sign-in ---- */

  function signOut(message) {
    stopIdleTimer();
    me = null; reports = []; ui.detail = null; ui.selected = null;
    client.auth.signOut().catch(function () { /* already signed out */ }).then(function () { viewSignIn(message); });
  }

  function viewSignIn(message) {
    var email = el("input", { id: "email", type: "email", autocomplete: "username", required: true });
    var password = el("input", { id: "password", type: "password", autocomplete: "current-password", required: true });
    var error = el("p", { class: "error", role: "alert" });
    var button = el("button", { class: "btn", type: "submit", text: "Sign in" });
    var form = el("form", {
      class: "card auth-card", novalidate: true,
      onsubmit: function (e) {
        e.preventDefault();
        error.textContent = "";
        button.disabled = true;
        client.auth.signInWithPassword({ email: email.value.trim(), password: password.value }).then(function (res) {
          button.disabled = false;
          if (res.error) { error.textContent = "That email and password don’t match an account."; return; }
          afterSession();
        });
      }
    }, [
      el("h2", { text: "Reviewer sign-in" }),
      el("p", { class: "muted", text: "For members of the Pride Line student team. Each reviewer has their own account." }),
      field("Email", email),
      field("Password", password),
      error,
      el("div", { class: "chips" }, [
        button,
        el("button", {
          class: "linklike", type: "button", text: "Forgot password",
          onclick: function () {
            var address = email.value.trim();
            if (!address) { error.textContent = "Enter your email address first."; email.focus(); return; }
            client.auth.resetPasswordForEmail(address, { redirectTo: window.location.origin + window.location.pathname }).then(function () {
              // Same message whether or not the address has an account.
              error.textContent = "If that address has an account, a reset link is on its way.";
            });
          }
        })
      ])
    ]);
    show([message ? notice(message, "warn") : null, form]);
  }

  function viewSetPassword() {
    var p1 = el("input", { id: "new-password", type: "password", autocomplete: "new-password", minlength: String(MIN_PASSWORD) });
    var p2 = el("input", { id: "new-password-2", type: "password", autocomplete: "new-password" });
    var error = el("p", { class: "error", role: "alert" });
    show(el("form", {
      class: "card auth-card", novalidate: true,
      onsubmit: function (e) {
        e.preventDefault();
        error.textContent = "";
        var value = p1.value;
        if (value.length < MIN_PASSWORD) { error.textContent = "Use at least " + MIN_PASSWORD + " characters."; return; }
        if (!/[a-z]/i.test(value) || !/[0-9]/.test(value)) { error.textContent = "Include at least one letter and one number."; return; }
        if (value !== p2.value) { error.textContent = "The two passwords don’t match."; return; }
        client.auth.updateUser({ password: value }).then(function (res) {
          if (res.error) { error.textContent = "That password was not accepted: " + res.error.message; return; }
          arrivedByLink = false;
          if (window.history && history.replaceState) history.replaceState(null, "", window.location.pathname);
          afterSession();
        });
      }
    }, [
      el("h2", { text: "Choose your password" }),
      el("p", { class: "muted", text: "At least " + MIN_PASSWORD + " characters, with a letter and a number. Don’t reuse a password from another site. A password manager helps." }),
      field("New password", p1),
      field("New password again", p2),
      error,
      el("button", { class: "btn", type: "submit", text: "Save password" })
    ]));
  }

  function codeInput() {
    return el("input", { id: "mfa-code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", pattern: "[0-9]{6}", placeholder: "6-digit code" });
  }

  function viewEnroll() {
    var error = el("p", { class: "error", role: "alert" });
    show(notice("Setting up your second sign-in step…"));
    // Clear out half-finished attempts, then start a fresh one.
    client.auth.mfa.listFactors().then(function (res) {
      var stale = ((res.data && res.data.all) || []).filter(function (f) { return f.status !== "verified"; });
      return Promise.all(stale.map(function (f) { return client.auth.mfa.unenroll({ factorId: f.id }); }));
    }).then(function () {
      return client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Pride Line " + Date.now() });
    }).then(function (res) {
      if (res.error) { show(notice("The second sign-in step could not be set up: " + res.error.message, "warn")); return; }
      var code = codeInput();
      show(el("form", {
        class: "card auth-card", novalidate: true,
        onsubmit: function (e) {
          e.preventDefault();
          error.textContent = "";
          client.auth.mfa.challengeAndVerify({ factorId: res.data.id, code: code.value.trim() }).then(function (v) {
            if (v.error) { error.textContent = "That code didn’t work. Check the app and try the newest code."; return; }
            afterSession();
          });
        }
      }, [
        el("h2", { text: "Set up your second sign-in step" }),
        el("p", { class: "muted", text: "Every reviewer needs this. Scan the code with an authenticator app (for example Google Authenticator, Microsoft Authenticator or 1Password), then enter the 6-digit code it shows." }),
        el("img", { class: "qr", src: res.data.totp.qr_code, alt: "QR code for your authenticator app", width: "200", height: "200" }),
        el("p", { class: "small muted" }, ["Can’t scan? Enter this key in the app instead: ", el("code", { text: res.data.totp.secret })]),
        field("Code from the app", code),
        error,
        el("button", { class: "btn", type: "submit", text: "Finish setup" })
      ]));
      code.focus();
    });
  }

  function viewChallenge(factorId) {
    var code = codeInput();
    var error = el("p", { class: "error", role: "alert" });
    show(el("form", {
      class: "card auth-card", novalidate: true,
      onsubmit: function (e) {
        e.preventDefault();
        error.textContent = "";
        client.auth.mfa.challengeAndVerify({ factorId: factorId, code: code.value.trim() }).then(function (v) {
          if (v.error) { error.textContent = "That code didn’t work. Try the newest code from your app."; code.value = ""; code.focus(); return; }
          afterSession();
        });
      }
    }, [
      el("h2", { text: "Enter your code" }),
      el("p", { class: "muted", text: "Open your authenticator app and enter the 6-digit code for Pride Line." }),
      field("Code", code),
      error,
      el("div", { class: "chips" }, [
        el("button", { class: "btn", type: "submit", text: "Continue" }),
        el("button", { class: "linklike", type: "button", text: "Sign out", onclick: function () { signOut(); } })
      ])
    ]));
    code.focus();
  }

  /** Works out the next step after any sign-in event: password, second factor, or the dashboard. */
  function afterSession() {
    client.auth.getSession().then(function (res) {
      if (!res.data || !res.data.session) { viewSignIn(); return null; }
      if (arrivedByLink) { viewSetPassword(); return null; }
      return call("staff_me");
    }).then(function (who) {
      if (!who) return;
      if (!who.is_staff) { signOut("This account is not on the reviewer team. If you think that is a mistake, ask an admin."); return; }
      return client.auth.mfa.listFactors().then(function (res) {
        var verified = ((res.data && res.data.totp) || []).filter(function (f) { return f.status === "verified"; });
        if (!verified.length) { viewEnroll(); return; }
        if (!who.mfa_ok) { viewChallenge(verified[0].id); return; }
        me = who;
        startIdleTimer();
        return loadAll().then(draw);
      });
    }).catch(function (err) { if (!/not_authorized/.test(err.message)) show(notice(explain(err), "warn")); });
  }

  /* ---------------------------------------------------------------- idle timer ---- */

  var idleTimer = null;
  function resetIdle() {
    if (!me) return;
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(function () { signOut("You were signed out after " + IDLE_MINUTES + " minutes without activity."); }, IDLE_MINUTES * 60000);
  }
  function startIdleTimer() {
    ["click", "keydown", "pointermove"].forEach(function (evt) { document.addEventListener(evt, resetIdle, { passive: true }); });
    resetIdle();
  }
  function stopIdleTimer() { window.clearTimeout(idleTimer); }

  /* --------------------------------------------------------------------- data ---- */

  function loadAll() {
    return Promise.all([call("staff_list_reports"), call("staff_team")]).then(function (r) { reports = r[0] || []; team = r[1] || []; });
  }
  function refresh() { return loadAll().then(function () { return ui.selected ? openCase(ui.selected, true) : null; }).then(draw); }

  function openCase(id, quiet) {
    return call("staff_open_report", { p_public_id: id }).then(function (detail) {
      ui.selected = id; ui.detail = detail;
    }).catch(function (err) {
      ui.selected = null; ui.detail = null;
      if (!quiet) ui.message = explain(err);
    });
  }

  /** Runs one change, then reloads the queue and the open case so the screen shows what was stored. */
  function act(fn, args, done) {
    ui.message = null;
    return call(fn, args).then(function () { if (done) done(); return refresh(); }).catch(function (err) { ui.message = explain(err); draw(); });
  }

  /* ---------------------------------------------------------------- rendering ---- */

  var TYPES = [["all", "All requests"], ["report", "Incident report"], ["office", "Help with University office"],
    ["peer", "Peer support"], ["advocacy", "Advocacy requested"], ["info", "Information or resources"], ["other", "Something else"]];

  function badge(text, kind) { return el("span", { class: "badge" + (kind ? " badge-" + kind : ""), text: text }); }
  function flags(r) {
    return [
      r.safety_flag ? badge("Safety flag", "danger") : null,
      r.advocacy_requested ? badge("Advocacy requested", "advocacy") : null,
      r.deadline || r.due_on ? badge("Deadline", "deadline") : null,
      r.mail === "failed" ? badge("Email failed", "danger") : null
    ];
  }
  function matchesType(r) {
    if (ui.type === "all") return true;
    if (ui.type === "advocacy") return r.advocacy_requested;
    return r.help === ui.type;
  }
  // Triage order: possible safety risk, then deadlines, then advocacy requests, then longest waiting.
  function priority(a, b) {
    function score(r) { return (r.safety_flag ? 8 : 0) + (r.deadline || r.due_on ? 4 : 0) + (r.advocacy_requested ? 2 : 0); }
    return score(b) - score(a) || new Date(a.received_at) - new Date(b.received_at);
  }
  function waiting(iso) {
    var hours = Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5);
    return hours < 1 ? "under an hour" : hours < 48 ? Math.round(hours) + " hours" : Math.round(hours / 24) + " days";
  }
  function staffName(id) {
    var hit = team.filter(function (s) { return s.user_id === id; })[0];
    return hit ? hit.display_name : "Unknown";
  }
  function mine(r) { return r.assigned_to === me.user_id; }
  function canChange(r) { return me.role === "admin" || mine(r); }

  function header() {
    var hours = String((cfg.POLICY || {}).REVIEW_HOURS || "").trim();
    return el("div", null, [
      el("div", { class: "dash-bar" }, [
        el("p", null, [el("strong", { text: me.display_name }), " · " + me.role]),
        el("div", { class: "chips" }, [
          el("button", { class: "btn btn-quiet btn-sm", type: "button", text: "Refresh", onclick: function () {
            ui.message = null;
            // If access has ended, call() has already signed the person out; nothing more to show.
            refresh().catch(function (err) { if (!/not_authorized/.test(err.message)) { ui.message = explain(err); draw(); } });
          } }),
          el("button", { class: "btn btn-quiet btn-sm", type: "button", text: "Sign out", onclick: function () { signOut(); } })
        ])
      ]),
      el("div", { class: "callout" }, el("p", null, [
        el("strong", { text: "Review hours: " }), hours || "TO BE CONFIRMED by the project owner", ". ",
        "This queue is not an emergency service. A student who did not share an email address cannot be replied to."
      ])),
      ui.message ? el("div", { class: "callout callout-warn", role: "alert" }, el("p", { text: ui.message })) : null
    ]);
  }

  function tabs() {
    var list = [["queue", "Queue"], ["team", "Team"]];
    if (me.role === "admin") list.push(["mail", "Email delivery"], ["log", "Activity log"]);
    return el("div", { class: "tabs", role: "tablist" }, list.map(function (t) {
      return el("button", {
        type: "button", role: "tab", "aria-selected": String(ui.tab === t[0]), text: t[1],
        onclick: function () { ui.tab = t[0]; ui.message = null; draw(); }
      });
    }));
  }

  function queue() {
    var counts = {};
    reports.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
    var statusTabs = el("div", { class: "tabs", role: "group", "aria-label": "Status" },
      Object.keys(flow.statuses).concat(["all"]).map(function (s) {
        var label = s === "all" ? "All (" + reports.length + ")" : flow.statuses[s] + " (" + (counts[s] || 0) + ")";
        return el("button", { type: "button", "aria-pressed": String(ui.status === s), text: label, onclick: function () { ui.status = s; draw(); } });
      }));
    var typeSelect = el("select", { id: "type-filter", onchange: function () { ui.type = typeSelect.value; draw(); } },
      TYPES.map(function (t) { return el("option", { value: t[0], selected: ui.type === t[0], text: t[1] }); }));
    var mineBox = el("input", { type: "checkbox", id: "mine-filter", checked: ui.mine, onchange: function () { ui.mine = mineBox.checked; draw(); } });

    var list = reports.filter(function (r) {
      return (ui.status === "all" || r.status === ui.status) && matchesType(r) && (!ui.mine || mine(r));
    }).sort(priority);

    var rows = list.length ? list.map(function (r) {
      var who = r.assigned_to ? "Assigned to " + (mine(r) ? "you" : r.assigned_name || "someone") : "Unassigned";
      var locked = !r.can_open;
      return el("li", null, el("button", {
        type: "button", "aria-current": String(ui.selected === r.id), disabled: locked,
        title: locked ? "You can’t open this case" : null,
        onclick: function () { ui.message = null; openCase(r.id).then(draw).then(function () { var h = document.getElementById("case-h"); if (h) h.focus(); }); }
      }, [
        el("strong", { text: flow.helpShort[r.help] || "Request" }),
        el("span", { class: "asked", text: r.id + " · waiting " + waiting(r.received_at) }),
        el("span", { class: "id", text: who + (locked ? " · not open to you" : "") + (r.categories && r.categories.length ? " · " + flow.labelFor("categories", r.categories) : "") }),
        el("span", { class: "flags" }, flags(r))
      ]));
    }) : [el("li", { class: "panel-body muted", text: reports.length ? "No cases match these filters." : "No submissions yet." })];

    return el("div", { class: "admin-grid" }, [
      el("div", { class: "panel" }, [
        el("div", { class: "panel-head" }, el("h2", { text: "Cases" })),
        el("div", { class: "panel-body" }, [
          statusTabs,
          el("div", { class: "field" }, [el("label", { for: "type-filter", text: "Request type" }), typeSelect]),
          el("label", { class: "check", for: "mine-filter" }, [mineBox, el("span", { text: "Only cases assigned to me" })])
        ]),
        el("ul", { class: "inbox" }, rows)
      ]),
      caseDetail()
    ]);
  }

  function permissionPanel(d) {
    var rep = d.report || {};
    var contact = d.contact_requested
      ? "Yes, by email: " + (rep.contact_email || "(not given)") + (rep.contact_name ? " · Name to use: " + rep.contact_name : "") +
        (rep.contact_discreet && rep.contact_discreet.value === "discreet" ? " · BE DISCREET: do not mention Pride Line" : "")
      : "No. The student asked not to be contacted.";
    var external = { no: "NOT PERMITTED. Do not contact any office or person about this case.", ask: "Ask the student first, every time.",
      anonymous: "Permitted without identifying the student.", named: "Permitted, and the student may be identified." }[rep.external_contact || "no"];
    return el("div", { class: "callout " + (rep.external_contact && rep.external_contact !== "no" ? "callout-ok" : "callout-danger") }, [
      el("h3", { text: "Permissions" }),
      el("dl", { class: "kv" }, [
        el("dt", { text: "Contact the student" }), el("dd", { text: contact }),
        el("dt", { text: "Contact others for them" }), el("dd", { text: external }),
        rep.external_contact_scope ? el("dt", { text: "Who, and what may be shared" }) : null,
        rep.external_contact_scope ? el("dd", { text: rep.external_contact_scope }) : null
      ]),
      el("p", { class: "small", text: "Asking for an advocate or for help with an office is not permission to contact anyone. Only the line above is." })
    ]);
  }

  function caseDetail() {
    var d = ui.detail;
    if (!d) {
      return el("div", { class: "panel" }, el("div", { class: "panel-body muted" }, el("p", {
        text: "Select a case to read it. Opening a case is recorded in its log with your name and the time."
      })));
    }
    var isLegacy = !d.report || d.report.version !== 3;
    var changeable = canChange(d);

    var answers = [];
    flow.describeReport(d.report).forEach(function (row) { answers.push(el("dt", { text: row[0] })); answers.push(el("dd", { text: row[1] })); });

    var statusSelect = el("select", {
      id: "status-select", disabled: !changeable,
      onchange: function () { act("staff_set_status", { p_public_id: d.id, p_status: statusSelect.value }); }
    }, Object.keys(flow.statuses).map(function (k) { return el("option", { value: k, selected: d.status === k, text: flow.statuses[k] }); }));

    var due = el("input", { id: "due-on", type: "date", value: d.due_on || "", disabled: !changeable,
      onchange: function () { act("staff_set_due", { p_public_id: d.id, p_due_on: due.value || null }); } });

    var assignment;
    if (me.role === "admin") {
      var assign = el("select", { id: "assign-select", onchange: function () { act("staff_assign", { p_public_id: d.id, p_user_id: assign.value || null }); } },
        [el("option", { value: "", selected: !d.assigned_to, text: "Unassigned" })].concat(team.filter(function (s) { return s.active; }).map(function (s) {
          return el("option", { value: s.user_id, selected: d.assigned_to === s.user_id, text: s.display_name + " (" + s.role + ")" });
        })));
      assignment = field("Assigned to", assign, d.advocacy_requested ? "Advocacy cases can only go to an advocate or an admin." : null);
    } else {
      assignment = el("div", { class: "field" }, [
        el("p", null, [el("strong", { text: "Assigned to: " }), d.assigned_to ? (mine(d) ? "you" : d.assigned_name) : "nobody yet"]),
        !d.assigned_to ? el("button", { class: "btn btn-sm", type: "button", text: "Claim this case", onclick: function () { act("staff_claim", { p_public_id: d.id }); } }) : null
      ]);
    }

    // Notes and contact attempts share one list; a contact attempt is marked with its channel.
    var noteBox = el("textarea", { id: "note-box", rows: "2", maxlength: "2000" });
    var notes = el("div", null, [
      el("h3", { text: "Internal notes and contact attempts" }),
      el("div", { class: "thread" }, d.notes.length ? d.notes.map(function (n) {
        return el("div", { class: "msg" + (n.kind === "contact_attempt" ? " mine" : "") }, [
          el("span", { class: "meta", text: (n.kind === "contact_attempt" ? "Contact attempt (" + n.channel + ") · " : "Note · ") + (n.by || "Unknown") + " · " + PR.formatDate(n.created_at) }), n.body
        ]);
      }) : [el("p", { class: "muted small", text: "Nothing yet." })]),
      el("form", { onsubmit: function (e) { e.preventDefault(); var body = noteBox.value.trim(); if (body) act("staff_add_note", { p_public_id: d.id, p_body: body }); } }, [
        field("Add an internal note", noteBox, "Never shown to the student. Keep notes factual."),
        el("button", { class: "btn btn-quiet btn-sm", type: "submit", text: "Save note" })
      ])
    ]);

    var contactLog = null;
    if (d.contact_requested && changeable) {
      var contactNote = el("textarea", { id: "contact-note", rows: "2", maxlength: "2000" });
      contactLog = el("form", { onsubmit: function (e) {
        e.preventDefault();
        var body = contactNote.value.trim();
        if (body) act("staff_log_contact", { p_public_id: d.id, p_channel: "email", p_note: body });
      } }, [
        field("Log a contact attempt (email)", contactNote, "This records that you wrote to the student from the team mailbox. Nothing is sent from this page."),
        el("button", { class: "btn btn-quiet btn-sm", type: "submit", text: "Log attempt" })
      ]);
    }

    // Reports from the earlier version of the site may have a tracking-page conversation.
    var legacy = null;
    if (isLegacy && (d.messages.length || d.legacy_contact_mode === "portal")) {
      var replyBox = el("textarea", { id: "reply-box", rows: "2", maxlength: "4000" });
      legacy = el("div", null, [
        el("h3", { text: "Tracking-page messages (earlier version)" }),
        el("div", { class: "thread" }, d.messages.map(function (m) {
          return el("div", { class: "msg" + (m.sender === "reviewer" ? " mine" : "") }, [
            el("span", { class: "meta", text: (m.sender === "reviewer" ? "Reviewer" : "Student") + " · " + PR.formatDate(m.created_at) }), m.body]);
        })),
        changeable && d.status !== "closed" && d.legacy_contact_mode !== "anonymous" ? el("form", { onsubmit: function (e) {
          e.preventDefault(); var body = replyBox.value.trim(); if (body) act("staff_reply", { p_public_id: d.id, p_body: body });
        } }, [field("Reply on the tracking page", replyBox, "The student sees this when they open the tracking page with their access code."),
          el("button", { class: "btn btn-quiet btn-sm", type: "submit", text: "Send reply" })]) : null
      ]);
    }

    var mail = el("div", null, [
      el("h3", { text: "Reviewer notification email" }),
      d.mail.length ? el("ul", { class: "plain" }, d.mail.map(function (m) {
        return el("li", null, [
          badge(m.status, m.status === "failed" ? "danger" : m.status === "sent" ? "ok" : null),
          " " + (m.recipient ? m.recipient + " · " : "") + "attempts: " + m.attempts +
          (m.sent_at ? " · sent " + PR.formatDate(m.sent_at) : "") + (m.error_category ? " · last error: " + m.error_category : "") + " ",
          me.role === "admin" && m.status === "failed" ? el("button", { class: "btn btn-quiet btn-sm", type: "button", text: "Retry",
            onclick: function () { act("staff_retry_notification", { p_outbox_id: m.outbox_id }); } }) : null
        ]);
      })) : el("p", { class: "muted small", text: "No notification was queued for this case." })
    ]);

    var log = el("details", null, [
      el("summary", { text: "Case log (" + d.log.length + ")" }),
      el("ul", { class: "plain small" }, d.log.map(function (a) {
        return el("li", { text: PR.formatDate(a.at) + " · " + a.by + " · " + a.action.replace(/_/g, " ") + (a.detail ? ": " + a.detail : "") });
      }))
    ]);

    var adminTools = null;
    if (me.role === "admin") {
      var restricted = (d.restricted || []).map(function (x) { return x.user_id; });
      var restrict = el("select", { id: "restrict-select" }, [el("option", { value: "", text: "Choose a person" })].concat(
        team.filter(function (s) { return restricted.indexOf(s.user_id) === -1; }).map(function (s) { return el("option", { value: s.user_id, text: s.display_name }); })));
      adminTools = el("details", null, [
        el("summary", { text: "Admin: conflicts of interest and deletion" }),
        el("p", { class: "small muted", text: "A restricted person cannot see this case at all, and cannot lift the restriction themself. Use this when a reviewer is involved in, or close to, what was reported." }),
        el("ul", { class: "plain" }, (d.restricted || []).map(function (x) {
          return el("li", null, [x.name + " is restricted ", el("button", { class: "btn btn-quiet btn-sm", type: "button", text: "Lift",
            onclick: function () { act("staff_set_restriction", { p_public_id: d.id, p_user_id: x.user_id, p_restricted: false }); } })]);
        })),
        el("div", { class: "chips" }, [restrict, el("button", { class: "btn btn-quiet btn-sm", type: "button", text: "Restrict this person",
          onclick: function () { if (restrict.value) act("staff_set_restriction", { p_public_id: d.id, p_user_id: restrict.value, p_restricted: true }); } })]),
        el("p", { class: "small muted", text: "Scheduled for automatic deletion on " + PR.formatDate(d.delete_after) + ". Deleting now removes the report and its notes for good. The log keeps only the reference number." }),
        el("button", { class: "btn btn-danger btn-sm", type: "button", text: "Delete this case",
          onclick: function () {
            if (!window.confirm("Delete " + d.id + " permanently? This cannot be undone.")) return;
            act("staff_delete_report", { p_public_id: d.id }, function () { ui.selected = null; ui.detail = null; });
          } })
      ]);
    }

    return el("div", { class: "panel" }, [
      el("div", { class: "panel-head" }, [
        el("h2", { id: "case-h", tabindex: "-1", text: d.id + ": " + (flow.helpShort[d.help] || "Request") }),
        el("span", { class: "flags" }, flags(d))
      ]),
      el("div", { class: "panel-body" }, [
        el("p", { class: "muted small", text: "Received " + PR.formatDate(d.received_at) + (isLegacy ? " · submitted with the earlier version of the site" : "") +
          (d.follow_up_attempted_at ? " · last contact attempt " + PR.formatDate(d.follow_up_attempted_at) : "") }),
        d.safety_flag ? notice("Safety flag: the student did not say they were safe, or chose the safety category. This is not an emergency line; follow the team’s escalation procedure.", "danger") : null,
        d.advocacy_requested ? notice("Advocacy requested. This is not consent to contact anyone: check Permissions below.", "warn") : null,
        el("div", { class: "case-controls" }, [assignment, field("Status", statusSelect), field("Team due date", due)]),
        d.deadline ? el("p", null, [el("strong", { text: "Deadline the student mentioned: " }), String(d.deadline).replace(/_/g, " ")]) : null,
        isLegacy ? null : permissionPanel(d),
        el("h3", { text: "What the student wrote (unedited)" }),
        el("dl", { class: "kv" }, answers),
        contactLog,
        notes,
        legacy,
        mail,
        el("div", { class: "chips no-print" }, [
          el("button", { class: "btn btn-quiet btn-sm", type: "button", text: "Print (logged)", onclick: function () {
            call("staff_log_disclosure", { p_public_id: d.id, p_kind: "exported", p_detail: "Printed from the dashboard" }).then(function () { window.print(); })
              .catch(function (err) { ui.message = explain(err); draw(); });
          } })
        ]),
        log,
        adminTools
      ])
    ]);
  }

  function teamTab() {
    var rows = team.map(function (s) {
      var cells = [el("td", { text: s.display_name + (s.user_id === me.user_id ? " (you)" : "") })];
      if (me.role !== "admin") { cells.push(el("td", { text: s.role })); return el("tr", null, cells); }
      var role = el("select", { "aria-label": "Role for " + s.display_name, disabled: s.user_id === me.user_id },
        ["admin", "reviewer", "advocate"].map(function (r) { return el("option", { value: r, selected: s.role === r, text: r }); }));
      role.addEventListener("change", function () { act("staff_admin_update", { p_user_id: s.user_id, p_role: role.value, p_active: s.active }); });
      cells.push(el("td", { text: s.email }), el("td", null, role), el("td", null, s.active ? badge("Active", "ok") : badge("Access removed", "danger")),
        el("td", null, s.user_id === me.user_id ? null : el("button", { class: "btn btn-quiet btn-sm", type: "button", text: s.active ? "Remove access" : "Restore access",
          onclick: function () {
            if (s.active && !window.confirm("Remove " + s.display_name + "’s access? It takes effect on their next action, and their open cases are released.")) return;
            act("staff_admin_update", { p_user_id: s.user_id, p_role: s.role, p_active: !s.active });
          } })));
      return el("tr", null, cells);
    });

    var invite = null;
    if (me.role === "admin") {
      var email = el("input", { id: "invite-email", type: "email", autocomplete: "off" });
      var name = el("input", { id: "invite-name", type: "text", maxlength: "80", autocomplete: "off" });
      var role = el("select", { id: "invite-role" }, ["reviewer", "advocate", "admin"].map(function (r) { return el("option", { value: r, text: r }); }));
      var status = el("p", { class: "small", role: "status" });
      invite = el("form", { class: "card", novalidate: true, onsubmit: function (e) {
        e.preventDefault();
        status.textContent = "Sending invitation…";
        callFunction("admin-users", { email: email.value.trim(), display_name: name.value.trim(), role: role.value }).then(function () {
          status.textContent = "Invitation sent to " + email.value.trim() + ". They choose their own password and set up their second sign-in step.";
          email.value = ""; name.value = "";
          return loadAll().then(draw);
        }).catch(function (err) {
          status.textContent = { invalid_email: "That email address doesn’t look right.", invalid_name: "Enter the person’s name.", forbidden: ERRORS.admin_only,
            invite_failed: "The invitation could not be sent. The address may already have an account." }[err.message] || explain(err);
        });
      } }, [
        el("h3", { text: "Invite a team member" }),
        el("p", { class: "muted small", text: "Each person gets their own account. Never share a sign-in. Only invite people who have completed reviewer training." }),
        field("Email", email), field("Name shown to the team", name), field("Role", role, "Reviewer: reads and works unassigned and own cases. Advocate: also handles advocacy requests. Admin: also assigns cases and manages the team."),
        el("button", { class: "btn btn-sm", type: "submit", text: "Send invitation" }), status
      ]);
    }
    return el("div", null, [
      el("div", { class: "table-wrap" }, el("table", null, [
        el("thead", null, el("tr", null, (me.role === "admin" ? ["Name", "Email", "Role", "Access", ""] : ["Name", "Role"]).map(function (h) { return el("th", { scope: "col", text: h }); }))),
        el("tbody", null, rows)
      ])),
      invite
    ]);
  }

  function mailTab() {
    var host = el("div", null, el("p", { class: "muted", text: "Loading…" }));
    call("staff_mail_queue").then(function (rows) {
      clear(host);
      var status = el("span", { class: "small", role: "status" });
      host.appendChild(el("p", { class: "muted", text: "One notification is queued per reviewer mailbox for each submission. A submission is always stored, whether or not its email goes out. Failed sends are retried automatically a few times, then wait here." }));
      host.appendChild(el("div", { class: "chips" }, [
        el("button", { class: "btn btn-sm", type: "button", text: "Send due emails now", onclick: function () {
          status.textContent = "Sending…";
          callFunction("send-notifications").then(function (r) {
            // Kept in ui.message so the result survives the redraw that refreshes the table.
            ui.message = "Sent " + r.sent + ", will retry " + r.requeued + ", failed " + r.failed + ".";
            return loadAll();
          }).then(draw).catch(function (err) { status.textContent = explain(err); });
        } }), status]));
      host.appendChild(el("div", { class: "table-wrap" }, el("table", null, [
        el("thead", null, el("tr", null, ["Case", "To", "Status", "Attempts", "Last attempt", "Last error", ""].map(function (h) { return el("th", { scope: "col", text: h }); }))),
        el("tbody", null, rows.length ? rows.map(function (m) {
          return el("tr", null, [
            el("td", { text: m.id }), el("td", { text: m.recipient }),
            el("td", null, badge(m.status, m.status === "failed" ? "danger" : m.status === "sent" ? "ok" : null)),
            el("td", { text: m.attempts + " of " + m.max_attempts }), el("td", { text: m.last_attempt_at ? PR.formatDate(m.last_attempt_at) : "not yet" }),
            el("td", { text: m.error_category || "" }),
            el("td", null, m.status === "failed" ? el("button", { class: "btn btn-quiet btn-sm", type: "button", text: "Retry",
              onclick: function () { act("staff_retry_notification", { p_outbox_id: m.outbox_id }); } }) : null)
          ]);
        }) : [el("tr", null, el("td", { colspan: "7", class: "muted", text: "No notifications yet." }))])
      ])));
    }).catch(function (err) { clear(host); host.appendChild(notice(explain(err), "warn")); });
    return host;
  }

  function logTab() {
    var host = el("div", null, el("p", { class: "muted", text: "Loading…" }));
    call("staff_audit_log", { p_limit: 300 }).then(function (rows) {
      clear(host);
      host.appendChild(el("p", { class: "muted", text: "Every read, assignment, status change, note, contact attempt, export and team change, with who did it and when. The log never contains what a student wrote." }));
      host.appendChild(el("div", { class: "table-wrap" }, el("table", null, [
        el("thead", null, el("tr", null, ["When", "Who", "Action", "Case", "Detail"].map(function (h) { return el("th", { scope: "col", text: h }); }))),
        el("tbody", null, rows.map(function (a) {
          return el("tr", null, [PR.formatDate(a.at), a.actor, a.action.replace(/_/g, " "), a.public_id || "", a.detail || ""].map(function (c) { return el("td", { text: c }); }));
        }))
      ])));
    }).catch(function (err) { clear(host); host.appendChild(notice(explain(err), "warn")); });
    return host;
  }

  function draw() {
    if (!me) return;
    var body = ui.tab === "queue" ? queue() : ui.tab === "team" ? teamTab() : ui.tab === "mail" ? mailTab() : logTab();
    show([header(), tabs(), body]);
  }

  // A sign-out in this tab (or an expired session) always returns to the sign-in form.
  client.auth.onAuthStateChange(function (event) {
    if (event === "SIGNED_OUT" && me) { me = null; viewSignIn(ERRORS.not_authorized); }
    if (event === "PASSWORD_RECOVERY") { arrivedByLink = true; viewSetPassword(); }
  });

  show(notice("Checking your sign-in…"));
  // Give the library a moment to pick up an invitation or reset token from the address.
  window.setTimeout(afterSession, arrivedByLink ? 600 : 0);
})();
