/**
 * Fire combat (§8–§11, §16–§18.1).
 *
 * analyzeFire() validates an attack and works out every number before any
 * dice are rolled; it also powers the fire calculator and odds preview.
 * resolveFire() rolls, checks breakdown and applies the results.
 */
import { hexDistance, hexKey, hexToPixel, hexesInRange, parseHexKey, type HexKey } from '@squadwar/hex';
import { checkLos } from '@squadwar/los';
import type { Ctx } from '../ctx';
import { losFrom } from '../ctx';
import type { IftResult } from '../data';
import { d6, roll2d6 } from '../rng';
import {
  carried,
  hexLabel,
  hexTem,
  inMelee,
  isLeader,
  isOpenGround,
  leaderType,
  portageOf,
  squadType,
  unitLabel,
  unitsIn,
  weaponType,
} from '../queries';
import { RuleError, type FireUnit, type GameState, type Phase, type SideId, type Unit } from '../types';
import { applyHexResults } from './morale';
import { canOperateSpecial, reveal, smokeOnLine } from './special';
import { chargeVsVehicles, fireOnExposedCrews } from './armor';
import type { Emit } from './common';

export interface FireContribution {
  readonly unit: string;
  readonly weapon?: string;
  readonly hex: HexKey;
  readonly base: number;
  readonly fp: number;
  readonly notes: readonly string[];
}

export interface TargetUnit {
  readonly unit: string;
  readonly drm: number;
  readonly notes: readonly string[];
  /** Concealed: attacked as Area Fire at half firepower (§25.8, §9.4). */
  readonly area?: boolean;
}

export interface TargetHex {
  readonly hex: HexKey;
  readonly units: readonly TargetUnit[];
  /** True for hexes hit only by MG penetration (§17.5). */
  readonly penetration: boolean;
}

export interface FireAnalysis {
  readonly side: SideId;
  readonly phase: Phase;
  readonly contributions: readonly FireContribution[];
  readonly totalFp: number;
  /** Index into the IFT columns, or -1 when below the first column. */
  readonly column: number;
  readonly columnFp: number;
  readonly leader?: string;
  readonly leaderDrm: number;
  readonly targets: readonly TargetHex[];
  readonly breakdown: readonly { readonly weapon: string; readonly number: number }[];
  readonly firerHexes: readonly HexKey[];
  readonly trace: readonly string[];
  /** IFT column at half firepower, for concealed targets (§25.8). */
  readonly areaColumn: number;
  /** The line of fire runs through smoke: +1d6 after the roll (§24.6). */
  readonly smoke: boolean;
  /** A flamethrower attack (§22). */
  readonly flamethrower: boolean;
}

const FIRE_PHASES: readonly Phase[] = ['prepFire', 'defensiveFire', 'advancingFire'];

export function firingSide(s: GameState): SideId {
  return s.awaiting;
}

