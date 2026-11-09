/**
 * Rules data: unit types, support weapons, tables and scenarios.
 * Values come from docs/REFERENCE_TABLES.md and live in packages/content.
 */
import { z } from 'zod';
import { MapLayoutSchema } from '@squadwar/terrain';

const Nation = z.enum(['german', 'russian', 'american']);

export const SquadTypeSchema = z
  .object({
    id: z.string(),
    nation: Nation,
    kind: z.enum(['squad', 'crew']),
    name: z.string(),
    fp: z.number(),
    range: z.number().int(),
    morale: z.number().int(),
    /** Morale on the broken side (§13.6). */
    brokenMorale: z.number().int(),
    assaultEngineer: z.boolean().optional(),
  })
  .strict();
export type SquadType = z.infer<typeof SquadTypeSchema>;

export const LeaderTypeSchema = z
  .object({
    id: z.string(),
    nation: Nation,
    kind: z.literal('leader'),
    name: z.string(),
    morale: z.number().int(),
    /** Leadership DRM, usually negative (§15.1). */
    leadership: z.number().int(),
  })
  .strict();
export type LeaderType = z.infer<typeof LeaderTypeSchema>;

export const UnitTypeSchema = z.union([SquadTypeSchema, LeaderTypeSchema]);
export type UnitType = z.infer<typeof UnitTypeSchema>;

export const WeaponTypeSchema = z
  .object({
    id: z.string(),
    nation: Nation,
    kind: z.enum(['LMG', 'MMG', 'HMG', 'FT', 'DC', 'PF', 'BAZ', 'RADIO']),
    name: z.string(),
    fp: z.number(),
    range: z.number().int(),
    /** Malfunctions on an unmodified fire roll at or above this (§18.1). */
    breakdown: z.number().int(),
    /** Portage points when carried by a squad/crew (§5.7). */
    portage: z.number(),
    /** Leader portage points, or null if a leader can't carry it. */
    leaderPortage: z.number().nullable(),
    /** Number of hexes the weapon's fire can penetrate (§2.8, §17.5). */
    penetration: z.number().int(),
  })
  .strict();
export type WeaponType = z.infer<typeof WeaponTypeSchema>;

export const VehicleTypeSchema = z
  .object({
    id: z.string(),
    nation: Nation,
    kind: z.enum(['tank', 'spg', 'halftrack', 'gun', 'truck', 'jeep', 'mortar']),
    name: z.string(),
    /** Movement points (§28.1). */
    mp: z.number(),
    /** Main gun calibre in mm, or null (§28.2). */
    gun: z.number().nullable(),
    /** Overscored gun: HE only (§33.6). */
    heOnly: z.boolean(),
    /** "*" gun: worse at long range (§33.6, To Hit cases B–C). */
    lowVelocity: z.boolean(),
    /** Covered-arc MG and all-round MG firepower (§28.4). */
    mgCA: z.number(),
    mg360: z.number(),
    /** Modifier to the AFV Kill dice roll (§33.41). */
    armor: z.number().int(),
    turret: z.boolean(),
    openTop: z.boolean(),
    /** Crew survival number on the wreck (§33.9). */
    survival: z.number().int(),
    /** Crew counter type that bails out (§33.9). */
    crew: z.string(),
    /** Main gun shots per player turn (M-10, §33.2). */
    rof: z.number().int().optional(),
    /** German smoke dischargers (§41.4). */
    smokeDischarger: z.boolean().optional(),
    /** AT gun crew protection, added to attacks on the crew through the covered arc (§48). */
    shield: z.number().int().optional(),
    /** Riders it carries; default from the armour tables (§31.1, §51.1, §52.1). */
    riders: z.object({ units: z.number().int(), squads: z.number().int() }).strict().optional(),
    /** Fires HEAT (§63.3). */
    heat: z.boolean().optional(),
    howitzer: z.boolean().optional(),
    /** Mortar ranges (§63.21). */
    minRange: z.number().int().optional(),
    maxRange: z.number().int().optional(),
  })
  .strict();
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

