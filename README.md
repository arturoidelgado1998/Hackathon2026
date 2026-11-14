# PortPlan

AI-assisted disruption triage dashboard for port-to-warehouse deliveries.
Stack: Vite + React + TypeScript, Vitest, ESLint, plain CSS.

## Prerequisites

Node 24 and npm 11. On this machine Node is not on the default PATH; run this first in each shell:

```sh
export PATH="$HOME/.local/node/bin:$PATH"
```

## Commands

```sh
npm install         # install dependencies
npm run dev         # start the dev server (http://localhost:5173)
npm test            # run the test suite once (Vitest)
npm run build       # type-check and build to dist/
npm run typecheck   # type-check only
npm run lint        # ESLint
```

## Environment

Copy `.env.example` to `.env` and fill in values locally. Never commit `.env`.
The LLM key is server-side only (`server/`); only `VITE_`-prefixed variables reach the browser.

## Layout

- `src/types.ts`: shared entity types used across the app
- `src/engine/`: pure TypeScript calculation engine (no UI, no network)
- `src/data/`: JSON sample data
- `src/components/`: React components
- `src/map/`: map panel
- `src/state/`: app state
- `server/`: small Node endpoint for the LLM call
- `docs/`: project documentation
