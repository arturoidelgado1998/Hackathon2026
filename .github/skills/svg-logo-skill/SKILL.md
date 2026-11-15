---
name: svg-logo-skill
description: |
  Design and iterate on logos using SVG. Use this skill when the user asks to
  "create a logo", "design a logo", "make me a logo", "iterate on this logo",
  "logo for my project", or discusses logo design, branding icons, or wordmarks.
license: Apache-2.0
compatibility: "Agent-agnostic. Export and preview scripts require Node.js 24+."
metadata:
  author: Akagi201
  version: "0.1.0"
---

# Logo Designer

Design and iterate on logos using SVG. Generates side-by-side previews and exports to PNG at standard sizes.

## Phase 1: Interview

Before generating anything, gather context and ask the user what they need.

### Step 1: Gather context automatically

If the user points to a repo, URL, or existing project:

- Read the README, package.json, CSS/config files, and any existing branding
- Extract: project name, purpose, tech stack, color palette, design language, fonts
- Summarize what you found before asking questions — this avoids asking things you already know

If the user just says "design a logo" with no project context, skip to Step 2.

### Step 2: Ask structured questions

Ask the user about their preferences. **Batch related questions together** and **skip any question already answered** by the context gathered in Step 1 or by the user's initial message. Present options as a numbered list and wait for input.

**Question 1 — Format:**

```text
What format do you need?

1. Icon only (512x512) — Square icon, works for favicons, app icons, social avatars
2. Wordmark only — Text logo, 1024x512
3. Combination mark — Icon + text together, 1024x512
```

**Question 2 — Style direction:**

```text
What style direction?

1. Minimal / geometric — Clean lines, simple shapes, modern feel
2. Playful / hand-drawn — Friendly, casual, organic shapes
3. Bold / corporate — Strong, professional, high contrast
4. Match existing app style — I'll extract the design language from your project
```

**Question 3 — Color preferences:**

```text
Any color preferences?

1. Use project colors — I'll pull colors from your existing design system
2. Surprise me — I'll pick a palette that fits the vibe
3. I have specific colors — I'll ask you for them
```

**Question 4 — Output size** (only if the user mentioned a specific platform):

```text
Any specific size requirements?

1. Standard sizes — 16, 32, 48, 192, 512, 1024, 2048px, covers most uses
2. Custom size needed — I'll ask for the exact dimensions
```

If your environment supports structured question tools (e.g., `AskUserQuestion`), prefer those over plain text lists. Otherwise, the numbered list above works in any terminal.

### Adapting to context

- **User points to a repo:** Gather context first, then ask only format + style (colors are likely known).
- **User says "design a logo for X":** Ask format, style, and colors together.
- **User gives detailed description:** Skip everything already covered, ask only what's missing.
- **User says "just make something":** Use sensible defaults (icon only, minimal, surprise me) and go straight to Phase 2.

Move to Phase 2 once you have enough to generate distinct concepts.

## SVG Conventions

When generating SVG logos, follow the conventions in [references/SVG-CONVENTIONS.md](references/SVG-CONVENTIONS.md).

## Phase 2: Explore

Generate 3-5 **distinct** SVG logo concepts. Each concept should take a meaningfully different creative direction — vary the icon metaphor, typography style, layout, or overall aesthetic. Do not generate minor variations of the same idea.

### Parallel generation

