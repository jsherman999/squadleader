# 0004: Line-of-sight model

**Status:** Accepted

## Decision

`packages/los` implements the rules' categorical LOS (§7, §11.5, §43, §44.2). It does not use ray-casting realism.

### Heights

- **Unit height** = hex level, plus 2 on the upper level of a multi-story (3+ hex) building. The rules treat a large building like a level 2 hill (§43.12), and §7.4 lets its occupants see over woods and small buildings.
- **Obstacle heights:**
  - woods and small buildings: hex level + 1;
  - multi-story buildings: hex level + 2;
  - hill ground: its level;
  - walls and hedges: + ½, so a level 1 unit sees over them (§43.4).

### Evaluating each obstacle crossed

Obstacles in the firing and target hexes never count (§7.2).

| Situation | Result |
|---|---|
| Both units higher than the obstacle | No effect |
| One unit higher | That unit sees over it. The line is blocked only if the lower unit is in the obstacle's **blind zone** and below the obstacle's height (§7.4, §43.6). |
| Neither unit higher | Blocked |

Two exceptions to the "neither unit higher" row and the blind zone:

- **Same level (§43.7):** bare hill ground never blocks two units that are both at least as high as it.
- **Same hill (§43.61):** crest lines of the higher unit's own hill create no blind zone.

**Blind zone size:** 1 hex behind woods, small buildings and hills; 2 hexes behind multi-story buildings (§43.62); none behind walls and hedges.

### Geometry details

- **Symbols, not hexes.** A symbol blocks only if the line passes through it. Symbols are grown by 0.002 hex so that a line running exactly along a hexside between two woods (or building) hexes counts as blocked (§7.1).
- **Marginal lines.** A line that clips less than 0.04 hex of a symbol is flagged *marginal*. It is blocked by default; an option can treat it as clear.
- **Multi-story occupants.** These may be treated as upper or lower level per attack (§7.9). `bestLos` tries each combination.
- **Wheatfields** are a hindrance (Area Fire), not a block (§44.21).
- **Walls and hedges** block only when crossed between intermediate hexes (§11.51). When the line crosses the target hex's own wall or hedge hexside, that is reported for the TEM modifier (§11.53).

## Why

The categorical model is what the rulebook specifies. Its examples, including blind hexes, same-hill crests and the 2-hex zone behind large buildings, are encoded as tests. Reciprocity (§43.8) is checked by a property test on City A.

## Costs

Because crest lines sit on hexsides (ADR 0003), "trace through a crest line before crossing a hexside" (§43.5) is applied as: hexes of the viewer's own level between the two units block a view downward.
