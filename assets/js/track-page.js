/* Earlier access codes only. Students who were given a code by the first version of the site can
 * still read replies and add a message. New submissions do not get a code. */
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
  var currentCode = null;

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function show(view) {
    clear(result);
    var thread = el("div", { class: "thread" }, view.messages.length
      ? view.messages.map(function (m) {
        return el("div", { class: "msg" + (m.sender === "student" ? " mine" : "") }, [
          el("span", { class: "meta", text: (m.sender === "student" ? "You" : "Student reviewer") + " · " + PR.formatDate(m.created_at) }),
          m.body
        ]);
      })
      : [el("p", { class: "muted", text: "No messages yet." })]);

    var messaging = el("section", { class: "section", "aria-labelledby": "msg-h" }, [
      el("h2", { id: "msg-h", tabindex: "-1", text: "Report " + view.id }),
      el("p", { class: "muted", text: "Submitted " + PR.formatDate(view.created_at) + " · Status: " + (flow.statuses[view.status] || view.status) }),
      thread
    ]);

    if (view.contact_mode === "anonymous") {
      messaging.appendChild(el("p", { class: "small muted", text: "This was submitted anonymously without follow-up, so reviewers can’t message you here." }));
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
          el("label", { for: "reply", text: "Add a message" }),
          box,
          el("p", { class: "help", text: "Not monitored live. In an emergency call University Public Safety at (203) 932-7070, or call 911." })
        ]),
        err, send
      ]));
    }
    result.appendChild(messaging);

    var rows = [];
    flow.describeReport(view.report).forEach(function (row) {
      rows.push(el("dt", { text: row[0] }));
      rows.push(el("dd", { text: row[1] }));
    });
    result.appendChild(el("section", { class: "section", "aria-labelledby": "sub-h" }, [
      el("h2", { id: "sub-h", text: "What you submitted" }),
      el("div", { class: "card" }, el("dl", { class: "kv" }, rows))
    ]));
    document.getElementById("msg-h").focus();
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
          ? "Nothing was found for that code. Check it and try again. Reports are also removed after the retention period."
          : "This could not be loaded. Please try again.";
    }).then(function () { button.disabled = false; });
  });
})();
