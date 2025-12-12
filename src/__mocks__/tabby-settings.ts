/**
 * Mock for tabby-settings module
 * Used in unit tests
 */

export class SettingsTabProvider {
  id = '';
  title = '';
  icon = '';
  component: any = null;
  weight = 0;
}

export const TabbySettingsModule = {
  ngModule: class {},
};
