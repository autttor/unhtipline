/* "My report": look up a report by access code, read reviewer messages, reply. */
(function () {
  "use strict";
  var PR = window.PR;
  var el = PR.el;
  var flow = PR.flow;
  var form = document.getElementById("lookup");
  var codeInput = document.getElementById("code");
  var codeError = document.getElementById("code-error");
  var button = document.getElementById("lookup-btn");
  var result = document.getElementById("result");
  var ORDER = ["received", "under_review", "response_available", "closed"];
  var currentCode = null;

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function timeline(status) {
    var at = ORDER.indexOf(status);
    return el("ol", { class: "timeline" }, ORDER.map(function (key, i) {
      var s = flow.statuses[key];
      return el("li", { class: (i <= at ? "done" : "") + (i === at ? " now" : "") }, [
        el("span", { class: "visually-hidden", text: i <= at ? "Completed: " : "Not yet: " }),
        el("div", null, [el("strong", { text: s.label }), el("p", { text: s.detail })])
      ]);
    }));
  }

  function show(view) {
    clear(result);
    var report = view.report || {};

    result.appendChild(el("section", { class: "section", "aria-labelledby": "status-h" }, [
      el("h2", { id: "status-h", tabindex: "-1", text: "Report " + view.id }),
      el("p", { class: "muted", text: "Submitted " + PR.formatDate(view.created_at) }),
      el("div", { class: "card" }, timeline(view.status))
    ]));

    // Messages
    var thread = el("div", { class: "thread" }, view.messages.length
      ? view.messages.map(function (m) {
        return el("div", { class: "msg" + (m.sender === "student" ? " mine" : "") }, [
          el("span", { class: "meta", text: (m.sender === "student" ? "You" : "Student reviewer") + " · " + PR.formatDate(m.created_at) }),
          m.body
        ]);
      })
      : [el("p", { class: "muted", text: "No messages yet." })]);

    var messaging = el("section", { class: "section", "aria-labelledby": "msg-h" }, [el("h2", { id: "msg-h", text: "Messages" }), thread]);

    if (view.contact_mode === "anonymous") {
      messaging.appendChild(el("p", { class: "small muted", text: "You submitted anonymously without follow-up, so reviewers can’t message you here. If you’d like a conversation, you can submit a new report and choose private follow-up." }));
    } else if (view.status === "closed") {
      messaging.appendChild(el("p", { class: "small muted", text: "This report is closed, so it can’t receive new messages." }));
    } else {
      var box = el("textarea", { id: "reply", rows: "4", maxlength: "4000" });
      var err = el("p", { class: "error", role: "alert" });
      var send = el("button", { class: "btn", type: "submit", text: "Send message" });
      messaging.appendChild(el("form", {
        class: "card", novalidate: true,
        onsubmit: function (e) {
          e.preventDefault();
          err.textContent = "";
          var body = box.value.trim();
          if (!body) { err.textContent = "Write a message first."; box.focus(); return; }
          send.disabled = true;
          PR.store.sendMessage(currentCode, body).then(show).catch(function () {
            send.disabled = false;
            err.textContent = "The message could not be sent. Please try again.";
          });
        }
      }, [
        el("div", { class: "field" }, [
          el("label", { for: "reply", text: "Add a message or more information" }),
          box,
          el("p", { class: "help", text: "Not monitored live. In an emergency call University Public Safety at (203) 932-7070, or call 911." })
        ]),
        err, send
      ]));
    }
    result.appendChild(messaging);

    // What was submitted
    var rows = [];
    flow.describeReport(report).forEach(function (row) {
      rows.push(el("dt", { text: row[0] }));
      rows.push(el("dd", { text: row[1] }));
    });
    result.appendChild(el("section", { class: "section", "aria-labelledby": "sub-h" }, [
      el("h2", { id: "sub-h", text: "What you submitted" }),
      el("div", { class: "card" }, el("dl", { class: "kv" }, rows)),
      el("div", { class: "chips no-print" }, [
        el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Print or save as PDF", onclick: function () { window.print(); } })
      ]),
      el("p", { class: "small muted", text: "A printed copy is yours to keep or to share with a University office if you decide to. Pride Report won’t share it for you without asking." })
    ]));

    var cat = report.category ? report.category.value : "other";
    result.appendChild(el("section", { class: "section", "aria-labelledby": "res-h" }, [
      el("h2", { id: "res-h", text: "Options that may be relevant" }),
      el("div", { class: "cards" }, PR.resources.forCategory(cat).map(function (r) {
        return el("div", { class: "card resource" }, [
          el("span", { class: "tag" + (r.tone === "official" ? " tag-official" : ""), text: r.tag }),
          el("h3", { text: r.name }),
          el("p", { text: r.what }),
          el("ul", { class: "resource-contacts" }, r.contacts.map(function (c) {
            return el("li", null, [c.label + ": ", el("a", { href: c.href, text: c.text })]);
          }))
        ]);
      }))
    ]));

    document.getElementById("status-h").focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    codeError.textContent = "";
    var clean = PR.store.normalizeCode(codeInput.value);
    if (!clean) {
      codeError.textContent = "That doesn’t look like an access code. It has the form PR-XXXX-XXXX-XXXX.";
      codeInput.focus();
      return;
    }
    button.disabled = true;
    PR.store.lookup(clean).then(function (view) {
      currentCode = clean;
      codeInput.value = "";
      show(view);
    }).catch(function (err) {
      clear(result);
      // Same message whether the code is wrong or the report was deleted, so codes can't be probed.
      codeError.textContent = err && err.status === 429
        ? "Too many attempts from this connection. Please wait a while and try again."
        : err && (err.message === "not_found" || err.status === 404)
          ? "No report was found for that code. Check it and try again. Reports are also removed after the retention period."
          : "The report could not be loaded. Please try again.";
    }).then(function () { button.disabled = false; });
  });
})();
