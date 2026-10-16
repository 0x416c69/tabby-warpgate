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
export type TargetKind = 'Ssh' | 'Http' | 'MySql' | 'Postgres' | 'Kubernetes' | 'WebAdmin';

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
  /** Logged in username, null when the session is not authenticated */
  username: string | null;
  version?: string | null;
  external_host?: string | null;
  /** External ports; only reported for authenticated sessions */
  ports?: {
    ssh?: number | null;
    http?: number | null;
    mysql?: number | null;
    postgres?: number | null;
  };
  selected_target?: string | null;
  authorized_via_ticket?: boolean;
  authorized_via_sso_with_single_logout?: boolean;
  own_credential_management_allowed?: boolean;
  setup_state?: {
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
    /** Human readable reason when the state is Rejected */
    reason?: string;
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

/** SSH session options that can be set per server and overridden per host */
export interface WarpgateSshSessionOptions {
  /** Forward the local SSH agent to the host */
  agentForward?: boolean;
  /** Forward X11 connections */
  x11?: boolean;
  /** Keepalive interval in milliseconds (0 disables keepalives) */
  keepaliveInterval?: number;
}

/** Warpgate server configuration stored by the plugin */
export interface WarpgateServerConfig extends WarpgateSshSessionOptions {
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

/** Port forwarding rule types (same as Tabby's) */
export type WarpgatePortForwardType = 'Local' | 'Remote' | 'Dynamic';

/** Port forwarding rule for a host */
export interface WarpgatePortForward {
  type: WarpgatePortForwardType;
  /** Address to listen on */
  host: string;
  /** Port to listen on */
  port: number;
  /** Destination address (not used for dynamic forwards) */
  targetAddress: string;
  /** Destination port (not used for dynamic forwards) */
  targetPort: number;
  description?: string;
}

/** Per-host customization, keyed by host key ("serverId:targetName") */
export interface WarpgateHostSettings extends WarpgateSshSessionOptions {
  /** Display name used instead of the target name */
  alias?: string;
  tags?: string[];
  notes?: string;
  /** Custom accent color (CSS color) */
  color?: string;
  /** Snippet sent to the shell after connecting */
  startupSnippetId?: string;
  forwardedPorts?: WarpgatePortForward[];
}

/** Saved command snippet */
export interface WarpgateSnippet {
  id: string;
  name: string;
  /** Commands to send; multiple lines are sent as typed */
  script: string;
  description?: string;
  tags?: string[];
}

/** Operating system detected on a host */
export interface WarpgateHostOs {
  /** Normalized identifier used for the icon, e.g. "ubuntu", "debian", "macos", "windows", "linux" */
  id: string;
  /** Short name, e.g. "Ubuntu 24.04" */
  label: string;
  /** Full name, e.g. "Ubuntu 24.04.1 LTS" */
  name: string;
  /** When the operating system was detected (ms since epoch) */
  detectedAt: number;
}

/** Connection history entry (one per host, most recent first) */
export interface WarpgateHistoryEntry {
  serverId: string;
  targetName: string;
  /** ISO timestamp of the last connection */
  lastConnectedAt: string;
  /** Number of connections */
  count: number;
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
  sortBy: 'name' | 'server' | 'kind' | 'group' | 'recent';
  /** Preferred authentication method: ticket (one-time tickets), password (keyboard-interactive), or auto (try ticket first) */
  authMethod: WarpgateAuthMethod;
  /** Enable debug logging to console */
  debugMode: boolean;
  /** Pinned host keys (format: "serverId:targetName") */
  pinnedHosts: string[];
  /** View mode for hosts panel */
  viewMode: HostsViewMode;
  /** Per-host customization by host key ("serverId:targetName") */
  hostSettings: Record<string, WarpgateHostSettings>;
  /** Saved snippets */
  snippets: WarpgateSnippet[];
  /** Connection history, most recent first */
  history: WarpgateHistoryEntry[];
  /** Detect the operating system of hosts after connecting (shown as host icon) */
  detectOs: boolean;
  /** Detected operating systems by host key ("serverId:targetName") */
  hostOs: Record<string, WarpgateHostOs>;
}

/** Maximum number of hosts kept in the connection history */
export const MAX_HISTORY_ENTRIES = 50;

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
  hostSettings: {},
  snippets: [],
  history: [],
  detectOs: true,
  hostOs: {},
};

/**
 * Build the key that identifies a host across the plugin ("serverId:targetName")
 */
export function getHostKey(serverId: string, targetName: string): string {
  return `${serverId}:${targetName}`;
}

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
  /** Remaining uses (null for unlimited, 0 means used up) */
  uses_left?: number | null;
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

/** User's own credential state from profile API (GET /profile/credentials) */
export interface WarpgateProfileCredentials {
  /** Password state ("Unset", "Set" or "MultipleSet") */
  password?: string;
  /** Registered OTP credentials */
  otp: WarpgateOtpCredential[];
  /** Registered public keys */
  public_keys?: Array<{ id: string }>;
}

/** Response when enabling OTP via profile API */
export interface WarpgateOtpEnableResponse {
  /** The credential ID */
  id: string;
}

/** Request to enable OTP via profile API */
export interface WarpgateOtpEnableRequest {
  /** Raw (Base32-decoded) TOTP secret bytes */
  secret_key: number[];
}
