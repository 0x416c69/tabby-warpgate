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
      mockFetch.mockResolvedValueOnce(createMockResponse({ username: null }));

      const result = await client.testConnection();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/info',
        expect.any(Object)
      );
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

    it('should not use the HTTP port from the URL as the SSH port', () => {
      const customClient = new WarpgateApiClient('https://warpgate.example.com:8888');
      expect(customClient.getSshPort()).toBe(2222);
    });

    it('should strip brackets from IPv6 hosts', () => {
      const ipv6Client = new WarpgateApiClient('https://[::1]:8888');
      expect(ipv6Client.getSshHost()).toBe('::1');
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

    it('should store the Warpgate session cookie name used by the server', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { success: true },
        { headers: new Map([['set-cookie', 'warpgate-http-session=abc123; Path=/; HttpOnly']]) }
      ));

      await client.login({ username: 'user', password: 'pass' });

      expect(client.getSessionCookie()).toBe('warpgate-http-session=abc123');
    });

    it('should keep the session when a later response sets an unrelated cookie', async () => {
      client.setSessionCookie('warpgate-http-session=abc123');
      mockFetch.mockResolvedValueOnce(createMockResponse(
        [],
        { headers: new Map([['set-cookie', 'lb=node-2; Path=/']]) }
      ));

      await client.getTargets();

      expect(client.getSessionCookie()).toBe('warpgate-http-session=abc123; lb=node-2');
    });

    it('should split multiple cookies including Expires dates with commas', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { success: true },
        {
          headers: new Map([[
            'set-cookie',
            'lb=node-1; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Path=/, warpgate-http-session=xyz; Path=/',
          ]]),
        }
      ));

      await client.login({ username: 'user', password: 'pass' });

      expect(client.getSessionCookie()).toBe('lb=node-1; warpgate-http-session=xyz');
    });

    it('should drop cookies cleared by the server', async () => {
      client.setSessionCookie('warpgate-http-session=abc123');
      mockFetch.mockResolvedValueOnce(createMockResponse(
        [],
        { headers: new Map([['set-cookie', 'warpgate-http-session=; Max-Age=0; Path=/']]) }
      ));

      await client.getTargets();

      expect(client.hasSession()).toBe(false);
    });

    it('should send stored cookies with requests', async () => {
      client.setSessionCookie('warpgate-http-session=abc123');
      mockFetch.mockResolvedValueOnce(createMockResponse([]));

      await client.getTargets();

      expect(mockFetch.mock.calls[0][1].headers.Cookie).toBe('warpgate-http-session=abc123');
    });
  });

  describe('session validation', () => {
    it('should report a valid session when info returns a username', async () => {
      client.setSessionCookie('warpgate-http-session=abc123');
      mockFetch.mockResolvedValueOnce(createMockResponse({ username: 'admin' }));

      await expect(client.isSessionValid()).resolves.toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/info',
        expect.any(Object)
      );
    });

    it('should report an invalid session when info has no username', async () => {
      client.setSessionCookie('warpgate-http-session=abc123');
      mockFetch.mockResolvedValueOnce(createMockResponse({ username: null }));

      await expect(client.isSessionValid()).resolves.toBe(false);
    });

    it('should not call the server without a session cookie', async () => {
      await expect(client.isSessionValid()).resolves.toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('ticket management', () => {
    it('should create a ticket', async () => {
      const mockTicketResponse = {
        ticket: {
          id: 'ticket-uuid-123',
          username: 'testuser',
          target: 'my-server',
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
        'https://warpgate.example.com/@warpgate/admin/api/tickets',
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
      expect(result.data?.ticket.target).toBe('my-server');
    });

    it('should list tickets', async () => {
      const mockTickets = [
        { id: '1', username: 'user1', target: 'server1', created: '2025-01-01T00:00:00Z' },
        { id: '2', username: 'user2', target: 'server2', created: '2025-01-02T00:00:00Z' },
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(mockTickets));

      const result = await client.listTickets();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/admin/api/tickets',
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should delete a ticket', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(null, { ok: true, status: 204 }));

      const result = await client.deleteTicket('ticket-uuid-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/admin/api/tickets/ticket-uuid-123',
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

  describe('self-service profile OTP', () => {
    it('should get profile credentials', async () => {
      const mockCredentials = {
        password: 'Set',
        otp: [{ id: 'otp-cred-1' }],
        public_keys: [],
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCredentials));

      const result = await client.getProfileCredentials();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/profile/credentials',
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.data?.otp).toEqual([{ id: 'otp-cred-1' }]);
    });

    it('should return OTP credential IDs', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        password: 'Set',
        otp: [{ id: 'otp-cred-1' }, { id: 'otp-cred-2' }],
        public_keys: [],
      }));

      const result = await client.getProfileOtpCredentialIds();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['otp-cred-1', 'otp-cred-2']);
    });

    it('should tolerate OTP credentials returned as plain IDs', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ otp: ['otp-cred-1'] }));

      const result = await client.getProfileOtpCredentialIds();

      expect(result.data).toEqual(['otp-cred-1']);
    });

    it('should enable profile OTP with the decoded secret bytes', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ id: 'otp-cred-new' }, { status: 201 }));

      const result = await client.enableProfileOtp('JBSWY3DPEHPK3PXP');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/profile/credentials/otp',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ secret_key: [72, 101, 108, 108, 111, 33, 222, 173, 190, 239] }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('otp-cred-new');
    });

    it('should disable profile OTP', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(null, { status: 204 }));

      const result = await client.disableProfileOtp('otp-cred-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/profile/credentials/otp/otp-cred-1',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
      expect(result.success).toBe(true);
    });

    it('should check if profile has OTP enabled', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        password: 'Set',
        otp: [{ id: 'otp-cred-1' }],
        public_keys: [],
      }));

      const hasOtp = await client.hasProfileOtp();

      expect(hasOtp).toBe(true);
    });

    it('should return false when no OTP configured', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        password: 'Set',
        otp: [],
        public_keys: [],
      }));

      const hasOtp = await client.hasProfileOtp();

      expect(hasOtp).toBe(false);
    });

    it('should auto-setup OTP', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ id: 'otp-cred-auto' }, { status: 201 }));

      const result = await client.autoSetupOtp();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/profile/credentials/otp',
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(result.success).toBe(true);
      expect(result.data?.credentialId).toBe('otp-cred-auto');
      // The secret should be a valid Base32 string (generated internally)
      expect(result.data?.secret).toMatch(/^[A-Z2-7]+$/);

      // The registered bytes must match the returned secret
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(Array.isArray(body.secret_key)).toBe(true);
      expect(body.secret_key).toHaveLength(20);
    });

    it('should handle auto-setup OTP failure', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: 'OTP already enabled' },
        { status: 400, ok: false }
      ));

      const result = await client.autoSetupOtp();

      expect(result.success).toBe(false);
    });
  });

  describe('admin user management', () => {
    it('should get all users', async () => {
      const mockUsers = [
        { id: 'user-1', username: 'alice' },
        { id: 'user-2', username: 'bob' },
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUsers));

      const result = await client.getUsers();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/admin/api/users',
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should get a specific user', async () => {
      const mockUser = { id: 'user-1', username: 'alice' };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUser));

      const result = await client.getUser('user-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/admin/api/users/user-1',
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.data?.username).toBe('alice');
    });

    it('should get user by username', async () => {
      const mockUsers = [
        { id: 'user-1', username: 'alice' },
        { id: 'user-2', username: 'bob' },
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUsers));

      const result = await client.getUserByUsername('bob');

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('user-2');
    });

    it('should return null when user not found by username', async () => {
      const mockUsers = [
        { id: 'user-1', username: 'alice' },
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUsers));

      const result = await client.getUserByUsername('charlie');

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('should propagate error when getUserByUsername fails', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: 'Unauthorized' },
        { ok: false, status: 403 }
      ));

      const result = await client.getUserByUsername('bob');

      expect(result.success).toBe(false);
    });
  });

  describe('admin OTP management', () => {
    it('should get OTP credentials for a user', async () => {
      const mockCreds = [{ id: 'cred-1', kind: 'Totp' }];
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCreds));

      const result = await client.getOtpCredentials('user-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/admin/api/users/user-1/credentials/otp',
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('should create OTP credential for a user', async () => {
      const mockCred = { id: 'cred-new', kind: 'Totp' };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCred));

      const result = await client.createOtpCredential('user-1', [1, 2, 3]);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/admin/api/users/user-1/credentials/otp',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ secret_key: [1, 2, 3] }),
        })
      );
      expect(result.success).toBe(true);
    });

    it('should delete OTP credential for a user', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(null, { status: 204 }));

      const result = await client.deleteOtpCredential('user-1', 'cred-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/admin/api/users/user-1/credentials/otp/cred-1',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(result.success).toBe(true);
    });

    it('should check if user has OTP credential', async () => {
      const mockCreds = [{ id: 'cred-1', kind: 'Totp' }];
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCreds));

      const hasOtp = await client.hasOtpCredential('user-1');

      expect(hasOtp).toBe(true);
    });

    it('should return false when user has no OTP credentials', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]));

      const hasOtp = await client.hasOtpCredential('user-1');

      expect(hasOtp).toBe(false);
    });

    it('should return false when getOtpCredentials fails', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: 'Not found' },
        { ok: false, status: 404 }
      ));

      const hasOtp = await client.hasOtpCredential('user-1');

      expect(hasOtp).toBe(false);
    });
  });

  describe('error handling edge cases', () => {
    it('should handle non-JSON error responses with short text', async () => {
      // Override fetch to return plain text error
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        headers: {
          get: (name: string) => name === 'content-type' ? 'text/plain' : null,
        },
        text: async () => 'Short error',
      }));

      const result = await client.getTargets();

      expect(result.success).toBe(false);
      // Implementation returns HTTP status format, not body text
      expect(result.error?.message).toContain('HTTP 500');
    });

    it('should truncate long error messages', async () => {
      const longError = 'x'.repeat(300);
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        headers: {
          get: () => null,
        },
        text: async () => longError,
      }));

      const result = await client.getTargets();

      expect(result.success).toBe(false);
      // Should not include the full error text (truncated at 200 chars)
      expect(result.error?.message.includes(longError)).toBe(false);
    });

    it('should handle empty error response', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          get: () => null,
        },
        text: async () => '',
      }));

      const result = await client.getTargets();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('500');
      expect(result.error?.message).toContain('Internal Server Error');
    });

    it('should handle JSON parse error in response', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: {
          get: () => null,
        },
        text: async () => 'Not valid JSON {',
      }));

      const result = await client.getTargets();

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(400);
    });

    it('should handle ENOTFOUND network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND example.com'));

      const result = await client.getTargets();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Server not found');
    });

    it('should handle ETIMEDOUT network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ETIMEDOUT connection timeout'));

      const result = await client.getTargets();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Connection timed out');
    });

    it('should handle ESOCKETTIMEDOUT network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ESOCKETTIMEDOUT socket timeout'));

      const result = await client.getTargets();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Connection timed out');
    });

    it('should handle certificate errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('CERT_HAS_EXPIRED'));

      const result = await client.getTargets();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Certificate error');
    });

    it('should handle ECONNRESET error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET connection reset'));

      const result = await client.getTargets();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Connection reset');
    });

    it('should handle unknown errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Unknown weird error'));

      const result = await client.getTargets();

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Unknown weird error');
    });

    it('should handle non-Error exceptions', async () => {
      mockFetch.mockRejectedValueOnce('string error');

      const result = await client.getTargets();

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Unknown error');
    });
  });

  describe('auth state edge cases', () => {
    it('should handle PasswordNeeded state', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 401,
        headers: {
          get: () => null,
        },
        text: async () => JSON.stringify({ state: 'PasswordNeeded' }),
      }));

      const result = await client.login({ username: 'user', password: 'pass' });

      expect(result.success).toBe(true);
      expect(result.data?.state?.auth?.state).toBe('Need');
      expect(result.data?.state?.auth?.methods_remaining).toContain('Password');
    });

    it('should handle Failed state', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 401,
        headers: {
          get: () => null,
        },
        text: async () => JSON.stringify({ state: 'Failed' }),
      }));

      const result = await client.login({ username: 'user', password: 'wrong' });

      expect(result.success).toBe(true);
      expect(result.data?.state?.auth?.state).toBe('Rejected');
    });

    it('should handle Rejected state', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 401,
        headers: {
          get: () => null,
        },
        text: async () => JSON.stringify({ state: 'Rejected' }),
      }));

      const result = await client.login({ username: 'user', password: 'wrong' });

      expect(result.success).toBe(true);
      expect(result.data?.state?.auth?.state).toBe('Rejected');
    });

    it('should treat a rejected credential as Rejected', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 401,
        headers: {
          get: () => null,
        },
        text: async () => JSON.stringify({ state: 'PasswordNeeded', credential_rejected: true }),
      }));

      const result = await client.login({ username: 'user', password: 'wrong' });

      expect(result.success).toBe(true);
      expect(result.data?.state?.auth?.state).toBe('Rejected');
      expect(result.data?.state?.auth?.reason).toBe('Invalid credentials');
    });

    it('should treat a locked account as Rejected', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 401,
        headers: {
          get: () => null,
        },
        text: async () => JSON.stringify({ state: 'UserLocked' }),
      }));

      const result = await client.login({ username: 'user', password: 'pass' });

      expect(result.data?.state?.auth?.state).toBe('Rejected');
      expect(result.data?.state?.auth?.reason).toContain('locked');
    });

    it('should report unsupported second factors as Need', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 401,
        headers: {
          get: () => null,
        },
        text: async () => JSON.stringify({ state: 'SsoNeeded' }),
      }));

      const result = await client.login({ username: 'user', password: 'pass' });

      expect(result.data?.state?.auth?.state).toBe('Need');
      expect(result.data?.state?.auth?.methods_remaining).toEqual(['Sso']);
    });

    it('should treat a 201 login response as Accepted', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(null, { status: 201 }));

      const result = await client.login({ username: 'user', password: 'pass' });

      expect(result.data?.state?.auth?.state).toBe('Accepted');
    });

    it('should handle NotStarted state as error', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 401,
        headers: {
          get: () => null,
        },
        text: async () => JSON.stringify({ state: 'NotStarted' }),
      }));

      const result = await client.login({ username: 'user', password: 'pass' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Session expired');
    });

    it('should handle 401 without state field', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 401,
        headers: {
          get: () => null,
        },
        text: async () => JSON.stringify({ error: 'Unauthorized' }),
      }));

      const result = await client.login({ username: 'user', password: 'pass' });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(401);
    });

    it('should handle 401 with malformed JSON', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: false,
        status: 401,
        headers: {
          get: () => null,
        },
        text: async () => 'Not JSON',
      }));

      const result = await client.login({ username: 'user', password: 'pass' });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(401);
    });

    it('should handle network error during login', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const result = await client.login({ username: 'user', password: 'pass' });

      expect(result.success).toBe(false);
      expect(result.error?.status).toBe(0);
    });
  });

  describe('response content type handling', () => {
    it('should handle non-JSON content-type', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        null,
        {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'text/html']]),
        }
      ));

      const result = await client.getTargets();

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should handle missing content-type header', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        text: async () => '',
      }));

      const result = await client.getTargets();

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should handle empty response body with JSON content-type', async () => {
      mockFetch.mockImplementationOnce(() => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name === 'content-type' ? 'application/json' : null,
        },
        text: async () => '',
      }));

      const result = await client.getTargets();

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });
  });

  describe('getUserInfo', () => {
    it('should fetch user info', async () => {
      const mockInfo = {
        username: 'testuser',
        version: { commit: 'abc123' },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockInfo));

      const result = await client.getUserInfo();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://warpgate.example.com/@warpgate/api/info',
        expect.any(Object)
      );
      expect(result.success).toBe(true);
      expect(result.data?.username).toBe('testuser');
    });
  });

  describe('SSH target filtering edge cases', () => {
    it('should return error when getTargets fails for getSshTargets', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: 'Unauthorized' },
        { ok: false, status: 403 }
      ));

      const result = await client.getSshTargets();

      expect(result.success).toBe(false);
    });

    it('should handle empty SSH targets', async () => {
      const mockTargets = [
        { name: 'http-server', kind: 'Http' },
        { name: 'mysql-server', kind: 'MySql' },
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(mockTargets));

      const result = await client.getSshTargets();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
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
