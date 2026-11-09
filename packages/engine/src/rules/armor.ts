/**
 * Armored fighting vehicles (§28–41): tanks and SP guns, their covered arc,
 * movement, main gun and MG fire, overruns, infantry anti-tank attacks,
 * malfunctions, immobilization, wrecks and crews. Numbers come from
 * content/rules/armor.json and vehicles.json.
 */
import { DIRECTIONS, directionTo, dirVector, hexKey, hexsideKey, hexToPixel, neighbor, parseHexKey, type Direction, type HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { losFrom } from '../ctx';
import type { VehicleType } from '../data';
import { d6, roll2d6 } from '../rng';
import { carried, enemiesIn, hexLabel, hexTem, isLeader, leaderDrmFor, leaderType, range, squadType, unitLabel, unitsIn, weaponType } from '../queries';
import { RuleError, type GameState, type Phase, type SideId, type Unit, type Vehicle } from '../types';
import type { Emit } from './common';
import { eliminate } from './common';
import { iftLookup, resultText, targetUnits } from './fire';
import { applyHexResults, moraleOf } from './morale';
import { canOperateSpecial, reveal, smokeAt, smokeOnLine } from './special';

export const FACING_NAMES = ['N-NE', 'NE-SE', 'SE-S', 'S-SW', 'SW-NW', 'NW-N'] as const;

export function facingIndex(name: string): number {
  const i = (FACING_NAMES as readonly string[]).indexOf(name);
  return i < 0 ? 0 : i;
}

export function vehicleType(ctx: Ctx, v: Vehicle): VehicleType {
  const t = ctx.data.vehicles[v.type];
  if (!t) throw new Error(`unknown vehicle type ${v.type}`);
  return t;
}

export function vehicleLabel(ctx: Ctx, v: Vehicle): string {
  return `${vehicleType(ctx, v).name}${v.name ? ` "${v.name}"` : ''}`;
}

export function vehiclesIn(s: GameState, hex: HexKey): Vehicle[] {
  return Object.values(s.vehicles).filter((v) => v.hex === hex);
}

export function enemyVehiclesIn(s: GameState, hex: HexKey, side: SideId): Vehicle[] {
  return vehiclesIn(s, hex).filter((v) => v.side !== side);
}

export function wrecksIn(s: GameState, hex: HexKey): number {
  return s.wrecks.filter((w) => w.hex === hex).length;
}

const isTank = (t: VehicleType) => t.turret;

// ---- Covered arc and target facing (§29.4, §33.5) ---------------------------------------

/** Is `to` inside the covered arc of a vehicle at `from` facing `facing`? The arc is the hex sector between the two front hexside rows. */
export function inArc(from: HexKey, facing: number, to: HexKey): boolean {
  if (from === to) return true;
  const a = parseHexKey(from);
  const b = parseHexKey(to);
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  const v1 = dirVector(facing as Direction);
  const v2 = dirVector(((facing + 1) % 6) as Direction);
  const det = v1.q * v2.r - v2.q * v1.r;
  const x = (dq * v2.r - v2.q * dr) / det;
  const y = (v1.q * dr - dq * v1.r) / det;
  return x >= -1e-9 && y >= -1e-9;
}

/** The facing whose arc holds `to` and is the smallest turn from `facing`. */
export function facingToward(from: HexKey, facing: number, to: HexKey): number {
  if (inArc(from, facing, to)) return facing;
  for (const step of [1, -1, 2, -2, 3]) {
    const f = (((facing + step) % 6) + 6) % 6;
    if (inArc(from, f, to)) return f;
  }
  return facing;
}

export type Aspect = 'front' | 'side' | 'rear';

/** Which armour a shot from `from` strikes: the target hexside the LOS crosses; along a spine, the one least favourable to the attacker (§33.5). */
export function hitAspect(target: Vehicle, from: HexKey): Aspect {
  if (from === target.hex) return 'side';
  const th = parseHexKey(target.hex);
  const c = hexToPixel(th);
  const f = hexToPixel(parseHexKey(from));
  const vx = f.x - c.x;
  const vy = f.y - c.y;
  const len = Math.hypot(vx, vy);
  const scores = DIRECTIONS.map((d) => {
    const n = hexToPixel(neighbor(th, d));
    const nx = n.x - c.x;
    const ny = n.y - c.y;
    return (nx * vx + ny * vy) / (Math.hypot(nx, ny) * len);
  });
  const best = Math.max(...scores);
  const rank = { front: 0, side: 1, rear: 2 } as const;
  let out: Aspect = 'rear';
  for (const d of DIRECTIONS) {
    if (scores[d]! < best - 1e-6) continue;
    const rel = (d - target.facing + 6) % 6;
    const a: Aspect = rel <= 1 ? 'front' : rel === 3 || rel === 4 ? 'rear' : 'side';
    if (rank[a] < rank[out]) out = a;
  }
  return out;
}

// ---- Movement (§29–30) --------------------------------------------------------------------

export interface MpCost {
  readonly mp: number;
  readonly parts: readonly string[];
  /** Entering woods or a wooden building: roll for breakdown (§39.1). */
  readonly risk: boolean;
}

export function mpLeft(ctx: Ctx, v: Vehicle): number {
  return vehicleType(ctx, v).mp - v.mpSpent;
}

/** MP for a vehicle to enter adjacent `to` (Vehicle Movement Costs, §30). Infinity if it cannot. */
export function vehicleStepCost(ctx: Ctx, s: GameState, v: Vehicle, to: HexKey): MpCost {
  const a = ctx.map.hexes[v.hex];
  const b = ctx.map.hexes[to];
  const m = ctx.data.armor.movement;
  if (!a || !b) return { mp: Infinity, parts: ['off the map'], risk: false };
  const d = directionTo(a.hex, b.hex);
  if (d === undefined) return { mp: Infinity, parts: ['not adjacent'], risk: false };
  const side = ctx.map.hexsides[hexsideKey(a.hex, d)];
  if (side?.cliff) return { mp: Infinity, parts: ['cliff hexside'], risk: false };
  if (b.terrain === 'water') return { mp: Infinity, parts: ['water'], risk: false };
  if (b.terrain === 'stoneBuilding') return { mp: Infinity, parts: ['stone building (§30.1)'], risk: false };
  const parts: string[] = [];
  const blockers = vehiclesIn(s, to).filter((x) => x.id !== v.id);
  const wrecks = wrecksIn(s, to);
  let mp: number;
  let risk = false;
  if (b.terrain === 'woods') {
    mp = m.woods!;
    risk = true;
    parts.push(`woods ${mp}`);
  } else if (b.terrain === 'woodBuilding') {
    mp = m.woodBuilding!;
    risk = true;
    parts.push(`wooden building ${mp}`);
  } else if (side?.road && !blockers.length && !wrecks) {
    mp = m.road!;
    parts.push('road ½');
  } else {
    mp = m.open!;
    parts.push(side?.road ? 'road blocked by a vehicle or wreck: open ground 1 (§40.3)' : 'open ground 1');
  }
  if (b.level > a.level) {
    mp += m.uphill!;
    parts.push(`+${m.uphill} higher ground`);
  }
  if (!v.moved && !inArc(v.hex, v.facing, to)) {
    mp += m.outsideArc!;
    parts.push(`+${m.outsideArc} turning outside the covered arc (§30.5)`);
  }
  for (const x of blockers) {
    const extra = x.side === v.side ? m.perVehicle! : m.enemyVehicle!;
    mp += extra;
    parts.push(`+${extra} past ${x.side === v.side ? 'a vehicle' : 'an enemy AFV (§30.7)'}`);
  }
  if (wrecks) {
    mp += wrecks * m.perVehicle!;
    parts.push(`+${wrecks * m.perVehicle!} wreck${wrecks > 1 ? 's' : ''} (§40.3)`);
  }
  if (smokeAt(s, to)) {
    mp += m.smoke!;
    parts.push(`+${m.smoke} smoke`);
  }
  return { mp, parts, risk };
}

function checkVehicleTurn(ctx: Ctx, s: GameState, v: Vehicle | undefined): asserts v is Vehicle {
  if (!v) throw new RuleError('No such vehicle');
  if (s.phase !== 'movement' || s.awaiting !== s.phasing || v.side !== s.phasing) throw new RuleError('Vehicles move in their own Movement Phase', '§30.4');
  if (v.immobilized) throw new RuleError(`${vehicleLabel(ctx, v)} is immobilized`, '§39');
  if (v.moveDone) throw new RuleError(`${vehicleLabel(ctx, v)} has finished moving`);
  if (v.firedPhase === 'prepFire') throw new RuleError('A vehicle that fired in Prep Fire cannot move', '§33.2');
}

/** Starting another vehicle or infantry stack finishes the one before (§19.4). */
function finishOthers(s: GameState, keep: string): void {
  for (const id of s.moving) if (s.units[id]) s.units[id]!.moveDone = true;
  s.moving = [];
  for (const o of Object.values(s.vehicles)) if (o.id !== keep && o.mpSpent > 0) o.moveDone = true;
}

export function vehicleMove(ctx: Ctx, s: GameState, id: string, to: HexKey, emit: Emit): void {
  const v = s.vehicles[id];
  checkVehicleTurn(ctx, s, v);
  const cost = vehicleStepCost(ctx, s, v, to);
  if (!Number.isFinite(cost.mp)) throw new RuleError(`${hexLabel(ctx, to)}: ${cost.parts.join(', ')}`, '§30');
  if (cost.mp > mpLeft(ctx, v) + 1e-9 && v.moved) throw new RuleError(`Needs ${cost.mp} MP, ${mpLeft(ctx, v)} left`, '§30.2');
  finishOthers(s, v.id);
  const from = v.hex;
  const d = directionTo(parseHexKey(from), parseHexKey(to))!;
  const firstHex = !v.moved;
  v.mpSpent += cost.mp;
  v.hex = to;
  v.moved = true;
  v.facing = facingToward(from, v.facing, to);
  // Facing after entering: the hex moved into stays in the covered arc, turned the least.
  if (!inArc(from, v.facing, to)) v.facing = d;
  (s.vtracks[v.id] ??= [from]).push(to);
  emit({
    kind: 'move',
    text: `${vehicleLabel(ctx, v)} ${hexLabel(ctx, from)} → ${hexLabel(ctx, to)} (${cost.parts.join(', ')}; ${v.mpSpent}/${vehicleType(ctx, v).mp} MP${firstHex && v.mpSpent > vehicleType(ctx, v).mp ? ', one hex always allowed (§30.3)' : ''})`,
    side: v.side,
    from,
    to,
    fx: { vehicles: [v.id] },
  });
  if (cost.risk) breakdownRoll(ctx, s, v, emit);
  if (!s.vehicles[v.id]) return;
  const foes = enemiesIn(s, to, v.side);
  if (foes.length && !v.overran) overrun(ctx, s, v, emit);
  if (s.vehicles[v.id] && mpLeft(ctx, s.vehicles[v.id]!) <= 0) s.vehicles[v.id]!.moveDone = true;
}

export function vehicleStop(ctx: Ctx, s: GameState, id: string): void {
  const v = s.vehicles[id];
  if (!v) throw new RuleError('No such vehicle');
  v.moveDone = true;
  void ctx;
}

/** Turn a vehicle: free at setup and after it entered a new hex; 2 MP in its starting hex (§30.5); SP guns may pivot in Defensive Fire (case I). */
export function faceVehicle(ctx: Ctx, s: GameState, id: string, facing: number, emit: Emit): void {
  const v = s.vehicles[id];
  if (!v) throw new RuleError('No such vehicle');
  if (!Number.isInteger(facing) || facing < 0 || facing > 5) throw new RuleError('Facing is 0–5');
  if (facing === v.facing) return;
  const t = vehicleType(ctx, v);
  if (s.phase === 'setup') {
    if (v.side !== s.awaiting) throw new RuleError('Not your vehicle');
    v.facing = facing;
    return;
  }
  if (v.immobilized) throw new RuleError(`${vehicleLabel(ctx, v)} is immobilized and cannot pivot`, '§39.4');
  if (s.phase === 'defensiveFire' && v.side === s.awaiting && v.side !== s.phasing && !t.turret) {
    v.facing = facing;
    v.dfPivot = true;
    emit({ kind: 'info', text: `${vehicleLabel(ctx, v)} pivots to ${FACING_NAMES[facing]} (+4 to hit this phase, case I)`, side: v.side, hexes: [v.hex] });
    return;
  }
  checkVehicleTurn(ctx, s, v);
  if (!v.moved) {
    const m = ctx.data.armor.movement.outsideArc!;
    if (mpLeft(ctx, v) < m) throw new RuleError(`Pivoting costs ${m} MP`, '§30.5');
    finishOthers(s, v.id);
    v.mpSpent += m;
    v.pivoted = true;
    (s.vtracks[v.id] ??= [v.hex]);
  }
  v.facing = facing;
  emit({ kind: 'info', text: `${vehicleLabel(ctx, v)} turns to face ${FACING_NAMES[facing]}${v.moved ? '' : ` (${ctx.data.armor.movement.outsideArc} MP)`}`, side: v.side, hexes: [v.hex], fx: { vehicles: [v.id] } });
}

/** Entering woods or a wooden building: German AFVs break down on 5–6, others on 6 (§39.1). */
function breakdownRoll(ctx: Ctx, s: GameState, v: Vehicle, emit: Emit): void {
  const t = vehicleType(ctx, v);
  const at = ctx.data.armor.immobilize[t.nation] ?? 6;
  const r = d6(s);
  if (r >= at) {
    emit({ kind: 'breakdown', text: `${vehicleLabel(ctx, v)} throws a track in ${hexLabel(ctx, v.hex)} (rolled ${r} ≥ ${at}, §39.1)`, side: v.side, dice: [r], hexes: [v.hex] });
    immobilize(ctx, s, v, emit);
  }
}

/** The vehicle cannot move; its crew must pass a morale check or bail out (§39.2). */
export function immobilize(ctx: Ctx, s: GameState, v: Vehicle, emit: Emit): void {
  v.immobilized = true;
  v.moveDone = true;
  crewCheck(ctx, s, v, 'immobilized', emit);
}

/** Crew morale check: on a failure the crew abandons the AFV, which becomes a wreck (§39.2–39.3). */
export function crewCheck(ctx: Ctx, s: GameState, v: Vehicle, why: string, emit: Emit): void {
  const t = vehicleType(ctx, v);
  const crew = ctx.data.units[t.crew];
  const morale = crew && crew.kind !== 'leader' ? crew.morale : 7;
  const [a, b] = roll2d6(s);
  const pass = a + b <= morale;
  emit({
    kind: 'morale',
    text: `${vehicleLabel(ctx, v)} crew (${why}) morale check: ${a}+${b} = ${a + b} vs ${morale}: ${pass ? 'they stay with the vehicle' : 'they bail out'} (§39.2)`,
    side: v.side,
    dice: [a, b],
    hexes: [v.hex],
    fx: { result: pass ? 'pass' : 'failed' },
  });
  if (!pass) destroyVehicle(ctx, s, v, 'abandoned by its crew', emit, 'abandon');
}

/** Replace the vehicle with a wreck; the crew may survive (§33.9, §40.1). */
export function destroyVehicle(ctx: Ctx, s: GameState, v: Vehicle, reason: string, emit: Emit, crew: 'roll' | 'abandon' | 'none'): void {
  const t = vehicleType(ctx, v);
  delete s.vehicles[v.id];
  delete s.vtracks[v.id];
  s.wrecks.push({ hex: v.hex, type: v.type, side: v.side });
  s.afvAssaults = s.afvAssaults.filter((x) => x.vehicle !== v.id);
  const loss = (s.losses[v.side] ??= { squads: 0, leaders: 0 });
  loss.vehicles = (loss.vehicles ?? 0) + 1;
  emit({ kind: 'eliminated', text: `${vehicleLabel(ctx, v)} in ${hexLabel(ctx, v.hex)} ${crew === 'abandon' ? 'is abandoned' : 'is destroyed'}: ${reason}`, side: v.side, hexes: [v.hex], fx: { vehicle: v.id, wreck: true } });
  let survive = crew === 'abandon';
  if (crew === 'roll') {
    const [a, b] = roll2d6(s);
    survive = a + b <= t.survival;
    emit({ kind: 'info', text: `Crew survival: ${a}+${b} = ${a + b} vs ${t.survival}: ${survive ? 'the crew bails out' : 'no survivors'} (§33.9)`, side: v.side, dice: [a, b], hexes: [v.hex] });
  }
  if (!survive || !ctx.data.units[t.crew]) return;
  const id = `${v.id}c`;
  s.units[id] = {
    id,
    type: t.crew,
    side: v.side,
    hex: v.hex,
    broken: false,
    berserk: false,
    weapons: [],
    firedPhase: s.phase,
    usedInherent: true,
    moved: true,
    mfSpent: 0,
    ppUsed: 0,
    withLeader: null,
    moveDone: true,
    directed: false,
    dm: false,
    rallyTried: false,
    routed: false,
    advanced: false,
    concealed: false,
    noConceal: true,
    smokeMade: false,
    sewerAssault: false,
  };
  // Treated as moving in the open for the rest of the phase (§33.9).
  if (s.phase === 'defensiveFire') s.tracks[id] = [{ hex: v.hex, mf: 0, open: true }];
}

/** 16 FP on the IFT as the AFV enters the first enemy-held hex of its move; terrain counts, no −2 (§35). */
function overrun(ctx: Ctx, s: GameState, v: Vehicle, emit: Emit): void {
  const t = vehicleType(ctx, v);
  v.overran = true;
  const lost = (v.gun !== 'ok' ? 1 : 0) + (v.mg !== 'ok' || t.mgCA + t.mg360 === 0 ? 1 : 0);
  if (lost >= 2 && t.gun) return;
  const base = ctx.data.armor.overrun.tank ?? 16;
  const fp = lost ? base / 2 : base;
  const [d1, d2] = roll2d6(s);
  const dr = d1 + d2;
  const col = iftColumn(ctx, fp);
  const tem = hexTem(ctx, v.hex);
  const victims = enemiesIn(s, v.hex, v.side);
  const results = victims.map((u) => {
    const fin = dr + tem.drm;
    return { unit: u.id, result: iftLookup(ctx, iftColumn(ctx, u.concealed ? fp / 2 : fp), fin), finalDr: fin };
  });
  const trace = [`Overrun: ${fp} FP${lost ? ' (halved: a weapon is out, §35.3)' : ''}; ${tem.drm ? `${tem.drm > 0 ? '+' : ''}${tem.drm} ${tem.label}` : 'no terrain modifier'} (§35.4)`, `Dice ${d1}+${d2} = ${dr}`];
  for (const r of results) trace.push(`${unitLabel(ctx, s.units[r.unit]!)}: → ${r.finalDr}: ${resultText(r.result)}`);
  emit({
    kind: 'fire',
    text: `${vehicleLabel(ctx, v)} overruns ${hexLabel(ctx, v.hex)}: roll ${dr} → ${[...new Set(results.map((r) => resultText(r.result)))].join(', ') || 'no effect'}`,
    trace,
    side: v.side,
    dice: [d1, d2],
    from: v.hex,
    to: v.hex,
    hexes: [v.hex],
    fx: { firerHexes: [v.hex], targets: [v.hex], kinds: ['OVR'], shooters: [{ hex: v.hex, kind: 'OVR', unit: v.id }], outcomes: [{ hex: v.hex, penetration: false, results: results.map((r) => ({ unit: r.unit, result: r.result })) }], column: col },
  });
  void col;
  if (results.some((r) => r.result !== '-')) reveal(ctx, s, v.hex, emit, 'overrun');
  for (const r of results) if (r.result !== '-' && s.units[r.unit]) s.units[r.unit]!.dm = true;
  applyHexResults(ctx, s, { hex: v.hex, results }, emit);
  if (dr === 12) {
    emit({ kind: 'breakdown', text: `A grenade bundle under the tracks: ${vehicleLabel(ctx, v)} is immobilized (overrun roll 12, §38.3)`, side: v.side, hexes: [v.hex] });
    immobilize(ctx, s, v, emit);
  }
}

/** After Defensive Fire, enemy infantry sharing a hex with an AFV that ended its move there leave for an adjacent hex, or are eliminated (§35.8). */
export function displaceOverrun(ctx: Ctx, s: GameState, emit: Emit): void {
  for (const v of Object.values(s.vehicles)) {
    if (v.side !== s.phasing) continue;
    const foes = enemiesIn(s, v.hex, v.side);
    if (!foes.length) continue;
    const side = foes[0]!.side;
    const options = DIRECTIONS.map((d) => hexKey(neighbor(parseHexKey(v.hex), d)))
      .filter((h) => {
        const mh = ctx.map.hexes[h];
        if (!mh || mh.terrain === 'water') return false;
        const cliff = ctx.map.hexsides[hexsideKey(parseHexKey(v.hex), directionTo(parseHexKey(v.hex), parseHexKey(h))!)]?.cliff;
        return !cliff && !enemiesIn(s, h, side).length && !enemyVehiclesIn(s, h, side).length && unitsIn(s, h).filter((u) => u.side === side).length + foes.length <= ctx.data.tables.stacking.units;
      })
      .sort((a, b) => hexTem(ctx, b).drm - hexTem(ctx, a).drm || a.localeCompare(b));
    const to = options[0];
    for (const u of foes) {
      if (!to) {
        eliminate(ctx, s, u, 'overrun with nowhere to go (§35.8)', emit);
        continue;
      }
      u.hex = to;
      for (const w of carried(s, u)) w.hex = to;
    }
    if (to) emit({ kind: 'rout', text: `${foes.map((u) => unitLabel(ctx, u)).join(', ')} pull back from under ${vehicleLabel(ctx, v)} to ${hexLabel(ctx, to)} (§35.8)`, side, units: foes.map((u) => u.id), from: v.hex, to, hexes: [v.hex, to] });
  }
}

// ---- AFV fire (§33–34) -------------------------------------------------------------------

export function iftColumn(ctx: Ctx, fp: number): number {
  const cols = ctx.data.tables.ift.columns;
  let col = -1;
  for (let i = 0; i < cols.length; i++) if (cols[i]! <= fp + 1e-9) col = i;
  return col;
}

/** Infantry firepower of a gun hit: its calibre rounded down to the IFT's red numbers (§34.2). */
export function heEquivalent(ctx: Ctx, mm: number): number {
  let fp = 0;
  for (const [cal, f] of ctx.data.armor.heEquivalent) if (cal <= mm) fp = f;
  return fp;
}

export function killColumn(mm: number, ammo: 'AP' | 'HE'): string {
  if (ammo === 'AP') return mm <= 40 ? 'AP37' : mm <= 60 ? 'AP50' : 'AP75';
  return mm <= 40 ? 'HE37' : mm <= 60 ? 'HE50' : mm <= 90 ? 'HE75' : mm <= 110 ? 'HE105' : mm <= 130 ? 'HE120' : 'HE150';
}

export function killNumber(ctx: Ctx, column: string, aspect: Aspect): number {
  const k = ctx.data.armor.kill;
  const i = k.columns.indexOf(column);
  return i < 0 ? -99 : k[aspect][i]!;
}

/** Probability that 2d6 + drm ≤ n. */
export function chance2d6(n: number, drm = 0): number {
  let p = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b + drm <= n) p++;
  return p / 36;
}

