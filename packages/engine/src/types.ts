import type { HexKey } from '@squadwar/hex';

export type SideId = string;
export type Nation = 'german' | 'russian' | 'american';

export type Phase =
  | 'setup'
  | 'rally'
  | 'prepFire'
  | 'movement'
  | 'defensiveFire'
  | 'advancingFire'
  | 'rout'
  | 'advance'
  | 'closeCombat'
  | 'gameOver';

export const PLAYER_TURN_PHASES: readonly Phase[] = [
  'rally',
  'prepFire',
  'movement',
  'defensiveFire',
  'advancingFire',
  'rout',
  'advance',
  'closeCombat',
];

export const PHASE_NAMES: Record<Phase, string> = {
  setup: 'Setup',
  rally: 'Rally Phase',
  prepFire: 'Prep Fire Phase',
  movement: 'Movement Phase',
  defensiveFire: 'Defensive Fire Phase',
  advancingFire: 'Advancing Fire Phase',
  rout: 'Rout Phase',
  advance: 'Advance Phase',
  closeCombat: 'Close Combat Phase',
  gameOver: 'Game over',
};

/** A unit on the map: squad, crew or leader. JSON-serializable. */
export interface Unit {
  readonly id: string;
  readonly type: string;
  readonly side: SideId;
  readonly name?: string;
  hex: HexKey;
  broken: boolean;
  berserk: boolean;
  /** Ids of support weapons carried. */
  weapons: string[];
  // ---- per player turn ----
  /** Phase in which the unit fired this player turn (all its fire must be in one phase, Q&A 8.2). */
  firedPhase: Phase | null;
  /** Used its inherent firepower this player turn (§8.2). */
  usedInherent: boolean;
  /** Spent MF in the Movement Phase (moving fire is halved, §9.3). */
  moved: boolean;
  mfSpent: number;
  /** Portage points carried at any time this Movement Phase (Q&A 5.7). */
  ppUsed: number;
  /** Squad moving with a leader for the whole phase (+2 MF, §5.44). */
  withLeader: string | null;
  /** Finished moving this phase (§19.2). */
  moveDone: boolean;
  /** Leader has directed fire this player turn (§15.2). */
  directed: boolean;
  /** Fired on since the last Rally Phase (§14.6). */
  dm: boolean;
  rallyTried: boolean;
  routed: boolean;
  advanced: boolean;
}

export interface Weapon {
  readonly id: string;
  readonly type: string;
  /** Side that brought it (captured use differs). */
  readonly side: SideId;
  hex: HexKey;
  /** Carrying unit, or null when lying in the hex. */
  owner: string | null;
  malfunctioned: boolean;
  usedThisTurn: boolean;
  repairTried: boolean;
}

export interface TrackStep {
  readonly hex: HexKey;
  readonly mf: number;
  /** Open ground for the −2 moving-target DRM (§16.5). */
  readonly open: boolean;
}

export interface SideState {
  readonly id: SideId;
  readonly nation: Nation;
  readonly name: string;
}

export interface CloseCombatAttack {
  readonly attackers: readonly string[];
  readonly defenders: readonly string[];
  readonly leader?: string;
}

export interface GameState {
  readonly v: 1;
  readonly scenario: string;
  readonly seed: number;
  /** PRNG state for dice. */
  rng: number;
  readonly sides: readonly [SideState, SideState];
  turn: number;
  /** 0 = first player turn of the game turn, 1 = second. */
  half: 0 | 1;
  phase: Phase;
  /** Moving player this player turn (the "attacker", §4). */
  phasing: SideId;
  /** Side whose input the engine is waiting for. */
  awaiting: SideId;
  units: Record<string, Unit>;
  weapons: Record<string, Weapon>;
  /** Hexes entered this Movement Phase, per unit (§16.1). */
  tracks: Record<string, TrackStep[]>;
  /** Units currently moving as a group (§19.4). */
  moving: string[];
  /** Attacks made this phase, by firing hex + target (§8.5). */
  attacks: string[];
  /** Close combat designations waiting for resolution, by side then hex. */
  ccPlans: Record<SideId, Record<HexKey, CloseCombatAttack[]>>;
  /** Sides that have finished setting up. */
  setupDone: SideId[];
  /** Units eliminated so far, by side. */
  losses: Record<SideId, { squads: number; leaders: number }>;
  /** Test hook: dice values used before the PRNG. Never set in normal play. */
  diceQueue?: number[];
  winner?: SideId | 'draw';
  result?: string;
}

// ---- Actions ---------------------------------------------------------------

export interface FireUnit {
  readonly unit: string;
  /** Use the unit's inherent firepower. */
  readonly inherent: boolean;
  /** Support weapons the unit fires. */
  readonly weapons: readonly string[];
}

export type Action =
  | { readonly type: 'place'; readonly unit: string; readonly hex: HexKey }
  | { readonly type: 'rally'; readonly unit: string }
  | { readonly type: 'repair'; readonly weapon: string }
  | {
      readonly type: 'fire';
      readonly firers: readonly FireUnit[];
      readonly target: HexKey;
      readonly leader?: string;
    }
  | { readonly type: 'move'; readonly units: readonly string[]; readonly to: HexKey }
  | { readonly type: 'endMove'; readonly units: readonly string[] }
  | { readonly type: 'transfer'; readonly weapon: string; readonly to: string | null }
  | { readonly type: 'rout'; readonly unit: string; readonly to?: HexKey }
  | { readonly type: 'advance'; readonly units: readonly string[]; readonly to: HexKey }
  | { readonly type: 'closeCombat'; readonly hex: HexKey; readonly attacks: readonly CloseCombatAttack[] }
  | { readonly type: 'endPhase' };

// ---- Events ------------------------------------------------------------------

export type EventKind =
  | 'phase'
  | 'dice'
  | 'fire'
  | 'result'
  | 'morale'
  | 'move'
  | 'rally'
  | 'repair'
  | 'breakdown'
  | 'rout'
  | 'advance'
  | 'closeCombat'
  | 'eliminated'
  | 'berserk'
  | 'gameOver'
  | 'info';

export interface GameEvent {
  readonly kind: EventKind;
  /** One-line summary for the combat log. */
  readonly text: string;
  /** Rules trace: the steps behind the result, with § references. */
  readonly trace?: readonly string[];
  readonly side?: SideId;
  readonly units?: readonly string[];
  readonly hexes?: readonly HexKey[];
  readonly from?: HexKey;
  readonly to?: HexKey;
  readonly dice?: readonly number[];
  /** Extra data for animation (firing hexes, weapon kinds, results). */
  readonly fx?: Readonly<Record<string, unknown>>;
}

export class RuleError extends Error {
  constructor(
    message: string,
    readonly rule?: string,
  ) {
    super(rule ? `${message} (${rule})` : message);
    this.name = 'RuleError';
  }
}
