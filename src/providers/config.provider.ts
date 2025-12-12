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
  /** Plugin configuration namespace */
  platformDefaults = {};

  /** Default configuration values */
  defaults = {
    warpgate: DEFAULT_WARPGATE_CONFIG,
  };
}
