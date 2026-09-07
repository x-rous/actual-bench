// Runs in every worker before the test framework is installed.
//
// scrypt at the shipped OWASP floor costs about a second per derive by design.
// The vault suites unlock repeatedly, so at production cost they were the six
// slowest files in the repository. Lowering N here keeps those suites about the
// vault's *logic*; the shipped parameters are asserted, and exercised at their
// real cost, in src/lib/sync/vault.test.ts.
process.env.ACTUAL_BENCH_TEST_KDF_N = '16384'
