/**
 * Warpgate Profile Service
 * Provides SSH profiles for Warpgate targets that integrate with Tabby's profile system
 */

import { Injectable, Inject } from '@angular/core';
import { ProfileProvider, Profile, PartialProfile, NewTabParameters } from 'tabby-core';
import { SSHProfile } from 'tabby-ssh';

import { WarpgateService } from './warpgate.service';
import { WarpgateTarget, WarpgateServerConfig } from '../models/warpgate.models';
import { BOOTSTRAP_COLORS, THEME_ICONS } from '../models/theme.constants';
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
     * Password for keyboard-interactive auth.
     * Stored here instead of options.password to avoid interfering with auto auth mode.
     */
    password?: string;
    /**
     * DEPRECATED: Do not use. OTP codes are now generated fresh on-demand by the SSH handler.
     * TOTP codes are time-based and can only be used once, so they should never be cached.
     * This field is kept for backwards compatibility but should always be undefined.
     */
    otpCode?: string;
  };
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

  constructor(@Inject(WarpgateService) private warpgateService: WarpgateService) {
    super();
  }

  /**
   * Get all available profiles from Warpgate servers
   */
  async getBuiltinProfiles(): Promise<WarpgateSSHProfile[]> {
    const profiles: WarpgateSSHProfile[] = [];

    // Ensure all servers are connected and server info is loaded
    // This populates the serverInfo map which is needed for ticket auth
    const servers = this.warpgateService.getServers().filter(s => s.enabled);
    await Promise.all(
      servers.map(async server => {
        if (!this.warpgateService.isConnected(server.id)) {
          try {
            await this.warpgateService.connect(server.id);
          } catch {
            // Ignore connection errors - profiles just won't be available for this server
          }
        }
      })
    );

    // Get targets AFTER ensuring connections are established
    const allTargets = this.warpgateService.getAllTargets();

    for (const { server, target } of allTargets) {
      // Use createProfileFromTarget for builtin profiles list
      // This does NOT create tickets - tickets are only created when user clicks connect
      // from Warpgate Hosts view (which uses createOneClickProfile)
      const profile = this.createProfileFromTarget(server, target);
      profiles.push(profile);
    }

    return profiles;
  }

  /**
   * Create a profile from a Warpgate target
   * Uses ticket-based authentication for one-click access when available
   */
  createProfileFromTarget(server: WarpgateServerConfig, target: WarpgateTarget): WarpgateSSHProfile {
    const connectionDetails = this.warpgateService.getSshConnectionDetails(server.id, target.name);

    if (!connectionDetails) {
      throw new Error(`Cannot get connection details for ${target.name}`);
    }

    const profileId = `warpgate:${server.id}:${target.name}`;
    const groupName = target.group?.name || server.name;

    // When using ticket-based auth, no password is needed (it's embedded in the username)
    const profile: WarpgateSSHProfile = {
      id: profileId,
      type: 'ssh',
      name: target.name,
      group: `Warpgate/${groupName}`,
      icon: this.getIconForTarget(target),
      color: this.getColorForTarget(target),
      isBuiltin: true,
      isTemplate: false,
      options: {
        host: connectionDetails.host,
        port: connectionDetails.port,
        user: connectionDetails.username,
        // For ticket auth: use auto mode (null) since ticket is embedded in username
        // For traditional auth: use password authentication
        auth: connectionDetails.useTicket ? 'password' : null,
        password: connectionDetails.useTicket ? 'x' : connectionDetails.password,
        algorithms: {},
      },
      warpgate: {
        serverId: server.id,
        serverName: server.name,
        targetName: target.name,
        targetDescription: target.description,
        groupName: target.group?.name,
      },
    };

    return profile;
  }

  /**
   * Create a profile with fresh ticket for one-click access
   * This creates a new one-time ticket for immediate use
   */
  async createProfileWithTicket(
    server: WarpgateServerConfig,
    target: WarpgateTarget
  ): Promise<WarpgateSSHProfile> {
    // Get or create a fresh ticket for this target
    const ticketDetails = await this.warpgateService.getOrCreateTicket(server.id, target.name);

    if (!ticketDetails) {
      throw new Error(`Cannot get ticket for ${target.name}`);
    }

    const profileId = `warpgate:${server.id}:${target.name}:ticket`;
    const groupName = target.group?.name || server.name;

    // Profile with ticket-based auth
    // Match EXACTLY the structure that works when manually created in Tabby UI
    const profile: WarpgateSSHProfile = {
      id: profileId,
      type: 'ssh',
      name: target.name,
      group: `Warpgate/${groupName}`,
      icon: this.getIconForTarget(target),
      color: this.getColorForTarget(target),
      isBuiltin: true,
      isTemplate: false,
      options: {
        host: ticketDetails.host,
        port: ticketDetails.port,
        user: ticketDetails.username,
        auth: 'password',
        password: 'x',
        algorithms: {},
      },
      warpgate: {
        serverId: server.id,
        serverName: server.name,
        targetName: target.name,
        targetDescription: target.description,
        groupName: target.group?.name,
      },
    };

    return profile;
  }

  /**
   * Create a profile with automatic password + OTP authentication
   * This is the fallback method when ticket creation is not available
   * Uses keyboard-interactive auth with password stored for auto-fill
   * OTP code is stored in warpgate metadata for the KI handler to use
   */
  async createProfileWithAutoAuth(
    server: WarpgateServerConfig,
    target: WarpgateTarget
  ): Promise<WarpgateSSHProfile> {
    // Get full credentials including OTP code
    const authDetails = await this.warpgateService.getFullAuthCredentials(server.id, target.name);

    if (!authDetails) {
      throw new Error(`Cannot get auth credentials for ${target.name}`);
    }

    // If ticket auth is available, use that instead
    if (authDetails.useTicket) {
      return this.createProfileWithTicket(server, target);
    }

    const profileId = `warpgate:${server.id}:${target.name}:autoauth`;
    const groupName = target.group?.name || server.name;

    log.debug(` Creating auto-auth profile for ${target.name} with OTP: ${authDetails.otpCode ? 'yes' : 'no'}`);

    // Use minimal profile structure matching the working "testy" profile
    // No password in options - it will be prompted via keyboard-interactive
    const profile: WarpgateSSHProfile = {
      id: profileId,
      type: 'ssh',
      name: target.name,
      group: `Warpgate/${groupName}`,
      icon: this.getIconForTarget(target),
      color: this.getColorForTarget(target),
      isBuiltin: true,
      isTemplate: false,
      options: {
        host: authDetails.host,
        port: authDetails.port,
        user: authDetails.username,
        // Use auto (null) auth mode to let SSH negotiate the best method
        // Warpgate will prompt for OTP first, then password via keyboard-interactive
        // CRITICAL: Must be `null` not `undefined` to match Tabby's serialization behavior
        auth: null,
        // Include password so Tabby's built-in keyboard-interactive handler can use it
        // for the password prompt (after OTP prompt)
        password: authDetails.password,
        algorithms: {},
        input: {},
      },
      warpgate: {
        serverId: server.id,
        serverName: server.name,
        targetName: target.name,
        targetDescription: target.description,
        groupName: target.group?.name,
        // Store password here so the SSH handler can access it
        password: authDetails.password,
        // NOTE: Do NOT store otpCode here! OTP codes are time-based and can only be used once.
        // The SSH handler will generate fresh OTP codes on demand for each auth attempt.
      },
    };

    return profile;
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
    const config = this.warpgateService.getConfig();
    const authMethod = config.authMethod || 'auto';
    log.debug(` createOneClickProfile for ${target.name}, authMethod: ${authMethod}`);

    // If password-only is configured, skip ticket auth entirely
    if (authMethod === 'password') {
      log.debug(' Using password auth (configured)');
      return this.createProfileWithAutoAuth(server, target);
    }

    // Try to get a ticket for one-click access (for 'auto' or 'ticket' modes)
    try {
      const ticketDetails = await this.warpgateService.getOrCreateTicket(server.id, target.name);
      log.debug(' Ticket details:', ticketDetails);
      if (ticketDetails && ticketDetails.username.startsWith('ticket-')) {
        log.debug(` Using ticket auth profile with username: ${ticketDetails.username}`);
        // Create profile directly with the ticket details we already have
        // Don't call createProfileWithTicket as it would create another ticket
        return this.buildTicketProfile(server, target, ticketDetails);
      } else {
        log.debug(` Ticket username doesn't start with 'ticket-': ${ticketDetails?.username}`);
      }
    } catch (error) {
      // Ticket creation failed
      log.debug(' Ticket creation threw error:', error);

      // If ticket-only mode, throw error
      if (authMethod === 'ticket') {
        throw new Error(`Cannot create ticket for ${target.name}. Ticket-only mode is enabled but ticket creation failed.`);
      }
    }

    // Fall back to automatic password authentication (only for 'auto' mode)
    log.debug(' Falling back to auto auth profile');
    return this.createProfileWithAutoAuth(server, target);
  }

  /**
   * Build a profile from existing ticket details (doesn't create new ticket)
   */
  private buildTicketProfile(
    server: WarpgateServerConfig,
    target: WarpgateTarget,
    ticketDetails: { host: string; port: number; username: string }
  ): WarpgateSSHProfile {
    const profileId = `warpgate:${server.id}:${target.name}:ticket`;
    const groupName = target.group?.name || server.name;

    // For Warpgate ticket auth:
    // Match EXACTLY the structure that works when manually created in Tabby UI
    // The working profile has: auth: password, algorithms: {}, input: {}
    // DO NOT add extra fields - they cause authentication issues
    log.debug(` Building ticket profile with username: ${ticketDetails.username}`);

    return {
      id: profileId,
      type: 'ssh',
      name: target.name,
      group: `Warpgate/${groupName}`,
      icon: this.getIconForTarget(target),
      color: this.getColorForTarget(target),
      isBuiltin: true,
      isTemplate: false,
      options: {
        host: ticketDetails.host,
        port: ticketDetails.port,
        user: ticketDetails.username,
        auth: 'password',
        password: 'x',
        algorithms: {},
      },
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
   * Get suggested name for a profile
   */
  getSuggestedName(profile: PartialProfile<WarpgateSSHProfile>): string | null {
    if (profile.warpgate) {
      return profile.warpgate.targetName;
    }
    return profile.name || null;
  }

  /**
   * Get description for a profile
   */
  getDescription(profile: PartialProfile<WarpgateSSHProfile>): string {
    if (profile.warpgate) {
      const parts = [
        `Warpgate: ${profile.warpgate.serverName}`,
        profile.warpgate.targetDescription || '',
      ].filter(Boolean);
      return parts.join(' - ');
    }
    return profile.options?.host || '';
  }

  /**
   * Get tab parameters for opening a connection
   */
  async getNewTabParameters(profile: Profile): Promise<NewTabParameters<any>> {
    return {
      type: 'ssh-tab',
      inputs: {
        profile,
      },
    };
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
