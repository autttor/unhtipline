/* Resources page: search box, type filter, and cards rendered from resources-data.js. */
(function () {
  "use strict";
  var PR = window.PR;
  var el = PR.el;
  var host = document.getElementById("resource-groups");
  var input = document.getElementById("q");
  var filters = document.getElementById("resource-filters");
  var count = document.getElementById("resource-count");
  var category = "";

  function draw() {
    while (host.firstChild) host.removeChild(host.firstChild);
    var found = PR.resources.search(input.value, category);
    PR.resources.categories.forEach(function (group) {
      var list = found.filter(function (r) { return r.category === group.id; });
      if (!list.length) return;
      var id = "resources-" + group.id;
      host.appendChild(el("section", { class: "section", "aria-labelledby": id }, [
        el("h2", { id: id, text: group.title }),
        el("div", { class: "cards" }, list.map(PR.resourceCard))
      ]));
    });
    count.textContent = found.length
      ? found.length + (found.length === 1 ? " resource" : " resources") + " shown."
      : "Nothing matches that search. Try fewer words, or clear the search to see everything.";
  }

  [["", "All"]].concat(PR.resources.categories.map(function (c) { return [c.id, c.title]; })).forEach(function (f) {
    // Only offer filters that have something published behind them.
    if (f[0] && !PR.resources.search("", f[0]).length) return;
    var button = el("button", {
      type: "button", "aria-pressed": String(f[0] === category), text: f[1],
      onclick: function () {
        category = f[0];
        Array.prototype.forEach.call(filters.children, function (b) { b.setAttribute("aria-pressed", String(b === button)); });
        draw();
      }
    });
    filters.appendChild(button);
  });

  input.addEventListener("input", draw);
  document.getElementById("resource-search").addEventListener("submit", function (e) { e.preventDefault(); });
  draw();
})();
