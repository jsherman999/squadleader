# 0002: Pure, deterministic, event-sourced rules engine

**Status:** Accepted

## Decision

- **Pure function.** The engine is `applyAction(state, action) → { state, events }`. It has no DOM, no wall clock and no global randomness.
- **Dice come from a seeded PRNG** stored in the game state.
- **A game is fully described by `scenario + seed + action log`.** That gives us:
  - saves and replays (re-apply the log);
  - undo before dice (re-apply the log minus the last action);
  - the Move Planner's forks (apply actions to a copy, then throw it away or commit);
  - an exact record for animations and the combat log.
- Every resolution also returns a **rules trace**: plain-language steps with § references, shown in the combat log.
- The engine runs on the main thread for now. It moves to a Web Worker (PLAN.md §4.1) only if profiling shows the UI stalling. Viewshed is the first candidate.

## Why

Determinism makes rules bugs reproducible from a save file. It also makes bot-vs-bot soak testing meaningful, because any failure replays exactly.

## Costs

- State must stay JSON-serializable: no class instances and no Maps inside the state.
