/**
 * Tabby Warpgate Plugin
 *
 * A comprehensive Warpgate SSH gateway integration for Tabby terminal.
 * Provides one-click SSH connections to hosts through Warpgate.
 *
 * Features:
 * - Multiple Warpgate server support
 * - Automatic authentication with one-time tickets, password and OTP fallback
 * - One-click SSH connections to any Warpgate target, several hosts at once
 * - Per-host aliases, tags, notes, colors and SSH options
 * - Snippet library and startup snippets
 * - Connection history and global quick connect
 * - Toolbar quick access button and full settings UI
 *
 * @module tabby-warpgate
 */

import { NgModule, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbModalModule } from '@ng-bootstrap/ng-bootstrap';
import TabbyCoreModule, {
  ConfigProvider,
  ToolbarButtonProvider,
  HotkeyProvider,
  ProfileProvider,
  TabRecoveryProvider,
} from 'tabby-core';
import TabbySettingsModule, { SettingsTabProvider } from 'tabby-settings';

// Services
import { WarpgateService } from './services/warpgate.service';
import { WarpgateProfileProvider } from './services/warpgate-profile.service';
import { WarpgateHostSettingsService } from './services/host-settings.service';
import { WarpgateHistoryService } from './services/history.service';
import { WarpgateSnippetsService } from './services/snippets.service';
import { WarpgateConnectionService } from './services/connection.service';

// Components
import { WarpgateSettingsComponent } from './components/warpgate-settings.component';
import { WarpgateHostsComponent } from './components/warpgate-hosts.component';
import { WarpgateHostsTabComponent } from './components/warpgate-hosts-tab.component';
import { WarpgateHostEditorComponent } from './components/warpgate-host-editor.component';
import { WarpgateSnippetsComponent } from './components/warpgate-snippets.component';
import { WarpgateHistoryComponent } from './components/warpgate-history.component';
import {
  WarpgateToolbarButtonProvider,
  WarpgateDockComponent,
} from './components/warpgate-toolbar.component';
import { WarpgateOtpModalComponent } from './components/warpgate-otp-modal.component';

// Providers
import { WarpgateConfigProvider } from './providers/config.provider';
import { WarpgateSettingsTabProvider } from './providers/settings-tab.provider';
import { WarpgateHotkeyProvider, WarpgateHotkeyHandler } from './providers/hotkey.provider';
import { WarpgateTabRecoveryProvider } from './providers/tab-recovery.provider';
import { WarpgateKeyboardInteractiveHandler } from './providers/warpgate-keyboard-interactive.provider';
import { WarpgateSshHandler } from './providers/warpgate-ssh-handler.provider';
import { createLogger } from './utils/debug-logger';

const log = createLogger('Plugin');

/**
 * Warpgate Plugin Module
 *
 * Main Angular module that registers all plugin components and services.
 */
@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    NgbModalModule,
    TabbyCoreModule,
    TabbySettingsModule,
  ],
  declarations: [
    WarpgateSettingsComponent,
    WarpgateHostsComponent,
    WarpgateHostsTabComponent,
    WarpgateHostEditorComponent,
    WarpgateSnippetsComponent,
    WarpgateHistoryComponent,
    WarpgateDockComponent,
    WarpgateOtpModalComponent,
  ],
  providers: [
    // Core services
    WarpgateService,
    WarpgateProfileProvider,
    WarpgateHostSettingsService,
    WarpgateHistoryService,
    WarpgateSnippetsService,
    WarpgateConnectionService,
    WarpgateKeyboardInteractiveHandler,
    WarpgateSshHandler,
    WarpgateHotkeyHandler,

    // Configuration provider
    { provide: ConfigProvider, useClass: WarpgateConfigProvider, multi: true },

    // Settings tab provider
    { provide: SettingsTabProvider, useClass: WarpgateSettingsTabProvider, multi: true },

    // Toolbar button provider
    { provide: ToolbarButtonProvider, useClass: WarpgateToolbarButtonProvider, multi: true },

    // Hotkey provider
    { provide: HotkeyProvider, useClass: WarpgateHotkeyProvider, multi: true },

    // Restores the hosts tab after a restart
    { provide: TabRecoveryProvider, useClass: WarpgateTabRecoveryProvider, multi: true },

    // Profile providers
    { provide: ProfileProvider, useExisting: WarpgateProfileProvider, multi: true },
  ],
  exports: [
    WarpgateHostsComponent,
    WarpgateDockComponent,
  ],
})
export default class WarpgateModule {
  constructor(
    @Inject(WarpgateService) _warpgateService: WarpgateService,
    @Inject(WarpgateSshHandler) _sshHandler: WarpgateSshHandler,
    @Inject(WarpgateHotkeyHandler) hotkeyHandler: WarpgateHotkeyHandler
  ) {
    // Services are initialized via constructor injection
    hotkeyHandler.start();
    log.debug('Tabby Warpgate plugin loaded');
  }
}

// Export public API
export * from './models/warpgate.models';
export * from './api/warpgate.api';
export * from './services/warpgate.service';
export * from './services/warpgate-profile.service';
export * from './services/host-settings.service';
export * from './services/history.service';
export * from './services/snippets.service';
export * from './services/connection.service';
export * from './providers/warpgate-keyboard-interactive.provider';
export * from './utils/totp';
export * from './utils/profile-id';
