# Squad War

A browser-only game of WWII squad-level tactical hex combat. It follows the mechanics of the classic 4th Edition squad-level rulebook, on original boards with original scenarios and art.

**Status:** milestones M0–M9 are built. You can play scenarios 1–4 (infantry, flamethrowers, demolition charges, smoke, concealment, sewers, tanks and SP guns) hot-seat, against the computer, or watch the computer play itself with every move explained, on a 2D map, a 3D landscape or both side by side, with the line-of-sight lab, the move planner, a unit's-eye view and the board editor. See [Progress](docs/PLAN.md#progress).

## Getting started

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm check      # lint, typecheck, tests
pnpm soak       # long bot-vs-bot run (SOAK_GAMES=200)
pnpm --filter @squadwar/content gen:boards   # regenerate board JSON from the layouts
```

Builds deploy to GitHub Pages from `main`. In the repository's Settings → Pages, set the source to "GitHub Actions".

| Document | What's in it |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Full project plan: architecture, feature specs, milestones, testing, risks, decisions |
| [docs/RULES_COVERAGE.md](docs/RULES_COVERAGE.md) | Every rulebook section (§1–63, optional rules, Game Set IV), mapped to an engine module and a milestone |
| [docs/REFERENCE_TABLES.md](docs/REFERENCE_TABLES.md) | Complete rules data: both sides of the Quick Reference Data Card, the rulebook's embedded tables and the unit roster |
| [docs/rulings.md](docs/rulings.md) | Interpretation calls the engine makes |
| [docs/adr](docs/adr/README.md) | Architecture decision records |

## Features

- **Boards:** a zoomable top-down hex board in a printed-map style, plus a rotatable 3D landscape built from the same terrain data. Press `3` to switch between 2D, 3D and split.
- **LOS Inspector:** pick two hexes to see the sight line, the exact obstruction, an elevation profile and a viewshed, in 2D or as a ray in 3D.
- **Move Planner:** try moves with full movement-factor accounting and defensive-fire exposure, then revert or commit.
- **Eyes:** press `E` to look from the selected unit's position. Enemy units show only where the rules give line of sight.
- **AI vs AI tutor:** watch the computer play both sides, with the reasoning behind every move: the goal, the odds and rules it weighed, the options it rejected and a lesson. Finished games are saved to a library in the browser. **Review** steps through any saved game decision by decision, and you can take over either side from any point.

- **Fire Director:** tracers, muzzle flashes, impacts and result labels play in 2D and 3D, with sound and a dice tray. Choose the battle speed or reduced motion under Effects. In Eyes view you see and hear incoming fire.
- **LLM opponent:** set a side to "Computer (LLM)", then enter your own API key and choose Anthropic, OpenAI, Gemini, OpenRouter or a local model. It plays through the same rules, explains its orders, talks on the radio, and stays within your budget. The scripted bot plays offline and takes over whenever the model can't.
- **Standing orders:** with Streamlined automation, your units fire on their own in Defensive Fire, following orders such as "fire at units moving in the open".

## Planned features

- **Fire Director, part 2:** shells, rockets and flames for the later weapons, and animated movement.
- **POV Cam, part 2:** a vehicle's cupola or gunsight, and follow-move.
- **Delegated automation:** let a helper play chosen phases for your side.

## Stack

TypeScript, React, Vite, PixiJS, three.js, Zod and Vitest. It deploys as a static site.
