/**
 * Type declarations for tabby-settings
 */

declare module 'tabby-settings' {
  import { NgModule, Type } from '@angular/core';

  export abstract class SettingsTabProvider {
    id: string;
    title: string;
    icon: string;
    component?: Type<any>;
    weight?: number;
    prioritized?: boolean;

    getComponentType?(): Type<any> | null;
  }

  // The module is exported as default, not as a named export
  const TabbySettingsModule: any;
  export default TabbySettingsModule;
}
