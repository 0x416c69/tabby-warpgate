/**
 * Unit tests for Warpgate models
 */

import {
  DEFAULT_WARPGATE_CONFIG,
  WarpgateServerConfig,
  WarpgateTarget,
  WarpgatePluginConfig,
  WarpgateConnectionStatus,
  TargetKind,
  BootstrapThemeColor,
  WarpgateTicketRequest,
  WarpgateTicket,
  WarpgateTicketAndSecret,
  WarpgateCachedTicket,
} from '../models/warpgate.models';

describe('Warpgate Models', () => {
  describe('DEFAULT_WARPGATE_CONFIG', () => {
    it('should have default values', () => {
      expect(DEFAULT_WARPGATE_CONFIG).toEqual({
        servers: [],
        autoRefreshInterval: 60000,
        showOfflineServers: true,
        groupByServer: true,
        sortBy: 'name',
        defaultSftpPath: '~',
      });
    });

    it('should have empty servers array', () => {
      expect(DEFAULT_WARPGATE_CONFIG.servers).toHaveLength(0);
    });

    it('should have 60 second auto refresh interval', () => {
      expect(DEFAULT_WARPGATE_CONFIG.autoRefreshInterval).toBe(60000);
    });
  });

  describe('WarpgateServerConfig', () => {
    it('should create a valid server config', () => {
      const server: WarpgateServerConfig = {
        id: 'test-server-1',
        name: 'Test Server',
        url: 'https://warpgate.example.com',
        username: 'testuser',
        password: 'testpass',
        enabled: true,
        trustSelfSigned: false,
      };

      expect(server.id).toBe('test-server-1');
      expect(server.name).toBe('Test Server');
      expect(server.url).toBe('https://warpgate.example.com');
      expect(server.username).toBe('testuser');
      expect(server.password).toBe('testpass');
      expect(server.enabled).toBe(true);
      expect(server.trustSelfSigned).toBe(false);
    });

    it('should allow optional fields', () => {
      const server: WarpgateServerConfig = {
        id: 'test-server-2',
        name: 'Minimal Server',
        url: 'https://warpgate.example.com',
        username: 'user',
        enabled: true,
      };

      expect(server.password).toBeUndefined();
      expect(server.lastConnected).toBeUndefined();
      expect(server.trustSelfSigned).toBeUndefined();
    });
  });

  describe('WarpgateTarget', () => {
    it('should create a valid SSH target', () => {
      const target: WarpgateTarget = {
        name: 'production-server',
        description: 'Production application server',
        kind: 'Ssh',
        external_host: 'prod.example.com',
        group: {
          id: 'group-1',
          name: 'Production',
          color: 'success',
        },
      };

      expect(target.name).toBe('production-server');
      expect(target.description).toBe('Production application server');
      expect(target.kind).toBe('Ssh');
      expect(target.external_host).toBe('prod.example.com');
      expect(target.group?.name).toBe('Production');
      expect(target.group?.color).toBe('success');
    });

    it('should support all target kinds', () => {
      const kinds: TargetKind[] = ['Ssh', 'Http', 'MySql', 'WebAdmin'];

      kinds.forEach(kind => {
        const target: WarpgateTarget = {
          name: `${kind.toLowerCase()}-target`,
          description: `${kind} target`,
          kind,
        };

        expect(target.kind).toBe(kind);
      });
    });

    it('should support all bootstrap theme colors', () => {
      const colors: BootstrapThemeColor[] = [
        'primary', 'secondary', 'success', 'danger',
        'warning', 'info', 'light', 'dark',
      ];

      colors.forEach(color => {
        const target: WarpgateTarget = {
          name: 'test',
          description: 'test',
          kind: 'Ssh',
          group: {
            id: '1',
            name: 'Test',
            color,
          },
        };

        expect(target.group?.color).toBe(color);
      });
    });

    it('should allow target without group', () => {
      const target: WarpgateTarget = {
        name: 'ungrouped-server',
        description: 'Server without group',
        kind: 'Ssh',
      };

      expect(target.group).toBeUndefined();
    });
  });

  describe('WarpgateConnectionStatus', () => {
    it('should track connected status', () => {
      const status: WarpgateConnectionStatus = {
        serverId: 'server-1',
        connected: true,
        lastChecked: new Date(),
        targets: [
          { name: 'target-1', description: 'Test', kind: 'Ssh' },
        ],
      };

      expect(status.connected).toBe(true);
      expect(status.lastError).toBeUndefined();
      expect(status.targets).toHaveLength(1);
    });

    it('should track disconnected status with error', () => {
      const status: WarpgateConnectionStatus = {
        serverId: 'server-1',
        connected: false,
        lastError: 'Connection refused',
        lastChecked: new Date(),
        targets: [],
      };

      expect(status.connected).toBe(false);
      expect(status.lastError).toBe('Connection refused');
      expect(status.targets).toHaveLength(0);
    });
  });

  describe('WarpgatePluginConfig', () => {
    it('should create a valid plugin config', () => {
      const config: WarpgatePluginConfig = {
        servers: [
          {
            id: 'server-1',
            name: 'Server 1',
            url: 'https://wg1.example.com',
            username: 'user1',
            enabled: true,
          },
        ],
        autoRefreshInterval: 120000,
        showOfflineServers: false,
        groupByServer: false,
        sortBy: 'group',
        defaultSftpPath: '/home/user',
      };

      expect(config.servers).toHaveLength(1);
      expect(config.autoRefreshInterval).toBe(120000);
      expect(config.showOfflineServers).toBe(false);
      expect(config.groupByServer).toBe(false);
      expect(config.sortBy).toBe('group');
      expect(config.defaultSftpPath).toBe('/home/user');
    });

    it('should support all sort options', () => {
      const sortOptions = ['name', 'server', 'kind', 'group'] as const;

      sortOptions.forEach(sortBy => {
        const config: WarpgatePluginConfig = {
          ...DEFAULT_WARPGATE_CONFIG,
          sortBy,
        };

        expect(config.sortBy).toBe(sortBy);
      });
    });
  });

  describe('WarpgateTicketRequest', () => {
    it('should create a valid ticket request', () => {
      const request: WarpgateTicketRequest = {
        username: 'testuser',
        target_name: 'my-server',
        number_of_uses: 1,
        description: 'Test ticket',
      };

      expect(request.username).toBe('testuser');
      expect(request.target_name).toBe('my-server');
      expect(request.number_of_uses).toBe(1);
      expect(request.description).toBe('Test ticket');
    });

    it('should allow optional fields', () => {
      const request: WarpgateTicketRequest = {
        username: 'testuser',
        target_name: 'my-server',
      };

      expect(request.expiry).toBeUndefined();
      expect(request.number_of_uses).toBeUndefined();
      expect(request.description).toBeUndefined();
    });

    it('should support expiry date', () => {
      const request: WarpgateTicketRequest = {
        username: 'testuser',
        target_name: 'my-server',
        expiry: '2025-12-31T23:59:59Z',
      };

      expect(request.expiry).toBe('2025-12-31T23:59:59Z');
    });
  });

  describe('WarpgateTicket', () => {
    it('should create a valid ticket', () => {
      const ticket: WarpgateTicket = {
        id: 'ticket-uuid-123',
        username: 'testuser',
        target_name: 'my-server',
        created: '2025-01-01T00:00:00Z',
        uses_left: 5,
        description: 'A test ticket',
      };

      expect(ticket.id).toBe('ticket-uuid-123');
      expect(ticket.username).toBe('testuser');
      expect(ticket.target_name).toBe('my-server');
      expect(ticket.created).toBe('2025-01-01T00:00:00Z');
      expect(ticket.uses_left).toBe(5);
      expect(ticket.description).toBe('A test ticket');
    });

    it('should allow optional expiry', () => {
      const ticket: WarpgateTicket = {
        id: 'ticket-uuid-123',
        username: 'testuser',
        target_name: 'my-server',
        created: '2025-01-01T00:00:00Z',
      };

      expect(ticket.expiry).toBeUndefined();
      expect(ticket.uses_left).toBeUndefined();
    });
  });

  describe('WarpgateTicketAndSecret', () => {
    it('should contain ticket and secret', () => {
      const ticketAndSecret: WarpgateTicketAndSecret = {
        ticket: {
          id: 'ticket-uuid-123',
          username: 'testuser',
          target_name: 'my-server',
          created: '2025-01-01T00:00:00Z',
        },
        secret: 'abc123secret456',
      };

      expect(ticketAndSecret.ticket.id).toBe('ticket-uuid-123');
      expect(ticketAndSecret.secret).toBe('abc123secret456');
    });
  });

  describe('WarpgateCachedTicket', () => {
    it('should track ticket cache data', () => {
      const cachedTicket: WarpgateCachedTicket = {
        serverId: 'server-1',
        targetName: 'my-server',
        secret: 'abc123secret456',
        expiresAt: new Date('2025-12-31T23:59:59Z'),
        usesLeft: 1,
      };

      expect(cachedTicket.serverId).toBe('server-1');
      expect(cachedTicket.targetName).toBe('my-server');
      expect(cachedTicket.secret).toBe('abc123secret456');
      expect(cachedTicket.expiresAt).toEqual(new Date('2025-12-31T23:59:59Z'));
      expect(cachedTicket.usesLeft).toBe(1);
    });

    it('should support non-expiring tickets', () => {
      const cachedTicket: WarpgateCachedTicket = {
        serverId: 'server-1',
        targetName: 'my-server',
        secret: 'abc123secret456',
        expiresAt: null,
        usesLeft: -1, // Unlimited uses
      };

      expect(cachedTicket.expiresAt).toBeNull();
      expect(cachedTicket.usesLeft).toBe(-1);
    });
  });
});
