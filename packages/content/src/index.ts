/**
 * Game content: boards, scenarios, unit data and rules tables.
 * Data is exported raw; consumers validate it with the matching schema.
 */
import boardA from '../boards/A.json';

export const rawBoards: Readonly<Record<string, unknown>> = { A: boardA };
