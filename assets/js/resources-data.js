/* Campus and national resources, and which ones to surface for each report category.
 *
 * IMPORTANT: University contact details below were taken from the project proposal and have NOT been
 * re-checked against newhaven.edu. Verify every phone number, email and link before launch, and re-check
 * each semester. This is the only file that needs editing when they change.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.PR = root.PR || {}).resources = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var items = {
    emergency: {
      tag: "Emergency", tone: "urgent",
      name: "Immediate danger",
      what: "If you or someone else is in danger right now, call University Public Safety or 911. Pride Report is not monitored live and cannot dispatch anyone.",
      contacts: [
        { label: "University Public Safety", text: "(203) 932-7070", href: "tel:+12039327070" },
        { label: "Emergency services", text: "911", href: "tel:911" }
      ]
    },
    reportIt: {
      tag: "Official University route", tone: "official",
      name: "Report It!",
      what: "The University’s own incident-reporting system, including concerns about discriminatory actions. Filing here is what creates an official University report. Pride Report does not.",
      contacts: [
        { label: "Web", text: "newhaven.edu: Report It!", href: "https://www.newhaven.edu/student-life/public-safety/report-it/index.php" }
      ]
    },
    titleIX: {
      tag: "Official University route", tone: "official",
      name: "Title IX reporting",
      what: "For sex-based discrimination, sexual harassment or sexual misconduct. The Title IX page explains the reporting options and which resources are confidential.",
      contacts: [
        { label: "Web", text: "newhaven.edu: Title IX reporting", href: "https://www.newhaven.edu/about/title-ix/reporting.php" }
      ]
    },
    myatt: {
      tag: "Campus support", tone: "support",
      name: "Myatt Center for Diversity and Inclusion",
      what: "Supports LGBTQ+ students and can help you think through options, whether or not you file anything.",
      contacts: [
        { label: "Phone", text: "(203) 932-7427", href: "tel:+12039327427" },
        { label: "Email", text: "CDI@newhaven.edu", href: "mailto:CDI@newhaven.edu" },
        { label: "Web", text: "newhaven.edu: Myatt Center", href: "https://www.newhaven.edu/inclusion/myatt-center.php" }
      ]
    },
    crisis988: {
      tag: "24/7 crisis support", tone: "urgent",
      name: "988 Suicide & Crisis Lifeline",
      what: "Free, confidential support any time, anywhere in the U.S.",
      contacts: [{ label: "Call or text", text: "988", href: "tel:988" }]
    },
    trevor: {
      tag: "24/7 crisis support", tone: "support",
      name: "The Trevor Project",
      what: "Crisis counselors for LGBTQ+ young people, by phone, text or chat.",
      contacts: [
        { label: "Call", text: "1-866-488-7386", href: "tel:+18664887386" },
        { label: "Text", text: "START to 678-678", href: "sms:678678?&body=START" }
      ]
    },
    transLifeline: {
      tag: "Peer support", tone: "support",
      name: "Trans Lifeline",
      what: "Peer support run by and for trans people.",
      contacts: [{ label: "Call", text: "(877) 565-8860", href: "tel:+18775658860" }]
    }
  };

  // Order matters: most relevant first. Emergency information is always shown separately.
  var byCategory = {
    harassment: ["reportIt", "titleIX", "myatt"],
    discrimination: ["reportIt", "titleIX", "myatt"],
    deadnaming: ["myatt", "reportIt", "transLifeline"],
    housing: ["myatt", "reportIt"],
    academics: ["reportIt", "myatt"],
    facilities: ["myatt", "reportIt"],
    climate: ["myatt", "reportIt"],
    other: ["myatt", "reportIt"]
  };

  function forCategory(category) {
    var keys = byCategory[category] || byCategory.other;
    return keys.map(function (k) { return items[k]; });
  }

  return {
    items: items,
    byCategory: byCategory,
    forCategory: forCategory,
    groups: [
      { title: "Emergency and crisis", keys: ["emergency", "crisis988", "trevor"] },
      { title: "Official University reporting", keys: ["reportIt", "titleIX"] },
      { title: "Support and community", keys: ["myatt", "transLifeline"] }
    ]
  };
});
