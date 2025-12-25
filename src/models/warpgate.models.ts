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
  group?: WarpgateGroup;
}

/** Server info from Warpgate /api/info endpoint */
export interface WarpgateServerInfo {
  username: string;
  version: string;
  external_host?: string;
  ports: {
    ssh: number;
    http: number;
    mysql: number;
    postgres: number;
  };
  selected_target: string | null;
  authorized_via_ticket: boolean;
  authorized_via_sso_with_single_logout: boolean;
  own_credential_management_allowed: boolean;
  setup_state: {
    has_users: boolean;
    has_targets: boolean;
  };
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

/** User info response - same as ServerInfo */
export type WarpgateUserInfo = WarpgateServerInfo;

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
  /** Base32-encoded TOTP secret for automatic OTP generation (fallback auth) */
  otpSecret?: string;
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

/** Authentication method preference */
export type WarpgateAuthMethod = 'ticket' | 'password' | 'auto';

/** View mode for hosts panel */
export type HostsViewMode = 'grid' | 'compact';

/** Plugin configuration structure */
export interface WarpgatePluginConfig {
  servers: WarpgateServerConfig[];
  autoRefreshInterval: number;
  showOfflineServers: boolean;
  groupByServer: boolean;
  sortBy: 'name' | 'server' | 'kind' | 'group';
  /** Preferred authentication method: ticket (one-time tickets), password (keyboard-interactive), or auto (try ticket first) */
  authMethod: WarpgateAuthMethod;
  /** Enable debug logging to console */
  debugMode: boolean;
  /** Pinned host keys (format: "serverId:targetName") */
  pinnedHosts: string[];
  /** View mode for hosts panel */
  viewMode: HostsViewMode;
}

/** Default plugin configuration */
export const DEFAULT_WARPGATE_CONFIG: WarpgatePluginConfig = {
  servers: [],
  autoRefreshInterval: 60000, // 1 minute
  showOfflineServers: true,
  groupByServer: true,
  sortBy: 'name',
  authMethod: 'auto',
  debugMode: false,
  pinnedHosts: [],
  viewMode: 'grid',
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
  /** Target name the ticket grants access to (API returns 'target' not 'target_name') */
  target: string;
  /** Ticket creation timestamp */
  created: string;
  /** Optional expiry timestamp */
  expiry?: string | null;
  /** Remaining uses (-1 for unlimited, 0 means used up) */
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

/** OTP credential stored in Warpgate */
export interface WarpgateOtpCredential {
  /** Unique credential ID */
  id: string;
}

/** Request to create a new OTP credential */
export interface WarpgateOtpCredentialRequest {
  /** Base32-encoded TOTP secret key */
  secret_key: number[];
}

/** OTP credential with secret for local storage */
export interface WarpgateCachedOtpCredential {
  /** Server ID this OTP is for */
  serverId: string;
  /** User ID this OTP belongs to */
  userId: string;
  /** Credential ID in Warpgate */
  credentialId: string;
  /** Base32-encoded TOTP secret for generating codes */
  secret: string;
  /** When this was registered */
  registeredAt: Date;
}

/** User details from Warpgate API */
export interface WarpgateUser {
  /** Unique user ID */
  id: string;
  /** Username */
  username: string;
  /** User credential policy requirements */
  credential_policy?: {
    http?: string[];
    ssh?: string[];
    mysql?: string[];
  };
}

/** User's own credential state from profile API */
export interface WarpgateProfileCredentials {
  /** Whether user has a password set */
  password: boolean;
  /** List of OTP credential IDs */
  otp: string[];
  /** List of public key IDs */
  publicKeys: string[];
  /** Whether SSO is configured */
  sso: boolean;
}

/** Response when enabling OTP via profile API */
export interface WarpgateOtpEnableResponse {
  /** The credential ID */
  id: string;
  /** The TOTP secret (only returned once on creation) */
  secret: string;
  /** Provisioning URI for QR code (otpauth://...) */
  provisioning_uri?: string;
}

/** Request to enable OTP - includes the secret being registered */
export interface WarpgateOtpEnableRequest {
  /** Base32-encoded TOTP secret */
  secret: string;
}