/** Validate an attack and compute its numbers. Throws RuleError when illegal. */
export function analyzeFire(ctx: Ctx, s: GameState, firers: readonly FireUnit[], target: HexKey, leaderId?: string): FireAnalysis {
  if (!FIRE_PHASES.includes(s.phase)) throw new RuleError('Fire is only possible in the Prep, Defensive or Advancing Fire Phase', '§4');
  const side = s.awaiting;
  const phase = s.phase;
  if (!firers.length) throw new RuleError('Choose at least one firing unit');
  if (!ctx.map.hexes[target]) throw new RuleError('Target hex is off the map');

  const trace: string[] = [];
  const contributions: FireContribution[] = [];
  const firerHexes = new Set<HexKey>();
  const breakdown: { weapon: string; number: number }[] = [];
  const seen = new Set<string>();

  for (const f of firers) {
    const u = s.units[f.unit];
    if (!u) throw new RuleError(`Unknown unit ${f.unit}`);
    if (seen.has(u.id)) throw new RuleError(`${unitLabel(ctx, u)} is listed twice`);
    seen.add(u.id);
    if (u.side !== side) throw new RuleError(`${unitLabel(ctx, u)} is not yours to fire`);
    if (u.broken) throw new RuleError(`${unitLabel(ctx, u)} is broken and cannot fire`, '§13.1');
    // Sewer arrivals and the defenders of that entrance fire at each other point blank (§27.7A–B).
    const sewerFight = u.hex === target && unitsIn(s, target).some((x) => x.sewerAssault);
    if (inMelee(s, u.hex) && !sewerFight) throw new RuleError(`${unitLabel(ctx, u)} is locked in melee`, '§20.81');
    if (u.firedPhase && u.firedPhase !== phase) throw new RuleError(`${unitLabel(ctx, u)} already fired this player turn`, '§8.2, Q&A 8.2');
    if (phase === 'prepFire' && u.berserk) throw new RuleError('Berserk units may not Prep Fire', '§18.42');
    if (phase === 'advancingFire' && u.firedPhase === 'prepFire') throw new RuleError('Units that Prep Fired may not fire again', '§4.5');
    if (!f.inherent && !f.weapons.length) throw new RuleError(`${unitLabel(ctx, u)} fires nothing`);
    const st = squadType(ctx, u);
    const lt = leaderType(ctx, u);
    if (f.inherent) {
      if (!st) throw new RuleError('Leaders have no inherent firepower outside close combat', '§20.72');
      if (u.usedInherent) throw new RuleError(`${unitLabel(ctx, u)} already used its inherent firepower`, '§8.2');
    }
    const ws = f.weapons.map((id) => {
      const w = s.weapons[id];
      if (!w || w.owner !== u.id) throw new RuleError(`${unitLabel(ctx, u)} does not carry that weapon`);
      if (w.malfunctioned) throw new RuleError('That weapon has malfunctioned', '§18.1');
      if (w.usedThisTurn) throw new RuleError('That weapon already fired this player turn', '§8.2');
      return w;
    });
    if (ws.length) {
      if (phase === 'advancingFire') {
        const limit = lt ? 2 : 4;
        if (u.ppUsed >= limit) throw new RuleError(`${unitLabel(ctx, u)} carried ${u.ppUsed} portage points this Movement Phase and may not fire support weapons`, '§5.74');
      }
      if (lt && ws.length > 1) throw new RuleError('A leader may man only one MG', '§17.3');
      if (st && ws.length > 2) throw new RuleError('A squad may fire at most two MGs', '§17.1–17.2');
      if (st && ws.length === 2) {
        const sum = ws.reduce((a, w) => a + weaponType(ctx, w).fp, 0);
        if (sum > 4 && f.inherent) throw new RuleError('Firing two MGs worth more than 4 FP forfeits the squad’s own firepower', '§17.2');
      }
    }
    const r = hexDistance(parseHexKey(u.hex), parseHexKey(target));
    const kinds = ws.map((w) => weaponType(ctx, w).kind);
    if (kinds.includes('DC')) throw new RuleError('Demolition charges are placed in the Movement Phase and set off in Advancing Fire', '§23.3');
    if (kinds.includes('FT')) {
      // Flamethrowers never combine, get no modifiers and are never halved (§22.1–22.8).
      if (firers.length !== 1 || ws.length !== 1 || f.inherent) throw new RuleError('A flamethrower always fires alone; the squad’s own fire is a separate attack at the same target', '§22.3, §22.5');
      if (!canOperateSpecial(ctx, u)) throw new RuleError('Only assault engineers or −2/−3 leaders operate a flamethrower', '§22.4');
      if (r > weaponType(ctx, ws[0]!).range) throw new RuleError('Flamethrowers have no long range (2 hexes)', '§22.1');
      const w = ws[0]!;
      contributions.push({ unit: u.id, weapon: w.id, hex: u.hex, base: weaponType(ctx, w).fp, fp: weaponType(ctx, w).fp, notes: ['flamethrower: no modifiers (§22.1–22.2)'] });
      firerHexes.add(u.hex);
      continue;
    }
    const add = (base: number, printedRange: number, label: string, weapon?: string, leaderMg = false) => {
      const notes: string[] = [];
      if (r > printedRange * 2) throw new RuleError(`${label} is out of range (${r} > ${printedRange * 2})`, '§9.2');
      let fp = base;
      if (leaderMg) {
        fp /= 2;
        notes.push('½ leader manning MG (§17.3)');
      }
      if (r <= 1) {
        fp *= 2;
        notes.push(r === 0 ? '×2 point blank, same hex (§27.7)' : '×2 point blank (§9.1)');
      } else if (r > printedRange) {
        fp /= 2;
        notes.push(`½ long range ${r} > ${printedRange} (§9.2)`);
      }
      if (phase === 'advancingFire' && u.moved) {
        fp /= 2;
        notes.push('½ moving fire (§9.3)');
      }
      contributions.push({ unit: u.id, ...(weapon ? { weapon } : {}), hex: u.hex, base, fp, notes });
    };
    if (f.inherent && st) add(st.fp, st.range, unitLabel(ctx, u));
    for (const w of ws) {
      const wt = weaponType(ctx, w);
      add(wt.fp, wt.range, wt.name, w.id, !!lt);
      breakdown.push({ weapon: w.id, number: wt.breakdown });
    }
    firerHexes.add(u.hex);
  }

  // Fire groups: same or adjacent hexes, chained (§8.6).
  const hexes = [...firerHexes];
  if (hexes.length > 1) {
    const reached = new Set([hexes[0]!]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const h of hexes) {
        if (reached.has(h)) continue;
        if ([...reached].some((x) => hexDistance(parseHexKey(x), parseHexKey(h)) === 1)) {
          reached.add(h);
          grew = true;
        }
      }
    }
    if (reached.size !== hexes.length) throw new RuleError('A fire group must be in the same or a chain of adjacent hexes', '§8.6');
  }
  for (const h of hexes) {
    if (s.attacks.includes(`${h}>${target}`)) throw new RuleError(`Units in ${hexLabel(ctx, h)} already attacked ${hexLabel(ctx, target)} this phase; units in one hex combine fire on a target`, '§8.5');
    if (h === target) continue;
    const l = ctx.los(h, target);
    if (!l.clear) throw new RuleError(`No line of sight from ${hexLabel(ctx, h)}: ${l.reason}`, '§7');
  }

  const flamethrower = contributions.some((c) => c.weapon && weaponType(ctx, s.weapons[c.weapon]!).kind === 'FT');
  if (flamethrower && leaderId) throw new RuleError('Leadership does not modify flamethrower fire', '§22.2');
  // Leader direction (§15.2–15.4, §17.4).
  let leaderDrm = 0;
  if (flamethrower) {
    // No modifiers of any kind (§22.2).
  } else if (leaderId) {
    const L = s.units[leaderId];
    const lt = L ? leaderType(ctx, L) : undefined;
    if (!L || !lt || L.side !== side) throw new RuleError('That leader cannot direct this attack');
    if (L.broken) throw new RuleError('A broken leader cannot direct fire', '§15.5');
    if (L.directed) throw new RuleError(`${unitLabel(ctx, L)} already directed a fire group this player turn`, '§15.2');
    if (hexes.length !== 1 || hexes[0] !== L.hex) throw new RuleError('A leader directs only fire groups entirely in his own hex', '§15.2');
    if (contributions.some((c) => c.unit === L.id)) throw new RuleError('A leader manning an MG gives up his leadership for this attack', '§17.4');
    if (L.firedPhase && L.firedPhase !== phase) throw new RuleError('That leader already acted in another fire phase');
    leaderDrm = lt.leadership;
  } else if (!flamethrower) {
    // A lone leader manning an MG applies his own DRM (§17.4).
    const only = contributions.length > 0 && contributions.every((c) => c.unit === contributions[0]!.unit) ? s.units[contributions[0]!.unit] : undefined;
    const lt = only && leaderType(ctx, only);
    if (lt && lt.leadership < 0) leaderDrm = lt.leadership;
  }

  const totalFp = contributions.reduce((a, c) => a + c.fp, 0);
  const cols = ctx.data.tables.ift.columns;
  const columnFor = (fp: number) => {
    let c = -1;
    for (let i = 0; i < cols.length; i++) if (cols[i]! <= fp + 1e-9) c = i;
    return c;
  };
  const column = columnFor(totalFp);
  const areaColumn = columnFor(totalFp / 2);

  // Targets: main hex plus MG penetration hexes.
  const targets: TargetHex[] = [];
  const main = targetUnits(ctx, s, side, target, hexes, leaderDrm, false, flamethrower);
  const exposedCrew = Object.values(s.vehicles).some((v) => v.hex === target && v.side !== side && v.ce);
  if (!main.units.some((t) => s.units[t.unit]!.side !== side) && !exposedCrew) throw new RuleError(`No enemy units to attack in ${hexLabel(ctx, target)}`);
  targets.push(main);
  for (const h of flamethrower ? [] : penetrationHexes(ctx, s, contributions, hexes, target)) {
    const t = targetUnits(ctx, s, side, h, hexes, leaderDrm, true, false);
    if (t.units.length) targets.push(t);
  }

  trace.push(
    `Firepower: ${contributions
      .map((c) => {
        const u = s.units[c.unit]!;
        const name = c.weapon ? weaponType(ctx, s.weapons[c.weapon]!).name : unitLabel(ctx, u);
        return `${name} ${c.base}${c.notes.length ? ` (${c.notes.join(', ')}) → ${fmtFp(c.fp)}` : ''}`;
      })
      .join(' + ')} = ${fmtFp(totalFp)}`,
  );
  trace.push(column < 0 ? 'Below the 1 FP column: no effect possible (§10.3)' : `IFT column ${cols[column]} (rightmost column not above ${fmtFp(totalFp)}, §10.3)`);
  if (targets.some((t) => t.units.some((x) => x.area))) trace.push(`Concealed units are attacked as Area Fire at half firepower: column ${areaColumn >= 0 ? cols[areaColumn] : 'none'} (§25.8, §9.4)`);
  const smoke = !flamethrower && hexes.some((h) => smokeOnLine(ctx, s, h, target));
  if (smoke) trace.push('The line of fire crosses smoke: one die is added after the roll (§24.6)');
  if (leaderDrm) trace.push(`Leader ${s.units[leaderId ?? contributions[0]!.unit]?.name ?? ''} directs: ${leaderDrm > 0 ? '+' : ''}${leaderDrm} (§15.2)`);

  return {
    side,
    phase,
    contributions,
    totalFp,
    column,
    columnFp: column >= 0 ? cols[column]! : 0,
    ...(leaderId ? { leader: leaderId } : {}),
    leaderDrm,
    targets,
    breakdown,
    firerHexes: hexes,
    trace,
    areaColumn,
    smoke,
    flamethrower,
  };
}

