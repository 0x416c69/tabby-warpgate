/**
 * Tests for host settings, snippets, history and the shared helpers
 */

import { WarpgateService } from '../services/warpgate.service';
import {
  WarpgateHostSettingsService,
  describePortForward,
  normalizePortForward,
  parseTags,
} from '../services/host-settings.service';
import { WarpgateHistoryService } from '../services/history.service';
import { WarpgateSnippetsService, snippetPreview, snippetToTerminalInput } from '../services/snippets.service';
import {
  DEFAULT_WARPGATE_CONFIG,
  MAX_HISTORY_ENTRIES,
  WarpgatePluginConfig,
  WarpgateServerConfig,
  WarpgateTarget,
} from '../models/warpgate.models';
import { buildWarpgateProfileId, parseWarpgateProfileId } from '../utils/profile-id';
import { isOtpPrompt, isPasswordPrompt } from '../utils/prompt-detection';
import { getTargetColor, getTargetIcon } from '../utils/target-appearance';
import { formatRelativeTime, scoreHost, HostItem } from '../components/warpgate-hosts.component';
import { formatDayLabel } from '../components/warpgate-history.component';
import { computeSplitGrid } from '../services/connection.service';
import { WarpgateConfigProvider } from '../providers/config.provider';
import { WarpgateHotkeyProvider } from '../providers/hotkey.provider';

const SERVER: WarpgateServerConfig = {
  id: 'srv',
  name: 'Gateway',
  url: 'https://wg.example.com',
  username: 'admin',
  password: 'secret',
  enabled: true,
};

function createWarpgateMock() {
  const config: WarpgatePluginConfig = {
    ...DEFAULT_WARPGATE_CONFIG,
    servers: [SERVER],
    pinnedHosts: [],
    hostSettings: {},
    snippets: [],
    history: [],
  };
  return {
    config,
    getConfig: jest.fn(() => config),
    getServers: jest.fn(() => config.servers),
    saveConfig: jest.fn((partial: Partial<WarpgatePluginConfig>) => {
      for (const [key, value] of Object.entries(partial)) {
        (config as any)[key] = Array.isArray(value) ? [...value] : (value && typeof value === 'object' ? { ...value } : value);
      }
    }),
  };
}

