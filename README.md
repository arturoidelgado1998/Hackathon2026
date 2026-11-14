# PortPlan

AI-assisted disruption triage dashboard for port-to-warehouse deliveries.
Stack: Vite + React + TypeScript, Vitest, ESLint, plain CSS.

## Prerequisites

Node 24 and npm 11. Check `node --version` and `npm --version` before installing.
If Node is installed in your user-local directory, add it to each shell:

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
npm run sanity      # build, then run the sanity checks (see below)
```

## Sanity checks

`npm run sanity` builds the app and checks that the project as a whole still works. The checks live in `sanity/` and also run on every pull request (the "Sanity checks on the built app" job).

- **Repository:** the scripts the README and the pipeline call exist, the layout below is in place, and no `.env` file, key or build output is checked in.
- **Change log:** `docs/changelog.json` adds up, refers only to issues that exist, and every file it says was built is still there.
- **Build:** the page and its files are complete, and the ArcGIS map stays out of the first page load.
- **Browser:** the built app is opened in headless Chromium and taken through the main flow: start, closure, compare responses, every shipment, reset, and the real map.

The browser check needs Chromium once per machine: `npx playwright install --only-shell chromium`. Use `npm run test:sanity` to rerun the checks without rebuilding.

## Sample dashboard workflow

- The dashboard starts in **Disrupted**, showing the simulated NB-03 closure. Select a
  shipment under **Needs review** to compare responses. **Normal** remains available.
- A first-use prompt explains this path in the Normal scenario. On small screens,
  empty board groups are collapsed behind **Show empty groups**; select a shipment and
  use **View responses** to jump to its comparison, or **Back to shipments** to return.
- **Preview** highlights an option's route without changing decisions or totals.
  A **Preview only** notice distinguishes it from the recorded choice; **Cancel preview**
  returns to the current plan.
- **Choose wait** or **Use reroute** records the response and shows a confirmation.
  **Request slot** records a simulated request that stays **Awaiting confirmation**,
  retaining the shipment's original risk and current-plan totals.
- Before a slot is requested, its status is **Requires confirmation**, not pending.
- **Undo last choice** reverses the most recent response choice, restoring the prior
  decision or Needs review state, any prior rejection note, routes, risk and totals.
  Other shipments are unchanged. Undo is one step, not a decision history or an external
  cancellation; switching scenarios or Reset clears it.
- **Reject all** keeps a shipment in Needs review with the dispatcher's rejection note.
- The indicators sum supplied sample values through `getTotals(state)`; no engine calculations
  run in this phase. Switching scenarios clears scenario-specific decisions.
- **Reset** restores the initial Disrupted scenario with no decisions or selected shipment,
  collapses empty groups, and clears preview and Undo state.
- **Why?** opens and focuses the option's supplied explanation inputs. Use **Close**
  or Escape to return focus to its Why button. **Assumptions & sources**
  lists placeholder values, citations, value-type labels and the twelve limitations from
  issue #9. Use **Expand panel** in the bottom bar to read the full, scrollable panel;
  collapse it or press Escape to return to the dashboard. On mobile the bar stays within
  reach at the bottom of the screen. Reset also closes the panel. The reusable limitations
  text lives in `src/data/limitations.ts`.

## Impeccable design skill

The project-scoped GitHub Copilot skill is installed in `.github/skills/impeccable/`.
Reload your coding tool if `/impeccable` does not appear. This dashboard uses the
existing restrained design system; the skill's polish guidance is not a redesign.
Telemetry is disabled in `.impeccable/config.json`. Automatic hooks are not enabled;
run the local detector explicitly after UI changes:

```sh
.github/skills/impeccable/scripts/impeccable detect --json src/
```

The launcher downloads its checksum-verified, platform-specific engine on first use
when necessary. Engine binaries are not committed. The install adds no application
dependencies and does not send source files to Impeccable.

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
- `sanity/`: sanity checks on the repository, the change log, the build and the built app
- `docs/`: project documentation

## Map

The Routes pane draws the port, warehouses and routes with the ArcGIS Maps SDK for JavaScript (`src/map/ArcgisMap.tsx`). It is loaded on demand, and if it cannot load the pane falls back to the route list.

- **No API key is needed.** Without one the map uses Esri's keyless light gray basemap.
- **Optional key:** put `VITE_ARCGIS_API_KEY=...` in a local `.env` (never commit it) to use the `arcgis/light-gray` basemap style.
- **Data:** the map draws the same data as the rest of the app, from `src/data`. Refresh it from the team's feature service with `python3 scripts/import_map_data.py`.

## Change log

[`docs/changelog.json`](docs/changelog.json) has one entry per GitHub issue: what changed, which files, how it was checked and what is left. Read it before starting an issue and update your issue's entry in the same pull request. The file's `_meta.how_to_update` lists the steps.
