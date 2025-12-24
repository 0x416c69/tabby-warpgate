/**
 * Warpgate Hosts Tab Component
 * A tab that shows all Warpgate hosts with the nice UI
 */

import { Component, Injector } from '@angular/core';
import { BaseTabComponent } from 'tabby-core';

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
      overflow: auto;
      background: var(--bs-body-bg, #1e1e1e);
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

  ngOnInit(): void {
    // Tab initialized
  }

  async getRecoveryToken(): Promise<any> {
    return {
      type: 'app:warpgate-hosts',
    };
  }
}