describe('Host settings', () => {
  let warpgate: ReturnType<typeof createWarpgateMock>;
  let service: WarpgateHostSettingsService;

  beforeEach(() => {
    warpgate = createWarpgateMock();
    service = new WarpgateHostSettingsService(warpgate as unknown as WarpgateService);
  });

  it('should return empty settings for hosts without customization', () => {
    expect(service.getSettings('srv', 'web')).toEqual({});
  });

  it('should store cleaned up settings', () => {
    service.updateSettings('srv', 'web', {
      alias: '  Web server ',
      tags: ['prod', '#Prod', 'eu', ''],
      notes: ' behind the LB ',
      color: '#22c55e',
    });

    expect(service.getSettings('srv', 'web')).toEqual({
      alias: 'Web server',
      tags: ['prod', 'eu'],
      notes: 'behind the LB',
      color: '#22c55e',
    });
  });

  it('should always assign a new settings object so Tabby persists it', () => {
    service.updateSettings('srv', 'web', { alias: 'Web' });

    const saved = warpgate.saveConfig.mock.calls[0][0];
    expect(saved.hostSettings).toEqual({ 'srv:web': { alias: 'Web' } });
  });

  it('should drop invalid colors and port forwards', () => {
    service.updateSettings('srv', 'web', {
      color: 'red; background: url(x)',
      forwardedPorts: [
        { type: 'Local', host: '', port: 8080, targetAddress: 'db', targetPort: 5432 },
        { type: 'Local', host: '', port: 99999, targetAddress: 'db', targetPort: 5432 },
        { type: 'Remote', host: '0.0.0.0', port: 9000, targetAddress: '', targetPort: 80 },
      ],
    });

    expect(service.getSettings('srv', 'web')).toEqual({
      forwardedPorts: [{ type: 'Local', host: '127.0.0.1', port: 8080, targetAddress: 'db', targetPort: 5432, description: '' }],
    });
  });

  it('should remove the entry when everything is cleared', () => {
    service.updateSettings('srv', 'web', { alias: 'Web' });
    service.updateSettings('srv', 'web', { alias: '' });

    expect(warpgate.config.hostSettings).toEqual({});
  });

  it('should notify about changes', () => {
    const changes: string[] = [];
    service.changes$.subscribe(key => changes.push(key));

    service.updateSettings('srv', 'web', { alias: 'Web' });

    expect(changes).toEqual(['srv:web']);
  });

  it('should list tags of all hosts once', () => {
    service.updateSettings('srv', 'web', { tags: ['prod', 'web'] });
    service.updateSettings('srv', 'db', { tags: ['Prod', 'db'] });

    expect(service.getAllTags()).toEqual(['db', 'prod', 'web']);
  });

  it('should let host settings override server SSH defaults', () => {
    const server = { ...SERVER, agentForward: true, x11: true, keepaliveInterval: 30000 };
    service.updateSettings('srv', 'web', { x11: false });

    const options = service.getEffectiveSshOptions(server, 'web');

    expect(options.agentForward).toBe(true);
    expect(options.x11).toBe(false);
    expect(options.keepaliveInterval).toBe(30000);
  });

  it('should turn the startup snippet into a login script', () => {
    warpgate.config.snippets = [{ id: 's1', name: 'Uptime', script: 'uptime\r\nwho\n' }];
    service.updateSettings('srv', 'web', { startupSnippetId: 's1' });

    const options = service.getEffectiveSshOptions(SERVER, 'web');

    expect(options.scripts).toEqual([{ expect: '', send: 'uptime\nwho' }]);
  });

  it('should reset managed options on a profile when settings are removed', () => {
    const options: Record<string, any> = {
      agentForward: true,
      x11: true,
      forwardedPorts: [{ type: 'Local' }],
      scripts: [{ expect: '', send: 'old' }],
    };

    service.applyToProfileOptions(options, SERVER, 'web');

    expect(options).toEqual({ agentForward: false, x11: false, forwardedPorts: [], scripts: [] });
  });

  it('should remove references to deleted snippets', () => {
    service.updateSettings('srv', 'web', { startupSnippetId: 's1' });
    service.updateSettings('srv', 'db', { startupSnippetId: 's1', alias: 'DB' });

    service.removeSnippetReferences('s1');

    expect(warpgate.config.hostSettings).toEqual({ 'srv:db': { alias: 'DB' } });
  });

  it('should forget settings of a removed server', () => {
    service.updateSettings('srv', 'web', { alias: 'Web' });
    service.updateSettings('other', 'web', { alias: 'Other' });

    service.removeServerSettings('srv');

    expect(Object.keys(warpgate.config.hostSettings)).toEqual(['other:web']);
  });

  it('should parse free-form tag input', () => {
    expect(parseTags('prod, db  #eu,prod')).toEqual(['prod', 'db', 'eu']);
    expect(parseTags(undefined)).toEqual([]);
  });

  it('should describe port forwards', () => {
    expect(describePortForward(normalizePortForward({ type: 'Local', port: 8080, targetAddress: 'db', targetPort: 5432 })!))
      .toBe('L 127.0.0.1:8080 → db:5432');
    expect(describePortForward(normalizePortForward({ type: 'Dynamic', port: 1080 })!)).toBe('SOCKS 127.0.0.1:1080');
  });
});

