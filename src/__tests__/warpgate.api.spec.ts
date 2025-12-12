/**
 * Unit tests for WarpgateApiClient
 */

import { WarpgateApiClient } from '../api/warpgate.api';

describe('WarpgateApiClient', () => {
  let client: WarpgateApiClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    client = new TestableWarpgateApiClient('https://warpgate.example.com', false, mockFetch);
  });

  describe('constructor', () => {
    it('should normalize URL with trailing slash', () => {
      const c = new WarpgateApiClient('https://example.com/');
      expect(c.getBaseUrl()).toBe('https://example.com');
    });

    it('should add https protocol if missing', () => {
      const c = new WarpgateApiClient('example.com');
      expect(c.getBaseUrl()).toBe('https://example.com');
    });

    it('should preserve http protocol', () => {
      const c = new WarpgateApiClient('http://example.com');
      expect(c.getBaseUrl()).toBe('http://example.com');
    });
  });

  describe('session management', () => {
    it('should start without a session', () => {
      expect(client.hasSession()).toBe(false);
      expect(client.getSessionCookie()).toBeNull();
    });

    it('should store session cookie', () => {
      client.setSessionCookie('warpgate=abc123');
      expect(client.hasSession()).toBe(true);
      expect(client.getSessionCookie()).toBe('warpgate=abc123');
    });

    it('should clear session cookie', () => {
      client.setSessionCookie('warpgate=abc123');
      client.setSessionCookie(null);
      expect(client.hasSession()).toBe(false);
    });
  });

  describe('login', () => {
    it('should send login request with credentials', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        success: true,
        state: { protocol: 'ssh', address: 'test', started: true },
      }));

      const result = await client.login({
        username: 'testuser',
        password: 'testpass',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ username: 'testuser', password: 'testpass' }),
        })
      );
      expect(result.success).toBe(true);
    });

    it('should handle login failure', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: 'Invalid credentials' },
        { ok: false, status: 401, statusText: 'Unauthorized' }
      ));

      const result = await client.login({
        username: 'testuser',
        password: 'wrongpass',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.status).toBe(401);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.login({
        username: 'testuser',
        password: 'testpass',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Network error');
    });
  });

  describe('logout', () => {
    it('should send logout request', async () => {
      client.setSessionCookie('warpgate=abc123');
      mockFetch.mockResolvedValueOnce(createMockResponse(null, { ok: true }));

      const result = await client.logout();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/auth/logout',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.success).toBe(true);
      expect(client.hasSession()).toBe(false);
    });
  });

  describe('getTargets', () => {
    it('should fetch targets list', async () => {
      const mockTargets = [
        { name: 'server1', description: 'Test server', kind: 'Ssh' },
        { name: 'server2', description: 'Another server', kind: 'Ssh' },
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(mockTargets));

      const result = await client.getTargets();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/targets',
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockTargets);
    });

    it('should filter targets by search query', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]));

      await client.getTargets('server1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/targets?search=server1',
        expect.any(Object)
      );
    });

    it('should encode search query', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]));

      await client.getTargets('test server');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/targets?search=test%20server',
        expect.any(Object)
      );
    });
  });

  describe('getSshTargets', () => {
    it('should filter SSH targets only', async () => {
      const mockTargets = [
        { name: 'ssh-server', description: 'SSH server', kind: 'Ssh' },
        { name: 'http-server', description: 'HTTP server', kind: 'Http' },
        { name: 'mysql-server', description: 'MySQL server', kind: 'MySql' },
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(mockTargets));

      const result = await client.getSshTargets();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].name).toBe('ssh-server');
    });
  });

  describe('getAuthState', () => {
    it('should fetch authentication state', async () => {
      const mockState = {
        protocol: 'ssh',
        address: '192.168.1.1',
        started: true,
        auth: { state: 'Accepted' },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockState));

      const result = await client.getAuthState();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/auth/state',
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockState);
    });
  });

  describe('testConnection', () => {
    it('should return success for valid connection', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ started: true }));

      const result = await client.testConnection();

      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('should handle connection failures', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.testConnection();

      expect(result.success).toBe(false);
    });
  });

  describe('submitOtp', () => {
    it('should submit OTP code', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        auth: { state: 'Accepted' },
      }));

      const result = await client.submitOtp('123456');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/auth/otp',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ otp: '123456' }),
        })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('SSH connection helpers', () => {
    it('should generate SSH connection string', () => {
      const connString = client.generateSshConnectionString(
        'target-server',
        'myuser',
        'warpgate.example.com',
        2222
      );

      expect(connString).toBe('myuser:target-server@warpgate.example.com:2222');
    });

    it('should extract SSH host from URL', () => {
      expect(client.getSshHost()).toBe('warpgate.example.com');
    });

    it('should return default SSH port', () => {
      expect(client.getSshPort()).toBe(2222);
    });

    it('should extract custom port from URL', () => {
      const customClient = new WarpgateApiClient('https://warpgate.example.com:8443');
      expect(customClient.getSshPort()).toBe(8443);
    });
  });

  describe('cookie handling', () => {
    it('should parse and store set-cookie header', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { success: true },
        {
          headers: new Map([['set-cookie', 'warpgate=session123; Path=/; HttpOnly']]),
        }
      ));

      await client.login({ username: 'user', password: 'pass' });

      expect(client.getSessionCookie()).toBe('warpgate=session123');
    });
  });

  describe('ticket management', () => {
    it('should create a ticket', async () => {
      const mockTicketResponse = {
        ticket: {
          id: 'ticket-uuid-123',
          username: 'testuser',
          target_name: 'my-server',
          created: '2025-01-01T00:00:00Z',
          uses_left: 1,
        },
        secret: 'abc123secret456',
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockTicketResponse));

      const result = await client.createTicket({
        username: 'testuser',
        target_name: 'my-server',
        number_of_uses: 1,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/tickets',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            username: 'testuser',
            target_name: 'my-server',
            number_of_uses: 1,
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.data?.secret).toBe('abc123secret456');
      expect(result.data?.ticket.target_name).toBe('my-server');
    });

    it('should list tickets', async () => {
      const mockTickets = [
        { id: '1', username: 'user1', target_name: 'server1', created: '2025-01-01T00:00:00Z' },
        { id: '2', username: 'user2', target_name: 'server2', created: '2025-01-02T00:00:00Z' },
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(mockTickets));

      const result = await client.listTickets();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/tickets',
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should delete a ticket', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(null, { ok: true, status: 204 }));

      const result = await client.deleteTicket('ticket-uuid-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/tickets/ticket-uuid-123',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(result.success).toBe(true);
    });

    it('should generate ticket username', () => {
      const username = client.generateTicketUsername('abc123secret456');
      expect(username).toBe('ticket-abc123secret456');
    });

    it('should generate ticket connection string', () => {
      const connString = client.generateTicketConnectionString(
        'abc123secret456',
        'warpgate.example.com',
        2222
      );
      expect(connString).toBe('ticket-abc123secret456@warpgate.example.com:2222');
    });
  });
});

/**
 * Testable version of WarpgateApiClient that allows mocking fetch
 */
class TestableWarpgateApiClient extends WarpgateApiClient {
  constructor(
    serverUrl: string,
    trustSelfSigned: boolean,
    private mockFetch: jest.Mock
  ) {
    super(serverUrl, trustSelfSigned);
  }

  protected async performFetch(url: string, options: RequestInit): Promise<Response> {
    return this.mockFetch(url, options);
  }
}

/**
 * Create a mock Response object
 */
function createMockResponse(
  data: any,
  options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    headers?: Map<string, string>;
  } = {}
): Response {
  const { ok = true, status = 200, statusText = 'OK', headers = new Map() } = options;

  const body = data ? JSON.stringify(data) : '';

  // Add content-type header by default for JSON responses
  if (data !== null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return {
    ok,
    status,
    statusText,
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) || null,
    },
    text: async () => body,
    json: async () => data,
  } as unknown as Response;
}
