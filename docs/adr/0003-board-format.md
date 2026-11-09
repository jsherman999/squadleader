# 0003: Board files store hex attributes; symbol shapes are generated

**Status:** Accepted. Refines PLAN.md §5.2.

## Decision

- **What a board file stores** (`squadwar-board@1`):
  - per hex: terrain, building id, elevation, shellholes, sewer, stairway;
  - per hexside: wall, hedge, cliff, road.
- **The shapes of woods and building symbols are generated deterministically** from those attributes (`packages/terrain/src/geometry.ts`). The plan had proposed hand-drawn vector layers instead.
  - **Woods** fill most of the hex with an irregular outline. They run right up to any hexside shared with another woods hex, so forests are continuous.
  - **Buildings** are a centre rectangle plus a "bridge" to each neighbouring hex of the same building.
  - **A symbol touches a hexside only when the same obstacle continues across it.** So an LOS traced exactly along a hexside is blocked only when the obstacle lies on both sides of the string (§7.1).
- **Hills** are whole hexes with one level each. Crest lines therefore coincide with hexsides. The rules let a hex contain two levels, with the centre dot deciding (§43.14); this model simplifies that.
- **Boards are geomorphic**: 33 columns × 10 rows, flat-top hexes. The end columns (A, GG) and the odd-column rows 0 and 10 are half hexes, which merge when boards are butted together. Where two half hexes overlap, the board listed first in the layout supplies terrain and the display id.

## Why

- Hex attributes are what designers think in. They are trivial to edit (see the board editor), diff and validate.
- Generated symbols still give LOS the real "symbol, not hex" behaviour the rules need, without anyone drawing polygons by hand.

## Costs

- Odd-shaped woods and buildings, and hills whose crest cuts through a hex, can't be expressed yet. If a scenario needs them, a later format version can add optional explicit polygons per hex.
