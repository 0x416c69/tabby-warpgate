/**
 * Unit tests for WarpgateProfileProvider
 */

import { WarpgateProfileProvider } from '../services/warpgate-profile.service';
import { WarpgateHostSettingsService } from '../services/host-settings.service';
import { WarpgateService } from '../services/warpgate.service';
import {
  WarpgateServerConfig,
  WarpgateTarget,
  WarpgatePluginConfig,
  DEFAULT_WARPGATE_CONFIG,
} from '../models/warpgate.models';

const createMockWarpgateService = () => {
  const config: WarpgatePluginConfig = {
    ...DEFAULT_WARPGATE_CONFIG,
    servers: [],
    pinnedHosts: [],
    hostSettings: {},
    snippets: [],
    history: [],
  };
  return {
    config,
    getAllTargets: jest.fn().mockReturnValue([]),
    getServers: jest.fn().mockReturnValue([]),
    getServer: jest.fn(),
    getTarget: jest.fn(),
    ensureConnected: jest.fn().mockResolvedValue(true),
    getSshConnectionDetails: jest.fn().mockReturnValue({
      host: 'warpgate.example.com',
      port: 2222,
      username: 'testuser:production-web',
      password: 'testpass',
      useTicket: false,
      hasOtpSecret: false,
    }),
    getOrCreateTicket: jest.fn().mockResolvedValue(null),
    getFullAuthCredentials: jest.fn().mockResolvedValue({
      host: 'warpgate.example.com',
      port: 2222,
      username: 'testuser:production-web',
      password: 'testpass',
      useTicket: false,
    }),
    getConfig: jest.fn(() => config),
    saveConfig: jest.fn((partial: Partial<WarpgatePluginConfig>) => Object.assign(config, partial)),
  };
};

