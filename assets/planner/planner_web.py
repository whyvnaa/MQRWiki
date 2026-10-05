from __future__ import annotations
import json
import math
from build_planner import DEFENCE_SLOTS, ELEMENTS, MIX, SLOT_NAMES, TRIBE_ELEMENT, Costs, Economy, Planner, Profile, effort
AUTO = 'Auto'
TRIBES = ['Shadow', 'Bone', 'Outlaw', 'Wild', 'Grease', 'Crossroads']
DEFAULTS = {'level': 20, 'tribe': AUTO, 'slots': ['melee', 'ranged'], 'prefer': 'both', 'where': 'level', 'sources': ['vendor', 'chest', 'enemy', 'craft', 'quest'], 'effort': None, 'switch': 5.0, 'time': 0.0, 'owned': [], 'excluded': []}
ARMOUR = {SLOT_NAMES[s] for s in DEFENCE_SLOTS}
UTILITY = ('stun', 'heal', 'poison', 'buff')

def duration(hours: float | None) -> str:
    if hours is None or math.isinf(hours):
        return 'no known way'
    if hours < 1 / 60:
        return 'now' if hours <= 0 else 'a moment'
    if hours < 1:
        return f'{hours * 60:.0f} min'
    return f'{hours:.1f} h'

def secs(t: float) -> str:
    return f'{t:.1f} s' if t < 100 else f'{t:.0f} s'

def way_short(w) -> str:
    if w is None:
        return 'no known way'
    bits = [w.label]
    if w.days >= 0.5:
        bits.append(f'{w.days:.0f} days')
    if w.bananas:
        bits.append(f'{w.bananas:,} bananas')
    if w.nick_cash:
        bits.append(f'{w.nick_cash:,} NickCash')
    return ' · '.join(bits)

def finite(h: float | None) -> float | None:
    return None if h is None or math.isinf(h) else round(h, 3)

