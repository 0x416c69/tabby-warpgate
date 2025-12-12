/**
 * Warpgate Service
 * Main service for managing Warpgate connections, authentication, and targets
 */

import { Injectable, Inject, Optional } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { ConfigService, NotificationsService, PlatformService } from 'tabby-core';

import { WarpgateApiClient } from '../api/warpgate.api';
import {
  WarpgateServerConfig,
  WarpgateTarget,
  WarpgateConnectionStatus,
  WarpgatePluginConfig,
  DEFAULT_WARPGATE_CONFIG,
  WarpgateSession,
  WarpgateCachedTicket,
} from '../models/warpgate.models';

/** Event types for Warpgate service events */
export type WarpgateEventType =
  | 'server-added'
  | 'server-removed'
  | 'server-updated'
  | 'targets-updated'
  | 'connection-changed'
  | 'error';

/** Event data structure */
export interface WarpgateEvent {
  type: WarpgateEventType;
  serverId?: string;
  data?: unknown;
  error?: Error;
}

/**
 * Warpgate Service
 * Provides centralized management of Warpgate server connections
 */
@Injectable({ providedIn: 'root' })
export class WarpgateService {
  /** Map of API clients by server ID */
  private clients: Map<string, WarpgateApiClient> = new Map();

  /** Map of active sessions by server ID */
  private sessions: Map<string, WarpgateSession> = new Map();

  /** Map of cached tickets by "serverId:targetName" key */
  private ticketCache: Map<string, WarpgateCachedTicket> = new Map();

  /** Connection status by server ID */
  private connectionStatus: Map<string, WarpgateConnectionStatus> = new Map();

  /** Auto-refresh subscription */
  private refreshSubscription: Subscription | null = null;

  /** Subject for server targets */
  private targetsSubject = new BehaviorSubject<Map<string, WarpgateTarget[]>>(new Map());

  /** Subject for connection status updates */
  private statusSubject = new BehaviorSubject<Map<string, WarpgateConnectionStatus>>(new Map());

  /** Subject for events */
  private eventsSubject = new BehaviorSubject<WarpgateEvent | null>(null);

  /** Subject for loading state */
  private loadingSubject = new BehaviorSubject<boolean>(false);

  /** Observable for targets by server */
  readonly targets$: Observable<Map<string, WarpgateTarget[]>> = this.targetsSubject.asObservable();

  /** Observable for connection status */
  readonly status$: Observable<Map<string, WarpgateConnectionStatus>> = this.statusSubject.asObservable();

  /** Observable for events */
  readonly events$: Observable<WarpgateEvent | null> = this.eventsSubject.asObservable();

  /** Observable for loading state */
  readonly loading$: Observable<boolean> = this.loadingSubject.asObservable();

  constructor(
    @Inject(ConfigService) private config: ConfigService,
    @Optional() @Inject(NotificationsService) private notifications: NotificationsService | null,
    @Optional() @Inject(PlatformService) private platform: PlatformService | null
  ) {
    this.initialize();
  }

  /**
   * Initialize the service
   */
  private async initialize(): Promise<void> {
    // Load saved servers and initialize clients
    const servers = this.getServers();
    for (const server of servers) {
      if (server.enabled) {
        this.createClient(server);
      }
    }

    // Start auto-refresh if configured
    this.startAutoRefresh();

    // Connect to all enabled servers
    await this.connectAll();
  }

  /**
   * Get plugin configuration
   */
  getConfig(): WarpgatePluginConfig {
    return this.config.store.warpgate || DEFAULT_WARPGATE_CONFIG;
  }

  /**
   * Save plugin configuration
   */
  saveConfig(pluginConfig: Partial<WarpgatePluginConfig>): void {
    this.config.store.warpgate = {
      ...this.getConfig(),
      ...pluginConfig,
    };
    this.config.save();
  }

  /**
   * Get all configured servers
   */
  getServers(): WarpgateServerConfig[] {
    return this.getConfig().servers || [];
  }

  /**
   * Get a server by ID
   */
  getServer(serverId: string): WarpgateServerConfig | undefined {
    return this.getServers().find(s => s.id === serverId);
  }

  /**
   * Add a new server
   */
  async addServer(server: Omit<WarpgateServerConfig, 'id'>): Promise<WarpgateServerConfig> {
    const newServer: WarpgateServerConfig = {
      ...server,
      id: this.generateId(),
    };

    const servers = this.getServers();
    servers.push(newServer);
    this.saveConfig({ servers });

    // Create client and connect if enabled
    if (newServer.enabled) {
      this.createClient(newServer);
      await this.connect(newServer.id);
    }

    this.emitEvent({ type: 'server-added', serverId: newServer.id, data: newServer });
    return newServer;
  }

