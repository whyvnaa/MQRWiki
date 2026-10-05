/* The build calculator (guides/calculator.md).
 *
 * The calculator runs the real planner in a web worker (build-planner-worker.js: Python in the browser), the same
 * code as the overlay's Build mode, so there is no second implementation to keep in step. This file only draws:
 * the controls, the timeline (one lane per slot over levels 1 to 60) and the card of one level. */
(function () {
  "use strict";
  var SCRIPT = document.currentScript || document.querySelector('script[src*="build-planner.js"]');
  var ROOT = new URL("../", SCRIPT.src);
  var TRIBES = ["Shadow", "Bone", "Outlaw", "Wild", "Grease", "Crossroads"];
  var TRIBE_EL = { Shadow: "air", Bone: "earth", Outlaw: "fire", Wild: "ice", Grease: "lightning", Crossroads: "blunt" };
  var EL_NAME = { air: "Air", earth: "Earth", fire: "Fire", ice: "Ice", lightning: "Lightning", blunt: "blunt" };
  var HOTBAR = [["melee", "Melee"], ["ranged", "Ranged"], ["stun", "Stun"], ["heal", "Heal"], ["poison", "Poison"], ["buff", "Buff"]];
  var SOURCES = [["vendor", "Vendors"], ["chest", "Chests"], ["enemy", "Enemies"], ["craft", "Crafting"], ["quest", "Quests"],
                 ["nick_cash", "NickCash"], ["unknown", "No known way"]];
  var EFFORTS = [["", "Any effort"], ["1", "Up to 1 h an item"], ["3", "Up to 3 h an item"], ["10", "Up to 10 h an item"],
                 ["30", "Up to 30 h an item"]];
  var SWITCHES = [["0", "Every upgrade"], ["5", "Small upgrades too"], ["15", "Clear upgrades"], ["40", "Big upgrades only"]];
  var TIMES = [["0", "Time is irrelevant"], ["1", "Time counts a little"], ["4", "Time counts"], ["15", "Time counts a lot"]];
  var DEFAULTS = { level: 20, tribe: "Auto", slots: ["melee", "ranged"], where: "level",
                   sources: ["vendor", "chest", "enemy", "craft", "quest"], effort: null, "switch": 5, time: 0, owned: [],
                   excluded: [] };
  var SHOWN = 4;  // items on show per slot before "Show all"
  var STORE = "mq-build-planner";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function href(path) { return new URL(path, ROOT).href; }
  function pic(it, size) {
    return it && it.icon ? '<img class="bp-icon" src="' + esc(href(it.icon)) + '" alt="" width="' + size + '" height="' + size + '" loading="lazy">'
      : '<span class="bp-icon bp-noicon" style="width:' + size + "px;height:" + size + 'px"></span>';
  }
  function crest(tribe, size) {
    return '<img class="bp-crest" src="' + esc(href("assets/theme/crests/" + tribe.toLowerCase() + ".png")) + '" alt="" width="' + size + '" height="' + size + '">';
  }
  function name(it) {
    return it && it.url ? '<a href="' + esc(href(it.url)) + '">' + esc(it.name) + "</a>" : esc(it ? it.name : "?");
  }
  function levels(a, b) { return a === b ? "level " + a : "levels " + a + " to " + b; }

  /* ------------------------------------------------------------------ the timeline
   * data: a progression (planner_web.Web.progression). opts: {level: the level on show, onLevel(level)}. */
  function timeline(el, data, opts) {
    opts = opts || {};
    var lo = data.lo, n = data.hi - data.lo + 1;
    var left = function (lv) { return ((lv - lo) / n * 100).toFixed(3) + "%"; };
    var width = function (a, b) { return ((b - a + 1) / n * 100).toFixed(3) + "%"; };
    var ticks = "";
    for (var lv = lo; lv <= data.hi; lv++) {
      if (lv === lo || lv % 5 === 0) ticks += '<span class="bp-tick" style="left:' + left(lv) + ";width:" + width(lv, lv) + '">' + lv + "</span>";
    }
    var html = '<div class="bp-lane bp-axis"><div class="bp-lab">Level</div><div class="bp-track">' + ticks + "</div></div>";
    var segs = data.badges.map(function (b) {
      var el2 = TRIBE_EL[b.tribe] || "blunt";
      return '<div class="bp-seg bp-badge bp-el-' + el2 + '" style="left:' + left(b.from) + ";width:" + width(b.from, b.to) + '" title="' +
        esc(b.tribe + " badge, " + levels(b.from, b.to)) + '">' + crest(b.tribe, 22) + "<span>" + esc(b.tribe) + "</span></div>";
    }).join("");
    html += '<div class="bp-lane"><div class="bp-lab">Badge</div><div class="bp-track">' + segs + "</div></div>";
    data.lanes.forEach(function (lane, i) {
      var first = i > 0 && lane.kind !== data.lanes[i - 1].kind;
      segs = lane.segs.map(function (s) {
        var it = data.items[s.item];
        var tip = it.name + " · " + levels(s.from, s.to) + " · " + (s.owned ? "you have it" : s.hours == null ? "no known way" : s.time + ", " + s.kind) +
          (s.way ? " · " + s.way : "");
        return '<div class="bp-seg bp-el-' + esc((it.el || "blunt").toLowerCase()) + (s.owned ? " bp-owned" : "") + (s.hours == null && !s.owned ? " bp-unknown" : "") +
          '" style="left:' + left(s.from) + ";width:" + width(s.from, s.to) + '" title="' + esc(tip) + '">' + pic(it, 22) + "<span>" + esc(it.name) + "</span></div>";
      }).join("");
      html += '<div class="bp-lane' + (first ? " bp-gap" : "") + '"><div class="bp-lab">' + esc(lane.label) + '</div><div class="bp-track">' + segs + "</div></div>";
    });
    el.innerHTML = '<div class="bp-tl-in">' + html + "</div>";
    el.classList.add("bp-tl");
    var mark = function (level) {
      el.querySelectorAll(".bp-cur").forEach(function (c) { c.remove(); });
      if (level == null) return;
      el.querySelectorAll(".bp-track").forEach(function (t) {
        var c = document.createElement("div");
        c.className = "bp-cur";
        c.style.left = left(level);
        c.style.width = width(level, level);
        t.appendChild(c);
      });
    };
    mark(opts.level);
    el.onclick = function (e) {
      var track = e.target.closest(".bp-track");
      if (!track || !opts.onLevel) return;
      var r = track.getBoundingClientRect();
      var level = Math.max(lo, Math.min(data.hi, lo + Math.floor((e.clientX - r.left) / r.width * n)));
      opts.onLevel(level);
    };
    return { mark: mark };
  }

  /* ------------------------------------------------------------------ the calculator */
  function calculator(mount) {
    var state = Object.assign({}, DEFAULTS);
    try { Object.assign(state, JSON.parse(localStorage.getItem(STORE) || "{}")); } catch (e) { /* no storage */ }
    var q = new URLSearchParams(window.location.search);
    var list = function (v) { return v ? v.split(",") : []; };
    if (q.has("level")) state.level = parseInt(q.get("level"), 10) || state.level;
    if (q.has("tribe")) state.tribe = q.get("tribe");
    if (q.has("slots")) state.slots = list(q.get("slots"));
    if (q.has("where")) state.where = q.get("where");
    if (q.has("sources")) state.sources = list(q.get("sources"));
    if (q.has("effort")) state.effort = parseFloat(q.get("effort")) || null;
    if (q.has("switch")) state["switch"] = parseFloat(q.get("switch")) || 0;
    if (q.has("time")) state.time = parseFloat(q.get("time")) || 0;
    state.level = Math.max(1, Math.min(60, state.level || 20));
    if (!Array.isArray(state.excluded)) state.excluded = [];
    var view = state.level;  // the level whose card is on show
    var open = {};  // slots with every item on show
    var prog = null, tl = null;

    var worker = new Worker(new URL("build-planner-worker.js" + new URL(SCRIPT.src).search, SCRIPT.src));
    var calls = {}, nextId = 1;
    worker.onmessage = function (e) {
      var c = calls[e.data.id];
      delete calls[e.data.id];
      if (c) (e.data.error ? c[1] : c[0])(e.data.error || e.data.result);
    };
    worker.onerror = function (e) { fail(e.message || "the calculator could not start"); };
    function call(fn, level) {
      return new Promise(function (ok, no) {
        var id = nextId++;
        calls[id] = [ok, no];
        worker.postMessage({ id: id, fn: fn, options: state, level: level });
      });
    }

    function save() {
      try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* no storage */ }
      var p = new URLSearchParams();
      p.set("level", state.level);
      p.set("tribe", state.tribe);
      if (state.slots.join() !== DEFAULTS.slots.join()) p.set("slots", state.slots.join(","));
      if (state.where !== "level") p.set("where", state.where);
      if (state.sources.slice().sort().join() !== DEFAULTS.sources.slice().sort().join()) p.set("sources", state.sources.join(","));
      if (state.effort) p.set("effort", state.effort);
      if (state["switch"] !== 5) p.set("switch", state["switch"]);
      if (state.time) p.set("time", state.time);
      history.replaceState(null, "", window.location.pathname + "?" + p.toString().replace(/%2C/g, ",") + window.location.hash);
    }

    function options(list2, value) {
      return list2.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value == null ? "" : value) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("");
    }
    function chips(nameAttr, list2, on, pics) {
      return list2.map(function (o) {
        return '<button type="button" class="bp-chip' + (on(o[0]) ? " bp-on" : "") + '" data-' + nameAttr + '="' + esc(o[0]) + '">' +
          (pics ? pics(o[0]) : "") + esc(o[1]) + "</button>";
      }).join("");
    }

    mount.innerHTML =
      '<div class="bp-controls">' +
        '<div class="bp-group"><label class="bp-cap" for="bp-level">Your level</label><input id="bp-level" type="number" min="1" max="60" value="' + state.level + '"></div>' +
        '<div class="bp-group"><span class="bp-cap">Badge</span><span class="bp-chips" id="bp-tribes"></span></div>' +
        '<div class="bp-group"><span class="bp-cap">Hotbar</span><span class="bp-chips" id="bp-slots"></span></div>' +
        '<div class="bp-group"><label class="bp-cap" for="bp-where">Enemies</label><select id="bp-where"></select></div>' +
        '<div class="bp-group"><span class="bp-cap">Items from</span><span class="bp-chips" id="bp-sources"></span></div>' +
        '<div class="bp-group"><span class="bp-cap">Progression</span>' +
          '<select id="bp-switch" title="When an item is replaced. A new item must make up for the change over the levels you keep it.">' + options(SWITCHES, state["switch"]) + "</select>" +
          '<select id="bp-time" title="Whether the hours it takes to get an item count.">' + options(TIMES, state.time) + "</select>" +
          '<select id="bp-effort" title="Leave out items that take longer to get than this.">' + options(EFFORTS, state.effort) + "</select></div>" +
      "</div>" +
      '<p class="bp-status" id="bp-status"></p>' +
      '<p id="bp-owned" hidden></p>' +
      '<p id="bp-excluded" hidden></p>' +
      '<div id="bp-timeline"></div>' +
      '<div id="bp-card"></div>';
    var $ = function (id) { return mount.querySelector("#" + id); };
    var status = function (t) { $("bp-status").textContent = t || ""; $("bp-status").hidden = !t; };
    function fail(t) { status("Something went wrong: " + t + ". Reload the page to try again."); }

    function drawChips() {
      $("bp-tribes").innerHTML = chips("tribe", [["Auto", "Auto"]].concat(TRIBES.map(function (t) { return [t, t]; })),
        function (t) { return state.tribe === t; }, function (t) { return t === "Auto" ? "" : crest(t, 18); });
      $("bp-slots").innerHTML = chips("slot", HOTBAR, function (s) { return state.slots.indexOf(s) >= 0; });
      $("bp-sources").innerHTML = chips("source", SOURCES, function (s) { return state.sources.indexOf(s) >= 0; });
    }
    function drawWhere(zones) {
      var opts = [["level", "Zones around each level"], ["all", "All zones"], ["Air", "Air attackers"], ["Earth", "Earth attackers"],
                  ["Fire", "Fire attackers"], ["Ice", "Ice attackers"], ["Lightning", "Lightning attackers"], ["blunt", "Blunt attackers"]];
      (zones || []).forEach(function (z) { opts.push(["zone:" + z.zone, z.title + " (level " + z.level + ")"]); });
      $("bp-where").innerHTML = options(opts, state.where);
    }
    function drawOwned() {
      var n = state.owned.length;
      $("bp-owned").hidden = !n;
      $("bp-owned").innerHTML = n ? "Planning around " + n + (n === 1 ? " item" : " items") + ' you have. <button type="button" class="bp-more" data-forget="1">Forget them</button>' : "";
    }
    /* The items you excluded, each with a button that takes it back in (names: the last progression's). */
    function drawExcluded() {
      var items = prog ? prog.items : {};
      var list2 = prog ? prog.excluded : [];
      $("bp-excluded").hidden = !list2.length;
      $("bp-excluded").innerHTML = list2.length ? '<span class="bp-cap">Excluded items</span> ' + list2.map(function (p) {
        return '<span class="bp-excl">' + pic(items[p], 18) + name(items[p]) + ' <button type="button" class="bp-own" data-exclude="' + esc(p) +
          '" title="Suggest ' + esc(items[p].name) + ' again">Include again</button></span>';
      }).join(" ") : "";
    }
    function toggle(arr, v) {
      var i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
    }

    var run = 0;
    function refresh() {
      var mine = ++run;
      save();
      status(prog ? "Working out the best gear for every level…" : "Loading the calculator. The first visit downloads about 5 MB…");
      mount.classList.add("bp-busy");
      call("progression").then(function (r) {
        if (mine !== run) return;
        prog = r;
        drawExcluded();
        tl = timeline($("bp-timeline"), r, { level: view, onLevel: function (level) { view = level; tl.mark(level); card(); } });
        return card(mine);
      }).catch(fail);
    }
    function card(mine) {
      mine = mine || run;
      return call("stage", view).then(function (s) {
        if (mine !== run) return;
        status("");
        mount.classList.remove("bp-busy");
        drawCard(s);
      }).catch(fail);
    }

    function row(r, items) {
      var it = items[r.item];
      var tags = [];
      if (r.best) tags.push('<span class="bp-star">★ best</span>');
      if (r.owned) tags.push('<span class="bp-gain">you have it</span>');
      if (r.over) tags.push('<span class="bp-dim">over your effort limit</span>');
      tags.push('<span class="bp-dim">level ' + it.lv + "</span>");
      var right = r.owned ? '<b class="bp-gain">have</b>' : r.hours == null ? '<b class="bp-loss">no known way</b>'
        : "<b>" + esc(r.time) + '</b> <span class="bp-dim">' + esc(r.kind) + "</span>";
      var delta = r.delta ? ' <span class="' + (r.delta[1] ? "bp-" + r.delta[1] : "bp-dim") + '">' + esc(r.delta[0]) + "</span>" : "";
      var way = r.way && r.hours != null ? '<div class="bp-way">' + esc((r.grade ? r.grade + ": " : "") + r.way) + "</div>" : "";
      return '<div class="bp-row' + (r.best ? " bp-best" : "") + '">' + pic(it, 36) +
        '<div class="bp-main"><div class="bp-name">' + name(it) + " " + tags.join(" · ") + "</div>" +
        '<div class="bp-line">' + esc(r.line) + delta + "</div>" + way + "</div>" +
        '<div class="bp-right">' + right + '<button type="button" class="bp-own" data-own="' + esc(r.item) + '">' +
        (r.owned ? "I don't have it" : "I have it") + '</button><button type="button" class="bp-own" data-exclude="' + esc(r.item) +
        '" title="Never suggest this item: it leaves every level and list. Excluded items are listed above the timeline.">Exclude</button></div></div>';
    }
    function slot(s, items, utility) {
      var sub = utility ? "with this level's set" : s.ways + " to choose from" + (s.none ? ", " + s.none + " more with no known way" : "");
      var html = '<h3 class="bp-slot">' + esc(s.label) + ' <small class="bp-dim">' + sub + "</small></h3>";
      if (!s.rows.length) return html + '<p class="bp-dim">Nothing to wear here at this level.</p>';
      var all = open[s.label] || s.rows.length <= SHOWN;
      html += (all ? s.rows : s.rows.slice(0, SHOWN)).map(function (r) { return row(r, items); }).join("");
      if (s.rows.length > SHOWN) {
        html += '<button type="button" class="bp-more" data-more="' + esc(s.label) + '">' +
          (open[s.label] ? "Show fewer " : "Show all " + s.rows.length + " ") + esc(s.label.toLowerCase()) + " items</button>";
      }
      return html;
    }
    var last = null;
    function drawCard(s) {
      last = s;
      var el = TRIBE_EL[s.tribe] || "blunt";
      var badge = s.badge.damage ? "badge level " + s.badge.level + ': <span class="mq-hl mq-' + el + '">+' + s.badge.damage + " " + EL_NAME[el] +
        ' damage</span>, <span class="mq-hl mq-def">+' + s.badge.defence + " defence</span>" : "no badge bonus yet";
      var hits = s.hits.map(function (h) { return esc(h.slot) + ' <span class="mq-hl mq-dmg">' + h.hit.toLocaleString("en") + "</span> × " + h.n; }).join(" · ");
      var compare = s.compare.map(function (c) {
        var t = esc(c.tribe + " " + c.kill + " (" + c.hits + ")");
        return c.best ? '<b class="bp-star">' + t + "</b>" : t;
      }).join(" · ");
      var head = '<div class="bp-head"><div><span class="bp-level">Level ' + s.level + "</span> " + (s.auto ? "Best badge: " : "") + crest(s.tribe, 22) + " " +
        esc(s.tribe) + ", " + badge + "</div>" +
        "<div>Kills in <b>" + esc(s.kill) + "</b> (" + hits + ") · takes <b>" + s.taken.toLocaleString("en") + "</b> a hit · " + esc(s.get) + "</div>" +
        (s["new"].length ? '<div class="bp-dim">New at this level: ' + esc(s["new"].join(", ")) + "</div>" : "") +
        '<div class="bp-dim">Each badge\'s best set at level ' + s.level + ", kill time (hit per hotbar weapon): " + compare + "</div></div>";
      var cols = ["", ""];
      s.slots.forEach(function (x) { cols[x.armour ? 1 : 0] += slot(x, s.items, false); });
      s.utility.forEach(function (x) { cols[0] += slot(x, s.items, true); });
      $("bp-card").innerHTML = head + '<div class="bp-cols"><div>' + cols[0] + "</div><div>" + cols[1] + "</div></div>";
    }

    mount.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.tribe) { state.tribe = b.dataset.tribe; drawChips(); refresh(); }
      else if (b.dataset.slot) {
        toggle(state.slots, b.dataset.slot);
        if (state.slots.indexOf("melee") < 0 && state.slots.indexOf("ranged") < 0) state.slots.push(b.dataset.slot === "melee" ? "ranged" : "melee");
        drawChips(); refresh();
      }
      else if (b.dataset.source) { toggle(state.sources, b.dataset.source); drawChips(); refresh(); }
      else if (b.dataset.own) { toggle(state.owned, b.dataset.own); drawOwned(); refresh(); }
      else if (b.dataset.exclude) { toggle(state.excluded, b.dataset.exclude); refresh(); }
      else if (b.dataset.forget) { state.owned = []; drawOwned(); refresh(); }
      else if (b.dataset.more) { open[b.dataset.more] = !open[b.dataset.more]; if (last) drawCard(last); }
    });
    var timer = null;
    $("bp-level").addEventListener("input", function () {
      var v = parseInt(this.value, 10);
      if (!(v >= 1 && v <= 60)) return;
      clearTimeout(timer);
      timer = setTimeout(function () { state.level = v; view = v; refresh(); }, 400);
    });
    $("bp-where").addEventListener("change", function () { state.where = this.value; refresh(); });
    $("bp-switch").addEventListener("change", function () { state["switch"] = parseFloat(this.value) || 0; refresh(); });
    $("bp-time").addEventListener("change", function () { state.time = parseFloat(this.value) || 0; refresh(); });
    $("bp-effort").addEventListener("change", function () { state.effort = parseFloat(this.value) || null; refresh(); });

    drawChips();
    drawOwned();
    drawWhere(null);
    refresh();
    call("meta").then(function (m) { drawWhere(m.zones); }).catch(function () { /* the list stays short */ });
  }

  function boot() {
    var mount = document.getElementById("build-planner");
    if (mount) {
      if (window.Worker && window.WebAssembly) calculator(mount);
      else mount.innerHTML = "<p>This calculator needs a current browser (web workers and WebAssembly).</p>";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
