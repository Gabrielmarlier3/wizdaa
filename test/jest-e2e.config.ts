import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  globalSetup: '<rootDir>/test/e2e/globalSetup.ts',
  globalTeardown: '<rootDir>/test/e2e/globalTeardown.ts',
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/**/*.module.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/database/migrate.ts',
  ],
  coverageDirectory: 'coverage-e2e',
  coverageReporters: ['text', 'text-summary'],
  // The mock HCM is a single Express process started once by
  // globalSetup. Scenario flips via POST /test/scenario mutate
  // shared state that parallel workers race on — latent in the
  // approve-scenario specs and pushed past the breaking point by
  // the outbox worker slice. Serialising e2e specs at the worker
  // level is the simplest correct fix; per-worker mock instances
  // would add port allocation and lifecycle complexity for no
  // real gain.
  maxWorkers: 1,
};

export default config;
