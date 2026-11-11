/**
 * Game Set III terrain and fortifications (§53–62): wire, entrenchments,
 * minefields, bunkers, roadblocks, rubble and fire, river landings with
 * reinforcements, snow, and Prep Fire digging and clearing work.
 */
import { DIRECTIONS, directionTo, hexKey, hexsideKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { losFrom } from '../ctx';
import { d6, roll2d6 } from '../rng';
import { carried, enemiesIn, hexLabel, hexTem, isLeader, leaderDrmFor, range, squadType, stackingProblem, unitLabel } from '../queries';
import { RuleError, type Bunker, type Fortifications, type GameState, type Reserve, type SideId, type Unit, type Vehicle } from '../types';
import type { Emit } from './common';
import { eliminate } from './common';
import { iftLookup, resultText } from './fire';
import { applyHexResults } from './morale';
import { crewCheck, destroyVehicle, iftColumn, inArc, vehicleLabel, vehicleType, facingIndex } from './armor';
import { reveal } from './special';

// ---- Setup ---------------------------------------------------------------------------------

export function setupFortifications(ctx: Ctx, s: GameState): void {
  const f = ctx.scenario.fortifications;
  const key = (id: string) => {
    const k = ctx.map.byId[id];
    if (!k) throw new Error(`${ctx.scenario.id}: bad fortification hex ${id}`);
    return k;
  };
  if (ctx.scenario.rubble?.length) s.rubble = ctx.scenario.rubble.map(key);
  if (!f) return;
  const side = (id: string) => {
    const [h, d] = id.split('/');
    const k = key(h!);
    const dir = ['N', 'NE', 'SE', 'S', 'SW', 'NW'].indexOf(d!);
    if (dir < 0) throw new Error(`${ctx.scenario.id}: bad roadblock ${id}`);
    return hexsideKey(parseHexKey(k), dir as 0);
  };
  s.forts = {
    wire: (f.wire ?? []).map(key),
    trenches: (f.trenches ?? []).map(key),
    mines: (f.mines ?? []).map((m) => ({ hex: key(m.hex), side: m.side, factors: m.factors, known: false })),
    bunkers: (f.bunkers ?? []).map((b) => ({ hex: key(b.hex), side: b.side, capacity: b.capacity, ca: b.ca, nca: b.nca, facing: facingIndex(b.facing) })),
    roadblocks: (f.roadblocks ?? []).map(side),
  };
}

/** Full hexes along one edge of a board: where reinforcements come on (§60). */
export function edgeHexes(ctx: Ctx, board: string, edge: 'N' | 'S' | 'E' | 'W'): HexKey[] {
  const hs = Object.values(ctx.map.hexes).filter((h) => h.board === board && !h.half);
  if (!hs.length) return [];
  const col = (id: string) => /^([A-Z]+)/.exec(id)![1]!;
  const ci = (c: string) => (c.length === 1 ? c.charCodeAt(0) - 65 : 26 + c.charCodeAt(0) - 65);
  const row = (id: string) => Number(/(\d+)$/.exec(id)![1]);
  if (edge === 'N' || edge === 'S') {
    const byCol = new Map<string, typeof hs>();
    for (const h of hs) (byCol.get(col(h.localId)) ?? byCol.set(col(h.localId), []).get(col(h.localId))!).push(h);
    return [...byCol.values()].map((list) => list.sort((a, b) => (edge === 'N' ? row(a.localId) - row(b.localId) : row(b.localId) - row(a.localId)))[0]!.key);
  }
  const cols = hs.map((h) => ci(col(h.localId)));
  const want = edge === 'W' ? Math.min(...cols) : Math.max(...cols);
  return hs.filter((h) => ci(col(h.localId)) === want).map((h) => h.key);
}

export function setupLanding(ctx: Ctx, s: GameState): void {
  const l = ctx.scenario.landing;
  if (!l) return;
  s.landing = { [l.side]: 0 };
  for (const id of l.mist ?? []) {
    const k = ctx.map.byId[id];
    if (k && !s.smoke.some((x) => x.hex === k)) s.smoke.push({ hex: k, side: '__mist' });
  }
}

// ---- Queries -------------------------------------------------------------------------------

export function hasWire(s: GameState, hex: HexKey): boolean {
  return !!s.forts?.wire.includes(hex);
}
export function inTrench(s: GameState, hex: HexKey): boolean {
  return !!s.forts?.trenches.includes(hex);
}
export function bunkerAt(s: GameState, hex: HexKey): Bunker | undefined {
  return s.forts?.bunkers.find((b) => b.hex === hex);
}
export function onFire(s: GameState, hex: HexKey): boolean {
  return !!s.fires?.includes(hex);
}
export function rubbled(s: GameState, hex: HexKey): boolean {
  return !!s.rubble?.includes(hex);
}
export function roadblockBetween(s: GameState, a: HexKey, b: HexKey): boolean {
  if (!s.forts?.roadblocks.length) return false;
  const d = directionTo(parseHexKey(a), parseHexKey(b));
  if (d === undefined) return false;
  return s.forts.roadblocks.includes(hexsideKey(parseHexKey(a), d));
}

/** A burning hex between two hexes blocks the line of sight at any height (§59.7). */
export function fireOnLine(ctx: Ctx, s: GameState, from: HexKey, to: HexKey): boolean {
  if (!s.fires?.length) return false;
  const hs = losFrom(ctx, from, to).hexes.map((h) => h.key);
  return hs.slice(1, -1).some((h) => s.fires!.includes(h));
}

/** Extra movement for infantry from fortifications, rubble and roadblocks; Infinity where they may not go in the Movement Phase. */
export function fortMoveCost(s: GameState, from: HexKey, to: HexKey): { mf: number; parts: string[] } {
  if (onFire(s, to)) return { mf: Infinity, parts: ['on fire (§59.6)'] };
  if (hasWire(s, to)) return { mf: Infinity, parts: ['wire: only in the Advance Phase (§53.3)'] };
  let mf = 0;
  const parts: string[] = [];
  if (inTrench(s, to)) {
    mf += 1;
    parts.push('+1 into the entrenchment (§54.4)');
  }
  if (bunkerAt(s, to)) {
    mf += 1;
    parts.push('+1 into the bunker (§56.22)');
  }
  if (roadblockBetween(s, from, to)) {
    mf += 1;
    parts.push('+1 over the roadblock (§62.2)');
  }
  if (rubbled(s, to)) parts.push('rubble: as a building (§58.2)');
  return { mf, parts };
}

/** Terrain-effect override for a unit in a fortified or ruined hex, against a given kind of attack (§54.7, §56, §58.2). */
export function fortTem(ctx: Ctx, s: GameState, u: Unit, hex: HexKey, firerHexes: readonly HexKey[], attack: 'fire' | 'arty' | 'overrun' | 'ft' | 'dc'): { drm: number; label: string } | undefined {
  const b = bunkerAt(s, hex);
  if (b && b.side === u.side && !u.riding) {
    const through = attack !== 'arty' && attack !== 'overrun' && firerHexes.length > 0 && firerHexes.every((f) => inArc(b.hex, b.facing, f));
    if (attack === 'ft') return through ? { drm: 0, label: 'bunker, flamethrower through the arc (§56.52)' } : { drm: b.nca, label: 'bunker (§56.52)' };
    return through ? { drm: b.ca, label: 'bunker, through its covered arc (§56.1)' } : { drm: b.nca, label: 'bunker (§56.1)' };
  }
  if (inTrench(s, hex) && !u.riding) {
    const table = { fire: 2, dc: 2, arty: 4, overrun: 4, ft: 0 } as const;
    return { drm: table[attack], label: 'entrenchment (§54.7)' };
  }
  if (rubbled(s, hex)) return { drm: ctx.data.tables.tem.stoneBuilding, label: 'rubble (§58.2)' };
  return undefined;
}

// ---- Wire and mines on the move ---------------------------------------------------------------

/** Leaving a wire hex costs a die roll of MF; a unit may always move one hex (§53.4). */
export function wireExitCost(s: GameState, from: HexKey): number {
  return hasWire(s, from) ? d6(s) : 0;
}

/** Infantry entering or leaving a minefield: its factors on the IFT, no modifiers (+1 in snow) (§55.2–55.24). */
export function mineAttack(ctx: Ctx, s: GameState, units: Unit[], hex: HexKey, why: 'enter' | 'leave', emit: Emit): void {
  const m = s.forts?.mines.find((x) => x.hex === hex);
  if (!m || !units.length) return;
  m.known = true;
  const [a, b] = roll2d6(s);
  const snow = ctx.scenario.snow ? 1 : 0;
  const col = iftColumn(ctx, m.factors);
  const results = units.map((u) => ({ unit: u.id, result: iftLookup(ctx, col, a + b + snow), finalDr: a + b + snow }));
  emit({
    kind: 'fire',
    text: `Mines in ${hexLabel(ctx, hex)} (${m.factors} factors) as ${units.map((u) => unitLabel(ctx, u)).join(', ')} ${why === 'enter' ? 'enter' : 'leave'}: roll ${a + b}${snow ? ' +1 snow' : ''} → ${resultText(results[0]!.result)} (§55.2)`,
    side: m.side,
    dice: [a, b],
    hexes: [hex],
    fx: { firerHexes: [], targets: [hex], kinds: ['MINE'], shooters: [], outcomes: [{ hex, penetration: false, results: results.map((r) => ({ unit: r.unit, result: r.result })) }], mines: hex },
  });
  for (const r of results) if (r.result !== '-' && s.units[r.unit]) s.units[r.unit]!.dm = true;
  if (results.some((r) => r.result === 'KIA')) buildingHit(ctx, s, hex, 'mine', emit);
  applyHexResults(ctx, s, { hex, results }, emit);
}

/** Vehicles: only a KIA counts, with the minefield-vs-vehicle modifier; AFVs are immobilized and roll again to blow up (§55.6–55.62). */
export function mineVsVehicle(ctx: Ctx, s: GameState, v: Vehicle, hex: HexKey, emit: Emit): void {
  const m = s.forts?.mines.find((x) => x.hex === hex);
  if (!m) return;
  m.known = true;
  const t = vehicleType(ctx, v);
  const M = ctx.data.armor.mines;
  const mod = (t.kind === 'truck' || t.kind === 'jeep' ? M.truck : t.kind === 'halftrack' ? M.halftrack : M.other) ?? 0;
  const col = iftColumn(ctx, m.factors);
  const [a, b] = roll2d6(s);
  const res = iftLookup(ctx, col, a + b + mod + (ctx.scenario.snow ? 1 : 0));
  emit({ kind: 'fire', text: `${vehicleLabel(ctx, v)} hits mines in ${hexLabel(ctx, hex)}: ${a + b}${mod ? ` ${mod}` : ''} → ${res === 'KIA' ? 'KIA' : 'no effect'} (§55.6)`, side: m.side, dice: [a, b], hexes: [hex], fx: { mines: hex } });
  if (res !== 'KIA') return;
  if (t.kind === 'truck' || t.kind === 'jeep') {
    destroyVehicle(ctx, s, v, 'mines', emit, 'roll');
    return;
  }
  v.immobilized = true;
  v.moveDone = true;
  const [c, d] = roll2d6(s);
  const again = iftLookup(ctx, col, c + d + mod);
  emit({ kind: 'info', text: `${vehicleLabel(ctx, v)} is immobilized; second roll ${c + d} → ${again === 'KIA' ? 'it blows up' : 'it holds'} (§55.62)`, side: v.side, dice: [c, d], hexes: [hex] });
  if (again === 'KIA') destroyVehicle(ctx, s, v, 'mines', emit, 'roll');
  else crewCheck(ctx, s, v, 'immobilized on mines', emit);
}

// ---- Rubble and fire ---------------------------------------------------------------------------

/**
 * A KIA from artillery, HE, mines or a charge brings down a building hex (§58.1);
 * HE and artillery may set it alight on a repeated KIA, flamethrowers on any KIA (§59.2–59.3).
 */
export function buildingHit(ctx: Ctx, s: GameState, hex: HexKey, kind: 'arty' | 'he' | 'mine' | 'dc' | 'ft', emit: Emit, again?: () => boolean): void {
  const h = ctx.map.hexes[hex];
  if (!h) return;
  // Optional §59.1: woods and wheat burn in summer, lit like buildings.
  if (!h.building) {
    if (woodsCanBurn(ctx, s, hex) && (kind === 'ft' || ((kind === 'arty' || kind === 'he') && !!again?.()))) startFire(ctx, s, hex, emit);
    return;
  }
  if (ctx.scenario.rulesLevel < 58) return;
  if (kind !== 'ft' && !rubbled(s, hex)) {
    (s.rubble ??= []).push(hex);
    for (const u of Object.values(s.units)) if (u.hex === hex) eliminate(ctx, s, u, 'the building came down on them (§58.1)', emit);
    for (const w of Object.values(s.weapons)) if (w.hex === hex && !w.owner) delete s.weapons[w.id];
    emit({ kind: 'info', text: `The building in ${hexLabel(ctx, hex)} collapses into rubble (§58.1)`, hexes: [hex], fx: { rubble: hex } });
  }
  if (ctx.scenario.rulesLevel < 59 || onFire(s, hex)) return;
  const burns = kind === 'ft' || ((kind === 'arty' || kind === 'he') && !!again?.());
  if (burns) startFire(ctx, s, hex, emit);
}

export function startFire(ctx: Ctx, s: GameState, hex: HexKey, emit: Emit): void {
  if (onFire(s, hex)) return;
  (s.fires ??= []).push(hex);
  emit({ kind: 'info', text: `Fire breaks out in ${hexLabel(ctx, hex)}: no line of sight through it, and anyone inside must get out (§59)`, hexes: [hex], fx: { fire: hex } });
}

function summer(ctx: Ctx): boolean {
  return /jun|jul|aug|sep|oct/i.test(ctx.scenario.date);
}

/** Optional §59.1: woods and wheatfields burn from June to October. */
export function woodsCanBurn(ctx: Ctx, s: GameState, hex: HexKey): boolean {
  const t = ctx.map.hexes[hex]?.terrain;
  return !!s.options?.woodsFires && ctx.scenario.rulesLevel >= 59 && summer(ctx) && (t === 'woods' || t === 'wheat');
}

/** End of Advancing Fire: fires spread to adjacent buildings, and with the optional §59.1 in summer to woods and grain (§59.4). */
export function spreadFires(ctx: Ctx, s: GameState, emit: Emit): void {
  if (!s.fires?.length) return;
  const wild = !!s.options?.woodsFires && summer(ctx);
  const done = new Set<HexKey>();
  for (const f of [...s.fires]) {
    const src = ctx.map.hexes[f]!;
    for (const d of DIRECTIONS) {
      const n = hexKey(neighbor(src.hex, d));
      const h = ctx.map.hexes[n];
      if (!h || onFire(s, n) || done.has(n)) continue;
      let need = 0;
      if (h.building) need = h.building === src.building ? (h.terrain === 'stoneBuilding' ? 9 : 8) : 10;
      else if (wild && h.terrain === 'woods') need = 7;
      else if (wild && h.terrain === 'wheat') need = 6;
      if (!need) continue;
      done.add(n);
      const [a, b] = roll2d6(s);
      if (a + b >= need) {
        emit({ kind: 'info', text: `Fire spreads from ${hexLabel(ctx, f)} to ${hexLabel(ctx, n)} (${a + b} ≥ ${need}, §59.4)`, dice: [a, b], hexes: [n] });
        startFire(ctx, s, n, emit);
      }
    }
  }
}

/** Rout Phase: units in burning hexes get out to an adjacent hex or die (§59.6). */
export function escapeFires(ctx: Ctx, s: GameState, emit: Emit): void {
  if (!s.fires?.length) return;
  for (const u of Object.values(s.units)) {
    if (!onFire(s, u.hex) || u.riding) continue;
    const out = DIRECTIONS.map((d) => hexKey(neighbor(parseHexKey(u.hex), d)))
      .filter((h) => ctx.map.hexes[h] && ctx.map.hexes[h]!.terrain !== 'water' && !onFire(s, h) && !enemiesIn(s, h, u.side).length)
      .sort((a, b) => hexTem(ctx, b).drm - hexTem(ctx, a).drm || a.localeCompare(b))[0];
    if (!out) {
      eliminate(ctx, s, u, 'trapped by fire (§59.6)', emit);
      continue;
    }
    const from = u.hex;
    u.hex = out;
    for (const w of carried(s, u)) w.hex = out;
    emit({ kind: 'rout', text: `${unitLabel(ctx, u)} escapes the fire in ${hexLabel(ctx, from)} to ${hexLabel(ctx, out)} (§59.6)`, side: u.side, units: [u.id], from, to: out, hexes: [from, out] });
  }
}

// ---- Reinforcements and river landings (§60) ------------------------------------------------------

export function enterMap(ctx: Ctx, s: GameState, ids: readonly string[], hex: HexKey, emit: Emit): void {
  if (s.phase !== 'movement' || s.awaiting !== s.phasing) throw new RuleError('Reinforcements enter in the Movement Phase');
  const res = (s.reserves ?? []).find((r) => ids.every((id) => r.units.some((u) => u.id === id)));
  if (!res || res.side !== s.phasing) throw new RuleError('Those units are not waiting to enter');
  if (s.turn < res.turn) throw new RuleError(`They arrive on turn ${res.turn}`);
  if (!res.hexes.includes(hex)) throw new RuleError('Not an entry hex for them');
  if (enemiesIn(s, hex, s.phasing).length || Object.values(s.vehicles).some((v) => v.hex === hex && v.side !== s.phasing)) throw new RuleError('Not into an enemy-held hex');
  const coming = res.units.filter((u) => ids.includes(u.id));
  const squads = coming.filter((u) => !isLeader(ctx, u)).length;
  if (s.landing && s.landing[s.phasing] !== undefined) {
    if (squads > s.landing[s.phasing]!) throw new RuleError(`Only ${s.landing[s.phasing]} more squads can land this turn (§60.3)`);
    s.landing[s.phasing]! -= squads;
  }
  for (const u of coming) {
    const nu: Unit = { ...u, hex, moved: true, mfSpent: res.endsMove ? 99 : 1, moveDone: res.endsMove };
    s.units[u.id] = nu;
    for (const w of res.weapons.filter((x) => x.owner === u.id)) s.weapons[w.id] = { ...w, hex };
  }
  const crowded = stackingProblem(ctx, s, hex, s.phasing);
  if (crowded) throw new RuleError(crowded, '§6.1');
  const left = res.units.filter((u) => !ids.includes(u.id));
  s.reserves = (s.reserves ?? []).filter((r) => r !== res);
  if (left.length) s.reserves.push({ ...res, units: left, weapons: res.weapons.filter((w) => left.some((u) => u.id === w.owner)) });
  emit({ kind: 'move', text: `${coming.map((u) => unitLabel(ctx, u)).join(', ')} ${res.endsMove ? 'land at' : 'enter at'} ${hexLabel(ctx, hex)}${res.endsMove ? ' and stop (§60.2)' : ''}`, side: s.phasing, units: [...ids], to: hex, hexes: [hex] });
}

/** Start of the landing side's Movement Phase: how many squads the boats can carry (§60.3). */
export function rollLanding(ctx: Ctx, s: GameState, emit: Emit): void {
  const l = ctx.scenario.landing;
  if (!l || s.phasing !== l.side || !(s.reserves ?? []).some((r) => r.side === l.side)) return;
  const [a, b] = roll2d6(s);
  s.landing = { ...(s.landing ?? {}), [l.side]: a + b };
  emit({ kind: 'info', text: `Assault boats: up to ${a + b} squads can land this turn (§60.3)`, side: l.side, dice: [a, b] });
}

/** Start of each game turn from turn 2: the mist burns off on a 1 (§60.5). */
export function burnMist(ctx: Ctx, s: GameState, emit: Emit): void {
  if (!ctx.scenario.landing?.mist || s.half !== 0 || s.turn < 2 || !s.smoke.some((x) => x.side === '__mist')) return;
  const r = d6(s);
  if (r === 1) {
    s.smoke = s.smoke.filter((x) => x.side !== '__mist');
    emit({ kind: 'info', text: 'The river mist burns off (rolled 1, §60.5)', dice: [r] });
  } else emit({ kind: 'info', text: `The mist on the river bank holds (rolled ${r}, §60.5)`, dice: [r] });
}

export function reservesOf(s: GameState, side: SideId): Reserve[] {
  return (s.reserves ?? []).filter((r) => r.side === side);
}

// ---- Prep Fire work: digging in, clearing wire and mines -------------------------------------------

export function dig(ctx: Ctx, s: GameState, unitId: string, work: 'entrench' | 'wire' | 'mines', hex: HexKey | undefined, emit: Emit): void {
  const u = s.units[unitId];
  if (!u || u.side !== s.awaiting || s.phase !== 'prepFire' || s.phasing !== u.side) throw new RuleError('This work is done in your Prep Fire Phase', '§53.5, §54.2, §55.5');
  const level = { wire: 53, entrench: 54, mines: 55 }[work];
  if (ctx.scenario.rulesLevel < level) throw new RuleError(`Not in this scenario (rules up to §${ctx.scenario.rulesLevel})`, `§${level}`);
  const st = squadType(ctx, u);
  if (!st || u.broken) throw new RuleError('An unbroken squad does the work');
  if (u.firedPhase || u.mfSpent > 0 || u.riding) throw new RuleError('It may not have fired or moved');
  const lead = leaderDrmFor(ctx, s, u.hex, u.side, u.id);
  const [a, b] = roll2d6(s);
  u.firedPhase = 'prepFire';
  u.usedInherent = true;
  u.moveDone = true;
  u.noConceal = true;
  // Digging in or working on wire and mines shows where the squad is (§25.4, §42.2).
  reveal(ctx, s, u.hex, emit, { entrench: 'dug in', wire: 'cut wire', mines: 'cleared mines' }[work]);
  if (work === 'entrench') {
    const h = ctx.map.hexes[u.hex]!;
    if (h.building || bunkerAt(s, u.hex)) throw new RuleError('Not in a building or bunker', '§54.2');
    if (inTrench(s, u.hex)) throw new RuleError('Already entrenched');
    const need = 5;
    const fin = a + b + lead.drm + (ctx.scenario.snow ? 2 : 0);
    const ok = fin <= need;
    emit({ kind: 'info', text: `${unitLabel(ctx, u)} digs in: ${a}+${b}${lead.drm ? ` ${lead.drm}` : ''}${ctx.scenario.snow ? ' +2 snow' : ''} = ${fin} vs ${need}: ${ok ? 'an entrenchment!' : 'not deep enough'} (§54.2)`, side: u.side, units: [u.id], dice: [a, b], hexes: [u.hex] });
    if (ok) {
      s.forts ??= { wire: [], trenches: [], mines: [], bunkers: [], roadblocks: [] };
      s.forts.trenches.push(u.hex);
    }
    return;
  }
  const target = hex ?? u.hex;
  if (work === 'wire') {
    if (!hasWire(s, u.hex)) throw new RuleError('There is no wire in its hex', '§53.5');
    const ok = a + b + lead.drm <= st.fp;
    emit({ kind: 'info', text: `${unitLabel(ctx, u)} cuts the wire: ${a}+${b}${lead.drm ? ` ${lead.drm}` : ''} vs ${st.fp}: ${ok ? 'cleared' : 'still there'} (§53.5)`, side: u.side, units: [u.id], dice: [a, b], hexes: [u.hex] });
    if (ok) s.forts!.wire = s.forts!.wire.filter((h) => h !== u.hex);
    return;
  }
  const m = s.forts?.mines.find((x) => x.hex === target);
  if (range(u.hex, target) > 1) throw new RuleError('In or next to the minefield', '§55.5');
  const ok = a + b + lead.drm <= st.fp;
  emit({ kind: 'info', text: `${unitLabel(ctx, u)} probes for mines in ${hexLabel(ctx, target)}: ${a}+${b}${lead.drm ? ` ${lead.drm}` : ''} vs ${st.fp}: ${ok ? (m ? 'cleared' : 'nothing there') : 'no luck'} (§55.5)`, side: u.side, units: [u.id], dice: [a, b], hexes: [target] });
  if (ok && m) s.forts!.mines = s.forts!.mines.filter((x) => x !== m);
}

/** Vehicles crossing wire: tanks and SP guns flatten it, halftracks stop on it, trucks and jeeps can't enter (§53.7–53.9). */
export function vehicleWire(ctx: Ctx, s: GameState, v: Vehicle, hex: HexKey, emit: Emit): void {
  if (!hasWire(s, hex)) return;
  const t = vehicleType(ctx, v);
  s.forts!.wire = s.forts!.wire.filter((h) => h !== hex);
  if (t.kind === 'halftrack') v.moveDone = true;
  emit({ kind: 'info', text: `${vehicleLabel(ctx, v)} crushes the wire in ${hexLabel(ctx, hex)}${t.kind === 'halftrack' ? ' and must stop (§53.9)' : ' (§53.8)'}`, side: v.side, hexes: [hex] });
}

/** Soft vehicles under infantry fire: a KIA wrecks them; a morale check result means an MC at 8, then a second one: immobilized or wrecked (§51.4). */
export function fireOnSoftVehicles(ctx: Ctx, s: GameState, hex: HexKey, side: SideId, column: number, dr: number, emit: Emit): void {
  for (const v of Object.values(s.vehicles)) {
    if (v.hex !== hex || v.side === side) continue;
    const t = vehicleType(ctx, v);
    if (t.kind !== 'truck' && t.kind !== 'jeep') continue;
    const res = iftLookup(ctx, column, dr);
    if (res === '-') continue;
    if (res === 'KIA') {
      destroyVehicle(ctx, s, v, 'shot up', emit, 'none');
      continue;
    }
    const mc = res === 'M' ? 0 : res;
    const morale = ctx.data.armor.soft.morale;
    const [a, b] = roll2d6(s);
    if (a + b + mc <= morale) {
      emit({ kind: 'morale', text: `${vehicleLabel(ctx, v)} driver holds (${a + b}${mc ? `+${mc}` : ''} vs ${morale}, §51.4)`, side: v.side, dice: [a, b], hexes: [hex], fx: { result: 'pass' } });
      continue;
    }
    const [c, d] = roll2d6(s);
    const wreck = c + d > morale;
    emit({ kind: 'morale', text: `${vehicleLabel(ctx, v)} fails its check; second check ${c + d} vs ${morale}: ${wreck ? 'wrecked' : 'immobilized'} (§51.4)`, side: v.side, dice: [a, b, c, d], hexes: [hex], fx: { result: wreck ? 'broken' : 'failed' } });
    if (wreck) destroyVehicle(ctx, s, v, 'crashed under fire', emit, 'none');
    else {
      v.immobilized = true;
      v.moveDone = true;
    }
  }
}

/** Fire for effect or a KIA charge can clear wire (80mm+) and mines in the hex (§53.53–53.54, §55.7). */
export function blastClears(ctx: Ctx, s: GameState, hex: HexKey, mm: number, emit: Emit): void {
  if (!s.forts) return;
  if (mm >= 80 && hasWire(s, hex)) {
    s.forts.wire = s.forts.wire.filter((h) => h !== hex);
    emit({ kind: 'info', text: `The wire in ${hexLabel(ctx, hex)} is blown away (§53.54)`, hexes: [hex] });
  }
  if (s.forts.mines.some((m) => m.hex === hex)) {
    s.forts.mines = s.forts.mines.filter((m) => m.hex !== hex);
    emit({ kind: 'info', text: `Mines in ${hexLabel(ctx, hex)} are set off (§55.7)`, hexes: [hex] });
  }
}

export function emptyForts(): Fortifications {
  return { wire: [], trenches: [], mines: [], bunkers: [], roadblocks: [] };
}
