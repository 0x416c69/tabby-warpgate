/**
 * Warpgate Service
 * Main service for managing Warpgate connections, authentication, and targets
 */

import { Injectable, Inject, Optional, Injector } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { ConfigService, NotificationsService, PlatformService } from 'tabby-core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { ApiResponse, WarpgateApiClient } from '../api/warpgate.api';
import {
  WarpgateServerConfig,
  WarpgateTarget,
  WarpgateConnectionStatus,
  WarpgatePluginConfig,
  DEFAULT_WARPGATE_CONFIG,
  WarpgateSession,
  WarpgateCachedTicket,
  WarpgateServerInfo,
  WarpgateAuthState,
  WarpgateTicketRequest,
} from '../models/warpgate.models';
import { WarpgateOtpModalComponent } from '../components/warpgate-otp-modal.component';
import { generateTOTP, isValidTOTPSecret } from '../utils/totp';
import { initDebugLogger, createLogger } from '../utils/debug-logger';

const log = createLogger('Service');

/** Description prefix used for tickets created by this plugin */
export const PLUGIN_TICKET_DESCRIPTION_PREFIX = 'Tabby Warpgate auto-generated';

/** How long a ticket created by this plugin stays valid if it is never used */
const TICKET_TTL_MS = 10 * 60 * 1000;

/** How long an idle test connection session is kept for reuse */
const TEST_SESSION_TTL_MS = 5 * 60 * 1000;

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

/** SSH endpoint (host and port) of a Warpgate server */
export interface WarpgateSshEndpoint {
  host: string;
  port: number;
}

/** Connection details for a ticket created for a single SSH connection */
export interface WarpgateTicketConnectionDetails extends WarpgateSshEndpoint {
  username: string;
}

/** Result of an authentication attempt */
interface AuthResult {
  success: boolean;
  error?: string;
}

/** Result of loading targets from a server */
interface LoadTargetsResult {
  success: boolean;
  targets: WarpgateTarget[];
  status?: number;
  error?: string;
}

/** Plugin config keys that hold arrays */
const ARRAY_CONFIG_KEYS: Array<keyof WarpgatePluginConfig> = ['servers', 'pinnedHosts', 'snippets', 'history'];

/** Plugin config keys that hold plain objects (maps) */
const OBJECT_CONFIG_KEYS: Array<keyof WarpgatePluginConfig> = ['hostSettings', 'hostOs'];

/**
 * Create a fresh copy of the default plugin configuration
 */
function createDefaultConfig(): WarpgatePluginConfig {
  return {
    ...DEFAULT_WARPGATE_CONFIG,
    servers: [],
    pinnedHosts: [],
    hostSettings: {},
    snippets: [],
    history: [],
    hostOs: {},
  };
}

