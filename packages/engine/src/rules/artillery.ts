/**
 * Offboard artillery (§45–46): radio contact in the Rally Phase, the
 * artillery request, the initial spotting round in the Close Combat Phase,
 * corrections, and fire for effect on a 7-hex blast area in Prep Fire (own
 * turn) or Defensive Fire (the opponent's).
 */
import { DIRECTIONS, hexKey, neighbor, parseHexKey, type Direction, type HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { losFrom } from '../ctx';
import { d6, roll2d6 } from '../rng';
import { carried, hexLabel, hexTem, isLeader, isOpenGround, range, unitLabel, weaponType } from '../queries';
import { RuleError, type Battery, type GameState, type SideId, type Unit } from '../types';
import type { Emit } from './common';
import { iftLookup, resultText } from './fire';
import { applyHexResults } from './morale';
import { reveal } from './special';
import { destroyVehicle, heEquivalent, iftColumn, vehicleLabel, vehicleType } from './armor';
import { blastClears, buildingHit, fortTem } from './western';
import { unitSeesAnyFloor } from './floors';

/** Calibre and fire missions for each scenario module, rolled at the start where not given (§45.2–45.21). */
export function setupBatteries(ctx: Ctx, s: GameState): void {
  const list = ctx.scenario.artillery ?? [];
  // On-board mortars and howitzers can fire indirect through a spotter with a radio (§63.4).
  const onboard: Battery[] = Object.values(s.vehicles)
    .filter((v) => { const k = ctx.data.vehicles[v.type]?.kind; return k === 'mortar' || !!ctx.data.vehicles[v.type]?.howitzer; })
    .map((v) => ({ id: `ob-${v.id}`, side: v.side, mm: ctx.data.vehicles[v.type]!.gun!, missions: 99, used: 0, contact: false, tried: false, leader: null, mode: 'idle', hex: null, smoke: false, acted: false, onboard: v.id }));
  if (!list.length && !onboard.length) return;
  s.batteries = [...list.map((a, i) => {
    const nation = s.sides.find((x) => x.id === a.side)!.nation;
    const mm = a.mm ?? ctx.data.artillery.module[nation]![d6(s) - 1]!;
    const missions = a.missions ?? d6(s) % 4 + 1;
    return { id: `art${i + 1}`, side: a.side, mm, missions, used: 0, contact: false, tried: false, leader: null, mode: 'idle', hex: null, smoke: false, acted: false } as Battery;
  }), ...onboard];
}

/** Minimum indirect range of an on-board weapon (§63.21, §63.41). */
function onboardMin(ctx: Ctx, s: GameState, b: Battery): number {
  const v = b.onboard ? s.vehicles[b.onboard] : undefined;
  if (!v) return 0;
  const t = ctx.data.vehicles[v.type]!;
  return t.kind === 'mortar' ? (t.minRange ?? 10) : 20;
}

function nationOf(s: GameState, side: SideId) {
  return s.sides.find((x) => x.id === side)!.nation;
}

/** The radio contact number for the side's nationality and the scenario year (§46.11). */
export function contactValue(ctx: Ctx, s: GameState, side: SideId): number {
  const rows = ctx.data.artillery.contact[nationOf(s, side)] ?? [[0, 7]];
  const year = Number(/(19\d\d)/.exec(ctx.scenario.date)?.[1] ?? 1943);
  let v = rows[0]![1];
  for (const [from, val] of rows) if (year >= from) v = val;
  return v;
}

function radioIn(s: GameState, hex: HexKey, side: SideId, ctx: Ctx) {
  for (const u of Object.values(s.units)) {
    if (u.hex !== hex || u.side !== side || u.broken) continue;
    const r = carried(s, u).find((w) => weaponType(ctx, w).kind === 'RADIO' && !w.malfunctioned);
    if (r) return r;
  }
  return undefined;
}

function battery(s: GameState, id: string): Battery {
  const b = s.batteries?.find((x) => x.id === id);
  if (!b) throw new RuleError('No such battery');
  return b;
}

/** Can the leader observe the hex (walls, hedges and wheat never block; smoke does; §46.7)? */
export function observes(ctx: Ctx, s: GameState, leader: Unit, hex: HexKey): boolean {
  if (leader.hex === hex) return true;
  if (s.smoke.some((x) => x.hex === hex)) return false;
  return unitSeesAnyFloor(ctx, s, leader, hex);
}

/** Rally Phase: establish (or maintain, −2) radio contact (§46.11–46.12). A 12 breaks the radio (§46.81). */
export function radioContact(ctx: Ctx, s: GameState, batteryId: string, unitId: string, emit: Emit): void {
  const b = battery(s, batteryId);
  if (s.phase !== 'rally' || s.awaiting !== b.side) throw new RuleError('Radio contact is tried in your Rally Phase', '§46.11');
  if (b.tried) throw new RuleError('Already tried this Rally Phase');
  const u = s.units[unitId];
  if (!u || u.side !== b.side || !isLeader(ctx, u) || u.broken) throw new RuleError('An unbroken leader makes radio contact', '§46.1');
  const radio = radioIn(s, u.hex, b.side, ctx);
  if (!radio) throw new RuleError('The leader needs a working radio in his hex', '§46.1');
  if (b.used >= b.missions) throw new RuleError('All fire missions are spent', '§46.72');
  const keep = b.contact && b.leader === u.id;
  const need = contactValue(ctx, s, b.side);
  const [a, c] = roll2d6(s);
  const fin = a + c + (keep ? ctx.data.artillery.maintain : 0);
  b.tried = true;
  const ok = fin <= need && a + c < 12;
  emit({
    kind: 'info',
    text: `${unitLabel(ctx, u)} radios the ${b.mm}mm battery: ${a}+${c}${keep ? ` ${ctx.data.artillery.maintain}` : ''} vs ${need}: ${ok ? (keep ? 'contact maintained' : 'contact!') : 'no contact'} (§46.1${keep ? '2' : '1'})`,
    side: b.side,
    units: [u.id],
    dice: [a, c],
    hexes: [u.hex],
    fx: { result: ok ? 'pass' : 'failed' },
  });
  if (a + c === 12) {
    radio.malfunctioned = true;
    emit({ kind: 'breakdown', text: 'The radio breaks down (rolled 12, §46.81)', side: b.side, hexes: [u.hex] });
  }
  b.contact = ok;
  b.leader = ok ? u.id : null;
  if (!ok && b.mode !== 'idle') {
    b.mode = 'idle';
    b.hex = null;
    emit({ kind: 'info', text: 'Contact lost: the spotting round or fire for effect is lifted (§46.71)', side: b.side });
  }
}

/** One of the Rally Phase operations of §46.3, or the first request (§46.13). */
export function artilleryOrder(ctx: Ctx, s: GameState, batteryId: string, op: 'request' | 'correct' | 'ffe' | 'move' | 'cancel', hex: HexKey | undefined, smoke: boolean, emit: Emit): void {
  const b = battery(s, batteryId);
  if (s.phase !== 'rally' || s.awaiting !== b.side) throw new RuleError('Artillery is directed in your Rally Phase', '§46.3');
  if (!b.contact || !b.tried) throw new RuleError('Make radio contact first this Rally Phase', '§46.12');
  if (b.acted) throw new RuleError('One artillery operation per Rally Phase', '§46.3');
  const leader = b.leader ? s.units[b.leader] : undefined;
  if (!leader || leader.broken) throw new RuleError('The spotting leader is gone');
  const corr = ctx.data.artillery.correction;
  if (op === 'cancel') {
    b.mode = 'idle';
    b.hex = null;
    b.acted = true;
    emit({ kind: 'info', text: `The ${b.mm}mm fire is called off`, side: b.side });
    return;
  }
  if (!hex || !ctx.map.hexes[hex]) throw new RuleError('Choose a hex');
  if (b.onboard) {
    const gun = s.vehicles[b.onboard];
    if (!gun) throw new RuleError('That weapon is gone');
    if (range(gun.hex, hex) < onboardMin(ctx, s, b)) throw new RuleError(`Too close for indirect fire (at least ${onboardMin(ctx, s, b)} hexes)`, '§63.21, §63.41');
  }
  if (!observes(ctx, s, leader, hex)) throw new RuleError(`${unitLabel(ctx, leader)} cannot observe ${hexLabel(ctx, hex)}`, '§46.7');
  if (op === 'request') {
    b.mode = 'request';
    b.hex = hex;
    b.smoke = false;
  } else if (op === 'correct') {
    if (b.mode !== 'sr' || !b.hex) throw new RuleError('No spotting round to correct', '§46.31');
    if (range(b.hex, hex) > corr) throw new RuleError(`Corrections move up to ${corr} hexes`, '§46.31');
    b.hex = hex;
  } else if (op === 'ffe') {
    if (b.mode !== 'sr' || !b.hex) throw new RuleError('Fire for effect needs a spotting round on the map', '§46.32');
    if (range(b.hex, hex) > corr) throw new RuleError(`Up to ${corr} hexes from the spotting round`, '§46.32');
    if (b.used >= b.missions) throw new RuleError('All fire missions are spent', '§46.72');
    b.mode = 'ffe';
    b.hex = hex;
    b.smoke = smoke;
  } else if (op === 'move') {
    if (b.mode !== 'ffe' || !b.hex) throw new RuleError('No fire for effect to move', '§46.33');
    if (range(b.hex, hex) > corr) throw new RuleError(`Up to ${corr} hexes`, '§46.33');
    b.hex = hex;
    b.smoke = smoke;
  }
  b.acted = true;
  const what = op === 'request' ? 'artillery request' : op === 'correct' ? 'spotting round corrected' : b.smoke ? 'fire for effect (smoke)' : 'fire for effect';
  emit({ kind: 'info', text: `${b.mm}mm: ${what} at ${hexLabel(ctx, hex)} (§46.${op === 'request' ? '13' : '3'})`, side: b.side, hexes: [hex], fx: { artillery: b.mode, hex } });
}

/** Close Combat Phase: the initial spotting round lands, perhaps off target (§46.2–46.24). */
export function spottingRounds(ctx: Ctx, s: GameState, emit: Emit): void {
  for (const b of s.batteries ?? []) {
    if (b.mode !== 'request' || !b.hex || !b.contact) continue;
    const leader = b.leader ? s.units[b.leader] : undefined;
    if (!leader) continue;
    const acc = d6(s);
    let at: HexKey | undefined = b.hex;
    const dice = [acc];
    let how = 'on target';
    if (acc > (ctx.data.artillery.onTarget[nationOf(s, b.side)] ?? 2)) {
      const dir = d6(s);
      const dist = d6(s);
      dice.push(dir, dist);
      let h = parseHexKey(b.hex);
      for (let i = 0; i < dist; i++) h = neighbor(h, DIRECTIONS[dir - 1] as Direction);
      at = ctx.map.hexes[hexKey(h)] ? hexKey(h) : undefined;
      how = `${dist} hex${dist > 1 ? 'es' : ''} ${['N', 'NE', 'SE', 'S', 'SW', 'NW'][dir - 1]}`;
    }
    if (!at || !observes(ctx, s, leader, at)) {
      emit({ kind: 'info', text: `The ${b.mm}mm spotting round is lost (${how}${at ? ', out of sight' : ', off the map'}); try again next Close Combat Phase (§46.24)`, side: b.side, dice });
      continue;
    }
    b.mode = 'sr';
    b.hex = at;
    emit({ kind: 'info', text: `${b.mm}mm spotting round lands in ${hexLabel(ctx, at)} (${how}, §46.21–46.23)`, side: b.side, dice, hexes: [at], fx: { spotting: at } });
  }
}

/** End of the Rally Phase: batteries that did not keep contact lose their marks (§46.12, §46.71); reset per-phase flags. */
export function endRally(s: GameState, emit: Emit): void {
  for (const b of s.batteries ?? []) {
    if (!b.tried || !b.contact) {
      if (b.mode === 'sr' || b.mode === 'ffe') emit({ kind: 'info', text: `No radio contact: the ${b.mm}mm ${b.mode === 'sr' ? 'spotting round' : 'fire for effect'} is lifted (§46.71)`, side: b.side });
      if (b.mode !== 'idle' && b.mode !== 'request') {
        b.mode = 'idle';
        b.hex = null;
      }
      if (!b.tried) b.contact = false;
    }
    b.tried = false;
    b.acted = false;
  }
}

export function blastArea(ctx: Ctx, hex: HexKey): HexKey[] {
  return [hex, ...DIRECTIONS.map((d) => hexKey(neighbor(parseHexKey(hex), d)))].filter((h) => !!ctx.map.hexes[h]);
}

/** Fire for effect lands: in Prep Fire for the moving side, in Defensive Fire for the other (§46.4–46.54, §46.9). */
export function fireForEffect(ctx: Ctx, s: GameState, side: SideId, emit: Emit): void {
  for (const b of s.batteries ?? []) {
    if (b.side !== side || b.mode !== 'ffe' || !b.hex) continue;
    if (b.used >= b.missions) {
      b.mode = 'idle';
      b.hex = null;
      continue;
    }
    if (b.onboard && !s.vehicles[b.onboard]) {
      b.mode = 'idle';
      b.hex = null;
      continue;
    }
    b.used++;
    // An on-board weapon hits only the spotting-round hex (§63.4).
    const area = b.onboard ? [b.hex] : blastArea(ctx, b.hex);
    if (b.smoke) {
      for (const h of area) if (!s.smoke.some((x) => x.hex === h)) s.smoke.push({ hex: h, side });
      emit({ kind: 'info', text: `${b.mm}mm smoke barrage on ${hexLabel(ctx, b.hex)} and around it (§46.9; mission ${b.used}/${b.missions})`, side, hexes: area, fx: { smoke: b.hex } });
    } else barrage(ctx, s, b, area, emit);
    if (b.used >= b.missions) {
      b.mode = 'idle';
      b.hex = null;
      emit({ kind: 'info', text: `The ${b.mm}mm battery has fired its last mission (§46.72)`, side });
    }
  }
}

function barrage(ctx: Ctx, s: GameState, b: Battery, area: HexKey[], emit: Emit): void {
  const fp = heEquivalent(ctx, b.mm);
  const col = iftColumn(ctx, fp);
  const center = b.hex!;
  // In Defensive Fire, units that moved through the blast area are brought back to the first blast hex they entered (§46.51).
  const where = new Map<string, { hex: HexKey; moving: boolean }>();
  for (const u of Object.values(s.units)) if (area.includes(u.hex)) where.set(u.id, { hex: u.hex, moving: false });
  if (s.phase === 'defensiveFire') {
    for (const [id, steps] of Object.entries(s.tracks)) {
      const u = s.units[id];
      if (!u) continue;
      const first = steps.find((st) => area.includes(st.hex));
      if (first) where.set(id, { hex: first.hex, moving: first.open });
    }
  }
  const trace: string[] = [`${b.mm}mm fire for effect on ${hexLabel(ctx, center)}: ${fp} FP on the IFT in each of the 7 hexes, rolled separately (§46.5)`];
  const outcomes: { hex: HexKey; penetration: boolean; results: { unit: string; result: string | number }[] }[] = [];
  const allDice: number[] = [];
  for (const h of area) {
    const victims = [...where.entries()].filter(([, w]) => w.hex === h).map(([id, w]) => ({ u: s.units[id]!, moving: w.moving }));
    const vehicles = Object.values(s.vehicles).filter((v) => v.hex === h);
    if (!victims.length && !vehicles.length) continue;
    const [d1, d2] = roll2d6(s);
    allDice.push(d1, d2);
    const dr = d1 + d2;
    const tem = hexTem(ctx, h);
    const sideDrm = h !== center ? hexsideBetween(ctx, h, center) : 0;
    const results = victims.map(({ u, moving }) => {
      const fort = moving ? undefined : fortTem(ctx, s, u, h, [], 'arty');
      const fin = dr + (fort ?? tem).drm + sideDrm + (moving && isOpenGround(ctx, h) ? ctx.data.tables.tem.movingInOpen : 0);
      return { unit: u.id, result: iftLookup(ctx, u.concealed ? iftColumn(ctx, fp / 2) : col, fin), finalDr: fin };
    });
    for (const r of results) trace.push(`${hexLabel(ctx, h)} ${unitLabel(ctx, s.units[r.unit]!)}: ${dr}${tem.drm ? ` +${tem.drm}` : ''}${sideDrm ? ` +${sideDrm} wall/hedge` : ''} → ${r.finalDr}: ${resultText(r.result)}`);
    outcomes.push({ hex: h, penetration: false, results: results.map((r) => ({ unit: r.unit, result: r.result })) });
    // Vehicles: only a KIA counts, with the barrage-vs-vehicle modifier (§46.54).
    for (const v of vehicles) {
      const t = vehicleType(ctx, v);
      const V = ctx.data.artillery.vehicles;
      const soft = t.kind === 'truck' || t.kind === 'jeep' || t.kind === 'gun' || t.kind === 'mortar';
      const mod = soft ? V.nonArmored! : t.openTop ? V.openTop! : t.kind === 'tank' ? V.tank! : t.kind === 'spg' ? V.spg! : V.nonArmored!;
      const res = iftLookup(ctx, col, dr + mod);
      trace.push(`${hexLabel(ctx, h)} ${vehicleLabel(ctx, v)}: ${dr} ${mod >= 0 ? '+' : ''}${mod} → ${resultText(res)}${res === 'KIA' ? ': destroyed' : ''}`);
      if (res === 'KIA') destroyVehicle(ctx, s, v, `${b.mm}mm barrage`, emit, 'roll');
    }
    // A KIA clears wire and mines, and brings down (or sets fire to) a building (§53.54, §55.7, §58.1, §59.3).
    if (iftLookup(ctx, col, dr + tem.drm) === 'KIA') {
      blastClears(ctx, s, h, b.mm, emit);
      buildingHit(ctx, s, h, 'arty', emit, () => {
        const [x, y] = roll2d6(s);
        return iftLookup(ctx, col, x + y + tem.drm) === 'KIA';
      });
    }
    if (results.some((r) => r.result === 'KIA')) for (const w of Object.values(s.weapons)) if (w.hex === h && (w.owner === null || results.some((r) => r.unit === w.owner && r.result === 'KIA'))) delete s.weapons[w.id];
    // Units brought back are attacked in that hex, then return to where they were.
    const homes = new Map<string, HexKey>();
    for (const r of results) {
      const u = s.units[r.unit];
      if (u && u.hex !== h) {
        homes.set(u.id, u.hex);
        u.hex = h;
      }
    }
    if (results.some((r) => r.result !== '-')) reveal(ctx, s, h, emit, 'shelled');
    for (const r of results) if (r.result !== '-' && s.units[r.unit]) s.units[r.unit]!.dm = true;
    applyHexResults(ctx, s, { hex: h, results }, emit);
    for (const [id, home] of homes) if (s.units[id]) s.units[id]!.hex = home;
  }
  const summary = [...new Set(outcomes.flatMap((o) => o.results.map((r) => resultText(r.result as never))).filter((x) => x !== 'no effect'))];
  emit({
    kind: 'fire',
    text: `${b.mm}mm barrage on ${hexLabel(ctx, center)}: ${summary.length ? summary.join(', ') : 'no effect'} (mission ${b.used}/${b.missions})`,
    trace,
    side: b.side,
    dice: allDice.slice(0, 2),
    to: center,
    hexes: area,
    fx: { artillery: true, firerHexes: [], targets: area, kinds: ['ARTY'], shooters: [], outcomes, column: fp, center },
  });
}

/** A wall or hedge between a blast hex and the centre protects (+2/+1, §46.5). */
function hexsideBetween(ctx: Ctx, h: HexKey, center: HexKey): number {
  const los = losFrom(ctx, center, h);
  if (los.targetHexside?.wall) return ctx.data.tables.tem.wall;
  if (los.targetHexside?.hedge) return ctx.data.tables.tem.hedge;
  return 0;
}
