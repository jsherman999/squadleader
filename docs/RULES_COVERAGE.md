# Rules Coverage Map

This document maps every section of the supplied 4th Edition rulebook to an engine module, a milestone, and notes on implementation and automation. Section numbers (§) follow the rulebook. Summaries are paraphrased, and the rulebook remains the authority. Numeric values come from [REFERENCE_TABLES.md](REFERENCE_TABLES.md).

**How rules are switched on:**

- Scenarios declare their **rules level**: the § range in force.
- The engine turns modules on to match. This mirrors the rulebook's programmed instruction, where you read up to a "STOP!" marker and then play the matching scenario.
- Optional rules are per-game switches.
- Interpretation calls live in the rulings registry (`docs/rulings.md`, created at M3).

**Automation levels** referred to below are Manual (0), Assisted (1), Streamlined (2) and Delegated (3). They're defined in [PLAN.md §7.8](PLAN.md#78-feature-7-automation).

---

## Game Set I: Infantry in the city (§1–27)

### §1–21 Basic infantry (unlocks scenario 1) — implemented in M3

Exceptions are listed in [rulings.md](rulings.md): leaders accompanying routs (§15.8) and two leaders firing one MG (§17.3) are not yet implemented.

| § | Topic | Module | Implementation notes | MS |
|---|---|---|---|---|
| 1–2 | Introduction, unit counters | `content/units` | **Squads:** FP-range-morale, plus a broken-side morale. **Leaders:** morale and leadership DRM (one leader type has +1). **Support weapons:** FP, range, breakdown number, portage (squad or leader), penetration, whether leader DRMs apply (Δ). | M3 |
| 3 | Mapboard | `hex`, `terrain` | Board + column + row IDs; half-hex merging and ID rule (§3.5); edge half-hexes playable; cumulative terrain (§3.8). Roads and paths are cosmetic only (§3.6). | M1 |
| 4 | Sequence of play | `engine/phases` | Eight phases × 2 player turns per game turn. Prep Fire markers are removed at the end of Advancing Fire. The Turn Record Track advances after both player turns. Assisted: skip empty phases. | M3 |
| 5 | Movement | `rules/movement` | Squad 4 MF, leader 6 MF; +2 MF for squads that move with a leader the whole phase (§5.44). Terrain costs (§5.5); wall or hedge +1 (§5.51); road ½ MF only through a road hexside (§5.52); uphill doubling (§5.53); cumulative costs (§5.54); no entering enemy hexes during Movement (§5.6). **Portage:** squad 3 PP free, leader 1 PP free, −1 MF per extra PP; a leader may carry at most 3 leader PP; capacities don't combine; an Advance may carry 5 PP (squad) or 3 PP (leader); carrying 4+ PP (squad) or 2+ PP (leader) blocks support-weapon fire in Advancing Fire; one SW type per fire phase (§5.7x). | M3 |
| 6 | Stacking | `rules/stacking` | Per side per hex: 4 infantry (≤3 squads) + 10 PP. Checked at the **end** of the Movement Phase (§6.3). After close combat the winner removes excess support weapons (§6.2). | M3 |
| 7 | Basic LOS | `los` | Center dot to center dot. Woods and building **symbols** block, not whole hexes; symbols in the firer's or target's own hex don't block. Blind hex behind an obstacle; multi-story (3+ hex) buildings; seeing up to multi-story buildings; LOS within the same building; adjacent hexes always visible; upper or lower floor chosen per attack (§7.9). Feeds the **LOS Inspector**. | M2 |
| 8 | Fire combat principles | `rules/fire` | One use of inherent and SW firepower per player turn. All occupants of the target hex are affected. Inherent FP can't be split across hexes. **Fire groups:** same or adjacent hexes, chains allowed. Non-predesignated attacks are the default (§8.7). KIA kills every squad and leader. MC results go leaders first, each unit rolling separately. | M3 |
| 9 | Firepower modifiers | `rules/fire` | Point Blank ×2 (×3 for the higher unit across a cliff, §44.1); long range ×½ (out to 2× range); moving ×½ (except flamethrowers); area fire ×½; all cumulative. | M3 |
| 10 | Fire resolution | `rules/fire`, `tables` | Total FP → modifiers → rightmost IFT column not exceeding the total → DRMs → 2d6 → result. Rules trace output. | M3 |
| 11 | Terrain effects | `rules/fire/tem` | Target-hex DRMs, cumulative. Hedge and wall DRMs apply only when the LOS crosses that hexside into the target hex (§11.2, §11.53). The −2 for moving in the open applies only in Defensive Fire (§11.3). Road hexes take the other terrain's DRM (§11.4). Multi-hex fire groups lose hexside DRMs unless every firing hex's LOS crosses the hexside (§11.6). | M3 |
| 12 | Morale | `rules/morale` | Pass on a roll ≤ morale − MC number + leader DRM. Only fire or loss of a leader trigger checks. A leader who fails, breaking or worse, forces a normal MC on the rest of his stack (§12.22). A leader's own DRM doesn't apply to his own check (§12.4). | M3 |
| 13 | Broken units | `rules/rout` | Broken units can't fire. **Rout** pathfinding: they must reach woods or buildings at full speed; they may not reduce range to a known enemy (§13.41); they may not cross open ground in LOS and normal range of an unbroken enemy unless behind a wall or hedge (§13.42); they take the shortest MF route (§13.43); stop rules; staying-put options; elimination if no legal route. They abandon support weapons (MGs can be captured). A broken unit that fails another MC is eliminated. Voluntary break (§13.7). Assisted: the route is chosen automatically, with a prompt on ties. | M3 |
| 14 | Rally | `rules/rally` | Squads need an unbroken leader in the hex; leaders can self-rally without their own DRM. Desperation Morale (−4) if fired on since the last Rally Phase (DM marker). A broken leader must rally himself before rallying others. | M3 |
| 15 | Leadership | `rules/leadership` | Directs one fire group per player turn, and only units in the leader's own hex; DRMs don't stack; can't move after giving the benefit in Prep Fire; applies to MCs and rallies in the hex; the owner picks which leader when several are present; may rout with broken units (§15.8). | M3 |
| 16 | Defensive fire | `rules/defensive` | **Track hexes:** a moving unit is "moved back" to a hex on its path for fire, then on to the next hex or home (§16.1–16.3). Fire must target a hex where the unit spent MF (§16.4). −2 against units that moved in open ground (§16.5); mixed hexes resolve with one roll and per-unit DRMs (§16.6). Vehicles are fired on immediately as they move (§16.7). Feeds **Standing Orders**. | M3 |
| 17 | Machine guns | `rules/fire/mg` | A squad fires one MG or two LMGs free; two MGs above 4 FP cost its inherent FP. A leader fires one MG at ½ FP; two leaders fire it at full FP; a leader manning an MG loses his fire direction. **Penetration** through several hexes along one LOS (§17.5); fire-lane rendering. | M3 |
| 18 | Fate | `rules/fate` | **Breakdown** on an unmodified roll ≥ the B number, affecting all SWs in the group (§18.1). **Repair** on 1d6: 1 fixes, 6 eliminates (§18.2). An unmodified 12 on a rally roll eliminates the unit; a broken leader rolling 12 forces an MC on his hex (§18.3). **Russian berserk** on an unmodified MC roll of 2: immune to MCs, must charge the nearest enemy in LOS, 6 MF (8 MF for leaders), leader-induced berserk via Desperation Morale (§18.4–18.5). | M3 |
| 19 | Procedures of movement and fire | `engine/modes` | Enforced in **By the Book** mode: no take-backs (§19.1–19.2); no potential LOS checks, and declared firers must fire into a blocked LOS (§19.3); one unit moves at a time except leader-led stacks (§19.4). **Study** mode relaxes these. | M3 |
| 20 | Close combat | `rules/cc` | Simultaneous. Odds rounded in the defender's favor; kill number from the table. All attacks designated before any rolls; no unit attacks twice. LMGs add to attack only, with no penetration. Each leader's DRM applies to one predesignated roll. A leader can't be attacked unless alone. A lone leader is worth 1 FP. Melee lock and ongoing melee. Firing into a melee hits both sides. Broken units in a melee are eliminated (§20.9). | M3 |
| 21 | Prepare for play | `scenario/loader` | Board layout; who sets up and moves first; OOB placement in setup zones. | M3 |

