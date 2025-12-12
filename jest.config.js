module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        target: 'ES2020',
        lib: ['ES2020', 'DOM'],
        strict: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        skipLibCheck: true,
        moduleResolution: 'node',
      },
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/api/**/*.ts',
    'src/models/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 40,
      lines: 40,
      statements: 40,
    },
  },
  moduleNameMapper: {
    '^tabby-core$': '<rootDir>/src/__mocks__/tabby-core.ts',
    '^tabby-settings$': '<rootDir>/src/__mocks__/tabby-settings.ts',
    '^tabby-ssh$': '<rootDir>/src/__mocks__/tabby-ssh.ts',
    '^tabby-terminal$': '<rootDir>/src/__mocks__/tabby-terminal.ts',
    '^@angular/core$': '<rootDir>/src/__mocks__/angular-core.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  verbose: true,
  // Ignore service and component tests that need Angular DI
  testPathIgnorePatterns: [
    '/node_modules/',
    'warpgate-profile.service.spec.ts',
  ],
};
