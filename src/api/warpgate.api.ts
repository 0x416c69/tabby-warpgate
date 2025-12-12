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
        return {
          success: false,
          error: {
            status: response.status,
            message: `API error: ${response.statusText}`,
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: {
          status: 0,
          message: `Request failed: ${errorMessage}`,
        },
      };
    }
  }

  /**
   * Perform the actual fetch request
   * This method can be overridden in tests or for platform-specific implementations
   */
  protected async performFetch(url: string, options: RequestInit): Promise<Response> {
    // Check if running in Node.js environment (Tabby Desktop)
    if (typeof window === 'undefined' || !window.fetch) {
      return this.nodeFetch(url, options);
    }

    // Browser/Tabby Web environment
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

      const req = transport.request(requestOptions, (res: NodeResponse) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');

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

      req.on('error', reject);

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
    // Extract the warpgate session cookie
    const cookies = setCookie.split(',').map(c => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith('warpgate=') || cookie.includes('warpgate=')) {
        const match = cookie.match(/warpgate=([^;]+)/);
        if (match) {
          return `warpgate=${match[1]}`;
        }
      }
    }
    return setCookie.split(';')[0];
  }

  /**
   * Authenticate with Warpgate server
   */
  async login(credentials: WarpgateLoginRequest): Promise<ApiResponse<WarpgateLoginResponse>> {
    const response = await this.request<WarpgateAuthState>('/auth/login', {
      method: 'POST',
      body: credentials,
    });

    if (response.success) {
      return {
        success: true,
        data: {
          success: true,
          state: response.data,
        },
      };
    }

    return {
      success: false,
      error: response.error,
    };
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
   */
  async submitOtp(otp: string): Promise<ApiResponse<WarpgateAuthState>> {
    return this.request<WarpgateAuthState>('/auth/otp', {
      method: 'POST',
      body: { otp },
    });
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
}

/** Node.js HTTP response interface */
interface NodeResponse {
  statusCode?: number;
  statusMessage?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: 'data', callback: (chunk: Buffer) => void): void;
  on(event: 'end', callback: () => void): void;
}