/** To Hit chance with the unmodified-2 rule (§33.32): a 2 can still hit with a third die. */
export function hitChance(hitNumber: number, drm: number): number {
  let p = 0;
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) {
      if (a + b + drm <= hitNumber) p += 1;
      else if (a + b === 2) {
        const need = hitNumber - drm;
        const add = Math.max(0, 2 - need);
        for (let c = 1; c <= 6; c++) if (c + add < 6) p += 1 / 6;
      }
    }
  return p / 36;
}

export interface VehicleFireAnalysis {
  readonly vehicle: string;
  readonly side: SideId;
  readonly target: HexKey;
  readonly weapon: 'main' | 'mg';
  readonly range: number;
  readonly trace: string[];
  /** Fire crosses smoke: +1d6 to the To Hit (gun) or IFT (MG) roll (§24.6). */
  readonly smoke: boolean;
  /** Main gun: the hit number and its modifiers. */
  readonly hitNumber?: number;
  readonly hitDrm?: number;
  readonly targetType?: string;
  /** Main gun against a vehicle. */
  readonly vs?: string;
  readonly ammo?: 'AP' | 'HE';
  readonly aspect?: Aspect;
  readonly kill?: number;
  readonly killDrm?: number;
  readonly killColumn?: string;
  /** Against infantry: firepower and per-unit dice modifiers. */
  readonly fp?: number;
  readonly units?: readonly { unit: string; drm: number; area?: boolean; notes: readonly string[] }[];
  /** MGs used. */
  readonly mgs?: readonly ('ca' | 'aa')[];
  /** New facing after turning the turret or pivoting toward the target. */
  readonly turnTo?: number;
}

