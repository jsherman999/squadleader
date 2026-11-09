import { BoardSchema, type BoardDef } from './schema';

export interface BoardIssue {
  readonly where: string;
  readonly message: string;
}

/** Parse and validate a board file. Throws with readable messages on schema errors. */
export function parseBoard(raw: unknown): BoardDef {
  const r = BoardSchema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`invalid board file:\n${msg}`);
  }
  return r.data;
}

/** Design checks beyond the schema (warnings the editor shows). */
export function lintBoard(b: BoardDef): BoardIssue[] {
  const issues: BoardIssue[] = [];
  const material = new Map<string, string>();
  for (const [id, h] of Object.entries(b.hexes)) {
    if (h.b) {
      const prev = material.get(h.b);
      if (prev && prev !== h.t) issues.push({ where: id, message: `building ${h.b} mixes wood and stone` });
      material.set(h.b, h.t ?? 'open');
    }
    if (h.sw && (h.t === 'woods' || h.t === 'water')) issues.push({ where: id, message: 'sewer entrance in woods/water' });
  }
  return issues;
}
