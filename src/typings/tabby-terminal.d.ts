/**
 * Type declarations for tabby-terminal
 */

declare module 'tabby-terminal' {
  import { NgModule } from '@angular/core';

  export abstract class TerminalDecorator {
    abstract decorate(tab: any): void;
  }

  export const TabbyTerminalModule: NgModule;
}
