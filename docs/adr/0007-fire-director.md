# 0007: The Fire Director

**Status:** Accepted

## Decision

Fire is animated by a small pipeline in `apps/web/src/fx`:

1. **Timeline** (`timeline.ts`, pure). After each action, the events it produced become timed cues: tracer bursts per firing unit and weapon (rifle, LMG, MMG, HMG), muzzle flashes, impacts, close-combat sparks, dust and smoke, result labels (IFT result, morale, rally, repair, malfunction, eliminated), a "moving" ghost where Defensive Fire hits a hex a unit has already left (§16.4), dice, sounds and hits. The engine adds what this needs to its fire events: who fired which weapon from where, and the result in each hex.
2. **Sampler** (`sample.ts`, pure). For any time t it returns drawable primitives: streaks, glows, labels, lines, ghosts, and the hexes being hit.
3. **Player** (`player.ts`). One clock drives everything. It hands frames to the 2D board (`fx2d.ts`, Pixi) and the 3D scene (`scene3d/fx3d.ts`: line segments and point sprites), and cue events to the sound and the dice tray.
4. **Hold, then commit.** The engine has already applied the action; the board keeps showing the state before it until the results land, then switches. The log and the tutor card hold back that action's results until then too. The bot waits for the animation to finish.

Other parts:

- **Sound** is synthesised with the Web Audio API (filtered noise and a low thump), timed to the tracer rounds, panned across the map, and heard from the POV unit in Eyes view. There are no audio files.
- **Dice tray:** CSS 3D dice tumble and land on the faces the engine rolled; the roll is decided first.
- **Settings** (Effects button): battle speed (Cinematic, Normal, Fast, Instant), sound and volume, dice tray, reduced motion. Reduced motion defaults to the system setting. It replaces tracers and puffs with plain lines and labels, and turns off dice tumbling and camera shake.
- **Eyes view:** incoming rounds pass close to the camera, the camera shakes on hits, a red vignette pulses, and near misses whizz.

## Why

- A pure timeline is testable: tests run real bot games through it and check that every fire event animates, every roll reaches the dice tray, and reduced motion uses only lines and labels.
- One clock keeps 2D, 3D, sound and dice in step, and makes skipping trivial.
- Synthesised sound keeps the app small and free of licensed assets.

## Costs

- Tracer counts and speeds are stylised, not ballistic.
- Movement isn't animated yet: counters jump to their new hex.
