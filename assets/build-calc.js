/* Interactive build calculator (guides/calculator.md).
 *
 * A browser port of scripts/build_optimizer.py: same candidate items, filters, scores and ranking, so the page and
 * `uv run scripts/mq.py build` agree. Data comes from assets/build-calc-data.js, written by scripts/build_wiki.py.
 *
 * Model (knowledge/rules.yaml):
 *   hit(w)     = AP(L) + Σ accessories[blunt + element line if same element as w] + badge damage (w's element) + w.stats
 *   defence(Z) = Def(L) + Σ armour[defence + resist line if armour element == Z, or every resist line vs blunt] + badge defence
 *   hits to kill = ceil(enemy HP / hit); time per kill = hits × max(cooldown, 0.5 s)
 *   A build carries a melee weapon and a ranged one (Throw or damage zone). Accessories are tuned for one build element.
 *   Overall build: enemies of your level; resist lines weighted by how often they count in fight zones within ±5 levels.
 */
(function () {
  "use strict";
  var mount = document.getElementById("build-calc");
  if (!mount) return;
  var SCRIPT = document.currentScript || document.querySelector('script[src*="build-calc.js"]');
  var ROOT = new URL("../", SCRIPT.src);

  var ELEMENTS = ["Air", "Earth", "Fire", "Ice", "Lightning"];
  var ELEMENT_TRIBE = { Air: "Shadow", Earth: "Bone", Fire: "Outlaw", Ice: "Wild", Lightning: "Grease" };
  var TRIBE_ELEMENT = { Shadow: "Air", Bone: "Earth", Outlaw: "Fire", Wild: "Ice", Grease: "Lightning" };
  var DAMAGE_SLOTS = ["SlotEars", "SlotWrist", "SlotTail"];
  var DEFENCE_SLOTS = ["SlotHair", "SlotBody", "SlotLegs", "SlotBackpack"];
  var SLOT_NAMES = { SlotEars: "Ears", SlotWrist: "Wrist", SlotTail: "Tail", SlotHair: "Hat", SlotBody: "Body",
                     SlotLegs: "Legs", SlotBackpack: "Backpack" };
  var SLOT_ORDER = ["Melee", "Ranged", "Ears", "Wrist", "Tail", "Hat", "Body", "Legs", "Backpack"];
  var MIX = "mix";
  var UTILITY_ROLES = ["Crowd control", "Damage over time", "Sustain", "Defence buff", "Escape"];
  var UTILITY_AUTO = ["Crowd control", "Damage over time", "Sustain", "Defence buff", "Escape"];
  var STORE_KEY = "mq-build-calc";

  var DEFAULTS = {
    level: 22, sp: { Air: 0, Earth: 0, Fire: 0, Ice: 0, Lightning: 0 },
    target: "general", zone: "", enemyLevel: "", enemyElement: "",
    dmgElement: "auto", sameElement: false, resist: "auto", utilFocus: "auto",
    noMc: false, noEvent: false, knownOnly: false, minDrop: 0, exclude: [],
    top: 3, progFrom: "", progTo: 60, minGain: 15
  };

  var D, state;

  // ------------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pyRound(x) { // Python's round(): halves go to the even neighbour
    var f = Math.floor(x), d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  function r2(x) { return Math.round(x * 100) / 100; }
  function pct(x) { return Math.round(x * 100) + " %"; }
  function stat(key, level) {
    var t = D.stats[key];
    return t ? (t[Math.max(1, Math.min(level, 65))] || 0) : 0;
  }
  function badgeLevel(points) { return Math.min(65, Math.floor((points || 0) / 5)); }
  function elName(el) { return el ? el + " (" + ELEMENT_TRIBE[el] + ")" : "Neutral / blunt"; }
  function elCell(el) {  // element name with its tribe crest (theme art; the text alone is enough without it)
    var tribe = el ? ELEMENT_TRIBE[el] : "Crossroads";
    return '<img class="crest" src="' + esc(new URL("assets/theme/crests/" + tribe.toLowerCase() + ".png", ROOT).href) +
      '" alt="" width="20" height="20" onerror="this.remove()"> ' + esc(elName(el));
  }
  function weaponClass(w) { return w.at === "Melee" ? "melee" : "ranged"; }
  function itemUrl(it) { return it.pg ? new URL(it.pg + ".html", ROOT).href : null; }
  function itemRef(it, size) {
    size = size || 24;
    var img = it.ic ? '<img src="' + esc(new URL("assets/icons/" + it.ic, ROOT).href) + '" width="' + size +
      '" height="' + size + '" loading="lazy" alt=""> ' : "";
    var url = itemUrl(it);
    return '<span class="calc-item">' + img + (url ? '<a href="' + esc(url) + '">' + esc(it.n) + "</a>" : esc(it.n)) +
      ' <button type="button" class="calc-x" data-exclude="' + esc(it.n) + '" title="Exclude this item and show the next best">✕</button></span>';
  }
  function howHtml(it) {
    var h = it.how;
    if (!h) return '<span class="calc-dim">source unknown (MC Mall, event or removed?)</span>';
    var txt = h[1] ? (h[2] ? '<a href="' + esc(new URL(h[2] + ".html", ROOT).href) + '">' + esc(h[1]) + "</a>" : esc(h[1])) : "";
    return esc(h[0]) + (txt ? ": " + txt : "") + (it.mc ? ' <span class="calc-tag">MC</span>' : "") +
      (it.ev ? ' <span class="calc-tag">event</span>' : "");
  }
  function table(headers, rows, more) {
    if (!rows.length) return '<p class="calc-dim">No items match these settings.</p>';
    return '<div class="calc-scroll"><table' + (more ? ' data-more="' + more + '"' : "") + '><thead><tr>' +
      headers.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) {
        var cells = r.cells || r;
        return "<tr" + (r.attrs || "") + ">" + cells.map(function (c) { return "<td>" + (c == null ? "" : c) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  // ------------------------------------------------------------------ state
  function loadState() {
    var s = JSON.parse(JSON.stringify(DEFAULTS));
    var saved = null;
    try {
      if (location.hash.length > 1) saved = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    } catch (e) { saved = null; }
    if (!saved) {
      try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { saved = null; }
    }
    if (saved && typeof saved === "object") {
      Object.keys(DEFAULTS).forEach(function (k) { if (k in saved) s[k] = saved[k]; });
      s.sp = Object.assign({}, DEFAULTS.sp, saved.sp || {});
      if (!Array.isArray(s.exclude)) s.exclude = [];
      if (s.resist === "target") s.resist = "auto"; // older saved settings
    }
    return s;
  }
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: settings just aren't remembered */ }
    var diff = {};  // the address only carries settings that differ from the defaults, to keep bookmarks short
    Object.keys(DEFAULTS).forEach(function (k) {
      if (k === "sp") {
        var sp = {};
        ELEMENTS.forEach(function (e) { if (state.sp[e]) sp[e] = state.sp[e]; });
        if (Object.keys(sp).length) diff.sp = sp;
      } else if (JSON.stringify(state[k]) !== JSON.stringify(DEFAULTS[k])) diff[k] = state[k];
    });
    var hash = Object.keys(diff).length ? "#" + encodeURIComponent(JSON.stringify(diff)) : "";
    try { history.replaceState(null, "", location.pathname + location.search + hash); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ optimiser (port of build_optimizer.py)
  function filters() {
    var ex = {};
    state.exclude.forEach(function (x) { ex[String(x).trim().toLowerCase()] = true; });
    return { ex: ex, knownOnly: state.knownOnly, noMc: state.noMc, noEvent: state.noEvent, minDrop: (+state.minDrop || 0) / 100 };
  }
  function allowed(it, level, f) {
    if (it.lv > level) return false;
    if (f.ex[String(it.id)] || f.ex[(it.p || "").toLowerCase()] || f.ex[(it.n || "").toLowerCase()]) return false;
    if (f.knownOnly && !it.ks) return false;
    if (f.noMc && it.mc) return false;
    if (f.noEvent && it.ev) return false;
    if (f.minDrop && it.do && it.bd < f.minDrop) return false;
    return true;
  }
  function zoneMix(lo, hi) {
    var zs = D.zones.filter(function (z) { return z.d >= lo && z.d <= hi; });
    if (!zs.length) zs = D.zones;
    var counts = {};
    zs.forEach(function (z) { var el = TRIBE_ELEMENT[z.t] || "blunt"; counts[el] = (counts[el] || 0) + 1; });
    var mix = {};
    Object.keys(counts).forEach(function (k) { mix[k] = counts[k] / zs.length; });
    return mix;
  }
  function resistWeights(mix) {  // a resist line counts against its own element and against blunt attacks
    var w = {};
    ELEMENTS.forEach(function (el) { w[el] = (mix[el] || 0) + (mix.blunt || 0); });
    return w;
  }
  function accScore(it, el) { return it.sb + (el && it.el === el ? it.se : 0); }
  function armourScore(it, mode, weights) {
    // mode: an element, null (blunt: every resist line counts), "any" (plain defence only) or MIX (weighted resist lines)
    if (mode === "any") return it.sd;
    if (mode === MIX) return it.sd + it.sr * ((weights || {})[it.el] || 0);
    return it.sd + ((mode === null || it.el === mode) ? it.sr : 0);
  }
  function bestPerSlot(slots, level, f, score, n) {
    var out = {};
    slots.forEach(function (slot) {
      var c = D.items.filter(function (it) { return it.s === slot && allowed(it, level, f); });
      c.sort(function (a, b) { return (score(b) - score(a)) || (a.lv - b.lv); });
      out[slot] = c.slice(0, n);
    });
    return out;
  }
  function badgeDamage(el) {
    var lv = el ? badgeLevel(state.sp[el]) : 0;
    return lv > 0 ? stat("Badge." + el + "Damage", lv) : 0;
  }
  function badgeDefence() {
    return ELEMENTS.reduce(function (sum, el) {
      var lv = badgeLevel(state.sp[el]);
      return sum + (lv > 0 ? stat("Badge.Resist" + el, lv) : 0);
    }, 0);
  }
  function byTimePerKill(a, b) { return (a.tpk - b.tpk) || (b.hit - a.hit); }
  function damageOptions(level, f, target, n) {
    var ap = stat("Player.AbilityPower", level);
    var enemyHp = stat("Enemy.IncreaseHitPoints", target.level);
    var weaponsOk = D.items.filter(function (w) { return w.w && allowed(w, level, f); });
    var options = ELEMENTS.concat([null]).map(function (el) {
      var acc = bestPerSlot(DAMAGE_SLOTS, level, f, function (it) { return accScore(it, el); }, n);
      var chosen = DAMAGE_SLOTS.map(function (s) { return acc[s][0]; }).filter(Boolean);
      function accFor(e) { return chosen.reduce(function (s, a) { return s + accScore(a, e); }, 0); }
      var ranked = { melee: [], ranged: [] };
      weaponsOk.forEach(function (w) {
        if (state.sameElement && w.el !== el) return;
        var base = ap + accFor(w.el) + badgeDamage(w.el);
        var hit = base + w.sum;
        if (w.at === "DamageZone") hit = pyRound(0.5 * hit); // 50 % of total damage per tick (Discord 1.7.5)
        var hits = hit > 0 ? Math.ceil(enemyHp / hit) : null;
        var cd = Math.max(w.cd || 0, 0.5);
        ranked[weaponClass(w)].push({ it: w, base: base, hit: hit, hits: hits, ttk: hits ? r2((hits - 1) * cd) : null,
                                      tpk: hits ? r2(hits * cd) : null, perSec: pyRound(hit / cd) });
      });
      ranked.melee.sort(byTimePerKill);
      ranked.ranged.sort(byTimePerKill);
      var bm = ranked.melee[0] || null, br = ranked.ranged[0] || null;
      var own = badgeDamage(el);
      var all = {};
      ranked.melee.concat(ranked.ranged).forEach(function (w) { all[w.it.p] = w; });
      return { el: el, acc: acc, accTotal: accFor(el), bonus: own, base: ap + accFor(el) + own,
               melee: ranked.melee, ranged: ranked.ranged, bestMelee: bm, bestRanged: br, all: all,
               score: (bm ? bm.tpk : 1e6) + (br ? br.tpk : 1e6), hitSum: (bm ? bm.hit : 0) + (br ? br.hit : 0) };
    });
    options.sort(function (a, b) { return (a.score - b.score) || (b.hitSum - a.hitSum) || (b.base - a.base); });
    return { ap: ap, enemyHp: enemyHp, options: options };
  }
  function defenceOption(level, f, target, mode, n) {
    var mix = zoneMix(target.level - 5, target.level + 5);
    var weights = resistWeights(mix);
    function score(it) { return armourScore(it, mode, weights); }
    var arm = bestPerSlot(DEFENCE_SLOTS, level, f, score, n);
    var worn = DEFENCE_SLOTS.map(function (s) { return arm[s][0]; }).filter(Boolean);
    var base = stat("Player.Defence", level), bdef = badgeDefence();
    var enemyAp = stat("Enemy.AbilityPower", target.level);
    var hp = stat("Player.IncreaseHitPoints", level);
    var perAttack = [null].concat(ELEMENTS).map(function (el) {
      var d = base + bdef + worn.reduce(function (s, a) { return s + armourScore(a, el); }, 0);
      var raw = enemyAp - d;
      return { el: el, share: mix[el || "blunt"] || 0, defence: d, taken: Math.max(raw, 0), capped: raw <= 0,
               hitsToDie: raw > 0 ? Math.ceil(hp / raw) : null };
    });
    var vs = target.element === MIX ? null : perAttack.filter(function (p) { return p.el === target.element; })[0];
    return { arm: arm, score: score, mix: mix, base: base, badge: bdef, enemyAp: enemyAp, hp: hp, perAttack: perAttack, vs: vs,
             shown: base + bdef + worn.reduce(function (s, a) { return s + a.sd + a.sr; }, 0) };
  }
  function utilityRole(it) {
    var fx = it.fx || {};
    if (fx.stun) return "Crowd control";
    if (fx.poison) return "Damage over time";
    if (fx.ls || fx.heal) return "Sustain";
    if (fx.resist && it.s === "Defensive") return "Defence buff";
    if (fx.invis) return "Escape";
    return null;
  }
  function utilityOptions(level, f, option, dfn, n) {
    // Port of Optimizer.utility_options: each role valued against the build.
    var main = option.bestMelee || option.bestRanged;
    var inBuild = {};
    [option.bestMelee, option.bestRanged].forEach(function (w) { if (w) inBuild[w.it.p] = true; });
    var elemental = dfn.perAttack.filter(function (p) { return p.el; });
    var out = {};
    UTILITY_ROLES.forEach(function (r) { out[r] = []; });
    var cands = D.items.filter(function (w) { return w.w && utilityRole(w); }).concat(D.util);
    cands.forEach(function (it) {
      var role = utilityRole(it);
      if (!role || it.at === "Relic" || !allowed(it, level, f)) return;
      var w = option.all[it.p];
      var ranks = it.w && ["Melee", "Throw", "DamageZone"].indexOf(it.at) >= 0;  // bombs are weapons but never ranked
      if (ranks && !w) return;  // filtered out of the damage ranking (e.g. "only weapons of the build element")
      var fx = it.fx, cd = Math.max(it.cd || 0, 0.5), hit = w ? w.hit : null;
      var row = { it: it, hit: hit, consumable: it.s === "Bomb", inBuild: !!inBuild[it.p] };
      if (role === "Crowd control") {
        var partner = main && main.it.p !== it.p ? main : w;
        var free = partner ? Math.floor(fx.stun / Math.max(partner.it.cd || 0, 0.5)) : 0;
        row.stun = fx.stun; row.uptime = Math.min(1, fx.stun / cd); row.free = free; row.partner = partner;
        row.freeDamage = partner ? free * partner.hit : 0; row.metric = row.freeDamage;
      } else if (role === "Damage over time") {
        row.dot = hit ? pyRound(fx.poison[0] / 100 * hit) : pyRound(fx.poison[0]);  // bombs: raw catalog value
        row.dotS = fx.poison[1]; row.metric = row.dot + (hit || 0);
      } else if (role === "Sustain") {
        if (fx.ls) { row.kind = "life steal"; row.pct = fx.ls; row.heal = hit ? pyRound(fx.ls / 100 * hit) : 0; }
        else { row.kind = "heal"; row.pct = fx.heal; row.heal = pyRound(fx.heal / 100 * dfn.hp); }
        row.healPerS = pyRound(row.heal / cd); row.metric = row.heal / cd;
      } else if (role === "Defence buff") {
        row.buff = fx.resist[0]; row.buffS = fx.resist[1]; row.uptime = Math.min(1, fx.resist[1] / cd);
        row.saved = elemental.reduce(function (m, p) { return Math.max(m, Math.min(row.buff, p.taken)); }, 0);
        row.metric = row.buff * row.uptime;
      } else {
        row.invis = fx.invis; row.detect = fx.detect || 0; row.metric = fx.invis;
      }
      out[role].push(row);
    });
    UTILITY_ROLES.forEach(function (r) {
      out[r].sort(function (a, b) { return (b.metric - a.metric) || (a.it.lv - b.it.lv); });
      out[r] = out[r].slice(0, n);
    });
    return out;
  }
  function utilityText(role, r) {
    var cd = "cooldown " + (r.it.cd || 0) + " s" + (r.consumable ? ", consumable" : "");
    var hit = (r.inBuild ? "already in your build; " : "") + (r.hit ? "hits <b>" + r.hit + "</b>, " : "");
    if (role === "Crowd control") {
      return hit + "stuns " + r.stun + " s (" + pct(r.uptime) + " uptime on one enemy)" +
        (r.partner ? "; covers " + r.free + " " + esc(r.partner.it.n) + " hits = " + r.freeDamage + " damage (this enemy needs " + r.partner.hits + ")" : "") + "; " + cd;
    }
    if (role === "Damage over time") return hit + "poison " + r.dot + " damage over " + r.dotS + " s; " + cd;
    if (role === "Sustain") {
      return hit + (r.kind === "life steal" ? "life steal " + r.pct + " % ≈ " + r.heal + " HP per hit" : "heals " + r.pct + " % = " + r.heal + " HP") +
        " ≈ " + r.healPerS + " HP/s; " + cd;
    }
    if (role === "Defence buff") {
      return "+" + r.buff + " elemental defence for " + r.buffS + " s (" + pct(r.uptime) + " uptime), " +
        (r.saved ? "up to " + r.saved + " less damage per elemental hit" : "you already take only the minimum from elemental hits") + "; " + cd;
    }
    return "invisible " + r.invis + " s" + (r.detect ? ", detect " + r.detect + " s" : "") + "; " + cd;
  }
  function utilityPick(util) {
    var roles = state.utilFocus === "auto" ? UTILITY_AUTO : state.utilFocus === "none" ? [] : [state.utilFocus];
    for (var i = 0; i < roles.length; i++) {
      var picks = util[roles[i]].filter(function (r) { return !r.inBuild; });
      if (picks.length) return { role: roles[i], row: picks[0] };
    }
    return null;
  }
  // The melee and ranged weapon this build recommends at each level (port of Optimizer.weapon_path): any element
  // (only dmgEl's with "Only weapons of the build element"), the best dmgEl accessories of that level, badge bonuses,
  // ranked by time per kill against enemies of that level. First row per class = what you use at fromLevel; then a row
  // whenever the recommendation changes to a weapon that kills at least minGainPct % faster (both measured at that level).
  function weaponPath(f, dmgEl, fromLevel, toLevel, minGainPct) {
    var rows = [], kept = { melee: null, ranged: null };
    var weapons = D.items.filter(function (w) { return w.w && (!state.sameElement || w.el === dmgEl); });
    for (var level = Math.max(1, fromLevel); level <= toLevel; level++) {
      var ap = stat("Player.AbilityPower", level), enemyHp = stat("Enemy.IncreaseHitPoints", level);
      var acc = bestPerSlot(DAMAGE_SLOTS, level, f, function (it) { return accScore(it, dmgEl); }, 1);
      var worn = DAMAGE_SLOTS.map(function (s) { return acc[s][0]; }).filter(Boolean);
      var rate = function (w) {
        var hit = ap + worn.reduce(function (s, a) { return s + accScore(a, w.el); }, 0) + badgeDamage(w.el) + w.sum;
        if (w.at === "DamageZone") hit = pyRound(0.5 * hit); // 50 % of total damage per tick (Discord 1.7.5)
        var hits = hit > 0 ? Math.ceil(enemyHp / hit) : null;
        var cd = Math.max(w.cd || 0, 0.5);
        return { hit: hit, hits: hits, tpk: hits ? r2(hits * cd) : 1e6 };
      };
      var ranked = { melee: [], ranged: [] };
      weapons.forEach(function (w) { if (allowed(w, level, f)) ranked[weaponClass(w)].push({ r: rate(w), w: w }); });
      ["melee", "ranged"].forEach(function (cls) {
        var lst = ranked[cls];
        if (!lst.length) return;
        var best = lst.reduce(function (a, b) { return (b.r.tpk < a.r.tpk || (b.r.tpk === a.r.tpk && b.r.hit > a.r.hit)) ? b : a; });
        var k = kept[cls];
        if (k && best.w.p === k.p) return;
        var kr = k ? rate(k) : null, faster = kr ? kr.tpk / best.r.tpk - 1 : null;
        if (kr && !(faster * 100 >= minGainPct && (faster > 0 || best.r.hit > kr.hit))) return;
        rows.push({ lv: level, slot: cls === "melee" ? "Melee" : "Ranged", it: best.w, score: best.r.hit, gain: null, now: !kr && level === Math.max(1, fromLevel),
                    detail: best.r.hits + " hits, " + best.r.tpk + " s per kill" +
                            (kr ? " (was " + k.n + ": " + kr.hits + " hits, " + kr.tpk + " s)" : "") });
        kept[cls] = best.w;
      });
    }
    return rows;
  }
  function progression(f, dmgEl, mode, fromLevel, toLevel, minGainPct) {
    var rows = weaponPath(f, dmgEl, fromLevel, toLevel, minGainPct);
    var all = D.items.filter(function (it) { return allowed(it, toLevel, f); });
    var weights = resistWeights(zoneMix(fromLevel - 5, toLevel + 5));
    function frontier(label, cands, score) {
      var best = 0, kept = 0, startItem = null;
      cands.forEach(function (it) {   // what you can already wear at the start level is the baseline
        if (it.lv <= fromLevel && score(it) > best) { best = score(it); startItem = it; }
      });
      kept = best;
      if (startItem) rows.push({ lv: startItem.lv, slot: label, it: startItem, score: best, gain: null, now: true });
      cands.filter(function (it) { return it.lv > fromLevel; })
        .sort(function (a, b) { return (a.lv - b.lv) || (score(b) - score(a)); })
        .forEach(function (it) {
          var sc = score(it);
          if (sc > best) {
            best = sc;
            if (!kept || sc >= kept * (1 + minGainPct / 100)) {
              rows.push({ lv: it.lv, slot: label, it: it, score: sc, gain: kept ? sc - kept : null });
              kept = sc;
            }
          }
        });
    }
    DAMAGE_SLOTS.forEach(function (slot) {
      frontier(SLOT_NAMES[slot], all.filter(function (it) { return it.s === slot; }), function (it) { return accScore(it, dmgEl); });
    });
    DEFENCE_SLOTS.forEach(function (slot) {
      frontier(SLOT_NAMES[slot], all.filter(function (it) { return it.s === slot; }), function (it) { return pyRound(armourScore(it, mode, weights)); });
    });
    rows.sort(function (a, b) {
      return ((b.now ? 1 : 0) - (a.now ? 1 : 0)) || (a.lv - b.lv) || (SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
    });
    return rows;
  }

  // ------------------------------------------------------------------ form
  function opt(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (String(value) === String(selected) ? " selected" : "") + ">" + esc(label) + "</option>";
  }
  function radio(name, value, label) {
    return '<label><input type="radio" name="' + name + '" value="' + value + '"' + (state[name] === value ? " checked" : "") + "> " + label + "</label>";
  }
  function check(name, label) {
    return '<label><input type="checkbox" name="' + name + '"' + (state[name] ? " checked" : "") + "> " + label + "</label>";
  }
  function renderForm() {
    var zoneOpts = opt("", "— choose a zone —", state.zone) + D.zones.map(function (z) {
      return opt(z.n, z.n + " (difficulty " + z.d + ", " + z.t + ")", state.zone);
    }).join("");
    var names = {};
    D.items.forEach(function (it) { names[it.n] = true; });
    var spInputs = ELEMENTS.map(function (e) {
      return '<label class="calc-sp">' + esc(e) + ' <small>(' + ELEMENT_TRIBE[e] + ')</small><input type="number" min="0" max="325" step="1" data-sp="' +
        e + '" value="' + esc(state.sp[e] || 0) + '"></label>';
    }).join("");
    mount.innerHTML =
      '<form class="calc-form" autocomplete="off" onsubmit="return false">' +
      "<fieldset><legend>You</legend>" +
      '<label>Level <input type="number" min="1" max="60" name="level" value="' + esc(state.level) + '"></label>' +
      '<div class="calc-sub">Skill points per tribe (Badge Book: every 5 points = 1 badge level)</div>' +
      '<div class="calc-sps">' + spInputs + "</div>" +
      '<div class="calc-dim" id="calc-badges"></div>' +
      "</fieldset>" +
      "<fieldset><legend>Target</legend>" +
      radio("target", "general", "<b>Overall build</b>: enemies of your level, all elements") +
      '<div class="calc-dim calc-indent">Armour is weighted by the attack elements of the zones around your level.</div>' +
      radio("target", "level", "A specific enemy level and element") +
      '<div class="calc-row calc-indent"><label>Enemy level <input type="number" min="1" max="65" name="enemyLevel" placeholder="yours" value="' + esc(state.enemyLevel) + '"></label>' +
      '<label>Attacks with <select name="enemyElement">' + opt("", "Blunt (Crossroads)", state.enemyElement) +
      ELEMENTS.map(function (e) { return opt(e, elName(e), state.enemyElement); }).join("") + "</select></label></div>" +
      radio("target", "zone", "A zone") +
      '<label class="calc-indent"><select name="zone">' + zoneOpts + "</select></label>" +
      "</fieldset>" +
      "<fieldset><legend>Optimise</legend>" +
      '<label>Build element <small>(what accessories and badges boost)</small><select name="dmgElement">' +
      opt("auto", "Best of all (compare every element)", state.dmgElement) +
      ELEMENTS.map(function (e) { return opt(e, elName(e), state.dmgElement); }).join("") + opt("none", "Neutral / blunt", state.dmgElement) + "</select></label>" +
      check("sameElement", "Only weapons of the build element") +
      '<label>Armour tuned against <select name="resist">' +
      opt("auto", "Automatic (zone mix, or the target's element)", state.resist) +
      opt(MIX, "Zone mix around the target level", state.resist) +
      ELEMENTS.map(function (e) { return opt(e, e + " attackers", state.resist); }).join("") +
      opt("blunt", "Blunt attackers (every resist line counts)", state.resist) +
      opt("any", "Worst case (only plain defence counts)", state.resist) + "</select></label>" +
      '<label>Utility slot <select name="utilFocus">' + opt("auto", "Automatic (stun first, then poison, sustain …)", state.utilFocus) +
      UTILITY_ROLES.map(function (r) { return opt(r, r, state.utilFocus); }).join("") + opt("none", "No utility item", state.utilFocus) + "</select></label>" +
      '<label>Alternatives per slot <input type="number" min="1" max="10" name="top" value="' + esc(state.top) + '"></label>' +
      "</fieldset>" +
      "<fieldset><legend>Filters</legend>" +
      check("noMc", "Exclude MonkeyCash-only items") +
      check("noEvent", "Exclude event items") +
      check("knownOnly", "Only items with a known source") +
      '<label>Skip drop-only items below <input type="number" min="0" max="100" step="0.5" name="minDrop" value="' + esc(state.minDrop) + '"> % chance</label>' +
      '<label>Exclude an item <input list="calc-names" name="excludeInput" placeholder="type a name, press Enter"></label>' +
      '<datalist id="calc-names">' + Object.keys(names).sort().map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" +
      '<div id="calc-excluded"></div>' +
      "</fieldset>" +
      "<fieldset><legend>Upgrade path</legend>" +
      '<div class="calc-row"><label>From level <input type="number" min="1" max="60" name="progFrom" placeholder="yours" value="' + esc(state.progFrom) + '"></label>' +
      '<label>To level <input type="number" min="1" max="60" name="progTo" value="' + esc(state.progTo) + '"></label></div>' +
      '<label>Only upgrades of at least <input type="number" min="0" max="200" step="5" name="minGain" value="' + esc(state.minGain) + '"> %</label>' +
      '<button type="button" class="md-button" id="calc-reset">Reset all settings</button>' +
      "</fieldset>" +
      "</form>" +
      '<div id="calc-out"></div>';

    var form = mount.querySelector("form");
    form.addEventListener("input", onInput);
    form.addEventListener("change", onInput);
    form.excludeInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addExclude(form.excludeInput.value); form.excludeInput.value = ""; }
    });
    form.excludeInput.addEventListener("change", function () {
      if (names[form.excludeInput.value]) { addExclude(form.excludeInput.value); form.excludeInput.value = ""; }
    });
    document.getElementById("calc-reset").addEventListener("click", function () {
      state = JSON.parse(JSON.stringify(DEFAULTS));
      renderForm();
      compute();
    });
    renderExcluded();
  }
  function setTarget(value) {
    state.target = value;
    var r = mount.querySelector('input[name=target][value="' + value + '"]');
    if (r) r.checked = true;
  }
  function onInput(e) {
    var t = e.target;
    if (!t.name && !t.hasAttribute("data-sp")) return;
    if (t.name === "excludeInput") return;
    if (t.hasAttribute("data-sp")) state.sp[t.getAttribute("data-sp")] = Math.max(0, parseInt(t.value, 10) || 0);
    else if (t.type === "checkbox") state[t.name] = t.checked;
    else if (t.type === "radio") { if (t.checked) state[t.name] = t.value; }
    else if (t.type === "number") state[t.name] = t.value === "" ? "" : +t.value;
    else state[t.name] = t.value;
    if (t.name === "zone" && t.value) setTarget("zone");
    if (t.name === "enemyLevel" || t.name === "enemyElement") setTarget("level");
    compute();
  }
  function addExclude(name) {
    name = String(name || "").trim();
    if (!name) return;
    if (state.exclude.map(function (x) { return x.toLowerCase(); }).indexOf(name.toLowerCase()) < 0) state.exclude.push(name);
    renderExcluded();
    compute();
  }
  function removeExclude(name) {
    state.exclude = state.exclude.filter(function (x) { return x !== name; });
    renderExcluded();
    compute();
  }
  function renderExcluded() {
    var box = document.getElementById("calc-excluded");
    box.innerHTML = state.exclude.length ? state.exclude.map(function (n) {
      return '<span class="calc-chip">' + esc(n) + ' <button type="button" data-unexclude="' + esc(n) + '" title="Allow again">✕</button></span>';
    }).join(" ") + ' <button type="button" class="calc-link" id="calc-clear-ex">clear all</button>' : '<span class="calc-dim">No items excluded. Use ✕ next to any result to exclude it.</span>';
    var c = document.getElementById("calc-clear-ex");
    if (c) c.addEventListener("click", function () { state.exclude = []; renderExcluded(); compute(); });
  }

  // ------------------------------------------------------------------ results
  function resolveTarget(level) {
    if (state.target === "zone" && state.zone) {
      var z = D.zones.filter(function (z) { return z.n === state.zone; })[0];
      if (z) {
        return { level: z.d || level, element: TRIBE_ELEMENT[z.t] || null,
                 label: '<a href="' + esc(new URL(z.pg + ".html", ROOT).href) + '">' + esc(z.n) + "</a> (difficulty " + z.d + ", " + esc(z.t) + ")" };
      }
    }
    if (state.target === "level") {
      var lv = state.enemyLevel === "" ? level : Math.max(1, Math.min(65, +state.enemyLevel));
      return { level: lv, element: state.enemyElement || null, label: "enemy level " + lv };
    }
    return { level: level, element: MIX, label: "overall build (enemies of level " + level + ")" };
  }
  function weaponTable(list, n) {  // every weapon; assets/tables.js shows the first n with Show more / Show all
    return table(["Weapon", "Element", "Lv", "Stats", "Cooldown", "Hit", "Hits to kill", "Per kill", "Damage / s", "How to get"],
      list.map(function (w) {
        return [itemRef(w.it), esc(w.it.el || "neutral"), w.it.lv, w.it.sum,
                (w.it.cd || 0) + " s" + (w.it.at === "DamageZone" ? " (zone, 50 % per tick)" : ""),
                "<b>" + w.hit + "</b>", w.hits, w.tpk + " s", w.perSec, howHtml(w.it)];
      }), n);
  }
  function slotTable(slots, cands, score) {
    return table(["Slot", "Best", "Score", "Alternatives", "How to get"], slots.map(function (slot) {
      var c = cands[slot];
      if (!c.length) return [SLOT_NAMES[slot], '<span class="calc-dim">nothing allowed</span>', "", "", ""];
      return [SLOT_NAMES[slot], itemRef(c[0]), Math.round(score(c[0])),
              c.slice(1).map(function (a) { return itemRef(a, 20) + " (" + Math.round(score(a)) + ")"; }).join("<br>"), howHtml(c[0])];
    }));
  }
  function bestCell(w) {
    return w ? itemRef(w.it, 20) + "<br><b>" + w.hit + "</b> · " + w.hits + " hits · " + w.tpk + " s" : '<span class="calc-dim">none</span>';
  }
  function compute() {
    saveState();
    var level = Math.max(1, Math.min(60, +state.level || 1));
    var n = Math.max(1, Math.min(10, +state.top || 3));
    var f = filters();
    var target = resolveTarget(level);
    var mode = state.resist === "auto" ? target.element : state.resist === "blunt" ? null : state.resist;

    var parts = ELEMENTS.filter(function (e) { return badgeLevel(state.sp[e]) > 0; }).map(function (e) {
      var lv = badgeLevel(state.sp[e]);
      return e + " badge " + lv + ": +" + stat("Badge." + e + "Damage", lv) + " " + e + " damage, +" + stat("Badge.Resist" + e, lv) + " defence";
    });
    document.getElementById("calc-badges").textContent = parts.length ? parts.join(" · ") +
      (parts.length > 1 ? " (defence bonuses from several tribes are added up; UNVERIFIED)" : "") : "No badges yet.";

    var dmg = damageOptions(level, f, target, n);
    var chosen = state.dmgElement === "auto" ? dmg.options[0] :
      dmg.options.filter(function (o) { return o.el === (state.dmgElement === "none" ? null : state.dmgElement); })[0];
    var dfn = defenceOption(level, f, target, mode, n);
    var el = chosen.el;
    var util = utilityOptions(level, f, chosen, dfn, n);
    var upick = utilityPick(util);
    var h = [];

    // Summary
    h.push("<h2>Result</h2>");
    h.push("<p>Level <b>" + level + "</b> · ability power " + dmg.ap + " · base defence " + dfn.base + " · " + dfn.hp + " HP<br>Target: " +
      target.label + (target.element === MIX ? "" : ", attacks with <b>" + (target.element ? elName(target.element) : "blunt (Crossroads)") + "</b>") +
      " · enemy HP <b>" + dmg.enemyHp + "</b> · enemy attack <b>" + dfn.enemyAp + "</b></p>");
    if (Math.abs(target.level - level) >= 5) {
      h.push('<div class="admonition warning"><p class="admonition-title">XP falloff</p><p>The target is ' + Math.abs(target.level - level) +
        " levels away from you, so kill XP is cut (rule <code>xp.kill_level_band</code>).</p></div>");
    }

    // Build summary card
    var bm = chosen.bestMelee, br = chosen.bestRanged;
    h.push('<div class="calc-card"><div class="calc-card-title">Your build: ' + elCell(el) + "</div><div class=\"calc-card-grid\">" +
      [["Melee", bm && bm.it], ["Ranged", br && br.it], ["Utility" + (upick ? " · " + upick.role.toLowerCase() : ""), upick && upick.row.it]].concat(DAMAGE_SLOTS.concat(DEFENCE_SLOTS).map(function (s) {
        return [SLOT_NAMES[s], (chosen.acc[s] || dfn.arm[s] || [])[0]];
      })).map(function (p) {
        return '<div><span class="calc-dim">' + p[0] + "</span><br>" + (p[1] ? itemRef(p[1], 32) : '<span class="calc-dim">—</span>') + "</div>";
      }).join("") + "</div></div>");

    // Element comparison
    h.push("<h3>Build element comparison</h3>");
    h.push('<p class="calc-dim">The build element is what your accessories (and badges) boost. Each row picks the best melee and ranged weapon of any element ' +
      "with those accessories, ranked by melee + ranged time per kill (hits × cooldown). Click a row to use that element.</p>");
    h.push(table(["Build element", "Badge bonus", "Base damage", "Best melee", "Best ranged"],
      dmg.options.map(function (o) {
        return { attrs: ' class="calc-pick' + (o === chosen ? " calc-sel" : "") + '" data-element="' + (o.el || "none") + '" title="Use ' + esc(elName(o.el)) + '"',
                 cells: [elCell(o.el), o.bonus ? "+" + o.bonus : "", o.base, bestCell(o.bestMelee), bestCell(o.bestRanged)] };
      })));

    // Damage
    h.push("<h3>Damage</h3>");
    h.push('<div class="calc-cols"><div><h4>Melee</h4>' + weaponTable(chosen.melee, Math.max(n, 3)) + "</div>" +
      "<div><h4>Ranged</h4>" + weaponTable(chosen.ranged, Math.max(n, 3)) + "</div></div>");
    h.push("<h4>Utility: one extra hotbar item</h4>");
    h.push('<p class="calc-dim">Utility items are not ranked by damage. Each role is valued against this build: a stun gives free hits ' +
      "with your main weapon while the enemy can't fight back, poison adds damage over time, sustain heals you, a defence buff cuts " +
      "elemental damage, and escape items make you invisible. The highlighted row is the pick shown in your build.</p>");
    h.push(table(["Role", "Best", "What it does for this build", "Alternatives", "How to get"], UTILITY_ROLES.filter(function (r) {
      return util[r].length;
    }).map(function (r) {
      var top = util[r][0];
      return { attrs: upick && upick.row === top ? ' class="calc-sel"' : "",
               cells: ["<b>" + r + "</b>", itemRef(top.it), utilityText(r, top),
                       util[r].slice(1).map(function (a) { return itemRef(a.it, 20) + '<br><span class="calc-dim">' + utilityText(r, a) + "</span>"; }).join("<br>"),
                       howHtml(top.it)] };
    })));
    h.push("<h4>Accessories</h4>");
    h.push(slotTable(DAMAGE_SLOTS, chosen.acc, function (it) { return accScore(it, el); }));
    h.push('<p class="calc-dim">Accessory score = blunt + ' + (el || "no") + " element line. Base damage for " + (el || "neutral") + " weapons " + chosen.base +
      " = ability power " + dmg.ap + " + accessories " + chosen.accTotal + " + badge " + chosen.bonus +
      ". Weapons of other elements only get the blunt part of the accessories and their own badge.</p>");

    // Defence
    var what = mode === MIX ? "the zone mix" : mode === "any" ? "the worst case (plain defence only)" : mode ? mode + " attackers" : "blunt attackers";
    h.push("<h3>Defence: armour tuned against " + what + "</h3>");
    if (mode === MIX) {
      h.push('<p class="calc-dim">Fight zones of levels ' + (target.level - 5) + "–" + (target.level + 5) + " attack with: " +
        Object.keys(dfn.mix).sort(function (a, b) { return dfn.mix[b] - dfn.mix[a]; }).map(function (k) { return k + " " + pct(dfn.mix[k]); }).join(", ") +
        ". A resist line counts against its own element and against blunt attacks, so it is weighted by that share.</p>");
    }
    h.push(slotTable(DEFENCE_SLOTS, dfn.arm, dfn.score));
    h.push(table(["Attacked with", "Zones nearby", "Your defence", "Damage per enemy hit", "Hits to knock you out"],
      dfn.perAttack.map(function (p) {
        var isTarget = dfn.vs && p === dfn.vs;
        return { attrs: isTarget ? ' class="calc-sel"' : "",
                 cells: [p.el ? elCell(p.el) : elCell(null).replace("Neutral / blunt", "Blunt (Crossroads)"), pct(p.share), p.defence,
                         p.capped ? "minimum only" : p.taken, p.hitsToDie || "—"] };
      })));
    h.push('<p class="calc-dim">Enemy attack ' + dfn.enemyAp + ", your HP " + dfn.hp + ". Defence = base " + dfn.base + " + armour + badges " + dfn.badge +
      ". When your defence beats the enemy attack you only take MQReborn's level-based minimum (size unknown).</p>");
    h.push("<h4>What the stats window should show</h4>");
    h.push("<ul><li>Defence: <b>" + dfn.shown + "</b> (includes every resist line)</li>" +
      (bm ? "<li>A hit with " + esc(bm.it.n) + ": <b>" + bm.hit + "</b></li>" : "") +
      (br ? "<li>A hit with " + esc(br.it.n) + ": <b>" + br.hit + "</b></li>" : "") + "</ul>");

    // Progression
    var from = state.progFrom === "" ? level : Math.max(1, Math.min(60, +state.progFrom));
    var to = Math.max(from, Math.min(60, +state.progTo || 60));
    var gain = Math.max(0, +state.minGain || 0);
    var pmode = mode;
    var rows = progression(f, el, pmode, from, to, gain);
    h.push("<h3>Upgrade path: level " + from + " → " + to + "</h3>");
    h.push('<p class="calc-dim">Rows marked <b>now</b> are the best you can wear at level ' + from + ". After that, every item that beats everything before it in its slot" +
      (gain ? " by at least " + gain + " %" : "") + ". Weapons: the weapon this build recommends at each level (" +
      (state.sameElement ? (el || "neutral") + " only" : "any element") + ", with your badges and that level's best " + (el || "neutral") +
      " accessories, ranked by time per kill against enemies of that level; score = hit). Accessories: blunt + " + (el || "no") +
      " line. Armour: " + (pmode === MIX ? "defence + resist weighted by the zone mix of levels " + Math.max(1, from - 5) + "–" + (to + 5)
        : pmode === "any" ? "plain defence" : "defence + " + (pmode || "every") + " resist line") + ".</p>");
    h.push(table(["Level", "Slot", "Item", "Tribe", "Score", "Gain", "Cooldown", "How to get"], rows.map(function (r) {
      return { attrs: r.now ? ' class="calc-now"' : "",
               cells: [r.now ? "now" : r.lv, esc(r.slot), itemRef(r.it), esc(r.it.tr || ""), r.score,
                       r.detail ? esc(r.detail) : r.gain ? "+" + r.gain + " (" + Math.round(100 * r.gain / (r.score - r.gain)) + " %)" : "",
                       r.it.w ? (r.it.cd || 0) + " s" : "", howHtml(r.it)] };
    })));
    h.push('<p class="calc-dim">Settings are saved in this browser and in the page address, so you can bookmark a build. ' +
      "Unknowns: enemy resist values (assumed 0), MQReborn's minimum damage, swing animations slower than the cooldown. " +
      (D.public ? "" : "Same model as <code>uv run scripts/mq.py build</code>.") + "</p>");
    document.getElementById("calc-out").innerHTML = h.join("");
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    D = window.MQ_CALC_DATA;
    state = loadState();
    renderForm();
    mount.addEventListener("click", function (e) {
      var b = e.target.closest("[data-exclude]");
      if (b) { addExclude(b.getAttribute("data-exclude")); return; }
      var u = e.target.closest("[data-unexclude]");
      if (u) { removeExclude(u.getAttribute("data-unexclude")); return; }
      if (e.target.closest("a")) return;
      var row = e.target.closest("[data-element]");
      if (row) {
        state.dmgElement = row.getAttribute("data-element");
        mount.querySelector("select[name=dmgElement]").value = state.dmgElement;
        compute();
      }
    });
    compute();
  }
  if (window.MQ_CALC_DATA) { boot(); return; }
  mount.innerHTML = "<p class=\"mq-loading\">Loading item data…</p>";
  var s = document.createElement("script");
  s.src = new URL("build-calc-data.js", SCRIPT.src).href;
  s.onload = boot;
  s.onerror = function () {
    mount.innerHTML = "<p>Could not load the item data (<code>assets/build-calc-data.js</code>). Reload the page; on a local " +
      "copy, rebuild the wiki.</p>";
  };
  document.head.appendChild(s);
})();
