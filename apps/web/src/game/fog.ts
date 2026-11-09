/**
 * Fog of war for concealment (§25). A human playing against the AI sees
 * each enemy concealed stack as one "?" counter: how many units are under
 * it, what they are and what they carry stay hidden until it is revealed.
 * Hot-seat and AI-vs-AI games show everything, with concealed units badged.
 */
import type { HexKey } from '@squadwar/hex';
import type { GameState } from '@squadwar/engine';

export interface FogView {
  /** The state to draw: extra concealed enemy units are removed. */
  readonly s: GameState;
  /** Every enemy unit the viewer cannot identify (including the stack's representative). */
  readonly hidden: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

/** The one side whose view is shown, when exactly one side is played by a human. */
export function viewerOf(controllers: Readonly<Record<string, string>>): string | undefined {
  const humans = Object.entries(controllers).filter(([, c]) => c === 'human');
  return humans.length === 1 ? humans[0]![0] : undefined;
}

export function fogOfWar(s: GameState, viewer: string | undefined): FogView {
  if (!viewer) return { s, hidden: NONE };
  // Hidden initial placement (§42): the enemy is simply not on the map yet.
  const offBoard = new Set(Object.values(s.units).filter((u) => u.side !== viewer && u.hidden).map((u) => u.id));
  const offBoardVehicles = Object.values(s.vehicles).filter((v) => v.side !== viewer && v.hidden).map((v) => v.id);
  if (offBoard.size || offBoardVehicles.length) {
    s = {
      ...s,
      units: Object.fromEntries(Object.entries(s.units).filter(([id]) => !offBoard.has(id))),
      weapons: Object.fromEntries(Object.entries(s.weapons).filter(([, w]) => !w.owner || !offBoard.has(w.owner))),
      vehicles: Object.fromEntries(Object.entries(s.vehicles).filter(([id]) => !offBoardVehicles.includes(id))),
    };
  }
  const hidden = new Set<string>();
  const shown = new Map<HexKey, string>();
  for (const u of Object.values(s.units).sort((a, b) => a.id.localeCompare(b.id))) {
    if (u.side === viewer || !u.concealed) continue;
    hidden.add(u.id);
    if (!shown.has(u.hex)) shown.set(u.hex, u.id);
  }
  if (!hidden.size) return { s, hidden: NONE };
  const keep = new Set(shown.values());
  const units = Object.fromEntries(Object.entries(s.units).filter(([id]) => !hidden.has(id) || keep.has(id)));
  const weapons = Object.fromEntries(Object.entries(s.weapons).filter(([, w]) => !w.owner || !hidden.has(w.owner)));
  return { s: { ...s, units, weapons }, hidden };
}
