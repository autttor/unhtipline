/* Pride Guide chat UI. Renders the engine's current node and feeds answers back into it.
 *
 * Two states:
 *   open     submissions go to the server, and success is shown only after the server confirms it
 *   closed   the page explains that intake is not open; a preview walks through the questions and
 *            ends with "nothing was sent or saved". There is no fake receipt.
 */
(function () {
  "use strict";
  var PR = window.PR;
  var el = PR.el;
  var flow = PR.flow;
  var store = PR.store;
  var cfg = window.PR_CONFIG || {};
  var DRAFT_KEY = "pride-report-draft-v3";
  var open = store.isOpen();

  flow.context.preview = !open;
  flow.context.policy = cfg.POLICY || {};
  flow.context.services = cfg.SERVICES || flow.context.services;

  var chat = document.getElementById("chat");
  var closedPanel = document.getElementById("closed");
  var log = document.getElementById("log");
  var optionsBox = document.getElementById("options");
  var input = document.getElementById("composer-input");
  var sendBtn = document.getElementById("send");
  var skipBtn = document.getElementById("skip");
  var backBtn = document.getElementById("back");
  var restartBtn = document.getElementById("restart");
  var hint = document.getElementById("composer-hint");
  var counter = document.getElementById("composer-count");
  var composer = document.getElementById("composer");
  var bar = document.getElementById("progress-bar");
  var progress = document.getElementById("progress");
  var stageLabel = document.getElementById("stage-label");
  var stageList = document.getElementById("stage-list");

  // The five parts of the conversation, used for the progress label and the desktop sidebar.
  var STAGES = ["Safety check", "How we can help", "Your situation", "Contact and privacy", "Review and submit"];

  var startedAt = Date.now();
  var alertsShown = {};
  var multiPicked = [];

  // The draft lives in sessionStorage so a refresh doesn't lose the conversation, and closing the tab does.
  var saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { saved = null; }
  var engine = PR.engine.createEngine(flow, saved && saved.state);
  // One key per report. A retry after a dropped connection reuses it, so it can't create a duplicate.
  var idem = (saved && saved.idem) || store.newIdempotencyKey();

  function persist() {
    try {
      if (engine.node.type === "end") sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ state: engine.snapshot(), idem: idem }));
    } catch (e) { /* private browsing: the draft simply won't survive a refresh */ }
  }

  function scrollToEnd() {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }

  function bubble(text, kind) {
    var b = el("div", { class: "bubble fresh" + (kind ? " " + kind : ""), text: text });
    log.appendChild(b);
    return b;
  }

  function linkRow(links) {
    if (!links || !links.length) return;
    log.appendChild(el("div", { class: "chips link-row" }, links.map(function (l) {
      if (l.action === "exit") {
        return el("button", { class: "btn btn-danger btn-sm", type: "button", text: l.label, onclick: PR.quickExit });
      }
      return el("a", {
        class: "btn btn-ghost btn-sm", href: l.href,
        target: l.newTab ? "_blank" : null, rel: l.newTab ? "noopener" : null,
        text: l.label + (l.newTab ? " (new tab)" : "")
      });
    })));
  }

  function resourceCards(topic) {
    var list = PR.resources.forTopic(topic);
    if (!list.length) return null;
    return el("div", { class: "cards" }, list.map(PR.resourceCard));
  }

  // Shown at once when an answer mentions self-harm or a threat. Each kind is shown only once.
  function showAlert(kind) {
    if (!kind || alertsShown[kind]) return;
    alertsShown[kind] = true;
    var safety = [
      "University Public Safety at ", el("a", { href: "tel:+12039327070", text: "(203) 932-7070" }),
      ", or ", el("a", { href: "tel:911", text: "911" })
    ];
    var body = kind === "crisis"
      ? [el("strong", { text: "You mentioned something that sounds really heavy. " }),
        "This is an automated tool and nobody is reading it live. If you are thinking about harming yourself, you can reach a person right now: call or text ",
        el("a", { href: "tel:988", text: "988" }), ". If you are in immediate danger, call "].concat(safety, [". You can keep going whenever you’re ready."])
      : [el("strong", { text: "If anyone is in danger right now, don’t wait for us. " }),
        "This is an automated tool, nobody is reading it live, and it can’t send help. Call "].concat(safety, [". You can keep going with this whenever you’re ready."]);
    log.appendChild(el("div", { class: "bubble urgent fresh", role: "alert" }, body));
  }

  function setProgress() {
    var node = engine.node;
    var step = node.step || 0;
    var pct = Math.round((step / flow.totalSteps) * 100);
    bar.style.width = pct + "%";
    progress.setAttribute("aria-valuenow", String(pct));
    var done = node.type === "end";
    stageLabel.textContent = done ? (node.receipt ? "Finished" : "Ended without sending")
      : "Part " + (step + 1) + " of " + STAGES.length + ": " + STAGES[step];
    if (stageList) {
      Array.prototype.forEach.call(stageList.children, function (li, i) {
        li.className = done && node.receipt ? "done" : i < step ? "done" : i === step && !done ? "now" : "";
        if (i === step && !done) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
      });
    }
  }

  function clearOptions() {
    while (optionsBox.firstChild) optionsBox.removeChild(optionsBox.firstChild);
  }

  function give(answer, shownText) {
    var before = engine.id;
    var node = engine.node;
    var result = engine.answer(answer);
    if (!result.ok) return false;
    bubble(shownText || PR.engine.describe(answer), "user");
    showAlert(flow.alertFor(node, answer));
    render(before);
    return true;
  }

  function nudge(error, max) {
    var messages = {
      choose_option: "Please choose one of the options above.",
      too_long: "That is longer than I can accept here (" + max + " characters). Could you shorten it?",
      required: "Please choose an option to continue.",
      empty: "Type an answer first, or choose Skip.",
      invalid_format: "That doesn’t look like an email address. Please check it, or go back and choose No."
    };
    bubble(messages[error] || messages.choose_option, "note");
    scrollToEnd();
  }

  function onSend() {
    var value = input.value;
    if (!value.trim()) { input.focus(); return; }
    var result = engine.interpret(value);
    if (result.error) { nudge(result.error, result.max); return; }
    input.value = "";
    autosize();
    give(result.answer, value.trim());
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight + 2, window.innerHeight * 0.4) + "px";
    var max = engine.node.maxLength || flow.maxLength;
    counter.textContent = input.value.length > max * 0.8 ? input.value.length + " / " + max : "";
  }

  function renderChoice(node) {
    var described = node.options.some(function (o) { return o.desc; });
    optionsBox.appendChild(el("div", { class: described ? "choices" : "chips", role: "group", "aria-label": "Answer options" },
      node.options.map(function (o) {
        var pick = function () { give({ value: o.value, label: o.label }); };
        if (!described) return el("button", { class: "chip", type: "button", text: o.label, onclick: pick });
        // The description is part of the button, so screen readers announce it with the choice.
        return el("button", { class: "choice" + (o.primary ? " choice-primary" : ""), type: "button", onclick: pick }, [
          el("span", { class: "choice-title", text: o.label }),
          el("span", { class: "choice-desc", text: o.desc })
        ]);
      })
    ));
  }

  function renderMulti(node) {
    var previous = engine.answers[node.field];
    multiPicked = previous && previous.values ? previous.values.slice() : [];
    var done = el("button", {
      class: "btn", type: "button", text: "Done",
      onclick: function () {
        var chosen = node.options.filter(function (o) { return multiPicked.indexOf(o.value) !== -1; });
        if (!chosen.length) {
          if (node.optional) give({ skipped: true }, "Nothing selected"); else nudge("required");
          return;
        }
        give({ values: chosen.map(function (o) { return o.value; }), labels: chosen.map(function (o) { return o.label; }) });
      }
    });
    optionsBox.appendChild(el("div", { class: "chips chips-multi", role: "group", "aria-label": "Choose any that apply" },
      node.options.map(function (o) {
        // The tick mark is decorative; aria-pressed already tells assistive technology the state.
        var chip = el("button", {
          class: "chip", type: "button", "aria-pressed": String(multiPicked.indexOf(o.value) !== -1),
          onclick: function () {
            var at = multiPicked.indexOf(o.value);
            if (at === -1) multiPicked.push(o.value); else multiPicked.splice(at, 1);
            chip.setAttribute("aria-pressed", String(at === -1));
          }
        }, [el("span", { class: "tick", "aria-hidden": "true" }), o.label]);
        return chip;
      })
    ));
    optionsBox.appendChild(el("div", { class: "chips" }, [done]));
  }

  function renderReview() {
    var a = engine.answers;
    var rows = flow.summary(a).map(function (row) {
      var text = PR.engine.describe(row.answer);
      var empty = !row.answer || row.answer.skipped || !text;
      return el("div", { class: "review-row" }, [
        el("dt", { text: row.label }),
        el("dd", { class: empty ? "empty" : null, text: empty ? "Skipped" : text }),
        el("button", {
          class: "btn btn-quiet btn-sm", type: "button", "aria-label": "Change " + row.label, text: "Change",
          onclick: function () { if (engine.edit(row.node)) { bubble("Change: " + row.label, "user"); render(null); } }
        })
      ]);
    });

    var c1 = el("input", { type: "checkbox", id: "consent-unofficial" });
    var c2 = el("input", { type: "checkbox", id: "consent-share" });
    var honeypot = el("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off" });
    var error = el("p", { class: "error", role: "alert" });
    var label = open ? "Submit" : "Finish preview (nothing is sent)";
    var submit = el("button", { class: "btn btn-lg", type: "button", text: label });

    var warning = null;
    if (flow.needsReply(a) && a.contact_want && a.contact_want.value === "no") {
      warning = el("div", { class: "callout callout-warn" }, el("p", {
        text: "You asked for help that needs a reply, but chose not to be contacted, so reviewers will have no way to reach you. That is OK if it is what you want. To hear back, change “Contact you about this” above."
      }));
    }

    submit.addEventListener("click", function () {
      error.textContent = "";
      if (!c1.checked || !c2.checked) {
        error.textContent = "Please confirm both statements first.";
        return;
      }
      var report = flow.toReport(engine.answers);
      if (!open) {
        engine.answer({ confirmed: true });
        bubble("Finish preview", "user");
        render(null, null, report);
        return;
      }
      submit.disabled = true;
      submit.textContent = "Submitting…";
      store.submit(report, { hp: honeypot.value, elapsed_ms: Date.now() - startedAt }, idem).then(function (receipt) {
        engine.answer({ confirmed: true });
        bubble("Submit", "user");
        render(null, receipt, report);
      }).catch(function (err) {
        submit.disabled = false;
        submit.textContent = label;
        error.textContent = err && err.status === 429
          ? "Too many submissions have come from this connection recently, so this was not sent. Please try again later. Your answers are still here."
          : "This was not submitted, and we could not confirm that anything was saved. Please check your connection and press Submit again. Your answers are still here, and pressing Submit twice cannot create a duplicate.";
      });
    });

    optionsBox.appendChild(el("div", { class: "review" }, [
      el("dl", null, rows),
      warning,
      el("div", { class: "consent" }, [
        el("label", { class: "check", for: "consent-unofficial" }, [c1, el("span", {
          text: "I understand this is not an official University report, and that sending it does not notify the University or start any University process."
        })]),
        el("label", { class: "check", for: "consent-share" }, [c2, el("span", {
          text: open
            ? "I have read how my information is handled, and I agree that the student reviewers may read what I wrote above."
            : "I understand this is a preview: nothing above will be sent, saved or read by anyone."
        })]),
        el("label", { class: "hp", "aria-hidden": "true" }, ["Leave this field empty", honeypot])
      ]),
      error,
      el("div", { class: "chips" }, [submit])
    ]));
  }

  function emergencyNote() {
    var p = PR.emergencyLine();
    p.className = "small muted";
    return p;
  }

  function renderPreviewEnd() {
    optionsBox.appendChild(el("div", { class: "callout callout-warn" }, [
      el("h3", { text: "Preview complete" }),
      el("p", { text: "Nothing was sent or saved, and no one will read what you typed. Pride Report is not accepting submissions yet." }),
      el("p", { text: "If something has happened and you need help now, the Resources page lists people you can contact, including the official University routes." }),
      el("div", { class: "chips" }, [
        el("a", { class: "btn btn-sm", href: "resources.html", text: "Open Resources" }),
        el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Start again", onclick: restart })
      ])
    ]));
    optionsBox.appendChild(emergencyNote());
  }

  function renderReceipt(receipt, report) {
    var copied = el("span", { class: "small muted", role: "status" });
    var policy = cfg.POLICY || {};
    var when = receipt.received_at ? PR.formatDate(receipt.received_at) : null;

    optionsBox.appendChild(el("div", { class: "card receipt" }, [
      el("p", { class: "label", text: "Received. Your reference number" }),
      el("div", { class: "code", id: "reference", text: receipt.id }),
      el("div", { class: "chips no-print" }, [
        el("button", {
          class: "btn btn-sm", type: "button", text: "Copy",
          onclick: function () {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(receipt.id).then(function () { copied.textContent = "Copied."; },
                function () { copied.textContent = "Couldn’t copy. Please write it down."; });
            } else {
              copied.textContent = "Select the number above and copy it.";
            }
          }
        }),
        el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Print or save as PDF", onclick: function () { window.print(); } }),
        copied
      ]),
      el("p", { class: "small" }, [
        el("strong", { text: "Our server confirmed that your submission was stored" + (when ? " on " + when : "") + ". " }),
        "This number is a receipt, not a password. It can’t be used to open or change what you sent. Quote it if you write to us about this."
      ])
    ]));

    var contact = report.contact_want === "yes"
      ? "If a reviewer follows up, it will be by email to the address you gave."
      : "You chose not to be contacted, so you will not hear from us about this.";
    optionsBox.appendChild(el("div", { class: "callout" }, [
      el("h3", { text: "What happens next" }),
      el("p", { text: "Received does not mean read. Reviewers read submissions " + policy.REVIEW_HOURS + ", and a first response usually comes " + policy.RESPONSE_TIME + ". " + contact }),
      el("p", { text: "Pride Report has not told the University, and will not contact anyone on your behalf unless you gave that permission. If you want an official response, the routes below are how to ask for one." }),
      el("div", { class: "chips no-print" }, [el("a", { class: "btn btn-ghost btn-sm", href: "index.html", text: "Back to home" })])
    ]));

    var cards = resourceCards(PR.resources.topicForReport(report));
    if (cards) {
      optionsBox.appendChild(el("h3", { text: "Resources that may be relevant" }));
      optionsBox.appendChild(cards);
    }
    optionsBox.appendChild(emergencyNote());
  }

  function render(previousId, receipt, report) {
    var node = engine.node;
    clearOptions();
    engine.lines().forEach(function (line) { bubble(line, node.tone === "urgent" ? "urgent" : null); });
    linkRow(node.links);

    // Resource cards that belong to this step of the conversation.
    var topic = typeof node.resources === "function" ? node.resources(engine.answers) : node.showResources;
    if (topic) {
      var cards = resourceCards(topic);
      if (cards) log.appendChild(cards);
    }

    var typing = node.type === "text" || (node.type === "choice" && node.allowText);
    composer.hidden = node.type === "end" || node.type === "review" || node.type === "multi" || (!typing && !node.optional);
    input.disabled = !typing;
    sendBtn.disabled = !typing;
    input.hidden = !typing;
    sendBtn.hidden = !typing;
    input.placeholder = node.placeholder || "Or type your own answer";
    input.setAttribute("inputmode", node.inputType === "email" ? "email" : "text");
    input.setAttribute("autocapitalize", node.inputType === "email" ? "none" : "sentences");
    skipBtn.hidden = !node.optional;
    hint.textContent = node.type === "text"
      ? (node.multiline ? "Enter sends. Shift + Enter adds a new line." : "Press Enter to send.")
      : typing ? "Choose an option above, or type your own." : "";
    backBtn.disabled = !engine.canGoBack || node.type === "end";
    counter.textContent = "";

    if (node.type === "choice") renderChoice(node);
    else if (node.type === "multi") renderMulti(node);
    else if (node.type === "review") renderReview();
    else if (node.type === "end" && node.receipt && receipt) renderReceipt(receipt, report);
    else if (node.type === "end" && node.receipt) renderPreviewEnd();
    else if (node.type === "end") {
      optionsBox.appendChild(el("div", { class: "chips" }, [
        el("button", { class: "btn btn-sm", type: "button", text: "Start again", onclick: restart }),
        el("a", { class: "btn btn-ghost btn-sm", href: "index.html", text: "Back to home" })
      ]));
      optionsBox.appendChild(emergencyNote());
    }

    setProgress();
    persist();
    scrollToEnd();
    if (previousId !== undefined) {
      // Move focus to where the next action is, so keyboard and screen-reader users aren't left behind.
      var target = node.type === "text" ? input : optionsBox.querySelector("button, a, input");
      if (target) target.focus({ preventScroll: true });
    }
  }

  function restart() {
    engine.reset();
    alertsShown = {};
    startedAt = Date.now();
    idem = store.newIdempotencyKey();
    while (log.firstChild) log.removeChild(log.firstChild);
    render(null);
  }

  function start(focus) {
    closedPanel.hidden = true;
    chat.hidden = false;
    if (saved && engine.canGoBack) bubble("Welcome back. I’ve kept your answers from before you refreshed this tab.", "note");
    render(focus ? null : undefined);
  }

  sendBtn.addEventListener("click", onSend);
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); onSend(); }
  });
  skipBtn.addEventListener("click", function () { give({ skipped: true }, "Skip"); });
  backBtn.addEventListener("click", function () {
    if (engine.back()) { bubble("Go back", "user"); render(null); }
  });
  restartBtn.addEventListener("click", function () {
    if (engine.canGoBack && !window.confirm("Start over? Your answers so far will be cleared.")) return;
    restart();
  });

  if (open || (saved && saved.state)) {
    start(false);
  } else {
    // Intake is closed: say so plainly, and only start the preview if the visitor asks for it.
    chat.hidden = true;
    closedPanel.hidden = false;
    document.getElementById("start-preview").addEventListener("click", function () { start(true); });
  }
})();
