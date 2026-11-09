/**
 * Game content: boards, scenarios, unit data and rules tables.
 * Data is exported raw; consumers validate it with the matching schema.
 */
import boardA from '../boards/A.json';
import tables from '../rules/tables.json';
import units from '../rules/units.json';
import weapons from '../rules/weapons.json';
import s1 from '../scenarios/s1.json';

export const rawBoards: Readonly<Record<string, unknown>> = { A: boardA };

export const rawRules: { readonly units: unknown; readonly weapons: unknown; readonly tables: unknown } = {
  units,
  weapons,
  tables,
};

/** Scenarios in play order. */
export const rawScenarios: readonly unknown[] = [s1];