describe('Connection history', () => {
  let warpgate: ReturnType<typeof createWarpgateMock>;
  let history: WarpgateHistoryService;

  beforeEach(() => {
    warpgate = createWarpgateMock();
    history = new WarpgateHistoryService(warpgate as unknown as WarpgateService);
  });

  it('should record connections with the most recent first', () => {
    history.recordConnection('srv', 'web', new Date('2026-01-01T10:00:00Z'));
    history.recordConnection('srv', 'db', new Date('2026-01-01T11:00:00Z'));
    history.recordConnection('srv', 'web', new Date('2026-01-01T12:00:00Z'));

    expect(history.getHistory().map(entry => [entry.targetName, entry.count])).toEqual([['web', 2], ['db', 1]]);
    expect(history.getEntry('srv', 'web')?.lastConnectedAt).toBe('2026-01-01T12:00:00.000Z');
  });

  it('should keep a bounded history', () => {
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 10; i++) {
      history.recordConnection('srv', `host-${i}`);
    }

    expect(history.getHistory()).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(history.getHistory()[0].targetName).toBe(`host-${MAX_HISTORY_ENTRIES + 9}`);
  });

  it('should hide entries of servers that were removed', () => {
    history.recordConnection('srv', 'web');
    history.recordConnection('gone', 'web');

    expect(history.getHistory().map(entry => entry.serverId)).toEqual(['srv']);
  });

  it('should map hosts to their last connection time', () => {
    history.recordConnection('srv', 'web', new Date(1000));

    expect(history.getLastConnectedMap().get('srv:web')).toBe(1000);
  });

  it('should remove entries and clear the history', () => {
    history.recordConnection('srv', 'web');
    history.recordConnection('srv', 'db');

    history.removeEntry('srv', 'web');
    expect(history.getHistory().map(entry => entry.targetName)).toEqual(['db']);

    history.clearHistory();
    expect(history.getHistory()).toEqual([]);
  });

  it('should tolerate missing or corrupt history in the config', () => {
    (warpgate.config as any).history = undefined;
    expect(history.getHistory()).toEqual([]);

    (warpgate.config as any).history = [null, { serverId: 'srv' }, { serverId: 'srv', targetName: 'ok', lastConnectedAt: '', count: 1 }];
    expect(history.getHistory().map(entry => entry.targetName)).toEqual(['ok']);
  });
});