function fmtFp(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0+$/, '');
}

/** Units affected in a target hex and their DRMs (§11, §16.5–16.6, §20.83). */
export function targetUnits(ctx: Ctx, s: GameState, side: SideId, hex: HexKey, firerHexes: readonly HexKey[], leaderDrm: number, penetration: boolean, flamethrower: boolean): TargetHex {
  const tem = hexTem(ctx, hex);
  const t = ctx.data.tables.tem;
  // Hexside wall/hedge applies only if every firing hex's LOS crosses it (§11.53, §11.6).
  const sides = firerHexes.map((f) => losFrom(ctx, f, hex).targetHexside);
  let sideDrm = 0;
  let sideNote = '';
  if (sides.every((x) => x?.wall)) {
    sideDrm = t.wall;
    sideNote = `+${t.wall} behind wall hexside (§11.53)`;
  } else if (sides.every((x) => x && (x.wall || x.hedge))) {
    sideDrm = t.hedge;
    sideNote = `+${t.hedge} behind hedge hexside (§11.53)`;
  }
  const affected = new Map<string, Unit>();
  // In a sewer fight (§27.7) only the other side is hit; otherwise fire into a melee hits everyone (§20.83).
  const melee = inMelee(s, hex) && !unitsIn(s, hex).some((x) => x.sewerAssault);
  // Penetrating fire hits friend and foe alike beyond the first target (§17.6).
  for (const u of unitsIn(s, hex)) if (u.side !== side || melee || penetration) affected.set(u.id, u);
  // Defensive fire may "move back" enemy units to any hex they entered (§16.1–16.3).
  const tracked = new Set<string>();
  if (s.phase === 'defensiveFire') {
    for (const [id, steps] of Object.entries(s.tracks)) {
      const u = s.units[id];
      if (!u || u.side === side) continue;
      if (steps.some((st) => st.hex === hex)) {
        affected.set(id, u);
        tracked.add(id);
      }
    }
  }
  const units: TargetUnit[] = [];
  // A vehicle or wreck in the hex just before the target acts like a wall (§32.3); vehicles that just moved don't (§32.6).
  const screened = firerHexes.every((f) => {
    const hs = losFrom(ctx, f, hex).hexes;
    const prev = hs.length >= 3 ? hs[hs.length - 2]!.key : undefined;
    if (!prev || prev === f) return false;
    if (s.wrecks.some((w) => w.hex === prev)) return true;
    return Object.values(s.vehicles).some((v) => v.hex === prev && !(s.phase === 'defensiveFire' && v.moved));
  });
  if (screened && !sideDrm) {
    sideDrm = t.wall;
    sideNote = `+${t.wall} a vehicle or wreck in the way (§32.3)`;
  }
  // Infantry beside a friendly AFV or a wreck: +1 (§32.5, §40.5).
  const shelter = (u: Unit) => s.wrecks.some((w) => w.hex === hex) || Object.values(s.vehicles).some((v) => v.hex === hex && v.side === u.side);
  // A flamethrower in the target hex draws fire: −1 (§22.7).
  const ftHere = unitsIn(s, hex).some((u) => carried(s, u).some((w) => weaponType(ctx, w).kind === 'FT'));
  for (const u of affected.values()) {
    const area = u.concealed && !(tracked.has(u.id) && !u.concealed);
    if (flamethrower) {
      units.push({ unit: u.id, drm: 0, notes: ['no modifiers for flamethrowers (§22.2)'], ...(area ? { area } : {}) });
      continue;
    }
    const sewerStep = tracked.has(u.id) && s.tracks[u.id]?.some((st) => st.hex === hex && st.sewer);
    if (sewerStep) {
      units.push({ unit: u.id, drm: t.movingInOpen, notes: [`${t.movingInOpen} coming up from the sewer: no terrain modifiers (§27.7A)`], ...(area ? { area } : {}) });
      continue;
    }
    let drm = tem.drm + sideDrm + leaderDrm;
    const notes: string[] = [];
    if (ftHere) {
      drm -= 1;
      notes.push('−1 flamethrower in the hex (§22.7)');
    }
    if (tem.drm) notes.push(`${tem.drm > 0 ? '+' : ''}${tem.drm} ${tem.label} (§11.1)`);
    if (shelter(u)) {
      drm += 1;
      notes.push('+1 beside an AFV or wreck (§32.5)');
    }
    if (sideDrm) notes.push(sideNote);
    if (leaderDrm) notes.push(`${leaderDrm > 0 ? '+' : ''}${leaderDrm} leader`);
    if (tracked.has(u.id) && isOpenGround(ctx, hex)) {
      drm += t.movingInOpen;
      notes.push(`${t.movingInOpen} moving in the open (§16.5)`);
    }
    units.push({ unit: u.id, drm, notes, ...(area ? { area } : {}) });
  }
  return { hex, units, penetration };
}

