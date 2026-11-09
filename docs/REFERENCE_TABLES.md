# Reference Tables: Quick Reference Data Card transcription

**Source:** photos of the *Quick Reference Data Card* (infantry side) that goes with the 4th Edition rulebook, supplied by the project owner. A second photo shows the later *Crescendo of Doom* card; its differences are noted where they matter.

**Purpose:** these are the engine's **default rules data**. During implementation they become versioned JSON in `packages/content/tables/base/*.json`, validated by Zod. They are editable in the in-app Rules Data editor (see [PLAN.md §6.4](PLAN.md#64-table-driven-numbers)).

**Legend:**
- ✅ read clearly from the base card.
- ⚠️ inferred: cut off in the photo, filled in from the rulebook text or the Crescendo of Doom card. **Confirm before relying on it.**
- ❌ missing: still needed (see [§10](#10-still-missing)).

---

## 1. Infantry Fire Table (§10.3) ✅

Find the column with the rightmost firepower value that does not exceed the total adjusted FP (§10.3). Roll 2d6, add the DRMs, then read across. The red second number in each column header is the **HE equivalent** in mm, used when ordnance or artillery fires on the IFT (§34, §46). The `24` column prints no HE equivalent.

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

**Check against the rulebook:** in the §10.6 example, an 8 FP group with a final DR of 6 gets a +1 MC. Row 6 of the 8 column reads 1. ✅

### Firepower modifiers (§9) ✅

They are cumulative (§9.5).

| Modifier | Condition | Effect |
|---|---|---|
| Point Blank Fire | Target in an adjacent hex | ×2 |
| Long Range Fire | Beyond printed range, up to double range | ×½ |
| Moving Fire | Moved and fired in the same player turn | ×½ |
| Area Fire | Target is concealed | ×½ |

**Crescendo of Doom variant:** the same IFT, but with different HE pairings: 1/20, 2/30, 4/40, 6/50, 8/60, 12/70, 16/85, 20/100, 24/120, 30/150, 36+/200+. It also adds modifiers for that expansion's own rules (boats, marsh, cavalry and so on).

---

## 2. Close Combat Table (§20.3) ✅

Round odds in the defender's favor (§20.3) to the nearest column at or below the actual odds. A roll at or below the Kill Number eliminates the attacked units.

| Odds | 1-5 or worse | 1-4 | 1-2 | 1-1 | 3-2 | 2-1 | 3-1 | 4-1 | 6-1 | 8-1 or better |
|---|---|---|---|---|---|---|---|---|---|---|
| **Kill #** | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |

The engine also needs to know what happens between the printed columns. Odds of 1-3 fall to the 1-4 column, 5-1 falls to 4-1, and 7-1 falls to 6-1. This follows the "round in favor of the defender" rule. ⚠️ Confirm that the "1-5+" header means "1-5 or worse".

**Crescendo of Doom variant (a different table):**

| Odds | 1-7+ | 1-6 | 1-4 | 1-2 | 1-1 | 3-2 | 2-1 | 3-1 | 4-1 | 6-1 | 8-1 | 9+-1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Kill #** | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |

That card also adds expansion-only close combat DRMs. **Use the base table** unless a later expansion ruleset is turned on.

---

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
| F | A squad may fire one MG, or up to 4 FP of MGs, at no cost; or any two MGs above 4 FP, giving up its inherent firepower (§17.1–17.2). |
| G | Must be a crew counter. |
| H | Must be an American unit. |
| \* | For stacking purposes only. |

⚠️ In the photo the "Captured Use: Yes" cell spans the LMG, MMG and HMG rows, and the operation cells span all three MG rows. Confirm both readings.

---

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

---

## 5. Overruns (§35.3) ✅

| Overrunning vehicle | Attack |
|---|---|
| Tanks, SP guns | 16 FP |
| Halftracks | 8 FP |

There is a −5 DR modifier against trucks and jeeps.

---

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
- Costs for terrain features in one hex add together (§3.8, §5.54).

---

## 7. Terrain Effects Modifiers (§11.1)

| Target situation | DRM | Status |
|---|---|---|
| Moving in open ground (§11.3; Defensive Fire only) | −2 | ✅ |
| Wheatfield, moving or not | 0 | ✅ |
| Open ground, not moving | 0 | ✅ |
| LOS crosses an AFV counter, at moving infantry in a different hex (§32.7) | 0 | ✅ |
| Woods, shellhole | +1 | ✅ |
| Behind a hedge hexside (§11.2) | +1 | ✅ |
| Beneath an AFV counter | +1 | ✅ |
| Wooden building | +2 | ✅ |
| Behind a stone wall hexside (§11.2) | +2 | ⚠️ Cut off in the base photo. Taken from the Crescendo of Doom card and the rulebook's §11.5 example ("+2 wall"). |
| Stone building | +3 | ⚠️ Cut off in the base photo. Taken from the Crescendo of Doom card and the rulebook's §11.5 example ("+3 stone building"). |
| *Rows below the photo's edge* | ? | ❌ The base card may list more rows, such as entrenchment, bunker or smoke DRMs. Some of these are also given in the rulebook text (§24, §54, §56). |

**Notes:**
- Shellholes reduce the "moving in the open" −2 to −1 in total (§44.32).
- Hexside DRMs apply only when the LOS crosses that hexside into the target hex (§11.2, §11.53). Multi-hex fire groups lose hexside DRMs unless every firing hex's LOS crosses that hexside (§11.6).

---

## 8. Small tables ✅

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

**Artillery Barrage vs. Vehicles (§46.54):**

| Vehicle | DRM | Status |
|---|---|---|
| Non-armored vehicles | −3 | ✅ |
| Open-top AFVs | −1 | ✅ |
| *Remaining rows* | ? | ❌ Cut off. The Crescendo of Doom card shows tank +1 and SP gun +2, but with expansion-specific crew-exposed notes. ⚠️ |

---

## 9. Sequence of Play (§4) ✅

The card's sequence matches the rulebook:

1. Rally
2. Prep Fire
3. Movement
4. Defensive Fire
5. Advancing Fire
6. Rout
7. Advance
8. Close Combat

On the card, Rally, Rout and Close Combat are marked (in red) as **dual player participation** phases. The engine uses this marking: those three phases take input from both sides.

---

## 10. Still missing

These items are needed to finish the rules data. They are probably on the **vehicle side** of the same card (the rulebook calls the infantry side the "white" side, which implies a second side) or below the photo's edge.

| Item | Rules | Needed by milestone |
|---|---|---|
| **To Hit Table**: range bands × target type, plus case DRMs A–I (§33.31) | §33, §37, §48 | M9 (armor) |
| **AFV Kill Table**: gun caliber or weapon × armor factor | §33.4, §37 | M9 |
| Rest of the Terrain Effects Modifiers | §11.1 | M3 (needed for the first playable) |
| Rest of Artillery Barrage vs. Vehicles | §46.54 | M10 |
| Artillery tables, if they are on the card rather than in the rulebook text (module type, battery access, radio contact, spotting-round drift) | §45–46, §63 | M10 |
| Vehicle data (MP, armor factors, gun, turret type, MG). These come from the counters, not the card. | §28 | M9 |

A photo of the card's other side, and the bottom strip of the infantry side, would cover most of this.
