# 0009: Vehicles are their own kind of piece

**Status:** Accepted

## Context

Armour (§28–41) brings pieces that behave nothing like infantry: they have a facing and a covered arc, spend movement points by a different chart, fire in two steps (To Hit, then Kill), break down, burn and leave wrecks, and are attacked by infantry in their own ways. Nearly every infantry rule (morale, rout, stacking, close combat, concealment, victory) would need an exception if vehicles were just another `Unit`.

## Decision

- `GameState.vehicles` holds tanks and SP guns, separate from `units`. Wrecks are a list of `{hex, type, side}`. Infantry code keeps iterating `units` and is unchanged except at the few rules that mention AFVs: cover beside AFVs and wrecks, no entering an enemy AFV's hex in Movement, advancing onto an AFV, sudden death.
- All armour rules live in `engine/rules/armor.ts`, with numbers in `content/rules/armor.json` and vehicle types in `vehicles.json`. New actions: `face`, `vmove`, `vstop`, `vfire`, `antiTank`, `discharge`, `vrepair`.
- The covered arc is a hex sector, computed exactly from axial coordinates; facing is the pair of front hexsides. The same number drives the 2D counter, the arc overlay, the 3D model's rotation and the commander's view.
- A destroyed or abandoned vehicle becomes a wreck; a surviving crew becomes an ordinary crew `Unit` and plays by the infantry rules from then on.
- The bot's armour logic is a separate module (`bot/armor.ts`) that returns the same explained `Decision`s, so tutor mode and the LLM's `list_options` cover vehicles without changes.

## Consequences

- Infantry rules and their tests did not need touching; armour has its own tests.
- A few interactions are simplified and listed in `docs/rulings.md` (vehicles don't block LOS beyond the next hex, overruns resolve on entry, Defensive Fire at a moving AFV targets its final hex).
- Halftracks, trucks and riders (M10) extend the same model: more vehicle kinds and a passenger list on `Vehicle`.