describe('WarpgateProfileProvider', () => {
  let provider: WarpgateProfileProvider;
  let mockService: ReturnType<typeof createMockWarpgateService>;
  let hostSettings: WarpgateHostSettingsService;
  let injector: { get: jest.Mock };

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
    hostSettings = new WarpgateHostSettingsService(mockService as unknown as WarpgateService);
    injector = { get: jest.fn() };
    provider = new WarpgateProfileProvider(
      mockService as unknown as WarpgateService,
      hostSettings,
      injector as any
    );
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

    it('should wait for enabled servers without forcing reconnects', async () => {
      mockService.getServers.mockReturnValue([mockServer, { ...mockServer, id: 'server-2', enabled: false }]);

      await provider.getBuiltinProfiles();

      expect(mockService.ensureConnected).toHaveBeenCalledTimes(1);
      expect(mockService.ensureConnected).toHaveBeenCalledWith('server-1');
    });

    it('should skip targets without connection details instead of failing', async () => {
      mockService.getAllTargets.mockReturnValue([
        { server: mockServer, target: mockTarget },
        { server: mockServer, target: { ...mockTarget, name: 'broken' } },
      ]);
      mockService.getSshConnectionDetails
        .mockReturnValueOnce(mockService.getSshConnectionDetails())
        .mockReturnValueOnce(null);

      const profiles = await provider.getBuiltinProfiles();

      expect(profiles).toHaveLength(1);
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

    it('should use password connection details, never a ticket', () => {
      const profile = provider.createProfileFromTarget(mockServer, mockTarget);

      expect(profile.options.host).toBe('warpgate.example.com');
      expect(profile.options.port).toBe(2222);
      expect(profile.options.user).toBe('testuser:production-web');
      expect(profile.options.auth).toBeNull();
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

    it('should keep Tabby defaults when the host has no customization', () => {
      const profile = provider.createProfileFromTarget(mockServer, mockTarget);

      expect(profile.options).not.toHaveProperty('agentForward');
      expect(profile.options).not.toHaveProperty('forwardedPorts');
      expect(profile.options).not.toHaveProperty('scripts');
    });

    it('should apply alias, color and SSH options from host settings', () => {
      mockService.config.snippets = [{ id: 'snip-1', name: 'Logs', script: 'tail -f /var/log/syslog' }];
      hostSettings.updateSettings('server-1', 'production-web', {
        alias: 'Web (prod)',
        color: '#ec4899',
        agentForward: true,
        keepaliveInterval: 15000,
        startupSnippetId: 'snip-1',
        forwardedPorts: [{ type: 'Local', host: '127.0.0.1', port: 8080, targetAddress: 'localhost', targetPort: 80 }],
      });

      const profile = provider.createProfileFromTarget(mockServer, mockTarget);

      expect(profile.name).toBe('Web (prod)');
      expect(profile.color).toBe('#ec4899');
      expect(profile.options.agentForward).toBe(true);
      expect(profile.options.keepaliveInterval).toBe(15000);
      expect(profile.options.scripts).toEqual([{ expect: '', send: 'tail -f /var/log/syslog' }]);
      expect(profile.options.forwardedPorts).toEqual([
        { type: 'Local', host: '127.0.0.1', port: 8080, targetAddress: 'localhost', targetPort: 80, description: '' },
      ]);
    });

    it('should inherit SSH options from the server', () => {
      const profile = provider.createProfileFromTarget({ ...mockServer, x11: true, agentForward: true }, mockTarget);

      expect(profile.options.x11).toBe(true);
      expect(profile.options.agentForward).toBe(true);
    });
  });

  describe('createOneClickProfile', () => {
    it('should use a fresh ticket when one can be created', async () => {
      mockService.getOrCreateTicket.mockResolvedValue({ host: 'wg', port: 2222, username: 'ticket-abc' });

      const profile = await provider.createOneClickProfile(mockServer, mockTarget);

      expect(profile.id).toBe('warpgate:server-1:production-web:ticket');
      expect(profile.options.user).toBe('ticket-abc');
      expect(profile.options.auth).toBe('password');
    });

    it('should fall back to password authentication in auto mode', async () => {
      const profile = await provider.createOneClickProfile(mockServer, mockTarget);

      expect(profile.id).toBe('warpgate:server-1:production-web:autoauth');
      expect(profile.options.user).toBe('testuser:production-web');
      expect(profile.options.password).toBe('testpass');
    });

    it('should fail in ticket-only mode when no ticket can be created', async () => {
      mockService.config.authMethod = 'ticket';

      await expect(provider.createOneClickProfile(mockServer, mockTarget))
        .rejects.toThrow('Ticket-only mode');
    });

    it('should not ask for a ticket in password mode', async () => {
      mockService.config.authMethod = 'password';

      await provider.createOneClickProfile(mockServer, mockTarget);

      expect(mockService.getOrCreateTicket).not.toHaveBeenCalled();
    });
  });

  describe('getSuggestedName', () => {
    it('should return target name from warpgate metadata', () => {
      const profile = provider.createProfileFromTarget(mockServer, mockTarget);
      const name = provider.getSuggestedName(profile);

      expect(name).toBe('production-web');
    });

    it('should resolve the target from the profile ID when metadata is missing', () => {
      const name = provider.getSuggestedName({ id: 'warpgate:server-1:db-01:ticket', type: 'ssh', name: 'x' } as any);

      expect(name).toBe('db-01');
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

    it('should describe profiles that only carry the ID', () => {
      mockService.getServer.mockReturnValue(mockServer);
      mockService.getTarget.mockReturnValue(mockTarget);

      const description = provider.getDescription({ id: 'warpgate:server-1:production-web', type: 'ssh', name: 'x' } as any);

      expect(description).toBe('Warpgate: Test Server - Production web server');
    });

    it('should return host as fallback', () => {
      const profile = { options: { host: 'example.com' }, type: 'ssh' };
      const description = provider.getDescription(profile as any);

      expect(description).toBe('example.com');
    });
  });

  describe('getNewTabParameters', () => {
    it('should let Tabby\'s SSH provider open the profile', async () => {
      const sshParams = { type: class SSHTab {}, inputs: { profile: {} } };
      const sshProvider = { id: 'ssh', getNewTabParameters: jest.fn().mockResolvedValue(sshParams) };
      const profilesService = {
        getProviders: () => [provider, sshProvider],
        getConfigProxyForProfile: jest.fn((profile: unknown) => profile),
      };
      injector.get.mockReturnValue(profilesService);

      const profile = provider.createProfileFromTarget(mockServer, mockTarget);
      const params = await provider.getNewTabParameters(profile);

      expect(params).toBe(sshParams);
      expect(sshProvider.getNewTabParameters).toHaveBeenCalledWith(expect.objectContaining({ type: 'ssh', id: profile.id }));
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