### §22–27 Infantry special rules (unlocks scenarios 2–3)

| § | Topic | Module | Notes | MS |
|---|---|---|---|---|
| 22 | Flamethrowers | `rules/special`, `rules/fire` | **Done.** 20 FP, range 2, no DRMs, never combined; engineers or −2/−3 leaders only; −1 to attacks on a hex holding an FT; KIA destroys the support weapons in the hex; out of fuel on 9+. Flame-jet FX. | M8 |
| 23 | Demolition charges | `rules/special`, `rules/fire` | **Done.** Placed on an adjacent hex in Movement, armed if the placer is unbroken at Advancing Fire, 30 FP with terrain, 12 = dud, lost if unused, KIA destroys weapons, blows a sewer entrance shut. Blast FX. | M8 |
| 24 | Smoke | `rules/special` | **Done.** Engineers, first thing in Prep Fire, own or adjacent hex; +1d6 to fire into, out of or through it; +1 MF to enter; lifts at the owner's next Prep Fire. Smoke markers in 2D and 3D, billowing FX. | M8 |
| 25 | Concealment | `rules/special` | **Done.** Scenario counters at setup; gain and loss conditions; Area Fire at half FP against concealed units. Fog of war: concealed enemy stacks show as one "?" counter in 2D and 3D, and the LLM serializer hides them. Dummy counters (§25.7) not yet. | M8 |
| 26 | Fanaticism | `rules/special` | **Done.** Scenario-scoped by building: −1 to morale checks and rally rolls inside it. | M8 |
| 27 | Sewer movement | `rules/special` | **Done.** Led stacks from an entrance to another within 3 hexes on 1–4; 5–6 lost and back next turn at an entrance the opponent picks; immune to fire on the way; concealed on arrival away from the enemy; point-blank fight in an enemy-held entrance (§27.7). | M8 |

