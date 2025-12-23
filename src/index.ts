/**
 * Tabby Warpgate Plugin
 *
 * A comprehensive Warpgate SSH gateway integration for Tabby terminal.
 * Provides one-click SSH connections to hosts through Warpgate.
 *
 * Features:
 * - Multiple Warpgate server support
 * - Automatic authentication and session management
 * - One-click SSH connections to any Warpgate target
 * - Host grouping and search
 * - Auto-refresh of host lists
 * - Toolbar quick access button
 * - Full settings UI for server configuration
 *
 * @module tabby-warpgate
 */

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbModalModule } from '@ng-bootstrap/ng-bootstrap';
import TabbyCoreModule, {
  ConfigProvider,
  ToolbarButtonProvider,
  HotkeyProvider,
  ProfileProvider,
} from 'tabby-core';
import TabbySettingsModule, { SettingsTabProvider } from 'tabby-settings';

// Services
import { WarpgateService } from './services/warpgate.service';
import { WarpgateProfileProvider } from './services/warpgate-profile.service';

// Components
import { WarpgateSettingsComponent } from './components/warpgate-settings.component';
import { WarpgateHostsComponent } from './components/warpgate-hosts.component';
import {
  WarpgateToolbarButtonProvider,
  WarpgateDockComponent,
} from './components/warpgate-toolbar.component';
import { WarpgateOtpModalComponent } from './components/warpgate-otp-modal.component';

// Providers
import { WarpgateConfigProvider } from './providers/config.provider';
import { WarpgateSettingsTabProvider } from './providers/settings-tab.provider';
import { WarpgateHotkeyProvider } from './providers/hotkey.provider';
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
    WarpgateDockComponent,
    WarpgateOtpModalComponent,
  ],
  providers: [
    // Core services
    WarpgateService,
    WarpgateProfileProvider,
    WarpgateKeyboardInteractiveHandler,
    WarpgateSshHandler,

    // Configuration provider
    { provide: ConfigProvider, useClass: WarpgateConfigProvider, multi: true },

    // Settings tab provider
    { provide: SettingsTabProvider, useClass: WarpgateSettingsTabProvider, multi: true },

    // Toolbar button provider
    { provide: ToolbarButtonProvider, useClass: WarpgateToolbarButtonProvider, multi: true },

    // Hotkey provider
    { provide: HotkeyProvider, useClass: WarpgateHotkeyProvider, multi: true },

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
    private warpgateService: WarpgateService,
    private sshHandler: WarpgateSshHandler
  ) {
    // Services are initialized via constructor injection
    log.debug('Tabby Warpgate plugin loaded');
  }
}

// Export public API
export * from './models/warpgate.models';
export * from './api/warpgate.api';
export * from './services/warpgate.service';
export * from './services/warpgate-profile.service';
export * from './providers/warpgate-keyboard-interactive.provider';
export * from './utils/totp';
