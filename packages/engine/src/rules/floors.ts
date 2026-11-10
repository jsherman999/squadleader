/**
 * Upper building levels (§57). A building of three or more hexes has a ground
 * floor and an upper floor in each of its hexes. A unit is on one of them,
 * and sees and is seen from that floor only; the upper floor is two levels
 * up, like a hill (§57.7). Vehicles and guns stay on the ground (§57.6).
 *
 * Rulings (docs/rulings.md): every hex of such a building has stairs; an
 * attack on the hex strikes the units on each floor the whole fire group can
 * see; stacking and close combat are still by the hex.
 *
 * Games saved before the rule have no `floors` option and keep the earlier
 * reading, in which either floor counts, whichever gives a line of sight.
 */
import { canBeUpper, type LosResult } from '@squadwar/los';
import type { HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import type { GameState, Unit } from '../types';

/** Movement factors to go up or down the stairs (§57.3). */
export const STAIRS_MF = 2;

export function floorsOn(s: GameState): boolean {
  return !!s.options?.floors;
}

/** The hex has an upper floor: part of a multi-storey building that still stands. */
export function hasUpper(ctx: Ctx, s: GameState, hex: HexKey): boolean {
  return canBeUpper(ctx.map, hex) && !s.rubble?.includes(hex);
}

/** The unit is on the upper floor of its hex. */
export function isUpper(ctx: Ctx, s: GameState, u: Unit): boolean {
  return floorsOn(s) && u.upstairs === u.hex && !u.riding && hasUpper(ctx, s, u.hex);
}

/** Where something stands for line of sight: its hex, and whether it is upstairs there. */
export interface Post {
  readonly hex: HexKey;
  readonly upper: boolean;
}

export function postOf(ctx: Ctx, s: GameState, u: Unit): Post {
  return { hex: u.hex, upper: isUpper(ctx, s, u) };
}

/** Line of sight between two posts. Without the floors rule, either floor of each hex will do. */
export function losBetween(ctx: Ctx, s: GameState, from: Post, to: Post): LosResult {
  return floorsOn(s) ? ctx.losLevel(from.hex, from.upper, to.hex, to.upper) : ctx.los(from.hex, to.hex);
}

/** Whether one unit can see another, each from its own floor. */
export function unitSees(ctx: Ctx, s: GameState, a: Unit, b: Unit): boolean {
  return a.hex === b.hex || losBetween(ctx, s, postOf(ctx, s, a), postOf(ctx, s, b)).clear;
}

/** Whether a unit can see a hex: its ground floor, or the floor named. */
export function unitSeesHex(ctx: Ctx, s: GameState, a: Unit, hex: HexKey, upper = false): boolean {
  return a.hex === hex || losBetween(ctx, s, postOf(ctx, s, a), { hex, upper }).clear;
}

/** Whether a unit can see any floor of a hex (artillery observation, starshells). */
export function unitSeesAnyFloor(ctx: Ctx, s: GameState, a: Unit, hex: HexKey): boolean {
  return unitSeesHex(ctx, s, a, hex, false) || (floorsOn(s) && hasUpper(ctx, s, hex) && unitSeesHex(ctx, s, a, hex, true));
}

/** The floors of a hex: ground, and the upper floor where there is one. */
export function floorsOfHex(ctx: Ctx, s: GameState, hex: HexKey): boolean[] {
  return floorsOn(s) && hasUpper(ctx, s, hex) ? [false, true] : [false];
}

/**
 * The floors of a target hex that every one of the firing posts can see. Firers in
 * the target hex itself (melee, sewer fights) see both. `blocked` is a line that
 * failed, for the message when nothing can be seen.
 */
export function floorsSeen(ctx: Ctx, s: GameState, posts: readonly Post[], hex: HexKey): { floors: Set<boolean>; blocked?: LosResult; from?: HexKey } {
  const floors = new Set<boolean>();
  let blocked: LosResult | undefined;
  let from: HexKey | undefined;
  for (const upper of floorsOfHex(ctx, s, hex)) {
    let all = true;
    for (const p of posts) {
      if (p.hex === hex) continue;
      const l = losBetween(ctx, s, p, { hex, upper });
      if (!l.clear) {
        all = false;
        if (!blocked) {
          blocked = l;
          from = p.hex;
        }
        break;
      }
    }
    if (all) floors.add(upper);
  }
  return { floors, ...(blocked ? { blocked } : {}), ...(from ? { from } : {}) };
}

/** Plain words for a floor. */
export function floorName(upper: boolean): string {
  return upper ? 'upper floor' : 'ground floor';
}
