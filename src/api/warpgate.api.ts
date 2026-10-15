/**
 * Warpgate API Client
 * Handles all HTTP communication with Warpgate servers
 */

import {
  WarpgateTarget,
  WarpgateAuthState,
  WarpgateLoginRequest,
  WarpgateLoginResponse,
  WarpgateApiError,
  WarpgateUserInfo,
  WarpgateTicketRequest,
  WarpgateTicket,
  WarpgateTicketAndSecret,
  WarpgateOtpCredential,
  WarpgateUser,
  WarpgateProfileCredentials,
  WarpgateOtpEnableResponse,
} from '../models/warpgate.models';
import { base32Decode, generateTOTPSecret } from '../utils/totp';
import { createLogger } from '../utils/debug-logger';

const log = createLogger('API');

/** Default SSH port used by Warpgate */
export const DEFAULT_WARPGATE_SSH_PORT = 2222;

/** Maximum time to wait for a single HTTP request */
const REQUEST_TIMEOUT_MS = 30000;

/** HTTP methods supported by the API client */
type HttpMethod = 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';

/** Request options for the API client */
interface RequestOptions {
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  credentials?: RequestCredentials;
}

/** API response wrapper */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: WarpgateApiError;
}

/** Internal auth state mapped from a Warpgate ApiAuthState value */
type MappedAuthState = WarpgateAuthState['auth'];

/**
 * Split a Set-Cookie header value into individual cookies.
 * Multiple cookies may be separated by newlines (Node.js header arrays joined by us)
 * or by commas (Fetch API). Commas inside Expires dates are not treated as separators.
 */
export function splitSetCookieHeader(header: string): string[] {
  return header
    .split('\n')
    .flatMap(line => line.split(/,(?=\s*[^;,=\s]+=)/))
    .map(cookie => cookie.trim())
    .filter(Boolean);
}

/**
 * Warpgate API Client
 * Provides methods for interacting with Warpgate server REST API
 */
export class WarpgateApiClient {
  private baseUrl: string;
  private cookies = new Map<string, string>();
  private trustSelfSigned: boolean;

  constructor(serverUrl: string, trustSelfSigned = false) {
    // Normalize URL - remove trailing slash and ensure https
    this.baseUrl = serverUrl.replace(/\/+$/, '');
    if (!this.baseUrl.startsWith('http://') && !this.baseUrl.startsWith('https://')) {
      this.baseUrl = `https://${this.baseUrl}`;
    }
    this.trustSelfSigned = trustSelfSigned;
  }

  /**
   * Get the base URL for this client
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Set the session cookie(s) for authenticated requests
   * Accepts a Cookie header value ("name=value; other=value") or null to clear
   */
  setSessionCookie(cookie: string | null): void {
    this.cookies.clear();
    if (!cookie) {
      return;
    }
    for (const part of cookie.split(';')) {
      const separator = part.indexOf('=');
      if (separator <= 0) {
        continue;
      }
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (name) {
        this.cookies.set(name, value);
      }
    }
  }

  /**
   * Get the current session cookie(s) as a Cookie header value
   */
  getSessionCookie(): string | null {
    if (this.cookies.size === 0) {
      return null;
    }
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /**
   * Check if the client has an active session
   */
  hasSession(): boolean {
    return this.cookies.size > 0;
  }

  /**
   * Build fetch options shared by all requests
   */
  private buildFetchOptions(options: RequestOptions): RequestInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    const cookie = this.getSessionCookie();
    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const fetchOptions: RequestInit = {
      method: options.method,
      headers,
      credentials: options.credentials || 'include',
    };

    if (options.body && options.method !== 'GET') {
      fetchOptions.body = JSON.stringify(options.body);
    }

    return fetchOptions;
  }

