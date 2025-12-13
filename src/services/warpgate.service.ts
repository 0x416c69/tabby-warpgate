/**
 * Warpgate Service
 * Main service for managing Warpgate connections, authentication, and targets
 */

import { Injectable, Inject, Optional, Injector } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { ConfigService, NotificationsService, PlatformService } from 'tabby-core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

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
import { generateTOTP, isValidTOTPSecret } from '../utils/totp';

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
    @Optional() @Inject(PlatformService) private platform: PlatformService | null,
    private injector: Injector
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
   * Uses Tabby's config pattern - modify store properties directly and call save()
   */
  saveConfig(pluginConfig: Partial<WarpgatePluginConfig>): void {
    try {
      // Tabby's store is a proxy - we need to work with its existing structure
      // First check if warpgate exists in store
      if (!this.config.store.warpgate) {
        // This shouldn't happen if ConfigProvider is set up correctly
        console.error('[Warpgate] Config store.warpgate not initialized!');
        return;
      }

      const warpgateConfig = this.config.store.warpgate;
      console.log('[Warpgate] Saving config, current servers:', warpgateConfig.servers?.length ?? 0);

      // Update individual properties on the existing object
      // For arrays, we need to modify in place or replace carefully
      if (pluginConfig.servers !== undefined) {
        // Clear and repopulate the array to trigger proxy updates
        warpgateConfig.servers.length = 0;
        pluginConfig.servers.forEach((s: WarpgateServerConfig) => warpgateConfig.servers.push(s));
      }
      if (pluginConfig.autoRefreshInterval !== undefined) {
        warpgateConfig.autoRefreshInterval = pluginConfig.autoRefreshInterval;
      }
      if (pluginConfig.showOfflineServers !== undefined) {
        warpgateConfig.showOfflineServers = pluginConfig.showOfflineServers;
      }
      if (pluginConfig.groupByServer !== undefined) {
        warpgateConfig.groupByServer = pluginConfig.groupByServer;
      }
      if (pluginConfig.sortBy !== undefined) {
        warpgateConfig.sortBy = pluginConfig.sortBy;
      }
      if (pluginConfig.defaultSftpPath !== undefined) {
        warpgateConfig.defaultSftpPath = pluginConfig.defaultSftpPath;
      }

      console.log('[Warpgate] Config updated, servers now:', warpgateConfig.servers?.length ?? 0);
      this.config.save();
      console.log('[Warpgate] Config saved');
    } catch (error) {
      console.error('[Warpgate] Failed to save config:', error);
      // Fallback: try direct property access on store
      try {
        const store = this.config.store as Record<string, unknown>;
        if (!store['warpgate']) {
          store['warpgate'] = { ...DEFAULT_WARPGATE_CONFIG };
        }
        Object.assign(store['warpgate'] as object, pluginConfig);
        this.config.save();
        console.log('[Warpgate] Config saved via fallback');
      } catch (fallbackError) {
        console.error('[Warpgate] Fallback save also failed:', fallbackError);
      }
    }
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
   * Optionally reuses an existing test connection session to avoid re-authentication
   */
  async addServer(server: Omit<WarpgateServerConfig, 'id'>, reuseTestSession = true): Promise<WarpgateServerConfig> {
    const newServer: WarpgateServerConfig = {
      ...server,
      id: this.generateId(),
    };

    try {
      // Work directly with the config proxy
      if (!this.config.store.warpgate?.servers) {
        throw new Error('Config store not initialized');
      }

      // Push directly to the proxy array
      this.config.store.warpgate.servers.push(newServer);
      console.log('[Warpgate] Added server, total servers:', this.config.store.warpgate.servers.length);
      this.config.save();

      // Create client and connect if enabled
      if (newServer.enabled) {
        // Check if we have a test session we can reuse
        const testClientKey = `test:${newServer.url}:${newServer.username}`;
        const testClient = this.testClients.get(testClientKey);

        if (reuseTestSession && testClient && testClient.hasSession()) {
          console.log('[Warpgate] Reusing test connection session for new server');

          // Transfer the session to the new client
          const sessionCookie = testClient.getSessionCookie();
          const client = this.createClient(newServer);

          if (sessionCookie) {
            client.setSessionCookie(sessionCookie);

            // Store the session
            const session: WarpgateSession = {
              serverId: newServer.id,
              cookie: sessionCookie,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              username: newServer.username,
            };
            this.sessions.set(newServer.id, session);

            // Clean up test client and timer
            this.testClients.delete(testClientKey);
            const timer = this.testClientTimers.get(testClientKey);
            if (timer) {
              clearTimeout(timer);
              this.testClientTimers.delete(testClientKey);
            }

            // Fetch targets without re-authenticating
            await this.refreshTargets(newServer.id);
            this.updateConnectionStatus(newServer.id, true);
            this.showNotification('info', `Server ${newServer.name} added successfully`);
          } else {
            // No session cookie, connect normally
            await this.connect(newServer.id);
          }
        } else {
          // No test session available, connect normally
          this.createClient(newServer);
          await this.connect(newServer.id);
        }
      }

      this.emitEvent({ type: 'server-added', serverId: newServer.id, data: newServer });
      return newServer;
    } catch (error) {
      console.error('[Warpgate] Failed to add server:', error);
      throw error;
    }
  }

  /**
   * Update an existing server
   */
  async updateServer(serverId: string, updates: Partial<WarpgateServerConfig>): Promise<void> {
    try {
      // Work directly with the config proxy to avoid array copy issues
      if (!this.config.store.warpgate?.servers) {
        throw new Error('Config store not initialized');
      }

      const servers = this.config.store.warpgate.servers;
      const index = servers.findIndex((s: WarpgateServerConfig) => s.id === serverId);

      if (index === -1) {
        throw new Error(`Server ${serverId} not found`);
      }

      // Update the server in place on the proxy array
      const currentServer = servers[index];
      const updatedServer = { ...currentServer, ...updates };

      // Replace in the proxy array (this triggers reactivity)
      servers[index] = updatedServer;

      console.log('[Warpgate] Updated server in config, total servers:', servers.length);
      this.config.save();

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
    } catch (error) {
      console.error('[Warpgate] Failed to update server:', error);
      throw error;
    }
  }

  /**
   * Remove a server
   */
  removeServer(serverId: string): void {
    try {
      // Work directly with the config proxy
      if (!this.config.store.warpgate?.servers) {
        throw new Error('Config store not initialized');
      }

      const servers = this.config.store.warpgate.servers;
      const index = servers.findIndex((s: WarpgateServerConfig) => s.id === serverId);

      if (index !== -1) {
        // Remove from proxy array using splice
        servers.splice(index, 1);
        console.log('[Warpgate] Removed server, total servers:', servers.length);
        this.config.save();
      }

      // Clean up client and session
      this.clients.delete(serverId);
      this.sessions.delete(serverId);
      this.connectionStatus.delete(serverId);

      this.updateStatusSubject();
      this.emitEvent({ type: 'server-removed', serverId });
    } catch (error) {
      console.error('[Warpgate] Failed to remove server:', error);
    }
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

      if (loginResult.success && loginResult.data?.state) {
        const authState = loginResult.data.state;

        // Check if OTP is required
        if (authState.auth?.state === 'Need' &&
            authState.auth?.methods_remaining?.includes('Otp')) {

          // Try to generate OTP from stored secret
          let otpCode: string | null = null;
          if (server.otpSecret && isValidTOTPSecret(server.otpSecret)) {
            try {
              otpCode = await generateTOTP(server.otpSecret);
              console.log('[Warpgate] Generated OTP from stored secret');
            } catch (otpError) {
              console.error('[Warpgate] Failed to generate OTP:', otpError);
            }
          }

          if (!otpCode) {
            // No OTP secret configured - prompt user
            otpCode = await this.promptForOtp(server.name);
          }

          if (!otpCode) {
            this.updateConnectionStatus(serverId, false, 'OTP required but not provided');
            this.showNotification('error', `OTP required for ${server.name}`);
            return false;
          }

          // Submit OTP
          const otpResult = await client.submitOtp(otpCode);
          if (!otpResult.success || otpResult.data?.state?.auth?.state !== 'Accepted') {
            const otpError = otpResult.error?.message || 'OTP verification failed';
            this.updateConnectionStatus(serverId, false, otpError);
            this.showNotification('error', `OTP failed for ${server.name}: ${otpError}`);
            return false;
          }
        }

        // Authentication complete - store session
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
  ): {
    host: string;
    port: number;
    username: string;
    password?: string;
    useTicket: boolean;
    hasOtpSecret: boolean;
  } | null {
    const server = this.getServer(serverId);
    const client = this.clients.get(serverId);

    if (!server || !client) {
      return null;
    }

    // Check if we have a valid cached ticket
    const ticketKey = `${serverId}:${targetName}`;
    const cachedTicket = this.ticketCache.get(ticketKey);
    const hasOtpSecret = !!(server.otpSecret && isValidTOTPSecret(server.otpSecret));

    if (cachedTicket && this.isTicketValid(cachedTicket)) {
      // Use ticket-based authentication (one-click, no password prompt)
      return {
        host: client.getSshHost(),
        port: client.getSshPort(),
        username: client.generateTicketUsername(cachedTicket.secret),
        useTicket: true,
        hasOtpSecret,
      };
    }

    // Fall back to traditional authentication (requires password)
    return {
      host: client.getSshHost(),
      port: client.getSshPort(),
      username: `${server.username}:${targetName}`,
      password: server.password,
      useTicket: false,
      hasOtpSecret,
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
   * Generate a TOTP code for a server's configured OTP secret
   * Used for automatic OTP authentication in fallback mode
   * @param serverId Server ID
   * @returns Current TOTP code or null if no OTP secret configured
   */
  async generateOtpCode(serverId: string): Promise<string | null> {
    const server = this.getServer(serverId);
    if (!server?.otpSecret || !isValidTOTPSecret(server.otpSecret)) {
      return null;
    }

    try {
      return await generateTOTP(server.otpSecret);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.showNotification('error', `Failed to generate OTP: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Check if a server has OTP configured for automatic authentication
   * @param serverId Server ID
   */
  hasOtpSecret(serverId: string): boolean {
    const server = this.getServer(serverId);
    return !!(server?.otpSecret && isValidTOTPSecret(server.otpSecret));
  }

  /**
   * Set the OTP secret for a server (for automatic OTP in fallback auth)
   * @param serverId Server ID
   * @param otpSecret Base32-encoded TOTP secret
   */
  async setOtpSecret(serverId: string, otpSecret: string): Promise<void> {
    if (otpSecret && !isValidTOTPSecret(otpSecret)) {
      throw new Error('Invalid OTP secret format. Must be a valid Base32 string.');
    }

    await this.updateServer(serverId, { otpSecret: otpSecret || undefined });
  }

  /**
   * Clear the OTP secret for a server
   * @param serverId Server ID
   */
  async clearOtpSecret(serverId: string): Promise<void> {
    await this.updateServer(serverId, { otpSecret: undefined });
  }

  /**
   * Get full authentication credentials for SSH connection
   * This method provides everything needed for fully automatic authentication
   * including password and OTP code for keyboard-interactive auth
   */
  async getFullAuthCredentials(
    serverId: string,
    targetName: string
  ): Promise<{
    host: string;
    port: number;
    username: string;
    password?: string;
    otpCode?: string;
    useTicket: boolean;
  } | null> {
    const connectionDetails = this.getSshConnectionDetails(serverId, targetName);
    if (!connectionDetails) {
      return null;
    }

    // If using ticket auth, no additional credentials needed
    if (connectionDetails.useTicket) {
      return {
        host: connectionDetails.host,
        port: connectionDetails.port,
        username: connectionDetails.username,
        useTicket: true,
      };
    }

    // For fallback auth, include password and generate OTP if available
    const otpCode = connectionDetails.hasOtpSecret
      ? await this.generateOtpCode(serverId)
      : undefined;

    return {
      host: connectionDetails.host,
      port: connectionDetails.port,
      username: connectionDetails.username,
      password: connectionDetails.password,
      otpCode: otpCode ?? undefined,
      useTicket: false,
    };
  }

  /**
   * Auto-setup OTP for a server
   * This generates a new TOTP secret, registers it with Warpgate via the
   * self-service API, and stores the secret locally for automatic OTP generation.
   *
   * @param serverId Server ID
   * @returns Success status and the registered secret (for display to user if needed)
   */
  async autoSetupOtp(serverId: string): Promise<{
    success: boolean;
    secret?: string;
    error?: string;
  }> {
    const client = this.clients.get(serverId);
    if (!client) {
      return { success: false, error: 'Server not connected' };
    }

    try {
      // Check if OTP is already set up on Warpgate
      const hasOtp = await client.hasProfileOtp();
      if (hasOtp) {
        // OTP is already enabled on Warpgate
        // Check if we have the secret stored locally
        if (this.hasOtpSecret(serverId)) {
          return { success: true, secret: this.getServer(serverId)?.otpSecret };
        }
        return {
          success: false,
          error: 'OTP is already enabled on Warpgate but no secret stored locally. Please disable OTP on Warpgate first or enter your existing secret manually.',
        };
      }

      // Auto-setup: generate secret and register with Warpgate
      const result = await client.autoSetupOtp();

      if (result.success && result.data) {
        // Store the secret locally
        await this.setOtpSecret(serverId, result.data.secret);

        this.showNotification('info', 'OTP has been automatically configured for this server');

        return {
          success: true,
          secret: result.data.secret,
        };
      } else {
        return {
          success: false,
          error: result.error?.message || 'Failed to set up OTP',
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Check if OTP is enabled on the Warpgate server for the current user
   * @param serverId Server ID
   */
  async isOtpEnabledOnServer(serverId: string): Promise<boolean> {
    const client = this.clients.get(serverId);
    if (!client) {
      return false;
    }

    try {
      return await client.hasProfileOtp();
    } catch {
      return false;
    }
  }

  /**
   * Disable OTP on both Warpgate and locally
   * @param serverId Server ID
   */
  async disableOtp(serverId: string): Promise<{ success: boolean; error?: string }> {
    const client = this.clients.get(serverId);
    if (!client) {
      return { success: false, error: 'Server not connected' };
    }

    try {
      // Get current OTP credentials
      const credentials = await client.getProfileCredentials();
      if (credentials.success && credentials.data?.otp && credentials.data.otp.length > 0) {
        // Disable each OTP credential on Warpgate
        for (const credId of credentials.data.otp) {
          await client.disableProfileOtp(credId);
        }
      }

      // Clear local secret
      await this.clearOtpSecret(serverId);

      this.showNotification('info', 'OTP has been disabled');
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
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
   * Prompt user for OTP code
   * Uses NgbModal to show a proper Angular modal dialog
   */
  private async promptForOtp(serverName: string): Promise<string | null> {
    try {
      // Dynamically import the modal component to avoid circular dependencies
      const { WarpgateOtpModalComponent } = await import('../components/warpgate-otp-modal.component');

      // Get NgbModal service from injector
      const modalService = this.injector.get(NgbModal);

      const modalRef = modalService.open(WarpgateOtpModalComponent, {
        centered: true,
        keyboard: true,
        backdrop: 'static',
      });

      modalRef.componentInstance.serverName = serverName;

      // Wait for modal to close and return the result
      const result = await modalRef.result;
      return result?.trim() || null;
    } catch (error) {
      console.error('[Warpgate] Failed to show OTP modal:', error);
      this.showNotification('error', 'Failed to show OTP input dialog');
      return null;
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
    const result = await this.testServerConnectionFull(url, username, password, trustSelfSigned);
    return { success: result.success, error: result.error };
  }

  /**
   * Test connection to a server with full OTP support
   * Returns needsOtp: true if server requires OTP authentication
   * IMPORTANT: Keeps the session alive for reuse when adding the server
   */
  async testServerConnectionFull(
    url: string,
    username: string,
    password: string,
    trustSelfSigned = false,
    otpCode?: string
  ): Promise<{ success: boolean; needsOtp?: boolean; error?: string; sessionCookie?: string }> {
    // Store client temporarily for OTP follow-up
    const clientKey = `test:${url}:${username}`;
    let client = this.testClients.get(clientKey);

    if (!client) {
      client = new WarpgateApiClient(url, trustSelfSigned);
      this.testClients.set(clientKey, client);

      // Schedule cleanup after 5 minutes if not used
      const timer = setTimeout(() => {
        this.testClients.delete(clientKey);
        this.testClientTimers.delete(clientKey);
        console.log('[Warpgate] Cleaned up unused test session');
      }, 5 * 60 * 1000);
      this.testClientTimers.set(clientKey, timer);
    }

    try {
      const result = await client.login({ username, password });

      if (result.success && result.data?.state) {
        const authState = result.data.state;

        // Check if OTP is required
        if (authState.auth?.state === 'Need' &&
            authState.auth?.methods_remaining?.includes('Otp')) {

          // If we have an OTP code, submit it
          if (otpCode) {
            const otpResult = await client.submitOtp(otpCode);
            if (otpResult.success && otpResult.data?.state) {
              // Check final auth state
              const finalAuthState = otpResult.data.state.auth;
              if (finalAuthState?.state === 'Accepted') {
                // DON'T logout - keep session for reuse
                const sessionCookie = client.getSessionCookie();
                console.log('[Warpgate] Test connection successful, session preserved');
                return { success: true, sessionCookie: sessionCookie || undefined };
              }
            }
            return { success: false, error: otpResult.error?.message || 'OTP verification failed' };
          }

          // OTP required but not provided
          return { success: false, needsOtp: true };
        }

        // Check if authentication was accepted
        if (authState.auth?.state === 'Accepted') {
          // DON'T logout - keep session for reuse
          const sessionCookie = client.getSessionCookie();
          console.log('[Warpgate] Test connection successful, session preserved');
          return { success: true, sessionCookie: sessionCookie || undefined };
        }

        // Auth in progress but not complete
        return { success: false, error: 'Authentication incomplete' };
      } else {
        this.testClients.delete(clientKey);
        return {
          success: false,
          error: result.error?.message || 'Authentication failed',
        };
      }
    } catch (error) {
      this.testClients.delete(clientKey);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Submit OTP for a test connection that's waiting for OTP
   */
  async testServerConnectionWithOtp(
    url: string,
    otpCode: string,
    trustSelfSigned = false
  ): Promise<{ success: boolean; error?: string }> {
    const clientKey = `test:${url}`;
    const client = this.testClients.get(clientKey);

    if (!client) {
      return { success: false, error: 'No pending authentication. Please test connection again.' };
    }

    try {
      const otpResult = await client.submitOtp(otpCode);

      if (otpResult.success && otpResult.data?.state) {
        const authState = otpResult.data.state.auth;
        if (authState?.state === 'Accepted') {
          await client.logout();
          this.testClients.delete(clientKey);
          return { success: true };
        }
        // Still needs more auth
        return { success: false, error: 'Additional authentication required' };
      }

      return { success: false, error: otpResult.error?.message || 'OTP verification failed' };
    } catch (error) {
      this.testClients.delete(clientKey);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OTP submission failed',
      };
    }
  }

  /** Temporary clients for test connections (to maintain session for OTP) */
  private testClients: Map<string, WarpgateApiClient> = new Map();

  /** Test client cleanup timers */
  private testClientTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Clean up on destroy
   */
  destroy(): void {
    this.stopAutoRefresh();
    this.disconnectAll();

    // Clean up test client timers
    for (const timer of this.testClientTimers.values()) {
      clearTimeout(timer);
    }
    this.testClientTimers.clear();
    this.testClients.clear();
  }
}
