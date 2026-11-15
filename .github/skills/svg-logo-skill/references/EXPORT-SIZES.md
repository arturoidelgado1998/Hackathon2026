# Export Sizes

Standard PNG sizes produced by the export script:

| File | Size |
|------|------|
| logo-16.png | 16x16 |
| logo-32.png | 32x32 |
| logo-48.png | 48x48 |
| logo-192.png | 192x192 |
| logo-512.png | 512x512 |
| logo-1024.png | 1024x1024 |
| logo-2048.png | 2048x2048 |

## Prerequisites

Node.js 16+ is required. The export script auto-detects which SVG-to-PNG tool is available.

| Tool | Install command |
|------|----------------|
| **resvg** (recommended) | `cargo install resvg` or `brew install resvg` |
| Inkscape | `brew install inkscape` |
| librsvg | `brew install librsvg` |

If `sharp` is installed globally (`npm install -g sharp`), it will also be detected.

## Usage

```bash
node scripts/export.js <input.svg> <output-dir>
```

The script works on macOS, Linux, and Windows (requires Node.js, no Bash needed).

The legacy Bash script is still available:

```bash
bash scripts/export.sh <input.svg> <output-dir>
```
