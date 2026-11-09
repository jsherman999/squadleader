# Reference Tables: rules data transcription

**Purpose:** these are the engine's **default rules data**. During implementation they become versioned JSON in `packages/content/tables/base/*.json`, validated by Zod. They are editable in the in-app Rules Data editor (see [PLAN.md §6.4](PLAN.md#64-table-driven-numbers)).

**Sources:**

| Code | Source |
|---|---|
| **QRDC-I** | Quick Reference Data Card, infantry side (owner's photo). Sections 1–9. |
| **QRDC-V** | Quick Reference Data Card, vehicle side (owner's photo). Sections 10–14. |
| **RB** | Tables and counter art embedded as images in the supplied 4th Edition rulebook PDF. The text extraction missed these at first. Sections 15–16. |
| **COD** | The later *Crescendo of Doom* card. Noted only where it differs. Not used by default. |

**Legend:**
- ✅ read clearly and cross-checked where possible.
- ⚠️ printed value is clear but its meaning needs confirming against the rules text during implementation.

**Data status:** **complete.** Every table the engine needs is covered by the card, the rulebook text or the rulebook's embedded images. Only a few interpretation items, marked ⚠️, remain to confirm during implementation.

---

# Part A: QRDC infantry side

## 1. Infantry Fire Table (§10.3) ✅

Find the column with the rightmost firepower value that does not exceed the total adjusted FP (§10.3). Roll 2d6, add the DRMs, then read across. The red second number in each column header is the **HE equivalent** in mm, used for ordnance and artillery on the IFT (§34, §46). The `24` column prints no HE equivalent.

| Final DR | 1 (20) | 2 (30) | 4 (40) | 6 (50) | 8 (70) | 12 (80) | 16 (100) | 20 (120) | 24 | 30 (150) | 36+ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ≤1 | KIA | KIA | KIA | KIA | KIA | KIA | KIA | KIA | KIA | KIA | KIA |
| 2 | 1 | KIA | KIA | KIA | KIA | KIA | KIA | KIA | KIA | KIA | KIA |
| 3 | 1 | 1 | 2 | KIA | KIA | KIA | KIA | KIA | KIA | KIA | KIA |
| 4 | M | 1 | 1 | 2 | 2 | 3 | KIA | KIA | KIA | KIA | KIA |
| 5 | — | M | 1 | 1 | 2 | 2 | 3 | 4 | KIA | KIA | KIA |
| 6 | — | — | M | 1 | 1 | 2 | 2 | 3 | 4 | KIA | KIA |
| 7 | — | — | — | M | 1 | 1 | 2 | 2 | 3 | 4 | KIA |
| 8 | — | — | — | — | M | 1 | 1 | 2 | 2 | 3 | 4 |
| 9 | — | — | — | — | — | M | 1 | 1 | 2 | 2 | 3 |
| 10 | — | — | — | — | — | — | M | 1 | 1 | 2 | 2 |
| 11 | — | — | — | — | — | — | — | M | 1 | 1 | 2 |
| 12 | — | — | — | — | — | — | — | — | M | 1 | 1 |
| 13 | — | — | — | — | — | — | — | — | — | M | 1 |
| 14 | — | — | — | — | — | — | — | — | — | — | M |
| 15+ | — | — | — | — | — | — | — | — | — | — | — |

**Results:**

| Result | Meaning |
|---|---|
| **KIA** | Every squad and leader in the hex is eliminated (§8.8). |
| **1–4** | Every unit takes a morale check with that number added to its roll (the "#" result in §12.21). |
| **M** | Normal morale check. |
| **—** | No effect. |

The engine treats any final DR at or below 1 as row 1, and at or above 15 as row 15.

**Check against the rulebook:** in the §10.6 example, 8 FP with a final DR of 6 gives a +1 MC. ✅

### Firepower modifiers (§9) ✅

They are cumulative (§9.5).

| Modifier | Condition | Effect |
|---|---|---|
| Point Blank Fire | Target in an adjacent hex | ×2 |
| Long Range Fire | Beyond printed range, up to double range | ×½ |
| Moving Fire | Moved and fired in the same player turn | ×½ |
| Area Fire | Target is concealed | ×½ |

*COD differs: it pairs the columns with different HE values (8/60, 12/70, 16/85, 20/100, 24/120, 36+/200+) and adds expansion-only modifiers.*

## 2. Close Combat Table (§20.3) ✅

Round odds in the defender's favor (§20.3). A roll at or below the Kill Number eliminates the attacked units.

| Odds | 1-5 or worse | 1-4 | 1-2 | 1-1 | 3-2 | 2-1 | 3-1 | 4-1 | 6-1 | 8-1 or better |
|---|---|---|---|---|---|---|---|---|---|---|
| **Kill #** | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |

Odds that fall between printed columns drop to the next lower column, for example 1-3 → 1-4, 5-1 → 4-1, 7-1 → 6-1.

*COD uses a different 12-column table (1-7+ … 9+-1, kill numbers 1–12). Not used by default.*

## 3. Support Weapons Chart (§5.7) ✅

Portage capacity is 3 PP free for a squad or crew and 1 PP free for a leader (§5.7). The leader column gives leader portage points.

| Weapon | Portage: squad/crew | Portage: leader | Captured use | Squad operation | Leader operation |
|---|---|---|---|---|---|
| LMG | 1 | 2 | Yes | F (§17.1) | 1 MG at ½ FP; E (§17.3) |
| MMG | 4 | A | Yes | F (§17.1) | 1 MG at ½ FP; E (§17.3) |
| HMG | 5 | A | Yes | F (§17.1) | 1 MG at ½ FP; E (§17.3) |
| Flamethrower | 2 | 2 | C, D, H | 1, D (§22.3–5) | 1, C (§22.4) |
| Demolition Charge | 1 | 1 | C, D, H | 1, D (§23.3–4) | 1, C |
| Panzerfaust | ½ | 1 | C, D, H | 4 (§37.3) | 1 (§37.33) |
| Bazooka | 1 | 2 | No | 2 (§37.4) | 1, E (§37.43) |
| Radio | 1 | 2 | No | NA | 1 (§46.1) |
| Anti-Tank Gun | B (§48.4) | NA | Yes, G | 1 (§48.7) | NA |
| 105mm Howitzer | 5 \* | — | No | — | — |
| Mortar (§63.6) | — | — | D, H | — | — |

**Notes:**

| Note | Meaning |
|---|---|
| A | Two leaders may carry one MMG or HMG one hex per Movement Phase. |
| B | Any squad may push the gun one hex during the Movement Phase. |
| C | Requires a leader with a leadership modifier of −2 or −3. |
| D | Must be Assault Engineers. |
| E | Any two leaders may fire it at full strength. |
| F | A squad may fire one MG, or up to 4 MG firepower factors, at no cost; or any two MGs above 4 FP, giving up its inherent firepower. |
| G | Must be a crew counter. |
| H | Must be an American unit. |
| \* | For stacking purposes only. |

## 4. Stacking (§6.1) ✅

| Situation | Limit |
|---|---|
| Infantry | 4 units (3 squads maximum) |
| Weapons | 10 portage points |
| Vehicles | 1 |
| Wrecks | Unlimited |
| On an AFV | 2 infantry (1 squad maximum), 5 PP |
| On a truck | 2 infantry (1 squad maximum), 7 PP |
| On a jeep | 1 crew, or 2 leaders and 1 support weapon |
| Under an AFV | 3 infantry (2 squads maximum), 5 PP |

**Exceptions:** bunkers, close combat, entrenchments, overruns, second-level buildings, sewer moves.

## 5. Overruns (§35.3) ✅

| Overrunning vehicle | Attack |
|---|---|
| Tanks, SP guns | 16 FP |
| Halftracks | 8 FP |

There is a −5 DR modifier against trucks and jeeps.

## 6. Infantry Movement Costs (§5.5) ✅

| Entering | Cost |
|---|---|
| Road, through a road hexside \* | ½ MF |
| Road, through a non-road hexside \* | 1 MF |
| Open ground, shellhole, wheatfield \* | 1 MF |
| Woods \* | 2 MF |
| Any building \* | 2 MF |
| Moving within any building, per hex | 2 MF |
| Moving up or down a staircase | 2 MF |
| Cliff hexside | Not allowed |
| Over a wall or hedge hexside | 1 + COT |
| Into a smoke-filled hex | 1 + COT |
| Entering or leaving a bunker or entrenchment in the same hex | 1 MF |

- **COT** means "cost of terrain" in the hex being entered.
- **\*** marks costs that are doubled when the move is to a higher elevation (§5.53).

## 7. Terrain Effects Modifiers (§11.1) ✅ complete

| Target situation | DRM |
|---|---|
| Moving in open ground (§11.3; Defensive Fire only) | −2 |
| Wheatfield, moving or not | 0 |
| Open ground, not moving | 0 |
| LOS crosses an AFV counter, at moving infantry in a different hex (§32.7) | 0 |
| Woods, shellhole | +1 |
| Behind a hedge hexside (§11.2) | +1 |
| Beneath an AFV counter | +1 |
| Wooden building | +2 |
| Behind a stone wall hexside (§11.2) | +2 |
| Stone building | +3 |

**Related rules from the rulebook text:**
- Shellholes reduce the moving-in-the-open DRM to −1 in total (§44.32).
- Hexside DRMs apply only when the LOS crosses that hexside into the target hex (§11.2, §11.53).
- Multi-hex fire groups lose hexside DRMs unless every firing hex's LOS crosses the hexside (§11.6).

## 8. Small infantry-side tables ✅

**Sewer Movement (§27.22).** Roll one die:

| Roll | Result |
|---|---|
| 1–4 | Successful |
| 5–6 | Lost |

**Minefield vs. Vehicles (§55.6):**

| Vehicle | DRM |
|---|---|
| Truck, jeep | −3 |
| Halftrack | −1 |
| Others | 0 |

**Artillery Barrage vs. Vehicles (§46.54).** The rulebook's §46.54 table matches.

| Vehicle | DRM |
|---|---|
| Non-armored vehicles | −3 |
| Open-top AFVs | −1 |
| Tank | +1 |
| SP gun | +2 |

## 9. Sequence of Play (§4) ✅

1. Rally
2. Prep Fire
3. Movement
4. Defensive Fire
5. Advancing Fire
6. Rout
7. Advance
8. Close Combat

Rally, Rout and Close Combat are marked as **dual player participation** phases: both sides act in them.

---

# Part B: QRDC vehicle side

## 10. To Hit Table (§33.3) ✅

A shot hits on a roll at or below the Hit Number. Each cell gives two numbers:

- **Black** (first): used by all non-Russian firers.
- **Red** (second): used by Russian firers (§33.3).

The rulebook's own reproduction of this table (an image on p. 13) matches the card.

| Target type | 1–6 hexes | 7–12 hexes | 13–24 hexes | 25+ hexes |
|---|---|---|---|---|
| Infantry in building, shellhole or entrenchment | 8 / 8 | 7 / 6 | 6 / 5 | 5 / 2 |
| Infantry in woods | 8 / 8 | 6 / 6 | 5 / 4 | 4 / 2 |
| Infantry in other terrain | 9 / 9 | 8 / 7 | 7 / 6 | 6 / 3 |
| Vehicle hull down | 7 / 6 | 5 / 4 | 4 / 3 | 3 / 2 |
| Vehicle in woods or building | 9 / 9 | 8 / 7 | 7 / 6 | 6 / 3 |
| Vehicle in other terrain | 10 / 10 | 9 / 8 | 8 / 7 | 7 / 4 |
| AT gun | 6 / 5 | 5 / 4 | 4 / 3 | 2 / – |

### Hit Determination DRMs (§33.31) ✅

| Case | Situation | DRM |
|---|---|---|
| A | Firing in the Defensive Fire Phase at a moving target | +2 |
| B | •/\* gun firing at a target more than 6 hexes away | +2 |
| C | •/\* gun firing at a target more than 12 hexes away | +4 |
| D | Tank firing outside its covered arc | +2 |
| E | Tank firing in Advancing Fire after pivoting in its hex during Movement | +1 |
| F | Tank firing in Advancing Fire after moving to a new hex | +5 |
| G | SP gun, AT gun or howitzer firing in Advancing Fire after pivoting in its hex during Movement | +3 |
| H | Target is concealed | +2 |
| I | SP gun, AT gun or howitzer firing in Defensive Fire after pivoting in its hex during the same Defensive Fire Phase | +4 |
| J | Target in an adjacent hex | −2 |
| K | Target in the same hex | −2 |

**Notes on the cases:**
- Case K appears in the rulebook's reproduction of the table, not on the card.
- Cases B and C apply only to main armament marked "•" (card) or "\*" (rulebook counters). That mark means *Lessened Long Range Hit Probability*.
- "Howitzer" in cases G and I comes from the rulebook's version.

**Procedure (§33.32):**
- All cases are cumulative, with these exceptions:
  - B and C are not combined.
  - Pivot and move penalties don't combine, because moving to a new hex allows a free covered-arc change (§30.5).
- An **unmodified 2** is always a possible hit. Roll a third die and add +1 for each point the final Hit Number is below 2. A result under 6 is a hit.
- Leaders never modify tank or SP gun fire (§33.33).

## 11. AFV Kill Table (§33.4) ✅

After a hit, cross-index the weapon and ammunition with the target facing. Roll at or below the Kill Number to eliminate the vehicle. The rulebook's p. 13 image matches the card and names the special-weapon columns, which the card shows only as icons.

| Target | MMG/HMG | .50 cal/20mm | AP 37 | AP 50 | AP 75/76 | HE 37 | HE 50 | HE 75/76 | HE 105 | HE 120 | HE 150 | H6 (HEAT) | PF | BAZ | FT | DC |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AFV front | −3 | −3 | 2 | 3 | 6 | −1 | 0 | 2 | 4 | 6 | 8 | 8 | 7 | 3 | 3 | 9 |
| AFV side | −3 | −2 | 3 | 6 | 8 | 1 | 2 | 3 | 6 | 7 | 10 | 10 | 8 | 4 | 4 | 10 |
| AFV rear | −2 | −1 | 4 | 8 | 10 | 2 | 3 | 4 | 8 | 9 | 12 | 11 | 10 | 6 | 6 | 11 |
| Truck, jeep | NA | NA | 8 | 10 | 10 | 10 | 11 | 12 | 12 | 12 | 12 | 11 | 10 | 10 | 10 | 12 |

**Column key:** PF = panzerfaust, BAZ = bazooka, FT = flamethrower, DC = demolition charge.

**Notes:**
- **NA:** see §51.4. MG fire against trucks and jeeps uses the IFT instead.
- **Facing:** the target facing is set by the target hexside the LOS crosses (§33.5). If the LOS runs exactly along a hex spine, the facing less favorable to the attacker applies.

### AFV Kill Number modifiers (§33.41) ✅

| Vehicle | DRM |
|---|---|
| Halftracks | −5 |
| Priest | −2 |
| M-10 | −1 |
| M4A4, T-34, PzKw IV | 0 |
| M4M52, SU-122, StuG III | +1 |
| SU-152, Brummbär | +2 |

Trucks and jeeps get no modifier (§33.42).

## 12. Vehicle Movement Costs (§30.4) ✅

| Terrain | AFV | Truck / jeep |
|---|---|---|
| Through a road hexside | ½ MP | ½ MP |
| Open ground | 1 MP | 6 MP |
| Through a hex containing a wreck or vehicle | 2 MP per vehicle + COT | 2 MP per vehicle + COT |
| Higher terrain than previously occupied | 4 MP + COT | 4 MP + COT |
| Woods \* | 6 MP \*\* | NA |
| Wooden buildings \* | 4 MP \*\* | NA |
| Over a wall or hedge hexside | 0 MP + COT | NA |
| Outside the covered arc | 2 MP + COT | 4 MP + COT |
| Shellhole, entrenchment | 0 MP + COT | 4 MP + COT |
| Unloading passengers | 2 MP | 2 MP |
| Stone buildings, cliff hexsides | NA | NA |
| Smoke | 1 MP + COT | 1 MP + COT |

- **\*** Requires a die roll for possible immobilization (§39.1).
- **\*\*** Halftracks are not allowed.

⚠️ The printed "0 MP + COT" rows (walls and hedges; shellholes and entrenchments) are transcribed as printed. Confirm against §30 text during M9.

## 13. Small vehicle-side tables ✅

**Close Combat AFV Kill Numbers (§36.2).** The attack succeeds on a dice roll at or below the squad's firepower. A leader attacking alone needs a 2 after leadership modification (§36.23).

**Artillery Accuracy (§46.21).** Roll one die for the initial spotting round:

| Nationality | On target with |
|---|---|
| German, American | 1–2 |
| Russian | 1 |

**Immobilization (§39.1).** Roll one die:

| Nationality | Immobilized on |
|---|---|
| German | 5–6 |
| Others | 6 |

**Counter Battery Fire (§45.4).** The rulebook's table matches. There is a −1 DRM for each turn of continuous shelling.

| 2d6 | Result |
|---|---|
| 2 | Enemy artillery destroyed |
| 3–5 | Enemy artillery disrupted |
| 6–12 | No effect |

**Defensive Fire AFV Immobilization Numbers (§36.12–36.13).** The rulebook's image of this table is captioned "36.12 Pre-AFV Attack Morale Check". Per the §36.12 text, it is the immobilize-number table.

| Location of firing units | Roll at or below |
|---|---|
| Leader alone, any non-open ground | 2 |
| Squad in a wheatfield | 2 |
| Squad in a small building, shellhole or entrenchment | 3 |
| Squad in woods or a large building (3+ hexes) | 4 |

## 14. Counter abbreviations ✅

| Symbol | Meaning |
|---|---|
| Δ | No leadership modifiers |
| □ (boxed value) | No Long Range, Moving Fire or Point Blank modifications |
| underscore | No terrain modifier |
| −1 | Add −1 to all fire on the target hex |
| A | Manned only by Assault Engineers or −2 leaders |
| B# | Breakdown number |
| C7 | Canister |
| X | Eliminated (for example X11+) |
| R | Repaired |
| S | Crew survival (only vehicles with inherent crews) |
| overscore | HE ammunition only |
| H6 | HEAT ammunition |
| ◯ (circled number) | Main armament rate of fire |
| MC | Morale check for crew |
| P# | Vehicle portage points allowed |
| • or \* | Lessened long-range hit probability (To Hit cases B and C) |

---

# Part C: Tables embedded in the rulebook (RB)

## 15. Rulebook tables ✅

### Panzerfaust To Hit (§37.31). Maximum range 3.

| Range | Prep or Defensive Fire | Advancing Fire after movement |
|---|---|---|
| 1 hex | 8 | 7 |
| 2 hexes | 6 | 5 |
| 3 hexes | 3 | 2 |

### Bazooka To Hit (§37.41). Maximum range 4.

| Range | Prep or Defensive Fire | Advancing Fire after movement |
|---|---|---|
| 1 hex | 8 | 7 |
| 2 hexes | 7 | 6 |
| 3 hexes | 6 | 4 |
| 4 hexes | 3 | 2 |

**Notes:**
- An unmodified 11 or 12 on a bazooka To Hit roll means it is out of ammunition or has malfunctioned (§37.45).
- A wall hexside (hull down, +2) applies to the To Hit roll, not the Kill roll.

### Module Artillery Selection (§45.2). Roll one die per radio.

| Die | German | Russian | American |
|---|---|---|---|
| 1 | 80+mm | 70+mm | 80+mm |
| 2 | 80+mm | 80+mm | 80+mm |
| 3 | 80+mm | 80+mm | 100+mm |
| 4 | 100+mm | 120+mm | 100+mm |
| 5 | 120+mm | 120+mm | 150+mm |
| 6 | 150+mm | 150+mm | 150+mm |

### Radio Contact Values (§46.11)

| Nationality | Period | Number required |
|---|---|---|
| German | All scenarios | 7 |
| American | All scenarios | 9 |
| Russian | 1941 | 5 |
| Russian | 1942 | 6 |
| Russian | 1943–45 | 7 |

### Entrenchment Modifiers (§54.7)

| Attack type | DRM |
|---|---|
| Flamethrower | +0 |
| Infantry fire, HE fire, demolition charge | +2 |
| Overruns, offboard artillery, indirect fire | +4 |

### Spreading Fire (§59.4). Spreads on a 2d6 roll in the given range.

| Adjacent hex is | Spreads on |
|---|---|
| Same wooden building | 8–12 |
| Same stone building | 9–12 |
| Different building | 10–12 |
| Woods hex | 7–12 |
| Grain | 6–12 |

### Bunker counters (§56)

The format is *stacking capacity + covered-arc defense DRM + non-covered-arc defense DRM*.

| Type | Values |
|---|---|
| Stronger | `1+5+7`, `2+5+7`, `3+5+7` |
| Lighter | `1+3+5`, `2+3+5`, `3+3+5` |

### Other values from rulebook diagrams

| Item | Value | Rule |
|---|---|---|
| FFE blast area | The FFE hex plus its 6 adjacent hexes | §46.5 |
| Wreck survival number | Printed on the wreck counter, for example 3 | §40 |
| Halftrack counter | MP, portage capacity (P5) and 360° MG factor (−/4) | §47 |
| Gun counters | Gun size, rate of fire (circled), crew protection factor (for example +2), breakdown number | §48 |

## 16. Unit roster (from the rulebook's Point Value Chart counter art, p. 34) ✅

### Squads and crews (FP-range-morale)

| Nationality | Units |
|---|---|
| German | 4-6-7, 8-3-8, 2-4-7 (crew) |
| Russian | 4-4-7, 6-2-8, 2-3-7 (crew) |
| American | 6-6-6, 8-4-7, 2-4-6 (crew) |

### Leaders (morale-leadership)

All three nationalities have leaders rated 7-0, 8-0, 8-1, 9-1, 9-2, 10-2 and 10-3.

### Support weapons (FP-range, breakdown)

| Weapon | German | Russian | American |
|---|---|---|---|
| LMG | 2-8 B12 | 2-6 B10+ | — |
| MMG | 4-12 B12 | 4-10 B11+ | 4-12 B12 |
| HMG | 6-16 B12 | .50 cal 8-20 B12 | .50 cal 8-20 B12 |
| Flamethrower | 30 □ Δ A | — | 30 □ Δ A |
| Demolition charge | 20 Δ −1 □2 ⚠️ | — | 20 Δ −1 □2 ⚠️ |
| Panzerfaust | □3 (range 3) | — | — |
| Bazooka | — | — | 6 □4 X11+ |
| Radio (contact value) | 7 Δ B12 | 5–7 by year, Δ B12 | 9 Δ B12 |

### Guns and mortars

| Item | German | Russian | American |
|---|---|---|---|
| AT guns | 50mm and 75mm (②, +2, B12) | 57mm and 76mm (②, +2, B12) | 57mm and 76mm (②, +2, B12) |
| Howitzer | — | — | 105 HE-only, H6, ②, +2, B12 |
| Mortars | 81 HE-only, B12 | 82 HE-only, B12 | 81 HE-only, B12 |

### Vehicles

Format: MP; gun (overscore = HE only); MG factors; marks.

| Vehicle | MP | Gun | MG | Marks |
|---|---|---|---|---|
| PzKw IV F2 (German) | 12 | 75 | 4/2 | |
| PzKw IV F1 (German) | 12 | 75 | 4/2 | C7 (canister), \* ⚠️ confirm HE-only marking |
| StuG III (German) | 12 | 75 | 6/− | |
| StuG III (105) (German) | 12 | 105 HE-only | 6/− | |
| Brummbär (German) | 6 | 150 HE-only | 4/− | \* |
| SdKfz 251 (German) | 16 | — | −/4 | P5 |
| Truck (German) | 24 | — | — | P7 |
| T-34 (Russian) | 16 | 76 | 4/− | |
| SU-122 (Russian) | 10 | 122 HE-only | — | \* |
| SU-152 (Russian) | 8 | 152 HE-only | — | \* |
| M-3 halftrack ×2 (Russian, lend-lease) | 16 | — | −/4 | P5 |
| Truck (Russian) | 24 | — | — | P7 |
| M4A4 (American) | 16 | 75 | 4/6 | |
| M4M52 (American) | 14 | 105 HE-only | 4/6 | H6, \* |
| M-10 (American) | 18 | 75 | −/6 | ROF ② |
| Priest (American) | 14 | 105 HE-only | 4/2 | H6 |
| M-16 (American) | 16 | — | −/24 | |
| M-3 halftracks (American) | 16 | — | −/4 | P5 |
| Truck (American) | 24 | — | — | P7 |
| Jeep (American) | 24 | — | — | |

**Markers seen on the chart:** wire, entrenchment (5), roadblock, bunkers (above), and a "#" burst marker ⚠️ (purpose to confirm from the rules text).

**Derived from class and rules, not printed on counters:** whether a vehicle has a turret or a fixed covered arc, and whether it is open-topped (M-10, Priest, halftracks). These come from §28–§29 and §46.54.

---

## 17. Remaining items to confirm (⚠️)

None of these block the plan. They are checks to make while building the matching milestone.

| Item | Milestone |
|---|---|
| The demolition charge counter's boxed "2" (range vs. other meaning) against §23 | M8 |
| The PzKw IV F1 gun marking, and the purpose of the "#" marker | M9, M10 |
| The "0 MP + COT" vehicle movement rows against §30 | M9 |
| Whether the Americans have an LMG counter (none appears on the US side of the chart) | M11 |
