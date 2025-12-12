/**
 * Warpgate Settings Tab Provider
 * Provides a settings tab for configuring Warpgate servers
 */

import { Injectable } from '@angular/core';
import { SettingsTabProvider } from 'tabby-settings';
import { WarpgateSettingsComponent } from '../components/warpgate-settings.component';

/**
 * Settings tab provider for Warpgate plugin
 */
@Injectable()
export class WarpgateSettingsTabProvider extends SettingsTabProvider {
  id = 'warpgate';
  title = 'Warpgate';
  icon = 'fas fa-door-open';
  component = WarpgateSettingsComponent;

  /** Priority for ordering in settings tabs */
  weight = 20;
}
