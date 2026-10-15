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

// DOM event classes referenced by decorator metadata of components
for (const name of ['KeyboardEvent', 'MouseEvent']) {
  if (typeof (global as any)[name] === 'undefined') {
    (global as any)[name] = class {};
  }
}

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
