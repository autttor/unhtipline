/* Pride Guide chat UI. Renders the engine's current node and feeds answers back into it. */
(function () {
  "use strict";
  var PR = window.PR;
  var el = PR.el;
  var flow = PR.flow;
  var store = PR.store;
  var cfg = window.PR_CONFIG || {};
  var DRAFT_KEY = "pride-report-draft-v2";

  flow.context.mode = store.mode;
  flow.context.tracking = store.tracking;
  flow.context.expectation = cfg.REVIEW_EXPECTATION || "";

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
  var STAGES = [
    { name: "What you need", from: 2 },
    { name: "What happened", from: 4 },
    { name: "What you’d like to see", from: 13 },
    { name: "How to reach you", from: 16 },
    { name: "Review and submit", from: 17 }
  ];

  var startedAt = Date.now();
  var crisisShown = false;
  var multiPicked = [];

  // The draft lives in sessionStorage so a refresh doesn't lose the conversation, and closing the tab does.
  var saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { saved = null; }
  var engine = PR.engine.createEngine(flow, saved);

  function persist() {
    try {
      if (engine.node.type === "end") sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(engine.snapshot()));
    } catch (e) { /* private mode: the draft simply won't survive a refresh */ }
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
      return el("a", {
        class: "btn btn-ghost btn-sm", href: l.href,
        target: l.newTab ? "_blank" : null, rel: l.newTab ? "noopener" : null,
        text: l.label + (l.newTab ? " (new tab)" : "")
      });
    })));
  }

  function showCrisisCard() {
    if (crisisShown) return;
    crisisShown = true;
    log.appendChild(el("div", { class: "bubble urgent fresh", role: "note" }, [
      el("strong", { text: "You mentioned something that sounds really heavy. " }),
      "I’m an automated tool and nobody is reading this live. If you’re thinking about harming yourself, you can reach a person right now: call or text ",
      el("a", { href: "tel:988", text: "988" }),
      ", or reach The Trevor Project at ",
      el("a", { href: "tel:+18664887386", text: "1-866-488-7386" }),
      ". If you’re in immediate danger, call University Public Safety at ",
      el("a", { href: "tel:+12039327070", text: "(203) 932-7070" }),
      " or ",
      el("a", { href: "tel:911", text: "911" }),
      ". You can keep going whenever you’re ready."
    ]));
  }

  function setProgress() {
    var step = engine.node.step || 0;
    var pct = Math.round((step / flow.totalSteps) * 100);
    bar.style.width = pct + "%";
    progress.setAttribute("aria-valuenow", String(pct));

    var current = -1;
    STAGES.forEach(function (s, i) { if (step >= s.from) current = i; });
    if (engine.node.type === "end") current = engine.node.receipt ? STAGES.length : -1;
    stageLabel.textContent = current < 0 ? "Getting started"
      : current >= STAGES.length ? "Submitted"
      : "Part " + (current + 1) + " of " + STAGES.length + ": " + STAGES[current].name;
    if (stageList) {
      Array.prototype.forEach.call(stageList.children, function (li, i) {
        li.className = i < current ? "done" : i === current ? "now" : "";
        if (i === current) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
      });
    }
  }

  function clearOptions() {
    while (optionsBox.firstChild) optionsBox.removeChild(optionsBox.firstChild);
  }

  function give(answer, shownText) {
    var before = engine.id;
    var result = engine.answer(answer);
    if (!result.ok) return false;
    bubble(shownText || PR.engine.describe(answer), "user");
    if (answer.text && flow.detectCrisis(answer.text)) showCrisisCard();
    render(before);
    return true;
  }

  function nudge(error, max) {
    var messages = {
      choose_option: "Please choose one of the options above.",
      too_long: "That’s longer than I can accept here (" + max + " characters). Could you shorten it?",
      required: "Please choose at least one option to continue.",
      empty: "Type an answer first, or choose Skip."
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
    optionsBox.appendChild(el("div", { class: "chips", role: "group", "aria-label": "Answer options" },
      node.options.map(function (o) {
        return el("button", {
          class: "chip", type: "button", text: o.label,
          onclick: function () { give({ value: o.value, label: o.label }); }
        });
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

  function consentShareText() {
    if (store.mode === "demo") return "I understand this is a demo: my answers stay in this browser and no reviewer will see them.";
    if (store.mode === "email") {
      return "I agree that what I wrote above will be emailed to the Pride Report reviewers and read by trained student reviewers. " + (cfg.REVIEW_EXPECTATION || "");
    }
    return "I agree that trained student reviewers may read what I wrote above. " + (cfg.REVIEW_EXPECTATION || "");
  }

  function renderReview() {
    var rows = flow.summary(engine.answers).map(function (row) {
      var text = PR.engine.describe(row.answer);
      var empty = !row.answer || row.answer.skipped;
      return el("div", { class: "review-row" }, [
        el("dt", { text: row.label }),
        el("dd", { class: empty ? "empty" : null, text: empty ? "Skipped" : text }),
        row.editable ? el("button", {
          class: "btn btn-quiet btn-sm", type: "button", "aria-label": "Change " + row.label, text: "Change",
          onclick: function () { if (engine.edit(row.node)) { bubble("Change: " + row.label, "user"); render(null); } }
        }) : null
      ]);
    });

    var c1 = el("input", { type: "checkbox", id: "consent-unofficial" });
    var c2 = el("input", { type: "checkbox", id: "consent-share" });
    var honeypot = el("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off" });
    var error = el("p", { class: "error", role: "alert" });
    var label = store.isDemo ? "Submit demo report" : "Submit";
    var submit = el("button", { class: "btn btn-lg", type: "button", text: label });

    var warning = null;
    var a = engine.answers;
    if (flow.wantsHelp(a) && a.contact_mode && a.contact_mode.value === "anonymous") {
      warning = el("div", { class: "callout callout-warn" }, el("p", {
        text: "You asked for help but chose to submit anonymously, so reviewers will have no way to reach you. That is OK if it is what you want. To get a reply, change “How you’re submitting” above."
      }));
    }

    submit.addEventListener("click", function () {
      error.textContent = "";
      if (!c1.checked || !c2.checked) {
        error.textContent = "Please confirm both statements before submitting.";
        return;
      }
      submit.disabled = true;
      submit.textContent = "Submitting…";
      var report = flow.toReport(engine.answers);
      store.submit(report, { hp: honeypot.value, elapsed_ms: Date.now() - startedAt }).then(function (receipt) {
        engine.answer({ confirmed: true });
        bubble("Submit", "user");
        render(null, receipt, report);
      }).catch(function (err) {
        submit.disabled = false;
        submit.textContent = label;
        error.textContent = err && err.status === 429 && store.mode === "backend"
          ? "Too many reports have come from this connection recently. Please try again later. Your answers are still here."
          : "This could not be submitted, and nothing was sent. Please check your connection and try again. Your answers are still here.";
      });
    });

    optionsBox.appendChild(el("div", { class: "review" }, [
      el("dl", null, rows),
      warning,
      el("div", { class: "consent" }, [
        el("label", { class: "check", for: "consent-unofficial" }, [c1, el("span", {
          text: "I understand this is not an official University report, and that submitting here does not notify the University or start any University process."
        })]),
        el("label", { class: "check", for: "consent-share" }, [c2, el("span", { text: consentShareText() })]),
        el("label", { class: "hp", "aria-hidden": "true" }, ["Leave this field empty", honeypot])
      ]),
      error,
      el("div", { class: "chips" }, [submit])
    ]));
  }

  function resourceCard(r) {
    return el("div", { class: "card resource" }, [
      el("span", { class: "tag" + (r.tone === "official" ? " tag-official" : r.tone === "urgent" ? " tag-urgent" : ""), text: r.tag }),
      el("h3", { text: r.name }),
      el("p", { text: r.what }),
      el("ul", { class: "resource-contacts" }, r.contacts.map(function (c) {
        return el("li", null, [c.label + ": ", el("a", { href: c.href, text: c.text, rel: /^https:/.test(c.href) ? "noopener" : null })]);
      }))
    ]);
  }

  function copyButton(text, status) {
    return el("button", {
      class: "btn btn-sm", type: "button", text: "Copy",
      onclick: function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { status.textContent = "Copied."; },
            function () { status.textContent = "Couldn’t copy. Please write it down."; });
        } else {
          status.textContent = "Select the code above and copy it.";
        }
      }
    });
  }

  function renderReceipt(receipt, report) {
    var copied = el("span", { class: "small muted", role: "status" });
    var category = report && report.category ? report.category.value : "other";
    var identified = report && report.contact_mode === "identified";
    var hasCode = !!receipt.code;

    optionsBox.appendChild(el("div", { class: "card receipt" }, [
      el("p", { class: "label", text: store.isDemo ? "Demo access code" : hasCode ? "Your private access code" : "Your reference number" }),
      el("div", { class: "code", id: "access-code", text: receipt.code || receipt.id }),
      el("div", { class: "chips no-print" }, [
        copyButton(receipt.code || receipt.id, copied),
        el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Print or save as PDF", onclick: function () { window.print(); } }),
        copied
      ]),
      hasCode
        ? el("p", { class: "small" }, [
          el("strong", { text: "Keep this code somewhere private. " }),
          "It is the only way to open this report again, and it can’t be recovered if you lose it. Reference number for reviewers: " + receipt.id + "."
        ])
        : el("p", { class: "small" }, [
          el("strong", { text: "Your report was sent. " }),
          "Keep this reference number. If you contact Pride Report again about this, quoting it helps reviewers find your report."
        ])
    ]));

    var nextText;
    if (store.isDemo) {
      nextText = "Nothing: this was a demo, so no one received your report. You can open the tracking page with the code above, or the demo reviewer dashboard, to see how the rest would work.";
    } else if (hasCode) {
      nextText = (cfg.REVIEW_EXPECTATION || "A trained student reviewer will read your report.") + " Check back on the My report page with your code.";
    } else if (identified) {
      nextText = (cfg.REVIEW_EXPECTATION || "A trained student reviewer will read your report.") + " A reviewer will reach you using the contact details you gave.";
    } else {
      nextText = (cfg.REVIEW_EXPECTATION || "A trained student reviewer will read your report.") + " Because you submitted anonymously, reviewers can’t reply to you. If you want a reply later, you can submit again and share a way to reach you.";
    }

    optionsBox.appendChild(el("div", { class: "callout" }, [
      el("h3", { text: "What happens next" }),
      el("p", { text: nextText }),
      el("p", { text: "Pride Report has not notified the University. If you want an official response, the routes below are how to ask for one." }),
      el("div", { class: "chips no-print" }, [
        hasCode ? el("a", { class: "btn btn-sm", href: "track.html", text: "Open My report" }) : null,
        store.isDemo ? el("a", { class: "btn btn-ghost btn-sm", href: "admin/index.html", text: "See the demo dashboard" }) : null,
        el("a", { class: "btn btn-ghost btn-sm", href: "index.html", text: "Back to home" })
      ])
    ]));

    optionsBox.appendChild(el("h3", { text: "Options that may be relevant" }));
    optionsBox.appendChild(el("div", { class: "cards" }, PR.resources.forCategory(category).map(resourceCard)));
    var emergency = PR.emergencyLine();
    emergency.className = "small muted";
    optionsBox.appendChild(emergency);
  }

  function render(previousId, receipt, report) {
    var node = engine.node;
    clearOptions();
    engine.lines().forEach(function (line) { bubble(line, node.tone === "urgent" ? "urgent" : null); });
    linkRow(node.links);

    var typing = node.type === "text" || (node.type === "choice" && node.allowText);
    composer.hidden = node.type === "end" || node.type === "review" || node.type === "multi" || !typing && !node.optional;
    input.disabled = !typing;
    sendBtn.disabled = !typing;
    input.hidden = !typing;
    sendBtn.hidden = !typing;
    input.placeholder = node.placeholder || "Or type your own answer";
    skipBtn.hidden = !node.optional;
    hint.textContent = node.type === "text"
      ? "Enter sends. Shift + Enter adds a new line."
      : typing ? "Choose an option above, or type your own." : "";
    backBtn.disabled = !engine.canGoBack || node.type === "end";
    counter.textContent = "";

    if (node.type === "choice") renderChoice(node);
    else if (node.type === "multi") renderMulti(node);
    else if (node.type === "review") renderReview();
    else if (node.type === "end" && node.receipt && receipt) renderReceipt(receipt, report);
    else if (node.type === "end") {
      optionsBox.appendChild(el("div", { class: "chips" }, [
        el("button", { class: "btn btn-sm", type: "button", text: "Start again", onclick: restart }),
        el("a", { class: "btn btn-ghost btn-sm", href: "index.html", text: "Back to home" })
      ]));
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
    crisisShown = false;
    startedAt = Date.now();
    while (log.firstChild) log.removeChild(log.firstChild);
    render(null);
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

  if (saved && engine.canGoBack) bubble("Welcome back. I’ve kept your answers from before you refreshed this tab.", "note");
  render();
})();
