/**
 * Tests for the SSH tab handler and the connection service
 */

import { Subject } from 'rxjs';
import { WarpgateSshHandler } from '../providers/warpgate-ssh-handler.provider';
import { WarpgateHostSettingsService } from '../services/host-settings.service';
import { WarpgateConnectionService } from '../services/connection.service';
import { WarpgateService } from '../services/warpgate.service';
import {
  DEFAULT_WARPGATE_CONFIG,
  WarpgatePluginConfig,
  WarpgateServerConfig,
  WarpgateTarget,
} from '../models/warpgate.models';

const SERVER: WarpgateServerConfig = {
  id: 'wg-1',
  name: 'Gateway',
  url: 'https://wg.example.com',
  username: 'admin',
  password: 'secret',
  enabled: true,
};

const TARGET: WarpgateTarget = { name: 'web', description: 'Web server', kind: 'Ssh' };

function createConfig(): WarpgatePluginConfig {
  return {
    ...DEFAULT_WARPGATE_CONFIG,
    servers: [SERVER],
    pinnedHosts: [],
    hostSettings: {},
    snippets: [],
    history: [],
  };
}

function createWarpgateMock(config = createConfig()) {
  return {
    config,
    getConfig: jest.fn(() => config),
    getServers: jest.fn(() => config.servers),
    getServer: jest.fn((id: string) => config.servers.find(server => server.id === id)),
    saveConfig: jest.fn((partial: Partial<WarpgatePluginConfig>) => Object.assign(config, partial)),
    claimUnusedTicket: jest.fn().mockReturnValue(false),
    getConnectionCredentials: jest.fn().mockResolvedValue({
      host: 'wg.example.com',
      port: 2222,
      username: 'ticket-fresh',
      auth: 'password',
      password: 'x',
      useTicket: true,
    }),
    generateOtpCode: jest.fn().mockResolvedValue('123456'),
    ensureConnected: jest.fn().mockResolvedValue(true),
    getAllTargets: jest.fn(() => [{ server: SERVER, target: TARGET }]),
  };
}

/**
 * Minimal stand-in for Tabby's SSH tab
 */
class FakeSshTab {
  activeKIPrompt: any = null;
  title = 'web';
  initializeCalls: Array<Record<string, any>> = [];
  destroyed$ = new Subject<void>();
  sendInput = jest.fn();

  constructor(public profile: any) {}

  async initializeSession(): Promise<void> {
    this.initializeCalls.push({ ...this.profile.options });
  }

  /** Mirrors ConnectableTerminalTabComponent.reconnect() */
  async reconnect(): Promise<void> {
    await this.initializeSession();
  }
}

class FakeSplitTab {
  tabAdded$ = new Subject<any>();
  constructor(public children: any[]) {}
  getAllTabs(): any[] {
    return this.children;
  }
}

function sshProfile(id: string, options: Record<string, any> = {}) {
  // Tabby's profile proxy does not expose the plugin's "warpgate" metadata
  return { id, type: 'ssh', name: 'web', options: { host: 'wg.example.com', port: 2222, user: 'admin:web', ...options } };
}

/**
 * Keyboard-interactive prompt like Tabby's KeyboardInteractivePrompt
 */