/**
 * MG penetration (§2.8, §17.5–17.6): an attack made only with MGs from a
 * single hex also affects further hexes along the line through the target,
 * up to the smallest penetration factor, each needing its own clear LOS.
 * Penetration stops at (and includes) a woods or building hex.
 */
function penetrationHexes(ctx: Ctx, s: GameState, cs: readonly FireContribution[], firerHexes: readonly HexKey[], target: HexKey): HexKey[] {
  if (firerHexes.length !== 1 || cs.some((c) => !c.weapon)) return [];
  const from = firerHexes[0]!;
  if ((ctx.map.hexes[from]?.level ?? 0) !== (ctx.map.hexes[target]?.level ?? 0)) return []; // §2.8
  const pen = Math.min(...cs.map((c) => weaponType(ctx, s.weapons[c.weapon!]!).penetration));
  const maxRange = Math.min(...cs.map((c) => weaponType(ctx, s.weapons[c.weapon!]!).range * 2));
  if (pen <= 1) return [];
  const tc = ctx.map.hexes[target]!;
  if (tc.terrain === 'woods' || tc.terrain === 'woodBuilding' || tc.terrain === 'stoneBuilding') return [];
  const a = hexToPixel(parseHexKey(from));
  const b = hexToPixel(parseHexKey(target));
  const dir = { x: b.x - a.x, y: b.y - a.y };
  const len = Math.hypot(dir.x, dir.y);
  const out: HexKey[] = [];
  let lastT = len;
  // Walk outward from the target along the same line.
  const cand = hexesInRange(parseHexKey(from), maxRange)
    .map((h) => ({ k: hexKey(h), p: hexToPixel(h) }))
    .filter(({ k }) => !!ctx.map.hexes[k] && k !== from && k !== target)
    .map(({ k, p }) => {
      const t = ((p.x - a.x) * dir.x + (p.y - a.y) * dir.y) / len;
      const off = Math.abs((p.x - a.x) * dir.y - (p.y - a.y) * dir.x) / len;
      return { k, t, off };
    })
    .filter((c) => c.t > len && c.off < 0.75)
    .sort((x, y) => x.t - y.t);
  for (const c of cand) {
    if (out.length >= pen - 1) break;
    if (c.t <= lastT) continue;
    if (!checkLos(ctx.map, { hex: from }, { hex: c.k }).clear) break;
    lastT = c.t;
    out.push(c.k);
    const h = ctx.map.hexes[c.k]!;
    if (h.terrain === 'woods' || h.terrain === 'woodBuilding' || h.terrain === 'stoneBuilding') break;
  }
  return out.filter((k) => unitsIn(s, k).length > 0);
}

