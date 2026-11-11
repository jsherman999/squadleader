/**
 * Game content: boards, scenarios, unit data and rules tables.
 * Data is exported raw; consumers validate it with the matching schema.
 */
import boardA from '../boards/A.json';
import boardB from '../boards/B.json';
import boardC from '../boards/C.json';
import boardD from '../boards/D.json';
import boardE from '../boards/E.json';
import tables from '../rules/tables.json';
import units from '../rules/units.json';
import weapons from '../rules/weapons.json';
import vehicles from '../rules/vehicles.json';
import armor from '../rules/armor.json';
import artillery from '../rules/artillery.json';
import s1 from '../scenarios/s1.json';
import s2 from '../scenarios/s2.json';
import s3 from '../scenarios/s3.json';
import s4 from '../scenarios/s4.json';
import s5 from '../scenarios/s5.json';
import s6 from '../scenarios/s6.json';
import s7 from '../scenarios/s7.json';
import s8 from '../scenarios/s8.json';
import s9 from '../scenarios/s9.json';
import s10 from '../scenarios/s10.json';
import s11 from '../scenarios/s11.json';
import s12 from '../scenarios/s12.json';
import s8r1 from '../scenarios/legacy/s8-r1.json';

export const rawBoards: Readonly<Record<string, unknown>> = { A: boardA, B: boardB, C: boardC, D: boardD, E: boardE };

export const rawRules: {
  readonly units: unknown;
  readonly weapons: unknown;
  readonly tables: unknown;
  readonly vehicles: unknown;
  readonly armor: unknown;
  readonly artillery: unknown;
} = {
  units,
  weapons,
  tables,
  vehicles,
  armor,
  artillery,
};

/** Scenarios in play order. */
export const rawScenarios: readonly unknown[] = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12];

/**
 * Earlier revisions of scenarios whose forces have since changed, with the id "<scenario>@<revision>".
 * They are not offered for new games: games saved on them replay against them.
 */
export const rawLegacyScenarios: readonly unknown[] = [s8r1];
