/* Demo reviewer dashboard. Works only on the browser-local demo store.
 * It exists to show reviewers and partners the workflow: inbox, case detail, replies, internal notes,
 * referrals, audit log, suppressed statistics and deletion. It makes no judgments about any report. */
(function () {
  "use strict";
  var PR = window.PR;
  var el = PR.el;
  var flow = PR.flow;
  var app = document.getElementById("app");
  var SUPPRESS_BELOW = 5;

  if (!PR.store.isDemo) {
    app.appendChild(el("div", { class: "callout" }, el("p", {
      text: PR.store.mode === "email"
        ? "Reports are delivered to the reviewers’ inbox by email, so there is no dashboard to show here. Reports are not accessible from this page."
        : "This site is in live mode. The live reviewer dashboard (sign-in with two-factor authentication) has not been built yet, so there is nothing to show here. Reports are not accessible from this page."
    })));
    return;
  }

  var admin = PR.store.admin;
  var state = { tab: "cases", selected: null, filter: "all" };

  function daysAgo(n) { return new Date(Date.now() - n * 864e5).toISOString(); }
  function fict(id, days, status, mode, r, messages, notes) {
    return {
      id: id, code_hash: null, created_at: daysAgo(days), status: status, fictional: true,
      report: Object.assign({
        version: 2, needs: ["document"], advocate_consent: null, office_which: null, support_kind: null,
        conflict_with: null, conflict_contact: null, path: "incident", category: null, what: null, when: null,
        where: null, who: null, frequency: null, role: null, reported: null, outcome: null, timing: null,
        anything_else: null, contact_mode: mode, contact_name: null, contact_method: null, contact_discreet: null
      }, r),
      messages: messages || [], notes: notes || [], referrals: []
    };
  }
  var v = function (value) { return { value: value }; };

  admin.seed([
    fict("PR-1042", 1, "received", "portal", {
      needs: ["conflict", "support"], conflict_with: v("roommate"), conflict_contact: v("ask_first"), support_kind: v("talk"),
      category: v("harassment"), where: v("residence"), who: v("student"), frequency: v("repeated"), role: v("experienced"), reported: v("no"),
      what: "[Fictional] People on my floor keep making comments when my partner visits. It has happened three times this month.",
      outcome: "[Fictional] I want it to stop without it becoming a big thing.", timing: v("weeks")
    }),
    fict("PR-1041", 3, "under_review", "identified", {
      needs: ["advocate", "office"], advocate_consent: v("without_name"), office_which: v("academic"),
      category: v("deadnaming"), where: v("academic"), who: v("faculty"), frequency: v("repeated"), role: v("experienced"), reported: v("unsure"),
      what: "[Fictional] An instructor keeps using the wrong name for me in class after I asked them not to.",
      outcome: "[Fictional] The roster fixed and the instructor using my name.", timing: v("days"),
      contact_name: "Sample Student", contact_method: "sample@example.com", contact_discreet: v("discreet")
    }, [], [{ body: "Matches two earlier classroom reports this term. Watching for a pattern.", at: daysAgo(2), by: "Demo reviewer" }]),
    fict("PR-1040", 6, "response_available", "portal", {
      needs: ["office"], office_which: v("athletics"), path: "concern", category: v("facilities"), where: v("athletics"), frequency: v("ongoing"),
      what: "[Fictional] There is no all-gender changing space near the rec center pool.", outcome: "[Fictional] A private changing option."
    }, [{ sender: "reviewer", body: "Thanks for flagging this. We have shared the Myatt Center contact below, and with your OK we can raise it as a general facilities concern without mentioning you.", created_at: daysAgo(4) }]),
    fict("PR-1039", 9, "closed", "anonymous", { path: "concern", category: v("climate"), where: v("common"), frequency: v("once"), what: "[Fictional] A hostile sticker on a bulletin board near the dining hall." }),
    fict("PR-1038", 12, "closed", "identified", { needs: ["conflict", "office"], conflict_with: v("roommate"), conflict_contact: v("ok"), office_which: v("housing"), category: v("housing"), where: v("residence"), who: v("student"), frequency: v("ongoing"), role: v("experienced"), reported: v("yes"), what: "[Fictional] Roommate conflict after I came out.", contact_name: "Sample Student", contact_method: "sample@example.com", contact_discreet: v("ok") }),
    fict("PR-1037", 15, "closed", "anonymous", { category: v("harassment"), where: v("online"), who: v("unknown"), frequency: v("repeated"), role: v("witnessed") }),
    fict("PR-1036", 20, "closed", "portal", { needs: ["support"], support_kind: v("resources"), category: v("harassment"), where: v("residence"), who: v("student"), frequency: v("once"), role: v("experienced") }),
    fict("PR-1035", 24, "closed", "anonymous", { needs: ["official"], category: v("deadnaming"), where: v("office"), who: v("staff"), frequency: v("repeated"), role: v("experienced") }),
    fict("PR-1034", 31, "closed", "anonymous", { category: v("harassment"), where: v("common"), who: v("student"), frequency: v("once"), role: v("witnessed") }),
    fict("PR-1033", 38, "closed", "anonymous", { category: v("harassment"), where: v("residence"), who: v("student"), frequency: v("repeated"), role: v("heard") }),
    fict("PR-1032", 45, "closed", "portal", { needs: ["advocate"], advocate_consent: v("ask_first"), category: v("deadnaming"), where: v("academic"), who: v("faculty"), frequency: v("repeated"), role: v("experienced") }),
    fict("PR-1031", 52, "closed", "anonymous", { needs: ["support", "advocate"], support_kind: v("accompany"), advocate_consent: v("unsure"), category: v("discrimination"), where: v("office"), who: v("staff"), frequency: v("once"), role: v("experienced") })
  ]);

  function asksForHelp(r) {
    return (r.report.needs || []).some(function (n) { return flow.helpNeeds.indexOf(n) !== -1; });
  }
  function title(r) {
    var cat = r.report.category ? flow.labelFor("category", r.report.category) : "Uncategorized";
    var where = r.report.where ? flow.labelFor("where", r.report.where) : null;
    return cat + (where ? " · " + where : "");
  }
  function asked(r) {
    var needs = (r.report.needs || []).filter(function (n) { return flow.helpNeeds.indexOf(n) !== -1; });
    return needs.length ? "Asked: " + flow.labelFor("needs", needs) : null;
  }
  function awaitingReply(r) {
    if (r.status === "closed" || r.report.contact_mode === "anonymous") return false;
    var last = r.messages[r.messages.length - 1];
    if (last) return last.sender === "student";
    return asksForHelp(r);
  }
  function badge(status) { return el("span", { class: "badge badge-" + status, text: flow.statuses[status].label }); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function stats(db) {
    return el("div", { class: "stats" }, [
      ["Reports", db.reports.length],
      ["Unreviewed", db.reports.filter(function (r) { return r.status === "received"; }).length],
      ["Awaiting reply", db.reports.filter(awaitingReply).length]
    ].map(function (s) { return el("div", { class: "stat" }, [el("b", { text: String(s[1]) }), el("span", { text: s[0] })]); }));
  }

  function tabs() {
    return el("div", { class: "tabs", role: "tablist" }, [["cases", "Cases"], ["trends", "Trends"], ["audit", "Audit log"]].map(function (t) {
      return el("button", {
        type: "button", role: "tab", "aria-selected": String(state.tab === t[0]), text: t[1],
        onclick: function () {
          state.tab = t[0];
          if (t[0] === "trends") admin.mutate(null, "viewed_statistics");
          draw();
        }
      });
    }));
  }

  function inbox(db) {
    var list = db.reports.filter(function (r) { return state.filter === "all" || r.status === state.filter; });
    var select = el("select", {
      "aria-label": "Filter by status",
      onchange: function () { state.filter = select.value; draw(); }
    }, [["all", "All statuses"]].concat(Object.keys(flow.statuses).map(function (k) { return [k, flow.statuses[k].label]; })).map(function (o) {
      return el("option", { value: o[0], selected: state.filter === o[0], text: o[1] });
    }));
    return el("div", { class: "panel" }, [
      el("div", { class: "panel-head" }, [el("h2", { text: "Incoming reports" }), el("div", { class: "field" }, select)]),
      el("ul", { class: "inbox" }, list.length ? list.map(function (r) {
        return el("li", null, el("button", {
          type: "button", "aria-current": String(state.selected === r.id),
          onclick: function () { open(r.id); }
        }, [
          el("strong", { text: title(r) }),
          asked(r) ? el("span", { class: "asked", text: asked(r) }) : null,
          el("span", { class: "id", text: r.id + (r.fictional ? " · Fictional" : " · From this browser") + (awaitingReply(r) ? " · Awaiting reply" : "") }),
          badge(r.status)
        ]));
      }) : [el("li", { class: "panel-body muted", text: "No reports with this status." })])
    ]);
  }

  function open(id) {
    state.selected = id;
    admin.mutate(id, "opened_report", function (r) { if (r.status === "received") r.status = "under_review"; });
    draw();
    var h = document.getElementById("case-h");
    if (h) h.focus();
  }

  function detail(db) {
    var r = db.reports.filter(function (x) { return x.id === state.selected; })[0];
    if (!r) {
      return el("div", { class: "panel" }, el("div", { class: "panel-body muted" }, el("p", {
        text: "Select a report to read it. Opening a report is recorded in the audit log and marks it as under review."
      })));
    }
    var rep = r.report;
    var rows = [];
    function row(label, value) { rows.push(el("dt", { text: label })); rows.push(el("dd", { text: value })); }
    row("Submitted", PR.formatDate(r.created_at));
    flow.describeReport(rep).forEach(function (pair) { row(pair[0], pair[1]); });

    var statusSelect = el("select", {
      id: "status-select",
      onchange: function () {
        var next = statusSelect.value;
        admin.mutate(r.id, "status_" + next, function (x) { x.status = next; });
        draw();
      }
    }, Object.keys(flow.statuses).map(function (k) { return el("option", { value: k, selected: r.status === k, text: flow.statuses[k].label }); }));

    var keys = PR.resources.byCategory[rep.category && rep.category.value] || PR.resources.byCategory.other;
    var referrals = el("div", { class: "consent" }, keys.map(function (k) {
      var id = "ref-" + k;
      var box = el("input", {
        type: "checkbox", id: id, checked: r.referrals.indexOf(k) !== -1,
        onchange: function () {
          admin.mutate(r.id, (box.checked ? "recorded_referral:" : "removed_referral:") + k, function (x) {
            var at = x.referrals.indexOf(k);
            if (box.checked && at === -1) x.referrals.push(k);
            if (!box.checked && at !== -1) x.referrals.splice(at, 1);
          });
        }
      });
      return el("label", { class: "check", for: id }, [box, el("span", { text: PR.resources.items[k].name })]);
    }));

    var canMessage = rep.contact_mode !== "anonymous" && r.status !== "closed";
    var replyBox = el("textarea", { id: "reply-box", rows: "3", maxlength: "4000" });
    var replyForm = canMessage ? el("form", {
      onsubmit: function (e) {
        e.preventDefault();
        var body = replyBox.value.trim();
        if (!body) return;
        admin.mutate(r.id, "replied_to_student", function (x) {
          x.messages.push({ sender: "reviewer", body: body, created_at: new Date().toISOString() });
          x.status = "response_available";
        });
        draw();
      }
    }, [
      el("div", { class: "field" }, [
        el("label", { for: "reply-box", text: "Reply to the student" }),
        replyBox,
        el("p", { class: "help", text: "Visible to the student on the My report page. Share options and resources; don’t promise outcomes or make findings." })
      ]),
      el("button", { class: "btn btn-sm", type: "submit", text: "Send reply" })
    ]) : el("p", { class: "small muted", text: rep.contact_mode === "anonymous"
      ? "Submitted anonymously without follow-up: replies are not possible."
      : "Closed reports can’t receive messages." });

    var noteBox = el("textarea", { id: "note-box", rows: "2", maxlength: "2000" });
    var noteForm = el("form", {
      onsubmit: function (e) {
        e.preventDefault();
        var body = noteBox.value.trim();
        if (!body) return;
        admin.mutate(r.id, "added_internal_note", function (x) { x.notes.push({ body: body, at: new Date().toISOString(), by: "Demo reviewer" }); });
        draw();
      }
    }, [
      el("div", { class: "field" }, [
        el("label", { for: "note-box", text: "Add an internal note" }),
        noteBox,
        el("p", { class: "help", text: "Never shown to the student." })
      ]),
      el("button", { class: "btn btn-quiet btn-sm", type: "submit", text: "Save note" })
    ]);

    return el("div", { class: "panel" }, [
      el("div", { class: "panel-head" }, [
        el("h2", { id: "case-h", tabindex: "-1", text: r.id + ": " + title(r) }),
        r.fictional ? el("span", { class: "badge", text: "Fictional" }) : el("span", { class: "badge", text: "From this browser" })
      ]),
      el("div", { class: "panel-body" }, [
        el("div", { class: "field" }, [el("label", { for: "status-select", text: "Status" }), statusSelect]),
        el("h3", { text: "Original submission" }),
        el("dl", { class: "kv" }, rows),
        el("h3", { text: "Messages with the student" }),
        el("div", { class: "thread" }, r.messages.length ? r.messages.map(function (m) {
          return el("div", { class: "msg" + (m.sender === "reviewer" ? " mine" : "") }, [
            el("span", { class: "meta", text: (m.sender === "reviewer" ? "Reviewer" : "Student") + " · " + PR.formatDate(m.created_at) }), m.body
          ]);
        }) : [el("p", { class: "muted small", text: "No messages yet." })]),
        replyForm,
        el("h3", { text: "Resources shared" }),
        referrals,
        el("h3", { text: "Internal notes" }),
        el("div", { class: "thread" }, r.notes.length ? r.notes.map(function (n) {
          return el("div", { class: "msg" }, [el("span", { class: "meta", text: n.by + " · " + PR.formatDate(n.at) }), n.body]);
        }) : [el("p", { class: "muted small", text: "No notes yet." })]),
        noteForm,
        el("h3", { text: "Retention" }),
        el("p", { class: "small muted", text: "Deleting removes the report, its messages and notes. The audit log keeps only the reference number." }),
        el("button", {
          class: "btn btn-danger btn-sm", type: "button", text: "Delete this report",
          onclick: function () {
            if (!window.confirm("Delete " + r.id + " permanently?")) return;
            admin.remove(r.id);
            state.selected = null;
            draw();
          }
        })
      ])
    ]);
  }

  function trends(db) {
    function tally(getKey) {
      var counts = {};
      db.reports.forEach(function (r) { var k = getKey(r); counts[k] = (counts[k] || 0) + 1; });
      return counts;
    }
    function chart(heading, counts, labelOf) {
      var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
      var max = Math.max.apply(null, keys.map(function (k) { return counts[k]; }).concat([1]));
      return el("div", { class: "panel" }, [
        el("div", { class: "panel-head" }, el("h2", { text: heading })),
        el("div", { class: "panel-body" }, keys.map(function (k) {
          var n = counts[k];
          var hidden = n < SUPPRESS_BELOW;
          var fill = el("div");
          fill.style.width = (hidden ? 0 : Math.round((n / max) * 100)) + "%";
          return el("div", { class: "bar-row" }, [
            el("span", { text: labelOf(k) }),
            el("div", { class: "bar", "aria-hidden": "true" }, fill),
            el("span", { class: "n", text: hidden ? "<" + SUPPRESS_BELOW : String(n) })
          ]);
        }))
      ]);
    }
    return el("div", null, [
      el("p", { class: "muted", text: "De-identified counts only. Any group smaller than " + SUPPRESS_BELOW + " is shown as “<" + SUPPRESS_BELOW + "” so that a single student’s report can’t be singled out. Trends describe what was reported, not what was confirmed." }),
      el("div", { class: "cards" }, [
        chart("What students asked for", (function () {
          var counts = {};
          db.reports.forEach(function (r) { (r.report.needs || []).forEach(function (n) { counts[n] = (counts[n] || 0) + 1; }); });
          return counts;
        })(), function (k) { return flow.labelFor("needs", k); }),
        chart("By category", tally(function (r) { return r.report.category ? r.report.category.value : "none"; }), function (k) {
          return k === "none" ? "Uncategorized" : k === "other" ? "Other (own words)" : flow.labelFor("category", k);
        }),
        chart("By location", tally(function (r) { return r.report.where ? r.report.where.value : "none"; }), function (k) {
          return k === "none" ? "Not given" : k === "other" ? "Other (own words)" : flow.labelFor("where", k);
        })
      ])
    ]);
  }

  function audit(db) {
    return el("div", { class: "table-wrap" }, el("table", null, [
      el("thead", null, el("tr", null, ["When", "Who", "Action", "Report"].map(function (h) { return el("th", { scope: "col", text: h }); }))),
      el("tbody", null, db.audit.length ? db.audit.map(function (a) {
        return el("tr", null, [PR.formatDate(a.at), a.actor, a.action.replace(/_/g, " "), a.report || "none"].map(function (c) { return el("td", { text: c }); }));
      }) : [el("tr", null, el("td", { colspan: "4", class: "muted", text: "Nothing recorded yet. Open a report to see an entry appear." }))])
    ]));
  }

  function draw() {
    var db = admin.load();
    clear(app);
    app.appendChild(stats(db));
    app.appendChild(tabs());
    if (state.tab === "cases") app.appendChild(el("div", { class: "admin-grid" }, [inbox(db), detail(db)]));
    else if (state.tab === "trends") app.appendChild(trends(db));
    else app.appendChild(audit(db));
  }

  draw();
})();
