import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/postgres'],
  testMatch: ['**/*.integration.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@database/(.*)$': '<rootDir>/src/database/$1'
  },
  globalSetup: '<rootDir>/jest.postgres.global-setup.ts',
  setupFiles: ['<rootDir>/tests/postgres/env.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/postgres/jest.setup.ts'],
  verbose: true,
  forceExit: true,
  testTimeout: 30000
};

export default config;
