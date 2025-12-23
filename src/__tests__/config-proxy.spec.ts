/**
 * Tests for Tabby Config Proxy Behavior
 * These tests verify that the service correctly handles Tabby's proxy-based config store
 */

import { WarpgateService } from '../services/warpgate.service';
import { WarpgateServerConfig, DEFAULT_WARPGATE_CONFIG } from '../models/warpgate.models';

/**
 * Creates a Proxy that mimics Tabby's config.store behavior
 * This is critical for testing because Tabby wraps config in a Proxy
 */
function createTabbyConfigProxy() {
  const target = {
    warpgate: {
      ...DEFAULT_WARPGATE_CONFIG,
      servers: [] as WarpgateServerConfig[],
    }
  };

  return new Proxy(target, {
    get(obj, prop) {
      return obj[prop as keyof typeof obj];
    },
    set(obj, prop, value) {
      console.log(`[Config Proxy] Setting ${String(prop)}:`, value);
      obj[prop as keyof typeof obj] = value;
      return true;
    }
  });
}

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

describe('Config Proxy Compatibility Tests', () => {
  let configStore: ReturnType<typeof createTabbyConfigProxy>;
  let mockConfigService: any;
  let service: WarpgateService;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Suppress console.error from debug logger during tests
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    configStore = createTabbyConfigProxy();
    mockConfigService = {
      store: configStore,
      save: jest.fn(),
    };

    service = new WarpgateService(
      mockConfigService,
      mockNotificationsService,
      mockPlatformService,
      mockInjector
    );
  });

  afterEach(() => {
    service.destroy();
    consoleErrorSpy.mockRestore();
  });

  describe('Array Modification Tests', () => {
    it('should add server by pushing to proxy array', async () => {
      const serverData = {
        name: 'Test Server',
        url: 'https://test.com',
        username: 'user',
        password: 'pass',
        enabled: false,
      };

      const server = await service.addServer(serverData);

      // Verify server is in proxy array
      expect(configStore.warpgate.servers).toHaveLength(1);
      expect(configStore.warpgate.servers[0].id).toBe(server.id);
      expect(configStore.warpgate.servers[0].name).toBe('Test Server');
    });

    it('should update server by modifying proxy array element', async () => {
      // Add server
      const server = await service.addServer({
        name: 'Original',
        url: 'https://original.com',
        username: 'user',
        enabled: false,
      });

      // Verify initial state
      expect(configStore.warpgate.servers[0].name).toBe('Original');

      // Update
      await service.updateServer(server.id, {
        name: 'Updated',
        url: 'https://updated.com',
      });

      // Verify proxy array was modified
      expect(configStore.warpgate.servers).toHaveLength(1);
      expect(configStore.warpgate.servers[0].name).toBe('Updated');
      expect(configStore.warpgate.servers[0].url).toBe('https://updated.com');
      expect(configStore.warpgate.servers[0].id).toBe(server.id);
    });

    it('should remove server using splice on proxy array', async () => {
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

      expect(configStore.warpgate.servers).toHaveLength(3);

      // Remove middle server
      service.removeServer(server2.id);

      // Verify correct removal
      expect(configStore.warpgate.servers).toHaveLength(2);
      expect(configStore.warpgate.servers[0].id).toBe(server1.id);
      expect(configStore.warpgate.servers[1].id).toBe(server3.id);
    });

    it('should NOT lose servers when updating one server', async () => {
      // This was the critical bug - updateServer was losing all other servers

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

      expect(configStore.warpgate.servers).toHaveLength(3);

      // Update server2 (e.g., setting lastConnected)
      await service.updateServer(server2.id, {
        lastConnected: new Date(),
      });

      // CRITICAL: All 3 servers should still exist
      expect(configStore.warpgate.servers).toHaveLength(3);
      expect(configStore.warpgate.servers.find(s => s.id === server1.id)).toBeDefined();
      expect(configStore.warpgate.servers.find(s => s.id === server2.id)).toBeDefined();
      expect(configStore.warpgate.servers.find(s => s.id === server3.id)).toBeDefined();
    });

    it('should handle rapid sequential updates without data loss', async () => {
      const server = await service.addServer({
        name: 'Test Server',
        url: 'https://test.com',
        username: 'user',
        enabled: false,
      });

      // Rapid sequential updates (simulating lastConnected updates during auth)
      await service.updateServer(server.id, { name: 'Update 1' });
      await service.updateServer(server.id, { name: 'Update 2' });
      await service.updateServer(server.id, { name: 'Update 3' });
      await service.updateServer(server.id, { lastConnected: new Date() });

      // Should still have exactly 1 server
      expect(configStore.warpgate.servers).toHaveLength(1);
      expect(configStore.warpgate.servers[0].id).toBe(server.id);
      expect(configStore.warpgate.servers[0].name).toBe('Update 3');
    });
  });

  describe('Regression Tests for Specific Bugs', () => {
    it('BUG FIX: should not clear servers array on saveConfig', async () => {
      // This was the original bug - saveConfig was using forEach on a copy

      const server1 = await service.addServer({
        name: 'Server 1',
        url: 'https://s1.com',
        username: 'user',
        enabled: false,
      });

      expect(configStore.warpgate.servers).toHaveLength(1);

      // Calling saveConfig directly should not clear servers
      service.saveConfig({ autoRefreshInterval: 60000 });

      expect(configStore.warpgate.servers).toHaveLength(1);
      expect(configStore.warpgate.servers[0].id).toBe(server1.id);
    });

    it('BUG FIX: should preserve servers when updating lastConnected', async () => {
      // Real-world scenario: after successful login, updateServer sets lastConnected
      // This was deleting all servers

      const server = await service.addServer({
        name: 'Warpgate Server',
        url: 'https://wg.test.com',
        username: 'admin',
        password: 'pass',
        enabled: false,
      });

      expect(configStore.warpgate.servers).toHaveLength(1);

      // Simulate what happens after successful connection
      await service.updateServer(server.id, {
        lastConnected: new Date(),
      });

      // Server should still exist
      expect(configStore.warpgate.servers).toHaveLength(1);
      expect(configStore.warpgate.servers[0].id).toBe(server.id);
      expect(configStore.warpgate.servers[0].lastConnected).toBeDefined();
    });

    it('BUG FIX: should not lose servers when adding a new one', async () => {
      const server1 = await service.addServer({
        name: 'Server 1',
        url: 'https://s1.com',
        username: 'user1',
        enabled: false,
      });

      expect(configStore.warpgate.servers).toHaveLength(1);

      // Add another server - should not lose the first one
      const server2 = await service.addServer({
        name: 'Server 2',
        url: 'https://s2.com',
        username: 'user2',
        enabled: false,
      });

      expect(configStore.warpgate.servers).toHaveLength(2);
      expect(configStore.warpgate.servers[0].id).toBe(server1.id);
      expect(configStore.warpgate.servers[1].id).toBe(server2.id);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty servers array', () => {
      const servers = service.getServers();
      expect(servers).toEqual([]);
    });

    it('should handle updating non-existent server', async () => {
      await expect(
        service.updateServer('non-existent-id', { name: 'Test' })
      ).rejects.toThrow('Server non-existent-id not found');
    });

    it('should handle removing non-existent server', () => {
      // Should not throw
      expect(() => service.removeServer('non-existent-id')).not.toThrow();

      // Servers should still be empty
      expect(configStore.warpgate.servers).toHaveLength(0);
    });

    it('should handle concurrent add operations', async () => {
      const promises = [
        service.addServer({
          name: 'Server 1',
          url: 'https://s1.com',
          username: 'user1',
          enabled: false,
        }),
        service.addServer({
          name: 'Server 2',
          url: 'https://s2.com',
          username: 'user2',
          enabled: false,
        }),
        service.addServer({
          name: 'Server 3',
          url: 'https://s3.com',
          username: 'user3',
          enabled: false,
        }),
      ];

      const servers = await Promise.all(promises);

      // All 3 should be added
      expect(configStore.warpgate.servers).toHaveLength(3);
      expect(servers).toHaveLength(3);
    });
  });

  describe('Config Save Calls', () => {
    it('should call config.save() after addServer', async () => {
      mockConfigService.save.mockClear();

      await service.addServer({
        name: 'Test',
        url: 'https://test.com',
        username: 'user',
        enabled: false,
      });

      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('should call config.save() after updateServer', async () => {
      const server = await service.addServer({
        name: 'Test',
        url: 'https://test.com',
        username: 'user',
        enabled: false,
      });

      mockConfigService.save.mockClear();

      await service.updateServer(server.id, { name: 'Updated' });

      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('should call config.save() after removeServer', async () => {
      const server = await service.addServer({
        name: 'Test',
        url: 'https://test.com',
        username: 'user',
        enabled: false,
      });

      mockConfigService.save.mockClear();

      service.removeServer(server.id);

      expect(mockConfigService.save).toHaveBeenCalled();
    });
  });
});
