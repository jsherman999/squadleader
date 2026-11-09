/**
 * The scripted AI for support: offboard artillery (§45–46) and starshells at
 * night (§49), with explained decisions.
 */
import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import { carried, isLeader, range, tryAction, unitLabel, weaponType, type Action, type Battery, type Ctx, type GameState, type Unit } from '@squadwar/engine';
import { hexId, objectiveNear, type Decision } from './explain';

const legal = (ctx: Ctx, s: GameState, a: Action) => tryAction(ctx, s, a).ok;

function area(ctx: Ctx, hex: HexKey): HexKey[] {
  return [hex, ...DIRECTIONS.map((d) => hexKey(neighbor(parseHexKey(hex), d)))].filter((h) => !!ctx.map.hexes[h]);
}

/** How good a blast centre is: enemy units caught, minus own units (§46.5). */
function blastScore(ctx: Ctx, s: GameState, side: string, hex: HexKey): number {
  let score = 0;
  for (const h of area(ctx, hex)) {
    for (const u of Object.values(s.units)) {
      if (u.hex !== h) continue;
      score += u.side === side ? -3 : u.broken ? 0.4 : 1;
    }
    for (const v of Object.values(s.vehicles)) if (v.hex === h) score += v.side === side ? -3 : 0.5;
  }
  return score;
}

function canSee(ctx: Ctx, s: GameState, leader: Unit, hex: HexKey): boolean {
  return leader.hex === hex || (!s.smoke.some((x) => x.hex === hex) && ctx.los(leader.hex, hex).clear);
}

function bestCentre(ctx: Ctx, s: GameState, side: string, leader: Unit, near?: HexKey): { hex: HexKey; score: number } | undefined {
  let best: { hex: HexKey; score: number } | undefined;
  for (const h of Object.values(ctx.map.hexes)) {
    if (near && range(near, h.key) > ctx.data.artillery.correction) continue;
    if (!near && range(leader.hex, h.key) > 16) continue;
    if (!canSee(ctx, s, leader, h.key)) continue;
    const sc = blastScore(ctx, s, side, h.key);
    if (sc > 0 && (!best || sc > best.score)) best = { hex: h.key, score: sc };
  }
  return best;
}

function spotter(ctx: Ctx, s: GameState, side: string, b: Battery): Unit | undefined {
  if (b.leader && s.units[b.leader] && !s.units[b.leader]!.broken) return s.units[b.leader];
  return Object.values(s.units).find(
    (u) => u.side === side && isLeader(ctx, u) && !u.broken && Object.values(s.units).some((x) => x.hex === u.hex && x.side === side && !x.broken && carried(s, x).some((w) => weaponType(ctx, w).kind === 'RADIO' && !w.malfunctioned)),
  );
}