## Game Set I: Armor (§28–41) (unlocks scenario 4)

| § | Topic | Notes | MS |
|---|---|---|---|
| 28 | AFVs | **Done.** Tanks and SP guns from `vehicles.json`: MP, gun calibre, HE-only and low-velocity marks, covered-arc and all-round MGs, armour modifier, turret, crew type. 2D counters show the facing; 3D models turn with it. Halftracks come with §47. | M9 |
| 29 | Vehicle stacking and placement | **Done.** Facing as the covered arc (the hex sector between the two front hexside rows); one vehicle per hex at the end of movement. Setup facing in scenarios ("N-NE" etc.); the selected vehicle shows its arc; the commander's view looks along the gun. | M9 |
| 30 | Vehicle movement | **Done.** MP costs by terrain (road ½, open 1, wooden building 4, woods 6, higher ground +4, other vehicles and wrecks +2, enemy AFV +4, smoke +1), +2 to turn outside the arc in the starting hex, free facing after entering a hex, one hex always, no stone buildings. Defensive Fire comes after the move, at the vehicle's final hex. | M9 |
| 31 | Transporting infantry, tanks and SP guns | Not yet: riders on AFVs. | M9 |
| 32 | AFVs as cover | **Done, simplified.** Infantry beside a friendly AFV or a wreck +1; a vehicle or wreck in the hex just before the target acts as a wall (+2, or hull down for AFVs); vehicles that just moved don't count in Defensive Fire. Vehicles do not block LOS further. | M9 |
| 33 | AFV combat | **Done.** To Hit (target type, range band, red Russian numbers, cases A–K, unmodified 2 with a third die, 12 malfunctions) then AFV Kill by aspect (front/side/rear from the hexside crossed) and armour modifier; AP or HE; crew survival and wrecks. | M9 |
| 34 | AFVs vs. infantry | **Done.** HE hits on the IFT at the gun's firepower equivalent, doubled point blank, halved against concealed units; covered-arc and all-round MGs (halved after moving or pivoting); the all-round MG exposes the crew (CE), and infantry fire with a KIA forces a crew morale check. Canister (§34.9) not yet. | M9 |
| 35 | Overruns | **Done, simplified.** 16 FP on entering the first enemy-held hex (halved with a weapon out), unmodified 12 immobilizes, no fire that turn, infantry left under the AFV move off after Defensive Fire. Resolved on entry, before Defensive Fire. | M9 |
| 36 | Infantry vs. AFVs | **Done.** Defensive Fire immobilization attempts from cover next to the AFV's path (pre-attack check, then 2/3/4 by terrain); close assault from the Advance Phase (pre-attack check, kill on the squad's firepower, leader on 2; failures fall back). | M9 |
| 37 | Special infantry weapons vs. AFVs | **Done.** Flamethrowers (automatic hit, FT kill column, same roll at 20 FP on infantry), panzerfausts (one shot) and bazookas (out of ammo on 11–12): To Hit by range and movement, leadership on the To Hit only; demolition charges use the DC column. Bazooka HE against infantry not yet. | M9 |
| 38 | Fate vs. armor | **Done.** Main gun and MG malfunctions on 12; Rally Phase repair (1 fixes, 6 disables). | M9 |
| 39 | Immobilization | **Done.** Breakdown rolls in woods and wooden buildings (German 5–6, others 6); immobilization forces a crew morale check, failure abandons the vehicle; hits on immobilized AFVs force another. | M9 |
| 40 | Wrecks | **Done.** Wrecks: cover, extra MP, block road movement. Pushing wrecks (§40.4) not yet. | M9 |
| 41 | Miscellaneous armor | **Done in part.** Hull down behind walls and wrecks; German smoke dischargers. Tank-fired smoke (§41.3) not yet. | M9 |

