/**
 * Warpgate Hotkey Provider
 * Provides keyboard shortcuts for Warpgate functionality
 */

import { Injectable, Inject } from '@angular/core';
import { AppService, HotkeyProvider, HotkeyDescription, HotkeysService } from 'tabby-core';

import { WarpgateService } from '../services/warpgate.service';
import { WarpgateConnectionService } from '../services/connection.service';
import { WarpgateSnippetsService } from '../services/snippets.service';
import { openWarpgateHostsTab } from '../components/warpgate-hosts-tab.component';

/**
 * Hotkey provider for Warpgate plugin
 * Default key bindings are defined in WarpgateConfigProvider
 */
@Injectable()
export class WarpgateHotkeyProvider extends HotkeyProvider {
  hotkeys: HotkeyDescription[] = [
    {
      id: 'warpgate-quick-connect',
      name: 'Warpgate: Quick connect to a host',
    },
    {
      id: 'warpgate-show-hosts',
      name: 'Warpgate: Show hosts',
    },
    {
      id: 'warpgate-run-snippet',
      name: 'Warpgate: Run a snippet in the current terminal',
    },
    {
      id: 'warpgate-refresh',
      name: 'Warpgate: Refresh hosts',
    },
  ];

  async provide(): Promise<HotkeyDescription[]> {
    return this.hotkeys;
  }
}

/**
 * Runs the actions bound to the Warpgate hotkeys
 */
@Injectable({ providedIn: 'root' })
export class WarpgateHotkeyHandler {
  private started = false;

  constructor(
    @Inject(HotkeysService) private hotkeys: HotkeysService,
    @Inject(AppService) private app: AppService,
    @Inject(WarpgateService) private warpgate: WarpgateService,
    @Inject(WarpgateConnectionService) private connection: WarpgateConnectionService,
    @Inject(WarpgateSnippetsService) private snippets: WarpgateSnippetsService
  ) {}

  /**
   * Start listening for hotkeys
   */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    this.hotkeys.hotkey$.subscribe(hotkey => {
      this.handle(hotkey);
    });
  }

  /**
   * Run the action of a hotkey
   */
  handle(hotkey: string): void {
    switch (hotkey) {
      case 'warpgate-quick-connect':
        this.connection.showQuickConnect();
        break;
      case 'warpgate-show-hosts':
        openWarpgateHostsTab(this.app);
        break;
      case 'warpgate-run-snippet':
        this.snippets.showRunSnippetPicker();
        break;
      case 'warpgate-refresh':
        this.warpgate.refreshAllTargets();
        break;
    }
  }
}
