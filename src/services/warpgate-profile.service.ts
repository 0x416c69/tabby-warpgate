/**
 * Warpgate Profile Service
 * Provides SSH profiles for Warpgate targets that integrate with Tabby's profile system
 */

import { Injectable, Inject, Injector } from '@angular/core';
import { ProfileProvider, ProfilesService, PartialProfile, NewTabParameters } from 'tabby-core';
import { SSHProfile } from 'tabby-ssh';

import { WarpgateService } from './warpgate.service';
import { WarpgateHostSettingsService } from './host-settings.service';
import { WarpgateTarget, WarpgateServerConfig } from '../models/warpgate.models';
import { BOOTSTRAP_COLORS, THEME_ICONS } from '../models/theme.constants';
import { WarpgateProfileKind, buildWarpgateProfileId, parseWarpgateProfileId } from '../utils/profile-id';
import { createLogger } from '../utils/debug-logger';

const log = createLogger('ProfileService');

/** Extended SSH profile with Warpgate metadata */
export interface WarpgateSSHProfile extends SSHProfile {
  warpgate?: {
    serverId: string;
    serverName: string;
    targetName: string;
    targetDescription?: string;
    groupName?: string;
    /**
     * DEPRECATED: Not populated anymore. The SSH handler reads the password
     * from the server configuration when it needs it.
     */
    password?: string;
    /**
     * DEPRECATED: Do not use. OTP codes are generated fresh on-demand by the SSH handler.
     * TOTP codes are time-based and can only be used once, so they should never be cached.
     */
    otpCode?: string;
  };
}

/** Connection fields of an SSH profile */
interface ProfileConnection {
  host: string;
  port: number;
  user: string;
  auth: 'password' | null;
  password: string | null;
}

/**
 * Warpgate Profile Provider
 * Provides dynamic SSH profiles based on available Warpgate targets
 */
@Injectable({ providedIn: 'root' })
export class WarpgateProfileProvider extends ProfileProvider<WarpgateSSHProfile> {
  id = 'warpgate-ssh';
  name = 'Warpgate SSH';
  supportsQuickConnect = false;
  settingsComponent = null;

  constructor(
    @Inject(WarpgateService) private warpgateService: WarpgateService,
    @Inject(WarpgateHostSettingsService) private hostSettings: WarpgateHostSettingsService,
    @Inject(Injector) private injector: Injector
  ) {
    super();
  }

  /**
   * Get all available profiles from Warpgate servers
   * These profiles use password authentication details; the SSH handler swaps in
   * a fresh one-time ticket right before each connection when tickets are enabled
   */
  async getBuiltinProfiles(): Promise<WarpgateSSHProfile[]> {
    const profiles: WarpgateSSHProfile[] = [];

    // Wait for servers that are still connecting (or were never connected),
    // but do not retry servers that already failed every time Tabby lists profiles
    const servers = this.warpgateService.getServers().filter(s => s.enabled);
    await Promise.all(servers.map(server => this.warpgateService.ensureConnected(server.id)));

    for (const { server, target } of this.warpgateService.getAllTargets()) {
      try {
        profiles.push(this.createProfileFromTarget(server, target));
      } catch (error) {
        log.debug(`Skipping profile for ${target.name}:`, error);
      }
    }

    return profiles;
  }

  /**
   * Create a profile from a Warpgate target using password authentication details
   */
  createProfileFromTarget(server: WarpgateServerConfig, target: WarpgateTarget): WarpgateSSHProfile {
    const connectionDetails = this.warpgateService.getSshConnectionDetails(server.id, target.name);

    if (!connectionDetails) {
      throw new Error(`Cannot get connection details for ${target.name}`);
    }

    return this.buildProfile(server, target, undefined, {
      host: connectionDetails.host,
      port: connectionDetails.port,
      user: connectionDetails.username,
      auth: null,
      password: connectionDetails.password ?? null,
    });
  }

