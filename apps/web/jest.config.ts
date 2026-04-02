import type { Config } from 'jest'

const config: Config = {
  testEnvironment: 'jsdom',
  // FIXED: was 'setupFilesAfterFramework' which is not a valid Jest key
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    // App alias
    '^@/(.*)$': '<rootDir>/$1',
    // Monorepo package aliases — required for synthesis.test.ts and others
    '^@clincollab/shared-utils/(.*)$': '<rootDir>/../../packages/shared-utils/src/$1',
    '^@clincollab/shared-utils$':      '<rootDir>/../../packages/shared-utils/src/index',
    '^@clincollab/types$':             '<rootDir>/../../packages/types/src/index',
    '^@clincollab/types/(.*)$':        '<rootDir>/../../packages/types/src/$1',
    '^@clincollab/notification-bus$':  '<rootDir>/../../packages/notification-bus/src/index',
    // CSS / static asset mocks (prevent import errors in component tests)
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.ts',
    '\\.(jpg|jpeg|png|gif|svg|ico|webp)$': '<rootDir>/__mocks__/fileMock.ts',
  },
  testMatch: [
    // Unit, component, API, DB, integration, NFR, workflow tests
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    // E2E tests are run by Playwright, NOT Jest
    '<rootDir>/e2e/',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: { jsx: 'react-jsx' },
    }],
  },
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    '!app/**/*.d.ts',
    '!app/layout.tsx',
    '!app/**/page.tsx',   // server components — covered by E2E
    '!**/*.stories.{ts,tsx}',
  ],
  coverageThreshold: {
    global: {
      branches:  65,
      functions: 65,
      lines:     65,
    },
  },
  // Increase timeout for integration-style tests that simulate async flows
  testTimeout: 15000,
}

export default config
