/* Shared chrome: header, footer, "not open yet" banner, quick exit, resource cards. No dependencies. */
(function () {
  "use strict";
  var PR = (window.PR = window.PR || {});
  var cfg = window.PR_CONFIG || {};
  var root = document.body.getAttribute("data-root") || "";
  var page = document.body.getAttribute("data-page") || "";
  var open = !!(PR.store && PR.store.isOpen());

  /** Tiny DOM builder. Text is always set via textContent, never innerHTML. */
  PR.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, v);
      });
    }
    (Array.isArray(children) ? children : children == null ? [] : [children]).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  };
  var el = PR.el;

  PR.formatDate = function (iso) {
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (e) {
      return iso;
    }
  };

  PR.quickExit = function () {
    // replace() keeps this page out of the back button, but it cannot clear browser history.
    window.location.replace(cfg.QUICK_EXIT_URL || "https://www.wikipedia.org/");
  };

  /** Emergency contacts, always in this order: University Public Safety first, then 911. */
  PR.emergencyLine = function (lead) {
    return el("p", null, [
      lead || "In an emergency call ",
      "University Public Safety at ",
      el("a", { class: "phone", href: "tel:+12039327070", text: "(203) 932-7070" }),
      ", or call ",
      el("a", { class: "phone", href: "tel:911", text: "911" }),
      "."
    ]);
  };

  var links = [
    ["home", "index.html", "Home"],
    ["report", "report.html", "Get help"],
    ["resources", "resources.html", "Resources"],
    ["about", "about.html", "About"],
    ["privacy", "privacy.html", "Privacy"],
    ["contact", "contact.html", "Contact"]
  ];

  /** One resource record as a card. Unverified records say so, and point at the official page. */
  PR.resourceCard = function (r) {
    var tags = { emergency: ["Emergency", " tag-urgent"], official: ["Official University route", " tag-official"],
      campus: ["Campus support", ""], community: ["Community", ""], state: ["Connecticut", ""] };
    var tag = tags[r.category] || ["Resource", ""];
    return el("div", { class: "card resource" }, [
      el("span", { class: "tag" + tag[1], text: tag[0] }),
      el("h3", { text: r.name }),
      el("p", { text: r.what }),
      el("ul", { class: "resource-contacts" }, r.contacts.map(function (c) {
        return el("li", null, [c.label + ": ", el("a", { href: c.href, text: c.text, rel: /^https:/.test(c.href) ? "noopener" : null })]);
      })),
      r.verified ? null : el("p", { class: "small muted" }, [
        "Our team has not re-checked these details yet. Please confirm them on the ",
        el("a", { href: r.source, rel: "noopener", text: "official page" }), "."
      ])
    ]);
  };

  function buildHeader() {
    var nav = el("nav", { class: "site-nav", id: "site-nav", "aria-label": "Main" }, [
      el("ul", null, links.map(function (l) {
        return el("li", null, el("a", { href: root + l[1], "aria-current": l[0] === page ? "page" : null, text: l[2] }));
      }))
    ]);
    var toggle = el("button", {
      class: "nav-toggle", type: "button", "aria-expanded": "false", "aria-controls": "site-nav", text: "Menu",
      onclick: function () {
        var open = nav.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(open));
      }
    });
    return el("header", { class: "site-header" }, [
      el("div", { class: "stripe", "aria-hidden": "true" }),
      el("div", { class: "wrap header-row" }, [
        el("a", { class: "brand", href: root + "index.html" }, [
          el("span", { class: "brand-mark", "aria-hidden": "true", text: "P" }),
          el("span", { class: "brand-name" }, ["Pride Report", el("small", { text: "UNewHaven · student-led" })])
        ]),
        nav,
        toggle,
        el("button", {
          class: "quick-exit", type: "button", title: "Leave this site immediately",
          onclick: PR.quickExit, text: "Quick exit"
        })
      ])
    ]);
  }

  function buildClosedBanner() {
    return el("div", { class: "banner banner-demo", role: "note" }, el("div", { class: "wrap" }, el("p", null, [
      el("strong", { text: "Not accepting submissions yet. " }),
      "Pride Report is still being set up. You can preview the questions, but nothing you enter is sent or saved. ",
      el("a", { href: root + "resources.html", text: "Resources you can use now" }), "."
    ])));
  }

  function buildFooter() {
    var siteLinks = links.concat([["admin", "admin/index.html", "Reviewer sign-in"]]);
    return el("footer", { class: "site-footer" }, el("div", { class: "wrap footer-grid" }, [
      el("div", null, [
        el("h2", { text: "UNewHaven Pride Report" }),
        el("p", { text: "An independent, student-led initiative. Not an official University of New Haven reporting channel, and not affiliated with or endorsed by the University." }),
        el("p", { text: "Submitting here does not file a University complaint." })
      ]),
      el("div", null, [
        el("h2", { text: "In an emergency" }),
        PR.emergencyLine("Call "),
        el("p", { text: "This site is not monitored live and cannot send help." })
      ]),
      el("div", null, [
        el("h2", { text: "Site" }),
        el("ul", null, siteLinks.map(function (l) {
          return el("li", null, el("a", { href: root + l[1], text: l[2] }));
        }))
      ])
    ]));
  }

  // Pages mark text that depends on whether intake is open with data-show="open" or "closed".
  Array.prototype.forEach.call(document.querySelectorAll("[data-show]"), function (node) {
    if (node.getAttribute("data-show") !== (open ? "open" : "closed")) node.hidden = true;
  });

  // Policy values from config.js. An unset value is shown as not yet decided, never invented.
  var policy = cfg.POLICY || {};
  Array.prototype.forEach.call(document.querySelectorAll("[data-policy]"), function (node) {
    var value = String(policy[node.getAttribute("data-policy")] || "").trim();
    node.textContent = value || "TO BE CONFIRMED";
    if (!value) node.className = (node.className + " tbc").trim();
    if (value && node.tagName === "A") node.setAttribute("href", "mailto:" + value);
  });

  var main = document.querySelector("main");
  document.body.insertBefore(el("a", { class: "skip-link", href: "#main", text: "Skip to content" }), document.body.firstChild);
  var header = buildHeader();
  document.body.insertBefore(header, main);
  if (!open && page !== "admin") document.body.insertBefore(buildClosedBanner(), main);
  document.body.appendChild(buildFooter());

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var nav = document.getElementById("site-nav");
      if (nav && nav.classList.contains("open")) {
        nav.classList.remove("open");
        header.querySelector(".nav-toggle").setAttribute("aria-expanded", "false");
        header.querySelector(".nav-toggle").focus();
      }
    }
  });
})();