export function iftLookup(ctx: Ctx, column: number, finalDr: number): IftResult {
  if (column < 0) return '-';
  const rows = ctx.data.tables.ift.rows;
  const row = Math.max(1, Math.min(15, finalDr));
  return rows[row - 1]![column]!;
}

export function resultText(r: IftResult): string {
  return r === 'KIA' ? 'KIA' : r === 'M' ? 'MC' : r === '-' ? 'no effect' : `+${r} MC`;
}

/** Roll the attack, check breakdown, apply results. */
export function resolveFire(ctx: Ctx, s: GameState, firers: readonly FireUnit[], target: HexKey, leaderId: string | undefined, emit: Emit): void {
  const a = analyzeFire(ctx, s, firers, target, leaderId);
  const [d1, d2] = roll2d6(s);
  const dr = d1 + d2;
  const trace = [...a.trace, `Dice ${d1}+${d2} = ${dr}`];

  // Mark firers (§8.2, §15.2).
  for (const c of a.contributions) {
    const u = s.units[c.unit]!;
    u.firedPhase = s.phase;
    if (!c.weapon) u.usedInherent = true;
    else s.weapons[c.weapon]!.usedThisTurn = true;
  }
  for (const f of firers) {
    const u = s.units[f.unit]!;
    // Two big MGs forfeit the squad's own fire for the turn (§17.2).
    if (!f.inherent && f.weapons.length === 2) u.usedInherent = true;
  }
  if (leaderId) {
    const L = s.units[leaderId]!;
    L.directed = true;
    L.firedPhase = s.phase;
  }
  for (const h of a.firerHexes) s.attacks.push(`${h}>${target}`);

  // Smoke: one die after the fire roll (§24.6–24.7).
  const smokeDie = a.smoke ? d6(s) : 0;
  if (smokeDie) trace.push(`Smoke: +${smokeDie} (§24.6)`);
  const outcomes = a.targets.map((t) => ({
    hex: t.hex,
    results: t.units.map((tu) => {
      const fin = dr + tu.drm + smokeDie;
      return { unit: tu.unit, result: iftLookup(ctx, tu.area ? a.areaColumn : a.column, fin), finalDr: fin, notes: tu.area ? [...tu.notes, 'Area Fire (½, §25.8)'] : tu.notes };
    }),
  }));
  // Firing gives away a concealed position (§25.4).
  for (const h of a.firerHexes) reveal(ctx, s, h, emit, 'fired');
  for (const c of a.contributions) if (s.units[c.unit]) s.units[c.unit]!.noConceal = true;
  for (const o of outcomes) {
    for (const r of o.results) {
      const u = s.units[r.unit]!;
      trace.push(
        `${unitLabel(ctx, u)} in ${hexLabel(ctx, o.hex)}: ${dr}${r.notes.length ? ` ${r.notes.join(' ')}` : ''} → ${r.finalDr}: ${resultText(r.result)}`,
      );
    }
  }

  const broke = a.flamethrower ? [] : a.breakdown.filter((b) => dr >= b.number);
  const kinds = [...new Set(a.contributions.map((c) => (c.weapon ? weaponType(ctx, s.weapons[c.weapon]!).kind : 'rifle')))];
  const summary = outcomes
    .flatMap((o) => o.results)
    .map((r) => resultText(r.result))
    .filter((x) => x !== 'no effect');
  emit({
    kind: 'fire',
    text: `${a.side === s.sides[0].id ? s.sides[0].name : s.sides[1].name} fire ${fmtFp(a.totalFp)} FP at ${hexLabel(ctx, target)}: roll ${dr} → ${summary.length ? [...new Set(summary)].join(', ') : 'no effect'}`,
    trace,
    side: a.side,
    dice: [d1, d2],
    from: a.firerHexes[0],
    to: target,
    hexes: outcomes.map((o) => o.hex),
    units: a.contributions.map((c) => c.unit),
    fx: {
      firerHexes: a.firerHexes,
      targets: outcomes.map((o) => o.hex),
      kinds,
      results: outcomes.flatMap((o) => o.results.map((r) => r.result)),
      // For the Fire Director: who fired what from where, and the result in each hex.
      shooters: a.contributions.map((c) => ({ hex: c.hex, kind: c.weapon ? weaponType(ctx, s.weapons[c.weapon]!).kind : 'rifle', unit: c.unit })),
      outcomes: outcomes.map((o) => ({ hex: o.hex, penetration: a.targets.find((t) => t.hex === o.hex)?.penetration ?? false, results: o.results.map((r) => ({ unit: r.unit, result: r.result })) })),
      column: a.columnFp,
    },
  });

  for (const b of broke) {
    const w = s.weapons[b.weapon]!;
    w.malfunctioned = true;
    emit({ kind: 'breakdown', text: `${weaponType(ctx, w).name} malfunctions (unmodified ${dr} ≥ B${b.number}, §18.1)`, side: w.side, hexes: [w.hex] });
  }

  // Crews riding exposed get shot at too (§34.8).
  if (!a.flamethrower) fireOnExposedCrews(ctx, s, target, a.side, a.column, dr + smokeDie, emit);
  // Desperation morale marker for everyone fired on (§14.6).
  if (a.column >= 0) for (const o of outcomes) for (const r of o.results) if (s.units[r.unit]) s.units[r.unit]!.dm = true;
  for (const o of outcomes) {
    // Any effect strips concealment from the target hex (§25.9).
    if (o.results.some((r) => r.result !== '-')) reveal(ctx, s, o.hex, emit, 'hit by fire');
    // A flamethrower KIA destroys the support weapons there too (§22.9).
    if (a.flamethrower && o.results.some((r) => r.result === 'KIA')) destroyWeapons(ctx, s, o.hex, emit, 'flamethrower KIA (§22.9)');
  }
  for (const o of outcomes) applyHexResults(ctx, s, o, emit);
  // Out of fuel on a roll of 9 or more (§22.6).
  if (a.flamethrower && dr >= 9) {
    const c = a.contributions[0]!;
    const w = c.weapon ? s.weapons[c.weapon] : undefined;
    if (w) {
      const owner = w.owner ? s.units[w.owner] : undefined;
      if (owner) owner.weapons = owner.weapons.filter((x) => x !== w.id);
      delete s.weapons[w.id];
      emit({ kind: 'breakdown', text: `The flamethrower is out of fuel (roll ${dr} ≥ 9) and is removed (§22.6)`, side: w.side, hexes: [c.hex] });
    }
  }
}

