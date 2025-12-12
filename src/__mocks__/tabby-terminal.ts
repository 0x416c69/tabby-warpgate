/**
 * Mock for tabby-terminal module
 * Used in unit tests
 */

export class TerminalDecorator {
  decorate(_tab: any): void {}
}

export const TabbyTerminalModule = {
  ngModule: class {},
};
