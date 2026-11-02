/* Shared helpers for the scanner and the library dashboard. */
window.BP = (function () {
  "use strict";

  var SUPABASE_URL = "https://omoltkwfacfnxtuommvt.supabase.co";
  var SUPABASE_KEY = "sb_publishable_oIl-you4RLtgi5fJx7auBw_VvDbZ5Mi";

  var db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    db: { schema: "library" },
    auth: { persistSession: false }
  });

  var BANDS = ["K-2", "3-5", "6-8", "9-12", "Adult", "Unknown"];

  /* ---------- small DOM helpers ---------- */

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  var toastTimer = null;
  function toast(msg, bad) {
    var node = document.querySelector(".toast");
    if (!node) {
      node = el("div", "toast");
      node.setAttribute("role", "status");
      document.body.appendChild(node);
    }
    node.className = "toast" + (bad ? " bad" : "");
    node.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.remove(); }, 3000);
  }

  /* ---------- ISBN ---------- */

  function checkDigit13(twelve) {
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+twelve[i]) * (i % 2 ? 3 : 1);
    return String((10 - (sum % 10)) % 10);
  }

  function valid10(s) {
    if (!/^[0-9]{9}[0-9X]$/.test(s)) return false;
    var sum = 0;
    for (var i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : +s[i]) * (10 - i);
    return sum % 11 === 0;
  }

  // Returns a 13-digit ISBN, or "" when the code is not a book.
  function normalizeISBN(raw) {
    var s = String(raw).replace(/[^0-9Xx]/g, "").toUpperCase();
    if (s.length === 10 && valid10(s)) {
      var core = "978" + s.slice(0, 9);
      return core + checkDigit13(core);
    }
    if (s.length === 13 && /^97[89][0-9]{10}$/.test(s) && checkDigit13(s.slice(0, 12)) === s[12]) return s;
    return "";
  }

  /* ---------- reading level ---------- */

  // No free catalogue publishes a reading level, so it is inferred from the
  // audience and subject wording the lookup APIs do return, then left editable.
  var LEVEL_RULES = [
    { band: "K-2", re: /board book|baby|toddler|picture book|preschool|kindergarten|ages? 0|ages? 1-|ages? 2|ages? 3|ages? 4|ages? 5|beginning reader|early reader|easy reader|readers \(primary|first reader|grade[s]? k/ },
    { band: "3-5", re: /ages? 6|ages? 7|ages? 8|ages? 9|ages? 10|middle grade|chapter book|juvenile fiction|juvenile literature|juvenile nonfiction|children's (stories|fiction|literature)|grade[s]? [345]/ },
    { band: "6-8", re: /ages? 11|ages? 12|middle school|junior high|grade[s]? [678]/ },
    { band: "9-12", re: /young adult|ya fiction|teen|teenage|ages? 1[3-7]|high school|grade[s]? (9|1[012])/ }
  ];

  function inferBand(info) {
    var hay = [info.subjects || "", info.categories || "", info.audience || ""].join(" ").toLowerCase();
    if (/mature|adult content/.test(hay)) return "Adult";
    for (var i = 0; i < LEVEL_RULES.length; i++) {
      if (LEVEL_RULES[i].re.test(hay)) return LEVEL_RULES[i].band;
    }
    // Subject data came back and said nothing juvenile: treat as a grown-up book.
    return hay.trim() ? "Adult" : "Unknown";
  }

  /* ---------- lookup ---------- */

  function joinNames(list) {
    if (!list || !list.length) return "";
    return list.map(function (a) { return typeof a === "string" ? a : a.name; }).filter(Boolean).join(", ");
  }

  function yearOf(s) {
    var m = String(s || "").match(/\d{4}/);
    return m ? m[0] : "";
  }

  function fromOpenLibrary(isbn) {
    return fetch("https://openlibrary.org/api/books?bibkeys=ISBN:" + isbn + "&format=json&jscmd=data")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var d = data["ISBN:" + isbn];
        if (!d || !d.title) return null;
        var cover = d.cover ? (d.cover.medium || d.cover.small || "") : "";
        return {
          title: d.title + (d.subtitle ? ": " + d.subtitle : ""),
          authors: joinNames(d.authors),
          publisher: joinNames(d.publishers),
          year: yearOf(d.publish_date),
          pages: d.number_of_pages || null,
          subjects: (d.subjects || []).slice(0, 12).map(function (s) { return s.name; }).join("; "),
          cover_url: cover.replace(/^http:/, "https:"),
          source: "Open Library"
        };
      });
  }

  function fromOpenLibrarySearch(isbn) {
    var fields = "title,author_name,publisher,first_publish_year,number_of_pages_median,cover_i,subject";
    return fetch("https://openlibrary.org/search.json?isbn=" + isbn + "&limit=1&fields=" + fields)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var d = data && data.docs && data.docs[0];
        if (!d || !d.title) return null;
        return {
          title: d.title,
          authors: joinNames(d.author_name),
          publisher: joinNames(d.publisher ? d.publisher.slice(0, 1) : []),
          year: d.first_publish_year ? String(d.first_publish_year) : "",
          pages: d.number_of_pages_median || null,
          subjects: (d.subject || []).slice(0, 12).join("; "),
          cover_url: d.cover_i ? "https://covers.openlibrary.org/b/id/" + d.cover_i + "-M.jpg" : "",
          source: "Open Library"
        };
      });
  }

  function fromGoogleBooks(isbn) {
    return fetch("https://www.googleapis.com/books/v1/volumes?q=isbn:" + isbn)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var item = data && data.items && data.items[0];
        var v = item && item.volumeInfo;
        if (!v || !v.title) return null;
        var img = v.imageLinks ? (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail || "") : "";
        return {
          title: v.title + (v.subtitle ? ": " + v.subtitle : ""),
          authors: joinNames(v.authors),
          publisher: v.publisher || "",
          year: yearOf(v.publishedDate),
          pages: v.pageCount || null,
          subjects: (v.categories || []).slice(0, 12).join("; "),
          audience: v.maturityRating || "",
          cover_url: img.replace(/^http:/, "https:"),
          source: "Google Books"
        };
      });
  }

  function lookup(isbn) {
    var sources = [fromOpenLibrary, fromOpenLibrarySearch, fromGoogleBooks];
    var i = 0;
    function next() {
      if (i >= sources.length) return Promise.resolve(null);
      return sources[i++](isbn).catch(function () { return null; }).then(function (hit) {
        return hit || next();
      });
    }
    return next();
  }

  // Resolves a pending book row and writes what it found back to the catalogue.
  function resolve(isbn, keepBand) {
    return lookup(isbn).then(function (hit) {
      var patch;
      if (hit) {
        patch = {
          title: hit.title || "",
          authors: hit.authors || "",
          publisher: hit.publisher || "",
          year: hit.year || "",
          pages: hit.pages,
          subjects: hit.subjects || "",
          cover_url: hit.cover_url || "",
          source: hit.source || "",
          lookup_state: "ok"
        };
        if (!keepBand) patch.grade_band = inferBand(hit);
      } else {
        patch = { lookup_state: "missing" };
      }
      return db.from("books").update(patch).eq("isbn13", isbn).select().single();
    });
  }

  /* ---------- dates ---------- */

  function dayStamp(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function daysUntil(iso) {
    var ms = new Date(iso).getTime() - Date.now();
    return Math.ceil(ms / 86400000);
  }

  function dueLabel(iso) {
    var d = daysUntil(iso);
    if (d < 0) return Math.abs(d) + (Math.abs(d) === 1 ? " day overdue" : " days overdue");
    if (d === 0) return "due today";
    if (d === 1) return "due tomorrow";
    return "due in " + d + " days";
  }

  return {
    db: db,
    BANDS: BANDS,
    $: $, el: el, toast: toast,
    normalizeISBN: normalizeISBN,
    inferBand: inferBand,
    lookup: lookup,
    resolve: resolve,
    dayStamp: dayStamp,
    daysUntil: daysUntil,
    dueLabel: dueLabel
  };
})();
