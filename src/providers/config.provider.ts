/**
 * Warpgate Config Provider
 * Provides configuration schema for the plugin
 */

import { Injectable } from '@angular/core';
import { ConfigProvider } from 'tabby-core';
import { DEFAULT_WARPGATE_CONFIG } from '../models/warpgate.models';

/**
 * Configuration provider for Warpgate plugin
 */
@Injectable()
export class WarpgateConfigProvider extends ConfigProvider {
  /** Default configuration values */
  defaults = {
    warpgate: DEFAULT_WARPGATE_CONFIG,
    hotkeys: {
      'warpgate-show-hosts': ['Ctrl-Shift-H'],
      'warpgate-quick-connect': ['Ctrl-Shift-K'],
      'warpgate-run-snippet': ['Ctrl-Shift-J'],
      'warpgate-refresh': [],
    },
  };

  /** Platform specific defaults */
  platformDefaults = {
    macOS: {
      hotkeys: {
        'warpgate-show-hosts': ['⌘-Shift-H'],
        'warpgate-quick-connect': ['⌘-Shift-K'],
        'warpgate-run-snippet': ['⌘-Shift-J'],
      },
    },
  };
}