const Pair = z.tuple([z.number(), z.number()]);
const KillRow = z.array(z.number());
export const ArmorTablesSchema = z
  .object({
    toHit: z
      .object({
        /** Upper range of each band; beyond the last is the last column. */
        bands: z.array(z.number().int()),
        /** Per target type: [black, red] hit numbers per range band (§33.3). */
        rows: z.record(z.string(), z.array(Pair)),
        drm: z.record(z.string(), z.number()),
      })
      .strict(),
    kill: z.object({ columns: z.array(z.string()), front: KillRow, side: KillRow, rear: KillRow, truck: KillRow }).strict(),
    /** Gun calibre (mm) → infantry firepower equivalent (§34.2). */
    heEquivalent: z.array(Pair),
    movement: z.record(z.string(), z.number()),
    /** Breakdown on entering woods/wooden buildings at or above (§39.1). */
    immobilize: z.record(z.string(), z.number().int()),
    defensiveImmobilize: z.record(z.string(), z.number().int()),
    overrun: z.record(z.string(), z.number()),
    panzerfaust: z.object({ range: z.number().int(), toHit: z.array(Pair) }).strict(),
    bazooka: z.object({ range: z.number().int(), toHit: z.array(Pair), outOfAmmo: z.number().int() }).strict(),
    mgRange: z.number().int(),
    /** Riders per vehicle (§31.1). */
    capacity: z.object({ units: z.number().int(), squads: z.number().int() }).strict(),
    /** Soft vehicles' morale (§51.4). */
    soft: z.object({ morale: z.number().int() }).strict(),
    /** Minefield attacks on vehicles (§55.6). */
    mines: z.record(z.string(), z.number()),
    heat: z.object({ outOf: z.number().int() }).strict(),
  })
  .strict();
export type ArmorTables = z.infer<typeof ArmorTablesSchema>;

export const ArtilleryTablesSchema = z
  .object({
    /** Calibre per die roll 1–6, by nation (§45.2). */
    module: z.record(z.string(), z.array(z.number())),
    /** Radio contact number by nation, as [from year, value] (§46.11). */
    contact: z.record(z.string(), z.array(z.tuple([z.number(), z.number()]))),
    maintain: z.number(),
    /** Initial spotting round lands on target at or under (§46.21). */
    onTarget: z.record(z.string(), z.number()),
    correction: z.number(),
    /** Artillery barrage vs. vehicles (§46.54). */
    vehicles: z.record(z.string(), z.number()),
  })
  .strict();
export type ArtilleryTables = z.infer<typeof ArtilleryTablesSchema>;

const IftResult = z.union([z.literal('KIA'), z.literal('M'), z.literal('-'), z.number().int().min(1).max(4)]);
export type IftResult = 'KIA' | 'M' | '-' | number;

export const TablesSchema = z
  .object({
    ift: z
      .object({
        columns: z.array(z.number()),
        /** rows[i] is the final dice roll i+1 (1..15); each row has one entry per column. */
        rows: z.array(z.array(IftResult)),
      })
      .strict(),
    closeCombat: z
      .object({
        /** Attack/defence ratio at which each column starts, ascending. */
        thresholds: z.array(z.number()),
        labels: z.array(z.string()),
        kill: z.array(z.number().int()),
      })
      .strict(),
    tem: z
      .object({
        open: z.number(),
        woods: z.number(),
        shellhole: z.number(),
        woodBuilding: z.number(),
        stoneBuilding: z.number(),
        wheat: z.number(),
        water: z.number(),
        hedge: z.number(),
        wall: z.number(),
        movingInOpen: z.number(),
      })
      .strict(),
    movement: z
      .object({
        open: z.number(),
        road: z.number(),
        woods: z.number(),
        building: z.number(),
        wheat: z.number(),
        hexsideWallHedge: z.number(),
        /** Water and cliffs are impassable to infantry. */
        squadMF: z.number(),
        leaderMF: z.number(),
        leaderBonus: z.number(),
        squadPortage: z.number(),
        leaderPortage: z.number(),
        advanceSquadPortage: z.number(),
        advanceLeaderPortage: z.number(),
      })
      .strict(),
    stacking: z.object({ units: z.number(), squads: z.number(), portage: z.number() }).strict(),
    desperationMorale: z.number(),
  })
  .strict();
export type Tables = z.infer<typeof TablesSchema>;

const UnitEntry = z
  .object({
    type: z.string(),
    count: z.number().int().min(1).optional(),
    /** Display id of the starting hex, e.g. "A-K5". */
    hex: z.string().optional(),
    names: z.array(z.string()).optional(),
    weapons: z.array(z.string()).optional(),
    /** Hidden initial placement (§42). */
    hidden: z.boolean().optional(),
    /** Starts riding the side's vehicle with this name (§31.9). */
    rides: z.string().optional(),
    /** Reinforcements: enter on this turn along a board edge (§60 for river landings). */
    enters: z.object({ turn: z.number().int().min(1), board: z.string(), edge: z.enum(['N', 'S', 'E', 'W']) }).strict().optional(),
    /** Vehicles: the covered arc, as its two hexsides, e.g. "N-NE" (§29.4). */
    facing: z.enum(['N-NE', 'NE-SE', 'SE-S', 'S-SW', 'SW-NW', 'NW-N']).optional(),
  })
  .strict();

const Zone = z
  .object({
    board: z.string(),
    /** Column letters, inclusive. */
    cols: z.tuple([z.string(), z.string()]),
    /** Printed row numbers, inclusive. Defaults to the whole column. */
    rows: z.tuple([z.number().int(), z.number().int()]).optional(),
  })
  .strict();
export type SetupZone = z.infer<typeof Zone>;

