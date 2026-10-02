// World map (zones/map and the zone pages' mini maps, drawn by build_wiki.WorldMap):
// - floating tooltips for everything with a data-tip (map places, exits, trails; quest journal nodes and titles)
// - the map viewer shows one tab at a time; links with data-tab switch it (painted tabs, regions, crests, the globe)
(function () {
  function init() {
    var tip = document.createElement("div");
    tip.className = "wm-tip";
    document.body.appendChild(tip);
    document.addEventListener("mouseover", function (e) {
      var t = e.target.closest && e.target.closest(".wm [data-tip], .qj [data-tip]");
      if (!t) { tip.style.display = "none"; return; }
      tip.textContent = t.getAttribute("data-tip");
      tip.style.display = "block";
    });
    document.addEventListener("mousemove", function (e) {
      if (tip.style.display !== "block") return;
      var x = Math.min(e.clientX + 16, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = x + "px";
      tip.style.top = (e.clientY + 18) + "px";
    });

    var viewer = document.querySelector(".wm-viewer");
    if (!viewer) return;
    var panels = viewer.querySelectorAll(".wm-panel");
    function show(key, scroll) {
      for (var i = 0; i < panels.length; i++) panels[i].hidden = panels[i].getAttribute("data-tab") !== key;
      if (scroll) viewer.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[data-tab]");
      if (!a) return;
      e.preventDefault();
      tip.style.display = "none";
      show(a.getAttribute("data-tab"), !viewer.contains(a) || a.closest(".wm-places"));
      history.replaceState(null, "", a.getAttribute("href"));
    });
    var start = "Ook", scroll = false;
    for (var i = 0; i < panels.length; i++) {
      if (location.hash === "#" + panels[i].id) { start = panels[i].getAttribute("data-tab"); scroll = true; }
    }
    show(start, scroll);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
