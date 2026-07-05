const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/.next-build/'],
  modulePathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/.next-build/'],
}

module.exports = createJestConfig(customJestConfig)
