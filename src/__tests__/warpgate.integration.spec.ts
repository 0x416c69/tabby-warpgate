/**
 * Integration tests for WarpgateService
 * These tests simulate real-world scenarios with mocked HTTP responses
 */

import { WarpgateService } from '../services/warpgate.service';
import { WarpgateApiClient } from '../api/warpgate.api';
import { DEFAULT_WARPGATE_CONFIG } from '../models/warpgate.models';

// Mock fetch globally
global.fetch = jest.fn();

// Mock setTimeout to avoid waiting in tests
jest.useFakeTimers();

// Create a proper proxy for config store
function createProxyStore() {
  const store = {
    warpgate: {
      ...DEFAULT_WARPGATE_CONFIG,
      servers: [] as any[],
    }
  };

  return new Proxy(store, {
    get(target, prop) {
      return target[prop as keyof typeof target];
    },
    set(target, prop, value) {
      target[prop as keyof typeof target] = value;
      return true;
    }
  });
}

const mockConfigService = {
  store: createProxyStore(),
  save: jest.fn(),
};

const mockNotificationsService = {
  info: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
};

const mockPlatformService = {
  getOS: jest.fn().mockReturnValue('linux'),
};

const mockInjector = {
  get: jest.fn(),
};

describe('WarpgateService Integration Tests', () => {
  let service: WarpgateService;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();

    // Reset config
    mockConfigService.store = createProxyStore();

    // Create service
    service = new WarpgateService(
      mockConfigService as any,
      mockNotificationsService as any,
      mockPlatformService as any,
      mockInjector as any
    );
  });

  afterEach(() => {
    service.destroy();
  });

  describe('Server Config Persistence', () => {
    it('should add server and persist to config proxy', async () => {
      const serverData = {
        name: 'Test Server',
        url: 'https://wg.test.com',
        username: 'testuser',
        password: 'testpass',
        enabled: false, // Don't try to connect
        trustSelfSigned: false,
      };

      const addedServer = await service.addServer(serverData);

      // Check server was added
      expect(addedServer.id).toBeDefined();
      expect(addedServer.name).toBe('Test Server');

      // Check it persists in config
      expect(mockConfigService.store.warpgate.servers).toHaveLength(1);
      expect(mockConfigService.store.warpgate.servers[0]?.name).toBe('Test Server');
      expect(mockConfigService.save).toHaveBeenCalled();

      // Verify getServers returns it
      const servers = service.getServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe(addedServer.id);
    });

    it('should update server and persist changes', async () => {
      // Add a server first
      const server = await service.addServer({
        name: 'Original Name',
        url: 'https://test.com',
        username: 'user',
        enabled: false,
      });

      jest.clearAllMocks();

      // Update it
      await service.updateServer(server.id, {
        name: 'Updated Name',
        url: 'https://updated.com',
      });

      // Check update persisted
      const servers = service.getServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('Updated Name');
      expect(servers[0].url).toBe('https://updated.com');
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('should remove server and persist deletion', async () => {
      // Add server
      const server = await service.addServer({
        name: 'To Delete',
        url: 'https://test.com',
        username: 'user',
        enabled: false,
      });

      expect(service.getServers()).toHaveLength(1);

      jest.clearAllMocks();

      // Remove it
      service.removeServer(server.id);

      // Check removal persisted
      expect(service.getServers()).toHaveLength(0);
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('should handle multiple server operations without losing data', async () => {
      // Add multiple servers
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

      // Verify all exist
      expect(service.getServers()).toHaveLength(3);

      // Update one
      await service.updateServer(server2.id, { name: 'Updated Server 2' });

      // Verify all still exist
      let servers = service.getServers();
      expect(servers).toHaveLength(3);
      expect(servers.find(s => s.id === server2.id)?.name).toBe('Updated Server 2');

      // Remove one
      service.removeServer(server1.id);

      // Verify correct removal
      servers = service.getServers();
      expect(servers).toHaveLength(2);
      expect(servers.find(s => s.id === server2.id)).toBeDefined();
      expect(servers.find(s => s.id === server3.id)).toBeDefined();
      expect(servers.find(s => s.id === server1.id)).toBeUndefined();
    });
  });

  describe('Authentication Flow with OTP', () => {
    const mockLoginResponse = (state: string, methods?: string[]) => ({
      ok: true,
      status: state === 'Accepted' ? 201 : 401,
      headers: new Headers({
        'set-cookie': 'warpgate-http-session=test-session-cookie; HttpOnly; Path=/; Max-Age=86400'
      }),
      json: async () => ({
        state: state === 'OtpNeeded' ? 'OtpNeeded' : {
          auth: {
            state,
            methods_remaining: methods || []
          }
        }
      })
    });

    const mockOtpResponse = (accepted: boolean) => ({
      ok: true,
      status: accepted ? 201 : 401,
      headers: new Headers(),
      json: async () => ({
        state: {
          auth: {
            state: accepted ? 'Accepted' : 'Need',
            methods_remaining: accepted ? [] : ['Otp']
          }
        }
      })
    });

    it('should handle successful login without OTP', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockLoginResponse('Accepted')
      );

      const result = await service.testServerConnectionFull(
        'https://wg.test.com',
        'testuser',
        'testpass',
        false
      );

      expect(result.success).toBe(true);
      expect(result.needsOtp).toBeUndefined();
      expect(result.sessionCookie).toBeDefined();
    });

    it('should detect when OTP is required', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 401,
        headers: new Headers({
          'set-cookie': 'warpgate-http-session=test-cookie; Path=/'
        }),
        json: async () => ({
          state: {
            auth: {
              state: 'Need',
              methods_remaining: ['Otp']
            }
          }
        })
      });

      const result = await service.testServerConnectionFull(
        'https://wg.test.com',
        'testuser',
        'testpass',
        false
      );

      expect(result.success).toBe(false);
      expect(result.needsOtp).toBe(true);
    });

    it('should successfully authenticate with OTP code', async () => {
      // First call: login returns OTP needed
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 401,
          headers: new Headers({
            'set-cookie': 'warpgate-http-session=test-cookie; Path=/'
          }),
          json: async () => ({
            state: {
              auth: {
                state: 'Need',
                methods_remaining: ['Otp']
              }
            }
          })
        })
        // Second call: OTP submission succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({
            state: {
              auth: {
                state: 'Accepted',
                methods_remaining: []
              }
            }
          })
        });

      const result = await service.testServerConnectionFull(
        'https://wg.test.com',
        'testuser',
        'testpass',
        false,
        '123456' // OTP code
      );

      expect(result.success).toBe(true);
      expect(result.sessionCookie).toBeDefined();
      expect(global.fetch).toHaveBeenCalledTimes(2); // login + OTP
    });

    it('should handle incorrect OTP code', async () => {
      // First call: login returns OTP needed
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 401,
          headers: new Headers({
            'set-cookie': 'warpgate-http-session=test-cookie; Path=/'
          }),
          json: async () => ({
            state: {
              auth: {
                state: 'Need',
                methods_remaining: ['Otp']
              }
            }
          })
        })
        // Second call: OTP submission fails
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: new Headers(),
          json: async () => ({
            error: 'Invalid OTP code'
          })
        });

      const result = await service.testServerConnectionFull(
        'https://wg.test.com',
        'testuser',
        'testpass',
        false,
        '000000' // Wrong OTP
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('OTP verification failed');
    });
  });

  describe('Session Reuse', () => {
    it('should preserve test connection session and reuse when adding server', async () => {
      // Mock successful login
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers({
            'set-cookie': 'warpgate-http-session=preserved-session; Path=/'
          }),
          json: async () => ({
            state: {
              auth: {
                state: 'Accepted',
                methods_remaining: []
              }
            }
          })
        })
        // Mock targets fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ([
            { name: 'target1', kind: 'Ssh' },
            { name: 'target2', kind: 'Ssh' }
          ])
        });

      // Test connection
      const testResult = await service.testServerConnectionFull(
        'https://wg.test.com',
        'testuser',
        'testpass',
        false
      );

      expect(testResult.success).toBe(true);
      expect(testResult.sessionCookie).toBe('preserved-session');

      // Clear fetch mock to verify no new auth calls
      (global.fetch as jest.Mock).mockClear();

      // Mock only the targets fetch (no auth needed)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ([
          { name: 'target1', kind: 'Ssh' }
        ])
      });

      // Add server (should reuse session)
      const server = await service.addServer({
        name: 'Test Server',
        url: 'https://wg.test.com',
        username: 'testuser',
        password: 'testpass',
        enabled: true,
        trustSelfSigned: false,
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));
      jest.runOnlyPendingTimers();

      // Verify server was added
      expect(server).toBeDefined();

      // Verify session was reused (no login call, only targets fetch)
      const fetchCalls = (global.fetch as jest.Mock).mock.calls;
      const loginCalls = fetchCalls.filter(call =>
        call[0].includes('/api/auth/login')
      );

      // Should be 0 because session was reused
      expect(loginCalls.length).toBe(0);
    });

    it('should cleanup test sessions after timeout', () => {
      // Test session cleanup is scheduled
      jest.spyOn(global, 'setTimeout');

      service.testServerConnectionFull(
        'https://wg.test.com',
        'testuser',
        'testpass',
        false
      ).catch(() => {
        // Ignore connection failures
      });

      // Verify cleanup was scheduled
      expect(setTimeout).toHaveBeenCalledWith(
        expect.any(Function),
        5 * 60 * 1000
      );
    });
  });

  describe('OTP Secret Management', () => {
    it('should auto-generate OTP when secret is configured', async () => {
      const validSecret = 'JBSWY3DPEHPK3PXP'; // Valid Base32

      // Add server with OTP secret
      const server = await service.addServer({
        name: 'OTP Server',
        url: 'https://wg.test.com',
        username: 'testuser',
        password: 'testpass',
        enabled: false,
        otpSecret: validSecret,
      });

      // Generate OTP
      const otpCode = await service.generateOtpCode(server.id);

      expect(otpCode).toBeDefined();
      expect(otpCode).toMatch(/^\d{6}$/); // 6 digits
    });

    it('should validate OTP secret format', async () => {
      const server = await service.addServer({
        name: 'Test Server',
        url: 'https://wg.test.com',
        username: 'testuser',
        enabled: false,
      });

      // Invalid secret should throw
      await expect(
        service.setOtpSecret(server.id, 'invalid!@#$')
      ).rejects.toThrow('Invalid OTP secret format');

      // Valid secret should work
      await expect(
        service.setOtpSecret(server.id, 'JBSWY3DPEHPK3PXP')
      ).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      const result = await service.testServerConnectionFull(
        'https://wg.test.com',
        'testuser',
        'testpass',
        false
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should handle malformed server responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ unexpected: 'format' })
      });

      const result = await service.testServerConnectionFull(
        'https://wg.test.com',
        'testuser',
        'testpass',
        false
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle config store initialization failures', async () => {
      // Temporarily break config store
      const originalStore = mockConfigService.store;
      mockConfigService.store = { warpgate: null } as any;

      await expect(
        service.addServer({
          name: 'Test',
          url: 'https://test.com',
          username: 'user',
          enabled: false,
        })
      ).rejects.toThrow('Config store not initialized');

      // Restore
      mockConfigService.store = originalStore;
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple simultaneous server additions', async () => {
      const additions = Array.from({ length: 5 }, (_, i) =>
        service.addServer({
          name: `Server ${i}`,
          url: `https://s${i}.com`,
          username: `user${i}`,
          enabled: false,
        })
      );

      const servers = await Promise.all(additions);

      expect(servers).toHaveLength(5);
      expect(service.getServers()).toHaveLength(5);

      // All should have unique IDs
      const ids = servers.map(s => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(5);
    });

    it('should handle rapid add/update/remove operations', async () => {
      // Add
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

      // Update
      await service.updateServer(server1.id, { name: 'Updated Server 1' });

      // Add another
      const server3 = await service.addServer({
        name: 'Server 3',
        url: 'https://s3.com',
        username: 'user3',
        enabled: false,
      });

      // Remove
      service.removeServer(server2.id);

      // Verify final state
      const servers = service.getServers();
      expect(servers).toHaveLength(2);
      expect(servers.find(s => s.id === server1.id)?.name).toBe('Updated Server 1');
      expect(servers.find(s => s.id === server3.id)).toBeDefined();
      expect(servers.find(s => s.id === server2.id)).toBeUndefined();
    });
  });

  describe('Memory Management', () => {
    it('should clean up test clients on destroy', () => {
      // Create test connections
      service.testServerConnectionFull(
        'https://wg1.test.com',
        'user1',
        'pass1',
        false
      ).catch(() => {});

      service.testServerConnectionFull(
        'https://wg2.test.com',
        'user2',
        'pass2',
        false
      ).catch(() => {});

      // Destroy service
      service.destroy();

      // Timers should be cleared
      expect(clearTimeout).toHaveBeenCalled();
    });
  });
});
