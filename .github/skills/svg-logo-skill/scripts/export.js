#!/usr/bin/env node

/**
 * export.js
 *
 * Cross-platform SVG-to-PNG exporter. Detects available conversion tools
 * and exports SVGs at standard logo sizes.
 *
 * Usage:
 *   node scripts/export.js <input.svg> <output-dir>
 *
 * Supported converters (auto-detected in order):
 *   1. resvg (global)
 *   2. sharp (Node.js library)
 *   3. inkscape
 *   4. rsvg-convert
 */

const { execSync, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SIZES = [16, 32, 48, 192, 512, 1024, 2048];
const BASENAME = "logo";

// ── Argument parsing ────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 2 || args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/export.js <input.svg> <output-dir>");
  console.log(
    "\nSupported converters: resvg, sharp, inkscape, rsvg-convert"
  );
  process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
}

const inputSvg = path.resolve(args[0]);
const outputDir = path.resolve(args[1]);

if (!fs.existsSync(inputSvg)) {
  console.error(`Input SVG not found: ${inputSvg}`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

// Copy SVG to output
fs.copyFileSync(inputSvg, path.join(outputDir, `${BASENAME}.svg`));

// ── Tool detection ──────────────────────────────────────────────────────

function cmdExists(cmd) {
  try {
    execSync(
      process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`,
      { stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

function detectTool() {
  if (cmdExists("resvg")) return "resvg";

  try {
    execSync('node -e "require(\'sharp\')"', { stdio: "ignore" });
    return "sharp";
  } catch {
    // sharp not installed
  }

  if (cmdExists("inkscape")) return "inkscape";
  if (cmdExists("rsvg-convert")) return "rsvg-convert";

  return null;
}

// ── Export functions ────────────────────────────────────────────────────

function exportWithResvg(size, output) {
  execFileSync("resvg", [inputSvg, output, "--width", String(size)]);
}

function exportWithSharp(size, output) {
  const sharp = require("sharp");
  // Synchronous-ish via execSync to avoid top-level await
  execSync(
    `node -e "
      const sharp = require('sharp');
      sharp('${inputSvg.replace(/'/g, "\\'")}')
        .resize(${size}, ${size}, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile('${output.replace(/'/g, "\\'")}')
        .then(() => process.exit(0))
        .catch(e => { console.error(e); process.exit(1); });
    "`
  );
}

function exportWithInkscape(size, output) {
  execFileSync("inkscape", [
    inputSvg,
    "--export-type=png",
    `--export-filename=${output}`,
    `--export-width=${size}`,
  ]);
}

function exportWithRsvgConvert(size, output) {
  execFileSync("rsvg-convert", [
    "-w",
    String(size),
    "-o",
    output,
    inputSvg,
  ]);
}

// ── Main ────────────────────────────────────────────────────────────────

const tool = detectTool();

if (!tool) {
  console.error("ERROR: No SVG-to-PNG converter found.");
  console.error("");
  console.error("Install one of the following:");
  console.error("  cargo install resvg              (recommended)");
  console.error("  brew install resvg");
  console.error("  brew install inkscape");
  console.error("  brew install librsvg");
  process.exit(1);
}

console.log(`Using: ${tool}`);
console.log("");

const exporters = {
  resvg: exportWithResvg,
  sharp: exportWithSharp,
  inkscape: exportWithInkscape,
  "rsvg-convert": exportWithRsvgConvert,
};

const exportFn = exporters[tool];

for (const size of SIZES) {
  const output = path.join(outputDir, `${BASENAME}-${size}.png`);
  try {
    exportFn(size, output);
    console.log(`  Exported: ${BASENAME}-${size}.png (${size}x${size})`);
  } catch (err) {
    console.error(`  Failed: ${BASENAME}-${size}.png — ${err.message}`);
  }
}

console.log("");
console.log(`Done. Files in: ${outputDir}`);
