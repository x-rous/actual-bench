const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  // Comfortably above Testing Library's 5s async budget (jest.setup.ts). When
  // the two are equal, Jest's timeout fires first and reports "exceeded
  // timeout" instead of the query error explaining what was missing or
  // ambiguous - which is the whole diagnostic.
  testTimeout: 15000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/.next-build/'],
  modulePathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/.next-build/'],
}

module.exports = createJestConfig(customJestConfig)