## Game Set II: The countryside (§42–49) (unlocks scenarios 5–7)

| § | Topic | Notes | MS |
|---|---|---|---|
| 42 | Hidden initial placement | **Done.** Scenario units marked hidden are off the map for the enemy (2D, 3D, stack panel, LLM) until they move, fire, are hit or end next to the enemy after Defensive Fire or Advance; walking into them stops the move; fire at them is area fire. Only in woods or buildings. | M10 |
| 43 | Advanced LOS | **Done.** Hill levels 1–3, crest lines, height equivalents, blind hexes and the profile view from M2; the country boards C–E now use them. | M2 (geometry), M10 (content) |
| 44 | Rural terrain | **Done.** Cliffs (impassable; point blank ×3 downhill); wheatfields block sight not fire, no −2 moving through, and are open ground outside June–October; shellholes +1 (−1 net moving). | M2, M10 |
| 45 | Offboard artillery | **Done.** One module per scenario entry: calibre and fire missions rolled at the start from the module table and a 1–4 chit, or set by the scenario. Counter-battery fire (§45.4) not yet. | M10 |
| 46 | Artillery fire mechanics | **Done.** Radio contact (−2 to keep it), request in the leader's sight, spotting round rolled in the Close Combat Phase with direction and distance of error, corrections and fire for effect (HE or smoke) in later Rally Phases, the 7-hex blast area rolled hex by hex in Prep or Defensive Fire, moving units brought back, vehicles on KIA only with their DRMs, radios break on 12. The bot runs it for computer sides; humans use the Rally Phase panel and click the map. | M10 |
| 47 | Halftracks | **Done.** Halftracks (no woods or buildings, 8-FP overrun with an MG), riders (board, unload for 2 MP, one more hex on foot), riders immune to rifle fire unless they fired or the firer is adjacent and higher, firing ports (inherent and LMG, halved if it moved), MMG/HMG kill rolls against halftracks, passengers lost with the vehicle. | M10 |
| 48 | Anti-tank guns | **Done.** AT guns as crewed fixed-arc guns with rate of fire 2, the AT gun To Hit row, destroyed by any hit of 37mm or more, shields (+2) for crews through the arc, pushing and turning by the crew, wrecked by overruns. Towing (§48.6x) not yet. | M10 |
| 49 | Night | **Done.** Visibility range rolled each game turn (+3 for moving vehicles), gun flashes allow area fire beyond it, starshells light 3 hexes until after Close Combat, concealment survives adjacency and is regained anywhere. A dark overlay with lit circles in 2D and 3D. Night routs (§49.8) not yet. | M10 |