/** Server fields that require a new web session when changed */
const CONNECTION_FIELDS: Array<keyof WarpgateServerConfig> = ['url', 'username', 'password'];

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

  /** Tickets created by this plugin, by secret (a target can have several, one per connection) */
  private ticketCache: Map<string, WarpgateCachedTicket> = new Map();

  /** Secrets of tickets created by this plugin that have not been used for a connection yet */
  private unusedTicketSecrets = new Set<string>();

  /** Servers on which the current user is not allowed to create tickets */
  private ticketsUnavailable = new Set<string>();

  /** Servers where the user may not list tickets, so used tickets cannot be cleaned up */
  private ticketListingDenied = new Set<string>();

  /** Map of server info (includes external_host) by server ID */
  private serverInfo: Map<string, WarpgateServerInfo> = new Map();

  /** Connection status by server ID */
  private connectionStatus: Map<string, WarpgateConnectionStatus> = new Map();

  /** Auto-refresh subscription */
  private refreshSubscription: Subscription | null = null;

  /** Interval of the running auto-refresh timer (0 when stopped) */
  private refreshIntervalMs = 0;

  /** Subject for server targets */
  private targetsSubject = new BehaviorSubject<Map<string, WarpgateTarget[]>>(new Map());

  /** Subject for connection status updates */
  private statusSubject = new BehaviorSubject<Map<string, WarpgateConnectionStatus>>(new Map());

  /** Subject for events */
  private eventsSubject = new BehaviorSubject<WarpgateEvent | null>(null);

  /** Subject for loading state */
  private loadingSubject = new BehaviorSubject<boolean>(false);

  /** Number of connection attempts in progress */
  private pendingConnections = 0;

  /** Connection locks to prevent concurrent auth attempts */
  private connectingLocks = new Map<string, Promise<boolean>>();

  /** Authentication locks to prevent concurrent logins for the same server */
  private authLocks = new Map<string, Promise<AuthResult>>();

  /** Temporary clients for test connections (to maintain session for OTP) */
  private testClients: Map<string, WarpgateApiClient> = new Map();

  /** Test client cleanup timers */
  private testClientTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Test clients whose session completed authentication and can be reused */
  private authenticatedTestClients = new Set<string>();

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
    @Inject(Injector) private injector: Injector
  ) {
    // Initialize the debug logger with config service
    initDebugLogger(config);

    // The config store is loaded asynchronously by Tabby, wait for it before reading servers
    const ready$ = config.ready$;
    if (ready$ && typeof ready$.subscribe === 'function') {
      ready$.subscribe(() => {
        this.initialize();
      });
    } else {
      this.initialize();
    }
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
    return this.config.store?.warpgate || createDefaultConfig();
  }

  /**
   * Save plugin configuration
   * Uses Tabby's config pattern - modify store properties directly and call save()
   */
  saveConfig(pluginConfig: Partial<WarpgatePluginConfig>): void {
    const store = this.config.store;
    if (!store) {
      log.error('Config store not initialized!');
      return;
    }

    if (!store.warpgate) {
      store.warpgate = createDefaultConfig();
    }

    const warpgateConfig = store.warpgate;
    log.debug('Saving config, current servers:', warpgateConfig.servers?.length ?? 0);

    for (const key of Object.keys(pluginConfig) as Array<keyof WarpgatePluginConfig>) {
      const value = pluginConfig[key];
      if (value === undefined) {
        continue;
      }

      if (key === 'servers') {
        // Copy first: the caller may pass the store's own array
        const servers = [...(value as WarpgateServerConfig[])];
        if (!Array.isArray(warpgateConfig.servers)) {
          warpgateConfig.servers = [];
        }
        // Modify the array in place to keep Tabby's config proxy in sync
        warpgateConfig.servers.length = 0;
        servers.forEach(server => warpgateConfig.servers.push(server));
      } else if (key === 'autoRefreshInterval') {
        warpgateConfig.autoRefreshInterval = Number(value) || 0;
      } else if (ARRAY_CONFIG_KEYS.includes(key)) {
        (warpgateConfig as any)[key] = [...(value as unknown[])];
      } else if (OBJECT_CONFIG_KEYS.includes(key)) {
        // Always assign a new object, Tabby's config proxy only persists assignments
        (warpgateConfig as any)[key] = { ...(value as object) };
      } else {
        (warpgateConfig as any)[key] = value;
      }
    }

    this.config.save();
    log.debug('Config saved, servers now:', warpgateConfig.servers?.length ?? 0);

    if (pluginConfig.autoRefreshInterval !== undefined &&
        this.getConfig().autoRefreshInterval !== this.refreshIntervalMs) {
      this.startAutoRefresh();
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
      log.debug('Added server, total servers:', this.config.store.warpgate.servers.length);
      this.config.save();

      // Create client and connect if enabled
      if (newServer.enabled) {
        // Check if we have an authenticated test session we can reuse
        const testClientKey = this.getTestClientKey(newServer.url, newServer.username);
        const testClient = this.testClients.get(testClientKey);
        const sessionCookie = testClient?.getSessionCookie();

        if (reuseTestSession && testClient && sessionCookie && this.authenticatedTestClients.has(testClientKey)) {
          log.debug('Reusing test connection session for new server');

          // Transfer the session to the new client
          const client = this.createClient(newServer);
          client.setSessionCookie(sessionCookie);
          this.sessions.set(newServer.id, {
            serverId: newServer.id,
            cookie: sessionCookie,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            username: newServer.username,
          });

          // Clean up test client and timer
          this.disposeTestClient(testClientKey);

          // Fetch targets without re-authenticating
          const loaded = await this.loadTargetsWithReauth(newServer.id, false);
          if (loaded.success) {
            this.updateConnectionStatus(newServer.id, true);
            this.showNotification('info', `Server ${newServer.name} added successfully`);
          } else {
            await this.connect(newServer.id);
          }
        } else {
          // No reusable test session available, connect normally
          this.createClient(newServer);
          await this.connect(newServer.id);
        }
      }

      this.emitEvent({ type: 'server-added', serverId: newServer.id, data: newServer });
      return newServer;
    } catch (error) {
      log.error('Failed to add server:', error);
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
      const currentServer: WarpgateServerConfig = servers[index];
      const updatedServer: WarpgateServerConfig = { ...currentServer, ...updates };

      // Replace in the proxy array (this triggers reactivity)
      servers[index] = updatedServer;

      log.debug('Updated server in config, total servers:', servers.length);
      this.config.save();

      const connectionChanged =
        CONNECTION_FIELDS.some(field => field in updates && (updates[field] ?? '') !== (currentServer[field] ?? '')) ||
        ('trustSelfSigned' in updates && !!updates.trustSelfSigned !== !!currentServer.trustSelfSigned);
      const enabledChanged = 'enabled' in updates && !!updates.enabled !== !!currentServer.enabled;

      if (enabledChanged && !updatedServer.enabled) {
        // Server was disabled: end its session and hide its hosts
        await this.disconnect(serverId);
        this.resetServerState(serverId);
      } else if (connectionChanged || enabledChanged) {
        // Server address, credentials or enabled state changed: start over with a new client
        this.resetServerState(serverId);
        if (updatedServer.enabled) {
          this.createClient(updatedServer);
          await this.connect(serverId);
        }
      }

      this.emitEvent({ type: 'server-updated', serverId, data: updatedServer });
    } catch (error) {
      log.error('Failed to update server:', error);
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

      const warpgateConfig = this.config.store.warpgate;
      const servers = warpgateConfig.servers;
      const index = servers.findIndex((s: WarpgateServerConfig) => s.id === serverId);

      if (index !== -1) {
        // Remove from proxy array using splice
        servers.splice(index, 1);

        // Forget pinned hosts of the removed server
        const pinnedHosts: string[] = warpgateConfig.pinnedHosts || [];
        if (pinnedHosts.some(key => key.startsWith(`${serverId}:`))) {
          warpgateConfig.pinnedHosts = pinnedHosts.filter(key => !key.startsWith(`${serverId}:`));
        }

        log.debug('Removed server, total servers:', servers.length);
        this.config.save();
      }

      // Clean up client, session and cached data
      this.resetServerState(serverId);
      this.emitEvent({ type: 'server-removed', serverId });
    } catch (error) {
      log.error('Failed to remove server:', error);
    }
  }

  /**
   * Forget all runtime state of a server (client, session, targets, tickets)
   */
  private resetServerState(serverId: string): void {
    this.clients.delete(serverId);
    this.sessions.delete(serverId);
    this.serverInfo.delete(serverId);
    this.ticketsUnavailable.delete(serverId);
    this.ticketListingDenied.delete(serverId);
    this.clearServerTickets(serverId);

    const targets = this.targetsSubject.getValue();
    if (targets.delete(serverId)) {
      this.targetsSubject.next(new Map(targets));
    }

    if (this.connectionStatus.delete(serverId)) {
      this.updateStatusSubject();
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
    // Prevent concurrent connection attempts - return existing promise if connecting
    const existingLock = this.connectingLocks.get(serverId);
    if (existingLock) {
      log.debug(`Connection already in progress for ${serverId}, waiting...`);
      return existingLock;
    }

    const server = this.getServer(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    let client = this.clients.get(serverId);
    if (!client) {
      client = this.createClient(server);
    }

    // Create lock for this connection attempt
    const connectPromise = this.doConnect(serverId, server, client);
    this.connectingLocks.set(serverId, connectPromise);

    try {
      return await connectPromise;
    } finally {
      this.connectingLocks.delete(serverId);
    }
  }

  /**
   * Wait for a server connection without retrying servers that already failed
   * Connects servers that were never attempted and waits for attempts in progress
   */
  async ensureConnected(serverId: string): Promise<boolean> {
    if (this.isConnected(serverId)) {
      return true;
    }
    const inProgress = this.connectingLocks.get(serverId);
    if (inProgress) {
      return inProgress;
    }
    if (this.connectionStatus.has(serverId)) {
      return false;
    }
    try {
      return await this.connect(serverId);
    } catch {
      return false;
    }
  }

  /**
   * Internal connection implementation
   */
  private async doConnect(
    serverId: string,
    server: WarpgateServerConfig,
    client: WarpgateApiClient
  ): Promise<boolean> {
    this.beginLoading();

    try {
      // Reuse the existing web session when it is still valid
      const existingSession = this.sessions.get(serverId);
      if (existingSession && new Date(existingSession.expiresAt) > new Date()) {
        client.setSessionCookie(existingSession.cookie);
        if (await client.isSessionValid()) {
          const loaded = await this.loadTargets(serverId, client);
          if (loaded.success) {
            this.updateConnectionStatus(serverId, true);
            return true;
          }
        }
        this.sessions.delete(serverId);
      }

      const auth = await this.authenticateServer(serverId, server, client, true);
      if (!auth.success) {
        this.updateConnectionStatus(serverId, false, auth.error);
        this.showNotification('error', `Failed to connect to ${server.name}: ${auth.error}`);
        return false;
      }

      // A fresh login may come with different permissions, check ticket support again
      this.ticketsUnavailable.delete(serverId);
      this.ticketListingDenied.delete(serverId);

      // Update server last connected time
      await this.updateServer(serverId, { lastConnected: new Date() });

      // Fetch targets
      const loaded = await this.loadTargets(serverId, client);
      if (!loaded.success) {
        const error = loaded.error || 'Failed to load targets';
        this.updateConnectionStatus(serverId, false, error);
        this.showNotification('error', `Failed to load hosts from ${server.name}: ${error}`);
        return false;
      }

      this.updateConnectionStatus(serverId, true);
      this.showNotification('info', `Connected to ${server.name}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      this.updateConnectionStatus(serverId, false, errorMessage);
      this.showNotification('error', `Error connecting to ${server.name}: ${errorMessage}`);
      return false;
    } finally {
      this.endLoading();
    }
  }

  /**
   * Log in to a server, serializing concurrent attempts for the same server
   * @param interactive Whether the user may be prompted for an OTP code
   */
  private authenticateServer(
    serverId: string,
    server: WarpgateServerConfig,
    client: WarpgateApiClient,
    interactive: boolean
  ): Promise<AuthResult> {
    const existing = this.authLocks.get(serverId);
    if (existing) {
      return existing;
    }

    const attempt = this.authenticate(server, client, interactive).finally(() => {
      this.authLocks.delete(serverId);
    });
    this.authLocks.set(serverId, attempt);
    return attempt;
  }

  /**
   * Log in with the server's stored credentials (and OTP when required)
   */
  private async authenticate(
    server: WarpgateServerConfig,
    client: WarpgateApiClient,
    interactive: boolean
  ): Promise<AuthResult> {
    if (!server.password) {
      return { success: false, error: 'No password configured' };
    }

    // Start from a clean session so stale cookies do not interfere with the login
    client.setSessionCookie(null);

    const loginResult = await client.login({
      username: server.username,
      password: server.password,
    });

    if (!loginResult.success || !loginResult.data?.state) {
      return { success: false, error: loginResult.error?.message || 'Authentication failed' };
    }

    let auth: WarpgateAuthState['auth'] | undefined = loginResult.data.state.auth;

    // Check if OTP is required
    if (auth?.state === 'Need' && auth.methods_remaining?.includes('Otp')) {
      // Try to generate OTP from stored secret
      let otpCode = await this.generateOtpCode(server.id);

      if (!otpCode && interactive) {
        // No OTP secret configured - prompt user
        otpCode = await this.promptForOtp(server.name);
      }

      if (!otpCode) {
        return { success: false, error: 'OTP required but not provided' };
      }

      const otpResult = await client.submitOtp(otpCode);
      auth = otpResult.data?.state?.auth;
      if (!otpResult.success || auth?.state !== 'Accepted') {
        const reason = otpResult.error?.message || auth?.reason || 'invalid code';
        return { success: false, error: `OTP verification failed: ${reason}` };
      }
    }

    if (auth?.state !== 'Accepted') {
      return { success: false, error: this.describeAuthFailure(auth) };
    }

    // Authentication complete - store session
    this.sessions.set(server.id, {
      serverId: server.id,
      cookie: client.getSessionCookie() || '',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      username: server.username,
    });

    return { success: true };
  }

  /**
   * Describe why a login did not complete
   */
  private describeAuthFailure(auth: WarpgateAuthState['auth'] | undefined): string {
    if (!auth) {
      return 'Authentication failed';
    }
    if (auth.state === 'Rejected') {
      return auth.reason || 'Invalid credentials';
    }
    if (auth.state === 'Need') {
      const methods = auth.methods_remaining ?? [];
      if (methods.includes('Password')) {
        return 'Invalid credentials';
      }
      if (methods.length > 0) {
        return `Additional authentication required (${methods.join(', ')}), which this plugin does not support`;
      }
    }
    return 'Authentication incomplete';
  }

  /**
   * Log in again after the web session expired
   * @returns true when a new session was established
   */
  private async reauthenticate(serverId: string, interactive: boolean): Promise<boolean> {
    const server = this.getServer(serverId);
    const client = this.clients.get(serverId);
    if (!server || !client) {
      return false;
    }

    log.debug(`Session for ${server.name} expired, logging in again`);
    this.sessions.delete(serverId);

    const auth = await this.authenticateServer(serverId, server, client, interactive);
    if (!auth.success) {
      this.updateConnectionStatus(serverId, false, `Session expired: ${auth.error}`);
      return false;
    }
    return true;
  }

  /**
   * Run an API call, logging in again once if the web session expired
   */
  private async callWithReauth<T>(
    serverId: string,
    call: (client: WarpgateApiClient) => Promise<ApiResponse<T>>,
    interactive: boolean
  ): Promise<ApiResponse<T>> {
    const client = this.clients.get(serverId);
    if (!client) {
      return { success: false, error: { status: 0, message: 'Server not connected' } };
    }

    const result = await call(client);
    if (result.success || result.error?.status !== 401) {
      return result;
    }

    // Warpgate also answers 401 when the user lacks a permission (e.g. creating tickets
    // as a non-admin), only log in again when the session itself is gone
    if (await client.isSessionValid()) {
      return result;
    }

    if (!(await this.reauthenticate(serverId, interactive))) {
      return result;
    }
    return call(client);
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
  }

  /**
   * Connect to all enabled servers
   */
  async connectAll(): Promise<void> {
    const servers = this.getServers().filter(s => s.enabled);
    await Promise.allSettled(servers.map(s => this.connect(s.id)));
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.clients.keys());
    await Promise.allSettled(serverIds.map(id => this.disconnect(id)));
  }

  /**
   * Load targets and server info for a server
   */
  private async loadTargets(serverId: string, client: WarpgateApiClient): Promise<LoadTargetsResult> {
    let targetsResult = await client.getSshTargets();
    const infoResult = await client.getUserInfo();

    // Store server info (includes external_host and the SSH port)
    if (infoResult.success && infoResult.data) {
      this.serverInfo.set(serverId, infoResult.data);
    }

    // If targets fetch failed with 401, retry once after a short delay
    // This handles a race condition where the session might not be fully ready
    if (!targetsResult.success && targetsResult.error?.status === 401) {
      log.debug('Targets fetch returned 401, retrying after delay...');
      await new Promise(resolve => setTimeout(resolve, 500));
      targetsResult = await client.getSshTargets();
    }

    if (!targetsResult.success || !targetsResult.data) {
      log.error('Failed to fetch targets:', targetsResult.error?.message);
      return {
        success: false,
        targets: [],
        status: targetsResult.error?.status,
        error: targetsResult.error?.message,
      };
    }

    // Ignore results for servers removed while the request was running
    if (!this.getServer(serverId)) {
      return { success: true, targets: targetsResult.data };
    }

    const currentTargets = this.targetsSubject.getValue();
    currentTargets.set(serverId, targetsResult.data);
    this.targetsSubject.next(new Map(currentTargets));

    // Update connection status with targets
    const status = this.connectionStatus.get(serverId);
    if (status) {
      status.targets = targetsResult.data;
      this.updateStatusSubject();
    }

    this.emitEvent({ type: 'targets-updated', serverId, data: targetsResult.data });
    return { success: true, targets: targetsResult.data };
  }

  /**
   * Load targets, logging in again once if the web session expired
   */
  private async loadTargetsWithReauth(serverId: string, interactive: boolean): Promise<LoadTargetsResult> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`No client for server ${serverId}`);
    }

    const result = await this.loadTargets(serverId, client);
    if (result.success || result.status !== 401) {
      return result;
    }

    if (!(await this.reauthenticate(serverId, interactive))) {
      return result;
    }
    return this.loadTargets(serverId, client);
  }

  /**
   * Refresh targets for a server
   */
  async refreshTargets(serverId: string): Promise<WarpgateTarget[]> {
    const result = await this.loadTargetsWithReauth(serverId, false);
    return result.targets;
  }

  /**
   * Refresh targets for all connected servers
   * Also cleans up used tickets in the background
   */
  async refreshAllTargets(): Promise<void> {
    const connectedServers = Array.from(this.connectionStatus.entries())
      .filter(([, status]) => status.connected)
      .map(([serverId]) => serverId);

    await Promise.allSettled(connectedServers.map(id => this.refreshTargets(id)));

    // Clean up used tickets in the background (non-blocking)
    this.cleanupAllUsedTickets().catch(error => {
      log.debug('Background ticket cleanup error:', error);
    });
  }

  /**
   * Get all targets across all servers
   */
  getAllTargets(): Array<{ server: WarpgateServerConfig; target: WarpgateTarget }> {
    const result: Array<{ server: WarpgateServerConfig; target: WarpgateTarget }> = [];
    const targets = this.targetsSubject.getValue();

    for (const [serverId, serverTargets] of targets) {
      const server = this.getServer(serverId);
      if (server && server.enabled) {
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
   * Find a target of a server by name
   */
  getTarget(serverId: string, targetName: string): WarpgateTarget | undefined {
    return this.getServerTargets(serverId).find(target => target.name === targetName);
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
   * Get the SSH endpoint of a Warpgate server
   * Prefers the external host and SSH port reported by the server
   */
  getSshEndpoint(serverId: string): WarpgateSshEndpoint | null {
    const client = this.clients.get(serverId);
    if (!client) {
      return null;
    }

    const info = this.serverInfo.get(serverId);
    const reportedPort = info?.ports?.ssh || null;
    const externalHost = info?.external_host?.trim();

    if (externalHost) {
      // external_host may be "host", "host:port", "[ipv6]" or "[ipv6]:port"
      const bracketed = externalHost.match(/^\[(.+)\](?::(\d+))?$/);
      if (bracketed) {
        const port = reportedPort || (bracketed[2] ? parseInt(bracketed[2], 10) : client.getSshPort());
        return { host: bracketed[1], port };
      }

      const parts = externalHost.split(':');
      if (parts.length === 2 && /^\d+$/.test(parts[1])) {
        return { host: parts[0], port: reportedPort || parseInt(parts[1], 10) };
      }

      return { host: externalHost, port: reportedPort || client.getSshPort() };
    }

    // No external_host, use Warpgate server details
    return { host: client.getSshHost(), port: reportedPort || client.getSshPort() };
  }

  /**
   * Get SSH connection details for a target using password authentication
   * One-time tickets are never included here; they are created for each connection
   * by getOrCreateTicket so they cannot be reused after being consumed
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
    const endpoint = this.getSshEndpoint(serverId);

    if (!server || !endpoint) {
      log.debug('getSshConnectionDetails: server or client not found');
      return null;
    }

    return {
      host: endpoint.host,
      port: endpoint.port,
      username: `${server.username}:${targetName}`,
      password: server.password,
      useTicket: false,
      hasOtpSecret: this.hasOtpSecret(serverId),
    };
  }

  /**
   * Create a one-time ticket for one-click SSH access
   * Every call creates its own ticket: a ticket can only be used by one connection,
   * so panes connecting to the same target at the same time must not share one
   * Returns null when a ticket could not be created (e.g. missing admin permissions)
   */
  async getOrCreateTicket(
    serverId: string,
    targetName: string
  ): Promise<WarpgateTicketConnectionDetails | null> {
    const server = this.getServer(serverId);
    if (!server || !this.clients.has(serverId)) {
      log.debug('getOrCreateTicket: server or client not found');
      return null;
    }

    return this.doCreateTicket(serverId, targetName, server);
  }

  /**
   * Internal ticket creation implementation
   */
  private async doCreateTicket(
    serverId: string,
    targetName: string,
    server: WarpgateServerConfig
  ): Promise<WarpgateTicketConnectionDetails | null> {
    if (this.ticketsUnavailable.has(serverId)) {
      log.debug(`Tickets are not available on ${server.name}, skipping ticket creation`);
      return null;
    }

    const request: WarpgateTicketRequest = {
      username: server.username,
      target_name: targetName,
      number_of_uses: 1, // One-time use
      expiry: new Date(Date.now() + TICKET_TTL_MS).toISOString(),
      description: `${PLUGIN_TICKET_DESCRIPTION_PREFIX} ticket for ${targetName}`,
    };

    log.debug(`Creating new ticket for ${targetName}`);
    const result = await this.callWithReauth(serverId, client => client.createTicket(request), true);

    const client = this.clients.get(serverId);
    const endpoint = this.getSshEndpoint(serverId);
    if (result.success && result.data?.secret && client && endpoint) {
      const secret = result.data.secret;
      this.ticketCache.set(secret, {
        serverId,
        targetName,
        secret,
        expiresAt: result.data.ticket?.expiry ? new Date(result.data.ticket.expiry) : null,
        usesLeft: result.data.ticket?.uses_left ?? 1,
      });
      this.unusedTicketSecrets.add(secret);

      log.debug(`Ticket created for ${targetName}`);
      return {
        host: endpoint.host,
        port: endpoint.port,
        username: client.generateTicketUsername(secret),
      };
    }

    const status = result.error?.status;
    const reason = result.error?.message || 'Unknown error';
    const fallbackAllowed = this.getConfig().authMethod !== 'ticket';
    log.debug(`Ticket creation failed (${status}): ${reason}`);

    if (status === 401 || status === 403) {
      // Ticket creation needs admin permissions, do not try again until the next login
      this.ticketsUnavailable.add(serverId);
      if (fallbackAllowed) {
        this.showNotification(
          'warning',
          `Tickets are not available on ${server.name} (admin permissions required), using password authentication`
        );
      }
    } else if (fallbackAllowed) {
      this.showNotification(
        'warning',
        `Could not create ticket for ${targetName}, using password authentication: ${reason}`
      );
    }

    return null;
  }

  /**
   * Mark a ticket created by this plugin as used for a connection
   * @param username SSH username of the connection (ticket-<secret>)
   * @returns true if the ticket had not been used before
   */
  claimUnusedTicket(username: string): boolean {
    if (!username.startsWith('ticket-')) {
      return false;
    }
    const secret = username.slice('ticket-'.length);
    if (!this.unusedTicketSecrets.has(secret)) {
      return false;
    }
    this.unusedTicketSecrets.delete(secret);
    this.ticketCache.delete(secret);
    return true;
  }

  /**
   * Get credentials for a new SSH connection to a target
   * Creates a fresh one-time ticket when tickets are enabled; falls back to password
   * credentials when no ticket can be created (unless ticket-only mode is enabled)
   * @returns null when no usable credentials are available
   */
  async getConnectionCredentials(
    serverId: string,
    targetName: string
  ): Promise<{
    host: string;
    port: number;
    username: string;
    auth: 'password' | null;
    password: string | null;
    useTicket: boolean;
  } | null> {
    await this.ensureConnected(serverId);

    const authMethod = this.getConfig().authMethod || 'auto';
    if (authMethod !== 'password') {
      let ticket: WarpgateTicketConnectionDetails | null = null;
      try {
        ticket = await this.getOrCreateTicket(serverId, targetName);
      } catch (error) {
        log.debug('Ticket creation threw error:', error);
      }

      if (ticket) {
        // The ticket belongs to the connection that asked for it
        this.claimUnusedTicket(ticket.username);
        return { ...ticket, auth: 'password', password: 'x', useTicket: true };
      }

      if (authMethod === 'ticket') {
        this.showNotification('error', `Cannot connect to ${targetName}: ${this.describeTicketOnlyFailure(serverId)}`);
        return null;
      }
    }

    const details = this.getSshConnectionDetails(serverId, targetName);
    if (!details) {
      return null;
    }
    return {
      host: details.host,
      port: details.port,
      username: details.username,
      auth: null,
      password: details.password ?? null,
      useTicket: false,
    };
  }

  /**
   * Explain why a connection failed in ticket-only mode and what to do about it
   */
  describeTicketOnlyFailure(serverId: string): string {
    const server = this.getServer(serverId);
    if (server && this.ticketsUnavailable.has(serverId)) {
      return `"${server.username}" is not allowed to create tickets on ${server.name}. ` +
        'Set Authentication to "Automatic" in Settings → Warpgate to log in with your password instead.';
    }
    return 'No ticket could be created and Authentication is set to "Tickets only".';
  }

  /**
   * Check whether tickets are known to be unavailable for a server
   */
  areTicketsUnavailable(serverId: string): boolean {
    return this.ticketsUnavailable.has(serverId);
  }

  /**
   * Invalidate a cached ticket (call after use for one-time tickets)
   */
  invalidateTicket(serverId: string, targetName: string): void {
    for (const ticket of this.ticketCache.values()) {
      if (ticket.serverId !== serverId || ticket.targetName !== targetName) {
        continue;
      }
      if (ticket.usesLeft > 0) {
        ticket.usesLeft--;
      }
      if (ticket.usesLeft === 0) {
        this.ticketCache.delete(ticket.secret);
        this.unusedTicketSecrets.delete(ticket.secret);
      }
      return;
    }
  }

  /**
   * Clear all cached tickets for a server
   */
  clearServerTickets(serverId: string): void {
    for (const ticket of [...this.ticketCache.values()]) {
      if (ticket.serverId === serverId) {
        this.ticketCache.delete(ticket.secret);
        this.unusedTicketSecrets.delete(ticket.secret);
      }
    }
  }

  /**
   * Clean up tickets created by this plugin on the Warpgate server
   * Deletes tickets that:
   * 1. Were created by this plugin (description starts with "Tabby Warpgate auto-generated")
   * 2. Are fully used (uses_left === 0) or expired
   * @param serverId Server ID to clean up tickets for
   * @returns Number of tickets deleted
   */
  async cleanupUsedTickets(serverId: string): Promise<number> {
    const client = this.clients.get(serverId);
    if (!client || this.ticketsUnavailable.has(serverId) || this.ticketListingDenied.has(serverId)) {
      return 0;
    }

    try {
      // List all tickets from the admin API
      const listResult = await this.callWithReauth(serverId, c => c.listTickets(), false);
      if (!listResult.success || !listResult.data) {
        log.debug('Failed to list tickets for cleanup:', listResult.error?.message);
        const status = listResult.error?.status;
        if (status === 401 || status === 403) {
          // Not permitted for this user, do not ask again until the next login
          this.ticketListingDenied.add(serverId);
        }
        return 0;
      }

      const now = Date.now();
      const ticketsToDelete = listResult.data.filter(ticket => {
        if (!ticket.description?.startsWith(PLUGIN_TICKET_DESCRIPTION_PREFIX)) {
          return false;
        }
        const expired = !!ticket.expiry && Date.parse(ticket.expiry) <= now;
        return ticket.uses_left === 0 || expired;
      });

      if (ticketsToDelete.length === 0) {
        return 0;
      }

      log.debug(`Found ${ticketsToDelete.length} used tickets to clean up on server ${serverId}`);

      // Delete each used ticket
      let deletedCount = 0;
      for (const ticket of ticketsToDelete) {
        try {
          const deleteResult = await client.deleteTicket(ticket.id);
          if (deleteResult.success) {
            deletedCount++;
          } else {
            log.debug(`Failed to delete ticket ${ticket.id}:`, deleteResult.error?.message);
          }
        } catch (error) {
          log.debug(`Error deleting ticket ${ticket.id}:`, error);
        }
      }

      return deletedCount;
    } catch (error) {
      log.error(`Error during ticket cleanup for server ${serverId}:`, error);
      return 0;
    }
  }

  /**
   * Clean up used tickets on all connected servers
   * @returns Total number of tickets deleted across all servers
   */
  async cleanupAllUsedTickets(): Promise<number> {
    const connectedServers = Array.from(this.connectionStatus.entries())
      .filter(([, status]) => status.connected)
      .map(([serverId]) => serverId);

    let totalDeleted = 0;
    for (const serverId of connectedServers) {
      totalDeleted += await this.cleanupUsedTickets(serverId);
    }

    if (totalDeleted > 0) {
      log.debug(`Total tickets cleaned up: ${totalDeleted}`);
    }

    return totalDeleted;
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
      log.debug(`No valid OTP secret for server ${serverId}`);
      return null;
    }

    try {
      return await generateTOTP(server.otpSecret);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.showNotification('error', `Failed to generate OTP: ${errorMessage}`);
      log.error('TOTP generation failed:', errorMessage);
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
   * Get full authentication credentials for a password-based SSH connection
   * Includes the password and a fresh OTP code for keyboard-interactive auth
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
    if (!this.clients.has(serverId)) {
      return { success: false, error: 'Server not connected' };
    }

    try {
      // Check if OTP is already set up on Warpgate
      const existing = await this.callWithReauth(serverId, c => c.getProfileOtpCredentialIds(), true);
      if (!existing.success) {
        return { success: false, error: existing.error?.message || 'Failed to read OTP credentials' };
      }

      if ((existing.data?.length ?? 0) > 0) {
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
      const result = await this.callWithReauth(serverId, c => c.autoSetupOtp(), true);

      if (result.success && result.data) {
        // Store the secret locally
        await this.setOtpSecret(serverId, result.data.secret);

        this.showNotification('info', 'OTP has been automatically configured for this server');

        return {
          success: true,
          secret: result.data.secret,
        };
      }

      return {
        success: false,
        error: result.error?.message || 'Failed to set up OTP',
      };
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
    if (!this.clients.has(serverId)) {
      return false;
    }

    try {
      const result = await this.callWithReauth(serverId, c => c.getProfileOtpCredentialIds(), false);
      return !!(result.success && result.data && result.data.length > 0);
    } catch {
      return false;
    }
  }

  /**
   * Disable OTP on both Warpgate and locally
   * The local secret is only removed once all OTP credentials were removed from Warpgate
   * @param serverId Server ID
   */
  async disableOtp(serverId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.clients.has(serverId)) {
      return { success: false, error: 'Server not connected' };
    }

    try {
      // Get current OTP credentials
      const credentials = await this.callWithReauth(serverId, c => c.getProfileOtpCredentialIds(), true);
      if (!credentials.success) {
        return { success: false, error: credentials.error?.message || 'Failed to read OTP credentials' };
      }

      // Disable each OTP credential on Warpgate
      for (const credentialId of credentials.data ?? []) {
        const result = await this.callWithReauth(serverId, c => c.disableProfileOtp(credentialId), true);
        if (!result.success) {
          return { success: false, error: result.error?.message || 'Failed to disable OTP on Warpgate' };
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
   * Start (or restart) the auto-refresh timer using the configured interval
   */
  private startAutoRefresh(): void {
    this.stopAutoRefresh();

    const intervalMs = Number(this.getConfig().autoRefreshInterval) || 0;
    if (intervalMs > 0) {
      this.refreshIntervalMs = intervalMs;
      this.refreshSubscription = interval(intervalMs).subscribe(() => {
        this.refreshAllTargets().catch(error => {
          log.debug('Auto-refresh failed:', error);
        });
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
    this.refreshIntervalMs = 0;
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
      targets: currentStatus?.targets || this.getServerTargets(serverId),
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
   * Track the start of a connection attempt for the loading indicator
   */
  private beginLoading(): void {
    this.pendingConnections++;
    if (this.pendingConnections === 1) {
      this.loadingSubject.next(true);
    }
  }

  /**
   * Track the end of a connection attempt for the loading indicator
   */
  private endLoading(): void {
    this.pendingConnections = Math.max(0, this.pendingConnections - 1);
    if (this.pendingConnections === 0) {
      this.loadingSubject.next(false);
    }
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
    return `wg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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
   * @returns The entered code, or null if the dialog was cancelled
   */
  private async promptForOtp(serverName: string): Promise<string | null> {
    let modalRef: ReturnType<NgbModal['open']>;
    try {
      const modalService = this.injector.get(NgbModal);
      modalRef = modalService.open(WarpgateOtpModalComponent, {
        centered: true,
        keyboard: true,
        backdrop: 'static',
      });
      modalRef.componentInstance.serverName = serverName;
    } catch (error) {
      log.error('Failed to show OTP modal:', error);
      this.showNotification('error', 'Failed to show OTP input dialog');
      return null;
    }

    try {
      const result = await modalRef.result;
      return typeof result === 'string' && result.trim() ? result.trim() : null;
    } catch {
      // Dialog was dismissed by the user
      return null;
    }
  }

  /**
   * Key used to store a test connection client
   */
  private getTestClientKey(url: string, username: string): string {
    return `test:${url}:${username}`;
  }

  /**
   * Forget a test connection client and its cleanup timer
   */
  private disposeTestClient(clientKey: string): void {
    this.testClients.delete(clientKey);
    this.authenticatedTestClients.delete(clientKey);
    const timer = this.testClientTimers.get(clientKey);
    if (timer) {
      clearTimeout(timer);
      this.testClientTimers.delete(clientKey);
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
    const clientKey = this.getTestClientKey(url, username);
    let client = this.testClients.get(clientKey);

    if (!client) {
      client = new WarpgateApiClient(url, trustSelfSigned);
      this.testClients.set(clientKey, client);

      // Schedule cleanup if not used
      const timer = setTimeout(() => {
        this.testClients.delete(clientKey);
        this.testClientTimers.delete(clientKey);
        this.authenticatedTestClients.delete(clientKey);
        log.debug('Cleaned up unused test session');
      }, TEST_SESSION_TTL_MS);
      this.testClientTimers.set(clientKey, timer);
    }

    // A new login replaces any previous session of this test client
    this.authenticatedTestClients.delete(clientKey);

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
            if (otpResult.success && otpResult.data?.state?.auth?.state === 'Accepted') {
              // DON'T logout - keep session for reuse
              this.authenticatedTestClients.add(clientKey);
              const sessionCookie = client.getSessionCookie();
              log.debug('Test connection successful, session preserved');
              return { success: true, sessionCookie: sessionCookie || undefined };
            }
            return {
              success: false,
              error: otpResult.error?.message || otpResult.data?.state?.auth?.reason || 'OTP verification failed',
            };
          }

          // OTP required but not provided
          return { success: false, needsOtp: true };
        }

        // Check if authentication was accepted
        if (authState.auth?.state === 'Accepted') {
          // DON'T logout - keep session for reuse
          this.authenticatedTestClients.add(clientKey);
          const sessionCookie = client.getSessionCookie();
          log.debug('Test connection successful, session preserved');
          return { success: true, sessionCookie: sessionCookie || undefined };
        }

        return { success: false, error: this.describeAuthFailure(authState.auth) };
      }

      this.disposeTestClient(clientKey);
      return {
        success: false,
        error: result.error?.message || 'Authentication failed',
      };
    } catch (error) {
      this.disposeTestClient(clientKey);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Submit OTP for a test connection that's waiting for OTP
   * Keeps the authenticated session so it can be reused when the server is added
   */
  async testServerConnectionWithOtp(
    url: string,
    username: string,
    otpCode: string
  ): Promise<{ success: boolean; error?: string }> {
    const clientKey = this.getTestClientKey(url, username);
    const client = this.testClients.get(clientKey);

    if (!client) {
      return { success: false, error: 'No pending authentication. Please test connection again.' };
    }

    try {
      const otpResult = await client.submitOtp(otpCode);

      if (otpResult.success && otpResult.data?.state) {
        const authState = otpResult.data.state.auth;
        if (authState?.state === 'Accepted') {
          this.authenticatedTestClients.add(clientKey);
          return { success: true };
        }
        return { success: false, error: this.describeAuthFailure(authState) };
      }

      return { success: false, error: otpResult.error?.message || 'OTP verification failed' };
    } catch (error) {
      this.disposeTestClient(clientKey);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OTP submission failed',
      };
    }
  }

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
    this.authenticatedTestClients.clear();
  }
}
