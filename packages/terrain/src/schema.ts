import { z } from 'zod';

/** Base terrain of a hex. Buildings carry a building id so multi-hex buildings can be grouped. */
export const HEX_TERRAIN = ['open', 'woods', 'woodBuilding', 'stoneBuilding', 'wheat', 'water'] as const;
export type HexTerrain = (typeof HEX_TERRAIN)[number];

export const BoardHexSchema = z
  .object({
    /** Base terrain (default open ground). */
    t: z.enum(HEX_TERRAIN).optional(),
    /** Elevation level 0–3 (§43). The level under the centre dot (§43.14). */
    lv: z.number().int().min(0).max(3).optional(),
    /** Building id, local to the board; hexes sharing an id form one building. */
    b: z.string().min(1).optional(),
    /** Shellholes (§44.3). */
    sh: z.literal(true).optional(),
    /** Sewer entrance (§27). */
    sw: z.literal(true).optional(),
    /** Stairway (§57). */
    st: z.literal(true).optional(),
  })
  .strict()
  .refine((h) => !(h.t === 'woodBuilding' || h.t === 'stoneBuilding') || h.b, {
    message: 'building hexes need a building id (b)',
  });
export type BoardHex = z.infer<typeof BoardHexSchema>;

export const ROAD_KINDS = ['paved', 'dirt'] as const;

export const BoardHexsideSchema = z
  .object({
    wall: z.literal(true).optional(),
    hedge: z.literal(true).optional(),
    cliff: z.literal(true).optional(),
    road: z.enum(ROAD_KINDS).optional(),
  })
  .strict();
export type BoardHexside = z.infer<typeof BoardHexsideSchema>;

/** Local hex id on a board: column letters + row number, e.g. "K5", "GG10". */
export const LOCAL_HEX_ID = /^([A-Z]|AA|BB|CC|DD|EE|FF|GG)(10|[0-9])$/;
/** Local hexside id: local hex id + "/" + direction name, e.g. "K5/NE". */
export const LOCAL_HEXSIDE_ID = /^([A-Z]|AA|BB|CC|DD|EE|FF|GG)(10|[0-9])\/(N|NE|SE|S|SW|NW)$/;

export const BoardSchema = z
  .object({
    format: z.literal('squadwar-board@1'),
    /** Single capital letter; becomes the prefix of display ids ("A-K5"). */
    id: z.string().regex(/^[A-Z]$/),
    name: z.string().min(1),
    kind: z.enum(['city', 'country']),
    /** Seed for the deterministic jitter of woods outlines. */
    seed: z.number().int().optional(),
    hexes: z.record(z.string().regex(LOCAL_HEX_ID), BoardHexSchema),
    hexsides: z.record(z.string().regex(LOCAL_HEXSIDE_ID), BoardHexsideSchema),
  })
  .strict();
export type BoardDef = z.infer<typeof BoardSchema>;

export const BoardPlacementSchema = z
  .object({
    board: z.string().regex(/^[A-Z]$/),
    /** Grid position of the board: x boards to the right, y boards down. */
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    /** Rotate the board 180°. */
    rot: z.union([z.literal(0), z.literal(180)]).optional(),
  })
  .strict();
export type BoardPlacement = z.infer<typeof BoardPlacementSchema>;

export const MapLayoutSchema = z.array(BoardPlacementSchema).min(1);
export type MapLayout = z.infer<typeof MapLayoutSchema>;
