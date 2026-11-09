import { offsetToHex, type Hex } from '@squadwar/hex';

/** Columns per board (A..GG); the first and last are half hexes. */
export const BOARD_COLS = 33;
/** Full rows per board; odd columns have half hexes at rows 0 and 10. */
export const BOARD_ROWS = 10;

const COL_LETTERS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  'AA',
  'BB',
  'CC',
  'DD',
  'EE',
  'FF',
  'GG',
];

export function colLetter(c: number): string {
  const l = COL_LETTERS[c];
  if (!l) throw new Error(`column ${c} out of range`);
  return l;
}

export function colIndex(letters: string): number {
  const i = COL_LETTERS.indexOf(letters);
  if (i < 0) throw new Error(`bad column ${letters}`);
  return i;
}

/** Board-local cell: column index 0..32 and offset row index k. */
export interface LocalCell {
  readonly c: number;
  readonly k: number;
}

/** Printed row number for a local cell: even columns 1..10, odd columns 0..10. */
export function printedRow(cell: LocalCell): number {
  return cell.c % 2 === 0 ? cell.k + 1 : cell.k;
}

export function cellFromPrinted(c: number, row: number): LocalCell {
  return { c, k: c % 2 === 0 ? row - 1 : row };
}

export function localId(cell: LocalCell): string {
  return `${colLetter(cell.c)}${printedRow(cell)}`;
}

export function parseLocalId(id: string): LocalCell {
  const m = /^([A-Z]{1,2})(\d+)$/.exec(id);
  if (!m) throw new Error(`bad local hex id ${id}`);
  return cellFromPrinted(colIndex(m[1]!), Number(m[2]));
}

/** Every cell on a board, including the edge half hexes. */
export function boardCells(): LocalCell[] {
  const out: LocalCell[] = [];
  for (let c = 0; c < BOARD_COLS; c++) {
    const maxK = c % 2 === 0 ? BOARD_ROWS - 1 : BOARD_ROWS;
    for (let k = 0; k <= maxK; k++) out.push({ c, k });
  }
  return out;
}

export function isHalfCell(cell: LocalCell): boolean {
  return cell.c === 0 || cell.c === BOARD_COLS - 1 || (cell.c % 2 === 1 && (cell.k === 0 || cell.k === BOARD_ROWS));
}

/** Rotate a local cell 180° within its board (column parity is preserved). */
export function rotateCell(cell: LocalCell): LocalCell {
  const c = BOARD_COLS - 1 - cell.c;
  const k = cell.c % 2 === 0 ? BOARD_ROWS - 1 - cell.k : BOARD_ROWS - cell.k;
  return { c, k };
}

/** Global axial hex for a local cell on a board placed at grid (x, y). */
export function cellToGlobal(cell: LocalCell, x: number, y: number, rot: 0 | 180 = 0): Hex {
  const cc = rot === 180 ? rotateCell(cell) : cell;
  return offsetToHex({ col: x * (BOARD_COLS - 1) + cc.c, row: y * BOARD_ROWS + cc.k });
}
