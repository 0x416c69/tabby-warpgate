/**
 * Operating system detection for SSH hosts
 * The detection command runs on a separate exec channel of an open connection,
 * so nothing is typed into the user's shell
 */

/** Read-only detection command for Linux, BSD and macOS (POSIX sh) */
export const OS_DETECTION_COMMAND = 'uname -s 2>/dev/null; cat /etc/os-release 2>/dev/null || sw_vers 2>/dev/null';

/** Fallback for Windows OpenSSH servers, whose shells do not know uname */
export const WINDOWS_DETECTION_COMMAND = 'cmd /c ver';

/** Result of parsing the output of the detection command */
export interface ParsedOs {
  /** Normalized identifier used for the icon, e.g. "ubuntu", "debian", "macos", "windows", "linux" */
  id: string;
  /** Short name, e.g. "Ubuntu 24.04" */
  label: string;
  /** Full name, e.g. "Ubuntu 24.04.1 LTS" */
  name: string;
}

/** Icon and brand color of an operating system */
export interface OsAppearance {
  label: string;
  icon: string;
  color: string;
}

/** Known operating systems (Font Awesome 6 brand icons where available) */
const OS_APPEARANCE: Record<string, OsAppearance> = {
  ubuntu: { label: 'Ubuntu', icon: 'fab fa-ubuntu', color: '#e95420' },
  debian: { label: 'Debian', icon: 'fab fa-debian', color: '#a81d33' },
  raspbian: { label: 'Raspberry Pi OS', icon: 'fab fa-raspberry-pi', color: '#c51a4a' },
  centos: { label: 'CentOS', icon: 'fab fa-centos', color: '#932279' },
  rhel: { label: 'Red Hat', icon: 'fab fa-redhat', color: '#ee0000' },
  fedora: { label: 'Fedora', icon: 'fab fa-fedora', color: '#3c6eb4' },
  rocky: { label: 'Rocky Linux', icon: 'fab fa-linux', color: '#10b981' },
  almalinux: { label: 'AlmaLinux', icon: 'fab fa-linux', color: '#0f4266' },
  ol: { label: 'Oracle Linux', icon: 'fab fa-linux', color: '#c74634' },
  amzn: { label: 'Amazon Linux', icon: 'fab fa-aws', color: '#ff9900' },
  opensuse: { label: 'openSUSE', icon: 'fab fa-opensuse', color: '#73ba25' },
  sles: { label: 'SUSE', icon: 'fab fa-suse', color: '#30ba78' },
  alpine: { label: 'Alpine', icon: 'fab fa-linux', color: '#0d597f' },
  arch: { label: 'Arch Linux', icon: 'fab fa-linux', color: '#1793d1' },
  manjaro: { label: 'Manjaro', icon: 'fab fa-linux', color: '#35bf5c' },
  linuxmint: { label: 'Linux Mint', icon: 'fab fa-linux', color: '#86be43' },
  kali: { label: 'Kali Linux', icon: 'fab fa-linux', color: '#367bf0' },
  gentoo: { label: 'Gentoo', icon: 'fab fa-linux', color: '#54487a' },
  nixos: { label: 'NixOS', icon: 'fab fa-linux', color: '#5277c3' },
  macos: { label: 'macOS', icon: 'fab fa-apple', color: '#6b7280' },
  freebsd: { label: 'FreeBSD', icon: 'fab fa-freebsd', color: '#ab2b28' },
  openbsd: { label: 'OpenBSD', icon: 'fas fa-server', color: '#b8860b' },
  netbsd: { label: 'NetBSD', icon: 'fas fa-server', color: '#f26711' },
  windows: { label: 'Windows', icon: 'fab fa-windows', color: '#0078d4' },
  linux: { label: 'Linux', icon: 'fab fa-linux', color: '#d97706' },
};

/** os-release IDs that share an appearance */
const OS_ID_ALIASES: Record<string, string> = {
  'opensuse-leap': 'opensuse',
  'opensuse-tumbleweed': 'opensuse',
  'opensuse-microos': 'opensuse',
  sled: 'sles',
  sles_sap: 'sles',
  archarm: 'arch',
  redhat: 'rhel',
};

/** Kernel names printed by `uname -s` */
const KERNELS: Record<string, string> = {
  linux: 'linux',
  darwin: 'macos',
  freebsd: 'freebsd',
  openbsd: 'openbsd',
  netbsd: 'netbsd',
};

/**
 * Get the icon and brand color of an operating system
 */
export function getOsAppearance(osId: string): OsAppearance {
  return OS_APPEARANCE[osId] ?? OS_APPEARANCE.linux;
}

/**
 * Parse KEY=VALUE lines (os-release) and "Key: value" lines (sw_vers)
 */