  /**
   * Create a profile with fresh ticket for one-click access
   * This creates a new one-time ticket for immediate use
   */
  async createProfileWithTicket(
    server: WarpgateServerConfig,
    target: WarpgateTarget
  ): Promise<WarpgateSSHProfile> {
    const ticketDetails = await this.warpgateService.getOrCreateTicket(server.id, target.name);

    if (!ticketDetails) {
      throw new Error(`Cannot get ticket for ${target.name}`);
    }

    return this.buildTicketProfile(server, target, ticketDetails);
  }

  /**
   * Create a profile with automatic password + OTP authentication
   * This is the fallback method when ticket creation is not available.
   * The password is used by Tabby directly, OTP prompts are answered by the SSH handler.
   */
  async createProfileWithAutoAuth(
    server: WarpgateServerConfig,
    target: WarpgateTarget
  ): Promise<WarpgateSSHProfile> {
    const authDetails = await this.warpgateService.getFullAuthCredentials(server.id, target.name);

    if (!authDetails) {
      throw new Error(`Cannot get auth credentials for ${target.name}`);
    }

    // auto (null) auth mode lets SSH negotiate password and keyboard-interactive auth
    return this.buildProfile(server, target, 'autoauth', {
      host: authDetails.host,
      port: authDetails.port,
      user: authDetails.username,
      auth: null,
      password: authDetails.password ?? null,
    });
  }

  /**
   * Create a one-click profile using the best available authentication method
   * Respects the authMethod setting from plugin config:
   * - 'auto': Try ticket first, fallback to password
   * - 'ticket': Only use ticket auth (fails if ticket unavailable)
   * - 'password': Only use password auth (keyboard-interactive)
   */
  async createOneClickProfile(
    server: WarpgateServerConfig,
    target: WarpgateTarget
  ): Promise<WarpgateSSHProfile> {
    const authMethod = this.warpgateService.getConfig().authMethod || 'auto';
    log.debug(`createOneClickProfile for ${target.name}, authMethod: ${authMethod}`);

    if (authMethod !== 'password') {
      let ticketDetails = null;
      try {
        ticketDetails = await this.warpgateService.getOrCreateTicket(server.id, target.name);
      } catch (error) {
        log.debug('Ticket creation threw error:', error);
      }

      if (ticketDetails) {
        return this.buildTicketProfile(server, target, ticketDetails);
      }

      if (authMethod === 'ticket') {
        throw new Error(`Cannot create ticket for ${target.name}. Ticket-only mode is enabled but ticket creation failed.`);
      }
    }

    return this.createProfileWithAutoAuth(server, target);
  }

  /**
   * Build a profile from existing ticket details (doesn't create a new ticket)
   */
  private buildTicketProfile(
    server: WarpgateServerConfig,
    target: WarpgateTarget,
    ticketDetails: { host: string; port: number; username: string }
  ): WarpgateSSHProfile {
    // Tickets are passed in the username; Warpgate accepts any password with it
    return this.buildProfile(server, target, 'ticket', {
      host: ticketDetails.host,
      port: ticketDetails.port,
      user: ticketDetails.username,
      auth: 'password',
      password: 'x',
    });
  }

