import type { HexKey } from '@squadwar/hex';
import { hexLabel, unitLabel, type Action, type Ctx, type GameState } from '@squadwar/engine';

/** A short, plain description of an action, for lists. */
export function actionSummary(ctx: Ctx, s: GameState, a: Action): string {
  const units = (ids: readonly string[]) => ids.map((id) => (s.units[id] ? unitLabel(ctx, s.units[id]!) : id)).join(', ');
  switch (a.type) {
    case 'move':
      return `${units(a.units)} → ${hexLabel(ctx, a.to)}`;
    case 'endMove':
      return `${units(a.units)} stop`;
    case 'fire':
      return `Fire at ${hexLabel(ctx, a.target)}`;
    case 'advance':
      return `${units(a.units)} advance → ${hexLabel(ctx, a.to)}`;
    case 'rally':
      return `Rally ${units([a.unit])}`;
    case 'repair':
      return 'Repair a weapon';
    case 'endPhase':
      return 'End phase';
    case 'place':
      return `Place ${units([a.unit])} in ${hexLabel(ctx, a.hex)}`;
    case 'rout':
      return `${units([a.unit])} rout${a.to ? ` → ${hexLabel(ctx, a.to)}` : ''}`;
    case 'closeCombat':
      return `Close combat in ${hexLabel(ctx, a.hex)}`;
    case 'transfer':
      return 'Hand over a weapon';
  }
}

/** Units an action is about, to highlight on the map. */
export function actionUnits(a: Action | undefined): string[] {
  if (!a) return [];
  switch (a.type) {
    case 'move':
    case 'endMove':
    case 'advance':
      return [...a.units];
    case 'fire':
      return a.firers.map((f) => f.unit);
    case 'rally':
    case 'place':
    case 'rout':
      return [a.unit];
    default:
      return [];
  }
}

export const ACTION_ICON: Record<string, string> = {
  move: '→',
  endMove: '■',
  fire: '✸',
  advance: '⇢',
  rally: '↺',
  repair: '⚙',
  endPhase: '▸',
  place: '⊕',
};

export function hexOf(s: GameState, a: Action | undefined): HexKey | undefined {
  const id = actionUnits(a)[0];
  return id ? s.units[id]?.hex : undefined;
}