function parseFields(lines: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|:\s)\s*(.*)$/);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === '\'') && value.endsWith(value[0])) {
      value = value.slice(1, -1).replace(/\\(["'\\$`])/g, '$1');
    }
    if (!(match[1] in fields)) {
      fields[match[1]] = value;
    }
  }
  return fields;
}

/**
 * Map an os-release ID (and its ID_LIKE fallbacks) to a known operating system
 * @returns the known ID and whether it matched the ID itself (not a look-alike)
 */
function resolveOsId(id: string, idLike: string | undefined): { id: string; exact: boolean } {
  const normalize = (value: string) => {
    const lower = value.toLowerCase();
    return OS_ID_ALIASES[lower] ?? lower;
  };

  const own = normalize(id);
  if (own in OS_APPEARANCE) {
    return { id: own, exact: true };
  }
  for (const candidate of (idLike ?? '').split(/\s+/).filter(Boolean).map(normalize)) {
    if (candidate in OS_APPEARANCE) {
      return { id: candidate, exact: false };
    }
  }
  return { id: 'linux', exact: false };
}

/**
 * Parse the output of OS_DETECTION_COMMAND (or WINDOWS_DETECTION_COMMAND)
 * Extra output, e.g. from shell startup files, is ignored
 * @returns null when the output does not identify an operating system
 */
export function parseOsDetectionOutput(output: string): ParsedOs | null {
  const lines = output.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  // `cmd /c ver` prints e.g. "Microsoft Windows [Version 10.0.20348.2340]"
  const windows = lines.map(line => line.match(/Microsoft Windows \[Version ([\d.]+)\]/i)).find(Boolean);
  if (windows) {
    return { id: 'windows', label: 'Windows', name: `Windows ${windows[1]}` };
  }

  const fields = parseFields(lines);
  const kernel = lines.map(line => KERNELS[line.toLowerCase()]).find(Boolean);

  if (fields.ID) {
    const resolved = resolveOsId(fields.ID, fields.ID_LIKE);
    const version = fields.VERSION_ID ?? '';
    const baseName = resolved.exact ? getOsAppearance(resolved.id).label : (fields.NAME || getOsAppearance(resolved.id).label);
    const label = [baseName, version].filter(Boolean).join(' ');
    return { id: resolved.id, label, name: fields.PRETTY_NAME || label };
  }

  if (kernel === 'macos' || fields.ProductName) {
    const version = fields.ProductVersion ?? '';
    const label = ['macOS', version].filter(Boolean).join(' ');
    return { id: 'macos', label, name: label };
  }

  if (kernel) {
    const label = getOsAppearance(kernel).label;
    return { id: kernel, label, name: label };
  }

  return null;
}

/** Minimal shape of the open SSH connection of a Tabby SSH session (russh AuthenticatedSSHClient) */
interface ExecCapableClient {
  openSessionChannel(): Promise<unknown>;
  activateChannel(channel: unknown): Promise<ExecChannel>;
}

interface Subscribable<T> {
  subscribe(next: (value: T) => void): { unsubscribe(): void };
}

interface ExecChannel {
  data$: Subscribable<Uint8Array | string>;
  eof$?: Subscribable<unknown>;
  closed$?: Subscribable<unknown>;
  requestExec(command: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Check whether an object can run commands on a separate channel
 */
export function canRunRemoteCommands(client: unknown): client is ExecCapableClient {
  const candidate = client as Partial<ExecCapableClient> | null | undefined;
  return typeof candidate?.openSessionChannel === 'function' && typeof candidate?.activateChannel === 'function';
}

/**
 * Run a command on a new exec channel of an open SSH connection and collect its output
 * Resolves with whatever was received when the channel closes or the timeout expires
 */
export async function runRemoteCommand(client: ExecCapableClient, command: string, timeoutMs: number): Promise<string> {
  const channel = await client.activateChannel(await client.openSessionChannel());
  const decoder = new TextDecoder();
  let output = '';

  return new Promise<string>((resolve, reject) => {
    const subscriptions: Array<{ unsubscribe(): void }> = [];
    let finished = false;

    const finish = (error?: unknown) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      subscriptions.forEach(subscription => subscription.unsubscribe());
      channel.close().catch(() => undefined);
      if (error) {
        reject(error);
      } else {
        resolve(output);
      }
    };

    const timer = setTimeout(() => finish(), timeoutMs);
    subscriptions.push(channel.data$.subscribe(data => {
      output += typeof data === 'string' ? data : decoder.decode(data, { stream: true });
    }));
    if (channel.eof$) {
      subscriptions.push(channel.eof$.subscribe(() => finish()));
    }
    if (channel.closed$) {
      subscriptions.push(channel.closed$.subscribe(() => finish()));
    }

    channel.requestExec(command).catch(error => finish(error));
  });
}
