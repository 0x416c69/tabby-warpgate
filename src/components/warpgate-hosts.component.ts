/**
 * Warpgate Hosts Component
 * Displays a list of available SSH hosts from all connected Warpgate servers
 * Provides one-click SSH and SFTP connections
 */

import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppService, ProfilesService, NotificationsService } from 'tabby-core';

import { WarpgateService } from '../services/warpgate.service';
import { WarpgateProfileProvider, WarpgateSFTPProfileProvider } from '../services/warpgate-profile.service';
import {
  WarpgateTarget,
  WarpgateServerConfig,
  WarpgateConnectionStatus,
  WarpgatePluginConfig,
} from '../models/warpgate.models';
import { getBootstrapColor } from '../models/theme.constants';
import { createLogger } from '../utils/debug-logger';

const log = createLogger('HostsComponent');

/** Host item for display */
interface HostItem {
  server: WarpgateServerConfig;
  target: WarpgateTarget;
  isConnecting: boolean;
}

/** Group of hosts */
interface HostGroup {
  name: string;
  color?: string;
  hosts: HostItem[];
  expanded: boolean;
}

@Component({
  selector: 'warpgate-hosts',
  template: `
    <div class="warpgate-hosts">
      <!-- Header -->
      <div class="hosts-header">
        <div class="header-title">
          <i class="fas fa-server"></i>
          <span>Warpgate Hosts</span>
          <span class="badge bg-secondary ms-2" *ngIf="totalHosts > 0">
            {{ totalHosts }}
          </span>
        </div>
        <div class="header-actions">
          <input
            type="text"
            class="form-control form-control-sm search-input"
            placeholder="Search hosts..."
            [(ngModel)]="searchQuery"
            (ngModelChange)="filterHosts()"
          />
          <button
            class="btn btn-sm btn-outline-primary ms-2"
            (click)="refresh()"
            [disabled]="isLoading"
            title="Refresh all hosts"
          >
            <i class="fas fa-sync" [class.fa-spin]="isLoading"></i>
          </button>
        </div>
      </div>

      <!-- Connection Status Banner -->
      <div
        class="connection-banner alert alert-warning mb-2"
        *ngIf="disconnectedServers.length > 0"
      >
        <i class="fas fa-exclamation-triangle"></i>
        {{ disconnectedServers.length }} server(s) disconnected.
        <a href="javascript:void(0)" (click)="reconnectAll()">Reconnect</a>
      </div>

      <!-- Loading Indicator -->
      <div class="loading-indicator text-center py-4" *ngIf="isLoading && groups.length === 0">
        <i class="fas fa-spinner fa-spin fa-2x mb-2"></i>
        <p>Loading hosts...</p>
      </div>

      <!-- No Servers -->
      <div class="no-servers text-center py-4" *ngIf="!hasServers">
        <i class="fas fa-server fa-2x mb-2 text-muted"></i>
        <p class="text-muted">No Warpgate servers configured.</p>
        <p class="text-muted small">
          Go to Settings > Warpgate to add a server.
        </p>
      </div>

      <!-- No Results -->
      <div
        class="no-results text-center py-4"
        *ngIf="hasServers && groups.length === 0 && !isLoading"
      >
        <i class="fas fa-search fa-2x mb-2 text-muted"></i>
        <p class="text-muted" *ngIf="searchQuery">
          No hosts found matching "{{ searchQuery }}"
        </p>
        <p class="text-muted" *ngIf="!searchQuery">
          No hosts available. Try refreshing or check your server connections.
        </p>
      </div>

      <!-- Host Groups -->
      <div class="host-groups" *ngIf="groups.length > 0">
        <div class="host-group" *ngFor="let group of groups">
          <!-- Group Header -->
          <div
            class="group-header"
            (click)="toggleGroup(group)"
            [style.borderLeftColor]="group.color || 'var(--bs-primary)'"
          >
            <i
              class="fas fa-chevron-right expand-icon"
              [class.expanded]="group.expanded"
            ></i>
            <span class="group-name">{{ group.name }}</span>
            <span class="badge bg-secondary">{{ group.hosts.length }}</span>
          </div>

          <!-- Group Hosts -->
          <div class="group-hosts" *ngIf="group.expanded">
            <div
              class="host-item"
              *ngFor="let host of group.hosts"
              [class.connecting]="host.isConnecting"
            >
              <div class="host-icon">
                <i class="fas fa-server"></i>
              </div>

              <div class="host-info">
                <div class="host-name">{{ host.target.name }}</div>
                <div class="host-description text-muted small" *ngIf="host.target.description">
                  {{ host.target.description }}
                </div>
                <div class="host-server text-muted small">
                  <i class="fas fa-cloud"></i> {{ host.server.name }}
                </div>
              </div>

              <div class="host-actions">
                <button
                  class="btn btn-sm btn-primary"
                  (click)="connectSsh(host)"
                  [disabled]="host.isConnecting"
                  title="Connect SSH"
                >
                  <i class="fas" [class.fa-terminal]="!host.isConnecting" [class.fa-spinner]="host.isConnecting" [class.fa-spin]="host.isConnecting"></i>
                  SSH
                </button>
                <button
                  class="btn btn-sm btn-outline-secondary ms-1"
                  (click)="connectSftp(host); $event.stopPropagation()"
                  [disabled]="host.isConnecting"
                  title="Open SFTP"
                >
                  <i class="fas fa-folder"></i>
                  SFTP
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .warpgate-hosts {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 10px;
    }

    .hosts-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--bs-border-color, #dee2e6);
      margin-bottom: 10px;
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }

    .header-actions {
      display: flex;
      align-items: center;
    }

    .search-input {
      width: 200px;
    }

    .connection-banner {
      padding: 8px 12px;
      font-size: 0.875rem;
    }

    .connection-banner a {
      margin-left: 5px;
    }

    .host-groups {
      flex: 1;
      overflow-y: auto;
    }

    .host-group {
      margin-bottom: 8px;
    }

    .group-header {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      background: var(--bs-tertiary-bg, #f8f9fa);
      border-radius: 4px;
      cursor: pointer;
      border-left: 3px solid var(--bs-primary);
      user-select: none;
    }

    .group-header:hover {
      background: var(--bs-secondary-bg, #e9ecef);
    }

    .expand-icon {
      margin-right: 8px;
      transition: transform 0.2s;
      font-size: 0.75rem;
    }

    .expand-icon.expanded {
      transform: rotate(90deg);
    }

    .group-name {
      flex: 1;
      font-weight: 500;
    }

    .group-hosts {
      padding-left: 12px;
      border-left: 1px solid var(--bs-border-color, #dee2e6);
      margin-left: 6px;
      margin-top: 4px;
    }

    .host-item {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.15s;
    }

    .host-item:hover {
      background: var(--bs-tertiary-bg, #f8f9fa);
    }

    .host-item.connecting {
      opacity: 0.7;
      pointer-events: none;
    }

    .host-icon {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bs-primary);
      color: white;
      border-radius: 6px;
      margin-right: 12px;
    }

    .host-info {
      flex: 1;
      min-width: 0;
    }

    .host-name {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .host-description,
    .host-server {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .host-actions {
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .host-item:hover .host-actions {
      opacity: 1;
    }

    .host-actions .btn {
      white-space: nowrap;
    }

    /* Scrollbar styling */
    .host-groups::-webkit-scrollbar {
      width: 6px;
    }

    .host-groups::-webkit-scrollbar-track {
      background: transparent;
    }

    .host-groups::-webkit-scrollbar-thumb {
      background: var(--bs-secondary);
      border-radius: 3px;
    }
  `],
})
export class WarpgateHostsComponent implements OnInit, OnDestroy {
  groups: HostGroup[] = [];
  searchQuery = '';
  isLoading = false;
  totalHosts = 0;
  hasServers = false;
  disconnectedServers: WarpgateServerConfig[] = [];

