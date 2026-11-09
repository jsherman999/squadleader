# Rulings register

Interpretation calls the engine makes where the rulebook is silent, ambiguous, or simplified for now. Each entry gives the rule, the call, and where it lives in the code. Q&A references are to the rulebook's Q&A appendix.

| Rule | Ruling | Code |
|---|---|---|
| §13.6 broken morale | The broken side of each squad uses its printed morale. The rulebook's §12.4 example treats a broken 4-4-7 as needing 7. Values are per unit type in `rules/units.json` and can be changed there. | `content/rules/units.json` |
| §7.1 LOS "string" disputes | A line that clips less than 0.04 hex of a symbol is flagged *marginal* and treated as **blocked** by default. The LOS tool says so. | `los/los.ts` |
| §7.4, §7.9 upper levels | A unit on the upper level of a multi-story (3+ hex) building has height hex level + 2, so it sees over woods and small buildings. For every LOS check either level may be used (`bestLos`). | `los/los.ts` |
| §43.5 crest lines | Crest lines lie on hexsides (ADR 0003). Hexes at the viewer's own level that lie between the two units block a downward view. | `los/los.ts` |
| §6.1 weapon stacking | Only weapons a side carries count toward its 10 PP. Abandoned weapons belong to nobody. | `engine/queries.ts` |
| §6.3 end of movement | The moving player may not end the Movement Phase with an overstacked hex that a unit of theirs moved into or within this phase. Older overstacks (from routs, say) are not his to fix now. | `engine/phases.ts` |
| §8.5 combining fire | Units in a hex may attack a given target hex once per phase. All units in that hex that want to fire at it must do so together. | `engine/rules/fire.ts` |
| §11.6 hexside DRM for fire groups | A wall's +2 applies only if every firing hex's LOS crosses a wall hexside of the target. Otherwise a hedge's +1 applies if every LOS crosses a wall or hedge. Otherwise no hexside DRM. | `engine/rules/fire.ts` |
| §13.41 known enemy positions | These are enemy units that can see the broken unit at the start of its rout. The rout may never bring it closer to any of them, step by step (Q&A 13.41). | `engine/rules/rout.ts` |
| §13.42 normal range | An enemy's normal range is the greater of its own range and the range of the MGs it carries. Leaders without MGs do not count. | `engine/rules/rout.ts` |
| §13.43–13.45 rout destination | The destination is the cheapest woods or building hex in MF that is not adjacent to an enemy and is within stacking limits. If MF runs out first, the unit stops at the last hex along the route where stacking allows, and continues next Rout Phase. Mandatory routs not made by hand take the first cheapest route when the phase ends. | `engine/rules/rout.ts` |
| §15.8 leaders routing with broken units | Not yet implemented. Leaders rout alone (6 MF). | — |
| §17.3 two leaders firing one MG | Not yet implemented. A leader alone fires one MG at half firepower. | — |
| §17.5–17.7 MG penetration | Applies only to attacks made entirely with MGs from one hex at the same level. It covers further hexes along the line through the target up to the smallest penetration factor, each needing its own LOS. It stops after a woods or building hex. A line exactly along a hexside (§17.7) is approximated by the hexes nearest the line. | `engine/rules/fire.ts` |
| §18.4 berserk | Applies to Russian units only, on an unmodified 2 in a morale check caused by enemy fire. A broken unit that goes berserk is restored to good order. | `engine/rules/morale.ts` |
| §18.42 berserk charge | Happens automatically at the start of the berserk unit's Movement Phase. Berserk units adjacent to an enemy advance into it before close combat. | `engine/rules/advance.ts` |
| §19.4 moving one unit or stack at a time | Starting to move another stack finishes the previous one. A stack may drop units off as it goes; those units have then finished moving. | `engine/rules/movement.ts` |
| §20 close combat designations | When a side does not designate attacks by hand, the default is everyone attacking every legal defender at once, with its best leader. | `engine/rules/closeCombat.ts` |
| Victory: "control" | A building is controlled by the side that has an unbroken unit in it and no enemy unit in any of its hexes. | `engine/rules/victory.ts` |
| Sudden death | A side with no units left loses at once. | `engine/rules/victory.ts` |