/** Remove every support weapon in a hex (flamethrower or charge KIA, §22.9, §23.7). */
function destroyWeapons(ctx: Ctx, s: GameState, hex: HexKey, emit: Emit, why: string): void {
  const ws = Object.values(s.weapons).filter((w) => w.hex === hex && weaponType(ctx, w).kind !== 'DC');
  if (!ws.length) return;
  for (const w of ws) {
    const owner = w.owner ? s.units[w.owner] : undefined;
    if (owner) owner.weapons = owner.weapons.filter((x) => x !== w.id);
    delete s.weapons[w.id];
  }
  emit({ kind: 'info', text: `${ws.map((w) => weaponType(ctx, w).name).join(', ')} in ${hexLabel(ctx, hex)} destroyed: ${why}`, hexes: [hex] });
}

/** Set off an armed demolition charge in Advancing Fire: 30 FP on the IFT, terrain counts, no leadership (§23.4–23.8). */
export function detonate(ctx: Ctx, s: GameState, weaponId: string, emit: Emit): void {
  const c = s.charges.find((x) => x.weapon === weaponId);
  if (!c) throw new RuleError('No such charge');
  if (s.phase !== 'advancingFire' || s.awaiting !== c.side || s.phasing !== c.side) throw new RuleError('Charges go off in your Advancing Fire Phase', '§23.4');
  if (!c.armed) throw new RuleError('That charge was not set (its engineers broke or were lost)', '§23.3');
  const w = s.weapons[weaponId];
  const fp = w ? weaponType(ctx, w).fp : 30;
  const [d1, d2] = roll2d6(s);
  const dr = d1 + d2;
  const cols = ctx.data.tables.ift.columns;
  const colFor = (x: number) => {
    let col = -1;
    for (let i = 0; i < cols.length; i++) if (cols[i]! <= x + 1e-9) col = i;
    return col;
  };
  const tem = hexTem(ctx, c.target);
  const melee = inMelee(s, c.target);
  const victims = unitsIn(s, c.target).filter((u) => u.side !== c.side || melee);
  const hasAfv = Object.values(s.vehicles).some((v) => v.hex === c.target && v.side !== c.side);
  const trace = [`Demolition charge ${fp} FP on ${hexLabel(ctx, c.target)}; ${tem.drm ? `${tem.drm > 0 ? '+' : ''}${tem.drm} ${tem.label}` : 'no terrain modifier'}; no leadership (§23.5)`, `Dice ${d1}+${d2} = ${dr}`];
  s.charges = s.charges.filter((x) => x !== c);
  delete s.weapons[weaponId];
  if (dr >= 12) {
    emit({ kind: 'breakdown', text: `The charge on ${hexLabel(ctx, c.target)} fails to go off (roll 12, §23.8)`, trace, side: c.side, dice: [d1, d2], hexes: [c.target] });
    return;
  }
  if (hasAfv) chargeVsVehicles(ctx, s, c.target, c.side, c.from, dr, emit);
  const results = victims.map((u) => {
    const fin = dr + tem.drm;
    return { unit: u.id, result: iftLookup(ctx, colFor(u.concealed ? fp / 2 : fp), fin), finalDr: fin };
  });
  for (const r of results) trace.push(`${unitLabel(ctx, s.units[r.unit]!)}: ${dr} ${tem.drm >= 0 ? '+' : ''}${tem.drm} → ${r.finalDr}: ${resultText(r.result)}${s.units[r.unit]!.concealed ? ' (concealed: 15 FP)' : ''}`);
  const summary = [...new Set(results.map((r) => resultText(r.result)).filter((x) => x !== 'no effect'))];
  emit({
    kind: 'fire',
    text: `Demolition charge explodes in ${hexLabel(ctx, c.target)}: roll ${dr} → ${summary.length ? summary.join(', ') : 'no effect'}`,
    trace,
    side: c.side,
    dice: [d1, d2],
    from: c.from,
    to: c.target,
    hexes: [c.target],
    units: [],
    fx: { firerHexes: [c.from], targets: [c.target], kinds: ['DC'], results: results.map((r) => r.result), shooters: [{ hex: c.from, kind: 'DC', unit: c.placer }], outcomes: [{ hex: c.target, penetration: false, results: results.map((r) => ({ unit: r.unit, result: r.result })) }], column: fp },
  });
  if (results.some((r) => r.result !== '-')) reveal(ctx, s, c.target, emit, 'hit by a charge');
  if (results.some((r) => r.result === 'KIA')) destroyWeapons(ctx, s, c.target, emit, 'demolition charge KIA (§23.7)');
  if (ctx.map.hexes[c.target]?.sewer && !s.closedSewers.includes(c.target)) {
    s.closedSewers.push(c.target);
    emit({ kind: 'info', text: `The sewer entrance at ${hexLabel(ctx, c.target)} is blown shut (§27.6)`, hexes: [c.target] });
  }
  for (const r of results) if (r.result !== '-' && s.units[r.unit]) s.units[r.unit]!.dm = true;
  applyHexResults(ctx, s, { hex: c.target, results }, emit);
}

