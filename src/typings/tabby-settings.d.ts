/**
 * Type declarations for tabby-settings
 */

declare module 'tabby-settings' {
  import { NgModule, Type } from '@angular/core';

  export abstract class SettingsTabProvider {
    id: string;
    title: string;
    icon: string;
    component: Type<any>;
    weight?: number;
  }

  export class TabbySettingsModule {}
}
