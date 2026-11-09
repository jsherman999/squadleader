# 0001: TypeScript monorepo and stack

**Status:** Accepted

## Decision

- One TypeScript repository, with pnpm workspaces:
  - `packages/*` for libraries with no UI (hex math, terrain, LOS, engine, content, bot).
  - `apps/web` for the browser app.
- Packages export their TypeScript source directly (`"exports": "./src/index.ts"`). There is no per-package build step: Vite and Vitest compile on the fly, and one root `tsconfig.json` type-checks everything.
- **Web:** Vite, React and Zustand. The 2D board uses PixiJS (WebGL). Styling is plain CSS with design tokens (`apps/web/src/styles/tokens.css`).
- **Tests:** Vitest (unit and property tests with fast-check).
- **CI:** GitHub Actions runs lint, typecheck, tests and build on every push. A separate workflow deploys to GitHub Pages from `main`.

## Why

- **One language** across engine, UI and AI.
- **Source exports** keep the edit-test loop instant and avoid build-order problems between packages.
- **Plain CSS tokens instead of Tailwind and Radix** (a change from PLAN.md §4.3). The UI is a small, dense game interface, so a utility framework adds more weight than it saves. This can be revisited if the component count grows.

## Costs

- Packages can't be published to npm as-is. That's fine: nothing is meant to be published.