function firingSideOk(s: GameState, v: Vehicle): boolean {
  if (s.phase === 'prepFire' || s.phase === 'advancingFire') return v.side === s.phasing && s.awaiting === v.side;
  if (s.phase === 'defensiveFire') return v.side !== s.phasing && s.awaiting === v.side;
  return false;
}

/** Target type row of the To Hit Table (§33.3). */
function hitRow(ctx: Ctx, s: GameState, firer: HexKey, target: HexKey, vehicle: boolean): { row: string; label: string } {
  const h = ctx.map.hexes[target]!;
  if (vehicle) {
    const los = losFrom(ctx, firer, target);
    const prev = los.hexes.length >= 3 ? los.hexes[los.hexes.length - 2]!.key : undefined;
    const behindWreck = prev && prev !== firer && (wrecksIn(s, prev) > 0 || (vehiclesIn(s, prev).length > 0 && !(s.phase === 'defensiveFire' && vehiclesIn(s, prev).every((x) => x.moved))));
    if (los.targetHexside?.wall || behindWreck) return { row: 'vehicleHullDown', label: `vehicle hull down (${los.targetHexside?.wall ? 'behind a wall' : 'behind a wreck or vehicle'}, §41.1)` };
    if (h.terrain === 'woods' || h.terrain === 'woodBuilding') return { row: 'vehicleCover', label: 'vehicle in woods or a building' };
    return { row: 'vehicleOther', label: 'vehicle in other terrain' };
  }
  if (h.terrain === 'woodBuilding' || h.terrain === 'stoneBuilding' || h.shellhole) return { row: 'infantryBuilding', label: 'infantry in a building or shellholes' };
  if (h.terrain === 'woods') return { row: 'infantryWoods', label: 'infantry in woods' };
  return { row: 'infantryOther', label: 'infantry in other terrain' };
}