class Web:

    def __init__(self, bundle: dict):
        self.bundle = bundle
        self._key: str | None = None
        self._set: tuple | None = None
        self._prog: dict[str, dict] = {}

    @staticmethod
    def options(o: dict | None) -> dict:
        o = {**DEFAULTS, **{k: v for k, v in (o or {}).items() if k in DEFAULTS}}
        o['level'] = max(1, min(int(o['level'] or 1), 60))
        o['tribe'] = o['tribe'] if o['tribe'] in TRIBES else AUTO
        o['slots'] = [s for s in ('melee', 'ranged') + UTILITY if s in (o['slots'] or [])]
        if not {'melee', 'ranged'} & set(o['slots']):
            o['slots'].insert(0, 'melee')
        o['prefer'] = o['prefer'] if o['prefer'] in ('melee', 'ranged') and o['prefer'] in o['slots'] else 'both'
        o['sources'] = sorted(set(o['sources'] or []))
        o['owned'] = sorted(set(o['owned'] or []))
        o['excluded'] = sorted(set(o['excluded'] or []))
        return o

    def setup(self, o: dict) -> tuple:
        key = json.dumps([o['level'], o['sources'], o['slots'], o['prefer'], o['where'], o['owned'], o['excluded']])
        if key == self._key:
            return self._set
        where = o['where'] or 'level'
        target_level, target_element = (None, MIX)
        zone = self.bundle['zones'].get(where[5:]) if where.startswith('zone:') else None
        if zone:
            target_level, target_element = (zone.get('level') or None, TRIBE_ELEMENT.get(zone.get('tribe')))
        elif where in ELEMENTS:
            target_element = where
        elif where == 'blunt':
            target_element = None
        profile = Profile(level=o['level'], owned={p: 1 for p in o['owned'] if p in self.bundle['items']}, skill_points=o['level'], mix_all=where == 'all', weapons=tuple((s for s in o['slots'] if s in ('melee', 'ranged'))), defence_weight=0.3, prefer=None if o['prefer'] == 'both' else o['prefer'], target_level=target_level, target_element=target_element)
        sources = set(o['sources'])
        eco = Economy(nick_cash='nick_cash' in sources, sources=frozenset(sources - {'nick_cash', 'unknown'}) | ({'tribe_drop'} if 'enemy' in sources else set()))
        costs = Costs(self.bundle, eco)
        exclude = frozenset(o['excluded'])
        pl = Planner(self.bundle, costs.hours, eco, exclude)
        menu = pl.menu(profile)
        if menu:
            eco.kill_time = max(0.5, min(menu[0].kill_time, 10.0))
            costs = Costs(self.bundle, eco)
            pl = Planner(self.bundle, costs.hours, eco, exclude)
        pl.unknown = 'unknown' in sources
        self._key, self._set, self._prog = (key, (pl, costs, profile, pl.price_table(profile)), {})
        return self._set

    def raw(self, o: dict) -> dict:
        pl, _, profile, prices = self.setup(o)
        utility = tuple((s.capitalize() for s in o['slots'] if s in UTILITY))
        key = json.dumps([o['tribe'], o['effort'], o['switch'], o['time']])
        if key not in self._prog:
            self._prog[key] = pl.progression(profile, o['tribe'], o['effort'], prices, switch_cost=float(o['switch'] or 0), hour_cost=float(o['time'] or 0), unknown=pl.unknown, utility=utility)
        return self._prog[key]

    def item(self, it: dict, items: dict) -> str:
        p = it['prefab']
        if p not in items:
            items[p] = {'name': it['name'], 'lv': it['level_req'] or 1, 'icon': it.get('icon'), 'url': it.get('url'), 'el': it.get('element'), 'tribe': it.get('tribe')}
        return p

    def how(self, it: dict, hours: float | None, costs: Costs, profile: Profile) -> dict:
        owned = bool(profile.owned.get(it['prefab']))
        way = None if hours is None else costs.best(it['prefab'], profile)
        kind, grade = effort(way, hours)
        return {'hours': finite(hours), 'time': 'you have it' if owned else duration(hours), 'kind': kind, 'grade': grade, 'way': '' if owned else way_short(way), 'owned': owned}

    def progression(self, o: dict | None=None) -> dict:
        o = self.options(o)
        pl, costs, profile, prices = self.setup(o)
        prog = self.raw(o)
        items: dict[str, dict] = {}
        lanes = []
        for label, segs in prog['lanes'].items():
            lanes.append({'label': label, 'kind': 'armour' if label in ARMOUR else 'gear' if label in pl.slot_labels(profile) else 'utility', 'segs': [{'from': s['from'], 'to': s['to'], 'item': self.item(s['item'], items), **self.how(s['item'], prices.get(s['item']['prefab'], s['hours']), costs, profile)} for s in segs]})
        levels = [{'level': r['level'], 'tribe': r['badge_tribe'], 'kill': round(r['kill_time'], 3), 'taken': round(r['damage_taken'], 1), 'points': r['points']} for r in prog['levels']]
        excluded = [self.item(pl.opt.item[x], items) for x in o['excluded'] if x in pl.opt.item]
        excluded.sort(key=lambda x: items[x]['name'] or x)
        return {'options': o, 'lo': prog['lo'], 'hi': prog['hi'], 'lanes': lanes, 'badges': prog['badges'], 'changes': prog['changes'], 'levels': levels, 'items': items, 'excluded': excluded}

    def stage(self, o: dict | None=None, level: int | None=None) -> dict:
        o = self.options(o)
        pl, costs, p, prices = self.setup(o)
        prog = self.raw(o)
        level = max(prog['lo'], min(int(level or o['level']), prog['hi']))
        row = prog['levels'][level - prog['lo']]
        picks, tribe = (row['picks'], row['badge_tribe'])
        stage = pl.stage(p, tribe, level, picks, prices, o['effort'])
        items: dict[str, dict] = {}
        compare = []
        for t in TRIBES:
            one = pl.progression(p, t, o['effort'], prices, lo=level, hi=level, switch_cost=0, unknown=pl.unknown)['levels'][0]
            compare.append({'tribe': t, 'kill': secs(one['kill_time']), 'best': t == tribe, 'hits': ' + '.join((format(h['hit'], ',.0f') for h in one['hits'].values()))})
        el = TRIBE_ELEMENT.get(tribe)
        dmg, dfn = row['badge']
        before = prog['levels'][level - prog['lo'] - 1]['picks'] if level > prog['lo'] else None
        new = [it['name'] for k, it in picks.items() if before is not None and before.get(k) is not it]
        missing = [k for k, it in picks.items() if not p.owned.get(it['prefab'])]
        lost = [k for k in missing if row['hours'][k] is None or math.isinf(row['hours'][k])]
        todo = sum((row['hours'][k] for k in missing if k not in lost))
        get = f'{len(missing)} of {len(picks)} pieces to get, {duration(todo)} in all' + (f', plus {len(lost)} with no known way' if lost else '') if missing else 'you have every piece'
        slots = []
        for label, rows in stage['slots'].items():
            ways = [r for r in rows if r['hours'] is not None]
            none = [r for r in rows if r['hours'] is None]
            ref = next((r for r in rows if r['best']), None)
            order = rows if pl.unknown else ways + none
            slots.append({'label': label, 'armour': label in ARMOUR, 'ways': len(ways), 'none': len(none), 'rows': [self.row(label, r, ref, costs, p, items) for r in order]})
        utility = []
        for slot, held in row['utility'].items():
            rows = pl.utility(pl.at_level(p, level), picks, (slot,), tribe=tribe)[slot]
            order = [held] + [r for r in reversed(rows) if r['item'] is not held['item']]
            utility.append({'label': slot, 'rows': [{'item': self.item(r['item'], items), 'best': r is held, 'line': r['text'], **self.how(r['item'], r['hours'], costs, p)} for r in order]})
        return {'level': level, 'tribe': tribe, 'auto': o['tribe'] == AUTO, 'element': el, 'badge': {'level': row['points'] // 5, 'damage': dmg, 'defence': dfn}, 'kill': secs(row['kill_time']), 'taken': round(row['damage_taken']), 'hits': [{'slot': k, 'hit': round(h['hit']), 'n': h['hits']} for k, h in row['hits'].items()], 'compare': compare, 'new': new, 'get': get, 'slots': slots, 'utility': utility, 'items': items}

    def row(self, label: str, r: dict, ref: dict | None, costs: Costs, p: Profile, items: dict) -> dict:
        it = r['item']
        delta = None
        if label in ARMOUR:
            line = f"takes {r['damage_taken']:,.0f} a hit"
            if ref and (not r['best']):
                d = r['damage_taken'] - ref['damage_taken']
                delta = ['same as the best', ''] if abs(d) < 0.5 else [f'{d:+,.0f}', 'loss' if d > 0 else 'gain']
        else:
            cls = label.lower() if label in ('Melee', 'Ranged') else None
            parts = [f"{k} {h['hit']:,.0f} × {h['hits']}" for k, h in r['hits'].items() if cls in (None, k)]
            line = 'hits ' + ' · '.join(parts) + f" · kills in {secs(r['kill_time'])}"
            if ref and (not r['best']) and (ref['smooth'] > 0):
                d = r['smooth'] / ref['smooth'] - 1
                delta = ['as fast as the best', ''] if abs(d) < 0.005 else [f"{abs(d) * 100:.0f} % {('slower' if d > 0 else 'faster')}", 'loss' if d > 0 else 'gain']
        return {'item': self.item(it, items), 'best': r['best'], 'over': r['over'], 'line': line, 'delta': delta, **self.how(it, r['hours'], costs, p)}
_web: Web | None = None

def load(bundle_json: str) -> None:
    global _web
    _web = Web(json.loads(bundle_json))

def call(fn: str, options_json: str, level: int | None=None) -> str:
    o = json.loads(options_json or '{}')
    out = _web.progression(o) if fn == 'progression' else _web.stage(o, level)
    return json.dumps(out, ensure_ascii=False, separators=(',', ':'))

def meta() -> str:
    zones = [{'zone': z['zone'], 'title': _web.bundle['zones'].get(z['zone'], {}).get('title') or z['zone'], 'level': z['level']} for z in sorted(_web.bundle['fight_zones'], key=lambda z: (z['level'] or 0, z['zone']))]
    return json.dumps({'zones': zones}, ensure_ascii=False)
