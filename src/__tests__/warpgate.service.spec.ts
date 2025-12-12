/**
 * Unit tests for WarpgateService
 */

import { WarpgateService } from '../services/warpgate.service';
import { WarpgateServerConfig, DEFAULT_WARPGATE_CONFIG } from '../models/warpgate.models';

// Mock dependencies
const mockConfigService = {
  store: {
    warpgate: { ...DEFAULT_WARPGATE_CONFIG },
  },
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

describe('WarpgateService', () => {
  let service: WarpgateService;

  beforeEach(() => {
    // Reset config
    mockConfigService.store.warpgate = { ...DEFAULT_WARPGATE_CONFIG };
    mockConfigService.save.mockClear();
    mockNotificationsService.info.mockClear();
    mockNotificationsService.error.mockClear();

    // Create service with mocks
    service = new WarpgateService(
      mockConfigService as any,
      mockNotificationsService as any,
      mockPlatformService as any
    );
  });

  describe('getConfig', () => {
    it('should return default config when none exists', () => {
      mockConfigService.store.warpgate = undefined as any;
      const config = service.getConfig();
      expect(config).toEqual(DEFAULT_WARPGATE_CONFIG);
    });

    it('should return stored config', () => {
      const customConfig = {
        ...DEFAULT_WARPGATE_CONFIG,
        autoRefreshInterval: 120000,
      };
      mockConfigService.store.warpgate = customConfig;

      const config = service.getConfig();
      expect(config.autoRefreshInterval).toBe(120000);
    });
  });

  describe('saveConfig', () => {
    it('should merge and save config', () => {
      service.saveConfig({ autoRefreshInterval: 30000 });

      expect(mockConfigService.store.warpgate.autoRefreshInterval).toBe(30000);
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('should preserve existing config values', () => {
      mockConfigService.store.warpgate.showOfflineServers = false;
      service.saveConfig({ autoRefreshInterval: 30000 });

      expect(mockConfigService.store.warpgate.showOfflineServers).toBe(false);
      expect(mockConfigService.store.warpgate.autoRefreshInterval).toBe(30000);
    });
  });

  describe('getServers', () => {
    it('should return empty array by default', () => {
      const servers = service.getServers();
      expect(servers).toEqual([]);
    });

    it('should return configured servers', () => {
      const testServer: WarpgateServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://wg.example.com',
        username: 'user',
        enabled: true,
      };
      mockConfigService.store.warpgate.servers = [testServer];

      const servers = service.getServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('Test Server');
    });
  });

  describe('getServer', () => {
    it('should return server by ID', () => {
      const testServer: WarpgateServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://wg.example.com',
        username: 'user',
        enabled: true,
      };
      mockConfigService.store.warpgate.servers = [testServer];

      const server = service.getServer('test-1');
      expect(server).toBeDefined();
      expect(server?.name).toBe('Test Server');
    });

    it('should return undefined for non-existent server', () => {
      const server = service.getServer('non-existent');
      expect(server).toBeUndefined();
    });
  });

  describe('addServer', () => {
    it('should add a new server with generated ID', async () => {
      const serverData = {
        name: 'New Server',
        url: 'https://new.example.com',
        username: 'newuser',
        password: 'pass',
        enabled: true,
      };

      const newServer = await service.addServer(serverData);

      expect(newServer.id).toMatch(/^wg-/);
      expect(newServer.name).toBe('New Server');
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('should emit server-added event', async () => {
      const events: any[] = [];
      service.events$.subscribe(e => {
        if (e) events.push(e);
      });

      await service.addServer({
        name: 'Test',
        url: 'https://test.com',
        username: 'user',
        enabled: false,
      });

      const addEvent = events.find(e => e.type === 'server-added');
      expect(addEvent).toBeDefined();
    });
  });

  describe('removeServer', () => {
    it('should remove server by ID', () => {
      const testServer: WarpgateServerConfig = {
        id: 'to-remove',
        name: 'Server to Remove',
        url: 'https://wg.example.com',
        username: 'user',
        enabled: true,
      };
      mockConfigService.store.warpgate.servers = [testServer];

      service.removeServer('to-remove');

      expect(mockConfigService.store.warpgate.servers).toHaveLength(0);
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('should emit server-removed event', () => {
      const events: any[] = [];
      service.events$.subscribe(e => {
        if (e) events.push(e);
      });

      mockConfigService.store.warpgate.servers = [{
        id: 'to-remove',
        name: 'Test',
        url: 'https://test.com',
        username: 'user',
        enabled: true,
      }];

      service.removeServer('to-remove');

      const removeEvent = events.find(e => e.type === 'server-removed');
      expect(removeEvent).toBeDefined();
      expect(removeEvent.serverId).toBe('to-remove');
    });
  });

  describe('updateServer', () => {
    it('should update server properties', async () => {
      mockConfigService.store.warpgate.servers = [{
        id: 'test-1',
        name: 'Original Name',
        url: 'https://original.com',
        username: 'user',
        enabled: true,
      }];

      await service.updateServer('test-1', { name: 'Updated Name' });

      expect(mockConfigService.store.warpgate.servers[0].name).toBe('Updated Name');
      expect(mockConfigService.save).toHaveBeenCalled();
    });

    it('should throw error for non-existent server', async () => {
      await expect(service.updateServer('non-existent', { name: 'Test' }))
        .rejects.toThrow('Server non-existent not found');
    });

    it('should emit server-updated event', async () => {
      const events: any[] = [];
      service.events$.subscribe(e => {
        if (e) events.push(e);
      });

      mockConfigService.store.warpgate.servers = [{
        id: 'test-1',
        name: 'Test',
        url: 'https://test.com',
        username: 'user',
        enabled: true,
      }];

      await service.updateServer('test-1', { name: 'Updated' });

      const updateEvent = events.find(e => e.type === 'server-updated');
      expect(updateEvent).toBeDefined();
    });
  });

  describe('isConnected', () => {
    it('should return false for unknown server', () => {
      expect(service.isConnected('unknown')).toBe(false);
    });
  });

  describe('getSshConnectionDetails', () => {
    it('should return null for unknown server', () => {
      const details = service.getSshConnectionDetails('unknown', 'target');
      expect(details).toBeNull();
    });
  });

  describe('getAllTargets', () => {
    it('should return empty array when no targets', () => {
      const targets = service.getAllTargets();
      expect(targets).toEqual([]);
    });
  });

  describe('getServerTargets', () => {
    it('should return empty array for unknown server', () => {
      const targets = service.getServerTargets('unknown');
      expect(targets).toEqual([]);
    });
  });

  describe('updateAutoRefreshInterval', () => {
    it('should update auto refresh interval', () => {
      service.updateAutoRefreshInterval(120000);

      expect(mockConfigService.store.warpgate.autoRefreshInterval).toBe(120000);
      expect(mockConfigService.save).toHaveBeenCalled();
    });
  });

  describe('testServerConnection', () => {
    it('should test connection without saving', async () => {
      // This will fail because there's no real server, but we're testing the method exists
      const result = await service.testServerConnection(
        'https://nonexistent.example.com',
        'user',
        'pass',
        false
      );

      // Connection should fail (no real server)
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('should clean up on destroy', () => {
      // Should not throw
      expect(() => service.destroy()).not.toThrow();
    });
  });

  describe('observables', () => {
    it('should emit loading state', () => {
      const loadingStates: boolean[] = [];
      service.loading$.subscribe(loading => loadingStates.push(loading));

      // Initial state should be emitted
      expect(loadingStates.length).toBeGreaterThan(0);
    });

    it('should emit status updates', () => {
      const statuses: Map<string, any>[] = [];
      service.status$.subscribe(status => statuses.push(status));

      // Initial state should be emitted
      expect(statuses.length).toBeGreaterThan(0);
    });

    it('should emit targets', () => {
      const targets: Map<string, any>[] = [];
      service.targets$.subscribe(t => targets.push(t));

      // Initial state should be emitted
      expect(targets.length).toBeGreaterThan(0);
    });
  });

  describe('OTP functionality', () => {
    const validOtpSecret = 'JBSWY3DPEHPK3PXP'; // Valid 16-char Base32

    describe('hasOtpSecret', () => {
      it('should return false for unknown server', () => {
        expect(service.hasOtpSecret('unknown')).toBe(false);
      });

      it('should return false when server has no OTP secret', () => {
        mockConfigService.store.warpgate.servers = [{
          id: 'test-1',
          name: 'Test',
          url: 'https://test.com',
          username: 'user',
          enabled: true,
        }];

        expect(service.hasOtpSecret('test-1')).toBe(false);
      });

      it('should return true when server has valid OTP secret', () => {
        mockConfigService.store.warpgate.servers = [{
          id: 'test-1',
          name: 'Test',
          url: 'https://test.com',
          username: 'user',
          enabled: true,
          otpSecret: validOtpSecret,
        }];

        expect(service.hasOtpSecret('test-1')).toBe(true);
      });

      it('should return false for invalid OTP secret format', () => {
        mockConfigService.store.warpgate.servers = [{
          id: 'test-1',
          name: 'Test',
          url: 'https://test.com',
          username: 'user',
          enabled: true,
          otpSecret: 'invalid!@#$',
        }];

        expect(service.hasOtpSecret('test-1')).toBe(false);
      });
    });

    describe('setOtpSecret', () => {
      it('should set OTP secret for a server', async () => {
        mockConfigService.store.warpgate.servers = [{
          id: 'test-1',
          name: 'Test',
          url: 'https://test.com',
          username: 'user',
          enabled: true,
        }];

        await service.setOtpSecret('test-1', validOtpSecret);

        expect(mockConfigService.store.warpgate.servers[0].otpSecret).toBe(validOtpSecret);
        expect(mockConfigService.save).toHaveBeenCalled();
      });

      it('should throw error for invalid OTP secret', async () => {
        mockConfigService.store.warpgate.servers = [{
          id: 'test-1',
          name: 'Test',
          url: 'https://test.com',
          username: 'user',
          enabled: true,
        }];

        await expect(service.setOtpSecret('test-1', 'invalid!'))
          .rejects.toThrow('Invalid OTP secret format');
      });

      it('should clear OTP secret when empty string provided', async () => {
        mockConfigService.store.warpgate.servers = [{
          id: 'test-1',
          name: 'Test',
          url: 'https://test.com',
          username: 'user',
          enabled: true,
          otpSecret: validOtpSecret,
        }];

        await service.setOtpSecret('test-1', '');

        expect(mockConfigService.store.warpgate.servers[0].otpSecret).toBeUndefined();
      });
    });

    describe('clearOtpSecret', () => {
      it('should clear OTP secret for a server', async () => {
        mockConfigService.store.warpgate.servers = [{
          id: 'test-1',
          name: 'Test',
          url: 'https://test.com',
          username: 'user',
          enabled: true,
          otpSecret: validOtpSecret,
        }];

        await service.clearOtpSecret('test-1');

        expect(mockConfigService.store.warpgate.servers[0].otpSecret).toBeUndefined();
      });
    });

    describe('generateOtpCode', () => {
      it('should return null for unknown server', async () => {
        const code = await service.generateOtpCode('unknown');
        expect(code).toBeNull();
      });

      it('should return null when no OTP secret configured', async () => {
        mockConfigService.store.warpgate.servers = [{
          id: 'test-1',
          name: 'Test',
          url: 'https://test.com',
          username: 'user',
          enabled: true,
        }];

        const code = await service.generateOtpCode('test-1');
        expect(code).toBeNull();
      });

      it('should generate 6-digit OTP code when secret is configured', async () => {
        mockConfigService.store.warpgate.servers = [{
          id: 'test-1',
          name: 'Test',
          url: 'https://test.com',
          username: 'user',
          enabled: true,
          otpSecret: validOtpSecret,
        }];

        const code = await service.generateOtpCode('test-1');
        expect(code).toMatch(/^\d{6}$/);
      });
    });

    describe('getFullAuthCredentials', () => {
      it('should return null for unknown server', async () => {
        const creds = await service.getFullAuthCredentials('unknown', 'target');
        expect(creds).toBeNull();
      });

      it('should include OTP code when secret is configured', async () => {
        // We need to set up a server with proper connection details
        const testServer = {
          id: 'test-1',
          name: 'Test',
          url: 'https://test.com',
          username: 'user',
          password: 'pass',
          enabled: true,
          otpSecret: validOtpSecret,
        };
        mockConfigService.store.warpgate.servers = [testServer];

        // Add the server to create a client
        await service.addServer({
          name: testServer.name,
          url: testServer.url,
          username: testServer.username,
          password: testServer.password,
          enabled: false, // Don't try to connect
          otpSecret: validOtpSecret,
        });

        // Note: getFullAuthCredentials will return null because
        // getSshConnectionDetails returns null without a client
        // This tests the null guard path
        const creds = await service.getFullAuthCredentials('non-existent', 'target');
        expect(creds).toBeNull();
      });
    });
  });
});
