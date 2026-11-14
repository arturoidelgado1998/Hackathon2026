import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** The repository root. */
export const ROOT = path.resolve(import.meta.dirname, '..')

export const fromRoot = (...parts: string[]) => path.join(ROOT, ...parts)

export const readText = (...parts: string[]) => readFileSync(fromRoot(...parts), 'utf8')

export const readJson = <T>(...parts: string[]): T => JSON.parse(readText(...parts)) as T

/** Every file git tracks, as paths from the repository root. */
export function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}