  /**
   * Update an existing server
   */
  async updateServer(serverId: string, updates: Partial<WarpgateServerConfig>): Promise<void> {
    const servers = this.getServers();
    const index = servers.findIndex(s => s.id === serverId);

    if (index === -1) {
      throw new Error(`Server ${serverId} not found`);
    }

    const updatedServer = { ...servers[index], ...updates };
    servers[index] = updatedServer;
    this.saveConfig({ servers });

    // Recreate client if URL or credentials changed
    if (updates.url || updates.username || updates.password || updates.trustSelfSigned !== undefined) {
      this.clients.delete(serverId);
      this.sessions.delete(serverId);

      if (updatedServer.enabled) {
        this.createClient(updatedServer);
        await this.connect(serverId);
      }
    }

    this.emitEvent({ type: 'server-updated', serverId, data: updatedServer });
  }

  /**
   * Remove a server
   */
  removeServer(serverId: string): void {
    const servers = this.getServers().filter(s => s.id !== serverId);
    this.saveConfig({ servers });

    // Clean up client and session
    this.clients.delete(serverId);
    this.sessions.delete(serverId);
    this.connectionStatus.delete(serverId);

    this.updateStatusSubject();
    this.emitEvent({ type: 'server-removed', serverId });
  }

  /**
   * Create an API client for a server
   */
  private createClient(server: WarpgateServerConfig): WarpgateApiClient {
    const client = new WarpgateApiClient(server.url, server.trustSelfSigned);
    this.clients.set(server.id, client);
    return client;
  }

  /**
   * Get or create a client for a server
   */
  getClient(serverId: string): WarpgateApiClient | undefined {
    return this.clients.get(serverId);
  }

  /**
   * Connect to a server
   */
  async connect(serverId: string): Promise<boolean> {
    const server = this.getServer(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    let client = this.clients.get(serverId);
    if (!client) {
      client = this.createClient(server);
    }

    this.loadingSubject.next(true);

    try {
      // Check if we have a valid session
      const existingSession = this.sessions.get(serverId);
      if (existingSession && new Date(existingSession.expiresAt) > new Date()) {
        client.setSessionCookie(existingSession.cookie);
        const authState = await client.getAuthState();
        if (authState.success) {
          await this.refreshTargets(serverId);
          this.updateConnectionStatus(serverId, true);
          return true;
        }
      }

      // Login with credentials
      if (!server.password) {
        this.showNotification('error', `No password configured for server ${server.name}`);
        this.updateConnectionStatus(serverId, false, 'No password configured');
        return false;
      }

      const loginResult = await client.login({
        username: server.username,
        password: server.password,
      });

      if (loginResult.success) {
        // Store session
        const session: WarpgateSession = {
          serverId,
          cookie: client.getSessionCookie() || '',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          username: server.username,
        };
        this.sessions.set(serverId, session);

        // Update server last connected time
        await this.updateServer(serverId, { lastConnected: new Date() });

        // Fetch targets
        await this.refreshTargets(serverId);
        this.updateConnectionStatus(serverId, true);

        this.showNotification('info', `Connected to ${server.name}`);
        return true;
      } else {
        const errorMessage = loginResult.error?.message || 'Authentication failed';
        this.updateConnectionStatus(serverId, false, errorMessage);
        this.showNotification('error', `Failed to connect to ${server.name}: ${errorMessage}`);
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      this.updateConnectionStatus(serverId, false, errorMessage);
      this.showNotification('error', `Error connecting to ${server.name}: ${errorMessage}`);
      return false;
    } finally {
      this.loadingSubject.next(false);
    }
  }

  /**
   * Disconnect from a server
   */
  async disconnect(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client && client.hasSession()) {
      try {
        await client.logout();
      } catch {
        // Ignore logout errors
      }
    }

    this.sessions.delete(serverId);
    this.updateConnectionStatus(serverId, false);
    this.emitEvent({ type: 'connection-changed', serverId });
  }

  /**
   * Connect to all enabled servers
   */
  async connectAll(): Promise<void> {
    const servers = this.getServers().filter(s => s.enabled);
    await Promise.all(servers.map(s => this.connect(s.id)));
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.clients.keys());
    await Promise.all(serverIds.map(id => this.disconnect(id)));
  }

