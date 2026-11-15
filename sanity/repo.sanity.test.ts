// Is the repository itself in order? Scripts the docs and the pipeline call,
// the layout the README promises, and nothing secret or generated checked in.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromRoot, readJson, readText, trackedFiles } from './helpers.ts'

const pkg = readJson<{ scripts: Record<string, string> }>('package.json')
const readme = readText('README.md')
const tracked = trackedFiles()

/** Names used as `npm run <name>`, plus `test` for a bare `npm test`. */
function npmScriptsCalledIn(text: string): string[] {
  const names = [...text.matchAll(/\bnpm run ([\w:-]+)/g)].map((m) => m[1])
  if (/\bnpm test\b/.test(text)) names.push('test')
  return [...new Set(names)]
}

describe('npm scripts', () => {
  it('has every script the README tells people to run', () => {
    const called = npmScriptsCalledIn(readme)
    expect(called.length).toBeGreaterThan(0)
    expect(called.filter((name) => !(name in pkg.scripts))).toEqual([])
  })

  it('has every script the GitHub Actions workflows run', () => {
    const dir = fromRoot('.github', 'workflows')
    const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))
    expect(workflows.length).toBeGreaterThan(0)
    for (const file of workflows) {
      const called = npmScriptsCalledIn(readText('.github', 'workflows', file))
      expect(called.filter((name) => !(name in pkg.scripts)), `${file} runs a script package.json lacks`).toEqual([])
    }
  })
})

describe('pipeline', () => {
  const workflows = readdirSync(fromRoot('.github', 'workflows'))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => readText('.github', 'workflows', f))
    .join('\n')

  it('runs the unit tests, the build and the sanity checks on pull requests into staging and main', () => {
    for (const script of ['lint', 'typecheck', 'build', 'test:sanity']) {
      expect(workflows, `npm run ${script}`).toMatch(new RegExp(`\\bnpm run ${script}\\b`))
    }
    expect(workflows).toMatch(/\bnpm test\b/)
    expect(workflows).toMatch(/pull_request:\s*\n\s*branches: \[main, staging\]/)
    // The browser check needs a browser, and the data checks need Python.
    expect(workflows).toMatch(/playwright install .*chromium/)
    expect(workflows).toMatch(/python3 --version/)
  })

  it('asks the real model only with the key from a repository secret, never one written in the file', () => {
    expect(workflows).toMatch(/\bnpm run ai:tests -- --check\b/)
    expect(workflows).toMatch(/LLM_API_KEY: \$\{\{ secrets\.LLM_API_KEY \}\}/)
    // Every mention of the key is the secret reference, a comment or the skip message.
    const assigned = [...workflows.matchAll(/LLM_API_KEY:\s*(\S.*)/g)].map((m) => m[1].trim())
    expect(assigned).toEqual(['${{ secrets.LLM_API_KEY }}'])
    expect(workflows).toMatch(/HAS_KEY: \$\{\{ secrets\.LLM_API_KEY != '' \}\}/)
    // pull_request_target would hand the secret to code from a fork.
    expect(workflows).not.toMatch(/pull_request_target/)
  })

  it('picks up every sanity check: none is left out by its file name', () => {
    expect(pkg.scripts['test:sanity']).toContain('vitest.sanity.config.ts')
    expect(readText('vitest.sanity.config.ts')).toContain("include: ['sanity/**/*.sanity.test.ts']")
    const tests = readdirSync(fromRoot('sanity')).filter((f) => /\.test\.tsx?$/.test(f))
    expect(tests.length).toBeGreaterThanOrEqual(5)
    expect(tests.filter((f) => !f.endsWith('.sanity.test.ts'))).toEqual([])
    // And the unit tests do not run them by accident.
    expect(readdirSync(fromRoot('sanity')).filter((f) => /\.(test|spec)\.tsx?$/.test(f) && !/\.sanity\./.test(f))).toEqual([])
  })
})

