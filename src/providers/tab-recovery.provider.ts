/**
 * Warpgate Tab Recovery Provider
 * Restores the Warpgate Hosts tab when Tabby restarts
 */

import { Injectable } from '@angular/core';
import { NewTabParameters, RecoveryToken, TabRecoveryProvider } from 'tabby-core';

import {
  WarpgateHostsTabComponent,
  WARPGATE_HOSTS_RECOVERY_TYPE,
} from '../components/warpgate-hosts-tab.component';

/**
 * Recovers Warpgate Hosts tabs from their recovery token
 */
@Injectable()
export class WarpgateTabRecoveryProvider extends TabRecoveryProvider<WarpgateHostsTabComponent> {
  async applicableTo(recoveryToken: RecoveryToken): Promise<boolean> {
    return recoveryToken.type === WARPGATE_HOSTS_RECOVERY_TYPE;
  }

  async recover(_recoveryToken: RecoveryToken): Promise<NewTabParameters<WarpgateHostsTabComponent>> {
    return { type: WarpgateHostsTabComponent };
  }
}
