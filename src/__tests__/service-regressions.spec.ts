/**
 * Regression tests for WarpgateService connection, ticket and config handling
 */

import { Subject } from 'rxjs';
import { WarpgateService } from '../services/warpgate.service';
import { DEFAULT_WARPGATE_CONFIG, WarpgateServerConfig, WarpgateTarget } from '../models/warpgate.models';

const SERVER_ID = 'wg-test';

function loginResponse(state: 'Accepted' | 'Need' | 'Rejected', methods: string[] = [], reason?: string) {
  return {
    success: true,
    data: {
      success: true,
      state: {
        protocol: 'http',
        address: '',
        started: true,
        auth: { state, methods_remaining: methods, reason },
      },
    },
  };
}

function target(name: string): WarpgateTarget {
  return { name, description: '', kind: 'Ssh' };
}

function createFakeClient(overrides: Record<string, unknown> = {}) {
  return {
    login: jest.fn().mockResolvedValue(loginResponse('Accepted')),
    submitOtp: jest.fn().mockResolvedValue(loginResponse('Accepted')),
    logout: jest.fn().mockResolvedValue({ success: true }),
    getSshTargets: jest.fn().mockResolvedValue({ success: true, data: [target('web')] }),
    getUserInfo: jest.fn().mockResolvedValue({ success: true, data: { username: 'admin', ports: { ssh: 2022 } } }),
    isSessionValid: jest.fn().mockResolvedValue(true),
    setSessionCookie: jest.fn(),
    getSessionCookie: jest.fn().mockReturnValue('warpgate-http-session=abc'),
    hasSession: jest.fn().mockReturnValue(true),
    getSshHost: jest.fn().mockReturnValue('wg.example.com'),
    getSshPort: jest.fn().mockReturnValue(2222),
    createTicket: jest.fn(),
    listTickets: jest.fn().mockResolvedValue({ success: true, data: [] }),
    deleteTicket: jest.fn().mockResolvedValue({ success: true }),
    generateTicketUsername: (secret: string) => `ticket-${secret}`,
    getProfileOtpCredentialIds: jest.fn().mockResolvedValue({ success: true, data: [] }),
    disableProfileOtp: jest.fn().mockResolvedValue({ success: true }),
    autoSetupOtp: jest.fn(),
    ...overrides,
  };
}

type FakeClient = ReturnType<typeof createFakeClient>;

function createConfig(overrides: Partial<typeof DEFAULT_WARPGATE_CONFIG> = {}) {
  return {
    store: {
      warpgate: {
        ...DEFAULT_WARPGATE_CONFIG,
        servers: [] as WarpgateServerConfig[],
        pinnedHosts: [] as string[],
        autoRefreshInterval: 0,
        ...overrides,
      },
    },
    save: jest.fn(),
  };
}

function createNotifications() {
  return { info: jest.fn(), error: jest.fn(), notice: jest.fn() };
}