  /**
   * Refresh targets for a server
   */
  async refreshTargets(serverId: string): Promise<WarpgateTarget[]> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`No client for server ${serverId}`);
    }

    const result = await client.getSshTargets();
    if (result.success && result.data) {
      const currentTargets = this.targetsSubject.getValue();
      currentTargets.set(serverId, result.data);
      this.targetsSubject.next(new Map(currentTargets));

      // Update connection status with targets
      const status = this.connectionStatus.get(serverId);
      if (status) {
        status.targets = result.data;
        this.updateStatusSubject();
      }

      this.emitEvent({ type: 'targets-updated', serverId, data: result.data });
      return result.data;
    }

    return [];
  }

  /**
   * Refresh targets for all connected servers
   */
  async refreshAllTargets(): Promise<void> {
    const connectedServers = Array.from(this.connectionStatus.entries())
      .filter(([, status]) => status.connected)
      .map(([serverId]) => serverId);

    await Promise.all(connectedServers.map(id => this.refreshTargets(id)));
  }

  /**
   * Get all targets across all servers
   */
  getAllTargets(): Array<{ server: WarpgateServerConfig; target: WarpgateTarget }> {
    const result: Array<{ server: WarpgateServerConfig; target: WarpgateTarget }> = [];
    const targets = this.targetsSubject.getValue();

    for (const [serverId, serverTargets] of targets) {
      const server = this.getServer(serverId);
      if (server) {
        for (const target of serverTargets) {
          result.push({ server, target });
        }
      }
    }

    return result;
  }

  /**
   * Get SSH targets for a specific server
   */
  getServerTargets(serverId: string): WarpgateTarget[] {
    return this.targetsSubject.getValue().get(serverId) || [];
  }

  /**
   * Check if connected to a server
   */
  isConnected(serverId: string): boolean {
    return this.connectionStatus.get(serverId)?.connected || false;
  }

  /**
   * Get connection status for a server
   */
  getConnectionStatus(serverId: string): WarpgateConnectionStatus | undefined {
    return this.connectionStatus.get(serverId);
  }

  /**
   * Get SSH connection details for a target
   * Returns ticket-based credentials for one-click authentication
   */
  getSshConnectionDetails(
    serverId: string,
    targetName: string
  ): { host: string; port: number; username: string; password?: string; useTicket: boolean } | null {
    const server = this.getServer(serverId);
    const client = this.clients.get(serverId);

    if (!server || !client) {
      return null;
    }

    // Check if we have a valid cached ticket
    const ticketKey = `${serverId}:${targetName}`;
    const cachedTicket = this.ticketCache.get(ticketKey);

    if (cachedTicket && this.isTicketValid(cachedTicket)) {
      // Use ticket-based authentication (one-click, no password prompt)
      return {
        host: client.getSshHost(),
        port: client.getSshPort(),
        username: client.generateTicketUsername(cachedTicket.secret),
        useTicket: true,
      };
    }

    // Fall back to traditional authentication (requires password)
    return {
      host: client.getSshHost(),
      port: client.getSshPort(),
      username: `${server.username}:${targetName}`,
      password: server.password,
      useTicket: false,
    };
  }

  /**
   * Get or create a ticket for one-click SSH access
   * This creates a one-time ticket that allows passwordless authentication
   */
  async getOrCreateTicket(
    serverId: string,
    targetName: string
  ): Promise<{ host: string; port: number; username: string } | null> {
    const server = this.getServer(serverId);
    const client = this.clients.get(serverId);

    if (!server || !client) {
      return null;
    }

    const ticketKey = `${serverId}:${targetName}`;

    // Check for valid cached ticket
    const cachedTicket = this.ticketCache.get(ticketKey);
    if (cachedTicket && this.isTicketValid(cachedTicket)) {
      return {
        host: client.getSshHost(),
        port: client.getSshPort(),
        username: client.generateTicketUsername(cachedTicket.secret),
      };
    }

    // Create a new ticket
    try {
      const result = await client.createTicket({
        username: server.username,
        target_name: targetName,
        number_of_uses: 1, // One-time use
        description: `Tabby Warpgate auto-generated ticket for ${targetName}`,
      });

      if (result.success && result.data) {
        // Cache the ticket
        const ticket: WarpgateCachedTicket = {
          serverId,
          targetName,
          secret: result.data.secret,
          expiresAt: result.data.ticket.expiry ? new Date(result.data.ticket.expiry) : null,
          usesLeft: result.data.ticket.uses_left ?? 1,
        };
        this.ticketCache.set(ticketKey, ticket);

        return {
          host: client.getSshHost(),
          port: client.getSshPort(),
          username: client.generateTicketUsername(result.data.secret),
        };
      } else {
        // Ticket creation failed - fall back to traditional auth
        this.showNotification(
          'warning',
          `Could not create ticket for ${targetName}, using password authentication`
        );
        return {
          host: client.getSshHost(),
          port: client.getSshPort(),
          username: `${server.username}:${targetName}`,
        };
      }
    } catch (error) {
      // On error, fall back to traditional auth
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.showNotification('warning', `Ticket creation failed: ${errorMessage}`);
      return {
        host: client.getSshHost(),
        port: client.getSshPort(),
        username: `${server.username}:${targetName}`,
      };
    }
  }

  /**
   * Check if a cached ticket is still valid
   */
  private isTicketValid(ticket: WarpgateCachedTicket): boolean {
    // Check uses remaining
    if (ticket.usesLeft === 0) {
      return false;
    }

    // Check expiry
    if (ticket.expiresAt && new Date() > ticket.expiresAt) {
      return false;
    }

    return true;
  }

  /**
   * Invalidate a cached ticket (call after use for one-time tickets)
   */
  invalidateTicket(serverId: string, targetName: string): void {
    const ticketKey = `${serverId}:${targetName}`;
    const ticket = this.ticketCache.get(ticketKey);

    if (ticket) {
      if (ticket.usesLeft > 0) {
        ticket.usesLeft--;
      }
      if (ticket.usesLeft === 0) {
        this.ticketCache.delete(ticketKey);
      }
    }
  }

  /**
   * Clear all cached tickets for a server
   */
  clearServerTickets(serverId: string): void {
    for (const [key] of this.ticketCache) {
      if (key.startsWith(`${serverId}:`)) {
        this.ticketCache.delete(key);
      }
    }
  }

  /**
   * Start auto-refresh interval
   */
  private startAutoRefresh(): void {
    const config = this.getConfig();
    if (config.autoRefreshInterval > 0) {
      this.stopAutoRefresh();
      this.refreshSubscription = interval(config.autoRefreshInterval).subscribe(() => {
        this.refreshAllTargets();
      });
    }
  }

  /**
   * Stop auto-refresh interval
   */
  private stopAutoRefresh(): void {
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
      this.refreshSubscription = null;
    }
  }

  /**
   * Update auto-refresh interval
   */
  updateAutoRefreshInterval(intervalMs: number): void {
    this.saveConfig({ autoRefreshInterval: intervalMs });
    this.startAutoRefresh();
  }

  /**
   * Update connection status for a server
   */
  private updateConnectionStatus(serverId: string, connected: boolean, error?: string): void {
    const currentStatus = this.connectionStatus.get(serverId);
    const status: WarpgateConnectionStatus = {
      serverId,
      connected,
      lastError: error,
      lastChecked: new Date(),
      targets: currentStatus?.targets || [],
    };

    this.connectionStatus.set(serverId, status);
    this.updateStatusSubject();
    this.emitEvent({ type: 'connection-changed', serverId, data: status });
  }

  /**
   * Update status subject
   */
  private updateStatusSubject(): void {
    this.statusSubject.next(new Map(this.connectionStatus));
  }

  /**
   * Emit an event
   */
  private emitEvent(event: WarpgateEvent): void {
    this.eventsSubject.next(event);
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `wg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Show notification
   */
  private showNotification(type: 'info' | 'error' | 'warning', message: string): void {
    if (this.notifications) {
      if (type === 'error') {
        this.notifications.error(message);
      } else if (type === 'warning') {
        this.notifications.notice(message);
      } else {
        this.notifications.info(message);
      }
    }
  }

  /**
   * Test connection to a server without saving
   */
  async testServerConnection(
    url: string,
    username: string,
    password: string,
    trustSelfSigned = false
  ): Promise<{ success: boolean; error?: string }> {
    const client = new WarpgateApiClient(url, trustSelfSigned);

    try {
      const result = await client.login({ username, password });

      if (result.success) {
        // Logout after test
        await client.logout();
        return { success: true };
      } else {
        return {
          success: false,
          error: result.error?.message || 'Authentication failed',
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Clean up on destroy
   */
  destroy(): void {
    this.stopAutoRefresh();
    this.disconnectAll();
  }
}