  /**
   * Make an HTTP request to the Warpgate API
   * @param endpoint API endpoint path
   * @param options Request options
   * @param useAdminApi If true, use /@warpgate/admin/api instead of /@warpgate/api
   */
  private async request<T>(
    endpoint: string,
    options: RequestOptions = { method: 'GET' },
    useAdminApi = false
  ): Promise<ApiResponse<T>> {
    const apiPath = useAdminApi ? '/@warpgate/admin/api' : '/@warpgate/api';
    const url = `${this.baseUrl}${apiPath}${endpoint}`;

    try {
      const response = await this.performFetch(url, this.buildFetchOptions(options));
      this.storeResponseCookies(response);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}`;
        if (response.statusText) {
          errorMessage += `: ${response.statusText}`;
        }
        // Try to parse error details from response body
        if (errorText) {
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error || errorJson.message) {
              errorMessage = errorJson.error || errorJson.message;
            }
          } catch {
            // Not JSON, use raw text if short enough
            if (errorText.length < 200) {
              errorMessage += ` - ${errorText}`;
            }
          }
        }
        return {
          success: false,
          error: {
            status: response.status,
            message: errorMessage,
            details: errorText,
          },
        };
      }

      // Handle empty responses
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return { success: true };
      }

      const text = await response.text();
      if (!text) {
        return { success: true };
      }

      const data = JSON.parse(text) as T;
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: {
          status: 0,
          message: this.describeNetworkError(error),
        },
      };
    }
  }

  /**
   * Turn low level network errors into user friendly messages
   */
  private describeNetworkError(error: unknown): string {
    if (!(error instanceof Error)) {
      return 'Unknown error';
    }
    const message = error.message;
    if (message.includes('ECONNREFUSED')) {
      return 'Connection refused - server may be down or URL is incorrect';
    }
    if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
      return 'Server not found - check the URL';
    }
    if (message.includes('ETIMEDOUT') || message.includes('ESOCKETTIMEDOUT')) {
      return 'Connection timed out - server may be unreachable';
    }
    if (message.includes('CERT') || message.includes('certificate')) {
      return 'Certificate error - try enabling "Trust self-signed certificates"';
    }
    if (message.includes('ECONNRESET')) {
      return 'Connection reset - server closed the connection';
    }
    return message;
  }

  /**
   * Perform the actual fetch request
   * This method can be overridden in tests or for platform-specific implementations
   */
  protected async performFetch(url: string, options: RequestInit): Promise<Response> {
    // Always use Node.js fetch in Tabby Desktop to properly handle cookies
    // Browser/Electron fetch doesn't expose Set-Cookie headers
    try {
      // Check if we can use Node.js https module
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const https = require('https');
      if (https) {
        return this.nodeFetch(url, options);
      }
    } catch {
      // Not in Node.js environment
    }

    // Fallback to browser fetch (won't work properly for cookies)
    log.debug('Using browser fetch (cookies may not work)');
    return fetch(url, options);
  }

  /**
   * Node.js fetch implementation for Tabby Desktop
   */
  private async nodeFetch(url: string, options: RequestInit): Promise<Response> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http = require('http');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { URL } = require('url');

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const transport = isHttps ? https : http;

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers as Record<string, string>,
        rejectUnauthorized: !this.trustSelfSigned,
      };

      log.debug('HTTP request:', requestOptions.method, `${urlObj.origin}${urlObj.pathname}`);

      const req = transport.request(requestOptions, (res: NodeResponse) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');

          log.debug('HTTP response:', res.statusCode, `${urlObj.pathname}`, `${body.length} bytes`);

          // Create a Response-like object
          // Set-Cookie arrays are joined with newlines so individual cookies can be split reliably
          const responseHeaders = new Map<string, string>();
          Object.entries(res.headers).forEach(([key, value]) => {
            if (value) {
              const separator = key === 'set-cookie' ? '\n' : ', ';
              responseHeaders.set(key, Array.isArray(value) ? value.join(separator) : value);
            }
          });

          const response: Response = {
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: {
              get: (name: string) => responseHeaders.get(name.toLowerCase()) ?? null,
            } as Headers,
            text: async () => body,
            json: async () => JSON.parse(body),
          } as Response;

          resolve(response);
        });
        res.on('error', (err: Error) => {
          reject(new Error(`Network error: ${err.message}`));
        });
      });

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error('ETIMEDOUT: request timed out'));
      });

      req.on('error', (err: Error) => {
        reject(new Error(`Network error: ${err.message}`));
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  /**
   * Store cookies from a response's Set-Cookie header in the cookie jar
   * Cookies that are cleared by the server (empty value, expired) are removed
   */
  private storeResponseCookies(response: Response): void {
    const setCookie = response.headers?.get('set-cookie');
    if (!setCookie) {
      return;
    }

    for (const cookie of splitSetCookieHeader(setCookie)) {
      const [pair, ...attributes] = cookie.split(';');
      const separator = pair.indexOf('=');
      if (separator <= 0) {
        continue;
      }
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some(attribute => {
        const [key, ...rest] = attribute.split('=');
        const attrName = key.trim().toLowerCase();
        const attrValue = rest.join('=').trim();
        if (attrName === 'max-age') {
          return parseInt(attrValue, 10) <= 0;
        }
        if (attrName === 'expires') {
          const expiresAt = Date.parse(attrValue);
          return !isNaN(expiresAt) && expiresAt <= Date.now();
        }
        return false;
      });

      if (!value || expired) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
    log.debug('Session cookies updated:', Array.from(this.cookies.keys()));
  }

  /**
   * Authenticate with Warpgate server
   * Warpgate uses HTTP status codes to indicate auth state:
   * - 401 with {"state":"OtpNeeded"} = password OK, need OTP
   * - 401 with other state = bad credentials or another factor required
   * - 2xx = fully authenticated
   */
  async login(credentials: WarpgateLoginRequest): Promise<ApiResponse<WarpgateLoginResponse>> {
    log.debug('Starting login flow for:', credentials.username);

    const response = await this.requestWithAuthState('/auth/login', {
      method: 'POST',
      body: credentials,
    });

    log.debug('Login result:', {
      success: response.success,
      authState: response.data?.state?.auth?.state,
      error: response.error?.message,
    });

    return response;
  }

  /**
   * Map a Warpgate ApiAuthState value to the internal auth state
   */
  private mapAuthState(state: string, credentialRejected: boolean): MappedAuthState {
    if (credentialRejected) {
      return { state: 'Rejected', methods_remaining: [], reason: 'Invalid credentials' };
    }

    switch (state) {
      case 'Success':
        return { state: 'Accepted', methods_remaining: [] };
      case 'OtpNeeded':
        return { state: 'Need', methods_remaining: ['Otp'] };
      case 'PasswordNeeded':
        return { state: 'Need', methods_remaining: ['Password'] };
      case 'SsoNeeded':
        return { state: 'Need', methods_remaining: ['Sso'] };
      case 'WebUserApprovalNeeded':
        return { state: 'Need', methods_remaining: ['WebUserApproval'] };
      case 'PublicKeyNeeded':
        return { state: 'Need', methods_remaining: ['PublicKey'] };
      case 'IpBlocked':
      case 'IpRejected':
        return { state: 'Rejected', methods_remaining: [], reason: 'Login from this IP address is not allowed' };
      case 'UserLocked':
        return { state: 'Rejected', methods_remaining: [], reason: 'User account is locked' };
      case 'Failed':
      case 'Rejected':
        return { state: 'Rejected', methods_remaining: [], reason: 'Invalid credentials' };
      default:
        return { state: 'Progress', methods_remaining: [] };
    }
  }

  /**
   * Special request handler for Warpgate auth endpoints
   * Warpgate returns auth state in 401 response bodies
   */
  private async requestWithAuthState(
    endpoint: string,
    options: RequestOptions = { method: 'GET' }
  ): Promise<ApiResponse<WarpgateLoginResponse>> {
    const url = `${this.baseUrl}/@warpgate/api${endpoint}`;

    try {
      const response = await this.performFetch(url, this.buildFetchOptions(options));
      this.storeResponseCookies(response);

      const text = await response.text();
      log.debug('Auth response status:', response.status);

      // Parse the response body
      let stateData: any = null;
      if (text) {
        try {
          stateData = JSON.parse(text);
        } catch {
          // Not JSON
        }
      }

      // 2xx = fully authenticated
      if (response.ok) {
        return {
          success: true,
          data: {
            success: true,
            state: {
              protocol: 'http',
              address: '',
              started: true,
              auth: { state: 'Accepted' },
            },
          },
        };
      }

      // 401 with state = auth in progress or rejected
      if (response.status === 401 && typeof stateData?.state === 'string') {
        const authState = stateData.state;
        log.debug('Auth state from 401:', authState);

        // NotStarted means session was lost - treat as error
        if (authState === 'NotStarted') {
          return {
            success: false,
            error: {
              status: 401,
              message: 'Session expired. Please try again.',
              details: 'Authentication session was lost',
            },
          };
        }

        return {
          success: true,
          data: {
            success: true,
            state: {
              protocol: 'http',
              address: '',
              started: true,
              auth: this.mapAuthState(authState, stateData.credential_rejected === true),
            },
          },
        };
      }

      // Other errors = invalid credentials or server problem
      return {
        success: false,
        error: {
          status: response.status,
          message: stateData?.message || stateData?.error || 'Authentication failed',
          details: text,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: {
          status: 0,
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Log out from Warpgate server
   */
  async logout(): Promise<ApiResponse<void>> {
    const response = await this.request<void>('/auth/logout', {
      method: 'POST',
    });

    if (response.success) {
      this.cookies.clear();
    }

    return response;
  }

  /**
   * Get the pending authentication state
   * Note: Warpgate returns 404 when there is no authentication in progress
   * (including for sessions that are already fully authenticated)
   */
  async getAuthState(): Promise<ApiResponse<WarpgateAuthState>> {
    return this.request<WarpgateAuthState>('/auth/state');
  }

  /**
   * Get list of available targets/hosts
   * @param search Optional search filter for target names
   */
  async getTargets(search?: string): Promise<ApiResponse<WarpgateTarget[]>> {
    let endpoint = '/targets';
    if (search) {
      endpoint += `?search=${encodeURIComponent(search)}`;
    }
    return this.request<WarpgateTarget[]>(endpoint);
  }

  /**
   * Get SSH-only targets
   */
  async getSshTargets(): Promise<ApiResponse<WarpgateTarget[]>> {
    const response = await this.getTargets();
    if (response.success && response.data) {
      return {
        success: true,
        data: response.data.filter(target => target.kind === 'Ssh'),
      };
    }
    return response;
  }

  /**
   * Get current user info
   */
  async getUserInfo(): Promise<ApiResponse<WarpgateUserInfo>> {
    return this.request<WarpgateUserInfo>('/info');
  }

  /**
   * Check whether the current session is authenticated
   */
  async isSessionValid(): Promise<boolean> {
    if (!this.hasSession()) {
      return false;
    }
    const info = await this.getUserInfo();
    return !!(info.success && info.data?.username);
  }

  /**
   * Test that the server is reachable
   * Uses the info endpoint, which answers for both anonymous and authenticated sessions
   */
  async testConnection(): Promise<ApiResponse<boolean>> {
    try {
      const response = await this.request<WarpgateUserInfo>('/info');
      if (!response.success) {
        return {
          success: false,
          error: response.error || {
            status: 0,
            message: 'Connection failed',
          },
        };
      }
      return {
        success: true,
        data: true,
      };
    } catch {
      return {
        success: false,
        error: {
          status: 0,
          message: 'Connection failed',
        },
      };
    }
  }

  /**
   * Submit OTP for two-factor authentication
   * Uses requestWithAuthState to properly handle Warpgate's 401-based auth flow
   */
  async submitOtp(otp: string): Promise<ApiResponse<WarpgateLoginResponse>> {
    log.debug('Submitting OTP code');
    const response = await this.requestWithAuthState('/auth/otp', {
      method: 'POST',
      body: { otp },
    });

    log.debug('OTP result:', {
      success: response.success,
      authState: response.data?.state?.auth?.state,
      error: response.error?.message,
    });

    return response;
  }

  /**
   * Create a one-time ticket for passwordless SSH access
   * Note: This is an admin API endpoint - requires admin session
   * @param request Ticket creation parameters
   */
  async createTicket(request: WarpgateTicketRequest): Promise<ApiResponse<WarpgateTicketAndSecret>> {
    return this.request<WarpgateTicketAndSecret>('/tickets', {
      method: 'POST',
      body: request,
    }, true); // Use admin API
  }

  /**
   * List all tickets (admin API)
   */
  async listTickets(): Promise<ApiResponse<WarpgateTicket[]>> {
    return this.request<WarpgateTicket[]>('/tickets', { method: 'GET' }, true); // Use admin API
  }

  /**
   * Delete a ticket by ID (admin API)
   * @param ticketId The ticket UUID to delete
   */
  async deleteTicket(ticketId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/tickets/${encodeURIComponent(ticketId)}`, {
      method: 'DELETE',
    }, true); // Use admin API
  }

  /**
   * Generate SSH username for ticket-based authentication
   * Format: ticket-<secret>
   * @param ticketSecret The ticket secret from createTicket
   */
  generateTicketUsername(ticketSecret: string): string {
    return `ticket-${ticketSecret}`;
  }

  /**
   * Generate SSH connection string for ticket-based authentication
   * @param ticketSecret The ticket secret
   * @param warpgateHost The Warpgate server hostname
   * @param port SSH port (default 2222)
   */
  generateTicketConnectionString(
    ticketSecret: string,
    warpgateHost: string,
    port = DEFAULT_WARPGATE_SSH_PORT
  ): string {
    return `ticket-${ticketSecret}@${warpgateHost}:${port}`;
  }

  /**
   * Generate SSH connection URL for Warpgate
   * Format: warpgate_user:target_name@warpgate_host:port
   */
  generateSshConnectionString(
    targetName: string,
    warpgateUsername: string,
    warpgateHost: string,
    port = 22
  ): string {
    // Warpgate SSH connection format: username:targetname@host
    const connectionUser = `${warpgateUsername}:${targetName}`;
    return `${connectionUser}@${warpgateHost}:${port}`;
  }

  /**
   * Get the SSH host from the server URL
   */
  getSshHost(): string {
    try {
      const url = new URL(this.baseUrl);
      return url.hostname.replace(/^\[(.*)\]$/, '$1');
    } catch {
      // Fallback: try to extract hostname manually
      const match = this.baseUrl.match(/(?:https?:\/\/)?([^:/]+)/);
      return match ? match[1] : this.baseUrl;
    }
  }

  /**
   * Get the default SSH port
   * The port in the server URL is the HTTP(S) port and is never the SSH port,
   * the actual SSH port is reported by the server info endpoint when available
   */
  getSshPort(): number {
    return DEFAULT_WARPGATE_SSH_PORT;
  }

  /**
   * Get list of all users (admin API)
   */
  async getUsers(): Promise<ApiResponse<WarpgateUser[]>> {
    return this.request<WarpgateUser[]>('/users', { method: 'GET' }, true);
  }

  /**
   * Get a specific user by ID (admin API)
   * @param userId User ID
   */
  async getUser(userId: string): Promise<ApiResponse<WarpgateUser>> {
    return this.request<WarpgateUser>(`/users/${encodeURIComponent(userId)}`, { method: 'GET' }, true);
  }

  /**
   * Get user by username (admin API)
   * Searches users and finds match by username
   * @param username Username to find
   */
  async getUserByUsername(username: string): Promise<ApiResponse<WarpgateUser | null>> {
    const response = await this.getUsers();
    if (response.success && response.data) {
      const user = response.data.find(u => u.username === username);
      return { success: true, data: user || null };
    }
    return { success: false, error: response.error };
  }

  /**
   * Get OTP credentials for a user (admin API)
   * @param userId User ID
   */
  async getOtpCredentials(userId: string): Promise<ApiResponse<WarpgateOtpCredential[]>> {
    return this.request<WarpgateOtpCredential[]>(
      `/users/${encodeURIComponent(userId)}/credentials/otp`,
      { method: 'GET' },
      true
    );
  }

  /**
   * Create OTP credential for a user (admin API)
   * @param userId User ID
   * @param secretKey Base32-decoded secret as byte array
   */
  async createOtpCredential(
    userId: string,
    secretKey: number[]
  ): Promise<ApiResponse<WarpgateOtpCredential>> {
    return this.request<WarpgateOtpCredential>(`/users/${encodeURIComponent(userId)}/credentials/otp`, {
      method: 'POST',
      body: { secret_key: secretKey },
    }, true);
  }

  /**
   * Delete OTP credential for a user (admin API)
   * @param userId User ID
   * @param credentialId Credential ID
   */
  async deleteOtpCredential(userId: string, credentialId: string): Promise<ApiResponse<void>> {
    return this.request<void>(
      `/users/${encodeURIComponent(userId)}/credentials/otp/${encodeURIComponent(credentialId)}`,
      { method: 'DELETE' },
      true
    );
  }

  /**
   * Check if user has OTP configured
   * @param userId User ID
   */
  async hasOtpCredential(userId: string): Promise<boolean> {
    const response = await this.getOtpCredentials(userId);
    return !!(response.success && response.data && response.data.length > 0);
  }

  // ============================================================================
  // Self-Service Profile API (no admin required)
  // These endpoints allow users to manage their own credentials
  // ============================================================================

  /**
   * Get current user's credential state
   * This is a self-service endpoint - no admin required
   */
  async getProfileCredentials(): Promise<ApiResponse<WarpgateProfileCredentials>> {
    return this.request<WarpgateProfileCredentials>('/profile/credentials');
  }

  /**
   * Get the IDs of the current user's OTP credentials (self-service)
   */
  async getProfileOtpCredentialIds(): Promise<ApiResponse<string[]>> {
    const response = await this.getProfileCredentials();
    if (!response.success) {
      return { success: false, error: response.error };
    }
    const otp: unknown[] = Array.isArray(response.data?.otp) ? response.data!.otp : [];
    const ids = otp
      .map(entry => (typeof entry === 'string' ? entry : (entry as WarpgateOtpCredential | null)?.id))
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return { success: true, data: ids };
  }

  /**
   * Enable OTP for the current user (self-service)
   * Registers the given TOTP secret with Warpgate
   * @param secret Base32-encoded TOTP secret to register
   */
  async enableProfileOtp(secret: string): Promise<ApiResponse<WarpgateOtpEnableResponse>> {
    return this.request<WarpgateOtpEnableResponse>('/profile/credentials/otp', {
      method: 'POST',
      body: { secret_key: Array.from(base32Decode(secret)) },
    });
  }

  /**
   * Disable OTP for the current user (self-service)
   * @param credentialId The OTP credential ID to remove
   */
  async disableProfileOtp(credentialId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/profile/credentials/otp/${encodeURIComponent(credentialId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Check if current user has OTP enabled (self-service)
   */
  async hasProfileOtp(): Promise<boolean> {
    const response = await this.getProfileOtpCredentialIds();
    return !!(response.success && response.data && response.data.length > 0);
  }

  /**
   * Auto-setup OTP for the current user
   * Generates a new secret, registers it with Warpgate, and returns the secret
   * @returns The TOTP secret that was registered (store this for automatic OTP generation)
   */
  async autoSetupOtp(): Promise<ApiResponse<{ secret: string; credentialId: string }>> {
    // Generate a random TOTP secret
    const secret = generateTOTPSecret();

    // Register it with Warpgate
    const response = await this.enableProfileOtp(secret);

    if (response.success && response.data) {
      return {
        success: true,
        data: {
          secret,
          credentialId: response.data.id,
        },
      };
    }

    return {
      success: false,
      error: response.error || {
        status: 0,
        message: 'Failed to enable OTP',
      },
    };
  }
}

/** Node.js HTTP response interface */
interface NodeResponse {
  statusCode?: number;
  statusMessage?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: 'data', callback: (chunk: Buffer) => void): void;
  on(event: 'end', callback: () => void): void;
  on(event: 'error', callback: (err: Error) => void): void;
}
