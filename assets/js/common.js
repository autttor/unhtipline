/* Shared chrome: header, footer, demo banner, quick exit. No dependencies. */
(function () {
  "use strict";
  var PR = (window.PR = window.PR || {});
  var cfg = window.PR_CONFIG || {};
  var root = document.body.getAttribute("data-root") || "";
  var page = document.body.getAttribute("data-page") || "";

  PR.isDemo = !cfg.API_BASE;

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

  var links = [
    ["home", "index.html", "Home"],
    ["report", "report.html", "Report"],
    ["resources", "resources.html", "Resources"],
    ["track", "track.html", "My report"],
    ["about", "about.html", "About & privacy"]
  ];

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
    var header = el("header", { class: "site-header" }, [
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
    return header;
  }

  function buildDemoBanner() {
    return el("div", { class: "banner banner-demo", role: "note" }, el("div", { class: "wrap" }, el("p", null, [
      el("strong", { text: "Prototype — demo mode. " }),
      "Please don’t enter real names or real incidents. Anything you type stays in this browser and is never sent to anyone. ",
      el("button", {
        class: "linklike", type: "button", text: "Clear demo data",
        onclick: function () {
          if (PR.store) PR.store.clearDemo();
          try { sessionStorage.clear(); } catch (e) { /* storage unavailable */ }
          window.location.reload();
        }
      })
    ])));
  }

  function buildFooter() {
    return el("footer", { class: "site-footer" }, el("div", { class: "wrap footer-grid" }, [
      el("div", null, [
        el("h2", { text: "UNewHaven Pride Report" }),
        el("p", { text: "An independent, student-led initiative. Not an official University of New Haven reporting channel, and not affiliated with or endorsed by the University." }),
        el("p", { text: "Submitting here does not file a University complaint." })
      ]),
      el("div", null, [
        el("h2", { text: "In an emergency" }),
        el("p", null, ["Call ", el("a", { class: "phone", href: "tel:911", text: "911" }), " or University Public Safety at ",
          el("a", { class: "phone", href: "tel:+12039327070", text: "(203) 932-7070" }), "."]),
        el("p", { text: "This site is not monitored live and cannot send help." })
      ]),
      el("div", null, [
        el("h2", { text: "Site" }),
        el("ul", null, links.concat([["admin", "admin/index.html", "Reviewer dashboard (demo)"]]).map(function (l) {
          return el("li", null, el("a", { href: root + l[1], text: l[2] }));
        }))
      ])
    ]));
  }

  var main = document.querySelector("main");
  var skip = el("a", { class: "skip-link", href: "#main", text: "Skip to content" });
  document.body.insertBefore(skip, document.body.firstChild);
  var header = buildHeader();
  document.body.insertBefore(header, main);
  if (PR.isDemo) document.body.insertBefore(buildDemoBanner(), main);
  document.body.appendChild(buildFooter());

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var nav = document.getElementById("site-nav");
      if (nav && nav.classList.contains("open")) {
        nav.classList.remove("open");
        header.querySelector(".nav-toggle").setAttribute("aria-expanded", "false");
      }
    }
  });
})();