describe('WarpgateService regressions', () => {
  let config: ReturnType<typeof createConfig>;
  let notifications: ReturnType<typeof createNotifications>;
  let injector: { get: jest.Mock };
  let service: WarpgateService;
  let client: FakeClient;
  let consoleErrorSpy: jest.SpyInstance;

  function addServer(overrides: Partial<WarpgateServerConfig> = {}): WarpgateServerConfig {
    const server: WarpgateServerConfig = {
      id: SERVER_ID,
      name: 'Test Server',
      url: 'https://wg.example.com:8888',
      username: 'admin',
      password: 'secret',
      enabled: true,
      ...overrides,
    };
    config.store.warpgate.servers.push(server);
    (service as any).clients.set(server.id, client);
    return server;
  }

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    config = createConfig();
    notifications = createNotifications();
    injector = { get: jest.fn() };
    client = createFakeClient();
    service = new WarpgateService(config as any, notifications as any, null, injector as any);
  });

  afterEach(() => {
    service.destroy();
    consoleErrorSpy.mockRestore();
  });

  describe('login', () => {
    it('should not report a server as connected when the password is rejected', async () => {
      addServer();
      client.login.mockResolvedValueOnce(loginResponse('Rejected', [], 'Invalid credentials'));

      const connected = await service.connect(SERVER_ID);

      expect(connected).toBe(false);
      expect(service.isConnected(SERVER_ID)).toBe(false);
      expect(service.getConnectionStatus(SERVER_ID)?.lastError).toBe('Invalid credentials');
      expect(client.getSshTargets).not.toHaveBeenCalled();
    });

    it('should not report a server as connected when the password is still needed', async () => {
      addServer();
      client.login.mockResolvedValueOnce(loginResponse('Need', ['Password']));

      await expect(service.connect(SERVER_ID)).resolves.toBe(false);
      expect(service.getConnectionStatus(SERVER_ID)?.lastError).toBe('Invalid credentials');
    });

    it('should explain unsupported second factors', async () => {
      addServer();
      client.login.mockResolvedValueOnce(loginResponse('Need', ['Sso']));

      await expect(service.connect(SERVER_ID)).resolves.toBe(false);
      expect(service.getConnectionStatus(SERVER_ID)?.lastError).toContain('Sso');
    });

    it('should submit a generated OTP code and connect', async () => {
      addServer({ otpSecret: 'JBSWY3DPEHPK3PXP' });
      client.login.mockResolvedValueOnce(loginResponse('Need', ['Otp']));

      await expect(service.connect(SERVER_ID)).resolves.toBe(true);
      expect(client.submitOtp).toHaveBeenCalledWith(expect.stringMatching(/^\d{6}$/));
      expect(service.getServerTargets(SERVER_ID)).toHaveLength(1);
    });

    it('should fail when the OTP code is rejected', async () => {
      addServer({ otpSecret: 'JBSWY3DPEHPK3PXP' });
      client.login.mockResolvedValueOnce(loginResponse('Need', ['Otp']));
      client.submitOtp.mockResolvedValueOnce(loginResponse('Rejected', [], 'Invalid credentials'));

      await expect(service.connect(SERVER_ID)).resolves.toBe(false);
      expect(service.getConnectionStatus(SERVER_ID)?.lastError).toContain('OTP verification failed');
    });

    it('should reuse a still valid session instead of logging in again', async () => {
      addServer();
      await service.connect(SERVER_ID);
      client.login.mockClear();

      await expect(service.connect(SERVER_ID)).resolves.toBe(true);

      expect(client.isSessionValid).toHaveBeenCalled();
      expect(client.login).not.toHaveBeenCalled();
    });

    it('should log in again when the stored session is no longer valid', async () => {
      addServer();
      await service.connect(SERVER_ID);
      client.login.mockClear();
      client.isSessionValid.mockResolvedValueOnce(false);

      await expect(service.connect(SERVER_ID)).resolves.toBe(true);

      expect(client.login).toHaveBeenCalledTimes(1);
    });
  });

  describe('session expiry', () => {
    it('should log in again and retry when refreshing targets returns 401', async () => {
      jest.useFakeTimers();
      try {
        addServer();
        await service.connect(SERVER_ID);
        client.login.mockClear();

        const unauthorized = { success: false, error: { status: 401, message: 'Unauthorized' } };
        client.getSshTargets
          .mockResolvedValueOnce(unauthorized)
          .mockResolvedValueOnce(unauthorized)
          .mockResolvedValueOnce({ success: true, data: [target('web'), target('db')] });

        const refresh = service.refreshTargets(SERVER_ID);
        await jest.advanceTimersByTimeAsync(600);
        const targets = await refresh;

        expect(client.login).toHaveBeenCalledTimes(1);
        expect(targets.map(t => t.name)).toEqual(['web', 'db']);
        expect(service.isConnected(SERVER_ID)).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should mark the server offline when logging in again fails', async () => {
      jest.useFakeTimers();
      try {
        addServer();
        await service.connect(SERVER_ID);

        const unauthorized = { success: false, error: { status: 401, message: 'Unauthorized' } };
        client.getSshTargets.mockResolvedValue(unauthorized);
        client.login.mockResolvedValueOnce(loginResponse('Rejected', [], 'Invalid credentials'));

        const refresh = service.refreshTargets(SERVER_ID);
        await jest.advanceTimersByTimeAsync(600);
        await refresh;

        expect(service.isConnected(SERVER_ID)).toBe(false);
        expect(service.getConnectionStatus(SERVER_ID)?.lastError).toContain('Session expired');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should not log in again when the session is valid but a permission is missing', async () => {
      addServer();
      await service.connect(SERVER_ID);
      client.login.mockClear();
      // Warpgate answers 401 to admin API calls of users without admin permissions
      client.createTicket.mockResolvedValue({ success: false, error: { status: 401, message: 'Unauthorized' } });

      await expect(service.getOrCreateTicket(SERVER_ID, 'web')).resolves.toBeNull();

      expect(client.login).not.toHaveBeenCalled();
      expect(client.createTicket).toHaveBeenCalledTimes(1);
      expect(service.areTicketsUnavailable(SERVER_ID)).toBe(true);
    });

    it('should log in again and retry when ticket creation returns 401', async () => {
      addServer();
      await service.connect(SERVER_ID);
      client.login.mockClear();
      client.isSessionValid.mockResolvedValueOnce(false);
      client.createTicket
        .mockResolvedValueOnce({ success: false, error: { status: 401, message: 'Unauthorized' } })
        .mockResolvedValueOnce({ success: true, data: { ticket: { id: 't1', uses_left: 1 }, secret: 's1' } });

      const details = await service.getOrCreateTicket(SERVER_ID, 'web');

      expect(client.login).toHaveBeenCalledTimes(1);
      expect(details?.username).toBe('ticket-s1');
    });
  });

  describe('SSH endpoint', () => {
    it('should use the SSH port reported by the server instead of the URL port', async () => {
      addServer();
      await service.connect(SERVER_ID);

      expect(service.getSshEndpoint(SERVER_ID)).toEqual({ host: 'wg.example.com', port: 2022 });
    });

    it('should combine external_host with the reported SSH port', async () => {
      client.getUserInfo.mockResolvedValue({
        success: true,
        data: { username: 'admin', external_host: 'ssh.example.com', ports: { ssh: 22 } },
      });
      addServer();
      await service.connect(SERVER_ID);

      expect(service.getSshEndpoint(SERVER_ID)).toEqual({ host: 'ssh.example.com', port: 22 });
    });

    it('should strip brackets from IPv6 external hosts', async () => {
      client.getUserInfo.mockResolvedValue({
        success: true,
        data: { username: 'admin', external_host: '[2001:db8::1]', ports: { ssh: 2222 } },
      });
      addServer();
      await service.connect(SERVER_ID);

      expect(service.getSshEndpoint(SERVER_ID)).toEqual({ host: '2001:db8::1', port: 2222 });
    });
  });

  describe('tickets', () => {
    it('should create one-time tickets that expire', async () => {
      addServer();
      await service.connect(SERVER_ID);
      client.createTicket.mockResolvedValueOnce({
        success: true,
        data: { ticket: { id: 't1', uses_left: 1 }, secret: 's1' },
      });

      const details = await service.getOrCreateTicket(SERVER_ID, 'web');

      expect(details).toEqual({ host: 'wg.example.com', port: 2022, username: 'ticket-s1' });
      const request = client.createTicket.mock.calls[0][0];
      expect(request.number_of_uses).toBe(1);
      expect(Date.parse(request.expiry)).toBeGreaterThan(Date.now());
      expect(request.description).toContain('Tabby Warpgate auto-generated');
    });

    it('should create a separate ticket for each simultaneous connection to a target', async () => {
      addServer();
      await service.connect(SERVER_ID);
      client.createTicket
        .mockResolvedValueOnce({ success: true, data: { ticket: { id: 't1', uses_left: 1 }, secret: 's1' } })
        .mockResolvedValueOnce({ success: true, data: { ticket: { id: 't2', uses_left: 1 }, secret: 's2' } });

      // e.g. both panes of a restored split tab connecting to the same host
      const [first, second] = await Promise.all([
        service.getOrCreateTicket(SERVER_ID, 'web'),
        service.getOrCreateTicket(SERVER_ID, 'web'),
      ]);

      expect(client.createTicket).toHaveBeenCalledTimes(2);
      expect([first?.username, second?.username].sort()).toEqual(['ticket-s1', 'ticket-s2']);
      expect(service.claimUnusedTicket('ticket-s1')).toBe(true);
      expect(service.claimUnusedTicket('ticket-s2')).toBe(true);
      expect(service.claimUnusedTicket('ticket-s1')).toBe(false);
    });

    it('should never put tickets in the reusable connection details', async () => {
      addServer();
      await service.connect(SERVER_ID);
      client.createTicket.mockResolvedValueOnce({
        success: true,
        data: { ticket: { id: 't1', uses_left: 1 }, secret: 's1' },
      });
      await service.getOrCreateTicket(SERVER_ID, 'web');

      const details = service.getSshConnectionDetails(SERVER_ID, 'web');

      expect(details?.username).toBe('admin:web');
      expect(details?.useTicket).toBe(false);
    });

    it('should report each created ticket as unused exactly once', async () => {
      addServer();
      await service.connect(SERVER_ID);
      client.createTicket.mockResolvedValueOnce({
        success: true,
        data: { ticket: { id: 't1', uses_left: 1 }, secret: 's1' },
      });
      await service.getOrCreateTicket(SERVER_ID, 'web');

      expect(service.claimUnusedTicket('ticket-s1')).toBe(true);
      expect(service.claimUnusedTicket('ticket-s1')).toBe(false);
      expect(service.claimUnusedTicket('ticket-unknown')).toBe(false);
      expect(service.claimUnusedTicket('admin:web')).toBe(false);
    });

    it('should return null instead of password details when ticket creation fails', async () => {
      addServer();
      await service.connect(SERVER_ID);
      client.createTicket.mockResolvedValueOnce({ success: false, error: { status: 500, message: 'Boom' } });

      await expect(service.getOrCreateTicket(SERVER_ID, 'web')).resolves.toBeNull();
    });

    it('should stop asking for tickets and warn once when the user lacks permission', async () => {
      addServer();
      await service.connect(SERVER_ID);
      notifications.notice.mockClear();
      client.createTicket.mockResolvedValue({ success: false, error: { status: 403, message: 'Forbidden' } });

      await service.getOrCreateTicket(SERVER_ID, 'web');
      await service.getOrCreateTicket(SERVER_ID, 'db');

      expect(client.createTicket).toHaveBeenCalledTimes(1);
      expect(notifications.notice).toHaveBeenCalledTimes(1);
      expect(service.areTicketsUnavailable(SERVER_ID)).toBe(true);
    });

    it('should not announce a password fallback in ticket-only mode', async () => {
      config.store.warpgate.authMethod = 'ticket';
      addServer();
      await service.connect(SERVER_ID);
      notifications.notice.mockClear();
      client.createTicket.mockResolvedValue({ success: false, error: { status: 403, message: 'Forbidden' } });

      await service.getOrCreateTicket(SERVER_ID, 'web');

      expect(notifications.notice).not.toHaveBeenCalled();
    });

    it('should explain ticket-only failures caused by missing permissions', async () => {
      config.store.warpgate.authMethod = 'ticket';
      addServer();
      await service.connect(SERVER_ID);
      client.createTicket.mockResolvedValue({ success: false, error: { status: 403, message: 'Forbidden' } });

      await expect(service.getConnectionCredentials(SERVER_ID, 'web')).resolves.toBeNull();

      const message = notifications.error.mock.calls.map(call => call[0]).find(text => text.startsWith('Cannot connect to web'));
      expect(message).toContain('"admin" is not allowed to create tickets');
      expect(message).toContain('"Automatic"');
    });

    it('should clean up used and expired plugin tickets only', async () => {
      addServer();
      await service.connect(SERVER_ID);
      const prefix = 'Tabby Warpgate auto-generated ticket for web';
      client.listTickets.mockResolvedValueOnce({
        success: true,
        data: [
          { id: 'used', description: prefix, uses_left: 0 },
          { id: 'expired', description: prefix, uses_left: 1, expiry: '2000-01-01T00:00:00Z' },
          { id: 'fresh', description: prefix, uses_left: 1, expiry: '2999-01-01T00:00:00Z' },
          { id: 'foreign', description: 'Created by someone else', uses_left: 0 },
        ],
      });

      const deleted = await service.cleanupUsedTickets(SERVER_ID);

      expect(deleted).toBe(2);
      expect(client.deleteTicket.mock.calls.map(call => call[0])).toEqual(['used', 'expired']);
    });

    it('should stop trying to clean up tickets when the user may not list them', async () => {
      addServer();
      await service.connect(SERVER_ID);
      client.listTickets.mockResolvedValue({ success: false, error: { status: 401, message: 'Unauthorized' } });

      await service.cleanupUsedTickets(SERVER_ID);
      await service.cleanupUsedTickets(SERVER_ID);

      expect(client.listTickets).toHaveBeenCalledTimes(1);
      expect(client.login).toHaveBeenCalledTimes(1);
    });
  });

  describe('server management', () => {
    it('should hide hosts and end the session when a server is disabled', async () => {
      addServer();
      await service.connect(SERVER_ID);
      expect(service.getAllTargets()).toHaveLength(1);

      await service.updateServer(SERVER_ID, { enabled: false });

      expect(client.logout).toHaveBeenCalled();
      expect(service.getAllTargets()).toHaveLength(0);
      expect(service.getConnectionStatus(SERVER_ID)).toBeUndefined();
    });

    it('should connect when a disabled server is enabled', async () => {
      addServer({ enabled: false });
      const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue(true);

      await service.updateServer(SERVER_ID, { enabled: true });

      expect(connectSpy).toHaveBeenCalledWith(SERVER_ID);
    });

    it('should not reconnect when saving unchanged connection settings', async () => {
      const server = addServer();
      await service.connect(SERVER_ID);
      const connectSpy = jest.spyOn(service, 'connect');

      await service.updateServer(SERVER_ID, {
        name: 'Renamed',
        url: server.url,
        username: server.username,
        password: server.password,
        trustSelfSigned: false,
        enabled: true,
      });

      expect(connectSpy).not.toHaveBeenCalled();
      expect(service.isConnected(SERVER_ID)).toBe(true);
    });

    it('should drop old hosts and reconnect when the URL changes', async () => {
      addServer();
      await service.connect(SERVER_ID);
      const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue(false);

      await service.updateServer(SERVER_ID, { url: 'https://other.example.com' });

      expect(connectSpy).toHaveBeenCalledWith(SERVER_ID);
      expect(service.getServerTargets(SERVER_ID)).toEqual([]);
    });

    it('should remove hosts and pins of a removed server', async () => {
      addServer();
      await service.connect(SERVER_ID);
      config.store.warpgate.pinnedHosts = [`${SERVER_ID}:web`, 'other:db'];
      const emitted: number[] = [];
      service.targets$.subscribe(targets => emitted.push(targets.size));

      service.removeServer(SERVER_ID);

      expect(emitted[emitted.length - 1]).toBe(0);
      expect(service.getAllTargets()).toHaveLength(0);
      expect(config.store.warpgate.pinnedHosts).toEqual(['other:db']);
    });
  });

  describe('config', () => {
    it('should persist pinned hosts and view mode', () => {
      service.saveConfig({ pinnedHosts: ['a:b'], viewMode: 'compact' });

      expect(config.store.warpgate.pinnedHosts).toEqual(['a:b']);
      expect(config.store.warpgate.viewMode).toBe('compact');
      expect(config.save).toHaveBeenCalled();
    });

    it('should not lose servers when saving the store array itself', () => {
      addServer();

      service.saveConfig({ servers: config.store.warpgate.servers });

      expect(config.store.warpgate.servers).toHaveLength(1);
    });

    it('should store the refresh interval as a number and restart the timer', () => {
      service.saveConfig({ autoRefreshInterval: '30000' as unknown as number });

      expect(config.store.warpgate.autoRefreshInterval).toBe(30000);
      expect((service as any).refreshIntervalMs).toBe(30000);

      service.saveConfig({ autoRefreshInterval: 0 });

      expect((service as any).refreshSubscription).toBeNull();
    });

    it('should wait for the config to be loaded before connecting', () => {
      const ready$ = new Subject<boolean>();
      const connectAllSpy = jest.spyOn(WarpgateService.prototype, 'connectAll').mockResolvedValue();
      try {
        const delayed = new WarpgateService(
          { ...createConfig(), ready$ } as any,
          notifications as any,
          null,
          injector as any
        );
        expect(connectAllSpy).not.toHaveBeenCalled();

        ready$.next(true);

        expect(connectAllSpy).toHaveBeenCalledTimes(1);
        delayed.destroy();
      } finally {
        connectAllSpy.mockRestore();
      }
    });
  });

  describe('loading state', () => {
    it('should stay loading until every connection attempt finished', async () => {
      addServer();
      const secondClient = createFakeClient();
      config.store.warpgate.servers.push({
        id: 'wg-second', name: 'Second', url: 'https://second.example.com', username: 'u', password: 'p', enabled: true,
      });
      (service as any).clients.set('wg-second', secondClient);

      let releaseSecond: (value: unknown) => void = () => undefined;
      secondClient.login.mockReturnValueOnce(new Promise(resolve => {
        releaseSecond = resolve;
      }));

      const states: boolean[] = [];
      service.loading$.subscribe(loading => states.push(loading));

      const first = service.connect(SERVER_ID);
      const second = service.connect('wg-second');
      await first;

      expect(states[states.length - 1]).toBe(true);

      releaseSecond(loginResponse('Accepted'));
      await second;

      expect(states[states.length - 1]).toBe(false);
    });
  });

  describe('OTP', () => {
    it('should not report an error when the OTP prompt is cancelled', async () => {
      injector.get.mockReturnValue({
        open: () => ({ componentInstance: {}, result: Promise.reject(new Error('dismissed')) }),
      });

      const code = await (service as any).promptForOtp('Test Server');

      expect(code).toBeNull();
      expect(notifications.error).not.toHaveBeenCalled();
    });

    it('should remove every OTP credential by ID before clearing the local secret', async () => {
      addServer({ otpSecret: 'JBSWY3DPEHPK3PXP' });
      client.getProfileOtpCredentialIds.mockResolvedValueOnce({ success: true, data: ['otp-1', 'otp-2'] });

      const result = await service.disableOtp(SERVER_ID);

      expect(result.success).toBe(true);
      expect(client.disableProfileOtp.mock.calls.map(call => call[0])).toEqual(['otp-1', 'otp-2']);
      expect(service.getServer(SERVER_ID)?.otpSecret).toBeUndefined();
    });

    it('should keep the local secret when Warpgate refuses to remove OTP', async () => {
      addServer({ otpSecret: 'JBSWY3DPEHPK3PXP' });
      client.getProfileOtpCredentialIds.mockResolvedValueOnce({ success: true, data: ['otp-1'] });
      client.disableProfileOtp.mockResolvedValueOnce({ success: false, error: { status: 403, message: 'Forbidden' } });

      const result = await service.disableOtp(SERVER_ID);

      expect(result.success).toBe(false);
      expect(service.getServer(SERVER_ID)?.otpSecret).toBe('JBSWY3DPEHPK3PXP');
    });
  });

  describe('test connections', () => {
    function mockTestClient(fake: FakeClient): void {
      (service as any).testClients.set('test:https://wg.example.com:admin', fake);
    }

    it('should accept a manually entered OTP code for the pending test session', async () => {
      const fake = createFakeClient();
      mockTestClient(fake);

      const result = await service.testServerConnectionWithOtp('https://wg.example.com', 'admin', '123456');

      expect(result.success).toBe(true);
      expect(fake.submitOtp).toHaveBeenCalledWith('123456');
      expect(fake.logout).not.toHaveBeenCalled();
    });

    it('should not reuse a test session that is still waiting for OTP', async () => {
      const fake = createFakeClient({
        login: jest.fn().mockResolvedValue(loginResponse('Need', ['Otp'])),
      });
      mockTestClient(fake);
      const result = await service.testServerConnectionFull('https://wg.example.com', 'admin', 'secret');
      expect(result.needsOtp).toBe(true);

      const connectSpy = jest.spyOn(service, 'connect').mockResolvedValue(false);
      const server = await service.addServer({
        name: 'Test', url: 'https://wg.example.com', username: 'admin', password: 'secret', enabled: true,
      });

      expect(connectSpy).toHaveBeenCalledWith(server.id);
      expect(service.isConnected(server.id)).toBe(false);
    });
  });
});
