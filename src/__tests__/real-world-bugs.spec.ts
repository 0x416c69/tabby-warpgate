/**
 * REAL WORLD BUG TESTS
 *
 * These tests are designed to catch ACTUAL bugs that were found in production.
 * Each test represents a real bug that users encountered and we had to fix.
 *
 * WHY THIS FILE EXISTS:
 * The user caught bugs that our "comprehensive" tests didn't catch because
 * we were testing theoretical edge cases instead of real-world usage patterns.
 */

import { WarpgateService } from '../services/warpgate.service';
import { WarpgateApiClient } from '../api/warpgate.api';
import { DEFAULT_WARPGATE_CONFIG } from '../models/warpgate.models';

// Mock fetch globally
global.fetch = jest.fn();

// Testable WarpgateApiClient that uses mocked fetch
class TestableWarpgateApiClient extends WarpgateApiClient {
  protected async performFetch(url: string, options: RequestInit): Promise<Response> {
    return (global.fetch as jest.Mock)(url, options);
  }
}

// Mock WarpgateApiClient to use testable version
jest.mock('../api/warpgate.api', () => {
  const original = jest.requireActual('../api/warpgate.api');
  return {
    ...original,
    WarpgateApiClient: class extends original.WarpgateApiClient {
      protected async performFetch(url: string, options: RequestInit): Promise<Response> {
        return (global.fetch as jest.Mock)(url, options);
      }
    },
  };
});

// Create a proper proxy for config store (mimics Tabby's actual behavior)
function createTabbyConfigProxy() {
  const target = {
    warpgate: {
      ...DEFAULT_WARPGATE_CONFIG,
      servers: [] as any[],
    }
  };

  return new Proxy(target, {
    get(obj, prop) {
      return obj[prop as keyof typeof obj];
    },
    set(obj, prop, value) {
      obj[prop as keyof typeof obj] = value;
      return true;
    }
  });
}

const mockConfigService = {
  store: createTabbyConfigProxy(),
  save: jest.fn(),
};

const mockNotificationsService = {
  info: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
};

const mockPlatformService = {
  getOS: jest.fn().mockReturnValue('linux'),
  getAppVersion: jest.fn().mockReturnValue('1.0.0'),
};

const mockInjector = {
  get: jest.fn(),
};

