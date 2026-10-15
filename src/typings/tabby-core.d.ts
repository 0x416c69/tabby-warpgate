/**
 * Type declarations for tabby-core
 * These are stub declarations for building the plugin without the actual Tabby packages
 */

declare module 'tabby-core' {
  import { Type } from '@angular/core';
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface NewTabParameters<T = any> {
    type: TabComponentType<any>;
    inputs?: Record<string, any>;
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
    abstract provide(): Promise<HotkeyDescription[]>;
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
    group?: string;
    result?: T;
    icon?: string;
    color?: string;
    weight?: number;
    freeInputPattern?: string;
    callback?: (query?: string) => void;
  }

  export interface RecoveryToken {
    [key: string]: any;
    type: string;
  }

  export abstract class TabRecoveryProvider<T extends BaseTabComponent = BaseTabComponent> {
    abstract applicableTo(recoveryToken: RecoveryToken): Promise<boolean>;
    abstract recover(recoveryToken: RecoveryToken): Promise<NewTabParameters<T>>;
  }

  export class ConfigService {
    store: any;
    /** Fires once when the config is loaded */
    readonly ready$: Observable<boolean>;
    readonly changed$: Observable<void>;
    save(): void;
    requestRestart(): void;
  }

  export class NotificationsService {
    info(message: string, details?: string): void;
    notice(message: string): void;
    error(message: string, details?: string): void;
  }

  export class PlatformService {
    getOS(): string;
    getAppVersion(): string;
    readClipboard(): string;
    setClipboard(content: { text: string }): void;
  }

  export class HotkeysService {
    /** Fired for each recognized hotkey */
    readonly hotkey$: Observable<string>;
  }

  export class AppService {
    openNewTab<T extends BaseTabComponent>(params: NewTabParameters<T>): T;
    openNewTabRaw<T extends BaseTabComponent>(params: NewTabParameters<T>): T;
    selectTab(tab: BaseTabComponent | null): void;
    getParentTab(tab: BaseTabComponent): SplitTabComponent | null;
    tabs: BaseTabComponent[];
    activeTab: BaseTabComponent | null;
    readonly tabOpened$: Observable<BaseTabComponent>;
    readonly tabClosed$: Observable<BaseTabComponent>;
    readonly tabsChanged$: Observable<void>;
  }

  export class TabsService {
    create<T extends BaseTabComponent>(params: NewTabParameters<T>): T;
  }

  export abstract class BaseTabComponent {
    title: string;
    icon: string | null;
    color: string | null;
    hasFocus: boolean;
    customTitle: string;
    hostView: any;
    parent: BaseTabComponent | null;
    readonly destroyed$: Observable<void>;

    constructor(injector: import('@angular/core').Injector);

    setTitle(title: string): void;
    destroy(): void;
    getRecoveryToken(): Promise<any>;
  }

  export class SplitTabComponent extends BaseTabComponent {
    readonly tabAdded$: Observable<BaseTabComponent>;
    getAllTabs(): BaseTabComponent[];
    getFocusedTab(): BaseTabComponent | null;
    addTab(tab: BaseTabComponent, relative: BaseTabComponent | null, side: 'l' | 'r' | 't' | 'b'): Promise<void>;
  }

  export class ProfilesService {
    openNewTabForProfile(profile: PartialProfile<Profile>): Promise<BaseTabComponent | null>;
    newTabParametersForProfile(profile: PartialProfile<Profile>): Promise<NewTabParameters<BaseTabComponent> | null>;
    getConfigProxyForProfile<T extends Profile>(profile: PartialProfile<T>): T;
    getProviders(): ProfileProvider<Profile>[];
    getProfiles(): Promise<PartialProfile<Profile>[]>;
  }

  export class SelectorService {
    readonly active: boolean;
    show<T>(name: string, options: SelectorOption<T>[]): Promise<T>;
  }

  // The module is exported as default, not as a named export
  const TabbyCoreModule: any;
  export default TabbyCoreModule;
}
