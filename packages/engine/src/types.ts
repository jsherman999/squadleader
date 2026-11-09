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
  /** Under a concealment counter (§25): the enemy can't inspect it; fire at it is Area Fire. */
  concealed: boolean;
  /** Moved, fired, made smoke, placed a charge or took a morale check this player turn: can't gain concealment (§25.3). */
  noConceal: boolean;
  /** Placed smoke this player turn (§24.2). */
  smokeMade: boolean;
  /** Arrived by sewer into an enemy-held entrance this player turn (§27.7). */
  sewerAssault: boolean;
}

/** A tank or self-propelled gun (§28). JSON-serializable. */
export interface Vehicle {
  readonly id: string;
  readonly type: string;
  readonly side: SideId;
  readonly name?: string;
  hex: HexKey;
  /** Covered arc between hexside directions `facing` and `facing + 1` (§29.4). */
  facing: number;
  // ---- per player turn ----
  mpSpent: number;
  /** Entered a new hex this player turn. */
  moved: boolean;
  /** Changed facing in its hex without moving this player turn (To Hit cases E, G). */
  pivoted: boolean;
  moveDone: boolean;
  /** Main gun shots this player turn (§33.2). */
  mainShots: number;
  mgCaUsed: boolean;
  mg360Used: boolean;
  /** Phase the vehicle first fired in this player turn: firing in Prep Fire forbids moving (§33.2). */
  firedPhase: Phase | null;
  /** Hex the main gun fired at this phase: the covered-arc MG may only join it (§28.4). */
  mainTarget: HexKey | null;
  /** Made its one overrun this player turn (§35.8–35.9). */
  overran: boolean;
  /** An SP gun pivoted during this Defensive Fire Phase (case I). */
  dfPivot: boolean;
  // ---- lasting ----
  gun: 'ok' | 'malfunctioned' | 'disabled';
  mg: 'ok' | 'malfunctioned' | 'disabled';
  repairTried: boolean;
  immobilized: boolean;
  /** Crew exposed after using the all-round MG (§34.8). */
  ce: boolean;
  smokeUsed: boolean;
}

export interface Wreck {
  readonly hex: HexKey;
  readonly type: string;
  readonly side: SideId;
}

/** Infantry that advanced onto an enemy AFV to attack it in Close Combat (§36.2). */
export interface AfvAssault {
  readonly unit: string;
  readonly vehicle: string;
  readonly from: HexKey;
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
  /** Came up out of a sewer into an enemy-held entrance: no terrain modifiers, −2 (§27.7A). */
  readonly sewer?: boolean;
}

/** A demolition charge placed on a hex (§23). */
export interface Charge {
  /** The DC weapon's id. */
  readonly weapon: string;
  readonly side: SideId;
  readonly placer: string;
  /** Hex the charge was placed from (§23.3). */
  readonly from: HexKey;
  readonly target: HexKey;
  /** Placed this player turn and the placer survived Defensive Fire unbroken (§23.3–23.4). */
  armed: boolean;
}

export interface Smoke {
  readonly hex: HexKey;
  readonly side: SideId;
}

/** Units lost in the sewers (§27.22), back next Movement Phase. */
export interface LostInSewers {
  readonly units: Unit[];
  readonly weapons: Weapon[];
  readonly from: HexKey;
  readonly side: SideId;
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
  losses: Record<SideId, { squads: number; leaders: number; vehicles?: number }>;
  /** Smoke counters on the map (§24). */
  smoke: Smoke[];
  /** Smoke counters each side has left (§24.1). */
  smokeLeft: Record<SideId, number>;
  /** Demolition charges placed (§23). */
  charges: Charge[];
  /** Sewer entrances closed by a demolition charge (§27.6). */
  closedSewers: HexKey[];
  lostInSewers: LostInSewers[];
  /** Tanks and SP guns (§28). */
  vehicles: Record<string, Vehicle>;
  wrecks: Wreck[];
  /** Hexes each vehicle occupied during this Movement Phase, start included (§36.1, Defensive Fire). */
  vtracks: Record<string, HexKey[]>;
  afvAssaults: AfvAssault[];
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
  /** Assault engineers lay smoke, first thing in Prep Fire (§24.2–24.3). */
  | { readonly type: 'smoke'; readonly unit: string; readonly hex: HexKey }
  /** Place a demolition charge on an adjacent hex during movement (§23.3). */
  | { readonly type: 'placeCharge'; readonly unit: string; readonly weapon: string; readonly target: HexKey }
  /** Explode an armed charge in Advancing Fire (§23.4). */
  | { readonly type: 'detonate'; readonly weapon: string }
  /** Sewer movement to an entrance within 3 hexes (§27). */
  | { readonly type: 'sewer'; readonly units: readonly string[]; readonly to: HexKey }
  /** Set up or turn a vehicle (setup; or pivot during movement, §30.5). */
  | { readonly type: 'face'; readonly vehicle: string; readonly facing: number }
  /** A vehicle moves one hex (§30). */
  | { readonly type: 'vmove'; readonly vehicle: string; readonly to: HexKey }
  | { readonly type: 'vstop'; readonly vehicle: string }
  /** A tank or SP gun fires its main gun or MGs (§33–34). `vs` picks a vehicle in the hex; otherwise infantry. */
  | {
      readonly type: 'vfire';
      readonly vehicle: string;
      readonly target: HexKey;
      readonly weapon: 'main' | 'mg';
      readonly vs?: string;
      readonly ammo?: 'AP' | 'HE';
      readonly mgs?: readonly ('ca' | 'aa')[];
    }
  /** Infantry attack on an AFV: flamethrower, panzerfaust or bazooka (§37), or a Defensive Fire immobilization attempt (§36.1). */
  | { readonly type: 'antiTank'; readonly units: readonly string[]; readonly vehicle: string; readonly weapon?: string }
  /** German smoke dischargers (§41.4). */
  | { readonly type: 'discharge'; readonly vehicle: string }
  /** Repair a vehicle's main gun or MGs in the Rally Phase (§38.1). */
  | { readonly type: 'vrepair'; readonly vehicle: string }
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