## Game Set III: Western Front (§50–63) (unlocks scenarios 8–12)

| § | Topic | Notes | MS |
|---|---|---|---|
| 50 | The Americans | US squad capabilities and exceptions referenced elsewhere (for example §13.5, §5.7 note H). | M11 |
| 51 | Trucks | Transport; vulnerability (§51.4). | M11 |
| 52 | Jeeps | Transport; stacking per §6.1. | M11 |
| 53 | Wire | Movement restrictions; removal (KIA in Advancing Fire, artillery); TI markers. | M11 |
| 54 | Entrenchments | Entering and leaving costs; DRMs; stacking exception. | M11 |
| 55 | Minefields | Hidden; attacks on entry; effects on vehicles (§55.6x). | M11 |
| 56 | Bunkers | Covered arcs and fire restrictions; entry exceptions; close combat. | M11 |
| 57 | Upper building levels | Second-level positions; stairways; LOS from upper levels; rubbling of levels. | M11 |
| 58 | Rubble | Creation; movement and TEM. | M11 |
| 59 | Fire | Ignition; spread; effects on movement and combat. Optional §59.1 adds woods and grain fires. Fire and smoke particles. | M11 |
| 60 | River crossings | Amphibious entry from the south edge (§60.1–60.2); boats. | M11 |
| 61 | Snow | Movement and visibility effects; snow terrain shader. | M11 |
| 62 | Roadblocks | Placement; removal in the Rally Phase (§62.3). | M11 |
| 63 | On-board artillery | Mortars and howitzers on the map (§63.6 mortars). | M11 |

## Game Set IV and campaign (unlocks Design-Your-Own and Campaign)

| Item | Notes | MS |
|---|---|---|
| Design-Your-Own: random scenario construction | Virtual 52-card deck sets defender and Allied nationality, the defender's board, length (4, 6, 8 or 10 turns), forces (Random Selection Chart), victory conditions (Random Victory Condition Chart) and points (Point Value Chart). Charts live in `tables`. | M12 |
| Campaign Game | Personnel file; ranks with morale and leadership; Elan and Cowardice points; promotion or demotion at ±10, at most one step per scenario; KIA and a new identity; six-scenario arcs. | M12 |

## Optional rules (per-game switches)

| Rule | Notes | MS |
|---|---|---|
| 8.7 Predesignated attacks | All attacks declared before any resolution. | M3 |
| 16 Semi-simultaneous movement and defensive fire | Defender fires during movement at tracked hexes. MG lines of fire are fixed once established (§16.5–16.6). Defensive fire is still allowed after movement (§16.8). Implemented through **Standing Orders** and prompts. | M7 |
| 17.5 (optional) MG penetration vs. moving targets | Penetration hits moving targets in any hex whose two non-adjacent sides the LOS crosses. | M8 |
| 25.4 Concealment while moving | Kept if no enemy has LOS to any hex moved through. | M8 |
| 59.1 Woods and grain fires | June–October only; spread rolls. | M11 |
| TI counters | Temporarily-immobilized reminders, removed in the next Rally Phase. Automated in Assisted mode. | M11 |

## Cross-cutting

| Item | Notes |
|---|---|
| Advanced Sequence of Play (p. 41) | The engine's phase-step order (see [PLAN.md §6.2](PLAN.md#62-sequence-of-play-as-a-state-machine)). |
| Q&A appendix | Applied by default through the rulings registry; each ruling is linked to its question. |
| Index (p. 42) and TEC (p. 43) | Used to build in-app hover help with § links. |
| Designer's notes and tactics essay | Source material for the LLM persona primer and the bot's heuristics (fire base, converging fire, keeping squads spread), paraphrased. |
