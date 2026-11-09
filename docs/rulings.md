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
| §22 flamethrower data | The rulebook text (20 FP, range 2, out of fuel on an unmodified 9+) takes precedence over the transcribed support-weapon card. Flamethrowers have no MG penetration, and leadership never modifies them. | `content/rules/weapons.json`, `engine/rules/fire.ts` |
| §22.4, §23.2 who operates | Assault-engineer squads (`assaultEngineer` in `units.json`) and −2/−3 leaders. The Soviet Guards SMG squad (6-2-8) carries the flag, so it may lay smoke and use charges. | `engine/rules/special.ts` |
| §23.3 arming a charge | A placed charge is armed if its placer is still unbroken when its side's Advancing Fire begins. If the placer broke or died, the charge stays behind as an abandoned weapon in the placing hex. | `engine/rules/special.ts` |
| §24.3 smoke first | Smoke may be laid only while no attack has been made in the Prep Fire Phase. Each engineer squad lays one counter in its own or an adjacent hex, up to the scenario's smoke allowance. | `engine/rules/special.ts` |
| §25 concealment placement | Scenario concealment goes on the side's biggest stacks in woods or buildings, without asking the player. There are no dummy counters yet (§25.7). Concealment is regained at the end of the owner's player turn by units that did not move, fire, make smoke, place a charge or take a morale check, in woods or buildings, with no enemy adjacent. | `engine/rules/special.ts` |
| §25 who sees concealed units | A human playing against the computer sees each enemy concealed stack as one "?" counter. Hot-seat and AI vs AI games show everything with a "?" badge. The LLM opponent sees only "concealed stack at X". The scripted bot sees through concealment. | `web/game/fog.ts`, `agent/serialize.ts` |
| §27.22 lost in the sewers | The opponent's choice of entrance is made automatically: an open entrance within 6 hexes of the starting point, not enemy-held, farthest from every objective. | `engine/rules/special.ts` |
| §27.7 sewer fights | Units come up in an enemy-held entrance at point blank. Defensive Fire against them ignores terrain and gets −2. Fire into that hex hits only the other side; it is not treated as a melee. A broken arrival is eliminated. | `engine/rules/fire.ts`, `engine/rules/morale.ts` |
| Q&A 27.3 portage in the sewers | Not yet enforced: a squad need not be able to move 3 hexes after portage to go underground. HMGs are refused (§27.3). | — |
| Sewer entrances on the city boards | Manholes are generated along the paved streets so that each entrance has another within the 3 hexes a sewer move allows, and the networks of City A and City B join when B lies north of A. | `content/scripts/build-boards.ts` |
| §29.4 covered arc | The arc is the hex sector between the two front hexside rows (the gun points at the spine between them). Facing is stored as the pair of front hexsides, e.g. N-NE. | `engine/rules/armor.ts` |
| §30.5, Q&A 30.4 turning | Turning in the starting hex costs 2 MP (once per turn); entering a hex outside the arc from the starting hex costs +2 MP. After the vehicle has entered a new hex, it may face any way for free. | `engine/rules/armor.ts` |
| §30 chart "0 MP + COT" | Wall and hedge hexsides and shellholes add nothing for vehicles. | `content/rules/armor.json` |
| §33.9 crew survival | The survival numbers printed on the wreck counters were not transcribed; every vehicle uses 3. | `content/rules/vehicles.json` |
| §32.3 vehicles and LOS | Vehicles and wrecks don't block LOS. A vehicle or wreck in the hex just before the target gives that hex the wall modifier (+2), or makes an AFV there hull down. | `engine/rules/fire.ts`, `engine/rules/armor.ts` |
| §35.6 overrun timing | The overrun attack is resolved as the AFV enters the hex, before any Defensive Fire. The §35.7 limit on Defensive Fire from an open overrun hex is not applied. | `engine/rules/armor.ts` |
| Defensive Fire on moving AFVs | Fire at a vehicle that moved targets its final hex (with case A, +2). The target facing is its facing there. | `engine/rules/armor.ts` |
| §36.11, §36.4 leaders in AFV attacks | The best leader in the hex modifies every unit's pre-attack check and immobilization roll in Defensive Fire; in close assault one leader's modifier applies to one attack. A close-assault kill leaves no surviving crew. | `engine/rules/armor.ts` |
| Infantry MGs against AFVs | Not offered: the MMG/HMG kill numbers against tanks and SP guns are below 2. | — |
| Vehicles and victory | Vehicles do not control buildings. A side with only vehicles left is not eliminated. | `engine/rules/victory.ts` |
| Not yet implemented | Riders (§31), canister (§34.9), bazooka HE against infantry (§37.47), pushing wrecks (§40.4), tank-fired smoke (§41.3), captured vehicles. | — |
| Victory: "control" | A building is controlled by the side that has an unbroken unit in it and no enemy unit in any of its hexes. | `engine/rules/victory.ts` |
| Sudden death | A side with no units left loses at once. | `engine/rules/victory.ts` |
