# 0006: The bot explains its moves, and saves keep the explanations

**Status:** Accepted

## Decision

- `decide(ctx, state)` in `packages/bot` returns the action **and** a `Rationale`: a one-line goal, the reasons (with the firepower, odds, MF and rule references it used), the options it weighed, a general lesson, whether the decision is *key* or *routine*, and the hexes it is about. `chooseAction` is a thin wrapper, so the bot plays exactly the same games as before (checked by hashing self-play logs).
- The reasoning is written **when the decision is made**, from the same numbers the bot used to choose, not reconstructed afterwards.
- The session keeps one note per action (none for human moves). Save files carry them in an optional `notes` array, so `squadwar-save@1` files without notes still load.
- Finished AI-vs-AI games go to a browser library (IndexedDB) automatically. A game is about 300 actions, roughly 150 KB with notes.
- Review mode replays a save into every intermediate state and shows each decision on the board, with its reasoning and what the dice then did. "Key decisions" hides routine steps (ending phases, follow-on movement steps).

## Why

- Storing the notes keeps old games explainable after the bot changes; regenerating them would describe what a newer bot would have thought.
- Explanations built from the bot's own numbers can't drift from its behaviour, which matters when the point is teaching.

## Costs

- The bot's wording lives in code, so it is English-only for now.
- Saves with notes are a few times larger than bare action logs.
