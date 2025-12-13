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
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: WarpgateApiError;
}

/**
 * Warpgate API Client
 * Provides methods for interacting with Warpgate server REST API
 */
export class WarpgateApiClient {
  private baseUrl: string;
  private sessionCookie: string | null = null;
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
   * Set the session cookie for authenticated requests
   */
  setSessionCookie(cookie: string | null): void {
    this.sessionCookie = cookie;
  }

  /**
   * Get the current session cookie
   */
  getSessionCookie(): string | null {
    return this.sessionCookie;
  }

  /**
   * Check if the client has an active session
   */
  hasSession(): boolean {
    return this.sessionCookie !== null;
  }

  /**
   * Make an HTTP request to the Warpgate API
   */
  private async request<T>(
    endpoint: string,
    options: RequestOptions = { method: 'GET' }
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}/@warpgate/api${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    if (this.sessionCookie) {
      headers['Cookie'] = this.sessionCookie;
    }

    const fetchOptions: RequestInit = {
      method: options.method,
      headers,
      credentials: options.credentials || 'include',
    };

    if (options.body && options.method !== 'GET') {
      fetchOptions.body = JSON.stringify(options.body);
    }

    try {
      const response = await this.performFetch(url, fetchOptions);

      // Extract and store cookies from response
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        this.sessionCookie = this.parseSetCookie(setCookie);
      }

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
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
        // Provide more helpful messages for common errors
        if (errorMessage.includes('ECONNREFUSED')) {
          errorMessage = 'Connection refused - server may be down or URL is incorrect';
        } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
          errorMessage = 'Server not found - check the URL';
        } else if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ESOCKETTIMEDOUT')) {
          errorMessage = 'Connection timed out - server may be unreachable';
        } else if (errorMessage.includes('CERT') || errorMessage.includes('certificate')) {
          errorMessage = 'Certificate error - try enabling "Trust self-signed certificates"';
        } else if (errorMessage.includes('ECONNRESET')) {
          errorMessage = 'Connection reset - server closed the connection';
        }
      }
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
        console.log('[Warpgate] Using Node.js fetch');
        return this.nodeFetch(url, options);
      }
    } catch {
      // Not in Node.js environment
    }

    // Fallback to browser fetch (won't work properly for cookies)
    console.log('[Warpgate] Using browser fetch (cookies may not work)');
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

      console.log('[Warpgate] HTTP Request:', {
        method: requestOptions.method,
        url: `${urlObj.protocol}//${urlObj.hostname}:${requestOptions.port}${requestOptions.path}`,
        hasCookie: !!(options.headers as Record<string, string>)?.['Cookie'],
      });

      const req = transport.request(requestOptions, (res: NodeResponse) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');

          console.log('[Warpgate] HTTP Response:', {
            status: res.statusCode,
            statusMessage: res.statusMessage,
            hasSetCookie: !!res.headers['set-cookie'],
            setCookieRaw: res.headers['set-cookie'],
            bodyLength: body.length,
            bodyPreview: body.substring(0, 300),
          });

          // Create a Response-like object
          const responseHeaders = new Map<string, string>();
          Object.entries(res.headers).forEach(([key, value]) => {
            if (value) {
              responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
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
   * Parse Set-Cookie header to extract session cookie
   */
  private parseSetCookie(setCookie: string): string {
    console.log('[Warpgate] Parsing Set-Cookie:', setCookie);

    // Extract the warpgate session cookie
    // The setCookie string might be comma-separated (multiple cookies) or just one
    const cookies = setCookie.split(',').map(c => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith('warpgate=') || cookie.includes('warpgate=')) {
        const match = cookie.match(/warpgate=([^;]+)/);
        if (match) {
          const result = `warpgate=${match[1]}`;
          console.log('[Warpgate] Extracted session cookie:', result);
          return result;
        }
      }
    }

    // Fallback: take the first cookie
    const fallback = setCookie.split(';')[0];
    console.log('[Warpgate] Using fallback cookie:', fallback);
    return fallback;
  }

  /**
   * Authenticate with Warpgate server
   * Warpgate uses HTTP status codes to indicate auth state:
   * - 401 with {"state":"OtpNeeded"} = password OK, need OTP
   * - 401 with other = bad credentials
   * - 200 = fully authenticated
   */
  async login(credentials: WarpgateLoginRequest): Promise<ApiResponse<WarpgateLoginResponse>> {
    console.log('[Warpgate] Starting login flow for:', credentials.username);

    // Submit credentials - Warpgate returns 401 with state in body
    console.log('[Warpgate] Submitting credentials...');
    const response = await this.requestWithAuthState<WarpgateAuthState>('/auth/login', {
      method: 'POST',
      body: credentials,
    });

    console.log('[Warpgate] Login response:', {
      success: response.success,
      hasData: !!response.data,
      authState: response.data,
      error: response.error?.message,
    });

    return response;
  }

  /**
   * Special request handler for Warpgate auth endpoints
   * Warpgate returns auth state in 401 response bodies
   */
  private async requestWithAuthState<T>(
    endpoint: string,
    options: RequestOptions = { method: 'GET' }
  ): Promise<ApiResponse<WarpgateLoginResponse>> {
    const url = `${this.baseUrl}/@warpgate/api${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    if (this.sessionCookie) {
      headers['Cookie'] = this.sessionCookie;
    }

    const fetchOptions: RequestInit = {
      method: options.method,
      headers,
      credentials: options.credentials || 'include',
    };

    if (options.body && options.method !== 'GET') {
      fetchOptions.body = JSON.stringify(options.body);
    }

    try {
      const response = await this.performFetch(url, fetchOptions);

      // Extract and store cookies from response
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        this.sessionCookie = this.parseSetCookie(setCookie);
        console.log('[Warpgate] Session cookie set');
      }

      const text = await response.text();
      console.log('[Warpgate] Response:', response.status, text);

      // Parse the response body
      let stateData: any = null;
      if (text) {
        try {
          stateData = JSON.parse(text);
        } catch {
          // Not JSON
        }
      }

      // 200 = fully authenticated
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

      // 401 with state = auth in progress
      if (response.status === 401 && stateData?.state) {
        const authState = stateData.state;
        console.log('[Warpgate] Auth state from 401:', authState);
        console.log('[Warpgate] Current session cookie:', this.sessionCookie);

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

        // Map Warpgate states to our internal format
        let internalState: 'NotStarted' | 'Progress' | 'Need' | 'Accepted' | 'Rejected' = 'Progress';
        let methodsRemaining: string[] = [];

        if (authState === 'OtpNeeded') {
          internalState = 'Need';
          methodsRemaining = ['Otp'];
        } else if (authState === 'PasswordNeeded') {
          internalState = 'Need';
          methodsRemaining = ['Password'];
        } else if (authState === 'Failed' || authState === 'Rejected') {
          internalState = 'Rejected';
        }

        return {
          success: true,
          data: {
            success: true,
            state: {
              protocol: 'http',
              address: '',
              started: true,
              auth: {
                state: internalState,
                methods_remaining: methodsRemaining,
              },
            },
          },
        };
      }

      // Other 401 = invalid credentials
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
      this.sessionCookie = null;
    }

    return response;
  }

  /**
   * Get current authentication state
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
   * Test connection to server
   */
  async testConnection(): Promise<ApiResponse<boolean>> {
    try {
      const response = await this.request<WarpgateAuthState>('/auth/state');
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
    console.log('[Warpgate] Submitting OTP code...');
    const response = await this.requestWithAuthState<WarpgateAuthState>('/auth/otp', {
      method: 'POST',
      body: { otp },
    });

    console.log('[Warpgate] OTP response:', {
      success: response.success,
      hasData: !!response.data,
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
    });
  }

  /**
   * List all tickets (admin API)
   */
  async listTickets(): Promise<ApiResponse<WarpgateTicket[]>> {
    return this.request<WarpgateTicket[]>('/tickets');
  }

  /**
   * Delete a ticket by ID (admin API)
   * @param ticketId The ticket UUID to delete
   */
  async deleteTicket(ticketId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/tickets/${ticketId}`, {
      method: 'DELETE',
    });
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
    port = 2222
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
      return url.hostname;
    } catch {
      // Fallback: try to extract hostname manually
      const match = this.baseUrl.match(/(?:https?:\/\/)?([^:/]+)/);
      return match ? match[1] : this.baseUrl;
    }
  }

  /**
   * Get the SSH port (default Warpgate SSH port is 2222)
   */
  getSshPort(): number {
    try {
      const url = new URL(this.baseUrl);
      // Warpgate typically uses port 2222 for SSH, not the HTTPS port
      return url.port ? parseInt(url.port, 10) : 2222;
    } catch {
      return 2222;
    }
  }

  /**
   * Get list of all users (admin API)
   */
  async getUsers(): Promise<ApiResponse<WarpgateUser[]>> {
    return this.request<WarpgateUser[]>('/users');
  }

  /**
   * Get a specific user by ID (admin API)
   * @param userId User ID
   */
  async getUser(userId: string): Promise<ApiResponse<WarpgateUser>> {
    return this.request<WarpgateUser>(`/users/${userId}`);
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
    return this.request<WarpgateOtpCredential[]>(`/users/${userId}/credentials/otp`);
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
    return this.request<WarpgateOtpCredential>(`/users/${userId}/credentials/otp`, {
      method: 'POST',
      body: { secret_key: secretKey },
    });
  }

  /**
   * Delete OTP credential for a user (admin API)
   * @param userId User ID
   * @param credentialId Credential ID
   */
  async deleteOtpCredential(userId: string, credentialId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/users/${userId}/credentials/otp/${credentialId}`, {
      method: 'DELETE',
    });
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
   * Enable OTP for the current user (self-service)
   * Generates a new TOTP secret and registers it with Warpgate
   * @param secret Base32-encoded TOTP secret to register
   */
  async enableProfileOtp(secret: string): Promise<ApiResponse<WarpgateOtpEnableResponse>> {
    return this.request<WarpgateOtpEnableResponse>('/profile/credentials/otp', {
      method: 'POST',
      body: { secret },
    });
  }

  /**
   * Disable OTP for the current user (self-service)
   * @param credentialId The OTP credential ID to remove
   */
  async disableProfileOtp(credentialId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/profile/credentials/otp/${credentialId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Check if current user has OTP enabled (self-service)
   */
  async hasProfileOtp(): Promise<boolean> {
    const response = await this.getProfileCredentials();
    return !!(response.success && response.data && response.data.otp && response.data.otp.length > 0);
  }

  /**
   * Auto-setup OTP for the current user
   * Generates a new secret, registers it with Warpgate, and returns the secret
   * @returns The TOTP secret that was registered (store this for automatic OTP generation)
   */
  async autoSetupOtp(): Promise<ApiResponse<{ secret: string; credentialId: string }>> {
    // Generate a random TOTP secret
    const secret = this.generateTotpSecret();

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

  /**
   * Generate a random Base32-encoded TOTP secret
   * @param length Number of bytes (default: 20 for 160-bit secret)
   */
  private generateTotpSecret(length = 20): string {
    const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let randomBytes: Uint8Array;

    // Check environment for crypto
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
      randomBytes = new Uint8Array(length);
      window.crypto.getRandomValues(randomBytes);
    } else {
      // Node.js environment
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const crypto = require('crypto');
      randomBytes = new Uint8Array(crypto.randomBytes(length));
    }

    // Encode to Base32
    let result = '';
    let buffer = 0;
    let bitsLeft = 0;

    for (let i = 0; i < randomBytes.length; i++) {
      buffer = (buffer << 8) | randomBytes[i];
      bitsLeft += 8;

      while (bitsLeft >= 5) {
        bitsLeft -= 5;
        result += BASE32_CHARS[(buffer >> bitsLeft) & 0x1f];
      }
    }

    // Handle remaining bits
    if (bitsLeft > 0) {
      result += BASE32_CHARS[(buffer << (5 - bitsLeft)) & 0x1f];
    }

    return result;
  }
}

/** Node.js HTTP response interface */
interface NodeResponse {
  statusCode?: number;
  statusMessage?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: 'data', callback: (chunk: Buffer) => void): void;
  on(event: 'end', callback: () => void): void;
}
