/**
 * Infantry special rules (§22–27): smoke, demolition charges, concealment,
 * fanaticism and sewer movement. Flamethrower fire lives in fire.ts.
 */
import { DIRECTIONS, hexKey, hexsideKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { d6 } from '../rng';
import {
  carried,
  enemiesIn,
  hexLabel,
  inMelee,
  isLeader,
  leaderType,
  range,
  squadType,
  unitLabel,
  unitsIn,
  weaponType,
} from '../queries';
import { RuleError, type GameState, type SideId, type Unit } from '../types';
import type { Emit } from './common';

// ---- Who may handle engineer equipment ------------------------------------------------

/** Assault engineers, or leaders rated −2 or better, operate flamethrowers and charges (§22.4, §23.2). */
export function canOperateSpecial(ctx: Ctx, u: Unit): boolean {
  const st = squadType(ctx, u);
  if (st) return !!st.assaultEngineer;
  const lt = leaderType(ctx, u);
  return !!lt && lt.leadership <= -2;
}

// ---- Smoke (§24) ----------------------------------------------------------------------

export function smokeAt(s: GameState, hex: HexKey): boolean {
  return s.smoke.some((x) => x.hex === hex);
}

/** +1 MF to enter a smoke hex (§24.5). */
export function smokeMf(s: GameState, hex: HexKey): number {
  return smokeAt(s, hex) ? 1 : 0;
}

/** True when a line of fire runs into, out of or through smoke (§24.6). */
export function smokeOnLine(ctx: Ctx, s: GameState, from: HexKey, to: HexKey): boolean {
  if (!s.smoke.length) return false;
  if (smokeAt(s, from) || smokeAt(s, to)) return true;
  return ctx.los(from, to).hexes.some((h) => smokeAt(s, h.key));
}

export function placeSmoke(ctx: Ctx, s: GameState, unitId: string, hex: HexKey, emit: Emit): void {
  const u = s.units[unitId];
  if (!u) throw new RuleError('Unknown unit');
  if (s.phase !== 'prepFire' || u.side !== s.phasing || s.awaiting !== s.phasing) throw new RuleError('Smoke is placed at the start of your Prep Fire Phase', '§24.3');
  if (s.attacks.length) throw new RuleError('Smoke must be the first action of the Prep Fire Phase', '§24.3');
  if (!squadType(ctx, u)?.assaultEngineer) throw new RuleError('Only assault engineer squads place smoke', '§24.2');
  if (u.broken) throw new RuleError('A broken unit cannot place smoke');
  if (u.smokeMade) throw new RuleError(`${unitLabel(ctx, u)} already placed smoke this turn`, '§24.2');
  if (inMelee(s, u.hex)) throw new RuleError('Not while locked in melee', '§20.81');
  if (!ctx.map.hexes[hex] || range(u.hex, hex) > 1) throw new RuleError('Smoke goes in the engineers’ own hex or an adjacent one', '§24.3');
  if ((s.smokeLeft[u.side] ?? 0) <= 0) throw new RuleError('No smoke counters left', '§24.1');
  if (smokeAt(s, hex)) throw new RuleError('That hex already has smoke');
  s.smokeLeft[u.side] = (s.smokeLeft[u.side] ?? 0) - 1;
  s.smoke.push({ hex, side: u.side });
  u.smokeMade = true;
  u.noConceal = true;
  reveal(ctx, s, u.hex, emit, 'made smoke');
  emit({ kind: 'info', text: `${unitLabel(ctx, u)} lays smoke in ${hexLabel(ctx, hex)} (${s.smokeLeft[u.side]} left, §24)`, side: u.side, units: [u.id], hexes: [hex], fx: { smoke: hex } });
}

/** Smoke a player laid lifts at the start of that player's next Prep Fire Phase (§24.8). */
export function clearSmoke(ctx: Ctx, s: GameState, side: SideId, emit: Emit): void {
  const gone = s.smoke.filter((x) => x.side === side);
  if (!gone.length) return;
  s.smoke = s.smoke.filter((x) => x.side !== side);
  emit({ kind: 'info', text: `Smoke clears from ${gone.map((x) => hexLabel(ctx, x.hex)).join(', ')} (§24.8)`, hexes: gone.map((x) => x.hex) });
}

// ---- Demolition charges (§23) -------------------------------------------------------------

export function placeCharge(ctx: Ctx, s: GameState, unitId: string, weaponId: string, target: HexKey, emit: Emit): void {
  const u = s.units[unitId];
  const w = s.weapons[weaponId];
  if (!u || !w) throw new RuleError('Unknown unit or weapon');
  if (s.phase !== 'movement' || u.side !== s.phasing || s.awaiting !== s.phasing) throw new RuleError('Charges are placed during your Movement Phase', '§23.3');
  if (w.owner !== u.id || weaponType(ctx, w).kind !== 'DC') throw new RuleError(`${unitLabel(ctx, u)} does not carry a demolition charge`);
  if (!canOperateSpecial(ctx, u)) throw new RuleError('Only assault engineers or −2/−3 leaders may place a demolition charge', '§23.2');
  if (u.broken) throw new RuleError('A broken unit cannot place a charge');
  if (!ctx.map.hexes[target] || range(u.hex, target) !== 1) throw new RuleError('The charge goes on an adjacent hex', '§23.3');
  const a = ctx.map.hexes[u.hex]!;
  const b = ctx.map.hexes[target]!;
  if (b.level > a.level && cliffBetween(ctx, u.hex, target)) throw new RuleError('Not up across a cliff hexside', '§23.3');
  if (s.charges.some((c) => c.target === target && c.side === u.side)) throw new RuleError('A charge is already placed there');
  w.owner = null;
  u.weapons = u.weapons.filter((x) => x !== w.id);
  w.hex = u.hex;
  s.charges.push({ weapon: w.id, side: u.side, placer: u.id, from: u.hex, target, armed: false });
  u.noConceal = true;
  reveal(ctx, s, u.hex, emit, 'placed a charge');
  emit({ kind: 'info', text: `${unitLabel(ctx, u)} places a demolition charge on ${hexLabel(ctx, target)} from ${hexLabel(ctx, u.hex)} (§23.3)`, side: u.side, units: [u.id], hexes: [target], from: u.hex, to: target });
}

function cliffBetween(ctx: Ctx, a: HexKey, b: HexKey): boolean {
  const ha = parseHexKey(a);
  for (const d of DIRECTIONS) if (hexKey(neighbor(ha, d)) === b) return !!ctx.map.hexsides[hexsideKey(ha, d)]?.cliff;
  return false;
}

/** At the start of Advancing Fire: a charge is live if its engineer came through Defensive Fire unbroken (§23.3). */
export function armCharges(ctx: Ctx, s: GameState, emit: Emit): void {
  for (const c of s.charges) {
    if (c.armed || c.side !== s.phasing) continue;
    const p = s.units[c.placer];
    if (p && !p.broken) {
      c.armed = true;
      continue;
    }
    // The charge stays behind as a loose weapon in the placement hex.
    const w = s.weapons[c.weapon];
    if (w) w.hex = c.from;
    emit({ kind: 'info', text: `The charge on ${hexLabel(ctx, c.target)} was not set: its engineers ${p ? 'broke' : 'were lost'} (§23.3)`, side: c.side, hexes: [c.target] });
  }
  s.charges = s.charges.filter((c) => c.armed || c.side !== s.phasing);
}

/** Unexploded charges are gone at the end of Advancing Fire (§23.4). */
export function expireCharges(ctx: Ctx, s: GameState, emit: Emit): void {
  for (const c of s.charges.filter((x) => x.side === s.phasing)) {
    delete s.weapons[c.weapon];
    emit({ kind: 'info', text: `The charge on ${hexLabel(ctx, c.target)} was not used and is lost (§23.4)`, side: c.side });
  }
  s.charges = s.charges.filter((c) => c.side !== s.phasing);
}

// ---- Concealment (§25) ----------------------------------------------------------------------

/** Concealment may be placed only in woods or buildings (§25.3). */
export function concealableHex(ctx: Ctx, hex: HexKey): boolean {
  const t = ctx.map.hexes[hex]?.terrain;
  return t === 'woods' || t === 'woodBuilding' || t === 'stoneBuilding';
}

/**
 * Everyone concealed in a hex loses it (§25.4, §25.42, §25.9), and anything
 * placed hidden there (units, guns, vehicles) goes on the map (§42.2).
 */
export function reveal(ctx: Ctx, s: GameState, hex: HexKey, emit: Emit, why: string): void {
  const shown = unitsIn(s, hex).filter((u) => u.concealed || u.hidden);
  const guns = Object.values(s.vehicles).filter((v) => v.hex === hex && v.hidden);
  if (!shown.length && !guns.length) return;
  const wasHidden = guns.length > 0 || shown.some((u) => u.hidden);
  for (const v of guns) v.hidden = false;
  for (const u of shown) {
    u.concealed = false;
    u.hidden = false;
  }
  const text = wasHidden ? `Hidden position revealed in ${hexLabel(ctx, hex)}: ${why} (§42.2)` : `Concealment lost in ${hexLabel(ctx, hex)}: ${why} (§25.4)`;
  emit({ kind: 'info', text, side: (shown[0] ?? guns[0])!.side, hexes: [hex], units: shown.map((u) => u.id) });
}

/** Unbroken enemy infantry next to concealed units strips their concealment (§25.4–25.5). */
export function revealAdjacent(ctx: Ctx, s: GameState, emit: Emit): void {
  // At night, concealment survives enemies next door (§49.3); hidden units do not (§42.2).
  const night = !!ctx.scenario.night;
  const hexes = new Set(Object.values(s.units).filter((u) => u.hidden || (u.concealed && !night)).map((u) => u.hex));
  for (const v of Object.values(s.vehicles)) if (v.hidden) hexes.add(v.hex);
  for (const h of hexes) {
    const side = unitsIn(s, h).find((u) => u.concealed || u.hidden)?.side ?? Object.values(s.vehicles).find((v) => v.hex === h)!.side;
    const near = DIRECTIONS.some((d) => {
      const n = hexKey(neighbor(parseHexKey(h), d));
      return enemiesIn(s, n, side).some((e) => !e.broken);
    });
    if (near || enemiesIn(s, h, side).length) reveal(ctx, s, h, emit, 'enemy infantry adjacent');
  }
}

/**
 * End of a player turn: the moving player's units that neither moved, fired,
 * made smoke nor took a morale check, and are not next to the enemy, gain
 * concealment in woods or buildings (§25.3).
 */
export function gainConcealment(ctx: Ctx, s: GameState, emit: Emit): void {
  if (ctx.scenario.rulesLevel < 25) return;
  const night = !!ctx.scenario.night;
  const gained: Unit[] = [];
  for (const u of Object.values(s.units)) {
    if (u.side !== s.phasing || u.concealed || u.hidden || u.noConceal || u.berserk) continue;
    if (inMelee(s, u.hex)) continue;
    // At night, any terrain and next to the enemy (§49.5).
    if (!night && !concealableHex(ctx, u.hex)) continue;
    const near = DIRECTIONS.some((d) => enemiesIn(s, hexKey(neighbor(parseHexKey(u.hex), d)), u.side).length > 0);
    if (near && !night) continue;
    u.concealed = true;
    gained.push(u);
  }
  if (gained.length) {
    const hexes = [...new Set(gained.map((u) => u.hex))];
    emit({ kind: 'info', text: `${hexes.length} stack${hexes.length === 1 ? '' : 's'} slip under cover and are concealed (§25.3)`, side: s.phasing, hexes });
  }
}

/** Scenario concealment counters at setup (§25.6): the side's stacks in woods and buildings, biggest first. */
export function setupConcealment(ctx: Ctx, s: GameState, side: SideId, emit: Emit): void {
  const n = ctx.scenario.concealment?.[side] ?? 0;
  if (!n) return;
  const byHex = new Map<HexKey, Unit[]>();
  for (const u of Object.values(s.units)) if (u.side === side && concealableHex(ctx, u.hex)) (byHex.get(u.hex) ?? byHex.set(u.hex, []).get(u.hex)!).push(u);
  const hexes = [...byHex.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, n);
  for (const [, us] of hexes) for (const u of us) u.concealed = true;
  if (hexes.length) emit({ kind: 'info', text: `${s.sides.find((x) => x.id === side)?.name ?? side} conceal ${hexes.length} stack${hexes.length === 1 ? '' : 's'} (§25.6)`, side });
}

// ---- Fanaticism (§26) ----------------------------------------------------------------------

/** −1 to morale checks and rally attempts for fanatic units (§26.1). */
export function fanaticDrm(ctx: Ctx, u: Unit): number {
  for (const f of ctx.scenario.fanatic ?? []) {
    if (f.side !== u.side) continue;
    const key = ctx.map.byId[f.building];
    const b = key ? ctx.map.hexes[key]?.building : undefined;
    if (b && ctx.map.hexes[u.hex]?.building === b) return -1;
  }
  return 0;
}

// ---- Sewer movement (§27) -------------------------------------------------------------------

export function isSewerEntrance(ctx: Ctx, s: GameState, hex: HexKey): boolean {
  return !!ctx.map.hexes[hex]?.sewer && !s.closedSewers.includes(hex);
}

export function sewerMove(ctx: Ctx, s: GameState, ids: readonly string[], to: HexKey, emit: Emit): void {
  if (!ctx.scenario.sewers) throw new RuleError('This scenario does not allow sewer movement', '§27');
  if (s.phase !== 'movement' || s.awaiting !== s.phasing) throw new RuleError('Sewer movement happens in your Movement Phase', '§27.2');
  const units = ids.map((id) => s.units[id]);
  if (!units.length || units.some((u) => !u || u.side !== s.phasing)) throw new RuleError('Choose your own units');
  const us = units as Unit[];
  const from = us[0]!.hex;
  if (us.some((u) => u.hex !== from)) throw new RuleError('The stack moves together', '§27.22');
  for (const u of us) {
    if (u.broken || u.berserk) throw new RuleError(`${unitLabel(ctx, u)} cannot use the sewers`);
    if (u.mfSpent > 0 || u.moveDone || u.firedPhase === 'prepFire') throw new RuleError('Sewer movement must be announced before the units move', '§27.1');
    for (const w of carried(s, u)) if (weaponType(ctx, w).kind === 'HMG') throw new RuleError('HMGs cannot go through the sewers', '§27.3');
  }
  if (!isSewerEntrance(ctx, s, from)) throw new RuleError('Units must start in a sewer entrance', '§27.1');
  if (us.some((u) => !isLeader(ctx, u)) && !us.some((u) => isLeader(ctx, u))) throw new RuleError('Squads need a leader with them in the sewers', '§27.21');
  if (!isSewerEntrance(ctx, s, to) || to === from) throw new RuleError('End on another sewer entrance', '§27.2');
  if (range(from, to) > 3) throw new RuleError('At most three hexes through the sewers', '§27.22');
  const roll = d6(s);
  for (const id of s.moving) if (s.units[id]) s.units[id]!.moveDone = true;
  s.moving = [];
  if (roll >= 5) {
    // Lost in the tunnels: back next Movement Phase at an entrance the opponent picks (§27.22).
    const lost = us.map((u) => ({ ...u, moveDone: true }));
    const ws = us.flatMap((u) => carried(s, u));
    for (const u of us) delete s.units[u.id];
    for (const w of ws) delete s.weapons[w.id];
    s.lostInSewers.push({ units: lost, weapons: ws, from, side: s.phasing });
    emit({ kind: 'info', text: `${us.map((u) => unitLabel(ctx, u)).join(', ')} go down the sewer at ${hexLabel(ctx, from)} and lose their way (rolled ${roll}, §27.22)`, side: s.phasing, dice: [roll], units: [...ids], hexes: [from] });
    return;
  }
  const enemyHeld = enemiesIn(s, to, s.phasing).length > 0;
  for (const u of us) {
    u.hex = to;
    for (const w of carried(s, u)) w.hex = to;
    u.mfSpent = 99;
    u.moved = true;
    u.moveDone = true;
    u.noConceal = true;
    u.concealed = false;
    u.sewerAssault = enemyHeld;
    // Immune to fire except where they come up (§27.4).
    s.tracks[u.id] = [{ hex: to, mf: 0, open: enemyHeld, ...(enemyHeld ? { sewer: true } : {}) }];
  }
  // Coming up unseen in a building away from the enemy: concealed (§27.5).
  const building = ctx.map.hexes[to]?.building;
  const adjacentInBuilding =
    !!building &&
    DIRECTIONS.some((d) => {
      const n = hexKey(neighbor(parseHexKey(to), d));
      return ctx.map.hexes[n]?.building === building && enemiesIn(s, n, s.phasing).length > 0;
    });
  if (!enemyHeld && !adjacentInBuilding) for (const u of us) u.concealed = true;
  emit({
    kind: 'move',
    text: `${us.map((u) => unitLabel(ctx, u)).join(', ')} move through the sewers ${hexLabel(ctx, from)} → ${hexLabel(ctx, to)} (rolled ${roll} ≤ 4, §27.22)${enemyHeld ? ' into an enemy-held entrance (§27.7)' : ''}`,
    side: s.phasing,
    dice: [roll],
    units: [...ids],
    from,
    to,
  });
}

/** Units lost in the sewers come up at the start of their side's next Movement Phase (§27.22). */
export function returnLostUnits(ctx: Ctx, s: GameState, emit: Emit): void {
  const mine = s.lostInSewers.filter((l) => l.side === s.phasing);
  if (!mine.length) return;
  s.lostInSewers = s.lostInSewers.filter((l) => l.side !== s.phasing);
  const objectives = ctx.objectives.flatMap((o) => o.hexes);
  for (const l of mine) {
    // The opponent picks the entrance within 6 hexes: the one farthest from the objectives.
    const options = Object.values(ctx.map.hexes)
      .filter((h) => isSewerEntrance(ctx, s, h.key) && range(h.key, l.from) <= 6 && !enemiesIn(s, h.key, l.side).length)
      .map((h) => ({ k: h.key, d: Math.min(...objectives.map((o) => range(o, h.key))) }))
      .sort((a, b) => b.d - a.d || a.k.localeCompare(b.k));
    const at = options[0]?.k ?? l.from;
    for (const u of l.units) {
      s.units[u.id] = { ...u, hex: at, moveDone: true, mfSpent: 99, concealed: false };
    }
    for (const w of l.weapons) s.weapons[w.id] = { ...w, hex: at };
    emit({ kind: 'info', text: `The lost party surfaces at ${hexLabel(ctx, at)} (§27.22)`, side: l.side, hexes: [at], units: l.units.map((u) => u.id) });
  }
}