  /**
   * Build an SSH profile for a target with the host's customization applied
   */
  private buildProfile(
    server: WarpgateServerConfig,
    target: WarpgateTarget,
    kind: WarpgateProfileKind | undefined,
    connection: ProfileConnection
  ): WarpgateSSHProfile {
    const settings = this.hostSettings.getSettings(server.id, target.name);
    const groupName = target.group?.name || server.name;

    const options: Record<string, any> = {
      host: connection.host,
      port: connection.port,
      user: connection.user,
      auth: connection.auth,
      password: connection.password,
      algorithms: {},
    };

    // Only set options that differ from Tabby's defaults
    const sshOptions = this.hostSettings.getEffectiveSshOptions(server, target.name);
    if (sshOptions.agentForward) {
      options.agentForward = true;
    }
    if (sshOptions.x11) {
      options.x11 = true;
    }
    if (sshOptions.keepaliveInterval !== undefined) {
      options.keepaliveInterval = sshOptions.keepaliveInterval;
    }
    if (sshOptions.forwardedPorts.length > 0) {
      options.forwardedPorts = sshOptions.forwardedPorts;
    }
    if (sshOptions.scripts.length > 0) {
      options.scripts = sshOptions.scripts;
    }

    return {
      id: buildWarpgateProfileId(server.id, target.name, kind),
      type: 'ssh',
      name: settings.alias || target.name,
      group: `Warpgate/${groupName}`,
      icon: this.getIconForTarget(target),
      color: settings.color || this.getColorForTarget(target),
      isBuiltin: true,
      isTemplate: false,
      options: options as WarpgateSSHProfile['options'],
      warpgate: {
        serverId: server.id,
        serverName: server.name,
        targetName: target.name,
        targetDescription: target.description,
        groupName: target.group?.name,
      },
    };
  }

  /**
   * Get icon for a target based on its properties
   */
  private getIconForTarget(target: WarpgateTarget): string {
    if (target.group?.color) {
      return THEME_ICONS[target.group.color] || 'fas fa-server';
    }
    return 'fas fa-server';
  }

  /**
   * Get color for a target
   */
  private getColorForTarget(target: WarpgateTarget): string | undefined {
    return target.group?.color ? BOOTSTRAP_COLORS[target.group.color] : undefined;
  }

  /**
   * Resolve server and target of a profile
   * Tabby's profile proxies hide the warpgate metadata, so fall back to the profile ID
   */
  private resolveProfile(profile: PartialProfile<WarpgateSSHProfile>): {
    serverName?: string;
    targetName: string;
    description?: string;
  } | null {
    if (profile.warpgate) {
      return {
        serverName: profile.warpgate.serverName,
        targetName: profile.warpgate.targetName,
        description: profile.warpgate.targetDescription,
      };
    }

    const parsed = parseWarpgateProfileId(profile.id);
    if (!parsed) {
      return null;
    }
    return {
      serverName: this.warpgateService.getServer(parsed.serverId)?.name,
      targetName: parsed.targetName,
      description: this.warpgateService.getTarget(parsed.serverId, parsed.targetName)?.description,
    };
  }

  /**
   * Get suggested name for a profile
   */
  getSuggestedName(profile: PartialProfile<WarpgateSSHProfile>): string | null {
    const resolved = this.resolveProfile(profile);
    if (resolved) {
      return resolved.targetName;
    }
    return profile.name || null;
  }

  /**
   * Get description for a profile
   */
  getDescription(profile: PartialProfile<WarpgateSSHProfile>): string {
    const resolved = this.resolveProfile(profile);
    if (resolved) {
      const parts = [
        resolved.serverName ? `Warpgate: ${resolved.serverName}` : 'Warpgate',
        resolved.description || '',
      ].filter(Boolean);
      return parts.join(' - ');
    }
    return profile.options?.host || '';
  }

  /**
   * Get tab parameters for opening a connection
   * Warpgate profiles are SSH profiles, so Tabby's SSH provider opens them
   */
  async getNewTabParameters(profile: WarpgateSSHProfile): Promise<NewTabParameters<any>> {
    const profilesService = this.injector.get(ProfilesService);
    const sshProvider = profilesService.getProviders().find(provider => provider.id === 'ssh');
    if (!sshProvider) {
      throw new Error('Tabby SSH support is not available');
    }
    const sshProfile = profilesService.getConfigProxyForProfile({ ...profile, type: 'ssh' });
    return sshProvider.getNewTabParameters(sshProfile);
  }

  /**
   * Quick connect is not supported for Warpgate profiles
   */
  quickConnect(_query: string): PartialProfile<WarpgateSSHProfile> | null {
    return null;
  }

  /**
   * Delete a profile (not applicable for builtin profiles)
   */
  deleteProfile(_profile: WarpgateSSHProfile): void {
    // Builtin profiles cannot be deleted
  }
}
