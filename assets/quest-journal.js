// Quest journal (quests/index, drawn by build_wiki.QuestJournal): tribe tabs; drag the questline map like in the game,
// zoom with the mouse wheel (or pinch), double-click to reset; jump to a questline from the list or a #ql-<id> link.
// Tooltips come from world-map.js (data-tip).
(function () {
  var OX = 15, OY = 30;          // the map's start offset inside the viewport (UIQuestLineMap.DrawQuestLines)
  var WIN_X = 11, WIN_W = 777;   // the window's viewBox x and width (build_wiki.QuestJournal.window)
  var ZMIN = 0.3, ZMAX = 2.5;

  function init() {
    var journal = document.querySelector(".qj-journal");
    if (!journal) return;
    var panels = journal.querySelectorAll(".qj-panel");

    function show(tribe) {
      for (var i = 0; i < panels.length; i++) panels[i].hidden = panels[i].getAttribute("data-journal") !== tribe;
    }

    // View state of a map: top-left corner (map pixels) and zoom; the viewBox shows (vw / zoom) x (vh / zoom).
    function state(view) {
      var vb = view.getAttribute("viewBox").split(" ").map(Number);
      return { x: vb[0], y: vb[1], z: +view.getAttribute("data-vw") / vb[2] };
    }
    function setView(view, x, y, z) {
      z = Math.min(ZMAX, Math.max(ZMIN, z));
      var w = +view.getAttribute("data-vw") / z, h = +view.getAttribute("data-vh") / z;
      var mw = +view.getAttribute("data-w"), mh = +view.getAttribute("data-h");
      // Keep the map in view; when it is smaller than the viewport, centre it.
      x = mw + 2 * OX <= w ? (mw - w) / 2 : Math.min(Math.max(x, -OX), mw - w + OX);
      y = mh + 2 * OY <= h ? (mh - h) / 2 : Math.min(Math.max(y, -OY), mh - h + OY);
      view.setAttribute("viewBox", x + " " + y + " " + w + " " + h);
    }
    // Screen pixels -> map pixels: measured on the whole window (a nested svg's own box spans its whole content).
    function toMap(view, clientX, clientY) {
      var r = view.ownerSVGElement.getBoundingClientRect(), s = WIN_W / r.width, st = state(view);
      var wx = WIN_X + (clientX - r.left) * s, wy = (clientY - r.top) * s + view.ownerSVGElement.viewBox.baseVal.y;
      return { x: st.x + (wx - +view.getAttribute("data-x")) / st.z, y: st.y + (wy - +view.getAttribute("data-y")) / st.z, s: s };
    }
    function zoomAt(view, clientX, clientY, factor) {
      var st = state(view), p = toMap(view, clientX, clientY), z = Math.min(ZMAX, Math.max(ZMIN, st.z * factor));
      setView(view, p.x - (p.x - st.x) * st.z / z, p.y - (p.y - st.y) * st.z / z, z);
    }
    function focusLine(panel, button) {
      var view = panel.querySelector(".qj-view"), z = state(view).z;
      var vw = +view.getAttribute("data-vw") / z, vh = +view.getAttribute("data-vh") / z;
      var b = button.getAttribute("data-box").split(",").map(Number);
      setView(view, b[0] + Math.min(b[2], vw - 40) / 2 - vw / 2, b[1] + b[3] / 2 - vh / 2, z);
      var f = view.querySelector(".qj-focus");
      f.setAttribute("x", b[0]); f.setAttribute("y", b[1]); f.setAttribute("width", b[2]); f.setAttribute("height", b[3]);
      f.classList.remove("on"); void f.getBoundingClientRect(); f.classList.add("on");
      var old = panel.querySelector(".qj-list button.sel");
      if (old) old.classList.remove("sel");
      button.classList.add("sel");
      var list = panel.querySelector(".qj-list"), lr = list.getBoundingClientRect(), br = button.parentNode.getBoundingClientRect();
      list.scrollTop += (br.top - lr.top - (lr.height - br.height) / 2) * list.clientHeight / lr.height;  // the page stays still
    }

    // Drag to pan with one pointer (mouse, pen, finger), pinch with two. A drag does not count as a click on a node.
    var pointers = {}, drag = null, pinch = null, moved = false;
    journal.addEventListener("pointerdown", function (e) {
      var view = e.target.closest && e.target.closest(".qj-view");
      if (!view || e.button > 0) return;
      e.preventDefault();  // no native link/image drag, no text selection; clicks still fire
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        var st = state(view);
        drag = { view: view, x: e.clientX, y: e.clientY, sx: st.x, sy: st.y, z: st.z, s: toMap(view, 0, 0).s };
        moved = false;
      } else if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { view: view, d: Math.hypot(a.x - b.x, a.y - b.y), z: state(view).z };
        drag = null;
      }
    });
    window.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch) {
        var ids = Object.keys(pointers), a = pointers[ids[0]], b = pointers[ids[1]];
        if (!a || !b) return;
        var st = state(pinch.view), target = pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
        zoomAt(pinch.view, (a.x + b.x) / 2, (a.y + b.y) / 2, target / st.z);
        moved = true;
        return;
      }
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!moved) { moved = true; drag.view.classList.add("dragging"); }
      setView(drag.view, drag.sx - dx * drag.s / drag.z, drag.sy - dy * drag.s / drag.z, drag.z);
    });
    function release(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      if (!Object.keys(pointers).length && drag) { drag.view.classList.remove("dragging"); drag = null; }
    }
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    journal.addEventListener("dragstart", function (e) { if (e.target.closest(".qj-view")) e.preventDefault(); });

    journal.addEventListener("wheel", function (e) {  // the wheel zooms towards the mouse pointer
      var view = e.target.closest && e.target.closest(".qj-view");
      if (!view) return;
      e.preventDefault();
      zoomAt(view, e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    }, { passive: false });
    journal.addEventListener("dblclick", function (e) {  // back to the start view
      var view = e.target.closest && e.target.closest(".qj-view");
      if (view) setView(view, -OX, -OY, 1);
    });

    journal.addEventListener("click", function (e) {
      if (moved && e.target.closest(".qj-view")) { e.preventDefault(); moved = false; return; }
      var tab = e.target.closest("a[data-journal]");
      if (tab) {
        e.preventDefault();
        show(tab.getAttribute("data-journal"));
        history.replaceState(null, "", tab.getAttribute("href"));
        return;
      }
      var btn = e.target.closest(".qj-list button[data-ql]");
      if (btn) {
        focusLine(btn.closest(".qj-panel"), btn);
        history.replaceState(null, "", "#ql-" + btn.getAttribute("data-ql"));
      }
    });

    function fromHash() {
      var m = location.hash.match(/^#ql-(\d+)$/);
      if (m) {
        var btn = journal.querySelector('.qj-list button[data-ql="' + m[1] + '"]');
        if (btn) {
          var panel = btn.closest(".qj-panel");
          show(panel.getAttribute("data-journal"));
          focusLine(panel, btn);
          journal.scrollIntoView({ block: "start" });
          return;
        }
      }
      var t = location.hash.match(/^#qj-(\w+)$/);
      for (var i = 0; t && i < panels.length; i++) {
        if (panels[i].id === "qj-" + t[1]) { show(panels[i].getAttribute("data-journal")); return; }
      }
      show(panels[0].getAttribute("data-journal"));
    }
    fromHash();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