export interface VehicleFireRequest {
  readonly vehicle: string;
  readonly target: HexKey;
  readonly weapon: 'main' | 'mg';
  readonly vs?: string | undefined;
  readonly ammo?: 'AP' | 'HE' | undefined;
  readonly mgs?: readonly ('ca' | 'aa')[] | undefined;
}

export function analyzeVehicleFire(ctx: Ctx, s: GameState, req: VehicleFireRequest): VehicleFireAnalysis {
  const v = s.vehicles[req.vehicle];
  if (!v) throw new RuleError('No such vehicle');
  const t = vehicleType(ctx, v);
  if (!firingSideOk(s, v)) throw new RuleError(`${vehicleLabel(ctx, v)} cannot fire now`, '§4');
  if (v.firedPhase && v.firedPhase !== s.phase) throw new RuleError('All of a vehicle’s fire comes in one phase', '§33.2');
  if (v.overran) throw new RuleError('An AFV that overran may not fire this player turn', '§35.9');
  if (!ctx.map.hexes[req.target]) throw new RuleError('Not on the map');
  const r = range(v.hex, req.target);
  if (r > 0 && !ctx.los(v.hex, req.target).clear) throw new RuleError(`No line of sight: ${ctx.los(v.hex, req.target).reason}`, '§7');
  const smoke = r > 0 && smokeOnLine(ctx, s, v.hex, req.target);
  const trace: string[] = [];
  const dfMoving = (hex: HexKey) => s.phase === 'defensiveFire' && Object.entries(s.tracks).some(([id, steps]) => s.units[id] && s.units[id]!.side !== v.side && steps.some((st) => st.hex === hex));
  const infantryHere = () => {
    const there = targetUnits(ctx, s, v.side, req.target, [v.hex], 0, false, false);
    if (!there.units.some((x) => s.units[x.unit]?.side !== v.side)) throw new RuleError('No enemy infantry there (pick a vehicle to shoot at instead)');
    return there.units;
  };
  if (req.weapon === 'main') {
    if (!t.gun) throw new RuleError(`${t.name} has no main gun`);
    if (v.gun !== 'ok') throw new RuleError(`The main gun is ${v.gun}`, '§38.1');
    if (v.mainShots >= (t.rof ?? 1)) throw new RuleError('The main gun has fired this player turn', '§33.2');
    const drms: { n: number; why: string }[] = [];
    const D = ctx.data.armor.toHit.drm;
    let turnTo: number | undefined;
    if (!inArc(v.hex, v.facing, req.target)) {
      if (t.turret) {
        drms.push({ n: D.outsideArc!, why: 'turret turned outside the covered arc (case D)' });
        if (!v.immobilized) turnTo = facingToward(v.hex, v.facing, req.target);
      } else if (s.phase === 'defensiveFire' && !v.immobilized) {
        drms.push({ n: D.spgDefensivePivot!, why: 'SP gun pivots in Defensive Fire (case I)' });
        turnTo = facingToward(v.hex, v.facing, req.target);
      } else throw new RuleError('An SP gun fires only within its covered arc (pivot in Movement first)', '§33.31');
    } else if (v.dfPivot && !t.turret) drms.push({ n: D.spgDefensivePivot!, why: 'SP gun pivoted this Defensive Fire (case I)' });
    if (s.phase === 'advancingFire') {
      if (v.moved) {
        if (!t.turret) throw new RuleError('An SP gun cannot fire its main gun in a player turn it moved to a new hex', '§33.31');
        drms.push({ n: D.tankMoved!, why: 'fired after moving (case F)' });
      } else if (v.pivoted) drms.push(t.turret ? { n: D.tankPivot!, why: 'fired after pivoting (case E)' } : { n: D.spgPivot!, why: 'SP gun fired after pivoting (case G)' });
    }
    if (t.lowVelocity && r > 12) drms.push({ n: D.lowVelocity12!, why: 'low-velocity gun beyond 12 hexes (case C)' });
    else if (t.lowVelocity && r > 6) drms.push({ n: D.lowVelocity6!, why: 'low-velocity gun beyond 6 hexes (case B)' });
    if (r === 1) drms.push({ n: D.adjacent!, why: 'adjacent target (case J)' });
    if (r === 0) drms.push({ n: D.sameHex!, why: 'target in the same hex (case K)' });
    const russian = t.nation === 'russian' ? 1 : 0;
    const bands = ctx.data.armor.toHit.bands;
    let band = bands.findIndex((b) => r <= b);
    if (band < 0) band = bands.length;
    if (req.vs) {
      const tv = s.vehicles[req.vs];
      if (!tv || tv.hex !== req.target || tv.side === v.side) throw new RuleError('No such enemy vehicle there');
      const tt = vehicleType(ctx, tv);
      if (s.phase === 'defensiveFire' && tv.moved) drms.push({ n: D.moving!, why: 'moving target (case A)' });
      const ammo = t.heOnly ? 'HE' : (req.ammo ?? 'AP');
      if (t.heOnly && req.ammo === 'AP') throw new RuleError(`${t.name} fires HE only`, '§33.6');
      const row = hitRow(ctx, s, v.hex, req.target, true);
      const hitNumber = ctx.data.armor.toHit.rows[row.row]![band]![russian]!;
      const hitDrm = drms.reduce((a, x) => a + x.n, 0);
      const aspect = hitAspect(tv, v.hex);
      const col = killColumn(t.gun, ammo);
      const kill = killNumber(ctx, col, aspect);
      trace.push(`${t.name} ${t.gun}mm ${ammo} at ${vehicleLabel(ctx, tv)}, range ${r}: ${row.label}, To Hit ${hitNumber}${russian ? ' (red, Russian)' : ''} (§33.3)`);
      for (const x of drms) trace.push(`${x.n > 0 ? '+' : ''}${x.n} ${x.why}`);
      if (smoke) trace.push('+1d6 smoke on the line of fire (§24.6)');
      trace.push(`If hit: ${aspect} armour, ${col} kills on ${kill}, ${tt.armor ? `${tt.armor > 0 ? '+' : ''}${tt.armor} to the roll for its armour (§33.41)` : 'no armour modifier'}`);
      return { vehicle: v.id, side: v.side, target: req.target, weapon: 'main', range: r, trace, smoke, hitNumber, hitDrm, targetType: row.row, vs: tv.id, ammo, aspect, kill, killDrm: tt.armor, killColumn: col, ...(turnTo !== undefined ? { turnTo } : {}) };
    }
    const units = infantryHere();
    const enemies = units.filter((x) => s.units[x.unit]?.side !== v.side);
    if (dfMoving(req.target)) drms.push({ n: D.moving!, why: 'moving target (case A)' });
    if (enemies.every((x) => s.units[x.unit]?.concealed)) drms.push({ n: D.concealed!, why: 'concealed target (case H)' });
    const row = hitRow(ctx, s, v.hex, req.target, false);
    const hitNumber = ctx.data.armor.toHit.rows[row.row]![band]![russian]!;
    const hitDrm = drms.reduce((a, x) => a + x.n, 0);
    let fp = heEquivalent(ctx, t.gun);
    trace.push(`${t.name} ${t.gun}mm HE at infantry, range ${r}: ${row.label}, To Hit ${hitNumber}${russian ? ' (red, Russian)' : ''} (§33.3, §34.2)`);
    for (const x of drms) trace.push(`${x.n > 0 ? '+' : ''}${x.n} ${x.why}`);
    if (smoke) trace.push('+1d6 smoke on the line of fire (§24.6)');
    if (r <= 1) {
      fp *= 2;
      trace.push(`If hit: ${fp} FP on the IFT (point blank ×2, §34.5)`);
    } else trace.push(`If hit: ${fp} FP on the IFT (§34.2)`);
    return { vehicle: v.id, side: v.side, target: req.target, weapon: 'main', range: r, trace, smoke, hitNumber, hitDrm, targetType: row.row, ammo: 'HE', fp, units, ...(turnTo !== undefined ? { turnTo } : {}) };
  }
  // MGs (§28.4, §34.3, §34.7).
  if (v.mg !== 'ok') throw new RuleError(`The MGs are ${v.mg}`, '§38.2');
  const want = req.mgs ?? ['ca', 'aa'];
  const used: ('ca' | 'aa')[] = [];
  let fp = 0;
  const notes: string[] = [];
  if (want.includes('ca') && t.mgCA > 0 && !v.mgCaUsed && inArc(v.hex, v.facing, req.target) && (!v.mainTarget || v.mainTarget === req.target)) {
    const half = v.moved || v.pivoted;
    fp += half ? t.mgCA / 2 : t.mgCA;
    used.push('ca');
    notes.push(`covered-arc MG ${t.mgCA}${half ? ' halved: moved or pivoted (§34.7)' : ''}`);
  }
  if (want.includes('aa') && t.mg360 > 0 && !v.mg360Used) {
    fp += v.moved ? t.mg360 / 2 : t.mg360;
    used.push('aa');
    notes.push(`all-round MG ${t.mg360}${v.moved ? ' halved: moved (§34.7)' : ''}; the crew is exposed (CE, §34.8)`);
  }
  if (!used.length) throw new RuleError('No MG can fire at that hex (arc, already fired, or none fitted)', '§28.4');
  const mr = ctx.data.armor.mgRange;
  if (r > mr * 2) throw new RuleError(`Beyond MG range (${mr}, long range ${mr * 2})`, '§28.4');
  if (r > mr) {
    fp /= 2;
    notes.push('halved at long range (§9.2)');
  }
  if (r <= 1) {
    fp *= 2;
    notes.push('doubled point blank (§9.1)');
  }
  const units = infantryHere();
  trace.push(`${t.name} MGs: ${notes.join('; ')} → ${fp} FP`);
  if (smoke) trace.push('+1d6 smoke on the line of fire (§24.6)');
  return { vehicle: v.id, side: v.side, target: req.target, weapon: 'mg', range: r, trace, smoke, fp, units, mgs: used };
}

