# SVG Logo Skill

An agent-agnostic skill for iterative logo design using SVG. Guides you through a structured interview, exploration, and refinement process to produce polished logos exported as PNGs.

Works with any AI coding agent that can read and write files — Claude Code, Cursor, Aider, OpenHands, and others.

## Installation

```bash
npx skills add longcipher/svg-logo-skill
```

## Usage

The skill activates automatically when you ask your agent to design a logo. Try prompts like:

- "Create a logo for my project"
- "Design a logo for Moonbeam"
- "Make me a logo"

## Workflow

The skill walks you through five phases:

1. **Interview** — The agent asks about your brand, audience, and aesthetic preferences.
2. **Explore** — Generates 3-5 distinct SVG concepts displayed in a side-by-side preview.
3. **Refine** — Iterate on your chosen direction with adjustments to color, layout, and detail.
4. **Export** — Renders final PNGs at standard sizes: 16, 32, 48, 192, 512, 1024, and 2048 px.
5. **Repo Integration** (optional) — Replace logo files in an existing project repo and create a PR.

## Prerequisites

**Node.js 24+** is required for the preview generator and export scripts.

For PNG export, one of the following SVG-to-PNG tools is needed (auto-detected in order):

| Tool | Install command |
|------|----------------|
| **resvg** (recommended) | `brew install resvg` |
| **sharp** | `npm install -g sharp` |
| Inkscape | `brew install inkscape` |
| librsvg | `brew install librsvg` |

For SVG optimization (optional but recommended):

```bash
npm install -g svgo
```

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/generate-preview.js` | Generates `preview.html` from SVGs in a directory |
| `scripts/export.js` | Cross-platform SVG-to-PNG exporter (Node.js) |
| `scripts/export.sh` | Legacy Bash exporter (macOS/Linux only) |
| `scripts/validate-skills.sh` | Validates skill metadata and structure |

## Project Structure

```text
svg-logo-skill/
├── SKILL.md                          # Skill definition and workflow
├── references/
│   ├── SVG-CONVENTIONS.md            # Rules for generating SVG logos
│   ├── EXPORT-SIZES.md               # Standard export sizes reference
│   └── PREVIEW-TEMPLATE.md           # Preview page template reference
└── scripts/
    ├── generate-preview.js           # Preview HTML generator
    ├── export.js                     # SVG-to-PNG exporter
    ├── export.sh                     # Legacy Bash exporter
    └── validate-skills.sh            # Skill validation
```

## License

Apache-2.0

## Acknowledgements

Modified from [neonwatty/logo-designer-skill](https://github.com/neonwatty/logo-designer-skill). Fixed numerous bugs and adapted to support all coding agents (not just Claude Code).
