import type { HexKey } from '@squadwar/hex';
import { FACING_NAMES, hexLabel, unitLabel, vehicleLabel, type Action, type Ctx, type GameState } from '@squadwar/engine';

/** A short, plain description of an action, for lists. */
export function actionSummary(ctx: Ctx, s: GameState, a: Action): string {
  const units = (ids: readonly string[]) => ids.map((id) => (s.units[id] ? unitLabel(ctx, s.units[id]!) : id)).join(', ');
  const veh = (id: string) => (s.vehicles[id] ? vehicleLabel(ctx, s.vehicles[id]!) : 'vehicle');
  switch (a.type) {
    case 'move':
      return `${units(a.units)} → ${hexLabel(ctx, a.to)}`;
    case 'endMove':
      return `${units(a.units)} stop`;
    case 'fire':
      return `Fire at ${hexLabel(ctx, a.target)}`;
    case 'advance':
      return `${units(a.units)} advance → ${hexLabel(ctx, a.to)}`;
    case 'floor':
      return `${units(a.units)} ${a.upper ? 'go upstairs' : 'come downstairs'}`;
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
    case 'smoke':
      return `Smoke in ${hexLabel(ctx, a.hex)}`;
    case 'placeCharge':
      return `Place a charge on ${hexLabel(ctx, a.target)}`;
    case 'detonate':
      return 'Set off a demolition charge';
    case 'sewer':
      return `${units(a.units)} through the sewers → ${hexLabel(ctx, a.to)}`;
    case 'face':
      return `${veh(a.vehicle)} faces ${FACING_NAMES[a.facing]}`;
    case 'vmove':
      return `${veh(a.vehicle)} → ${hexLabel(ctx, a.to)}`;
    case 'vstop':
      return `${veh(a.vehicle)} stops`;
    case 'vfire':
      return `${veh(a.vehicle)} ${a.weapon === 'main' ? 'fires its gun' : 'fires its MGs'} at ${a.vs ? veh(a.vs) : hexLabel(ctx, a.target)}`;
    case 'antiTank':
      return `${units(a.units)} attack ${veh(a.vehicle)}`;
    case 'discharge':
      return `${veh(a.vehicle)} smoke dischargers`;
    case 'vrepair':
      return `Repair ${veh(a.vehicle)}`;
    case 'starshell':
      return `Starshell over ${hexLabel(ctx, a.hex)}`;
    case 'radio':
      return 'Radio the batteries';
    case 'arty':
      return a.op === 'cancel' ? 'Call off the artillery' : `Artillery ${a.op === 'request' ? 'request' : a.op === 'correct' ? 'correction' : 'fire for effect'} at ${a.hex ? hexLabel(ctx, a.hex) : '?'}`;
    case 'board':
      return `${units(a.units)} climb onto ${veh(a.vehicle)}`;
    case 'unload':
      return `${units(a.units)} get off ${veh(a.vehicle)}`;
    case 'push':
      return `${units([a.unit])} push the gun → ${hexLabel(ctx, a.to)}`;
    case 'enter':
      return `Reinforcements enter at ${hexLabel(ctx, a.hex)}`;
    case 'dig':
      return a.work === 'entrench' ? `${units([a.unit])} dig in` : a.work === 'wire' ? `${units([a.unit])} cut the wire` : `${units([a.unit])} clear mines`;
  }
}

/** Units an action is about, to highlight on the map. */
export function actionUnits(a: Action | undefined): string[] {
  if (!a) return [];
  switch (a.type) {
    case 'move':
    case 'endMove':
    case 'advance':
    case 'floor':
      return [...a.units];
    case 'fire':
      return a.firers.map((f) => f.unit);
    case 'rally':
    case 'place':
    case 'rout':
    case 'smoke':
    case 'placeCharge':
      return [a.unit];
    case 'sewer':
    case 'antiTank':
    case 'board':
    case 'unload':
      return [...a.units];
    case 'starshell':
    case 'radio':
    case 'push':
    case 'dig':
      return [a.unit];
    case 'enter':
      return [...a.units];
    case 'face':
    case 'vmove':
    case 'vstop':
    case 'vfire':
    case 'discharge':
    case 'vrepair':
      return [a.vehicle];
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
  return id ? (s.units[id]?.hex ?? s.vehicles[id]?.hex) : undefined;
}