// ---- Odds preview ------------------------------------------------------------

/** Probability of each 2d6 total. */
export const DICE2: readonly { total: number; p: number }[] = Array.from({ length: 11 }, (_, i) => {
  const total = i + 2;
  return { total, p: (6 - Math.abs(total - 7)) / 36 };
});

export interface UnitOdds {
  readonly unit: string;
  readonly hex: HexKey;
  readonly kia: number;
  /** Chance of at least a morale check. */
  readonly mc: number;
  /** Chance the unit ends up broken or eliminated (rough: ignores leader-loss cascades). */
  readonly breakOrWorse: number;
  readonly drm: number;
}

export interface FireOdds {
  readonly units: readonly UnitOdds[];
  readonly breakdown: number;
}

export function fireOdds(ctx: Ctx, s: GameState, a: FireAnalysis): FireOdds {
  const units: UnitOdds[] = [];
  for (const t of a.targets) {
    for (const tu of t.units) {
      const u = s.units[tu.unit]!;
      const morale = u.broken ? (squadType(ctx, u)?.brokenMorale ?? 7) : (squadType(ctx, u)?.morale ?? leaderType(ctx, u)?.morale ?? 7);
      const ldrm = isLeader(ctx, u) ? 0 : bestOtherLeader(ctx, s, u);
      let kia = 0;
      let mc = 0;
      let worse = 0;
      const col = tu.area ? a.areaColumn : a.column;
      // Smoke adds one die after the roll (§24.6): average over it.
      const extra = a.smoke ? [1, 2, 3, 4, 5, 6].map((v) => ({ v, p: 1 / 6 })) : [{ v: 0, p: 1 }];
      const rolls = DICE2.flatMap((d) => extra.map((e) => ({ total: d.total + e.v, p: d.p * e.p })));
      for (const d of rolls) {
        const r = iftLookup(ctx, col, d.total + tu.drm);
        if (r === 'KIA') {
          kia += d.p;
          worse += d.p;
        } else if (r !== '-') {
          mc += d.p;
          const mod = r === 'M' ? 0 : (r as number);
          // P(2d6 + mod + ldrm > morale)
          const fail = DICE2.filter((x) => x.total + mod + ldrm > morale && !(x.total === 2 && u.berserk)).reduce((acc, x) => acc + x.p, 0);
          worse += d.p * (u.berserk ? 0 : fail);
        }
      }
      units.push({ unit: u.id, hex: t.hex, kia, mc: mc + kia, breakOrWorse: worse, drm: tu.drm });
    }
  }
  const minB = Math.min(99, ...a.breakdown.map((b) => b.number));
  const breakdown = DICE2.filter((d) => d.total >= minB).reduce((acc, d) => acc + d.p, 0);
  return { units, breakdown };
}

function bestOtherLeader(ctx: Ctx, s: GameState, u: Unit): number {
  let best = 0;
  for (const o of unitsIn(s, u.hex)) {
    if (o.side !== u.side || o.broken || o.id === u.id) continue;
    const lt = leaderType(ctx, o);
    if (lt && lt.leadership < best) best = lt.leadership;
  }
  return best;
}

/** Firepower a unit could bring right now (for UI hints). */
export function availableFire(ctx: Ctx, s: GameState, u: Unit): { inherent: boolean; weapons: string[] } {
  const st = squadType(ctx, u);
  return {
    inherent: !!st && !u.usedInherent,
    weapons: carried(s, u)
      .filter((w) => !w.malfunctioned && !w.usedThisTurn)
      .map((w) => w.id),
  };
}

export { portageOf };