export interface VehicleFireOdds {
  readonly hit: number;
  readonly kill?: number;
  /** Infantry: chance each unit is broken or worse (rough). */
  readonly units?: readonly { unit: string; breakOrWorse: number; kia: number }[];
  readonly malfunction: number;
}

/** Chances for the analysis (smoke ignored). */
export function vehicleFireOdds(ctx: Ctx, s: GameState, a: VehicleFireAnalysis): VehicleFireOdds {
  const hit = a.weapon === 'main' ? hitChance(a.hitNumber!, a.hitDrm!) : 1;
  const malfunction = 1 / 36;
  if (a.vs) return { hit, kill: hit * chance2d6(a.kill!, a.killDrm!), malfunction };
  const units = (a.units ?? [])
    .filter((x) => s.units[x.unit]?.side !== a.side)
    .map((x) => {
      const col = iftColumn(ctx, x.area ? a.fp! / 2 : a.fp!);
      let kia = 0;
      let brk = 0;
      const u = s.units[x.unit]!;
      const morale = moraleOf(ctx, u);
      for (let d1 = 1; d1 <= 6; d1++)
        for (let d2 = 1; d2 <= 6; d2++) {
          const res = iftLookup(ctx, col, d1 + d2 + x.drm);
          if (res === 'KIA') kia++;
          else if (res !== '-') {
            const mc = res === 'M' ? 0 : res;
            brk += 1 - chance2d6(morale, mc);
          }
        }
      return { unit: x.unit, kia: (hit * kia) / 36, breakOrWorse: (hit * (kia + brk)) / 36 };
    });
  return { hit, units, malfunction };
}

export function resolveVehicleFire(ctx: Ctx, s: GameState, req: VehicleFireRequest, emit: Emit): void {
  const a = analyzeVehicleFire(ctx, s, req);
  const v = s.vehicles[req.vehicle]!;
  const t = vehicleType(ctx, v);
  v.firedPhase ??= s.phase;
  if (a.turnTo !== undefined) v.facing = a.turnTo;
  const trace = [...a.trace];
  const shooter = { hex: v.hex, kind: a.weapon === 'main' ? 'GUN' : 'VMG', unit: v.id };
  if (a.weapon === 'main') {
    v.mainShots++;
    v.mainTarget = req.target;
    const [d1, d2] = roll2d6(s);
    const smokeDie = a.smoke ? d6(s) : 0;
    const raw = d1 + d2;
    const fin = raw + a.hitDrm! + smokeDie;
    let hit = fin <= a.hitNumber!;
    const dice = [d1, d2];
    trace.push(`To Hit: ${d1}+${d2}${a.hitDrm ? ` ${a.hitDrm > 0 ? '+' : ''}${a.hitDrm}` : ''}${smokeDie ? ` +${smokeDie} smoke` : ''} = ${fin} vs ${a.hitNumber}: ${hit ? 'hit' : 'miss'}`);
    if (!hit && raw === 2) {
      const add = Math.max(0, 2 - (a.hitNumber! - a.hitDrm! - smokeDie));
      const c = d6(s);
      dice.push(c);
      hit = c + add < 6;
      trace.push(`Unmodified 2: third die ${c}${add ? ` +${add}` : ''} ${hit ? '< 6: hit' : '≥ 6: miss'} (§33.32)`);
    }
    const outcomes: { hex: HexKey; penetration: boolean; results: { unit: string; result: string | number }[] }[] = [];
    let text: string;
    if (!hit) text = `${vehicleLabel(ctx, v)} fires at ${hexLabel(ctx, req.target)} and misses (${fin} vs ${a.hitNumber})`;
    else if (a.vs) {
      const tv = s.vehicles[a.vs]!;
      const [k1, k2] = roll2d6(s);
      dice.push(k1, k2);
      const kf = k1 + k2 + a.killDrm!;
      const kill = kf <= a.kill!;
      trace.push(`Kill: ${k1}+${k2}${a.killDrm ? ` ${a.killDrm > 0 ? '+' : ''}${a.killDrm}` : ''} = ${kf} vs ${a.kill} (${a.aspect}, ${a.killColumn}): ${kill ? 'destroyed' : 'no penetration'} (§33.4)`);
      text = `${vehicleLabel(ctx, v)} hits ${vehicleLabel(ctx, tv)} (${a.aspect}): ${kill ? 'knocked out' : 'the shell does not penetrate'}`;
      outcomes.push({ hex: req.target, penetration: false, results: [{ unit: tv.id, result: kill ? 'KIA' : '-' }] });
      emit({ kind: 'fire', text, trace, side: v.side, dice, from: v.hex, to: req.target, hexes: [req.target], fx: { firerHexes: [v.hex], targets: [req.target], kinds: ['GUN'], shooters: [shooter], outcomes, hit, kill, vs: tv.id } });
      if (kill) destroyVehicle(ctx, s, tv, `${t.gun}mm ${a.ammo} from ${vehicleLabel(ctx, v)}`, emit, 'roll');
      else if (tv.immobilized) crewCheck(ctx, s, tv, 'hit while immobilized', emit);
      afterMain(ctx, s, v, raw, emit);
      return;
    } else {
      const [i1, i2] = roll2d6(s);
      dice.push(i1, i2);
      const res = infantryResults(ctx, s, a, i1 + i2, 0, trace);
      text = `${vehicleLabel(ctx, v)} hits ${hexLabel(ctx, req.target)} with ${a.fp} FP of HE: roll ${i1 + i2} → ${summary(res)}`;
      outcomes.push({ hex: req.target, penetration: false, results: res.map((r) => ({ unit: r.unit, result: r.result })) });
      emit({ kind: 'fire', text, trace, side: v.side, dice, from: v.hex, to: req.target, hexes: [req.target], units: [], fx: { firerHexes: [v.hex], targets: [req.target], kinds: ['GUN'], shooters: [shooter], outcomes, hit } });
      applyInfantry(ctx, s, req.target, res, emit);
      afterMain(ctx, s, v, raw, emit);
      return;
    }
    emit({ kind: 'fire', text, trace, side: v.side, dice, from: v.hex, to: req.target, hexes: [req.target], fx: { firerHexes: [v.hex], targets: [req.target], kinds: ['GUN'], shooters: [shooter], outcomes: [{ hex: req.target, penetration: false, results: [] }], hit: false } });
    afterMain(ctx, s, v, raw, emit);
    return;
  }
  // MG attack.
  if (a.mgs!.includes('ca')) v.mgCaUsed = true;
  if (a.mgs!.includes('aa')) {
    v.mg360Used = true;
    v.ce = true;
  }
  const [d1, d2] = roll2d6(s);
  const smokeDie = a.smoke ? d6(s) : 0;
  trace.push(`Dice ${d1}+${d2}${smokeDie ? ` +${smokeDie} smoke` : ''}`);
  const res = infantryResults(ctx, s, a, d1 + d2, smokeDie, trace);
  emit({
    kind: 'fire',
    text: `${vehicleLabel(ctx, v)} MGs fire ${a.fp} FP at ${hexLabel(ctx, req.target)}: roll ${d1 + d2} → ${summary(res)}`,
    trace,
    side: v.side,
    dice: [d1, d2],
    from: v.hex,
    to: req.target,
    hexes: [req.target],
    fx: { firerHexes: [v.hex], targets: [req.target], kinds: ['MMG'], shooters: [{ ...shooter, kind: 'MMG' }], outcomes: [{ hex: req.target, penetration: false, results: res.map((r) => ({ unit: r.unit, result: r.result })) }] },
  });
  applyInfantry(ctx, s, req.target, res, emit);
  if (d1 + d2 === 12) {
    v.mg = 'malfunctioned';
    emit({ kind: 'breakdown', text: `${vehicleLabel(ctx, v)}: MGs malfunction (rolled 12, §38.2)`, side: v.side, hexes: [v.hex] });
  }
}

