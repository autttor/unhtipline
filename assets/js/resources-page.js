/* Renders the Resources page from resources-data.js so contact details live in exactly one file. */
(function () {
  "use strict";
  var PR = window.PR;
  var el = PR.el;
  var host = document.getElementById("resource-groups");

  function card(r) {
    return el("div", { class: "card resource" }, [
      el("span", { class: "tag" + (r.tone === "official" ? " tag-official" : r.tone === "urgent" ? " tag-urgent" : ""), text: r.tag }),
      el("h3", { text: r.name }),
      el("p", { text: r.what }),
      el("ul", { class: "resource-contacts" }, r.contacts.map(function (c) {
        return el("li", null, [c.label + ": ", el("a", { href: c.href, text: c.text, rel: /^https:/.test(c.href) ? "noopener" : null })]);
      }))
    ]);
  }

  PR.resources.groups.forEach(function (group, i) {
    var id = "resources-" + i;
    host.appendChild(el("section", { class: "section", "aria-labelledby": id }, [
      el("h2", { id: id, text: group.title }),
      el("div", { class: "cards" }, group.keys.map(function (k) { return card(PR.resources.items[k]); }))
    ]));
  });
})();
