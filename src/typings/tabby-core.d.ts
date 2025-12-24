/**
 * Type declarations for tabby-core
 * These are stub declarations for building the plugin without the actual Tabby packages
 */

declare module 'tabby-core' {
  import { NgModule, Type } from '@angular/core';
  import { Observable } from 'rxjs';

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

  export interface ConnectableProfile extends Profile {
    clearServiceMessagesOnConnect?: boolean;
  }

  export type PartialProfile<T extends Profile> = Partial<T> & {
    type: string;
    name: string;
  };

  export interface NewTabParameters<T = any> {
    type: string | TabComponentType<any>;
    inputs?: T;
  }

  export interface TabComponentType<T extends BaseTabComponent> {
    new (...args: any[]): T;
  }

  export abstract class ProfileProvider<P extends Profile = Profile> {
    id: string;
    name: string;
    supportsQuickConnect: boolean;
    settingsComponent: Type<any> | null;

    abstract getBuiltinProfiles(): Promise<P[]>;
    getSuggestedName(profile: PartialProfile<P>): string | null;
    getDescription(profile: PartialProfile<P>): string;
    getNewTabParameters(profile: P): Promise<NewTabParameters<any>>;
    quickConnect(query: string): PartialProfile<P> | null;
    deleteProfile(profile: P): void;
  }

  export abstract class ConnectableProfileProvider<P extends ConnectableProfile> extends ProfileProvider<P> {}

  export abstract class QuickConnectProfileProvider<P extends ConnectableProfile> extends ConnectableProfileProvider<P> {
    quickConnect(query: string): PartialProfile<P> | null;
    intoQuickConnectString(profile: P): string | null;
  }

  export abstract class ConfigProvider {
    platformDefaults: any;
    defaults: any;
  }

  export abstract class ToolbarButtonProvider {
    abstract provide(): ToolbarButton[];
  }

  export abstract class HotkeyProvider {
    abstract provide(): HotkeyDescription[];
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

  export interface SelectorOption<T = void> {
    name: string;
    description?: string;
    icon?: string;
    isGroup?: boolean;
    callback?: () => T | Promise<T>;
  }

  export class ConfigService {
    store: any;
    save(): void;
    requestRestart(): void;
  }

  export class NotificationsService {
    info(message: string): void;
    notice(message: string): void;
    error(message: string): void;
  }

  export class PlatformService {
    getOS(): string;
    getAppVersion(): string;
  }

  export class AppService {
    openNewTab<T extends BaseTabComponent>(params: NewTabParameters<T>): T;
    openNewTabRaw<T extends BaseTabComponent>(params: NewTabParameters<T>): T;
    selectTab(tab: BaseTabComponent | null): void;
    tabs: BaseTabComponent[];
    activeTab: BaseTabComponent | null;
    tabOpened$: import('rxjs').Observable<any>;
    tabClosed$: import('rxjs').Observable<any>;
  }

  export class TabsService {
    create<T extends BaseTabComponent>(params: NewTabParameters<T>): T;
  }

  export abstract class BaseTabComponent {
    title: string;
    icon: string | null;
    hasFocus: boolean;
    customTitle: string;
    hostView: any;
    destroyed$: import('rxjs').Observable<void>;

    constructor(injector: import('@angular/core').Injector);

    setTitle(title: string): void;
    destroy(): void;
    getRecoveryToken(): Promise<any>;
  }

  export class ProfilesService {
    openNewTabForProfile(profile: Profile): Promise<void>;
    getProfiles(): Profile[];
  }

  export class SelectorService {
    show<T>(title: string, options: SelectorOption<T>[], config?: any): Promise<T>;
  }

  export class SplitTabComponent {}

  // The module is exported as default, not as a named export
  const TabbyCoreModule: any;
  export default TabbyCoreModule;
}
