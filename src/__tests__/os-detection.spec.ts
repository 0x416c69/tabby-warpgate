/**
 * Tests for operating system detection
 */

import { Subject } from 'rxjs';
import {
  OS_DETECTION_COMMAND,
  WINDOWS_DETECTION_COMMAND,
  getOsAppearance,
  parseOsDetectionOutput,
  runRemoteCommand,
} from '../utils/os-detection';
import { OS_REDETECT_INTERVAL_MS, WarpgateOsDetectionService } from '../services/os-detection.service';
import { WarpgateHostSettingsService } from '../services/host-settings.service';
import { WarpgateService } from '../services/warpgate.service';
import { DEFAULT_WARPGATE_CONFIG, WarpgatePluginConfig, WarpgateTarget } from '../models/warpgate.models';

const UBUNTU = `Linux
PRETTY_NAME="Ubuntu 24.04.1 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.1 LTS (Noble Numbat)"
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
`;

describe('parseOsDetectionOutput', () => {
  it('should read Linux distributions from os-release', () => {
    expect(parseOsDetectionOutput(UBUNTU)).toEqual({ id: 'ubuntu', label: 'Ubuntu 24.04', name: 'Ubuntu 24.04.1 LTS' });
    expect(parseOsDetectionOutput('Linux\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"\nID=debian\n'))
      .toEqual({ id: 'debian', label: 'Debian 12', name: 'Debian GNU/Linux 12 (bookworm)' });
    expect(parseOsDetectionOutput('Linux\nNAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.19.1\nPRETTY_NAME="Alpine Linux v3.19"\n'))
      .toEqual({ id: 'alpine', label: 'Alpine 3.19.1', name: 'Alpine Linux v3.19' });
  });

  it('should map related distributions to known icons', () => {
    expect(parseOsDetectionOutput('Linux\nNAME="Rocky Linux"\nID="rocky"\nID_LIKE="rhel centos fedora"\nVERSION_ID="9.3"\n'))
      .toMatchObject({ id: 'rocky', label: 'Rocky Linux 9.3' });
    expect(parseOsDetectionOutput('Linux\nNAME="Amazon Linux"\nID="amzn"\nVERSION_ID="2023"\n'))
      .toMatchObject({ id: 'amzn', label: 'Amazon Linux 2023' });
    expect(parseOsDetectionOutput('Linux\nNAME="openSUSE Leap"\nID="opensuse-leap"\nVERSION_ID="15.5"\n'))
      .toMatchObject({ id: 'opensuse', label: 'openSUSE 15.5' });
  });

  it('should use the look-alike icon but keep the real name of derivatives', () => {
    const parsed = parseOsDetectionOutput('Linux\nNAME="Pop!_OS"\nVERSION_ID="22.04"\nID=pop\nID_LIKE="ubuntu debian"\nPRETTY_NAME="Pop!_OS 22.04 LTS"\n');

    expect(parsed).toEqual({ id: 'ubuntu', label: 'Pop!_OS 22.04', name: 'Pop!_OS 22.04 LTS' });
  });

  it('should fall back to generic Linux for unknown distributions', () => {
    expect(parseOsDetectionOutput('Linux\nNAME="Exotic OS"\nID=exotic\nVERSION_ID=1\n'))
      .toEqual({ id: 'linux', label: 'Exotic OS 1', name: 'Exotic OS 1' });
    expect(parseOsDetectionOutput('Linux\n')).toEqual({ id: 'linux', label: 'Linux', name: 'Linux' });
  });

  it('should detect macOS, BSD and Windows', () => {
    expect(parseOsDetectionOutput('Darwin\nProductName:\tmacOS\nProductVersion:\t14.5\nBuildVersion:\t23F79\n'))
      .toEqual({ id: 'macos', label: 'macOS 14.5', name: 'macOS 14.5' });
    expect(parseOsDetectionOutput('FreeBSD\nNAME=FreeBSD\nVERSION_ID="14.0"\nID=freebsd\nPRETTY_NAME="FreeBSD 14.0-RELEASE"\n'))
      .toEqual({ id: 'freebsd', label: 'FreeBSD 14.0', name: 'FreeBSD 14.0-RELEASE' });
    expect(parseOsDetectionOutput('OpenBSD\n')).toEqual({ id: 'openbsd', label: 'OpenBSD', name: 'OpenBSD' });
    expect(parseOsDetectionOutput('\r\nMicrosoft Windows [Version 10.0.20348.2340]\r\n'))
      .toEqual({ id: 'windows', label: 'Windows', name: 'Windows 10.0.20348.2340' });
  });

  it('should ignore output of shell startup files', () => {
    expect(parseOsDetectionOutput(`Welcome back!\nhint: run make\n${UBUNTU}`)).toMatchObject({ id: 'ubuntu', label: 'Ubuntu 24.04' });
  });

  it('should return null when the output does not identify an operating system', () => {
    expect(parseOsDetectionOutput('')).toBeNull();
    expect(parseOsDetectionOutput('\n  \n')).toBeNull();
    expect(parseOsDetectionOutput('sh: uname: not found')).toBeNull();
  });
});