function afterMain(ctx: Ctx, s: GameState, v: Vehicle, raw: number, emit: Emit): void {
  if (raw === 12 && s.vehicles[v.id]) {
    v.gun = 'malfunctioned';
    emit({ kind: 'breakdown', text: `${vehicleLabel(ctx, v)}: main gun malfunctions (rolled 12, §38.1)`, side: v.side, hexes: [v.hex] });
  }
}

type Res = { unit: string; result: ReturnType<typeof iftLookup>; finalDr: number };

function infantryResults(ctx: Ctx, s: GameState, a: VehicleFireAnalysis, dr: number, extra: number, trace: string[]): Res[] {
  const out: Res[] = [];
  for (const x of a.units ?? []) {
    const u = s.units[x.unit];
    if (!u || u.side === a.side) continue;
    const fp = x.area ? a.fp! / 2 : a.fp!;
    const fin = dr + extra + x.drm;
    const result = iftLookup(ctx, iftColumn(ctx, fp), fin);
    out.push({ unit: x.unit, result, finalDr: fin });
    trace.push(`${unitLabel(ctx, u)}: ${x.notes.join(', ') || 'no modifiers'}${x.area ? '; concealed: area fire, half FP (§25.8)' : ''} → ${fin}: ${resultText(result)}`);
  }
  return out;
}

function summary(res: readonly Res[]): string {
  const xs = [...new Set(res.map((r) => resultText(r.result)).filter((x) => x !== 'no effect'))];
  return xs.length ? xs.join(', ') : 'no effect';
}

function applyInfantry(ctx: Ctx, s: GameState, hex: HexKey, res: Res[], emit: Emit): void {
  if (res.some((r) => r.result !== '-')) reveal(ctx, s, hex, emit, 'fired on');
  for (const r of res) if (r.result !== '-' && s.units[r.unit]) s.units[r.unit]!.dm = true;
  applyHexResults(ctx, s, { hex, results: res }, emit);
}

// ---- Infantry against AFVs (§36–37) --------------------------------------------------------

/** The number a Defensive Fire immobilization attempt must roll at or under (§36.12). */
export function immobilizeNumber(ctx: Ctx, hex: HexKey, leaderAlone: boolean): number {
  const t = ctx.data.armor.defensiveImmobilize;
  const h = ctx.map.hexes[hex]!;
  if (leaderAlone) return t.leader!;
  if (h.terrain === 'wheat') return t.wheat!;
  if (h.terrain === 'woods') return t.woodsOrLarge!;
  if (h.building) return ctx.map.buildings[h.building]!.multiStory ? t.woodsOrLarge! : t.smallBuilding!;
  if (h.shellhole) return t.smallBuilding!;
  return 0;
}

/** Was the vehicle next to `hex` at any time during this Movement Phase (§36.1)? */
export function passedNear(s: GameState, v: Vehicle, hex: HexKey): boolean {
  const steps = s.vtracks[v.id] ?? [v.hex];
  return steps.some((h) => range(h, hex) === 1);
}

export interface AntiTankAnalysis {
  readonly kind: 'immobilize' | 'FT' | 'PF' | 'BAZ';
  readonly trace: string[];
  readonly hit?: number;
  readonly hitDrm?: number;
  readonly kill?: number;
  readonly killDrm?: number;
  readonly immobilizeOn?: number;
  readonly aspect?: Aspect;
}

/** Validate an infantry attack on an AFV and work out its numbers. */
export function analyzeAntiTank(ctx: Ctx, s: GameState, ids: readonly string[], vehicleId: string, weaponId?: string): AntiTankAnalysis {
  const v = s.vehicles[vehicleId];
  if (!v) throw new RuleError('No such vehicle');
  const units = ids.map((id) => s.units[id]);
  if (!units.length || units.some((u) => !u || u.side !== s.awaiting || u.side === v.side)) throw new RuleError('Choose your own units');
  const us = units as Unit[];
  const hex = us[0]!.hex;
  if (us.some((u) => u.hex !== hex)) throw new RuleError('The attackers must be in one hex');
  if (us.some((u) => u.broken)) throw new RuleError('Broken units cannot attack');
  const isFire = s.phase === 'prepFire' || s.phase === 'advancingFire' ? s.phasing === s.awaiting : s.phase === 'defensiveFire';
  if (!isFire) throw new RuleError('Infantry attacks AFVs in a fire phase (or in Close Combat)', '§36');
  const tt = vehicleType(ctx, v);
  const r = range(hex, v.hex);
  if (!weaponId) {
    if (s.phase !== 'defensiveFire') throw new RuleError('Immobilization attempts are made in Defensive Fire', '§36.1');
    if (ctx.map.hexes[hex]!.terrain === 'open' && !ctx.map.hexes[hex]!.shellhole) throw new RuleError('Only infantry in other than open ground may attack the AFV', '§36.1');
    if (!passedNear(s, v, hex)) throw new RuleError('The AFV was not adjacent to this hex during its movement', '§36.1');
    if (us.some((u) => u.firedPhase && u.firedPhase !== s.phase) || us.some((u) => u.usedInherent)) throw new RuleError('These units have already fired');
    const alone = us.every((u) => isLeader(ctx, u));
    const n = immobilizeNumber(ctx, hex, alone);
    return { kind: 'immobilize', immobilizeOn: n, trace: [`Pre-AFV attack morale check for each unit, then immobilize on ${n} or less (${alone ? 'leader alone' : hexTem(ctx, hex).label}, §36.11–36.12)`] };
  }
  const w = s.weapons[weaponId];
  if (!w || us.length !== 1 || w.owner !== us[0]!.id) throw new RuleError('That unit does not carry that weapon');
  if (w.usedThisTurn || w.malfunctioned) throw new RuleError('That weapon cannot fire now');
  const u = us[0]!;
  if (u.firedPhase && u.firedPhase !== s.phase) throw new RuleError('All of a unit’s fire is in one phase', 'Q&A 8.2');
  const kind = weaponType(ctx, w).kind;
  if (r > 0 && !ctx.los(hex, v.hex).clear) throw new RuleError('No line of sight', '§7');
  const aspect = hitAspect(v, hex);
  if (kind === 'FT') {
    if (!canOperateSpecial(ctx, u)) throw new RuleError('Only assault engineers or −2/−3 leaders operate a flamethrower', '§22.4');
    if (r > 2) throw new RuleError('Flamethrowers reach 2 hexes', '§22');
    const kill = killNumber(ctx, 'FT', aspect);
    return { kind: 'FT', kill, killDrm: tt.armor, aspect, trace: [`Flamethrower: hits automatically; ${aspect} kill number ${kill}${tt.armor ? `, ${tt.armor > 0 ? '+' : ''}${tt.armor} armour` : ''} (§37.2). The same roll is used on the IFT at 20 FP against infantry in the hex.`] };
  }
  if (kind === 'PF' || kind === 'BAZ') {
    const table = kind === 'PF' ? ctx.data.armor.panzerfaust : ctx.data.armor.bazooka;
    if (r < 1 || r > table.range) throw new RuleError(`${kind === 'PF' ? 'Panzerfaust' : 'Bazooka'} range is 1–${table.range}`, kind === 'PF' ? '§37.31' : '§37.41');
    const moved = s.phase === 'advancingFire' && u.moved ? 1 : 0;
    const hit = table.toHit[r - 1]![moved]!;
    const lead = leaderType(ctx, u) ? { drm: leaderType(ctx, u)!.leadership } : leaderDrmFor(ctx, s, hex, u.side, u.id);
    let hitDrm = lead.drm;
    const trace = [`${kind === 'PF' ? 'Panzerfaust' : 'Bazooka'} at range ${r}${moved ? ' after moving' : ''}: To Hit ${hit} (§${kind === 'PF' ? '37.31' : '37.41'})`];
    if (lead.drm) trace.push(`${lead.drm} leadership (§${kind === 'PF' ? '37.34' : '37.44'})`);
    const los = losFrom(ctx, hex, v.hex);
    if (los.targetHexside?.wall) {
      hitDrm += 2;
      trace.push('+2 target hull down behind a wall');
    }
    const kill = killNumber(ctx, kind, aspect);
    trace.push(`If hit: ${aspect} kill number ${kill}${tt.armor ? `, ${tt.armor > 0 ? '+' : ''}${tt.armor} armour` : ''}`);
    return { kind, hit, hitDrm, kill, killDrm: tt.armor, aspect, trace };
  }
  throw new RuleError('That weapon cannot attack an AFV');
}

