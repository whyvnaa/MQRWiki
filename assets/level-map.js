// Zone maps (drawn by build_wiki.LevelMap): pan and zoom the SVG viewBox, keep markers the same size on screen,
// filter marker kinds and paths, and highlight an enemy type when its row in "Enemies here" is hovered.
// Tooltips come from the data-tip attributes (assets/world-map.js).
(function () {
  var MAX_ZOOM = 12;

  function setup(root) {
    var svg = root.querySelector(".lm-svg");
    if (!svg) return;
    var home = svg.getAttribute("data-view").split(" ").map(Number);
    var view = home.slice();
    var marks = svg.querySelectorAll(".lm-m");

    function apply() {
      svg.setAttribute("viewBox", view.join(" "));
      var px = svg.getBoundingClientRect().width || 900;
      var k = Math.max(view[2] / px, view[3] / (svg.getBoundingClientRect().height || 400));
      for (var i = 0; i < marks.length; i++) {
        var m = marks[i];
        m.setAttribute("transform", "translate(" + m.getAttribute("data-x") + " " + m.getAttribute("data-y") + ") scale(" + k.toFixed(4) + ")");
      }
    }

    function toWorld(clientX, clientY) {
      var r = svg.getBoundingClientRect();
      var s = Math.max(view[2] / r.width, view[3] / r.height);  // preserveAspectRatio meet
      var ox = (r.width - view[2] / s) / 2, oy = (r.height - view[3] / s) / 2;
      return [view[0] + (clientX - r.left - ox) * s, view[1] + (clientY - r.top - oy) * s, s];
    }

    function zoom(factor, clientX, clientY) {
      var w = view[2] * factor, h = view[3] * factor;
      if (w > home[2] * 1.5 || w < home[2] / MAX_ZOOM) return;
      var p = toWorld(clientX, clientY);
      view = [p[0] - (p[0] - view[0]) * factor, p[1] - (p[1] - view[1]) * factor, w, h];
      apply();
    }

    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
    }, { passive: false });

    var drag = null, pinch = null, moved = false;
    svg.addEventListener("pointerdown", function (e) {
      drag = { x: e.clientX, y: e.clientY, view: view.slice(), id: e.pointerId };
      moved = false;
    });
    window.addEventListener("pointermove", function (e) {
      if (!drag || pinch || e.pointerId !== drag.id) return;
      var s = toWorld(e.clientX, e.clientY)[2];
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      view = [drag.view[0] - dx * s, drag.view[1] - dy * s, view[2], view[3]];
      apply();
    });
    window.addEventListener("pointerup", function () { drag = null; });
    // a drag that ends on a marker must not follow its link
    svg.addEventListener("click", function (e) { if (moved) { e.preventDefault(); moved = false; } }, true);
    svg.addEventListener("dblclick", function (e) { e.preventDefault(); view = home.slice(); apply(); });

    svg.addEventListener("touchstart", function (e) {
      if (e.touches.length === 2) {
        var a = e.touches[0], b = e.touches[1];
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
      }
    }, { passive: true });
    svg.addEventListener("touchmove", function (e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      var a = e.touches[0], b = e.touches[1];
      var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      zoom(pinch.d / d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      pinch.d = d;
    }, { passive: false });
    svg.addEventListener("touchend", function (e) { if (e.touches.length < 2) pinch = null; });

    root.addEventListener("change", function (e) {
      var t = e.target;
      if (t.hasAttribute("data-lm-cat")) root.classList.toggle("hide-" + t.getAttribute("data-lm-cat"), !t.checked);
      if (t.hasAttribute("data-lm-plane")) root.classList.toggle("hide-p" + t.getAttribute("data-lm-plane"), !t.checked);
    });

    window.addEventListener("resize", apply);
    apply();
    return { svg: svg, root: root };
  }

  function init() {
    var maps = [];
    var roots = document.querySelectorAll(".lm");
    for (var i = 0; i < roots.length; i++) {
      var m = setup(roots[i]);
      if (m) maps.push(m);
    }
    if (!maps.length) return;
    function highlight(key) {
      for (var j = 0; j < maps.length; j++) {
        var all = maps[j].svg.querySelectorAll(".lm-m[data-key]");
        maps[j].root.classList.toggle("lm-focus", !!key);
        for (var k = 0; k < all.length; k++) all[k].classList.toggle("lm-hl", all[k].getAttribute("data-key") === key);
      }
    }
    document.addEventListener("mouseover", function (e) {
      var row = e.target.closest && e.target.closest("[data-lm-key]");
      highlight(row ? row.getAttribute("data-lm-key") : null);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