describe('getOsAppearance', () => {
  it('should give brand icons and colors', () => {
    expect(getOsAppearance('ubuntu')).toEqual({ label: 'Ubuntu', icon: 'fab fa-ubuntu', color: '#e95420' });
    expect(getOsAppearance('windows').icon).toBe('fab fa-windows');
  });

  it('should fall back to Linux for unknown identifiers', () => {
    expect(getOsAppearance('something-else')).toEqual(getOsAppearance('linux'));
  });
});

/**
 * Fake russh connection: every exec channel answers from a script
 */
function createFakeClient(answers: Record<string, string | Error | null>) {
  const channels: Array<{ command?: string; closed: boolean }> = [];
  const client = {
    channels,
    openSessionChannel: jest.fn(async () => ({})),
    activateChannel: jest.fn(async () => {
      const data$ = new Subject<Uint8Array>();
      const closed$ = new Subject<void>();
      const record: { command?: string; closed: boolean } = { closed: false };
      channels.push(record);
      return {
        data$,
        closed$,
        requestExec: async (command: string) => {
          record.command = command;
          const answer = answers[command];
          if (answer instanceof Error) {
            throw answer;
          }
          if (answer === null) {
            return; // never answers
          }
          setTimeout(() => {
            data$.next(new TextEncoder().encode(answer ?? ''));
            closed$.next();
          }, 0);
        },
        close: async () => {
          record.closed = true;
        },
      };
    }),
  };
  return client;
}

