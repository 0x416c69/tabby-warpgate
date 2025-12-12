/**
 * Warpgate API Models
 * These types represent the data structures used by the Warpgate API
 */

/** Bootstrap theme colors supported by Warpgate */
export type BootstrapThemeColor =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'light'
  | 'dark';

/** Target kinds supported by Warpgate */
export type TargetKind = 'Ssh' | 'Http' | 'MySql' | 'WebAdmin';

/** Group information for organizing targets */
export interface WarpgateGroup {
  id: string;
  name: string;
  color?: BootstrapThemeColor;
}

/** Target/host information from Warpgate API */
export interface WarpgateTarget {
  name: string;
  description: string;
  kind: TargetKind;
  external_host?: string;
  group?: WarpgateGroup;
}

/** Authentication state from Warpgate API */
export interface WarpgateAuthState {
  protocol: string;
  address: string;
  started: boolean;
  identification_string?: string;
  auth: {
    state: 'NotStarted' | 'Progress' | 'Need' | 'Accepted' | 'Rejected';
    methods_remaining?: string[];
  };
}

/** Login request payload */
export interface WarpgateLoginRequest {
  username: string;
  password: string;
}

/** Login response */
export interface WarpgateLoginResponse {
  success: boolean;
  state?: WarpgateAuthState;
}

/** User info response */
export interface WarpgateUserInfo {
  username: string;
  roles: string[];
}

/** Warpgate server configuration stored by the plugin */
export interface WarpgateServerConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  password?: string;
  enabled: boolean;
  lastConnected?: Date;
  trustSelfSigned?: boolean;
}

/** Connection status for a Warpgate server */
export interface WarpgateConnectionStatus {
  serverId: string;
  connected: boolean;
  lastError?: string;
  lastChecked: Date;
  targets: WarpgateTarget[];
}

/** SSH connection options for Warpgate proxied connections */
export interface WarpgateSshOptions {
  targetName: string;
  serverId: string;
  serverUrl: string;
  username: string;
}

/** Plugin configuration structure */
export interface WarpgatePluginConfig {
  servers: WarpgateServerConfig[];
  autoRefreshInterval: number;
  showOfflineServers: boolean;
  groupByServer: boolean;
  sortBy: 'name' | 'server' | 'kind' | 'group';
  defaultSftpPath: string;
}

/** Default plugin configuration */
export const DEFAULT_WARPGATE_CONFIG: WarpgatePluginConfig = {
  servers: [],
  autoRefreshInterval: 60000, // 1 minute
  showOfflineServers: true,
  groupByServer: true,
  sortBy: 'name',
  defaultSftpPath: '~',
};

/** API error response */
export interface WarpgateApiError {
  status: number;
  message: string;
  details?: string;
}

/** Cached session data */
export interface WarpgateSession {
  serverId: string;
  cookie: string;
  expiresAt: Date;
  username: string;
}

/** Request payload for creating a ticket */
export interface WarpgateTicketRequest {
  /** Username for the ticket */
  username: string;
  /** Target name to grant access to */
  target_name: string;
  /** Optional expiry date for the ticket */
  expiry?: string;
  /** Optional number of uses (default: 1 for one-time use) */
  number_of_uses?: number;
  /** Optional description for the ticket */
  description?: string;
}

/** Ticket information returned by the API */
export interface WarpgateTicket {
  /** Unique ticket ID */
  id: string;
  /** Username associated with the ticket */
  username: string;
  /** Target name the ticket grants access to */
  target_name: string;
  /** Ticket creation timestamp */
  created: string;
  /** Optional expiry timestamp */
  expiry?: string;
  /** Remaining uses (-1 for unlimited) */
  uses_left?: number;
  /** Description of the ticket */
  description?: string;
}

/** Response from creating a ticket - includes the secret */
export interface WarpgateTicketAndSecret {
  /** The ticket record */
  ticket: WarpgateTicket;
  /** The secret to use for authentication (only returned on creation) */
  secret: string;
}

/** Cached ticket for SSH connections */
export interface WarpgateCachedTicket {
  /** Server ID this ticket belongs to */
  serverId: string;
  /** Target name this ticket grants access to */
  targetName: string;
  /** The ticket secret for authentication */
  secret: string;
  /** When the ticket expires (null for non-expiring) */
  expiresAt: Date | null;
  /** Remaining uses (-1 for unlimited, 0 means expired) */
  usesLeft: number;
}
