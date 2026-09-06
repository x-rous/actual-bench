const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const ignore = ['<rootDir>/.next/', '<rootDir>/.next-build/']

// The four `.test.ts` files that genuinely need a DOM: they read localStorage or
// render a hook. Everything else under `.test.ts` is pure Node logic and pays
// nothing for jsdom. Keep this list short — a new entry here is usually a sign
// the logic wants extracting out of the browser-coupled module instead.
const TS_TESTS_NEEDING_DOM = [
  '<rootDir>/src/features/budget-management/hooks/useBulkAction.test.ts',
  '<rootDir>/src/features/budget-management/lib/budgetSaveReview.test.ts',
  '<rootDir>/src/features/query/lib/savedQueriesMigration.test.ts',
  '<rootDir>/src/store/connection.test.ts',
]

const shared = {
  setupFiles: ['<rootDir>/jest.env.cjs'],
  // next/jest rewrites `@/...` in import statements through the SWC transform,
  // which does not reach the string argument of `jest.mock()` — mocking an
  // aliased module failed to resolve. Mapping it explicitly makes the alias work
  // the same way everywhere.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Comfortably above Testing Library's 5s async budget (jest.setup.ts). When
  // the two are equal, Jest's timeout fires first and reports "exceeded
  // timeout" instead of the query error explaining what was missing or
  // ambiguous - which is the whole diagnostic.
  testTimeout: 15000,
  testPathIgnorePatterns: ignore,
  modulePathIgnorePatterns: ignore,
}

// Two environments, routed by what a test actually needs. Component tests get a
// DOM; the ~244 pure-Node suites do not stand one up per file, which is most of
// the suite. A file can still override with an `@jest-environment` docblock.
const browser = createJestConfig({
  ...shared,
  displayName: 'browser',
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/*.test.tsx', ...TS_TESTS_NEEDING_DOM],
})

const node = createJestConfig({
  ...shared,
  displayName: 'node',
  testEnvironment: 'node',
  // No jest.setup.ts: every shim in it is a DOM shim, and Node 22 already has
  // structuredClone. Loading @testing-library/jest-dom into 244 pure-logic
  // suites is the cost this split exists to remove.
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: [...ignore, ...TS_TESTS_NEEDING_DOM],
})

module.exports = async () => {
  const [browserConfig, nodeConfig] = await Promise.all([browser(), node()])
  return {
    projects: [browserConfig, nodeConfig],
    // Coverage is configured at the root: with `projects`, per-project coverage
    // options are ignored.
    coverageReporters: ['text-summary', 'json-summary', 'lcov'],
    collectCoverageFrom: [
      'src/**/*.{ts,tsx}',
      '!src/**/*.test.{ts,tsx}',
      '!src/**/*.d.ts',
      '!src/types/**',
    ],
  }
}
