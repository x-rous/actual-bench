// Runs in every worker before the test framework is installed.
//
// scrypt at the shipped OWASP floor costs about a second per derive by design.
// The vault suites unlock repeatedly, so at production cost they were the six
// slowest files in the repository. Lowering N here keeps those suites about the
// vault's *logic*; the shipped parameters are asserted, and exercised at their
// real cost, in src/lib/sync/vault.test.ts.
process.env.ACTUAL_BENCH_TEST_KDF_N = '16384'

// Automation jobs run in the test's own thread. Real worker threads cannot load
// the TypeScript worker entry under Jest (it is compiled by Turbopack), so the
// worker path is exercised by running its task host in-thread and by a fake
// worker in the supervisor tests; the Docker smoke test checks a real thread
// starts in the production image.
process.env.ACTUAL_BENCH_AUTOMATION_EXECUTOR = 'in-thread'

// The credential vault always exists (F-197). A fixed key here gives every
// suite a ready vault without touching the filesystem; suites that exercise the
// generated key file or the locked states unset it and point
// ACTUAL_BENCH_DB_PATH at a temp directory.
process.env.ACTUAL_BENCH_VAULT_KEY = 'jest-operator-vault-key'

// Tests never inherit a developer's database path. The dev container sets
// ACTUAL_BENCH_DB_PATH so `next dev` has a local metadata database, and a shell or
// a deployment can set it too. Left in place, every suite that opens the app
// database without choosing a path shares that one file, and the suites that close
// or reset it break each other ("The database connection is not open"). Suites
// that need a path set their own, after this runs, pointing at a temp directory.
delete process.env.ACTUAL_BENCH_DB_PATH
