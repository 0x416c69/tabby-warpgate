/**
 * Jest test setup file
 */

// Mock global fetch for Node.js environment
if (typeof global.fetch === 'undefined') {
  global.fetch = jest.fn();
}

// Mock window for browser-like environment
if (typeof window === 'undefined') {
  (global as any).window = undefined;
}

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
