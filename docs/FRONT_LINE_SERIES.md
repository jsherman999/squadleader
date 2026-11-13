# Front-line series (h1–h12)

Twelve scenarios that adapt the twelve engagements on the owner's scenario cards, from Stalingrad in October 1942 to the Ardennes in December 1944. They follow the cards' rules order (§1–21, then §26, §41, §46, §48, §49, §52, §54, §56, §59, §60 and §63), so the series works as a second tutorial track after the original twelve.

As with the rest of the game (see [PLAN §2](PLAN.md#2-original-content-vs-rulebook)), the cards are not reproduced. The cards' boards, hex references and leader counters do not exist here. Each scenario keeps the historical situation (place, date, the units involved and what each side was trying to do) and is rebuilt on this game's boards with its own title, briefing, order of battle, set-up, turn count, special rules and victory conditions. Leader names are invented.

The scenario files are `packages/content/scenarios/h1.json` … `h12.json`. They are listed on the Play page under **Front-line series**.

| # | Scenario | Engagement | Rules | Board | Turns | Victory | New engine support |
|---|---|---|---|---|---|---|---|
| h1 | *The Guards Go In* | Stalingrad, 6 Oct 1942: a fresh Guards battalion and the 308th Rifle Division counterattack the 389th Infantry Division | §1–21 | City A | 6 | Soviets take 3 of 4 German-held stone buildings | — |
| h2 | *Island in the Works* | Stalingrad tractor works, 6 Oct 1942: German assault engineers against a cut-off Soviet garrison, with a relief force | §1–26 | City B | 7 | Germans take 2 of 3 works buildings; the garrison is fanatic | — |
| h3 | *Both Ends of the Street* | The two Stalingrad actions as one battle, with armour and sewers | §1–41 | City B north of City A | 8 | Germans take 3 of 5 strongpoints | — |
| h4 | *The Hedgehog* | Central Russia, 14 Nov 1941: a worn German company holds a village against a Soviet rifle regiment's remnants | §1–46 | Country C | 8 | Soviets take 2 of 3 stone buildings; hidden Germans, 81mm mortar support | — |
| h5 | *The Highway Ridge* | Belorussia, 1 Jul 1944: the last ridge before Minsk | §1–48 | Country D | 8 | Soviets hold the whole hill crest and the hilltop house | Area objective (the crest) |
| h6 | *Out of the Pocket* | Velikiye Luki, 12 Jan 1943: the garrison's night breakout | §1–49 | Country E | 10 | Germans get 4 squads off the west edge | Exit victory |
| h7 | *Station at First Light* | Ardennes, 16 Dec 1944: an American company surprised at a railway halt | §1–52 | Country D | 8 | First side to its break point loses; otherwise Germans need 2 of 3 buildings | Break points |
| h8 | *Spoiling Attack in the Vosges* | Low Vosges near Bitche, 14 Jan 1945: a German flank attack on an American advance | §1–54 | Country C | 8 | Americans take the ridge crest and hilltop barn before losing 8 | Area objective, break point |
| h9 | *Pillbox Hill* | Provence, 23 Aug 1944: paratroopers against a fortified hill | §1–56 | Country D | 7 | Americans take 2 of 3 hill objectives; the garrison surrenders after 6 losses | Area objective, break points |
| h10 | *Across from the Rhine* | Rhineland, 6 Apr 1945: a parachute raid across the Rhine meets a fresh German company | §1–59 | City A | 8 | Americans take 2 of 3 stone buildings before losing 9 | Break point |
| h11 | *Mist on the Rhine* | Rhine gorge, 24 Mar 1945: an assault crossing in the morning mist | §1–60 | Country C | 7 | Americans take 3 of 4 objectives, the ridge crest among them | Area objective |
| h12 | *The Road West* | Ardennes, 17 Dec 1944: combat engineers delay the German drive on Wiltz | §1–63 | Country C | 10 | Germans get 6 squads off the west edge | Exit victory |

## Victory conditions added for the series

The cards decide several battles by things other than buildings, so the scenario format's victory block gained three optional parts (in `engine/data.ts`, evaluated in `engine/rules/victory.ts`; see [rulings](rulings.md)):

- **Area objectives.** An objective may list `hexes` instead of naming a building: a hill crest, held like a building.
- **Exit.** `exit: { side, board, edge, squads }`. The side's unbroken units on that edge at the end of its Movement Phase leave the map; it wins as soon as enough squads are out. The edge is tinted green on the map, and the battle screen counts the squads that are out.
- **Break points.** `breakPoint: { side: n }`. A side that has lost n squads, crews and vehicles gives up at once. This stands for the cards' forced withdrawals and surrenders.

The scenario editor still edits building objectives only; scenarios using the new parts can be played, imported and exported, but not edited there.

## Balance

Bot-vs-bot games favour the defender, as they do for the original twelve: the scripted attacker is cautious (see PLAN M8). Results from 6 seeded games each, at the time of writing:

| Defender wins | Notes |
|---|---|
| h1, h2, h3, h4, h6, h7, h8, h9, h10, h11, h12: 6 of 6 | In h6 the German breakout got 2 of 4 squads out in some games. |
| h5: 5 of 6 | |

Against a human attacker they should be much closer. The break points and exit totals are the first things to tune once there is playtesting.