export function antiTank(ctx: Ctx, s: GameState, ids: readonly string[], vehicleId: string, weaponId: string | undefined, emit: Emit): void {
  const a = analyzeAntiTank(ctx, s, ids, vehicleId, weaponId);
  const v = s.vehicles[vehicleId]!;
  const label = vehicleLabel(ctx, v);
  if (a.kind === 'immobilize') {
    const us = ids.map((id) => s.units[id]!);
    const hex = us[0]!.hex;
    const lead = leaderDrmFor(ctx, s, hex, us[0]!.side);
    for (const u of us) {
      if (!s.vehicles[vehicleId] || s.vehicles[vehicleId]!.immobilized) break;
      const [m1, m2] = roll2d6(s);
      const drm = isLeader(ctx, u) ? 0 : lead.drm;
      const morale = moraleOf(ctx, u);
      const pass = m1 + m2 + drm <= morale;
      u.noConceal = true;
      emit({ kind: 'morale', text: `${unitLabel(ctx, u)} pre-AFV attack check: ${m1}+${m2}${drm ? ` ${drm}` : ''} vs ${morale}: ${pass ? 'goes for the tank' : 'holds back (no penalty)'} (§36.11)`, side: u.side, units: [u.id], dice: [m1, m2], fx: { result: pass ? 'pass' : 'failed' } });
      if (!pass) continue;
      u.firedPhase = s.phase;
      u.usedInherent = true;
      const [i1, i2] = roll2d6(s);
      const fin = i1 + i2 + drm;
      const ok = fin <= a.immobilizeOn!;
      emit({ kind: 'fire', text: `${unitLabel(ctx, u)} attacks ${label} with grenades and charges: ${i1}+${i2}${drm ? ` ${drm}` : ''} = ${fin} vs ${a.immobilizeOn}: ${ok ? 'immobilized!' : 'no effect'} (§36.12)`, side: u.side, units: [u.id], dice: [i1, i2], from: hex, to: v.hex, hexes: [v.hex], fx: { firerHexes: [hex], targets: [v.hex], kinds: ['AT'], shooters: [{ hex, kind: 'rifle', unit: u.id }], outcomes: [{ hex: v.hex, penetration: false, results: [{ unit: v.id, result: ok ? 'M' : '-' }] }] } });
      if (ok) immobilize(ctx, s, s.vehicles[vehicleId]!, emit);
    }
    return;
  }
  const u = s.units[ids[0]!]!;
  const w = s.weapons[weaponId!]!;
  u.firedPhase = s.phase;
  w.usedThisTurn = true;
  reveal(ctx, s, u.hex, emit, 'fired');
  u.noConceal = true;
  const trace = [...a.trace];
  const dice: number[] = [];
  let hit = true;
  let rawHit = 0;
  if (a.kind !== 'FT') {
    const [h1, h2] = roll2d6(s);
    dice.push(h1, h2);
    rawHit = h1 + h2;
    const fin = rawHit + a.hitDrm!;
    hit = fin <= a.hit!;
    trace.push(`To Hit: ${h1}+${h2}${a.hitDrm ? ` ${a.hitDrm > 0 ? '+' : ''}${a.hitDrm}` : ''} = ${fin} vs ${a.hit}: ${hit ? 'hit' : 'miss'}`);
  }
  let kill = false;
  let kr = 0;
  if (hit) {
    const [k1, k2] = roll2d6(s);
    dice.push(k1, k2);
    kr = k1 + k2;
    kill = kr + a.killDrm! <= a.kill!;
    trace.push(`Kill: ${k1}+${k2}${a.killDrm ? ` ${a.killDrm > 0 ? '+' : ''}${a.killDrm}` : ''} = ${kr + a.killDrm!} vs ${a.kill}: ${kill ? 'destroyed' : 'no kill'}`);
  }
  const name = a.kind === 'FT' ? 'flamethrower' : a.kind === 'PF' ? 'panzerfaust' : 'bazooka';
  emit({
    kind: 'fire',
    text: `${unitLabel(ctx, u)} fires a ${name} at ${label}: ${hit ? (kill ? 'knocked out' : 'hit, no kill') : 'miss'}`,
    trace,
    side: u.side,
    units: [u.id],
    dice,
    from: u.hex,
    to: v.hex,
    hexes: [v.hex],
    fx: { firerHexes: [u.hex], targets: [v.hex], kinds: [a.kind], shooters: [{ hex: u.hex, kind: a.kind, unit: u.id }], outcomes: [{ hex: v.hex, penetration: false, results: [{ unit: v.id, result: kill ? 'KIA' : '-' }] }], hit, kill, vs: v.id },
  });
  if (a.kind === 'PF') {
    delete s.weapons[w.id];
    u.weapons = u.weapons.filter((x) => x !== w.id);
  }
  if (a.kind === 'BAZ' && rawHit >= ctx.data.armor.bazooka.outOfAmmo) {
    delete s.weapons[w.id];
    u.weapons = u.weapons.filter((x) => x !== w.id);
    emit({ kind: 'breakdown', text: `The bazooka is out of ammunition (rolled ${rawHit}, §37.45)`, side: u.side, hexes: [u.hex] });
  }
  if (kill) destroyVehicle(ctx, s, v, `${name} from ${unitLabel(ctx, u)}`, emit, 'roll');
  else if (hit && v.immobilized && s.vehicles[v.id]) crewCheck(ctx, s, v, 'hit while immobilized', emit);
  if (a.kind === 'FT') {
    // The same roll on the IFT at 20 FP against any infantry there (§37.2).
    const victims = enemiesIn(s, v.hex, u.side);
    if (victims.length) {
      const fp = weaponType(ctx, w).fp;
      const res = victims.map((x) => ({ unit: x.id, result: iftLookup(ctx, iftColumn(ctx, x.concealed ? fp / 2 : fp), kr), finalDr: kr }));
      applyInfantry(ctx, s, v.hex, res, emit);
    }
    if (kr >= weaponType(ctx, w).breakdown && s.weapons[w.id]) {
      delete s.weapons[w.id];
      u.weapons = u.weapons.filter((x) => x !== w.id);
      emit({ kind: 'breakdown', text: `The flamethrower is out of fuel (roll ${kr}, §22.6)`, side: u.side, hexes: [u.hex] });
    }
  }
}

/** Demolition charge against AFVs in its hex: the DC column of the AFV Kill Table (§23, §33.4). */
export function chargeVsVehicles(ctx: Ctx, s: GameState, hex: HexKey, side: SideId, from: HexKey, dr: number, emit: Emit): void {
  for (const v of enemyVehiclesIn(s, hex, side)) {
    const aspect = hitAspect(v, from);
    const k = killNumber(ctx, 'DC', aspect);
    const armor = vehicleType(ctx, v).armor;
    const kill = dr + armor <= k;
    emit({ kind: 'info', text: `Charge against ${vehicleLabel(ctx, v)} (${aspect}): ${dr}${armor ? ` ${armor > 0 ? '+' : ''}${armor}` : ''} vs ${k}: ${kill ? 'destroyed' : 'it survives'}`, side, hexes: [hex] });
    if (kill) destroyVehicle(ctx, s, v, 'demolition charge', emit, 'roll');
    else if (v.immobilized) crewCheck(ctx, s, v, 'shaken by the charge', emit);
  }
}

