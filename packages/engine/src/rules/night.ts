/**
 * Night (§49): a visibility range rolled each game turn, gun flashes that give
 * firers away, and starshells that light up the ground around them.
 */
import type { HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { roll2d6 } from '../rng';
import { enemiesIn, hexLabel, isLeader, range, unitLabel } from '../queries';
import { RuleError, type GameState } from '../types';
import type { Emit } from './common';

/** Lit by a starshell within 3 hexes (§49.7). */
export function illuminated(s: GameState, hex: HexKey): boolean {
  return (s.starshells ?? []).some((x) => range(x.hex, hex) <= 3);
}

/**
 * Can a unit at `from` see `to` well enough to fire at night (§49.1–49.2)?
 * 'clear': within the visibility range or lit; 'flash': only by the target's
 * gun flashes, as area fire; 'none': not at all. Daylight scenarios are always clear.
 */
export function nightSight(ctx: Ctx, s: GameState, from: HexKey, to: HexKey, movingVehicle = false): 'clear' | 'flash' | 'none' {
  if (!ctx.scenario.night) return 'clear';
  const vis = (s.nightVis ?? 2) + (movingVehicle ? 3 : 0);
  if (range(from, to) <= vis || illuminated(s, to)) return 'clear';
  const f = s.flashes ?? { now: [], prev: [] };
  if (f.now.includes(to) || f.prev.includes(to)) return 'flash';
  return 'none';
}

export function noteFlash(s: GameState, hex: HexKey): void {
  if (!s.flashes) return;
  if (!s.flashes.now.includes(hex)) s.flashes.now.push(hex);
}

/** Start of a player turn: last turn's flashes become "preceding" ones. */
export function rotateFlashes(s: GameState): void {
  if (!s.flashes) return;
  s.flashes = { now: [], prev: s.flashes.now };
}

/** End of the first Rally Phase of each game turn: roll the night visibility range (§49.11). */
export function rollNightVisibility(ctx: Ctx, s: GameState, emit: Emit): void {
  if (!ctx.scenario.night || s.half !== 0) return;
  const [a, b] = roll2d6(s);
  s.nightVis = a + b;
  emit({ kind: 'info', text: `Night visibility this turn: ${a + b} hexes, ${a + b + 3} for moving vehicles (§49.11)`, dice: [a, b] });
}

/** A leader who sees the enemy fires a starshell within 5 hexes, at the end of the Rally Phase (§49.6). */
export function fireStarshell(ctx: Ctx, s: GameState, unitId: string, hex: HexKey, emit: Emit): void {
  if (!ctx.scenario.night) throw new RuleError('Starshells are for night scenarios', '§49.6');
  if (s.phase !== 'rally') throw new RuleError('Starshells go up at the end of the Rally Phase', '§49.6');
  const u = s.units[unitId];
  if (!u || u.side !== s.awaiting || !isLeader(ctx, u) || u.broken) throw new RuleError('An unbroken leader of yours fires starshells', '§49.6');
  if (!ctx.map.hexes[hex] || range(u.hex, hex) > 5) throw new RuleError('Within 5 hexes of the leader', '§49.6');
  const left = s.starshellsLeft?.[u.side] ?? 0;
  if (left <= 0) throw new RuleError('No starshells left');
  const seen = Object.values(s.units).some((e) => e.side !== u.side && ctx.los(u.hex, e.hex).clear && range(u.hex, e.hex) <= (s.nightVis ?? 2));
  if (!seen) throw new RuleError('The leader must see enemy units within the night visibility range', '§49.6');
  if ((s.starshells ?? []).some((x) => x.side === u.side && x.hex === hex)) throw new RuleError('A starshell is already there');
  s.starshellsLeft![u.side] = left - 1;
  (s.starshells ??= []).push({ hex, side: u.side });
  emit({ kind: 'info', text: `${unitLabel(ctx, u)} fires a starshell over ${hexLabel(ctx, hex)}: lit for 3 hexes around (§49.6–49.7)`, side: u.side, units: [u.id], hexes: [hex], fx: { starshell: hex } });
  void enemiesIn;
}

/** Starshells burn out after the Close Combat Phase that follows them (§49.6). */
export function clearStarshells(s: GameState): void {
  if (s.starshells) s.starshells = [];
}