  private allHosts: HostItem[] = [];
  private config: WarpgatePluginConfig;
  private subscriptions: Subscription[] = [];

  constructor(
    @Inject(WarpgateService) private warpgateService: WarpgateService,
    @Inject(WarpgateProfileProvider) private profileProvider: WarpgateProfileProvider,
    @Inject(WarpgateSFTPProfileProvider) private sftpProfileProvider: WarpgateSFTPProfileProvider,
    @Inject(AppService) private app: AppService,
    @Inject(ProfilesService) private profiles: ProfilesService,
    @Inject(NotificationsService) private notifications: NotificationsService
  ) {
    this.config = this.warpgateService.getConfig();
  }

  ngOnInit(): void {
    this.hasServers = this.warpgateService.getServers().length > 0;

    // Subscribe to targets
    this.subscriptions.push(
      this.warpgateService.targets$.subscribe(() => {
        this.loadHosts();
      })
    );

    // Subscribe to status
    this.subscriptions.push(
      this.warpgateService.status$.subscribe(status => {
        this.updateDisconnectedServers(status);
      })
    );

    // Subscribe to loading
    this.subscriptions.push(
      this.warpgateService.loading$.subscribe(loading => {
        this.isLoading = loading;
      })
    );

    // Ensure servers are connected before initial load
    // This will trigger the targets$ subscription which calls loadHosts()
    this.connectServersAndLoad();
  }

