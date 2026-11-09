# 0010: Custom scenarios travel with their games

**Status:** Accepted

## Context

M12 adds three ways to make scenarios outside the shipped set: Design Your Own deals, the scenario editor and campaign games (a scenario with the player's personal leader added). Games are stored as a scenario id, a seed and an action list (ADR 0002), and every replay, review, autosave and library entry looks the scenario up by id. A scenario that exists only in one browser would make those saves unreadable anywhere else, or after storage is cleared.

## Decision

- Custom scenarios are ordinary `squadwar-scenario@1` documents, validated by the same schema as the shipped ones. They are kept in browser storage (`squadwar:scenarios`) and looked up after the built-in set.
- A save of a custom scenario carries the scenario itself (`scenarioData`). Replaying a save registers its scenario first if the browser does not have it. The play page restores the autosave's scenario the same way.
- Design Your Own is a pure engine function of the rules data, the boards and a seed (`designYourOwn`), so a deal can be reproduced from its seed, and its id (`dyo-<seed>`) names it.
- Campaign games use a derived scenario per campaign step (`<base>~camp-<campaign>-<n>`), so the personal leader is part of the order of battle and the engine needs no campaign knowledge. The campaign record reads the game's states and actions afterwards to award points.
- Optional rules chosen before play are stored in the initial `GameState` (`options`) and in the save, so a replay applies the same rules.

## Consequences

- Saves of custom scenarios are larger (the scenario is a few kilobytes) but self-contained: they can be shared as files and reviewed anywhere.
- Editing a custom scenario after games were played with it does not break them: a new copy gets a new id.
- Campaign scoring is approximate where the rulebook depends on judgement (see `docs/rulings.md`).
