const { existsSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const tempDirs = require('./jest.tmpdir.cjs')

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

test('uses and removes one per-run directory for all Node temp variables', async () => {
  const names = ['ACTUAL_BENCH_JEST_TMPDIR', 'TMPDIR', 'TEMP', 'TMP']
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  let dir

  try {
    await tempDirs.setup()
    dir = process.env.ACTUAL_BENCH_JEST_TMPDIR

    for (const name of names) expect(process.env[name]).toBe(dir)
    const childTmpdir = execFileSync(process.execPath, ['-p', "require('node:os').tmpdir()"], {
      encoding: 'utf8',
      env: process.env,
    }).trim()
    expect(childTmpdir).toBe(dir)

    await tempDirs.teardown()
    expect(existsSync(dir)).toBe(false)
  } finally {
    if (dir && existsSync(dir)) await tempDirs.teardown()
    for (const name of names) restoreEnv(name, previous[name])
  }
})