  /**
   * Connect to all enabled servers and load hosts
   */
  private async connectServersAndLoad(): Promise<void> {
    const servers = this.warpgateService.getServers().filter(s => s.enabled);

    // Connect to any servers that aren't connected yet
    await Promise.all(
      servers.map(async server => {
        if (!this.warpgateService.isConnected(server.id)) {
          try {
            await this.warpgateService.connect(server.id);
          } catch {
            // Connection errors are handled by the service
          }
        }
      })
    );

    // Load hosts after ensuring connections
    // This is redundant with the targets$ subscription but ensures initial load
    this.loadHosts();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  /**
   * Load all hosts from Warpgate service
   */
  loadHosts(): void {
    const allTargets = this.warpgateService.getAllTargets();

    this.allHosts = allTargets.map(({ server, target }) => ({
      server,
      target,
      isConnecting: false,
    }));

    this.totalHosts = this.allHosts.length;
    this.filterHosts();
  }

  /**
   * Filter and group hosts
   */
  filterHosts(): void {
    let filteredHosts = this.allHosts;

    // Apply search filter
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filteredHosts = filteredHosts.filter(host =>
        host.target.name.toLowerCase().includes(query) ||
        host.target.description?.toLowerCase().includes(query) ||
        host.server.name.toLowerCase().includes(query) ||
        host.target.group?.name.toLowerCase().includes(query)
      );
    }

    // Sort hosts
    filteredHosts = this.sortHosts(filteredHosts);

    // Group hosts
    this.groups = this.groupHosts(filteredHosts);
  }

  /**
   * Sort hosts based on configuration
   */
  private sortHosts(hosts: HostItem[]): HostItem[] {
    return [...hosts].sort((a, b) => {
      switch (this.config.sortBy) {
        case 'server':
          return a.server.name.localeCompare(b.server.name);
        case 'kind':
          return a.target.kind.localeCompare(b.target.kind);
        case 'group':
          return (a.target.group?.name || '').localeCompare(b.target.group?.name || '');
        case 'name':
        default:
          return a.target.name.localeCompare(b.target.name);
      }
    });
  }

  /**
   * Group hosts based on configuration
   */
  private groupHosts(hosts: HostItem[]): HostGroup[] {
    const groupMap = new Map<string, HostGroup>();

    for (const host of hosts) {
      let groupKey: string;
      let groupName: string;
      let groupColor: string | undefined;

      if (this.config.groupByServer) {
        // Group by server, then by target group
        if (host.target.group) {
          groupKey = `${host.server.id}:${host.target.group.name}`;
          groupName = `${host.server.name} / ${host.target.group.name}`;
          groupColor = getBootstrapColor(host.target.group.color);
        } else {
          groupKey = host.server.id;
          groupName = host.server.name;
        }
      } else {
        // Group by target group only
        if (host.target.group) {
          groupKey = host.target.group.name;
          groupName = host.target.group.name;
          groupColor = getBootstrapColor(host.target.group.color);
        } else {
          groupKey = '__ungrouped__';
          groupName = 'Ungrouped';
        }
      }

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          name: groupName,
          color: groupColor,
          hosts: [],
          expanded: true,
        });
      }

      groupMap.get(groupKey)!.hosts.push(host);
    }

    return Array.from(groupMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /**
   * Toggle group expansion
   */
  toggleGroup(group: HostGroup): void {
    group.expanded = !group.expanded;
  }

  /**
   * Connect to host via SSH
   */
  async connectSsh(host: HostItem): Promise<void> {
    // Prevent double-click / double connection attempts
    if (host.isConnecting) {
      log.debug(` Ignoring duplicate connectSsh call for ${host.target.name}`);
      return;
    }

    log.debug(` connectSsh called for ${host.target.name}`);
    host.isConnecting = true;

    try {
      // Create profile with ticket authentication (one-click access)
      const profile = await this.profileProvider.createOneClickProfile(host.server, host.target);
      log.debug(` Profile created, auth method: ${profile.options.auth}, username: ${profile.options.user}`);

      // Open SSH tab
      await this.profiles.openNewTabForProfile(profile);

      this.notifications.info(`Connecting to ${host.target.name}...`);
    } catch (error) {
      log.error(` Failed to connect:`, error);
      this.notifications.error(
        `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      host.isConnecting = false;
    }
  }

  /**
   * Connect to host via SFTP
   */
  async connectSftp(host: HostItem): Promise<void> {
    // Prevent double-click / double connection attempts
    if (host.isConnecting) {
      log.debug(` Ignoring duplicate connectSftp call for ${host.target.name}`);
      return;
    }

    host.isConnecting = true;

    try {
      // Create SFTP profile with ticket authentication using the SFTP profile provider
      const sftpProfile = await this.sftpProfileProvider.createOneClickSftpProfile(host.server, host.target);

      // Open SFTP tab
      await this.profiles.openNewTabForProfile(sftpProfile as any);

      this.notifications.info(`Opening SFTP to ${host.target.name}...`);
    } catch (error) {
      this.notifications.error(
        `Failed to open SFTP: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      host.isConnecting = false;
    }
  }

  /**
   * Refresh all hosts
   */
  async refresh(): Promise<void> {
    await this.warpgateService.refreshAllTargets();
  }

  /**
   * Reconnect all servers
   */
  async reconnectAll(): Promise<void> {
    await this.warpgateService.connectAll();
  }

  /**
   * Update disconnected servers list
   */
  private updateDisconnectedServers(status: Map<string, WarpgateConnectionStatus>): void {
    const servers = this.warpgateService.getServers();
    this.disconnectedServers = servers.filter(
      s => s.enabled && !status.get(s.id)?.connected
    );
  }
}