describe('project layout', () => {
  it('has every path the README layout lists', () => {
    const layout = readme.split(/^## Layout$/m)[1]?.split(/^## /m)[0] ?? ''
    const paths = [...layout.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1])
    expect(paths.length).toBeGreaterThan(0)
    const missing = paths.filter((p) => !existsSync(fromRoot(p)))
    expect(missing).toEqual([])
  })

  it('has the entry points the app is built from', () => {
    for (const file of ['index.html', 'src/main.tsx', 'src/App.tsx', 'src/types.ts', 'docs/changelog.json']) {
      expect(existsSync(fromRoot(file)), file).toBe(true)
    }
    expect(readText('index.html')).toContain('src="/src/main.tsx"')
  })

  it('has data import scripts that are valid Python', () => {
    const scripts = tracked.filter((f) => /^scripts\/.+\.py$/.test(f))
    expect(scripts.length).toBeGreaterThan(0)
    // Parse only: running them would call the feature service.
    const parse = 'import ast, sys\nfor p in sys.argv[1:]:\n    ast.parse(open(p, encoding="utf-8").read(), p)'
    expect(() =>
      execFileSync('python3', ['-c', parse, ...scripts.map((s) => fromRoot(s))], { stdio: 'pipe' }),
    ).not.toThrow()
  })
})

describe('secrets and generated files', () => {
  it('tracks no .env file, dependencies or build output', () => {
    const unwanted = tracked.filter(
      (f) =>
        (/(^|\/)\.env(\..+)?$/.test(f) && f !== '.env.example') ||
        /(^|\/)(node_modules|dist|coverage)\//.test(f),
    )
    expect(unwanted).toEqual([])
  })

  it('keeps .env.example to variable names with no values', () => {
    const lines = readText('.env.example')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toMatch(/^[A-Z][A-Z0-9_]*=$/)
  })

  it('has nothing that looks like a key or token in tracked files', () => {
    const patterns: [string, RegExp][] = [
      ['ArcGIS API key', /\bAAP[KT][0-9A-Za-z_-]{40,}/],
      ['Anthropic API key', /\bsk-ant-[0-9A-Za-z_-]{20,}/],
      ['OpenAI-style API key', /\bsk-(proj-)?[0-9A-Za-z]{32,}/],
      ['AI Squared Bolt key', /\bsk-bolt-[0-9A-Za-z][0-9A-Za-z-]{5,}/],
      ['GitHub token', /\bgh[pousr]_[0-9A-Za-z]{30,}/],
      ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
      ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ]
    const text = /\.(ts|tsx|js|mjs|cjs|json|md|html|css|py|ya?ml|example|txt)$/
    const found: string[] = []
    for (const file of tracked) {
      if (!text.test(file) || file === 'package-lock.json') continue
      if (statSync(fromRoot(file)).size > 2_000_000) continue
      const content = readText(file)
      for (const [name, pattern] of patterns) {
        if (pattern.test(content)) found.push(`${file}: ${name}`)
      }
    }
    expect(found).toEqual([])
  })

  it('reads only VITE_ variables in browser code, never the server-side LLM key', () => {
    const builtIn = new Set(['MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL'])
    const problems: string[] = []
    for (const file of tracked.filter((f) => /^src\/.+\.(ts|tsx)$/.test(f))) {
      const content = readText(file)
      for (const [, name] of content.matchAll(/import\.meta\.env\.([A-Za-z_]\w*)/g)) {
        if (!name.startsWith('VITE_') && !builtIn.has(name)) problems.push(`${file}: import.meta.env.${name}`)
      }
      if (/\b(LLM_(API_KEY|PROVIDER|BASE_URL|MODEL)|ANTHROPIC_(API_KEY|MODEL))\b/.test(content)) {
        problems.push(`${file}: names a server-side variable`)
      }
      if (/@anthropic-ai\/sdk/.test(content)) problems.push(`${file}: imports the model SDK into browser code`)
      if (/from\s+['"][^'"]*\/server\//.test(content)) problems.push(`${file}: imports from server/`)
      if (/\bprocess\.env\b/.test(content)) problems.push(`${file}: reads process.env`)
    }
    expect(problems).toEqual([])
  })
})
