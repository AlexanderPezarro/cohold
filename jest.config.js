/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest',
  projects: [
    // Server tests
    {
      displayName: 'server',
      testEnvironment: 'node',
      roots: ['<rootDir>/server/src'],
      testMatch: ['**/__tests__/**/*.test.ts'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
      setupFiles: ['<rootDir>/server/src/services/__tests__/jest.setup.ts'],
      collectCoverageFrom: [
        'server/src/**/*.ts',
        'server/src/**/*.tsx',
        '!server/src/**/*.test.ts',
        '!server/src/**/__tests__/**',
        '!server/src/server.ts',
        '!server/src/db/**',
      ],
      extensionsToTreatAsEsm: ['.ts', '.tsx'],
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            useESM: true,
            tsconfig: {
              jsx: 'react-jsx',
            },
          },
        ],
      },
    },
    // Shared validation tests
    {
      displayName: 'shared',
      testEnvironment: 'node',
      roots: ['<rootDir>/shared'],
      testMatch: ['**/*.test.ts'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
      collectCoverageFrom: ['shared/**/*.ts', '!shared/**/*.test.ts', '!shared/**/*.js'],
      extensionsToTreatAsEsm: ['.ts', '.tsx'],
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            useESM: true,
          },
        ],
      },
    },
    // Client tests
    {
      displayName: 'client',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/client/src'],
      testMatch: ['**/__tests__/**/*.test.tsx', '**/__tests__/**/*.test.ts'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
      setupFilesAfterEnv: ['<rootDir>/client/src/setupTests.ts'],
      moduleNameMapper: {
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
        '^react$': '<rootDir>/client/node_modules/react',
        '^react-dom$': '<rootDir>/client/node_modules/react-dom',
        '^react-dom/(.*)$': '<rootDir>/client/node_modules/react-dom/$1',
        '^react/jsx-runtime$': '<rootDir>/client/node_modules/react/jsx-runtime',
        '^react/jsx-dev-runtime$': '<rootDir>/client/node_modules/react/jsx-dev-runtime',
        '(^|/)viteEnv$': '<rootDir>/client/src/services/viteEnv.mock.ts',
      },
      transform: {
        '^.+\\.(ts|tsx)$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/client/tsconfig.jest.json',
          },
        ],
      },
    },
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
