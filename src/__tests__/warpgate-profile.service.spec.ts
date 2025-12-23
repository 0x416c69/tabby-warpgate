/**
 * Unit tests for WarpgateProfileProvider
 */

import { WarpgateProfileProvider } from '../services/warpgate-profile.service';
import { WarpgateService } from '../services/warpgate.service';
import { WarpgateServerConfig, WarpgateTarget, DEFAULT_WARPGATE_CONFIG } from '../models/warpgate.models';

// Mock WarpgateService
const createMockWarpgateService = () => ({
  getAllTargets: jest.fn().mockReturnValue([]),
  getServerTargets: jest.fn().mockReturnValue([]),
  getSshConnectionDetails: jest.fn().mockReturnValue({
    host: 'warpgate.example.com',
    port: 2222,
    username: 'user:target',
  }),
  getConfig: jest.fn().mockReturnValue(DEFAULT_WARPGATE_CONFIG),
  getServer: jest.fn(),
  isConnected: jest.fn().mockReturnValue(true),
});

describe('WarpgateProfileProvider', () => {
  let provider: WarpgateProfileProvider;
  let mockService: ReturnType<typeof createMockWarpgateService>;

  const mockServer: WarpgateServerConfig = {
    id: 'server-1',
    name: 'Test Server',
    url: 'https://warpgate.example.com',
    username: 'testuser',
    password: 'testpass',
    enabled: true,
  };

  const mockTarget: WarpgateTarget = {
    name: 'production-web',
    description: 'Production web server',
    kind: 'Ssh',
    group: {
      id: 'group-1',
      name: 'Production',
      color: 'success',
    },
  };

  beforeEach(() => {
    mockService = createMockWarpgateService();
    provider = new WarpgateProfileProvider(mockService as unknown as WarpgateService);
  });

  describe('provider properties', () => {
    it('should have correct id', () => {
      expect(provider.id).toBe('warpgate-ssh');
    });

    it('should have correct name', () => {
      expect(provider.name).toBe('Warpgate SSH');
    });

    it('should not support quick connect', () => {
      expect(provider.supportsQuickConnect).toBe(false);
    });
  });

  describe('getBuiltinProfiles', () => {
    it('should return empty array when no targets', async () => {
      mockService.getAllTargets.mockReturnValue([]);

      const profiles = await provider.getBuiltinProfiles();

      expect(profiles).toEqual([]);
    });

    it('should return profiles for all targets', async () => {
      mockService.getAllTargets.mockReturnValue([
        { server: mockServer, target: mockTarget },
        { server: mockServer, target: { ...mockTarget, name: 'staging-web' } },
      ]);

      const profiles = await provider.getBuiltinProfiles();

      expect(profiles).toHaveLength(2);
    });
  });

  describe('createProfileFromTarget', () => {
    it('should create a valid SSH profile', () => {
      const profile = provider.createProfileFromTarget(mockServer, mockTarget);

      expect(profile.id).toBe('warpgate:server-1:production-web');
      expect(profile.type).toBe('ssh');
      expect(profile.name).toBe('production-web');
      expect(profile.group).toBe('Warpgate/Production');
      expect(profile.isBuiltin).toBe(true);
    });

    it('should set SSH connection options', () => {
      const profile = provider.createProfileFromTarget(mockServer, mockTarget);

      expect(profile.options.host).toBe('warpgate.example.com');
      expect(profile.options.port).toBe(2222);
      expect(profile.options.user).toBe('user:target');
      expect(profile.options.auth).toBe('password');
      expect(profile.options.password).toBe('testpass');
    });

    it('should include warpgate metadata', () => {
      const profile = provider.createProfileFromTarget(mockServer, mockTarget);

      expect(profile.warpgate).toBeDefined();
      expect(profile.warpgate?.serverId).toBe('server-1');
      expect(profile.warpgate?.serverName).toBe('Test Server');
      expect(profile.warpgate?.targetName).toBe('production-web');
      expect(profile.warpgate?.targetDescription).toBe('Production web server');
      expect(profile.warpgate?.groupName).toBe('Production');
    });

    it('should use server name when target has no group', () => {
      const targetWithoutGroup: WarpgateTarget = {
        name: 'ungrouped-server',
        description: 'No group',
        kind: 'Ssh',
      };

      const profile = provider.createProfileFromTarget(mockServer, targetWithoutGroup);

      expect(profile.group).toBe('Warpgate/Test Server');
    });

    it('should throw error when connection details not available', () => {
      mockService.getSshConnectionDetails.mockReturnValue(null);

      expect(() => provider.createProfileFromTarget(mockServer, mockTarget))
        .toThrow('Cannot get connection details');
    });

    it('should set color based on group color', () => {
      const profile = provider.createProfileFromTarget(mockServer, mockTarget);

      expect(profile.color).toBe('#28a745'); // success color
    });
  });

  describe('getSuggestedName', () => {
    it('should return target name from warpgate metadata', () => {
      const profile = provider.createProfileFromTarget(mockServer, mockTarget);
      const name = provider.getSuggestedName(profile);

      expect(name).toBe('production-web');
    });

    it('should return profile name as fallback', () => {
      const profile = { name: 'fallback-name', type: 'ssh' };
      const name = provider.getSuggestedName(profile as any);

      expect(name).toBe('fallback-name');
    });

    it('should return null for empty profile', () => {
      const profile = { type: 'ssh' };
      const name = provider.getSuggestedName(profile as any);

      expect(name).toBeNull();
    });
  });

  describe('getDescription', () => {
    it('should include server name and description', () => {
      const profile = provider.createProfileFromTarget(mockServer, mockTarget);
      const description = provider.getDescription(profile);

      expect(description).toContain('Warpgate: Test Server');
      expect(description).toContain('Production web server');
    });

    it('should return host as fallback', () => {
      const profile = { options: { host: 'example.com' }, type: 'ssh' };
      const description = provider.getDescription(profile as any);

      expect(description).toBe('example.com');
    });
  });

  describe('getNewTabParameters', () => {
    it('should return SSH tab parameters', async () => {
      const profile = provider.createProfileFromTarget(mockServer, mockTarget);
      const params = await provider.getNewTabParameters(profile);

      expect(params.type).toBe('ssh-tab');
      expect(params.inputs?.profile).toBe(profile);
    });
  });

  describe('quickConnect', () => {
    it('should return null (not supported)', () => {
      const result = provider.quickConnect('user@host');
      expect(result).toBeNull();
    });
  });

  describe('deleteProfile', () => {
    it('should do nothing (builtin profiles cannot be deleted)', () => {
      const profile = provider.createProfileFromTarget(mockServer, mockTarget);

      // Should not throw
      expect(() => provider.deleteProfile(profile)).not.toThrow();
    });
  });
});
