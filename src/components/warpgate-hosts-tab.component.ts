/**
 * Warpgate Hosts Tab Component
 * A tab that shows all Warpgate hosts, snippets and history
 */

import { Component, Injector } from '@angular/core';
import { AppService, BaseTabComponent } from 'tabby-core';

/** Recovery token type of the hosts tab */
export const WARPGATE_HOSTS_RECOVERY_TYPE = 'app:warpgate-hosts';

/**
 * Tab component for displaying Warpgate hosts
 * Opens as a new tab when clicking the toolbar button
 */
@Component({
  selector: 'warpgate-hosts-tab',
  template: `
    <div class="warpgate-hosts-tab">
      <warpgate-hosts></warpgate-hosts>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
    }

    .warpgate-hosts-tab {
      height: 100%;
      width: 100%;
      overflow: hidden;
    }
  `],
})
export class WarpgateHostsTabComponent extends BaseTabComponent {
  static title = 'Warpgate Hosts';
  static icon = 'fas fa-network-wired';

  constructor(injector: Injector) {
    super(injector);
    this.setTitle('Warpgate Hosts');
    this.icon = 'fas fa-network-wired';
  }

  async getRecoveryToken(): Promise<any> {
    return {
      type: WARPGATE_HOSTS_RECOVERY_TYPE,
    };
  }
}

/**
 * Open the Warpgate Hosts tab, or focus it if it is already open
 */
export function openWarpgateHostsTab(app: AppService): void {
  for (const tab of app.tabs) {
    const children: any[] = typeof (tab as any).getAllTabs === 'function' ? (tab as any).getAllTabs() : [tab];
    if (tab instanceof WarpgateHostsTabComponent || children.some(child => child instanceof WarpgateHostsTabComponent)) {
      app.selectTab(tab);
      return;
    }
  }

  app.openNewTab({
    type: WarpgateHostsTabComponent,
  });
}