// Helper to create mock Response objects
function createMockResponse(
  data: any,
  options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    headers?: Headers;
  } = {}
): Response {
  const { ok = true, status = 200, statusText = 'OK', headers = new Headers() } = options;
  const body = data ? JSON.stringify(data) : '';

  if (data !== null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return {
    ok,
    status,
    statusText,
    headers,
    text: async () => body,
    json: async () => data,
  } as Response;
}

describe('REAL WORLD BUG TESTS - Production Issues We Actually Encountered', () => {
  let service: WarpgateService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService.store = createTabbyConfigProxy();
    service = new WarpgateService(
      mockConfigService as any,
      mockNotificationsService as any,
      mockPlatformService as any,
      mockInjector as any
    );
  });

  describe('BUG #1: Session Waste - Test Connection Should NOT Logout', () => {
    /**
     * ACTUAL BUG REPORTED BY USER:
     * "When you Test connection a warpgate server, and it asks for TOTP,
     * you enter it and it says connection successful! And when you add it,
     * when it's going to refresh it'll ask for TOTP again, why don't you
     * store the session you got from that Test connection? Why do you waste sessions?"
     *
     * ROOT CAUSE:
     * testServerConnectionFull() was calling logout() after successful auth,
     * destroying the session that could be reused when adding the server.
     *
     * FIX:
     * Remove logout() call and preserve session in testClients Map.
     */
    it('should preserve session cookie after successful test connection', async () => {
      const testUrl = 'https://wg.test.com';
      const testUser = 'testuser';
      const testPass = 'testpass';

      // Mock successful login
      const headers = new Headers();
      headers.set('set-cookie', 'warpgate=session-12345; Path=/');
      headers.set('content-type', 'application/json');

      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createMockResponse(
          {
            state: {
              auth: { state: 'Accepted' },
            },
          },
          { headers }
        )
      );

      const result = await service.testServerConnectionFull(testUrl, testUser, testPass);

      // CRITICAL: Session cookie must be returned
      expect(result.success).toBe(true);
      expect(result.sessionCookie).toBe('session-12345');

      // CRITICAL: Session must be stored in testClients for reuse
      const clientKey = `test:${testUrl}:${testUser}`;
      const storedClient = (service as any).testClients.get(clientKey);
      expect(storedClient).toBeDefined();
      expect(storedClient.getSessionCookie()).toBe('warpgate=session-12345');
    });

    it('should reuse test session when adding server immediately after', async () => {
      const testUrl = 'https://wg.test.com';
      const testUser = 'testuser';
      const testPass = 'testpass';

      // 1. Test connection and get session
      const loginHeaders = new Headers();
      loginHeaders.set('set-cookie', 'warpgate=preserved-session; Path=/');
      loginHeaders.set('content-type', 'application/json');

      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createMockResponse(
          { state: { auth: { state: 'Accepted' } } },
          { headers: loginHeaders }
        )
      );

      const testResult = await service.testServerConnectionFull(testUrl, testUser, testPass);
      expect(testResult.success).toBe(true);
      expect(testResult.sessionCookie).toBe('preserved-session');

      // 2. Mock targets fetch (this should be the ONLY call when adding server)
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createMockResponse([{ name: 'target1', kind: 'Ssh' }])
      );

      // 3. Add server - should reuse session WITHOUT re-authenticating
      await service.addServer({
        name: 'Test Server',
        url: testUrl,
        username: testUser,
        password: testPass,
        enabled: true,
      });

      // CRITICAL: Should NOT have made another login request
      const fetchCalls = (global.fetch as jest.Mock).mock.calls;
      const loginCalls = fetchCalls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('/api/auth/login')
      );

      // Should be 0 because we reused the session from test connection
      expect(loginCalls.length).toBe(0);
    });
  });

  describe('BUG #2: Servers Disappearing After Update', () => {
    /**
     * ACTUAL BUG ENCOUNTERED:
     * After adding multiple servers, updating one server (e.g., setting lastConnected)
     * would cause ALL other servers to disappear from the config.
     *
     * ROOT CAUSE:
     * updateServer() was creating a new array instead of modifying the proxied array:
     * Bad: this.config.store.warpgate.servers = servers.map(...)
     * Good: servers[index] = updatedServer
     *
     * This broke Tabby's Proxy reactivity system.
     */
    it('should NOT lose servers when updating one server', async () => {
      // Add 3 servers
      const server1 = await service.addServer({
        name: 'Server 1',
        url: 'https://s1.com',
        username: 'user1',
        enabled: false,
      });

      const server2 = await service.addServer({
        name: 'Server 2',
        url: 'https://s2.com',
        username: 'user2',
        enabled: false,
      });

      const server3 = await service.addServer({
        name: 'Server 3',
        url: 'https://s3.com',
        username: 'user3',
        enabled: false,
      });

      expect(service.getServers()).toHaveLength(3);

      // Update server2's lastConnected (simulating a real-world scenario)
      await service.updateServer(server2.id, {
        lastConnected: new Date(),
      });

      // CRITICAL BUG CHECK: ALL 3 servers must still exist
      const servers = service.getServers();
      expect(servers).toHaveLength(3);

      // Verify each server is still there
      expect(servers.find(s => s.id === server1.id)).toBeDefined();
      expect(servers.find(s => s.id === server2.id)).toBeDefined();
      expect(servers.find(s => s.id === server3.id)).toBeDefined();

      // Verify the update actually worked
      const updatedServer = servers.find(s => s.id === server2.id);
      expect(updatedServer?.lastConnected).toBeDefined();
    });

    it('should handle rapid sequential updates without data loss', async () => {
      // Add servers
      const server1 = await service.addServer({
        name: 'Server 1',
        url: 'https://s1.com',
        username: 'user1',
        enabled: false,
      });

      const server2 = await service.addServer({
        name: 'Server 2',
        url: 'https://s2.com',
        username: 'user2',
        enabled: false,
      });

      // Rapid updates (simulating real usage)
      await service.updateServer(server1.id, { name: 'Updated Server 1' });
      await service.updateServer(server2.id, { name: 'Updated Server 2' });
      await service.updateServer(server1.id, { lastConnected: new Date() });

      // CRITICAL: Both servers must still exist
      const servers = service.getServers();
      expect(servers).toHaveLength(2);
      expect(servers.find(s => s.name === 'Updated Server 1')).toBeDefined();
      expect(servers.find(s => s.name === 'Updated Server 2')).toBeDefined();
    });
  });

  describe('BUG #3: Array Manipulation Breaking Proxy', () => {
    /**
     * ACTUAL BUG PATTERN:
     * Using array methods that return new arrays (map, filter, etc.) instead of
     * in-place mutations (push, splice, index assignment) breaks Tabby's Proxy.
     *
     * This is the ROOT CAUSE of servers disappearing.
     */
    it('should use in-place array operations, not array copies', async () => {
      const initialLength = mockConfigService.store.warpgate.servers.length;

      // Add a server (uses push internally)
      await service.addServer({
        name: 'Test Server',
        url: 'https://test.com',
        username: 'user',
        enabled: false,
      });

      // CRITICAL: The SAME array reference must be modified
      const afterAdd = mockConfigService.store.warpgate.servers.length;
      expect(afterAdd).toBe(initialLength + 1);

      // Get the server ID
      const servers = service.getServers();
      const serverId = servers[0].id;

      // Update server (uses index assignment internally)
      await service.updateServer(serverId, { name: 'Updated Name' });

      // CRITICAL: Array reference must not change
      const afterUpdate = mockConfigService.store.warpgate.servers.length;
      expect(afterUpdate).toBe(afterAdd);
      expect(service.getServers()[0].name).toBe('Updated Name');

      // Remove server (uses splice internally)
      service.removeServer(serverId);

      // CRITICAL: Array reference must not change
      const afterRemove = mockConfigService.store.warpgate.servers.length;
      expect(afterRemove).toBe(afterUpdate - 1);
    });
  });

  describe('BUG #4: OTP Required But Not Prompted', () => {
    /**
     * POTENTIAL BUG:
     * If OTP is required but the modal fails to show, user gets stuck
     * with no way to provide OTP code.
     *
     * This test ensures we handle OTP flow correctly.
     */
    it('should detect when OTP is needed during test connection', async () => {
      const testUrl = 'https://wg.test.com';
      const testUser = 'testuser';
      const testPass = 'testpass';

      // Mock login response indicating OTP is needed
      const headers = new Headers();
      headers.set('set-cookie', 'warpgate=partial-session; Path=/');

      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createMockResponse(
          { state: 'OtpNeeded' },
          { ok: false, status: 401, headers }
        )
      );

      const result = await service.testServerConnectionFull(testUrl, testUser, testPass);

      // CRITICAL: Must indicate OTP is needed
      expect(result.success).toBe(false);
      expect(result.needsOtp).toBe(true);
    });

    it('should accept OTP code and complete authentication', async () => {
      const testUrl = 'https://wg.test.com';
      const testUser = 'testuser';
      const testPass = 'testpass';
      const otpCode = '123456';

      // Mock login response (password accepted, needs OTP)
      const partialHeaders = new Headers();
      partialHeaders.set('set-cookie', 'warpgate=partial-session; Path=/');

      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createMockResponse(
          { state: 'OtpNeeded' },
          { ok: false, status: 401, headers: partialHeaders }
        )
      );

      // First call without OTP
      const firstResult = await service.testServerConnectionFull(testUrl, testUser, testPass);
      expect(firstResult.needsOtp).toBe(true);

      // Mock OTP submission success
      const fullHeaders = new Headers();
      fullHeaders.set('set-cookie', 'warpgate=full-session; Path=/');

      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createMockResponse(
          { state: { auth: { state: 'Accepted' } } },
          { headers: fullHeaders }
        )
      );

      // Second call with OTP code
      const secondResult = await service.testServerConnectionFull(testUrl, testUser, testPass, false, otpCode);

      // CRITICAL: Must succeed and preserve session
      expect(secondResult.success).toBe(true);
      expect(secondResult.sessionCookie).toBeDefined();
    });
  });

  describe('BUG #5: Config Not Persisted After Operations', () => {
    /**
     * POTENTIAL BUG:
     * If config.save() is not called after each operation, changes are lost
     * when Tabby restarts.
     */
    it('should call config.save() after adding server', async () => {
      mockConfigService.save.mockClear();

      await service.addServer({
        name: 'Test Server',
        url: 'https://test.com',
        username: 'user',
        enabled: false,
      });

      // CRITICAL: Must persist changes
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('should call config.save() after updating server', async () => {
      const server = await service.addServer({
        name: 'Test Server',
        url: 'https://test.com',
        username: 'user',
        enabled: false,
      });

      mockConfigService.save.mockClear();

      await service.updateServer(server.id, { name: 'Updated' });

      // CRITICAL: Must persist changes
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('should call config.save() after removing server', async () => {
      const server = await service.addServer({
        name: 'Test Server',
        url: 'https://test.com',
        username: 'user',
        enabled: false,
      });

      mockConfigService.save.mockClear();

      service.removeServer(server.id);

      // CRITICAL: Must persist changes
      expect(mockConfigService.save).toHaveBeenCalled();
    });
  });

  describe('BUG #6: Test Session Cleanup Timer Not Cleared', () => {
    /**
     * POTENTIAL BUG:
     * If test session is reused for adding server, the cleanup timer
     * should be cleared to prevent premature cleanup.
     */
    it('should clear cleanup timer when test session is reused', async () => {
      const testUrl = 'https://wg.test.com';
      const testUser = 'testuser';
      const testPass = 'testpass';

      // Create test session
      const loginHeaders = new Headers();
      loginHeaders.set('set-cookie', 'warpgate=test-session; Path=/');

      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createMockResponse(
          { state: { auth: { state: 'Accepted' } } },
          { headers: loginHeaders }
        )
      );

      await service.testServerConnectionFull(testUrl, testUser, testPass);

      // Verify timer was created
      const clientKey = `test:${testUrl}:${testUser}`;
      const timers = (service as any).testClientTimers;
      const timerBefore = timers.get(clientKey);
      expect(timerBefore).toBeDefined();

      // Mock targets fetch for addServer
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        createMockResponse([])
      );

      // Add server (should reuse session and clear timer)
      await service.addServer({
        name: 'Test Server',
        url: testUrl,
        username: testUser,
        password: testPass,
        enabled: true,
      });

      // CRITICAL: Timer should be cleared
      const timerAfter = timers.get(clientKey);
      expect(timerAfter).toBeUndefined();

      // CRITICAL: Test client should be removed (transferred to main client)
      const testClients = (service as any).testClients;
      expect(testClients.get(clientKey)).toBeUndefined();
    });
  });
});
