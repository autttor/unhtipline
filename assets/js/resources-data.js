/* Resource records: campus, official reporting routes, crisis lines, community.
 *
 * HOW VERIFICATION WORKS
 *   verified: true   a team member checked every contact on this record against `source` on `checked`.
 *   verified: false  not checked yet.
 *
 *   A record is shown to students only if it has contact details AND (it is verified OR it is "core").
 *   Unverified core records are shown with a note asking students to confirm on the official page.
 *   Intake cannot open until every core record is verified (see closedReasons in store.js).
 *
 * BEFORE LAUNCH, for each record: open `source`, confirm every phone number, email and link, fill in
 * missing contacts, then set verified: true and checked: "YYYY-MM-DD". Re-check every semester.
 * Do not add opening hours or confidentiality claims unless the official page states them.
 *
 * Status of this file: the University contacts below came from the project proposal and could NOT be
 * re-checked while this was written, because newhaven.edu was unreachable from the build environment.
 * Records with an empty `contacts` list are placeholders: the office exists, but its details were
 * left blank rather than guessed.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.PR = root.PR || {}).resources = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var categories = [
    { id: "emergency", title: "Emergency and crisis" },
    { id: "official", title: "Official University reporting" },
    { id: "campus", title: "Campus support" },
    { id: "community", title: "LGBTQ+ community and support" },
    { id: "state", title: "Connecticut resources" }
  ];

  var records = [
    {
      id: "public_safety", category: "emergency", core: true, verified: false, checked: null,
      name: "University Public Safety",
      what: "Call first for an emergency on campus. Pride Report is not monitored live and cannot send anyone.",
      contacts: [{ label: "Phone", text: "(203) 932-7070", href: "tel:+12039327070" }],
      source: "https://www.newhaven.edu/student-life/public-safety/",
      topics: ["safety"], keywords: "police campus security emergency danger"
    },
    {
      id: "emergency_911", category: "emergency", core: true, verified: true, checked: null,
      name: "Emergency services",
      what: "For immediate danger anywhere.",
      contacts: [{ label: "Phone", text: "911", href: "tel:911" }],
      source: "https://www.911.gov/",
      topics: ["safety"], keywords: "police ambulance fire emergency danger"
    },
    {
      id: "crisis_988", category: "emergency", core: true, verified: true, checked: null,
      name: "988 Suicide & Crisis Lifeline",
      what: "Free crisis support by phone or text, at any time, anywhere in the U.S.",
      contacts: [{ label: "Call or text", text: "988", href: "tel:988" }],
      source: "https://988lifeline.org/",
      topics: ["mental_health", "safety"], keywords: "suicide crisis mental health counseling talk"
    },
    {
      id: "trevor", category: "emergency", core: true, verified: false, checked: null,
      name: "The Trevor Project",
      what: "Crisis counselors for LGBTQ+ young people.",
      contacts: [{ label: "Call", text: "1-866-488-7386", href: "tel:+18664887386" }],
      source: "https://www.thetrevorproject.org/get-help/",
      topics: ["mental_health", "community"], keywords: "crisis lgbtq youth suicide counseling chat"
    },
    {
      id: "report_it", category: "official", core: true, verified: false, checked: null,
      name: "Report It! (University incident reporting)",
      what: "The University’s own incident-reporting system. Filing here is what creates an official University report. Sending something to Pride Report does not.",
      contacts: [{ label: "Web", text: "newhaven.edu: Report It!", href: "https://www.newhaven.edu/student-life/public-safety/report-it/index.php" }],
      source: "https://www.newhaven.edu/student-life/public-safety/report-it/index.php",
      topics: ["reporting", "title_ix", "housing"], keywords: "official report incident bias discrimination complaint"
    },
    {
      id: "title_ix", category: "official", core: true, verified: false, checked: null,
      name: "Title IX reporting and supportive measures",
      what: "The University’s route for sex-based discrimination, sexual harassment and sexual misconduct. The official page explains the reporting options and supportive measures.",
      contacts: [{ label: "Web", text: "newhaven.edu: Title IX reporting", href: "https://www.newhaven.edu/about/title-ix/reporting.php" }],
      source: "https://www.newhaven.edu/about/title-ix/reporting.php",
      topics: ["reporting", "title_ix", "safety"], keywords: "title ix sexual harassment misconduct discrimination supportive measures"
    },
    {
      id: "myatt", category: "campus", core: true, verified: false, checked: null,
      name: "Myatt Center for Diversity and Inclusion",
      what: "A University center that supports LGBTQ+ students.",
      contacts: [
        { label: "Phone", text: "(203) 932-7427", href: "tel:+12039327427" },
        { label: "Email", text: "CDI@newhaven.edu", href: "mailto:CDI@newhaven.edu" },
        { label: "Web", text: "newhaven.edu: Myatt Center", href: "https://www.newhaven.edu/inclusion/myatt-center.php" }
      ],
      source: "https://www.newhaven.edu/inclusion/myatt-center.php",
      topics: ["community", "housing", "reporting", "other"], keywords: "diversity inclusion lgbtq community support center"
    },
    {
      id: "trans_lifeline", category: "community", core: false, verified: false, checked: null,
      name: "Trans Lifeline",
      what: "Peer support run by and for trans people.",
      contacts: [{ label: "Call", text: "(877) 565-8860", href: "tel:+18775658860" }],
      source: "https://translifeline.org/",
      topics: ["mental_health", "community"], keywords: "trans transgender peer support hotline"
    },

    /* ---- Placeholders: real offices and organizations whose details still have to be added ---- */
    {
      id: "residential_life", category: "campus", core: false, verified: false, checked: null,
      name: "Residential Life", what: "Housing assignments, room changes and roommate concerns.",
      contacts: [], source: "https://www.newhaven.edu/", topics: ["housing"], keywords: "housing dorm roommate residence"
    },
    {
      id: "dean_of_students", category: "campus", core: false, verified: false, checked: null,
      name: "Dean of Students Office", what: "General student support and help navigating University processes.",
      contacts: [], source: "https://www.newhaven.edu/", topics: ["other", "reporting"], keywords: "student support dean conduct"
    },
    {
      id: "counseling", category: "campus", core: false, verified: false, checked: null,
      name: "Counseling and Psychological Services", what: "Counseling support for students.",
      contacts: [], source: "https://www.newhaven.edu/", topics: ["mental_health"], keywords: "counseling therapy mental health caps"
    },
    {
      id: "nh_pride_center", category: "community", core: false, verified: false, checked: null,
      name: "New Haven Pride Center", what: "LGBTQ+ community center serving the New Haven area.",
      contacts: [], source: "https://www.newhavenpridecenter.org/", topics: ["community"], keywords: "community center new haven lgbtq"
    },
    {
      id: "chro", category: "state", core: false, verified: false, checked: null,
      name: "Connecticut Commission on Human Rights and Opportunities", what: "The state agency that receives discrimination complaints.",
      contacts: [], source: "https://portal.ct.gov/chro", topics: ["title_ix", "reporting"], keywords: "state discrimination complaint civil rights connecticut"
    },
    {
      id: "ct_211", category: "state", core: false, verified: false, checked: null,
      name: "211 Connecticut", what: "Statewide directory of health and human services.",
      contacts: [], source: "https://www.211ct.org/", topics: ["other", "mental_health"], keywords: "211 services directory connecticut help"
    }
  ];

  var byId = {};
  records.forEach(function (r) { byId[r.id] = r; });

  /** Shown to students? Needs real contact details, and must be verified unless it is a core record. */
  function published(r) { return r.contacts.length > 0 && (r.verified || r.core); }

  var topicOrder = {
    reporting: ["report_it", "title_ix", "myatt", "dean_of_students", "chro"],
    housing: ["residential_life", "myatt", "report_it"],
    title_ix: ["title_ix", "report_it", "chro"],
    community: ["myatt", "nh_pride_center", "trevor", "trans_lifeline"],
    mental_health: ["counseling", "crisis_988", "trevor", "trans_lifeline", "ct_211"],
    safety: ["public_safety", "emergency_911", "title_ix", "crisis_988"],
    other: ["myatt", "report_it", "dean_of_students", "ct_211"]
  };

  /** Published records for a topic, most relevant first. */
  function forTopic(topic) {
    return (topicOrder[topic] || topicOrder.other).map(function (id) { return byId[id]; }).filter(published);
  }

  /** Which topic best fits a stored report, for the resources shown on the receipt. */
  function topicForReport(report) {
    if (!report) return "other";
    var cats = report.categories || [];
    if (cats.indexOf("safety") !== -1) return "safety";
    if (report.help === "peer") return "mental_health";
    if (report.help === "info" && report.topic) return report.topic.value === "other" ? "other" : report.topic.value;
    if (cats.indexOf("housing") !== -1 || (report.office && report.office.value === "housing")) return "housing";
    if (cats.indexOf("discrimination") !== -1 || cats.indexOf("harassment") !== -1) return "title_ix";
    if (report.help === "report" || report.help === "advocate") return "reporting";
    return "other";
  }

  /** Published records matching a search and an optional category. */
  function search(query, category) {
    var words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    return records.filter(published).filter(function (r) {
      if (category && r.category !== category) return false;
      var hay = (r.name + " " + r.what + " " + r.keywords).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  return {
    categories: categories,
    records: records,
    byId: byId,
    published: published,
    forTopic: forTopic,
    topicForReport: topicForReport,
    search: search,
    /** True when every core record has been verified. Intake stays closed until then. */
    coreVerified: function () { return records.every(function (r) { return !r.core || r.verified; }); },
    /** Everything still to check or fill in, for the owner's checklist. */
    outstanding: function () { return records.filter(function (r) { return !r.verified || !r.contacts.length; }); }
  };
});
