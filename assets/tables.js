/* Sortable tables and "Show more" for long tables and lists, on every wiki page (also tables added later, e.g. by
 * the build calculator).
 *
 * - Click a column heading to sort ascending, click again for descending. Numbers sort as numbers ("1.5 s",
 *   "23 %", "+17 (23 %)", "1,026"); empty cells ("", "—") always go last.
 * - Tables longer than their limit (data-more="N" on the table, default 100) show the first N rows in the current
 *   order with "Show more" / "Show all" / "Show fewer". Long lists in <div class="mq-more"> work the same (limit 25),
 *   and <span class="mq-rest"> inside a cell gets a "+N more" toggle. Nothing is cut from the page itself.
 */
(function () {
  "use strict";
  var TABLE_LIMIT = 100, LIST_LIMIT = 25;

  // ------------------------------------------------------------------ sorting
  function cellValue(row, col) {
    var cell = row.cells[col];
    if (!cell) return "";
    return (cell.getAttribute("data-sort") || cell.textContent || "").replace(/\s+/g, " ").trim();
  }
  function parseNum(text) {
    var m = text.replace(/[,  ]/g, "").replace(/−/g, "-").match(/^[+-]?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function isEmpty(text) { return text === "" || text === "—" || text === "–" || text === "-"; }

  function sortTable(table, col, dir) {
    var body = table.tBodies[0];
    var rows = Array.prototype.slice.call(body.rows);
    var vals = rows.map(function (r, i) { var t = cellValue(r, col); return { r: r, i: i, t: t, n: parseNum(t) }; });
    var filled = vals.filter(function (v) { return !isEmpty(v.t); });
    var numeric = filled.length && filled.filter(function (v) { return v.n !== null; }).length >= 0.8 * filled.length;
    vals.sort(function (a, b) {
      var ea = isEmpty(a.t), eb = isEmpty(b.t);
      if (ea || eb) return ea === eb ? a.i - b.i : (ea ? 1 : -1);  // empty cells last in both directions
      var c;
      if (numeric) {
        if (a.n === null || b.n === null) c = a.n === null ? 1 : -1;  // text in a number column after the numbers
        else c = a.n - b.n;
      } else {
        c = a.t.localeCompare(b.t, undefined, { numeric: true, sensitivity: "base" });
      }
      return (dir === "desc" ? -c : c) || a.i - b.i;
    });
    vals.forEach(function (v) { body.appendChild(v.r); });
    Array.prototype.forEach.call(table.tHead.rows[0].cells, function (th, i) {
      th.setAttribute("aria-sort", i === col ? (dir === "desc" ? "descending" : "ascending") : "none");
    });
    applyLimit(table);
  }

  function makeSortable(table) {
    if (table.hasAttribute("data-mq-sort") || table.classList.contains("no-sort")) return;
    if (!table.tHead || !table.tBodies[0] || table.tBodies[0].rows.length < 2) return;
    table.setAttribute("data-mq-sort", "");
    Array.prototype.forEach.call(table.tHead.rows[0].cells, function (th, col) {
      th.classList.add("mq-sortable");
      th.setAttribute("aria-sort", "none");
      th.tabIndex = 0;
      th.title = "Sort by this column (click again to reverse)";
      function go() { sortTable(table, col, th.getAttribute("aria-sort") === "ascending" ? "desc" : "asc"); }
      th.addEventListener("click", go);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  // ------------------------------------------------------------------ show more
  function moreBar(owner, total, shown, step, apply) {
    var bar = owner.mqBar;
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "mq-more-bar";
      owner.mqBar = bar;
      var anchor = owner.closest ? (owner.closest(".md-typeset__scrollwrap, .calc-scroll") || owner) : owner;
      anchor.parentNode.insertBefore(bar, anchor.nextSibling);
    }
    if (total <= step) { bar.hidden = true; return; }
    bar.hidden = false;
    var parts = ['<span class="mq-more-count">Showing ' + Math.min(shown, total) + " of " + total + "</span>"];
    if (shown < total) {
      parts.push('<button type="button" data-act="more">Show ' + Math.min(step, total - shown) + " more</button>");
      parts.push('<button type="button" data-act="all">Show all</button>');
    } else {
      parts.push('<button type="button" data-act="less">Show fewer</button>');
    }
    bar.innerHTML = parts.join(" ");
    bar.onclick = function (e) {
      var act = e.target.getAttribute && e.target.getAttribute("data-act");
      if (act) apply(act === "more" ? shown + step : act === "all" ? total : step);
    };
  }

  function applyLimit(table) {
    var body = table.tBodies[0];
    if (!body) return;
    var step = parseInt(table.getAttribute("data-more"), 10) || TABLE_LIMIT;
    var rows = body.rows, total = rows.length;
    if (total <= step * 1.2 && !table.hasAttribute("data-more")) return;  // nearly fits: just show everything
    var shown = table.mqShown || step;
    for (var i = 0; i < total; i++) rows[i].hidden = i >= shown;
    moreBar(table, total, shown, step, function (n) { table.mqShown = n; applyLimit(table); });
  }

  function limitList(box) {
    var list = box.querySelector("ul, ol");
    if (!list) return;
    var items = list.children, total = items.length, shown = box.mqShown || LIST_LIMIT;
    if (total <= LIST_LIMIT * 1.2) return;  // nearly fits: just show everything
    for (var i = 0; i < total; i++) items[i].hidden = i >= shown;
    moreBar(box, total, shown, LIST_LIMIT, function (n) { box.mqShown = n; limitList(box); });
  }

  function restToggle(span) {
    if (span.hasAttribute("data-mq-rest")) return;
    span.setAttribute("data-mq-rest", "");
    var count = (span.textContent.match(/;/g) || []).length;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mq-rest-btn";
    span.classList.add("mq-collapsed");
    btn.textContent = "+" + count + " more";
    btn.addEventListener("click", function () {
      var open = span.classList.toggle("mq-collapsed") === false;
      btn.textContent = open ? "show fewer" : "+" + count + " more";
    });
    span.parentNode.insertBefore(btn, span.nextSibling);
  }

  // ------------------------------------------------------------------ wiring
  function init(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".md-typeset table"), function (t) {
      makeSortable(t);
      if (!t.hasAttribute("data-mq-more")) { t.setAttribute("data-mq-more", ""); applyLimit(t); }
    });
    Array.prototype.forEach.call(root.querySelectorAll(".mq-more:not([data-mq-more])"), function (box) {
      box.setAttribute("data-mq-more", "");
      limitList(box);
    });
    Array.prototype.forEach.call(root.querySelectorAll(".mq-rest"), restToggle);
  }
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; init(document); }, 0);  // not requestAnimationFrame: background tabs never paint
  }
  function start() {
    init(document);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes.length) { schedule(); return; }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
