// One temporary folder per test run, removed when the run ends.
//
// About 90 suites make a throwaway database with mkdtempSync(tmpdir()) and never
// delete it, which filled the disk. Pointing TMPDIR at a folder for this run
// (workers inherit it) lets one teardown clean up after all of them. Folders left
// by a run that was killed are swept on the next start once they are old.
const { mkdtempSync, readdirSync, rmSync, statSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const PREFIX = 'actual-bench-jest-'
const STALE_MS = 6 * 60 * 60 * 1000

async function setup() {
  const base = tmpdir()
  for (const name of readdirSync(base)) {
    if (!name.startsWith(PREFIX)) continue
    const path = join(base, name)
    try {
      if (Date.now() - statSync(path).mtimeMs > STALE_MS) rmSync(path, { recursive: true, force: true })
    } catch {
      // Another run may be removing it.
    }
  }
  const dir = mkdtempSync(join(base, PREFIX))
  process.env.ACTUAL_BENCH_JEST_TMPDIR = dir
  process.env.TMPDIR = dir
}

async function teardown() {
  const dir = process.env.ACTUAL_BENCH_JEST_TMPDIR
  if (dir) rmSync(dir, { recursive: true, force: true })
}

module.exports = { setup, teardown }