describe('Snippets', () => {
  let warpgate: ReturnType<typeof createWarpgateMock>;
  let hostSettings: WarpgateHostSettingsService;
  let app: { activeTab: any };
  let selector: { show: jest.Mock };
  let notifications: { notice: jest.Mock; info: jest.Mock; error: jest.Mock };
  let snippets: WarpgateSnippetsService;

  function terminal() {
    return { sendInput: jest.fn() };
  }

  beforeEach(() => {
    warpgate = createWarpgateMock();
    hostSettings = new WarpgateHostSettingsService(warpgate as unknown as WarpgateService);
    app = { activeTab: null };
    selector = { show: jest.fn().mockResolvedValue(undefined) };
    notifications = { notice: jest.fn(), info: jest.fn(), error: jest.fn() };
    snippets = new WarpgateSnippetsService(
      warpgate as unknown as WarpgateService,
      hostSettings,
      app as any,
      selector as any,
      notifications as any
    );
  });

  it('should create, update and sort snippets', () => {
    const created = snippets.saveSnippet({ name: 'Zeta', script: 'echo z' });
    snippets.saveSnippet({ name: 'Alpha', script: 'echo a', tags: ['x', 'x'] });
    snippets.saveSnippet({ ...created, name: 'Beta', script: 'echo b\r\n' });

    expect(snippets.getSnippets().map(s => s.name)).toEqual(['Alpha', 'Beta']);
    expect(snippets.getSnippet(created.id)?.script).toBe('echo b');
    expect(snippets.getSnippets()[0].tags).toEqual(['x']);
  });

  it('should require a name and a script', () => {
    expect(() => snippets.saveSnippet({ name: ' ', script: 'ls' })).toThrow('name');
    expect(() => snippets.saveSnippet({ name: 'List', script: ' \n ' })).toThrow('script');
  });

  it('should delete snippets and stop using them on connect', () => {
    const snippet = snippets.saveSnippet({ name: 'Uptime', script: 'uptime' });
    hostSettings.updateSettings('srv', 'web', { startupSnippetId: snippet.id });

    snippets.deleteSnippet(snippet.id);

    expect(snippets.getSnippets()).toEqual([]);
    expect(hostSettings.getSettings('srv', 'web')).toEqual({});
  });

  it('should send every line of a snippet followed by Enter', () => {
    expect(snippetToTerminalInput('cd /srv\r\nls -la\n\n')).toBe('cd /srv\rls -la\r');
    expect(snippetPreview('\n  # comment\nls')).toBe('# comment');
  });

  it('should run in the focused pane of a split tab', () => {
    const pane = terminal();
    const split = { getAllTabs: () => [terminal(), pane], getFocusedTab: () => pane };
    const snippet = snippets.saveSnippet({ name: 'Who', script: 'whoami' });

    expect(snippets.runInTab(split, snippet)).toBe(true);
    expect(pane.sendInput).toHaveBeenCalledWith('whoami\r');
  });

  it('should refuse to run outside of terminals', () => {
    const snippet = snippets.saveSnippet({ name: 'Who', script: 'whoami' });

    expect(snippets.runInTab({ title: 'Settings' }, snippet)).toBe(false);
    expect(snippets.runInActiveTab(snippet)).toBe(false);
    expect(notifications.notice).toHaveBeenCalled();
  });

  it('should run in several tabs', () => {
    const tabs = [terminal(), terminal(), { title: 'not a terminal' }];
    const snippet = snippets.saveSnippet({ name: 'Who', script: 'whoami' });

    expect(snippets.runInTabs(tabs, snippet)).toBe(2);
  });

  it('should offer snippets in Tabby\'s selector and run the chosen one', async () => {
    const active = terminal();
    app.activeTab = active;
    snippets.saveSnippet({ name: 'Disk', script: 'df -h', description: 'Disk usage' });

    await snippets.showRunSnippetPicker();

    const options = selector.show.mock.calls[0][1];
    expect(options).toHaveLength(1);
    expect(options[0]).toEqual(expect.objectContaining({ name: 'Disk', description: 'Disk usage' }));
    options[0].callback();
    expect(active.sendInput).toHaveBeenCalledWith('df -h\r');
  });

  it('should explain why the picker cannot be used', async () => {
    await snippets.showRunSnippetPicker();
    expect(notifications.notice).toHaveBeenCalledWith(expect.stringContaining('No snippets'));

    snippets.saveSnippet({ name: 'Disk', script: 'df -h' });
    await snippets.showRunSnippetPicker();
    expect(notifications.notice).toHaveBeenCalledWith(expect.stringContaining('terminal'));
    expect(selector.show).not.toHaveBeenCalled();
  });
});

describe('Profile IDs', () => {
  it('should build and parse profile IDs', () => {
    expect(buildWarpgateProfileId('wg-1', 'web')).toBe('warpgate:wg-1:web');
    expect(parseWarpgateProfileId('warpgate:wg-1:web')).toEqual({ serverId: 'wg-1', targetName: 'web', kind: undefined });
    expect(parseWarpgateProfileId('warpgate:wg-1:web:ticket')).toEqual({ serverId: 'wg-1', targetName: 'web', kind: 'ticket' });
    expect(parseWarpgateProfileId('warpgate:wg-1:ns:web:autoauth')).toEqual({ serverId: 'wg-1', targetName: 'ns:web', kind: 'autoauth' });
  });

  it('should ignore profiles of other plugins', () => {
    expect(parseWarpgateProfileId('ssh:template')).toBeNull();
    expect(parseWarpgateProfileId('warpgate:')).toBeNull();
    expect(parseWarpgateProfileId('warpgate:srv:')).toBeNull();
    expect(parseWarpgateProfileId(undefined)).toBeNull();
  });
});

describe('Prompt detection', () => {
  it('should recognize OTP prompts', () => {
    for (const prompt of ['One-time password:', 'Two-factor authentication', 'Enter OTP', 'Verification code:', 'TOTP']) {
      expect(isOtpPrompt(prompt)).toBe(true);
    }
  });

  it('should recognize password prompts that are not OTP prompts', () => {
    expect(isPasswordPrompt('Password:')).toBe(true);
    expect(isPasswordPrompt('One-time password:')).toBe(false);
    expect(isPasswordPrompt('Login:')).toBe(false);
  });
});

