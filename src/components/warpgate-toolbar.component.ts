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
import { WarpgateSshHandler } from '../providers/warpgate-ssh-handler.provider';
import { createLogger } from '../utils/debug-logger';

const log = createLogger('Toolbar');

/**
 * Selector option for Warpgate hosts
 */
interface WarpgateHostOption extends SelectorOption<void> {
  server: WarpgateServerConfig;
  target: WarpgateTarget;
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
    @Inject(ProfilesService) private profiles: ProfilesService,
    @Inject(WarpgateSshHandler) private sshHandler: WarpgateSshHandler
  ) {
    super();
  }

  provide(): ToolbarButton[] {
    return [
      {
        // SVG icon for Warpgate (globe/network icon)
        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 496 512"><path fill="currentColor" d="M336.5 160C322 70.7 287.8 8 248 8s-74 62.7-88.5 152h177zM152 256c0 22.2 1.2 43.5 3.3 64h185.3c2.1-20.5 3.3-41.8 3.3-64s-1.2-43.5-3.3-64H155.3c-2.1 20.5-3.3 41.8-3.3 64zm324.7-96c-28.6-67.9-86.5-120.4-158-141.6 24.4 33.8 41.2 84.7 50 141.6h108zM177.2 18.4C105.8 39.6 47.8 92.1 19.3 160h108c8.7-56.9 25.5-107.8 49.9-141.6zM487.4 192H372.7c2.1 21 3.3 42.5 3.3 64s-1.2 43-3.3 64h114.6c5.5-20.5 8.6-41.8 8.6-64s-3.1-43.5-8.5-64zM120 256c0-21.5 1.2-43 3.3-64H8.6C3.2 212.5 0 233.8 0 256s3.2 43.5 8.6 64h114.6c-2-21-3.2-42.5-3.2-64zm39.5 96c14.5 89.3 48.7 152 88.5 152s74-62.7 88.5-152h-177zm159.3 141.6c71.4-21.2 129.4-73.7 158-141.6h-108c-8.8 56.9-25.6 107.8-50 141.6zM19.3 352c28.6 67.9 86.5 120.4 158 141.6-24.4-33.8-41.2-84.7-50-141.6h-108z"/></svg>',
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
        callback: () => this.connectSsh(server, target),
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
   * Uses createOneClickProfile to ensure tickets are created when available
   */
  private async connectSsh(server: WarpgateServerConfig, target: WarpgateTarget): Promise<void> {
    try {
      // Use createOneClickProfile which creates tickets for TOTP-enabled servers
      const profile = await this.profileProvider.createOneClickProfile(server, target);

      // Debug: Check if warpgate metadata is set
      log.debug(' Created profile:', {
        id: profile.id,
        hasWarpgate: Boolean(profile.warpgate),
        warpgate: profile.warpgate,
        auth: profile.options?.auth,
      });

      // Register the full profile so the SSH handler can access metadata
      this.sshHandler.registerWarpgateProfile(profile);

      await this.profiles.openNewTabForProfile(profile);

      // Try to find and attach to the tab immediately (for faster attachment)
      // The tabOpened$ event will also fire, but this gives us a head start
      const tab = this.app.tabs?.find(t => t?.profile?.id === profile.id);
      if (tab) {
        log.debug(' Found tab after opening:', {
          profileId: tab.profile?.id,
          hasWarpgate: Boolean((tab.profile as any)?.warpgate),
          warpgate: (tab.profile as any)?.warpgate,
        });
        log.debug(` Found tab immediately, attaching SSH handler`);
        this.sshHandler.attachToTab(tab);
      }
    } catch (error) {
      this.notifications.error(
        `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`
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