describe('runRemoteCommand', () => {
  it('should collect the output of a command and close the channel', async () => {
    const client = createFakeClient({ 'uname -s': 'Linux\n' });

    await expect(runRemoteCommand(client, 'uname -s', 1000)).resolves.toBe('Linux\n');
    expect(client.channels[0]).toEqual({ command: 'uname -s', closed: true });
  });

  it('should give up after the timeout', async () => {
    jest.useFakeTimers();
    try {
      const client = createFakeClient({ 'sleep 100': null });
      const result = runRemoteCommand(client, 'sleep 100', 5000);
      await jest.advanceTimersByTimeAsync(5000);

      await expect(result).resolves.toBe('');
      expect(client.channels[0].closed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should fail when the server refuses the command', async () => {
    const client = createFakeClient({ 'uname -s': new Error('Channel request failed') });

    await expect(runRemoteCommand(client, 'uname -s', 1000)).rejects.toThrow('Channel request failed');
  });
});

describe('WarpgateOsDetectionService', () => {
  const TARGET: WarpgateTarget = { name: 'web', description: 'Web server', kind: 'Ssh' };
  let config: WarpgatePluginConfig;
  let hostSettings: WarpgateHostSettingsService;
  let service: WarpgateOsDetectionService;

  beforeEach(() => {
    config = { ...DEFAULT_WARPGATE_CONFIG, servers: [], hostSettings: {}, hostOs: {}, snippets: [], history: [], pinnedHosts: [] };
    const warpgate = {
      getConfig: () => config,
      saveConfig: (partial: Partial<WarpgatePluginConfig>) => Object.assign(config, partial),
    };
    hostSettings = new WarpgateHostSettingsService(warpgate as unknown as WarpgateService);
    service = new WarpgateOsDetectionService(warpgate as unknown as WarpgateService, hostSettings);
  });

  it('should detect and store the operating system of a host', async () => {
    const client = createFakeClient({ [OS_DETECTION_COMMAND]: UBUNTU });

    const os = await service.detectOverSession('wg-1', 'web', { ssh: client });

    expect(os).toMatchObject({ id: 'ubuntu', label: 'Ubuntu 24.04' });
    expect(hostSettings.getDetectedOs('wg-1', 'web')).toMatchObject({ id: 'ubuntu', name: 'Ubuntu 24.04.1 LTS' });
    expect(client.channels).toHaveLength(1);
  });

  it('should try the Windows command when the first one gives nothing useful', async () => {
    const client = createFakeClient({
      [OS_DETECTION_COMMAND]: '',
      [WINDOWS_DETECTION_COMMAND]: 'Microsoft Windows [Version 10.0.20348.2340]\r\n',
    });

    await expect(service.detectOverSession('wg-1', 'web', { ssh: client })).resolves.toMatchObject({ id: 'windows' });
  });

  it('should not detect again until the interval has passed', async () => {
    const client = createFakeClient({ [OS_DETECTION_COMMAND]: UBUNTU });
    await service.detectOverSession('wg-1', 'web', { ssh: client });

    await expect(service.detectOverSession('wg-1', 'web', { ssh: client })).resolves.toBeNull();
    expect(client.channels).toHaveLength(1);

    const stored = hostSettings.getDetectedOs('wg-1', 'web')!;
    expect(service.needsDetection('wg-1', 'web', stored.detectedAt + OS_REDETECT_INTERVAL_MS + 1)).toBe(true);
  });

  it('should run one detection at a time per host', async () => {
    const client = createFakeClient({ [OS_DETECTION_COMMAND]: UBUNTU });

    await Promise.all([
      service.detectOverSession('wg-1', 'web', { ssh: client }),
      service.detectOverSession('wg-1', 'web', { ssh: client }),
    ]);

    expect(client.channels).toHaveLength(1);
  });

  it('should do nothing when detection is turned off or the session cannot run commands', async () => {
    const client = createFakeClient({ [OS_DETECTION_COMMAND]: UBUNTU });

    await expect(service.detectOverSession('wg-1', 'web', null)).resolves.toBeNull();
    await expect(service.detectOverSession('wg-1', 'web', { ssh: {} })).resolves.toBeNull();
    config.detectOs = false;
    await expect(service.detectOverSession('wg-1', 'web', { ssh: client })).resolves.toBeNull();
    expect(client.channels).toHaveLength(0);
  });

  it('should not fail when the server refuses the command', async () => {
    const client = createFakeClient({ [OS_DETECTION_COMMAND]: new Error('Channel request failed') });

    await expect(service.detectOverSession('wg-1', 'web', { ssh: client })).resolves.toBeNull();
    expect(hostSettings.getDetectedOs('wg-1', 'web')).toBeNull();
  });

  it('should show the detected OS as host icon and color, unless a custom color is set', async () => {
    const client = createFakeClient({ [OS_DETECTION_COMMAND]: UBUNTU });
    await service.detectOverSession('wg-1', 'web', { ssh: client });

    expect(hostSettings.getAppearance('wg-1', TARGET)).toMatchObject({
      icon: 'fab fa-ubuntu',
      color: '#e95420',
      autoColor: '#e95420',
      os: expect.objectContaining({ label: 'Ubuntu 24.04' }),
    });

    hostSettings.updateSettings('wg-1', 'web', { color: '#123456' });
    expect(hostSettings.getAppearance('wg-1', TARGET)).toMatchObject({ icon: 'fab fa-ubuntu', color: '#123456', autoColor: '#e95420' });
  });

  it('should forget detected systems of removed servers', async () => {
    const client = createFakeClient({ [OS_DETECTION_COMMAND]: UBUNTU });
    await service.detectOverSession('wg-1', 'web', { ssh: client });

    hostSettings.removeServerSettings('wg-1');

    expect(hostSettings.getDetectedOs('wg-1', 'web')).toBeNull();
  });
});