export function artilleryDecision(ctx: Ctx, s: GameState, side: string): Decision | undefined {
  for (const b of s.batteries ?? []) {
    if (b.side !== side || b.used >= b.missions) continue;
    const L = spotter(ctx, s, side, b);
    if (!L) continue;
    if (!b.tried) {
      const a: Action = { type: 'radio', battery: b.id, unit: L.id };
      if (legal(ctx, s, a))
        return {
          action: a,
          why: {
            goal: `${unitLabel(ctx, L)} radios the ${b.mm}mm battery`,
            reasons: [b.contact ? 'Contact must be kept up every Rally Phase, at −2 (§46.12).' : 'No artillery without radio contact (§46.11).', `${b.missions - b.used} fire mission${b.missions - b.used === 1 ? '' : 's'} left.`],
            tip: 'Artillery takes time: contact, a request, the spotting round, then fire for effect. Start early.',
            weight: 'key',
            focus: { from: L.hex },
          },
        };
      continue;
    }
    if (!b.contact || b.acted) continue;
    const op = (o: 'request' | 'correct' | 'ffe' | 'move', hex: HexKey, goal: string, reasons: string[]): Decision | undefined => {
      const a: Action = { type: 'arty', battery: b.id, op: o, hex };
      return legal(ctx, s, a) ? { action: a, why: { goal, reasons, weight: 'key', focus: { from: L.hex, to: hex } } } : undefined;
    };
    if (b.mode === 'idle') {
      const t = bestCentre(ctx, s, side, L);
      if (!t) continue;
      const d = op('request', t.hex, `Call artillery on ${hexId(ctx, t.hex)}`, [`The blast area there holds about ${t.score.toFixed(1)} enemy units worth of targets and none of ours.`, 'The spotting round comes down in the Close Combat Phase, maybe off target (§46.21).']);
      if (d) return d;
    } else if (b.mode === 'sr' && b.hex) {
      const t = bestCentre(ctx, s, side, L, b.hex);
      if (t && t.score >= 1.5) {
        const d = op('ffe', t.hex, `Fire for effect on ${hexId(ctx, t.hex)}${objectiveNear(ctx, t.hex) ? ` by the ${objectiveNear(ctx, t.hex)}` : ''}`, [`${b.mm}mm on the 7-hex blast area, ${ctx.data.artillery.correction} hexes of correction allowed (§46.32).`, `About ${t.score.toFixed(1)} enemy units' worth caught.`]);
        if (d) return d;
      }
      const c = bestCentre(ctx, s, side, L);
      if (c && b.hex && range(b.hex, c.hex) > 0) {
        let step = b.hex;
        for (let i = 0; i < ctx.data.artillery.correction && step !== c.hex; i++) {
          const n = DIRECTIONS.map((dd) => hexKey(neighbor(parseHexKey(step), dd))).filter((h) => ctx.map.hexes[h]).sort((x, y) => range(x, c.hex) - range(y, c.hex))[0];
          if (n) step = n;
        }
        const d = op('correct', step, `Walk the spotting round toward ${hexId(ctx, c.hex)}`, ['Corrections move it up to 3 hexes (§46.31).']);
        if (d) return d;
      }
    } else if (b.mode === 'ffe' && b.hex) {
      const here = blastScore(ctx, s, side, b.hex);
      const t = bestCentre(ctx, s, side, L, b.hex);
      if (t && t.score > here + 0.9) {
        const d = op('move', t.hex, `Shift the barrage to ${hexId(ctx, t.hex)}`, ['A fire for effect may move up to 3 hexes each Rally Phase (§46.33).']);
        if (d) return d;
      }
    }
  }
  return undefined;
}

export function starshellDecision(ctx: Ctx, s: GameState, side: string): Decision | undefined {
  if (!ctx.scenario.night || (s.starshellsLeft?.[side] ?? 0) <= 0) return undefined;
  const vis = s.nightVis ?? 2;
  for (const L of Object.values(s.units)) {
    if (L.side !== side || !isLeader(ctx, L) || L.broken) continue;
    const foes = Object.values(s.units).filter((e) => e.side !== side && range(L.hex, e.hex) <= vis && ctx.los(L.hex, e.hex).clear);
    if (!foes.length) continue;
    let best: { hex: HexKey; n: number } | undefined;
    for (const h of Object.values(ctx.map.hexes)) {
      if (range(L.hex, h.key) > 5) continue;
      if ((s.starshells ?? []).some((x) => range(x.hex, h.key) <= 1)) continue;
      const n = Object.values(s.units).filter((e) => e.side !== side && range(e.hex, h.key) <= 3).length - Object.values(s.units).filter((e) => e.side === side && range(e.hex, h.key) <= 3).length * 0.3;
      if (n > 0 && (!best || n > best.n)) best = { hex: h.key, n };
    }
    if (!best || best.n < 2) continue;
    const a: Action = { type: 'starshell', unit: L.id, hex: best.hex };
    if (!legal(ctx, s, a)) continue;
    return {
      action: a,
      why: {
        goal: `Light up ${hexId(ctx, best.hex)} with a starshell`,
        reasons: [`${unitLabel(ctx, L)} sees enemy within tonight's ${vis}-hex visibility.`, 'Everything within 3 hexes of the starshell can be fired on as in daylight until after Close Combat (§49.6–49.7).'],
        weight: 'key',
        focus: { from: L.hex, to: best.hex },
      },
    };
  }
  return undefined;
}
