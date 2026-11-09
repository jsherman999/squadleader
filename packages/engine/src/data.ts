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
    kind: z.enum(['LMG', 'MMG', 'HMG', 'FT', 'DC']),
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
  })
  .strict();
export type Scenario = z.infer<typeof ScenarioSchema>;

export interface RulesData {
  readonly units: Readonly<Record<string, UnitType>>;
  readonly weapons: Readonly<Record<string, WeaponType>>;
  readonly tables: Tables;
}

export function parseRulesData(raw: { units: unknown; weapons: unknown; tables: unknown }): RulesData {
  const units = z.array(UnitTypeSchema).parse(raw.units);
  const weapons = z.array(WeaponTypeSchema).parse(raw.weapons);
  const tables = TablesSchema.parse(raw.tables);
  if (tables.ift.rows.length !== 15) throw new Error('IFT needs 15 rows');
  for (const r of tables.ift.rows) if (r.length !== tables.ift.columns.length) throw new Error('IFT row width mismatch');
  return {
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    weapons: Object.fromEntries(weapons.map((w) => [w.id, w])),
    tables,
  };
}

export function parseScenario(raw: unknown): Scenario {
  return ScenarioSchema.parse(raw);
}