If your environment supports parallel sub-agents (e.g., Claude Code's `Task` tool, or similar dispatch mechanisms), use them to generate all concepts concurrently. This is significantly faster than writing them sequentially. For sequential fallback, generate each concept one by one.

**Claude Code example** (all in one message to run concurrently):

```text
Task 1: "Write logos/concepts/concept-1.svg — geometric letterform using [colors]. viewBox 512x512. Self-contained SVG, no external fonts. [full SVG conventions]."

Task 2: "Write logos/concepts/concept-2.svg — abstract symbol using [colors]. viewBox 512x512. Self-contained SVG, no external fonts. [full SVG conventions]."

Task 3: "Write logos/concepts/concept-3.svg — mascot-based icon using [colors]. viewBox 512x512. Self-contained SVG, no external fonts. [full SVG conventions]."
```

**Generic dispatch pattern:**

1. Create the `logos/concepts/` directory first
2. For each concept, prepare a design brief containing: format, style, colors, viewBox dimensions, creative direction, project name, and full SVG conventions
3. Dispatch agents in parallel if supported, otherwise generate sequentially
4. Each agent writes its SVG to a specific file path (e.g., `logos/concepts/concept-1.svg`)
5. Ensure each agent has all context it needs — agents do not share memory

### File output

```text
logos/
├── concepts/
│   ├── concept-1.svg
│   ├── concept-2.svg
│   ├── concept-3.svg
│   └── ... (up to concept-5.svg)
└── preview.html
```

After all concepts are generated:

1. Generate the preview page:

```bash
node scripts/generate-preview.js logos/concepts
```

2. Tell the user to open `logos/preview.html` in their browser
3. Briefly describe each concept (1 sentence each) so the user can match descriptions to visuals
4. Ask: "Which direction do you want to explore? Pick a number, or describe what you like/dislike across them."

## Phase 3: Refine

Once the user picks a concept direction, iterate on it.

### Single vs. batch iterations

**Single iteration** — When the user gives specific feedback ("make the icon bigger", "change the blue to green"), apply the change directly and write the next iteration SVG yourself.

**Batch variations** — When exploring multiple directions at once ("try different color palettes", "show me 5 variations of the eye shape", "experiment with bar count"), use parallel sub-agents to generate variations concurrently:

1. Dispatch one agent per variation, all in the same message
2. Each agent receives: the file path to the base SVG (not the inline content), the specific variation to apply, the target file path, and the full SVG conventions
3. Agents must read the base SVG from the provided file path before applying changes
4. After all agents complete, regenerate the preview and present results

**Claude Code batch dispatch example:**

```text
Task 1: "Read logos/iterations/iteration-4.svg as the base. Create a variation with a warm color palette (reds, oranges, yellows). Write to logos/iterations/iteration-5.svg."

Task 2: "Read logos/iterations/iteration-4.svg as the base. Create a variation with a cool color palette (blues, teals, purples). Write to logos/iterations/iteration-6.svg."

Task 3: "Read logos/iterations/iteration-4.svg as the base. Create a variation with a monochrome palette (grays + one accent). Write to logos/iterations/iteration-7.svg."
```

**Generic dispatch pattern:** Pass the base SVG file path to each agent rather than embedding the full SVG content in the prompt. This prevents context overflow with complex SVGs.

### File output

```text
logos/
├── iterations/
│   ├── iteration-1.svg    # First refinement (based on chosen concept)
│   ├── iteration-2.svg
│   └── ...
└── preview.html           # Regenerated to show iterations
```

1. Copy the chosen concept as the starting point — save the first refinement as `logos/iterations/iteration-1.svg`
2. Apply the user's feedback and save each new version with an incrementing number
3. Regenerate the preview after each iteration:

```bash
node scripts/generate-preview.js logos/iterations
```

4. Tell the user to refresh their browser after each iteration
5. After each iteration, briefly describe what changed and ask for next feedback

### Iteration tips

- If the user says "go back to iteration N", use that as the new base
- If the user wants to compare specific iterations, mention which filenames to look at in the preview
- Keep SVG structure consistent across iterations (same group IDs) so the user can track what changed
- Use parallel agents for batch exploration (3+ variations), sequential writes for single tweaks
- **Check small-size legibility** — After generating iterations, run the preview script which includes a favicon size check strip. If thin strokes vanish at 32px, proactively suggest thickening them. If fine details become unreadable, suggest removing or simplifying them.
- When the user is satisfied, move to Phase 4

### Optimize SVGs

After each iteration batch, run SVGO to clean up machine-generated SVG markup:

```bash
npx svgo logos/iterations/iteration-N.svg -o logos/iterations/iteration-N.svg
```

This removes redundant groups, simplifies paths, and produces production-ready markup.

## Phase 4: Export

When the user says "export", "I'm happy with this", "this is the one", or similar:

1. Identify the final iteration SVG (ask the user to confirm which one if ambiguous)
2. Optimize the final SVG with SVGO:

```bash
npx svgo logos/iterations/final.svg -o logos/export/logo.svg
```

3. Create the `logos/export/` directory
4. Run the export script to generate PNGs:

```bash
node scripts/export.js logos/export/logo.svg logos/export/
```

The script produces PNGs at standard sizes (see [references/EXPORT-SIZES.md](references/EXPORT-SIZES.md)).

5. Report the results: list all exported files with their sizes
6. If the export script fails (no conversion tool found), tell the user:
   > "No SVG-to-PNG converter found. Install one of: `cargo install resvg` (recommended), Inkscape, librsvg, or `npm install -g sharp`. Then run export again."

## Phase 5: Repo Integration (optional)

If the user asks to commit the logo to a project repo or create a PR:

1. **Identify target files** — Check the repo for existing icon/logo files: `public/favicon.svg`, `public/favicon.ico`, `public/pwa-*.png`, `public/apple-touch-icon.png`, `assets/logo.svg`, `ios/.../AppIcon.appiconset/`, `public/manifest.json`, etc.
2. **Clone and branch** — Clone the repo (or use the existing checkout), create a branch like `chore/new-logo`
3. **Replace files** — Copy the final SVG as the favicon/logo. Generate platform-specific sizes:
   - `favicon.ico` — 48px (use ImageMagick `convert` or `magick`)
   - `apple-touch-icon.png` — 180px
   - `pwa-192x192.png` — 192px
   - `pwa-512x512.png` — 512px
   - `iOS AppIcon-512@2x.png` — 1024px
   - Only replace files that already exist in the repo — don't add new ones the project doesn't use
4. **Commit and PR** — Commit with a message like `chore: replace logo with new [description]`, push, and create a PR with a summary of what was updated