describe('Target appearance', () => {
  const target = (name: string, description = ''): WarpgateTarget => ({ name, description, kind: 'Ssh' });

  it('should match whole words only', () => {
    expect(getTargetIcon(target('prod-db-01'))).toBe('fas fa-database');
    expect(getTargetIcon(target('feedback-service'))).toBe('fas fa-server');
    expect(getTargetIcon(target('pricing'))).toBe('fas fa-server');
  });

  it('should color hosts by environment', () => {
    expect(getTargetColor(target('api', 'production api'))).toBe('#ef4444');
    expect(getTargetColor(target('api-staging'))).toBe('#f59e0b');
    expect(getTargetColor({ ...target('misc'), group: { id: 'g', name: 'G', color: 'info' } })).toBe('#17a2b8');
  });
});

describe('Host search', () => {
  const host = (name: string, extra: Partial<HostItem> = {}): HostItem => ({
    key: `srv:${name}`,
    server: SERVER,
    target: { name, description: '', kind: 'Ssh' },
    settings: {},
    displayName: name,
    icon: '',
    color: '',
    os: null,
    online: true,
    pinned: false,
    searchText: name,
    ...extra,
  });

  it('should rank name matches above other matches', () => {
    const now = Date.now();
    const exact = scoreHost(host('web'), 'web', now);
    const prefix = scoreHost(host('web-01'), 'web', now);
    const contains = scoreHost(host('prod-web'), 'web', now);
    const other = scoreHost(host('api', { searchText: 'api web tier' }), 'web', now);

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(other);
    expect(scoreHost(host('api'), 'web', now)).toBe(0);
  });

  it('should require every search term to match', () => {
    expect(scoreHost(host('prod-web', { searchText: 'prod-web eu' }), 'web eu')).toBeGreaterThan(0);
    expect(scoreHost(host('prod-web', { searchText: 'prod-web eu' }), 'web us')).toBe(0);
  });

  it('should filter by tags with #', () => {
    const tagged = host('db', { settings: { tags: ['Prod'] } });

    expect(scoreHost(tagged, '#prod')).toBeGreaterThan(0);
    expect(scoreHost(tagged, '#dev')).toBe(0);
  });

  it('should boost recently used hosts', () => {
    const now = Date.now();
    expect(scoreHost(host('web', { lastConnectedAt: now }), 'we', now))
      .toBeGreaterThan(scoreHost(host('web'), 'we', now));
  });

  it('should format relative times', () => {
    const now = Date.UTC(2026, 0, 10, 12);
    expect(formatRelativeTime(now - 10_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 2 * 86400_000, now)).toBe('2d ago');
  });

  it('should label history days', () => {
    const now = new Date(2026, 0, 10, 12);
    expect(formatDayLabel(new Date(2026, 0, 10, 8), now)).toBe('Today');
    expect(formatDayLabel(new Date(2026, 0, 9, 23), now)).toBe('Yesterday');
  });
});

describe('Split layout', () => {
  it('should place panes in a grid', () => {
    expect(computeSplitGrid(1)).toEqual([]);
    expect(computeSplitGrid(2)).toEqual([{ relativeIndex: 0, side: 'r' }]);
    expect(computeSplitGrid(4)).toEqual([
      { relativeIndex: 0, side: 'r' },
      { relativeIndex: 0, side: 'b' },
      { relativeIndex: 1, side: 'b' },
    ]);
    expect(computeSplitGrid(5)).toEqual([
      { relativeIndex: 0, side: 'r' },
      { relativeIndex: 1, side: 'r' },
      { relativeIndex: 0, side: 'b' },
      { relativeIndex: 1, side: 'b' },
    ]);
  });
});

describe('Hotkeys', () => {
  it('should provide a default binding for every hotkey', async () => {
    const descriptions = await new WarpgateHotkeyProvider().provide();
    const defaults = new WarpgateConfigProvider().defaults.hotkeys as Record<string, string[]>;

    for (const description of descriptions) {
      expect(defaults).toHaveProperty(description.id);
    }
    expect(defaults['warpgate-quick-connect']).toEqual(['Ctrl-Shift-K']);
  });
});
