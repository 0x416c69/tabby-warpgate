/**
 * Warpgate Toolbar Button Provider
 * Adds a toolbar button to quickly access Warpgate hosts
 */

import { Injectable, Inject, Component } from '@angular/core';
import {
  ToolbarButtonProvider,
  ToolbarButton,
  SplitTabComponent,
  AppService,
  SelectorOption,
  SelectorService,
  NotificationsService,
  ProfilesService,
} from 'tabby-core';

import { WarpgateService } from '../services/warpgate.service';
import { WarpgateProfileProvider } from '../services/warpgate-profile.service';
import { WarpgateTarget, WarpgateServerConfig } from '../models/warpgate.models';

/**
 * Selector option for Warpgate hosts
 */
interface WarpgateHostOption extends SelectorOption<void> {
  server: WarpgateServerConfig;
  target: WarpgateTarget;
  type: 'ssh' | 'sftp';
}

/**
 * Toolbar Button Provider for Warpgate
 */
@Injectable()
export class WarpgateToolbarButtonProvider extends ToolbarButtonProvider {
  constructor(
    @Inject(WarpgateService) private warpgateService: WarpgateService,
    @Inject(WarpgateProfileProvider) private profileProvider: WarpgateProfileProvider,
    @Inject(AppService) private app: AppService,
    @Inject(SelectorService) private selector: SelectorService,
    @Inject(NotificationsService) private notifications: NotificationsService,
    @Inject(ProfilesService) private profiles: ProfilesService
  ) {
    super();
  }

  provide(): ToolbarButton[] {
    return [
      {
        icon: 'fas fa-door-open',
        title: 'Warpgate Hosts',
        weight: 5,
        click: async () => {
          await this.showHostSelector();
        },
      },
    ];
  }

  /**
   * Show host selector modal
   */
  private async showHostSelector(): Promise<void> {
    const allTargets = this.warpgateService.getAllTargets();

    if (allTargets.length === 0) {
      this.notifications.notice(
        'No Warpgate hosts available. Configure servers in Settings > Warpgate.'
      );
      return;
    }

    const options: WarpgateHostOption[] = [];

    for (const { server, target } of allTargets) {
      // Add SSH option
      options.push({
        name: target.name,
        description: `SSH via ${server.name}${target.description ? ` - ${target.description}` : ''}`,
        icon: 'fas fa-terminal',
        server,
        target,
        type: 'ssh',
        callback: () => this.connectSsh(server, target),
      });

      // Add SFTP option
      options.push({
        name: `${target.name} (SFTP)`,
        description: `SFTP via ${server.name}`,
        icon: 'fas fa-folder',
        server,
        target,
        type: 'sftp',
        callback: () => this.connectSftp(server, target),
      });
    }

    // Group by server
    const groupedOptions = this.groupOptionsByServer(options);

    await this.selector.show(
      'Connect to Warpgate Host',
      groupedOptions,
      {
        routedInputEnabled: true,
      }
    );
  }

  /**
   * Group options by server
   */
  private groupOptionsByServer(options: WarpgateHostOption[]): SelectorOption<void>[] {
    const serverGroups = new Map<string, WarpgateHostOption[]>();

    for (const option of options) {
      const serverId = option.server.id;
      if (!serverGroups.has(serverId)) {
        serverGroups.set(serverId, []);
      }
      serverGroups.get(serverId)!.push(option);
    }

    const result: SelectorOption<void>[] = [];

    for (const [, serverOptions] of serverGroups) {
      if (serverOptions.length > 0) {
        // Add server header
        result.push({
          name: serverOptions[0].server.name,
          isGroup: true,
        });

        // Add options for this server
        result.push(...serverOptions);
      }
    }

    return result;
  }

  /**
   * Connect to SSH
   */
  private async connectSsh(server: WarpgateServerConfig, target: WarpgateTarget): Promise<void> {
    try {
      const profile = this.profileProvider.createProfileFromTarget(server, target);
      await this.profiles.openNewTabForProfile(profile);
    } catch (error) {
      this.notifications.error(
        `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Connect to SFTP
   */
  private async connectSftp(server: WarpgateServerConfig, target: WarpgateTarget): Promise<void> {
    try {
      const connectionDetails = this.warpgateService.getSshConnectionDetails(
        server.id,
        target.name
      );

      if (!connectionDetails) {
        throw new Error('Cannot get connection details');
      }

      const sftpProfile = {
        id: `warpgate-sftp:${server.id}:${target.name}`,
        type: 'ssh',
        name: `${target.name} (SFTP)`,
        options: {
          host: connectionDetails.host,
          port: connectionDetails.port,
          user: connectionDetails.username,
          auth: 'password',
          password: server.password,
        },
      };

      await this.profiles.openNewTabForProfile(sftpProfile as any);
    } catch (error) {
      this.notifications.error(
        `Failed to open SFTP: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

/**
 * Warpgate Dock Component
 * A dockable panel showing Warpgate hosts
 */
@Component({
  selector: 'warpgate-dock',
  template: `
    <div class="warpgate-dock">
      <warpgate-hosts></warpgate-hosts>
    </div>
  `,
  styles: [`
    .warpgate-dock {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
  `],
})
export class WarpgateDockComponent {}
