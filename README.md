# Fire & Maneuver *(working title)*

A browser game of WWII squad-level tactical hex combat. It follows the mechanics of the classic 4th Edition squad-level rulebook, on original boards with original scenarios and art.

**Status: planning.** No code yet.

| Document | What's in it |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Full project plan: architecture, feature specs, milestones, testing, risks, open questions |
| [docs/RULES_COVERAGE.md](docs/RULES_COVERAGE.md) | Every rulebook section (§1–63, optional rules, Game Set IV), mapped to an engine module and a milestone |
| [docs/REFERENCE_TABLES.md](docs/REFERENCE_TABLES.md) | Quick Reference Data Card transcription: the engine's default tables, plus what's still missing |

## Planned features

- **Boards:** a zoomable top-down hex board in a printed-map style, plus a rotatable 3D landscape built from the same terrain data.
- **LOS Inspector:** pick two hexes to see the sight line, the exact obstruction, an elevation profile and a viewshed.
- **Move Planner:** try moves with full movement-factor accounting and defensive-fire exposure, then revert or commit.
- **Fire Director:** tracers, shells, rockets and flames drawn from shooter to target during fire phases.
- **POV Cam:** watch from a leader's eyes or a vehicle's cupola or gunsight, including incoming fire.
- **LLM opponent:** enter your own API key and pick a provider and model. A scripted bot works offline and is the fallback.
- **Automation levels:** from Manual to Delegated, with Standing Orders so phases flow quickly.

## Planned stack

TypeScript, React, Vite, PixiJS, three.js (react-three-fiber), Zod, Vitest and Playwright. It deploys as a static site and PWA.
