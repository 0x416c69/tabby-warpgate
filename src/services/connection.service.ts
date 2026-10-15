/**
 * Warpgate Connection Service
 * Opens SSH sessions to Warpgate hosts (single host, several hosts as tabs or as a
 * split layout) and provides the global quick-connect picker
 */

import { Injectable, Inject, Optional } from '@angular/core';
import {
  AppService,
  NotificationsService,
  ProfilesService,
  SelectorOption,
  SelectorService,
  TabsService,
} from 'tabby-core';

import { WarpgateService } from './warpgate.service';
import { WarpgateProfileProvider } from './warpgate-profile.service';
import { WarpgateHostSettingsService } from './host-settings.service';
import { WarpgateHistoryService } from './history.service';
import { WarpgateSshHandler } from '../providers/warpgate-ssh-handler.provider';
import { WarpgateServerConfig, WarpgateTarget, getHostKey } from '../models/warpgate.models';
import { getTargetColor, getTargetIcon } from '../utils/target-appearance';
import { createLogger } from '../utils/debug-logger';

const log = createLogger('Connection');

/** A host to connect to */
export interface WarpgateHostRef {
  server: WarpgateServerConfig;
  target: WarpgateTarget;
}

/** How several hosts are opened */
export type WarpgateMultiOpenLayout = 'tabs' | 'split';

/** Options for opening hosts */
export interface WarpgateOpenOptions {
  /** Commands sent to the shell once connected (in addition to the startup snippet) */
  scripts?: string[];
}

/**
 * Compute where each pane goes in a grid of split panes
 * Returns, for every pane after the first, the index of the pane it is placed next to
 * and the side ('r' = right of it, 'b' = below it)
 */
export function computeSplitGrid(count: number): Array<{ relativeIndex: number; side: 'r' | 'b' }> {
  const columns = Math.ceil(Math.sqrt(count));
  const placements: Array<{ relativeIndex: number; side: 'r' | 'b' }> = [];
  for (let i = 1; i < count; i++) {
    placements.push(i < columns ? { relativeIndex: i - 1, side: 'r' } : { relativeIndex: i - columns, side: 'b' });
  }
  return placements;
}

/**
 * Connection Service
 */
@Injectable({ providedIn: 'root' })
export class WarpgateConnectionService {
  constructor(
    @Inject(WarpgateService) private warpgate: WarpgateService,
    @Inject(WarpgateProfileProvider) private profileProvider: WarpgateProfileProvider,
    @Inject(WarpgateHostSettingsService) private hostSettings: WarpgateHostSettingsService,
    @Inject(WarpgateHistoryService) private history: WarpgateHistoryService,
    @Inject(WarpgateSshHandler) private sshHandler: WarpgateSshHandler,
    @Inject(AppService) private app: AppService,
    @Inject(ProfilesService) private profiles: ProfilesService,
    @Inject(TabsService) private tabs: TabsService,
    @Optional() @Inject(SelectorService) private selector: SelectorService | null,
    @Optional() @Inject(NotificationsService) private notifications: NotificationsService | null
  ) {}

  /**
   * Open an SSH session to a host in a new tab
   * @returns the new terminal tab, or null if the connection could not be started
   */
  async openHost(server: WarpgateServerConfig, target: WarpgateTarget, options: WarpgateOpenOptions = {}): Promise<any | null> {
    try {
      const profile = await this.profileProvider.createOneClickProfile(server, target);
      this.sshHandler.registerWarpgateProfile(profile);
      const tab = await this.profiles.openNewTabForProfile(profile);
      if (tab && options.scripts?.length) {
        this.sshHandler.queueScripts(tab, options.scripts);
      }
      return tab;
    } catch (error) {
      this.reportError(server, target, error);
      return null;
    }
  }

  /**
   * Open sessions to several hosts at once
   * @param layout 'tabs' opens one tab per host, 'split' puts all hosts in a grid of panes in one tab
   * @returns number of sessions opened
   */
  async openHosts(
    hosts: WarpgateHostRef[],
    layout: WarpgateMultiOpenLayout = 'tabs',
    options: WarpgateOpenOptions = {}
  ): Promise<number> {
    if (hosts.length === 0) {
      return 0;
    }

    if (layout === 'tabs' || hosts.length === 1) {
      let opened = 0;
      for (const host of hosts) {
        if (await this.openHost(host.server, host.target, options)) {
          opened++;
        }
      }
      return opened;
    }

    return this.openHostsInSplit(hosts, options);
  }