function kiPrompt(name: string, prompts: string[], prefilled: string[] = []) {
  const prompt = {
    name,
    instruction: '',
    prompts: prompts.map(text => ({ prompt: text, echo: false })),
    responses: prompts.map((_, i) => prefilled[i] ?? ''),
    respond: jest.fn(),
  };
  return prompt;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe('WarpgateSshHandler', () => {
  let app: { tabs: any[]; tabOpened$: Subject<any> };
  let warpgate: ReturnType<typeof createWarpgateMock>;
  let hostSettings: WarpgateHostSettingsService;
  let history: { recordConnection: jest.Mock };
  let handler: WarpgateSshHandler;

  beforeEach(() => {
    app = { tabs: [], tabOpened$: new Subject<any>() };
    warpgate = createWarpgateMock();
    hostSettings = new WarpgateHostSettingsService(warpgate as unknown as WarpgateService);
    history = { recordConnection: jest.fn() };
    handler = new WarpgateSshHandler(app as any, warpgate as unknown as WarpgateService, hostSettings, history as any);
  });

  describe('tab detection', () => {
    it('should recognize Warpgate tabs by profile ID', () => {
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web:ticket'));
      app.tabOpened$.next(tab);

      expect(handler.isWarpgateTab(tab)).toBe(true);
      expect(handler.getTabTarget(tab)).toEqual({ serverId: 'wg-1', targetName: 'web' });
    });

    it('should ignore other SSH tabs and non-SSH tabs', () => {
      const other = new FakeSshTab(sshProfile('a1b2c3'));
      const notSsh = new FakeSshTab({ ...sshProfile('warpgate:wg-1:web'), type: 'local' });
      app.tabOpened$.next(other);
      app.tabOpened$.next(notSsh);

      expect(handler.isWarpgateTab(other)).toBe(false);
      expect(handler.isWarpgateTab(notSsh)).toBe(false);
    });

    it('should attach to panes of split tabs, including panes added later', () => {
      const first = new FakeSshTab(sshProfile('warpgate:wg-1:web'));
      const split = new FakeSplitTab([first]);
      app.tabOpened$.next(split);

      const later = new FakeSshTab(sshProfile('warpgate:wg-1:db'));
      split.children.push(later);
      split.tabAdded$.next(later);

      expect(handler.isWarpgateTab(first)).toBe(true);
      expect(handler.getTabTarget(later)).toEqual({ serverId: 'wg-1', targetName: 'db' });
    });

    it('should attach to tabs that were open before the handler started', () => {
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web'));
      app.tabs = [new FakeSplitTab([tab])];

      const lateHandler = new WarpgateSshHandler(app as any, warpgate as unknown as WarpgateService, hostSettings, history as any);

      expect(lateHandler.isWarpgateTab(tab)).toBe(true);
    });

    it('should list open Warpgate tabs', () => {
      const a = new FakeSshTab(sshProfile('warpgate:wg-1:web'));
      const b = new FakeSshTab(sshProfile('warpgate:wg-1:db'));
      const other = new FakeSshTab(sshProfile('other'));
      app.tabs = [new FakeSplitTab([a, other]), b];
      app.tabs.forEach(tab => app.tabOpened$.next(tab));

      expect(handler.getOpenWarpgateTabs()).toEqual([a, b]);
    });
  });

  describe('connection preparation', () => {
    it('should use a fresh ticket created for the tab as is', async () => {
      warpgate.claimUnusedTicket.mockReturnValueOnce(true);
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web:ticket', { user: 'ticket-new', auth: 'password', password: 'x' }));
      app.tabOpened$.next(tab);

      await tab.initializeSession();

      expect(warpgate.claimUnusedTicket).toHaveBeenCalledWith('ticket-new');
      expect(warpgate.getConnectionCredentials).not.toHaveBeenCalled();
      expect(tab.initializeCalls[0].user).toBe('ticket-new');
    });

    it('should get a new ticket before reconnecting', async () => {
      warpgate.claimUnusedTicket.mockReturnValueOnce(true);
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web:ticket', { user: 'ticket-used', auth: 'password', password: 'x' }));
      app.tabOpened$.next(tab);
      await tab.initializeSession();

      await tab.reconnect();

      expect(warpgate.getConnectionCredentials).toHaveBeenCalledWith('wg-1', 'web');
      expect(tab.initializeCalls[1].user).toBe('ticket-fresh');
      expect(tab.initializeCalls[1].auth).toBe('password');
    });

    it('should replace a used ticket of a duplicated or restored tab before the first connection', async () => {
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web:ticket', { user: 'ticket-from-yesterday' }));
      app.tabOpened$.next(tab);

      await tab.initializeSession();

      expect(tab.initializeCalls[0].user).toBe('ticket-fresh');
    });

    it('should switch to password credentials when no ticket can be created', async () => {
      warpgate.getConnectionCredentials.mockResolvedValueOnce({
        host: 'wg.example.com', port: 2222, username: 'admin:web', auth: null, password: 'secret', useTicket: false,
      });
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web:ticket', { user: 'ticket-used', auth: 'password', password: 'x' }));
      app.tabOpened$.next(tab);

      await tab.initializeSession();

      expect(tab.initializeCalls[0]).toEqual(expect.objectContaining({ user: 'admin:web', auth: null, password: 'secret' }));
    });

    it('should keep a freshly created password profile for its first connection', async () => {
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web:autoauth', { user: 'admin:web', password: 'secret' }));
      app.tabOpened$.next(tab);

      await tab.initializeSession();
      expect(warpgate.getConnectionCredentials).not.toHaveBeenCalled();

      await tab.reconnect();
      expect(warpgate.getConnectionCredentials).toHaveBeenCalledTimes(1);
    });

    it('should leave the profile alone when the server no longer exists', async () => {
      const tab = new FakeSshTab(sshProfile('warpgate:gone:web', { user: 'admin:web' }));
      app.tabOpened$.next(tab);

      await tab.initializeSession();

      expect(tab.initializeCalls[0].user).toBe('admin:web');
      expect(history.recordConnection).not.toHaveBeenCalled();
    });

    it('should apply host settings on every connection', async () => {
      warpgate.config.snippets = [{ id: 's1', name: 'Uptime', script: 'uptime' }];
      hostSettings.updateSettings('wg-1', 'web', { startupSnippetId: 's1', agentForward: true });
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web'));
      app.tabOpened$.next(tab);

      await tab.initializeSession();
      hostSettings.updateSettings('wg-1', 'web', {});
      await tab.reconnect();

      expect(tab.initializeCalls[0]).toEqual(expect.objectContaining({
        agentForward: true,
        scripts: [{ expect: '', send: 'uptime' }],
      }));
      expect(tab.initializeCalls[1]).toEqual(expect.objectContaining({ agentForward: false, scripts: [] }));
    });

    it('should send queued scripts once after the next connection', async () => {
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web'));
      app.tabOpened$.next(tab);
      handler.queueScripts(tab, ['df -h', '  ']);

      await tab.initializeSession();
      await tab.reconnect();

      expect(tab.initializeCalls[0].scripts).toEqual([{ expect: '', send: 'df -h' }]);
      expect(tab.initializeCalls[1].scripts).toEqual([]);
    });

    it('should record the first connection of each tab in the history', async () => {
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web'));
      app.tabOpened$.next(tab);

      await tab.initializeSession();
      await tab.reconnect();

      expect(history.recordConnection).toHaveBeenCalledTimes(1);
      expect(history.recordConnection).toHaveBeenCalledWith('wg-1', 'web');
    });

    it('should still connect when preparing credentials fails', async () => {
      warpgate.getConnectionCredentials.mockRejectedValueOnce(new Error('offline'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web'));
      app.tabOpened$.next(tab);

      await tab.initializeSession();

      expect(tab.initializeCalls).toHaveLength(1);
      consoleSpy.mockRestore();
    });
  });

  describe('keyboard-interactive prompts', () => {
    function openTab(): FakeSshTab {
      const tab = new FakeSshTab(sshProfile('warpgate:wg-1:web'));
      app.tabOpened$.next(tab);
      return tab;
    }

    it('should answer OTP prompts when Tabby shows them', async () => {
      const tab = openTab();
      const prompt = kiPrompt('Two-factor authentication', ['Code:']);

      tab.activeKIPrompt = prompt;
      expect(tab.activeKIPrompt).toBe(prompt);
      await flush();

      expect(prompt.responses).toEqual(['123456']);
      expect(prompt.respond).toHaveBeenCalledTimes(1);
      // The prompt panel is closed after answering
      expect(tab.activeKIPrompt).toBeNull();
    });

    it('should replace a password Tabby put into an OTP prompt', async () => {
      const tab = openTab();
      const prompt = kiPrompt('', ['One-time password:'], ['secret']);

      tab.activeKIPrompt = prompt;
      await flush();

      expect(prompt.responses).toEqual(['123456']);
    });

    it('should answer password and OTP prompts of the same request', async () => {
      const tab = openTab();
      const prompt = kiPrompt('Login', ['Password:', 'Verification code:']);

      tab.activeKIPrompt = prompt;
      await flush();

      expect(prompt.responses).toEqual(['secret', '123456']);
      expect(prompt.respond).toHaveBeenCalled();
    });

    it('should leave prompts it cannot answer to the user', async () => {
      const tab = openTab();
      const prompt = kiPrompt('Login', ['Password:', 'Favourite color:']);

      tab.activeKIPrompt = prompt;
      await flush();

      expect(prompt.responses).toEqual(['secret', '']);
      expect(prompt.respond).not.toHaveBeenCalled();
      expect(tab.activeKIPrompt).toBe(prompt);
    });

    it('should not send the same OTP code twice in one connection attempt', async () => {
      const tab = openTab();
      const first = kiPrompt('Two-factor authentication', ['Code:']);
      const second = kiPrompt('Two-factor authentication', ['Code:']);

      tab.activeKIPrompt = first;
      await flush();
      tab.activeKIPrompt = second;
      await flush();

      expect(first.respond).toHaveBeenCalled();
      expect(second.respond).not.toHaveBeenCalled();
    });

    it('should keep OTP state separate for each tab', async () => {
      const a = openTab();
      const b = openTab();
      const promptA = kiPrompt('Two-factor authentication', ['Code:']);
      const promptB = kiPrompt('Two-factor authentication', ['Code:']);

      a.activeKIPrompt = promptA;
      b.activeKIPrompt = promptB;
      await flush();

      expect(promptA.respond).toHaveBeenCalled();
      expect(promptB.respond).toHaveBeenCalled();
    });

    it('should allow the same code again after reconnecting', async () => {
      const tab = openTab();
      const first = kiPrompt('Two-factor authentication', ['Code:']);
      tab.activeKIPrompt = first;
      await flush();

      await tab.reconnect();
      const second = kiPrompt('Two-factor authentication', ['Code:']);
      tab.activeKIPrompt = second;
      await flush();

      expect(second.respond).toHaveBeenCalled();
    });

    it('should not answer prompts without an OTP secret or password', async () => {
      warpgate.generateOtpCode.mockResolvedValue(null);
      warpgate.config.servers = [{ ...SERVER, password: undefined }];
      const tab = openTab();
      const prompt = kiPrompt('Login', ['Password:', 'OTP:']);

      tab.activeKIPrompt = prompt;
      await flush();

      expect(prompt.respond).not.toHaveBeenCalled();
    });
  });
});

describe('WarpgateConnectionService', () => {
  let warpgate: ReturnType<typeof createWarpgateMock>;
  let hostSettings: WarpgateHostSettingsService;
  let history: { getLastConnectedMap: jest.Mock };
  let sshHandler: { registerWarpgateProfile: jest.Mock; queueScripts: jest.Mock; attachToTab: jest.Mock };
  let profileProvider: { createOneClickProfile: jest.Mock };
  let app: { getParentTab: jest.Mock; selectTab: jest.Mock };
  let profiles: { openNewTabForProfile: jest.Mock; newTabParametersForProfile: jest.Mock };
  let tabs: { create: jest.Mock };
  let selector: { active: boolean; show: jest.Mock };
  let notifications: { notice: jest.Mock; info: jest.Mock; error: jest.Mock };
  let service: WarpgateConnectionService;

  beforeEach(() => {
    warpgate = createWarpgateMock();
    hostSettings = new WarpgateHostSettingsService(warpgate as unknown as WarpgateService);
    history = { getLastConnectedMap: jest.fn().mockReturnValue(new Map()) };
    sshHandler = { registerWarpgateProfile: jest.fn(), queueScripts: jest.fn(), attachToTab: jest.fn() };
    profileProvider = {
      createOneClickProfile: jest.fn(async (server: WarpgateServerConfig, target: WarpgateTarget) => ({
        id: `warpgate:${server.id}:${target.name}:ticket`,
        type: 'ssh',
        name: target.name,
        options: {},
      })),
    };
    app = { getParentTab: jest.fn(), selectTab: jest.fn() };
    profiles = {
      openNewTabForProfile: jest.fn(async (profile: any) => ({ title: profile.name })),
      newTabParametersForProfile: jest.fn(async (profile: any) => ({ type: class {}, inputs: { profile } })),
    };
    tabs = { create: jest.fn((params: any) => ({ title: params.inputs.profile.name })) };
    selector = { active: false, show: jest.fn().mockResolvedValue(undefined) };
    notifications = { notice: jest.fn(), info: jest.fn(), error: jest.fn() };
    service = new WarpgateConnectionService(
      warpgate as unknown as WarpgateService,
      profileProvider as any,
      hostSettings,
      history as any,
      sshHandler as any,
      app as any,
      profiles as any,
      tabs as any,
      selector as any,
      notifications as any
    );
  });

  it('should open a host with a one-click profile', async () => {
    const tab = await service.openHost(SERVER, TARGET, { scripts: ['uptime'] });

    expect(profileProvider.createOneClickProfile).toHaveBeenCalledWith(SERVER, TARGET);
    expect(sshHandler.registerWarpgateProfile).toHaveBeenCalled();
    expect(sshHandler.queueScripts).toHaveBeenCalledWith(tab, ['uptime']);
  });

  it('should report connection errors with the host name', async () => {
    hostSettings.updateSettings('wg-1', 'web', { alias: 'Web (prod)' });
    profileProvider.createOneClickProfile.mockRejectedValueOnce(new Error('Ticket-only mode is enabled'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(service.openHost(SERVER, TARGET)).resolves.toBeNull();
    expect(notifications.error).toHaveBeenCalledWith('Failed to connect to Web (prod): Ticket-only mode is enabled');
  });

  it('should open several hosts as tabs', async () => {
    const hosts = ['a', 'b', 'c'].map(name => ({ server: SERVER, target: { ...TARGET, name } }));

    await expect(service.openHosts(hosts, 'tabs')).resolves.toBe(3);
    expect(profiles.openNewTabForProfile).toHaveBeenCalledTimes(3);
  });

  it('should open several hosts as a grid of split panes', async () => {
    const parent = { addTab: jest.fn().mockResolvedValue(undefined) };
    app.getParentTab.mockReturnValue(parent);
    const hosts = ['a', 'b', 'c', 'd'].map(name => ({ server: SERVER, target: { ...TARGET, name } }));

    await expect(service.openHosts(hosts, 'split', { scripts: ['w'] })).resolves.toBe(4);

    expect(profiles.openNewTabForProfile).toHaveBeenCalledTimes(1);
    expect(tabs.create).toHaveBeenCalledTimes(3);
    const placements = parent.addTab.mock.calls.map(([pane, relative, side]) => [pane.title, relative.title, side]);
    expect(placements).toEqual([['b', 'a', 'r'], ['c', 'a', 'b'], ['d', 'b', 'b']]);
    expect(sshHandler.attachToTab).toHaveBeenCalledTimes(3);
    expect(sshHandler.queueScripts).toHaveBeenCalledTimes(4);
    expect(app.selectTab).toHaveBeenCalledWith(parent);
  });

  it('should put pinned and recent hosts first in quick connect', () => {
    warpgate.config.pinnedHosts = ['wg-1:pinned'];
    history.getLastConnectedMap.mockReturnValue(new Map([['wg-1:recent', Date.now()]]));
    hostSettings.updateSettings('wg-1', 'recent', { alias: 'Recent box', tags: ['prod'] });
    const hosts = ['pinned', 'recent', 'other'].map(name => ({ server: SERVER, target: { ...TARGET, name } }));

    const options = service.buildQuickConnectOptions(hosts);

    expect(options.map(option => [option.name, option.group])).toEqual([
      ['pinned', 'Pinned'],
      ['Recent box', 'Recent'],
      ['other', 'Gateway'],
    ]);
    expect(options[0].weight).toBeLessThan(options[1].weight!);
    expect(options[1].description).toContain('#prod');
    expect(options[1].description).toContain('recent');
  });

  it('should open the selected host from quick connect', async () => {
    await service.showQuickConnect();

    const options = selector.show.mock.calls[0][1];
    options[0].callback();
    await flush();

    expect(profileProvider.createOneClickProfile).toHaveBeenCalledWith(SERVER, TARGET);
  });

  it('should explain when there is nothing to connect to', async () => {
    warpgate.config.servers = [];

    await service.showQuickConnect();

    expect(selector.show).not.toHaveBeenCalled();
    expect(notifications.notice).toHaveBeenCalledWith(expect.stringContaining('Add a Warpgate server'));
  });
});
