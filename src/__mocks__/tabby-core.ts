/**
 * Mock for tabby-core module
 * Used in unit tests
 */

export const ConfigService = jest.fn().mockImplementation(() => ({
  store: {
    warpgate: null,
  },
  save: jest.fn(),
}));

export const NotificationsService = jest.fn().mockImplementation(() => ({
  info: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
}));

export const PlatformService = jest.fn().mockImplementation(() => ({
  getOS: jest.fn().mockReturnValue('linux'),
}));

export const AppService = jest.fn().mockImplementation(() => ({
  openNewTab: jest.fn(),
}));

export const ProfilesService = jest.fn().mockImplementation(() => ({
  openNewTabForProfile: jest.fn(),
}));

export const SelectorService = jest.fn().mockImplementation(() => ({
  show: jest.fn(),
}));

export class ProfileProvider {
  id = '';
  name = '';
  supportsQuickConnect = false;
  settingsComponent = null;

  getBuiltinProfiles(): Promise<any[]> {
    return Promise.resolve([]);
  }

  getSuggestedName(_profile: any): string | null {
    return null;
  }

  getDescription(_profile: any): string {
    return '';
  }

  async getNewTabParameters(_profile: any): Promise<any> {
    return {};
  }

  quickConnect(_query: string): any {
    return null;
  }

  deleteProfile(_profile: any): void {}
}

export class ToolbarButtonProvider {
  provide(): any[] {
    return [];
  }
}

export class HotkeyProvider {
  provide(): any[] {
    return [];
  }
}

export class ConfigProvider {
  platformDefaults = {};
  defaults = {};
}

export interface Profile {
  id: string;
  type: string;
  name: string;
  group?: string;
  icon?: string;
  color?: string;
  isBuiltin?: boolean;
  isTemplate?: boolean;
  options?: Record<string, any>;
}

export type PartialProfile<T extends Profile> = Partial<T> & {
  type: string;
  name: string;
};

export interface NewTabParameters<T> {
  type: string;
  inputs?: T;
}

export interface ToolbarButton {
  icon: string;
  title: string;
  weight?: number;
  click?: () => void | Promise<void>;
}

export interface HotkeyDescription {
  id: string;
  name: string;
}

export interface SelectorOption<T> {
  name: string;
  description?: string;
  icon?: string;
  isGroup?: boolean;
  callback?: () => T | Promise<T>;
}

export const TabbyCoreModule = {
  ngModule: class {},
};

export class SplitTabComponent {}