  /**
   * Open several hosts as panes of one split tab
   */
  private async openHostsInSplit(hosts: WarpgateHostRef[], options: WarpgateOpenOptions): Promise<number> {
    const panes: any[] = [];
    let parent: any = null;
    let index = 0;

    // The first host that connects creates the split tab
    while (index < hosts.length && !parent) {
      const first = await this.openHost(hosts[index].server, hosts[index].target, options);
      index++;
      if (first) {
        panes.push(first);
        parent = this.app.getParentTab(first);
      }
    }

    if (!parent) {
      return panes.length;
    }

    const placements = computeSplitGrid(hosts.length - index + 1);
    for (let i = 0; index < hosts.length; index++, i++) {
      const { server, target } = hosts[index];
      try {
        const profile = await this.profileProvider.createOneClickProfile(server, target);
        this.sshHandler.registerWarpgateProfile(profile);
        const params = await this.profiles.newTabParametersForProfile(profile);
        if (!params) {
          continue;
        }

        const pane: any = this.tabs.create(params);
        this.sshHandler.attachToTab(pane);
        if (options.scripts?.length) {
          this.sshHandler.queueScripts(pane, options.scripts);
        }

        const placement = placements[Math.min(i, placements.length - 1)];
        const relative = panes[Math.min(placement.relativeIndex, panes.length - 1)] ?? null;
        await parent.addTab(pane, relative, placement.side);
        panes.push(pane);
      } catch (error) {
        this.reportError(server, target, error);
      }
    }

    this.app.selectTab(parent);
    return panes.length;
  }

  /**
   * Show Tabby's selector with all Warpgate hosts (pinned and recent hosts first)
   */
  async showQuickConnect(): Promise<void> {
    if (!this.selector || this.selector.active) {
      return;
    }

    const enabledServers = this.warpgate.getServers().filter(server => server.enabled);
    if (enabledServers.length === 0) {
      this.notifications?.notice('Add a Warpgate server in Settings → Warpgate first');
      return;
    }

    await Promise.all(enabledServers.map(server => this.warpgate.ensureConnected(server.id)));

    const hosts = this.warpgate.getAllTargets();
    if (hosts.length === 0) {
      this.notifications?.notice('No Warpgate hosts available');
      return;
    }

    try {
      await this.selector.show('Connect to a Warpgate host', this.buildQuickConnectOptions(hosts));
    } catch {
      // Selector was dismissed
    }
  }

  /**
   * Build selector options for the quick-connect picker
   */
  buildQuickConnectOptions(hosts: WarpgateHostRef[]): SelectorOption<void>[] {
    const lastConnected = this.history.getLastConnectedMap();
    const recentOrder = Array.from(lastConnected.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);
    const pinned = new Set(this.warpgate.getConfig().pinnedHosts ?? []);

    return hosts.map(({ server, target }) => {
      const key = getHostKey(server.id, target.name);
      const settings = this.hostSettings.getSettings(server.id, target.name);
      const recentIndex = recentOrder.indexOf(key);

      let group = target.group?.name ? `${server.name} / ${target.group.name}` : server.name;
      let weight = 0;
      if (pinned.has(key)) {
        group = 'Pinned';
        weight = -2000;
      } else if (recentIndex !== -1 && recentIndex < 10) {
        group = 'Recent';
        weight = -1000 + recentIndex;
      }

      const description = [
        settings.alias ? target.name : '',
        server.name,
        target.description,
        ...(settings.tags ?? []).map(tag => `#${tag}`),
      ].filter(Boolean).join(' · ');

      return {
        name: settings.alias || target.name,
        description,
        group,
        icon: getTargetIcon(target),
        color: settings.color || getTargetColor(target),
        weight,
        callback: () => {
          this.openHost(server, target);
        },
      };
    });
  }

  /**
   * Show a connection error
   */
  private reportError(server: WarpgateServerConfig, target: WarpgateTarget, error: unknown): void {
    const name = this.hostSettings.getDisplayName(server.id, target);
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error(`Failed to connect to ${name}:`, message);
    this.notifications?.error(`Failed to connect to ${name}: ${message}`);
  }
}