// ---- Close combat against AFVs (§36.2) ----------------------------------------------------

/** Pre-AFV attack morale check for infantry advancing onto an AFV; true if the unit goes in (§36.21). */
export function preAfvCheck(ctx: Ctx, s: GameState, u: Unit, emit: Emit): boolean {
  const lead = isLeader(ctx, u) ? { drm: 0 } : leaderDrmFor(ctx, s, u.hex, u.side, u.id);
  const [a, b] = roll2d6(s);
  const morale = moraleOf(ctx, u);
  const pass = a + b + lead.drm <= morale;
  emit({ kind: 'morale', text: `${unitLabel(ctx, u)} pre-AFV attack check: ${a}+${b}${lead.drm ? ` ${lead.drm}` : ''} vs ${morale}: ${pass ? 'charges the tank' : 'stays put'} (§36.21)`, side: u.side, units: [u.id], dice: [a, b], fx: { result: pass ? 'pass' : 'failed' } });
  return pass;
}

/** Infantry on top of an enemy AFV with no enemy infantry there: each attacks separately; a squad kills on its firepower or less, a leader on 2 (§36.23–36.24). */
export function resolveAfvAssaults(ctx: Ctx, s: GameState, emit: Emit): void {
  const byVehicle = new Map<string, typeof s.afvAssaults>();
  for (const a of s.afvAssaults) (byVehicle.get(a.vehicle) ?? byVehicle.set(a.vehicle, []).get(a.vehicle)!).push(a);
  for (const [vid, list] of byVehicle) {
    const v = s.vehicles[vid];
    if (!v) continue;
    const attackers = list.map((a) => s.units[a.unit]).filter((u): u is Unit => !!u && u.hex === v.hex && !u.broken);
    if (!attackers.length) continue;
    if (enemiesIn(s, v.hex, attackers[0]!.side).length) continue; // §36.22: fight the infantry instead
    let killed = false;
    const leaders = attackers.filter((u) => isLeader(ctx, u)).sort((a, b) => leaderType(ctx, a)!.leadership - leaderType(ctx, b)!.leadership);
    let leaderUsed = false;
    for (const u of attackers) {
      if (killed) break;
      const st = squadType(ctx, u);
      const target = st ? st.fp : 2;
      const lead = !leaderUsed && leaders[0] ? leaderType(ctx, leaders[0])!.leadership : 0;
      if (lead) leaderUsed = true;
      const [a, b] = roll2d6(s);
      const fin = a + b + lead;
      killed = fin <= target;
      emit({
        kind: 'closeCombat',
        text: `${unitLabel(ctx, u)} attacks ${vehicleLabel(ctx, v)} at close quarters: ${a}+${b}${lead ? ` ${lead}` : ''} = ${fin} vs ${target}: ${killed ? 'destroyed' : 'fails'} (§36.23)`,
        side: u.side,
        units: [u.id],
        dice: [a, b],
        hexes: [v.hex],
        fx: { hit: killed },
      });
    }
    if (killed) destroyVehicle(ctx, s, v, 'close assault', emit, 'none');
    else {
      for (const a of list) {
        const u = s.units[a.unit];
        if (!u) continue;
        u.hex = a.from;
        for (const w of carried(s, u)) w.hex = a.from;
      }
      emit({ kind: 'info', text: `The attackers fall back from ${vehicleLabel(ctx, v)} (§36.24)`, hexes: [v.hex], units: list.map((a) => a.unit) });
    }
  }
  s.afvAssaults = [];
}

// ---- Rally Phase repairs, smoke dischargers, phase housekeeping ---------------------------------

export function vehicleRepair(ctx: Ctx, s: GameState, id: string, emit: Emit): void {
  const v = s.vehicles[id];
  if (!v || v.side !== s.awaiting || s.phase !== 'rally') throw new RuleError('Repairs are made in your Rally Phase', '§38.1');
  if (v.repairTried) throw new RuleError('Already tried this Rally Phase');
  if (v.gun !== 'malfunctioned' && v.mg !== 'malfunctioned') throw new RuleError('Nothing to repair');
  v.repairTried = true;
  for (const part of ['gun', 'mg'] as const) {
    if (v[part] !== 'malfunctioned') continue;
    const r = d6(s);
    const out = r === 1 ? 'ok' : r === 6 ? 'disabled' : 'malfunctioned';
    v[part] = out;
    emit({ kind: 'repair', text: `${vehicleLabel(ctx, v)} ${part === 'gun' ? 'main gun' : 'MGs'}: rolled ${r} → ${out === 'ok' ? 'repaired' : out === 'disabled' ? 'disabled for good' : 'still out'} (§38.1)`, side: v.side, dice: [r], hexes: [v.hex], fx: { result: out === 'ok' ? 'repaired' : out === 'disabled' ? 'removed' : 'jammed' } });
  }
}

export function discharge(ctx: Ctx, s: GameState, id: string, emit: Emit): void {
  const v = s.vehicles[id];
  if (!v) throw new RuleError('No such vehicle');
  if (!vehicleType(ctx, v).smokeDischarger) throw new RuleError('This vehicle has no smoke dischargers', '§41.4');
  if (v.smokeUsed) throw new RuleError('The smoke dischargers are used once per game', '§41.4');
  if (!firingSideOk(s, v)) throw new RuleError('Smoke dischargers fire in a friendly fire phase', '§41.4');
  if (v.mainShots >= (vehicleType(ctx, v).rof ?? 1)) throw new RuleError('It counts as firing the main gun, which has fired', '§41.4');
  v.smokeUsed = true;
  v.mainShots++;
  v.firedPhase ??= s.phase;
  if (!s.smoke.some((x) => x.hex === v.hex)) s.smoke.push({ hex: v.hex, side: v.side });
  emit({ kind: 'info', text: `${vehicleLabel(ctx, v)} fires its smoke dischargers in ${hexLabel(ctx, v.hex)} (§41.4)`, side: v.side, hexes: [v.hex], fx: { smoke: v.hex } });
}

export function resetVehicles(s: GameState): void {
  for (const v of Object.values(s.vehicles)) {
    v.mpSpent = 0;
    v.moved = false;
    v.pivoted = false;
    v.moveDone = false;
    v.mainShots = 0;
    v.mgCaUsed = false;
    v.mg360Used = false;
    v.firedPhase = null;
    v.mainTarget = null;
    v.overran = false;
    v.dfPivot = false;
    v.repairTried = false;
  }
  s.vtracks = {};
}

/** End of a fire phase: crews exposed to the side that just fired are buttoned up again (§34.8); phase-scoped markers clear. */
export function endFirePhase(s: GameState, phase: Phase): void {
  const firing = phase === 'defensiveFire' ? s.sides.find((x) => x.id !== s.phasing)!.id : s.phasing;
  for (const v of Object.values(s.vehicles)) {
    v.mainTarget = null;
    if (v.ce && v.side !== firing) v.ce = false;
    if (phase === 'defensiveFire') v.dfPivot = false;
  }
}

/** Infantry fire on a crew-exposed AFV: +2; a KIA forces a crew morale check (§34.8). */
export function fireOnExposedCrews(ctx: Ctx, s: GameState, hex: HexKey, side: SideId, column: number, dr: number, emit: Emit): void {
  for (const v of enemyVehiclesIn(s, hex, side)) {
    if (!v.ce) continue;
    const res = iftLookup(ctx, column, dr + 2);
    emit({ kind: 'info', text: `${vehicleLabel(ctx, v)} has its crew exposed: ${dr} +2 → ${resultText(res)}${res === 'KIA' ? '' : ' (only a KIA counts, §34.8)'}`, side, hexes: [hex] });
    if (res === 'KIA') crewCheck(ctx, s, v, 'crew hit while exposed', emit);
  }
}

/** Vehicles of a side that can still act: used by sudden death and the AI. */
export function sideVehicles(s: GameState, side: SideId): Vehicle[] {
  return Object.values(s.vehicles).filter((v) => v.side === side);
}

/** A fresh vehicle for setup. */
export function newVehicle(id: string, type: string, side: SideId, hex: HexKey, facing: number, name?: string): Vehicle {
  return {
    id,
    type,
    side,
    ...(name ? { name } : {}),
    hex,
    facing,
    mpSpent: 0,
    moved: false,
    pivoted: false,
    moveDone: false,
    mainShots: 0,
    mgCaUsed: false,
    mg360Used: false,
    firedPhase: null,
    mainTarget: null,
    overran: false,
    dfPivot: false,
    gun: 'ok',
    mg: 'ok',
    repairTried: false,
    immobilized: false,
    ce: false,
    smokeUsed: false,
  };
}

export const isTurreted = isTank;
