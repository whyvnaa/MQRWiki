/* The build calculator's worker: runs the planner (planner/build_planner.py behind planner/planner_web.py, the same
 * code as the overlay's Build mode) in Pyodide, off the page's thread. Everything is served from this site.
 * Messages in: {id, fn: "meta" | "progression" | "stage", options, level}; out: {id, result} or {id, error}. */
"use strict";
importScripts("pyodide/pyodide.js");

function text(name) {
  return fetch(new URL(name, self.location.href), { cache: "no-cache" }).then(function (r) {
    if (!r.ok) throw new Error(name + ": " + r.status);
    return r.text();
  });
}

var ready = (async function () {
  var parts = await Promise.all([
    loadPyodide({ indexURL: new URL("pyodide/", self.location.href).href }),
    text("planner/build_planner.py"), text("planner/planner_web.py"), text("build-planner-data.json")]);
  var py = parts[0];
  py.FS.writeFile("build_planner.py", parts[1]);
  py.FS.writeFile("planner_web.py", parts[2]);
  var web = py.pyimport("planner_web");
  web.load(parts[3]);
  return web;
})();

self.onmessage = async function (e) {
  var m = e.data;
  try {
    var web = await ready;
    var out = m.fn === "meta" ? web.meta()
      : m.level == null ? web.call(m.fn, JSON.stringify(m.options || {}))
      : web.call(m.fn, JSON.stringify(m.options || {}), m.level);
    self.postMessage({ id: m.id, result: JSON.parse(out) });
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err && err.message || err) });
  }
};
