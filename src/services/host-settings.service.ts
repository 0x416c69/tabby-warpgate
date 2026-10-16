/**
 * Warpgate Host Settings Service
 * Stores per-host customization (alias, tags, notes, color, SSH options) and the
 * detected operating system, and applies them to the SSH profiles used for connections
 */

import { Injectable, Inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import { WarpgateService } from './warpgate.service';
import {
  WarpgateHostOs,
  WarpgateHostSettings,
  WarpgatePortForward,
  WarpgateServerConfig,
  WarpgateTarget,
  getHostKey,
} from '../models/warpgate.models';
import { getTargetColor, getTargetIcon } from '../utils/target-appearance';
import { getOsAppearance } from '../utils/os-detection';

/** Port forward types accepted by Tabby */
const PORT_FORWARD_TYPES = ['Local', 'Remote', 'Dynamic'];

/** How a host is shown: icon, accent color and detected operating system */
export interface WarpgateHostAppearance {
  icon: string;
  /** Custom color, or the automatic one */
  color: string;
  /** Color used when no custom color is set (OS brand color or keyword based) */
  autoColor: string;
  os: WarpgateHostOs | null;
}

/** SSH profile options managed by this service */
export interface WarpgateManagedSshOptions {
  agentForward: boolean;
  x11: boolean;
  keepaliveInterval?: number;
  forwardedPorts: WarpgatePortForward[];
  scripts: Array<{ expect: string; send: string }>;
}

/**
 * Split a free-form tag list ("prod, web db") into unique tags
 */
export function parseTags(input: string | string[] | undefined | null): string[] {
  const raw = Array.isArray(input) ? input : (input ?? '').split(/[,\s]+/);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw) {
    const tag = value.trim().replace(/^#/, '');
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Validate and clean a port forwarding rule, returns null when it is unusable
 */
export function normalizePortForward(rule: Partial<WarpgatePortForward>): WarpgatePortForward | null {
  const type = PORT_FORWARD_TYPES.includes(rule.type as string) ? rule.type as WarpgatePortForward['type'] : null;
  const port = Number(rule.port);
  if (!type || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  const targetPort = Number(rule.targetPort);
  if (type !== 'Dynamic' && (!rule.targetAddress?.trim() || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535)) {
    return null;
  }

  return {
    type,
    host: rule.host?.trim() || '127.0.0.1',
    port,
    targetAddress: type === 'Dynamic' ? '' : rule.targetAddress!.trim(),
    targetPort: type === 'Dynamic' ? 0 : targetPort,
    description: rule.description?.trim() || '',
  };
}

/**
 * Describe a port forwarding rule ("L 127.0.0.1:8080 → db:5432")
 */
export function describePortForward(rule: WarpgatePortForward): string {
  const listen = `${rule.host}:${rule.port}`;
  if (rule.type === 'Dynamic') {
    return `SOCKS ${listen}`;
  }
  const prefix = rule.type === 'Local' ? 'L' : 'R';
  return `${prefix} ${listen} → ${rule.targetAddress}:${rule.targetPort}`;
}

/**
 * Host Settings Service
 */
@Injectable({ providedIn: 'root' })
export class WarpgateHostSettingsService {
  private changesSubject = new Subject<string>();

  /** Emits the host key whenever settings of a host change */
  readonly changes$: Observable<string> = this.changesSubject.asObservable();

  constructor(@Inject(WarpgateService) private warpgate: WarpgateService) {}

  /**
   * Get all stored host settings
   */
  getAllSettings(): Record<string, WarpgateHostSettings> {
    const settings = this.warpgate.getConfig().hostSettings;
    return settings && typeof settings === 'object' ? settings : {};
  }

  /**
   * Get settings of a host (empty object when nothing was customized)
   */
  getSettings(serverId: string, targetName: string): WarpgateHostSettings {
    const settings = this.getAllSettings()[getHostKey(serverId, targetName)];
    return settings ? JSON.parse(JSON.stringify(settings)) : {};
  }

  /**
   * Replace the settings of a host
   */
  updateSettings(serverId: string, targetName: string, settings: WarpgateHostSettings): void {
    const key = getHostKey(serverId, targetName);
    const normalized = this.normalize(settings);
    const all = { ...this.getAllSettings() };

    if (Object.keys(normalized).length === 0) {
      delete all[key];
    } else {
      all[key] = normalized;
    }

    this.warpgate.saveConfig({ hostSettings: all });
    this.changesSubject.next(key);
  }

  /**
   * Forget settings of every host of a server
   */
  removeServerSettings(serverId: string): void {
    const prefix = `${serverId}:`;
    const all = { ...this.getAllSettings() };
    const allOs = { ...this.getAllDetectedOs() };
    const settingKeys = Object.keys(all).filter(key => key.startsWith(prefix));
    const osKeys = Object.keys(allOs).filter(key => key.startsWith(prefix));
    if (settingKeys.length === 0 && osKeys.length === 0) {
      return;
    }

    settingKeys.forEach(key => delete all[key]);
    osKeys.forEach(key => delete allOs[key]);
    this.warpgate.saveConfig({ hostSettings: all, hostOs: allOs });
    this.changesSubject.next(serverId);
  }

  /**
   * Detected operating systems of all hosts
   */
  getAllDetectedOs(): Record<string, WarpgateHostOs> {
    const hostOs = this.warpgate.getConfig().hostOs;
    return hostOs && typeof hostOs === 'object' ? hostOs : {};
  }

  /**
   * Operating system detected on a host, null when unknown
   */
  getDetectedOs(serverId: string, targetName: string): WarpgateHostOs | null {
    const os = this.getAllDetectedOs()[getHostKey(serverId, targetName)];
    return os ? { ...os } : null;
  }

  /**
   * Store the operating system detected on a host
   */
  setDetectedOs(serverId: string, targetName: string, os: WarpgateHostOs): void {
    const key = getHostKey(serverId, targetName);
    this.warpgate.saveConfig({ hostOs: { ...this.getAllDetectedOs(), [key]: { ...os } } });
    this.changesSubject.next(key);
  }

  /**
   * Icon and accent color of a host
   * The detected operating system gives the icon; a custom color wins over the OS brand color
   */
  getAppearance(serverId: string, target: WarpgateTarget): WarpgateHostAppearance {
    const settings = this.getSettings(serverId, target.name);
    const os = this.getDetectedOs(serverId, target.name);
    const osAppearance = os ? getOsAppearance(os.id) : null;
    const autoColor = osAppearance?.color ?? getTargetColor(target);
    return {
      icon: osAppearance?.icon ?? getTargetIcon(target),
      color: settings.color || autoColor,
      autoColor,
      os,
    };
  }

  /**
   * Remove references to a deleted snippet
   */
  removeSnippetReferences(snippetId: string): void {
    const all = { ...this.getAllSettings() };
    let changed = false;
    for (const [key, settings] of Object.entries(all)) {
      if (settings.startupSnippetId === snippetId) {
        all[key] = this.normalize({ ...settings, startupSnippetId: undefined });
        if (Object.keys(all[key]).length === 0) {
          delete all[key];
        }
        changed = true;
      }
    }
    if (changed) {
      this.warpgate.saveConfig({ hostSettings: all });
    }
  }

  /**
   * Name shown for a host (alias or target name)
   */
  getDisplayName(serverId: string, target: WarpgateTarget | string): string {
    const targetName = typeof target === 'string' ? target : target.name;
    return this.getSettings(serverId, targetName).alias || targetName;
  }

  /**
   * All tags used by any host, sorted alphabetically
   */
  getAllTags(): string[] {
    const tags = new Map<string, string>();
    for (const settings of Object.values(this.getAllSettings())) {
      for (const tag of settings.tags ?? []) {
        if (!tags.has(tag.toLowerCase())) {
          tags.set(tag.toLowerCase(), tag);
        }
      }
    }
    return Array.from(tags.values()).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Resolve the SSH options for a host: host settings override server defaults
   */
  getEffectiveSshOptions(server: WarpgateServerConfig, targetName: string): WarpgateManagedSshOptions {
    const settings = this.getSettings(server.id, targetName);
    const options: WarpgateManagedSshOptions = {
      agentForward: settings.agentForward ?? server.agentForward ?? false,
      x11: settings.x11 ?? server.x11 ?? false,
      forwardedPorts: (settings.forwardedPorts ?? []).map(rule => ({ ...rule, description: rule.description ?? '' })),
      scripts: [],
    };

    const keepalive = settings.keepaliveInterval ?? server.keepaliveInterval;
    if (keepalive !== undefined && keepalive !== null && Number.isFinite(Number(keepalive))) {
      options.keepaliveInterval = Math.max(0, Number(keepalive));
    }

    if (settings.startupSnippetId) {
      const snippet = (this.warpgate.getConfig().snippets ?? []).find(s => s.id === settings.startupSnippetId);
      const script = snippet?.script.replace(/\r\n/g, '\n').trimEnd();
      if (script) {
        // Login scripts without "expect" are sent as soon as the shell opens
        options.scripts.push({ expect: '', send: script });
      }
    }

    return options;
  }

  /**
   * Write the host's SSH options into a profile's options
   * Works with plain profile objects and Tabby's profile config proxies
   */
  applyToProfileOptions(options: Record<string, any>, server: WarpgateServerConfig, targetName: string): void {
    const effective = this.getEffectiveSshOptions(server, targetName);
    options.agentForward = effective.agentForward;
    options.x11 = effective.x11;
    options.forwardedPorts = effective.forwardedPorts;
    options.scripts = effective.scripts;
    if (effective.keepaliveInterval !== undefined) {
      options.keepaliveInterval = effective.keepaliveInterval;
    }
  }

  /**
   * Clean up settings before storing them
   */
  private normalize(settings: WarpgateHostSettings): WarpgateHostSettings {
    const result: WarpgateHostSettings = {};

    const alias = settings.alias?.trim();
    if (alias) {
      result.alias = alias;
    }

    const tags = parseTags(settings.tags);
    if (tags.length > 0) {
      result.tags = tags;
    }

    const notes = settings.notes?.trim();
    if (notes) {
      result.notes = notes;
    }

    const color = settings.color?.trim();
    if (color && /^#[0-9a-f]{3,8}$/i.test(color)) {
      result.color = color;
    }

    if (settings.startupSnippetId) {
      result.startupSnippetId = settings.startupSnippetId;
    }

    const forwardedPorts = (settings.forwardedPorts ?? [])
      .map(rule => normalizePortForward(rule))
      .filter((rule): rule is WarpgatePortForward => rule !== null);
    if (forwardedPorts.length > 0) {
      result.forwardedPorts = forwardedPorts;
    }

    if (typeof settings.agentForward === 'boolean') {
      result.agentForward = settings.agentForward;
    }
    if (typeof settings.x11 === 'boolean') {
      result.x11 = settings.x11;
    }
    if (settings.keepaliveInterval !== undefined && settings.keepaliveInterval !== null &&
        Number.isFinite(Number(settings.keepaliveInterval))) {
      result.keepaliveInterval = Math.max(0, Number(settings.keepaliveInterval));
    }

    return result;
  }
}
