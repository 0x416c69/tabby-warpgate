/**
 * Type declarations for tabby-settings
 */

declare module 'tabby-settings' {
  import { Type } from '@angular/core';
  import { BaseTabComponent } from 'tabby-core';

  export abstract class SettingsTabProvider {
    id: string;
    title: string;
    icon: string;
    component?: Type<any>;
    weight?: number;
    prioritized?: boolean;

    getComponentType?(): Type<any> | null;
  }

  /** Tabby's settings tab, accepts the ID of the settings section to show as `activeTab` input */
  export class SettingsTabComponent extends BaseTabComponent {
    activeTab: string;
  }

  // The module is exported as default, not as a named export
  const TabbySettingsModule: any;
  export default TabbySettingsModule;
}
