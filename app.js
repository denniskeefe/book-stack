/* Shared helpers, passcode gate and catalogue access for both pages. */
window.BP = (function () {
  "use strict";

  var SUPABASE_URL = "https://omoltkwfacfnxtuommvt.supabase.co";
  var SUPABASE_KEY = "sb_publishable_oIl-you4RLtgi5fJx7auBw_VvDbZ5Mi";
  var PASS_KEY = "bookstack.pass";

  // Keyless Google Books requests share one pooled daily quota across every
  // anonymous caller, and that pool is routinely exhausted, so the API answers
  // 429 for a shelf that has made no requests of its own. A key of your own
  // carries its own quota. Leave this empty to go on sharing the pool; the
  // lookup still works without it, with Google Books as a dead fallback.
  var GOOGLE_BOOKS_KEY = "";

  var BANDS = ["K-2", "3-5", "6-8", "9-12", "Adult", "Unknown"];

  var BP = {
    BANDS: BANDS,
    db: null,
    adminSet: false
  };

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

  /* ---------- passcode ---------- */

  // The passcode is enforced by row-level security in Postgres: every request
  // carries it as a header, and without it the API returns nothing. What is
  // kept here is only a convenience so the code is typed once per device.
  function storedCode() {
    try { return localStorage.getItem(PASS_KEY) || ""; } catch (e) { return ""; }
  }

  function rememberCode(code) {
    try { localStorage.setItem(PASS_KEY, code); } catch (e) {}
  }

  function forgetCode() {
    try { localStorage.removeItem(PASS_KEY); } catch (e) {}
  }

  function makeClient(code, admin) {
    var headers = {};
    if (code) headers["x-library-pass"] = code;
    if (admin) headers["x-library-admin"] = admin;
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      db: { schema: "library" },
      auth: { persistSession: false },
      global: { headers: headers }
    });
  }

  function gateShell(title, blurb) {
    document.body.classList.add("locked");
    var old = document.querySelector(".gate");
    if (old) old.remove();

    var gate = el("div", "gate");
    var card = el("div", "gate-card");
    card.appendChild(el("h1", "gate-mark", "Book Stack"));
    card.appendChild(el("h2", null, title));
    card.appendChild(el("p", "a", blurb));
    gate.appendChild(card);
    document.body.appendChild(gate);
    return card;
  }

  function unlocked(code, start) {
    rememberCode(code);
    BP.db = makeClient(code);
    var gate = document.querySelector(".gate");
    if (gate) gate.remove();
    document.body.classList.remove("locked");
    start();
  }

  function showUnlock(start, message) {
    var card = gateShell("Enter the passcode",
      message || "This shelf is shared. Ask whoever set it up for the passcode.");

    var form = el("form", "gate-form");
    var input = document.createElement("input");
    input.type = "password";
    input.className = "field";
    input.id = "passcode";
    input.autocomplete = "current-password";
    input.placeholder = "Passcode";
    input.setAttribute("aria-label", "Library passcode");
    var go = el("button", "btn primary", "Unlock");
    go.type = "submit";
    form.append(input, go);

    var note = el("p", "gate-note");
    form.onsubmit = function (e) {
      e.preventDefault();
      var code = input.value;
      if (!code) return;
      go.disabled = true;
      note.textContent = "Checking…";
      makeClient(null).rpc("check_passcode", { p_code: code }).then(function (res) {
        go.disabled = false;
        if (res.error) { note.textContent = "Could not reach the library. Try again."; return; }
        if (res.data !== true) {
          note.textContent = "That passcode is not right.";
          input.select();
          return;
        }
        unlocked(code, start);
      });
    };

    card.append(form, note);
    input.focus();
  }

  function showSetup(start) {
    var card = gateShell("Set the passcode",
      "Nobody has claimed this shelf yet. Pick a passcode now — everyone who borrows books will type it once on their own device.");

    var form = el("form", "gate-form");
    var one = document.createElement("input");
    one.type = "password";
    one.className = "field";
    one.id = "passcode-new";
    one.autocomplete = "new-password";
    one.placeholder = "New passcode";
    one.setAttribute("aria-label", "New passcode");
    var two = document.createElement("input");
    two.type = "password";
    two.className = "field";
    two.id = "passcode-again";
    two.autocomplete = "new-password";
    two.placeholder = "Type it again";
    two.setAttribute("aria-label", "Repeat the new passcode");
    var go = el("button", "btn primary", "Lock the shelf");
    go.type = "submit";
    form.append(one, two, go);

    var note = el("p", "gate-note", "At least 6 characters. There is no way to recover it — write it down.");
    form.onsubmit = function (e) {
      e.preventDefault();
      if (one.value.length < 6) { note.textContent = "Make it at least 6 characters."; return; }
      if (one.value !== two.value) { note.textContent = "Those two do not match."; two.select(); return; }
      go.disabled = true;
      note.textContent = "Setting it…";
      makeClient(null).rpc("set_passcode", { p_code: one.value }).then(function (res) {
        go.disabled = false;
        if (res.error) {
          note.textContent = /already set/i.test(res.error.message || "")
            ? "Someone just set a passcode. Reload and type it in."
            : "Could not set the passcode. Try again.";
          return;
        }
        unlocked(one.value, start);
      });
    };

    card.append(form, note);
    one.focus();
  }

  // Runs `start` once the page is allowed to talk to the catalogue.
  function ready(start) {
    makeClient(null).from("lock_state").select("locked, admin_set").single().then(function (res) {
      if (!res.error) BP.adminSet = res.data.admin_set === true;
      if (res.error) {
        var offline = storedCode();
        if (offline) { BP.db = makeClient(offline); start(); return; }
        showUnlock(start, "The library did not answer. Check your connection, then try your passcode.");
        return;
      }
      if (!res.data.locked) return showSetup(start);

      var saved = storedCode();
      if (!saved) return showUnlock(start);

      makeClient(null).rpc("check_passcode", { p_code: saved }).then(function (check) {
        if (check.error) { BP.db = makeClient(saved); start(); return; }
        if (check.data === true) { BP.db = makeClient(saved); start(); return; }
        forgetCode();
        showUnlock(start, "The passcode changed. Ask for the new one.");
      });
    });
  }

  function lockDevice() {
    forgetCode();
    leaveAdmin();
    location.reload();
  }

  /* ---------- admin ---------- */

  // A second credential. The shelf passcode permits reading, adding and
  // editing; only the admin password permits a delete, and Postgres enforces
  // that through the delete policies on books, readers and loans. It is kept in
  // sessionStorage rather than localStorage, so admin rights end with the tab
  // instead of lingering on a shared device.
  var ADMIN_KEY = "bookstack.admin";
  var adminDb = null;

  function adminCode() {
    try { return sessionStorage.getItem(ADMIN_KEY) || ""; } catch (e) { return ""; }
  }

  function isAdmin() { return !!adminCode(); }

  function enterAdmin(code) {
    try { sessionStorage.setItem(ADMIN_KEY, code); } catch (e) {}
    adminDb = null;
  }

  function leaveAdmin() {
    try { sessionStorage.removeItem(ADMIN_KEY); } catch (e) {}
    adminDb = null;
  }

  // A delete needs both headers: the admin password to satisfy the delete
  // policy, and the shelf passcode for the row to be visible to the request at
  // all. Returns null when this tab is not in admin mode.
  function adminClient() {
    if (!isAdmin()) return null;
    if (!adminDb) adminDb = makeClient(storedCode(), adminCode());
    return adminDb;
  }

  function adminState() {
    return makeClient(null).from("lock_state").select("locked, admin_set").single();
  }

  function checkAdmin(code) {
    return makeClient(null).rpc("check_admin", { p_code: code });
  }

  // Setting or changing the admin password requires the shelf passcode, which
  // travels as a header; changing it also requires the current one.
  function setAdminPass(code, current) {
    return makeClient(storedCode()).rpc("set_admin_passcode", {
      p_code: code,
      p_current: current || null
    });
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

  // Google Books is consulted for the metadata, for a band and for a cover, so
  // the answer is kept per ISBN to keep one scan to one request.
  var googleSeen = {};
  function googleFor(isbn) {
    if (!googleSeen[isbn]) {
      googleSeen[isbn] = fromGoogleBooks(isbn).catch(function () { return null; });
    }
    return googleSeen[isbn];
  }

  function fromGoogleBooks(isbn) {
    var url = "https://www.googleapis.com/books/v1/volumes?q=isbn:" + isbn +
      (GOOGLE_BOOKS_KEY ? "&key=" + encodeURIComponent(GOOGLE_BOOKS_KEY) : "");
    return fetch(url)
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
    var sources = [fromOpenLibrary, fromOpenLibrarySearch, googleFor];
    var i = 0;
    function next() {
      if (i >= sources.length) return Promise.resolve(null);
      return sources[i++](isbn).catch(function () { return null; }).then(function (hit) {
        return hit || next();
      });
    }
    return next();
  }

  // Open Library frequently omits audience wording that Google Books carries in
  // its categories, so an inconclusive band is worth a second opinion.
  function bandFor(hit, isbn) {
    var band = inferBand(hit);
    if (band !== "Adult" && band !== "Unknown") return Promise.resolve(band);
    if (hit.source === "Google Books") return Promise.resolve(band);
    return googleFor(isbn).then(function (g) {
      if (!g) return band;
      var second = inferBand({
        subjects: (hit.subjects || "") + "; " + (g.subjects || ""),
        audience: g.audience || ""
      });
      return second === "Unknown" ? band : second;
    });
  }

  /* ---------- covers ---------- */

  // The endpoint that knows a title does not always carry its picture: Open
  // Library's book API reported no cover for a title whose cover its own image
  // endpoint serves perfectly well. So a cover is resolved separately from the
  // metadata, by probing candidates and keeping the first that really loads.
  function imageLoads(url) {
    return new Promise(function (settle) {
      var img = new Image();
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        img.onload = img.onerror = null;
        settle(ok);
      }
      // Asked without default=false, Open Library answers a missing cover with
      // a 1px placeholder that loads successfully, so size is checked too.
      img.onload = function () { finish(img.naturalWidth > 2 && img.naturalHeight > 2); };
      img.onerror = function () { finish(false); };
      setTimeout(function () { finish(false); }, 5000);
      img.src = url;
    });
  }

  function firstThatLoads(urls) {
    var seen = {};
    var list = urls.filter(function (u) {
      if (!u || seen[u]) return false;
      seen[u] = true;
      return true;
    });
    function next(i) {
      if (i >= list.length) return Promise.resolve("");
      return imageLoads(list[i]).then(function (ok) {
        return ok ? list[i] : next(i + 1);
      });
    }
    return next(0);
  }

  // Open Library is asked by ISBN as well as by whatever the metadata gave,
  // and Google Books is consulted only if neither produced an image.
  function coverFor(hit, isbn) {
    var tries = [];
    if (hit && hit.cover_url) tries.push(hit.cover_url);
    // -M is about 180px wide, which is what a 44px thumbnail wants even on a
    // 3x screen; -L is only worth asking for if the medium size is missing.
    tries.push("https://covers.openlibrary.org/b/isbn/" + isbn + "-M.jpg?default=false");
    tries.push("https://covers.openlibrary.org/b/isbn/" + isbn + "-L.jpg?default=false");
    return firstThatLoads(tries).then(function (found) {
      if (found) return found;
      return googleFor(isbn).then(function (g) {
        if (!g || !g.cover_url) return "";
        return imageLoads(g.cover_url).then(function (ok) {
          return ok ? g.cover_url : "";
        });
      });
    });
  }

  // Initials stand in for a cover, so the words that carry the title are the
  // ones worth showing.
  function initialsOf(title) {
    var skip = { a: 1, an: 1, the: 1, of: 1, and: 1, to: 1, in: 1, on: 1 };
    var words = String(title || "").split(/[^A-Za-z0-9]+/).filter(function (w) {
      return w && !skip[w.toLowerCase()];
    });
    return words.slice(0, 3).map(function (w) {
      return w.charAt(0).toUpperCase();
    }).join("");
  }

  // Not every book has a cover anywhere, so one is drawn instead: the title's
  // initials on a colour derived from the ISBN, which keeps a given book
  // looking the same on every device and in every list it appears in.
  function coverTile(book) {
    var isbn = String(book.isbn13 || "");
    var hue = 0;
    for (var i = 0; i < isbn.length; i++) {
      hue = (hue * 31 + isbn.charCodeAt(i)) % 360;
    }
    var node = el("div", "cover blank", initialsOf(book.title) || "?");
    node.style.setProperty("--tile-h", hue);
    return node;
  }

  // Both pages show the same thumbnail: the real cover where there is one, a
  // drawn tile where there is not, and the tile again if the image 404s later.
  function coverNode(book) {
    if (!book.cover_url) {
      return book.lookup_state === "pending" ? el("div", "cover", "\u2026") : coverTile(book);
    }
    var img = document.createElement("img");
    img.className = "cover";
    img.src = book.cover_url;
    img.alt = "";
    img.loading = "lazy";
    img.onerror = function () { img.replaceWith(coverTile(book)); };
    return img;
  }

  // A band counts as chosen only when someone picked a real one. "Unknown"
  // records the absence of a choice rather than a choice, so a hand-set
  // "Unknown" stays eligible for a later lookup to fill in.
  function bandChosen(book) {
    return book.grade_band_source === "manual" &&
      !!book.grade_band && book.grade_band !== "Unknown";
  }

  // Resolves a pending book row and writes what it found back to the catalogue.
  function resolve(isbn, keepBand) {
    return lookup(isbn).then(function (hit) {
      if (!hit) {
        return BP.db.from("books").update({ lookup_state: "missing" })
          .eq("isbn13", isbn).select().single();
      }
      return Promise.all([
        keepBand ? Promise.resolve(null) : bandFor(hit, isbn),
        coverFor(hit, isbn)
      ]).then(function (out) {
        var band = out[0];
        var patch = {
          title: hit.title || "",
          authors: hit.authors || "",
          publisher: hit.publisher || "",
          year: hit.year || "",
          pages: hit.pages,
          subjects: hit.subjects || "",
          cover_url: out[1],
          source: hit.source || "",
          lookup_state: "ok"
        };
        if (band) {
          patch.grade_band = band;
          patch.grade_band_source = "auto";
        }
        return BP.db.from("books").update(patch).eq("isbn13", isbn).select().single();
      });
    });
  }

  /* ---------- dates ---------- */

  function dayStamp(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function daysUntil(iso) {
    return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  }

  function dueLabel(iso) {
    var d = daysUntil(iso);
    if (d < 0) return Math.abs(d) + (Math.abs(d) === 1 ? " day overdue" : " days overdue");
    if (d === 0) return "due today";
    if (d === 1) return "due tomorrow";
    return "due in " + d + " days";
  }

  BP.$ = $;
  BP.el = el;
  BP.toast = toast;
  BP.ready = ready;
  BP.lockDevice = lockDevice;
  BP.isAdmin = isAdmin;
  BP.enterAdmin = enterAdmin;
  BP.leaveAdmin = leaveAdmin;
  BP.adminClient = adminClient;
  BP.adminState = adminState;
  BP.checkAdmin = checkAdmin;
  BP.setAdminPass = setAdminPass;
  BP.normalizeISBN = normalizeISBN;
  BP.inferBand = inferBand;
  BP.lookup = lookup;
  BP.resolve = resolve;
  BP.bandChosen = bandChosen;
  BP.coverFor = coverFor;
  BP.coverNode = coverNode;
  BP.dayStamp = dayStamp;
  BP.daysUntil = daysUntil;
  BP.dueLabel = dueLabel;
  return BP;
})();