export const VictorySchema = z
  .object({
    /** Side that wins if the condition holds at game end; the other side wins otherwise. */
    side: z.string(),
    text: z.string(),
    controlBuildings: z
      .object({
        /** One display id inside each objective building. */
        buildings: z.array(z.object({ hex: z.string(), name: z.string() }).strict()),
        atLeast: z.number().int(),
      })
      .strict(),
  })
  .strict();
export type Victory = z.infer<typeof VictorySchema>;

export const ScenarioSchema = z
  .object({
    format: z.literal('squadwar-scenario@1'),
    id: z.string(),
    title: z.string(),
    date: z.string(),
    location: z.string(),
    briefing: z.string(),
    /** Highest rule section in force (programmed instruction, e.g. 21). */
    rulesLevel: z.number().int(),
    layout: MapLayoutSchema,
    turns: z.number().int().min(1),
    setupFirst: z.string(),
    moveFirst: z.string(),
    sides: z
      .array(
        z
          .object({
            id: z.string(),
            nation: Nation,
            name: z.string(),
            setup: z.array(Zone),
            units: z.array(UnitEntry),
            notes: z.string().optional(),
          })
          .strict(),
      )
      .length(2),
    victory: VictorySchema,
    specialRules: z.array(z.string()).optional(),
    /** Smoke counters per side (§24.1). */
    smoke: z.record(z.string(), z.number().int().min(0)).optional(),
    /** Concealment counters each side places at setup (§25.6). */
    concealment: z.record(z.string(), z.number().int().min(0)).optional(),
    /** Fanatic units: a side's units inside a building (named by one of its hexes) get −1 on morale and rally (§26). */
    fanatic: z.array(z.object({ side: z.string(), building: z.string() }).strict()).optional(),
    /** Sewer movement allowed (§27). */
    sewers: z.boolean().optional(),
    /** Night scenario (§49), with starshells per side. */
    night: z.boolean().optional(),
    starshells: z.record(z.string(), z.number().int().min(0)).optional(),
    /** Wheatfields in season (§44.24); defaults from the date (June–October). */
    wheat: z.boolean().optional(),
    /** Fortifications placed before play (§53–56, §62). Hexsides as "B-K5/N". */
    fortifications: z
      .object({
        wire: z.array(z.string()).optional(),
        trenches: z.array(z.string()).optional(),
        mines: z.array(z.object({ side: z.string(), hex: z.string(), factors: z.number().int().min(1) }).strict()).optional(),
        bunkers: z
          .array(z.object({ side: z.string(), hex: z.string(), capacity: z.number().int(), ca: z.number().int(), nca: z.number().int(), facing: z.enum(['N-NE', 'NE-SE', 'SE-S', 'S-SW', 'SW-NW', 'NW-N']) }).strict())
          .optional(),
        roadblocks: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    /** Buildings already in ruins at the start (§58), by display id. */
    rubble: z.array(z.string()).optional(),
    /** Snow (§61). */
    snow: z.boolean().optional(),
    /** River crossing (§60): the side lands at most 2d6 squads a turn; these hexes are misty until a 1 is rolled. */
    landing: z.object({ side: z.string(), mist: z.array(z.string()).optional() }).strict().optional(),
    /** Offboard artillery modules (§45): calibre and fire missions, rolled at the start when not given. */
    artillery: z.array(z.object({ side: z.string(), mm: z.number().optional(), missions: z.number().int().optional() }).strict()).optional(),
  })
  .strict();
export type Scenario = z.infer<typeof ScenarioSchema>;

export interface RulesData {
  readonly units: Readonly<Record<string, UnitType>>;
  readonly weapons: Readonly<Record<string, WeaponType>>;
  readonly vehicles: Readonly<Record<string, VehicleType>>;
  readonly tables: Tables;
  readonly armor: ArmorTables;
  readonly artillery: ArtilleryTables;
}

export function parseRulesData(raw: { units: unknown; weapons: unknown; tables: unknown; vehicles: unknown; armor: unknown; artillery: unknown }): RulesData {
  const units = z.array(UnitTypeSchema).parse(raw.units);
  const weapons = z.array(WeaponTypeSchema).parse(raw.weapons);
  const vehicles = z.array(VehicleTypeSchema).parse(raw.vehicles);
  const armor = ArmorTablesSchema.parse(raw.armor);
  const tables = TablesSchema.parse(raw.tables);
  if (tables.ift.rows.length !== 15) throw new Error('IFT needs 15 rows');
  for (const r of tables.ift.rows) if (r.length !== tables.ift.columns.length) throw new Error('IFT row width mismatch');
  return {
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    weapons: Object.fromEntries(weapons.map((w) => [w.id, w])),
    vehicles: Object.fromEntries(vehicles.map((v) => [v.id, v])),
    tables,
    armor,
    artillery: ArtilleryTablesSchema.parse(raw.artillery),
  };
}

export function parseScenario(raw: unknown): Scenario {
  return ScenarioSchema.parse(raw);
}
