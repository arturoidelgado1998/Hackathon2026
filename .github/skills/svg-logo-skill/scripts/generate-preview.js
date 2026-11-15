#!/usr/bin/env node

/**
 * generate-preview.js
 *
 * Scans a directory for SVG files and generates a preview.html page
 * with side-by-side cards, dark/light toggle, and favicon size checks.
 *
 * Usage:
 *   node scripts/generate-preview.js <svg-directory> [--phase Concepts|Iterations]
 *
 * Examples:
 *   node scripts/generate-preview.js logos/concepts
 *   node scripts/generate-preview.js logos/iterations --phase Iterations
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
if (args.length < 1 || args.includes("--help") || args.includes("-h")) {
  console.log(
    "Usage: node scripts/generate-preview.js <svg-directory> [--phase Concepts|Iterations]"
  );
  process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
}

const svgDir = args[0];
let phase = "Concepts";
const phaseIdx = args.indexOf("--phase");
if (phaseIdx !== -1 && args[phaseIdx + 1]) {
  phase = args[phaseIdx + 1];
}

if (!fs.existsSync(svgDir)) {
  console.error(`Directory not found: ${svgDir}`);
  process.exit(1);
}

// Collect SVG files sorted by name
const svgFiles = fs
  .readdirSync(svgDir)
  .filter((f) => f.endsWith(".svg"))
  .sort();

if (svgFiles.length === 0) {
  console.error(`No SVG files found in ${svgDir}`);
  process.exit(1);
}

const isIteration = phase.toLowerCase().includes("iterat");
const outputDir = path.dirname(svgDir);
const outputPath = path.join(outputDir, "preview.html");

// Build cards (reversed for iterations so most recent is first)
const orderedFiles = isIteration ? [...svgFiles].reverse() : svgFiles;

const cards = orderedFiles
  .map((file) => {
    const label = path.basename(file, ".svg");
    const relPath = path.relative(outputDir, path.join(svgDir, file));
    return `<div class="card">
  <div class="card-img">
    <img src="${relPath}" alt="${label}">
  </div>
  <div class="card-label">${label}</div>
</div>`;
  })
  .join("\n    ");

// Favicon size check strip (for refine phase)
let faviconCheck = "";
if (isIteration) {
  const sizeRows = orderedFiles
    .map((file) => {
      const label = path.basename(file, ".svg");
      const relPath = path.relative(outputDir, path.join(svgDir, file));
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:0.5rem;">
      <div style="font-size:0.8rem;font-weight:500;">${label}</div>
      <div style="display:flex;gap:1rem;align-items:end;">
        <div><img src="${relPath}" width="64" height="64"><div style="font-size:0.75rem;opacity:0.6;">64px</div></div>
        <div><img src="${relPath}" width="32" height="32"><div style="font-size:0.75rem;opacity:0.6;">32px</div></div>
        <div><img src="${relPath}" width="16" height="16"><div style="font-size:0.75rem;opacity:0.6;">16px</div></div>
      </div>
    </div>`;
    })
    .join("\n    ");

  faviconCheck = `
  <h2 style="margin-top:2.5rem;margin-bottom:1rem;">Favicon Size Check</h2>
  <div style="display:flex;gap:2rem;flex-wrap:wrap;align-items:end;">
    ${sizeRows}
  </div>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Logo Preview — ${phase}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 2rem;
    transition: background-color 0.3s, color 0.3s;
  }
  body.light { background: #f5f5f5; color: #333; }
  body.dark { background: #1a1a1a; color: #eee; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }
  h1 { font-size: 1.5rem; font-weight: 600; }
  .toggle {
    padding: 0.5rem 1rem;
    border: 1px solid currentColor;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 0.875rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.5rem;
  }
  .card {
    border: 1px solid rgba(128, 128, 128, 0.3);
    border-radius: 12px;
    overflow: hidden;
  }
  .card-img {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    min-height: 240px;
  }
  body.light .card-img { background: #fff; }
  body.dark .card-img { background: #2a2a2a; }
  .card-img img {
    max-width: 100%;
    max-height: 200px;
  }
  .card-label {
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    border-top: 1px solid rgba(128, 128, 128, 0.3);
  }
  body.light .card-label { background: #fafafa; }
  body.dark .card-label { background: #222; }
</style>
</head>
<body class="light">
  <div class="header">
    <h1>Logo Preview — ${phase}</h1>
    <button class="toggle" onclick="document.body.classList.toggle('dark'); document.body.classList.toggle('light'); this.textContent = document.body.classList.contains('dark') ? '☀️ Light' : '🌙 Dark';">🌙 Dark</button>
  </div>
  <div class="grid">
    ${cards}
  </div>${faviconCheck}
</body>
</html>
`;

fs.writeFileSync(outputPath, html, "utf8");
console.log(`Generated ${outputPath} with ${svgFiles.length} SVG(s)`);
