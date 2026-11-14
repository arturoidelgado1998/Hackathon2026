// Is docs/changelog.json still a record the team can trust? It is edited by
// hand in every pull request, so these checks catch the slips that creep in:
// counts that no longer add up, references to issues that do not exist, and
// files it says were built that are no longer there.

import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromRoot, readJson } from './helpers.ts'

interface FileLists {
  added: string[]
  modified: string[]
  deleted: string[]
}

interface CommitRecord {
  hash: string
  date: string
  message: string
  files: FileLists
}

interface Issue {
  number: number
  code: string
  title: string
  status: string
  assignee: string | null
  branch: string | null
  pull_request: number | null
  commit: CommitRecord | null
  depends_on: string[]
  changes: string[]
  verification: string[]
}

interface OtherChange {
  id: string
  title: string
  related_issues: number[]
  commit: CommitRecord | null
  changes: string[]
}

interface Entry {
  id: string
  date: string
  title: string
  summary: string
  issues?: number[]
  related_issues?: number[]
  verification: string[]
}

interface Changelog {
  _meta: { last_updated: string; status_values: Record<string, string> }
  summary: {
    counts: Record<string, number>
    pull_requests: { number: number; state: string }[]
    next_up: number[]
  }
  issues: Issue[]
  other_changes: OtherChange[]
  entries: Entry[]
}

const log = readJson<Changelog>('docs', 'changelog.json')

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const GIT_HASH = /^[0-9a-f]{7,40}$/
const duplicates = <T>(values: T[]) => values.filter((v, i) => values.indexOf(v) !== i)

/** Every `{ added, modified, deleted }` record anywhere in the change log. */
function fileLists(node: unknown, found: FileLists[] = []): FileLists[] {
  if (Array.isArray(node)) {
    for (const item of node) fileLists(item, found)
  } else if (node !== null && typeof node === 'object') {
    const record = node as Partial<FileLists>
    if (Array.isArray(record.added) && Array.isArray(record.modified) && Array.isArray(record.deleted)) {
      found.push(record as FileLists)
    }
    for (const value of Object.values(node)) fileLists(value, found)
  }
  return found
}

describe('change log structure', () => {
  it('has every section', () => {
    expect(Object.keys(log)).toEqual(
      expect.arrayContaining(['_meta', 'summary', 'issues', 'other_changes', 'entries']),
    )
    expect(log.issues.length).toBeGreaterThan(0)
    expect(log.entries.length).toBeGreaterThan(0)
  })

  it('has dated entries, newest first, none later than last_updated', () => {
    expect(log._meta.last_updated).toMatch(ISO_DATE)
    const dates = log.entries.map((e) => e.date)
    for (const date of dates) expect(date).toMatch(ISO_DATE)
    expect(dates).toEqual([...dates].sort().reverse())
    for (const date of dates) expect(date <= log._meta.last_updated, `entry dated ${date}`).toBe(true)
  })

  it('has entries that say what was done and how it was checked', () => {
    expect(duplicates(log.entries.map((e) => e.id))).toEqual([])
    for (const entry of log.entries) {
      expect(entry.title, entry.id).toBeTruthy()
      expect(entry.summary, entry.id).toBeTruthy()
      expect(entry.verification?.length, `${entry.id} verification`).toBeGreaterThan(0)
    }
  })
})

describe('change log issues', () => {
  const statuses = Object.keys(log._meta.status_values)
  const numbers = log.issues.map((i) => i.number)
  const codes = log.issues.map((i) => i.code)

  it('gives each issue a unique number and code, a title and a known status', () => {
    expect(duplicates(numbers)).toEqual([])
    expect(duplicates(codes)).toEqual([])
    for (const issue of log.issues) {
      expect(Number.isInteger(issue.number) && issue.number > 0, `#${issue.number}`).toBe(true)
      expect(issue.title, `#${issue.number} title`).toBeTruthy()
      expect(statuses, `#${issue.number} status`).toContain(issue.status)
    }
  })

  it('has summary counts that match the issues', () => {
    const tally: Record<string, number> = {}
    for (const issue of log.issues) tally[issue.status] = (tally[issue.status] ?? 0) + 1
    const stated = Object.fromEntries(Object.entries(log.summary.counts).filter(([, n]) => n !== 0))
    expect(stated).toEqual(tally)
  })

  it('records who, where and what for every issue that has been worked on', () => {
    for (const issue of log.issues) {
      const label = `#${issue.number} ${issue.code} (${issue.status})`
      if (issue.status === 'done' || issue.status === 'in_review') {
        expect(issue.assignee, `${label} assignee`).toBeTruthy()
        expect(issue.branch, `${label} branch`).toBeTruthy()
        expect(issue.commit?.hash, `${label} commit`).toMatch(GIT_HASH)
        expect(issue.changes.length, `${label} changes`).toBeGreaterThan(0)
        expect(issue.verification.length, `${label} verification`).toBeGreaterThan(0)
      }
      if (issue.status === 'not_started') {
        expect(issue.commit, `${label} should have no commit yet`).toBeNull()
      }
    }
  })

  it('only refers to issues and pull requests that exist', () => {
    const problems: string[] = []
    const knownIssue = (n: number) => numbers.includes(n)
    const pullRequests = log.summary.pull_requests.map((p) => p.number)

    for (const issue of log.issues) {
      for (const code of issue.depends_on ?? []) {
        if (!codes.includes(code)) problems.push(`#${issue.number} depends on unknown ${code}`)
      }
      if (issue.pull_request !== null && !pullRequests.includes(issue.pull_request)) {
        problems.push(`#${issue.number} names pull request ${issue.pull_request}, missing from summary.pull_requests`)
      }
    }
    for (const change of log.other_changes) {
      for (const n of change.related_issues ?? []) {
        if (!knownIssue(n)) problems.push(`other_changes ${change.id} names unknown issue #${n}`)
      }
    }
    for (const entry of log.entries) {
      for (const n of [...(entry.issues ?? []), ...(entry.related_issues ?? [])]) {
        if (!knownIssue(n)) problems.push(`entry ${entry.id} names unknown issue #${n}`)
      }
    }
    for (const n of log.summary.next_up) {
      const issue = log.issues.find((i) => i.number === n)
      if (!issue) problems.push(`next_up names unknown issue #${n}`)
      else if (issue.status === 'done') problems.push(`next_up still lists #${n}, which is done`)
    }
    expect(duplicates(pullRequests)).toEqual([])
    expect(problems).toEqual([])
  })
})

describe('change log against the repository', () => {
  it('gives every piece of other work a unique id, a title and its changes', () => {
    expect(duplicates(log.other_changes.map((c) => c.id))).toEqual([])
    for (const change of log.other_changes) {
      expect(change.title, change.id).toBeTruthy()
      expect(change.changes.length, `${change.id} changes`).toBeGreaterThan(0)
      if (change.commit !== null) expect(change.commit.hash, `${change.id} commit`).toMatch(GIT_HASH)
    }
  })

  it('still has every file it says was added or changed, unless it also says the file was deleted', () => {
    const lists = fileLists(log)
    expect(lists.length).toBeGreaterThan(0)
    const deleted = new Set(lists.flatMap((l) => l.deleted))
    const built = new Set(lists.flatMap((l) => [...l.added, ...l.modified]))
    // If this fails after removing or renaming a file on purpose, list the old
    // path under "deleted" in the change log record for the commit that did it.
    const missing = [...built].filter((file) => !deleted.has(file) && !existsSync(fromRoot(file))).sort()
    expect(missing).toEqual([])
  })
})
