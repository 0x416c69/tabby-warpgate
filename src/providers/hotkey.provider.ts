/**
 * Warpgate Hotkey Provider
 * Provides keyboard shortcuts for Warpgate functionality
 */

import { Injectable } from '@angular/core';
import { HotkeyProvider, HotkeyDescription } from 'tabby-core';

/**
 * Hotkey provider for Warpgate plugin
 */
@Injectable()
export class WarpgateHotkeyProvider extends HotkeyProvider {
  hotkeys: HotkeyDescription[] = [
    {
      id: 'warpgate-show-hosts',
      name: 'Show Warpgate Hosts',
    },
    {
      id: 'warpgate-refresh',
      name: 'Refresh Warpgate Hosts',
    },
  ];

  provide(): HotkeyDescription[] {
    return this.hotkeys;
  }
}
