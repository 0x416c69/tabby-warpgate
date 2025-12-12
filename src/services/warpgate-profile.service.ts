/**
 * Warpgate Profile Service
 * Provides SSH profiles for Warpgate targets that integrate with Tabby's profile system
 */

import { Injectable, Inject } from '@angular/core';
import { ProfileProvider, Profile, PartialProfile, NewTabParameters } from 'tabby-core';
import { SSHProfile } from 'tabby-ssh';

import { WarpgateService } from './warpgate.service';
import { WarpgateTarget, WarpgateServerConfig } from '../models/warpgate.models';

/** Extended SSH profile with Warpgate metadata */
export interface WarpgateSSHProfile extends SSHProfile {
  warpgate?: {
    serverId: string;
    serverName: string;
    targetName: string;
    targetDescription?: string;
    groupName?: string;
    /** Pre-computed OTP code for automatic keyboard-interactive auth */
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

  private iconMap: Record<string, string> = {
    primary: 'fas fa-server',
    secondary: 'fas fa-desktop',
    success: 'fas fa-check-circle',
    danger: 'fas fa-exclamation-triangle',
    warning: 'fas fa-exclamation-circle',
    info: 'fas fa-info-circle',
    light: 'fas fa-sun',
    dark: 'fas fa-moon',
  };

  constructor(@Inject(WarpgateService) private warpgateService: WarpgateService) {
    super();
  }

  /**
   * Get all available profiles from Warpgate servers
   */
  async getBuiltinProfiles(): Promise<WarpgateSSHProfile[]> {
    const profiles: WarpgateSSHProfile[] = [];
    const allTargets = this.warpgateService.getAllTargets();

    for (const { server, target } of allTargets) {
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
        // For ticket auth: no password needed, ticket secret is in username
        // For traditional auth: password is provided
        auth: connectionDetails.useTicket ? 'none' : 'password',
        password: connectionDetails.useTicket ? undefined : connectionDetails.password,
        keepaliveInterval: 30,
        keepaliveCountMax: 3,
        readyTimeout: 20000,
        x11: false,
        skipBanner: false,
        jumpHost: '',
        agentForward: false,
        socksProxyHost: '',
        socksProxyPort: 0,
        httpProxyHost: '',
        httpProxyPort: 0,
        scripts: [],
        forwardedPorts: [],
        algorithms: {
          hmac: [],
          kex: [],
          cipher: [],
          serverHostKey: [],
        },
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

    // Profile with ticket-based auth - no password needed!
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
        user: ticketDetails.username, // Contains ticket-<secret>
        auth: 'none', // No password needed with ticket
        keepaliveInterval: 30,
        keepaliveCountMax: 3,
        readyTimeout: 20000,
        x11: false,
        skipBanner: false,
        jumpHost: '',
        agentForward: false,
        socksProxyHost: '',
        socksProxyPort: 0,
        httpProxyHost: '',
        httpProxyPort: 0,
        scripts: [],
        forwardedPorts: [],
        algorithms: {
          hmac: [],
          kex: [],
          cipher: [],
          serverHostKey: [],
        },
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
   * The OTP code is stored in warpgate metadata and can be used by
   * custom keyboard-interactive handlers or injected during connection
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

    // Profile with password auth - OTP code stored in warpgate metadata
    // for use by keyboard-interactive handler
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
        // Use password auth - Tabby will handle keyboard-interactive prompts
        // and use the stored password for password prompts
        auth: 'password',
        password: authDetails.password,
        keepaliveInterval: 30,
        keepaliveCountMax: 3,
        readyTimeout: 20000,
        x11: false,
        skipBanner: false,
        jumpHost: '',
        agentForward: false,
        socksProxyHost: '',
        socksProxyPort: 0,
        httpProxyHost: '',
        httpProxyPort: 0,
        scripts: [],
        forwardedPorts: [],
        algorithms: {
          hmac: [],
          kex: [],
          cipher: [],
          serverHostKey: [],
        },
      },
      warpgate: {
        serverId: server.id,
        serverName: server.name,
        targetName: target.name,
        targetDescription: target.description,
        groupName: target.group?.name,
        // Store OTP code for keyboard-interactive handler to use
        otpCode: authDetails.otpCode,
      },
    };

    return profile;
  }

  /**
   * Create a one-click profile using the best available authentication method
   * Priority: 1) Ticket auth, 2) Auto auth with OTP, 3) Password only
   */
  async createOneClickProfile(
    server: WarpgateServerConfig,
    target: WarpgateTarget
  ): Promise<WarpgateSSHProfile> {
    // First, try to get a ticket for true one-click access
    try {
      const ticketDetails = await this.warpgateService.getOrCreateTicket(server.id, target.name);
      if (ticketDetails && ticketDetails.username.startsWith('ticket-')) {
        return this.createProfileWithTicket(server, target);
      }
    } catch {
      // Ticket creation failed, fall back to auto auth
    }

    // Fall back to automatic password + OTP authentication
    return this.createProfileWithAutoAuth(server, target);
  }

  /**
   * Get icon for a target based on its properties
   */
  private getIconForTarget(target: WarpgateTarget): string {
    if (target.group?.color) {
      return this.iconMap[target.group.color] || 'fas fa-server';
    }
    return 'fas fa-server';
  }

  /**
   * Get color for a target
   */
  private getColorForTarget(target: WarpgateTarget): string | undefined {
    const colorMap: Record<string, string> = {
      primary: '#007bff',
      secondary: '#6c757d',
      success: '#28a745',
      danger: '#dc3545',
      warning: '#ffc107',
      info: '#17a2b8',
      light: '#f8f9fa',
      dark: '#343a40',
    };

    if (target.group?.color) {
      return colorMap[target.group.color];
    }
    return undefined;
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

/**
 * SFTP Profile for Warpgate targets
 */
export interface WarpgateSFTPProfile extends Profile {
  type: 'sftp';
  warpgate: {
    serverId: string;
    serverName: string;
    targetName: string;
  };
  options: {
    host: string;
    port: number;
    user: string;
    password?: string;
    initialPath: string;
  };
}

/**
 * Warpgate SFTP Profile Provider
 * Provides SFTP profiles for Warpgate SSH targets
 */
@Injectable({ providedIn: 'root' })
export class WarpgateSFTPProfileProvider extends ProfileProvider<WarpgateSFTPProfile> {
  id = 'warpgate-sftp';
  name = 'Warpgate SFTP';
  supportsQuickConnect = false;
  settingsComponent = null;

  constructor(@Inject(WarpgateService) private warpgateService: WarpgateService) {
    super();
  }

  /**
   * Get all available SFTP profiles
   * Uses ticket-based authentication for one-click access
   */
  async getBuiltinProfiles(): Promise<WarpgateSFTPProfile[]> {
    const profiles: WarpgateSFTPProfile[] = [];
    const allTargets = this.warpgateService.getAllTargets();
    const config = this.warpgateService.getConfig();

    for (const { server, target } of allTargets) {
      const connectionDetails = this.warpgateService.getSshConnectionDetails(server.id, target.name);

      if (!connectionDetails) {
        continue;
      }

      const profile: WarpgateSFTPProfile = {
        id: `warpgate-sftp:${server.id}:${target.name}`,
        type: 'sftp',
        name: `${target.name} (SFTP)`,
        group: `Warpgate SFTP/${target.group?.name || server.name}`,
        icon: 'fas fa-folder',
        isBuiltin: true,
        isTemplate: false,
        warpgate: {
          serverId: server.id,
          serverName: server.name,
          targetName: target.name,
        },
        options: {
          host: connectionDetails.host,
          port: connectionDetails.port,
          user: connectionDetails.username,
          // For ticket auth: no password needed
          // For traditional auth: password is provided
          password: connectionDetails.useTicket ? undefined : connectionDetails.password,
          initialPath: config.defaultSftpPath || '~',
        },
      };

      profiles.push(profile);
    }

    return profiles;
  }

  /**
   * Create an SFTP profile with fresh ticket for one-click access
   */
  async createSftpProfileWithTicket(
    server: WarpgateServerConfig,
    target: WarpgateTarget
  ): Promise<WarpgateSFTPProfile> {
    const config = this.warpgateService.getConfig();
    const ticketDetails = await this.warpgateService.getOrCreateTicket(server.id, target.name);

    if (!ticketDetails) {
      throw new Error(`Cannot get ticket for ${target.name}`);
    }

    return {
      id: `warpgate-sftp:${server.id}:${target.name}:ticket`,
      type: 'sftp',
      name: `${target.name} (SFTP)`,
      group: `Warpgate SFTP/${target.group?.name || server.name}`,
      icon: 'fas fa-folder',
      isBuiltin: true,
      isTemplate: false,
      warpgate: {
        serverId: server.id,
        serverName: server.name,
        targetName: target.name,
      },
      options: {
        host: ticketDetails.host,
        port: ticketDetails.port,
        user: ticketDetails.username, // Contains ticket-<secret>
        // No password needed with ticket auth
        initialPath: config.defaultSftpPath || '~',
      },
    };
  }

  /**
   * Create an SFTP profile with automatic authentication (fallback)
   * Uses password + OTP for keyboard-interactive auth
   */
  async createSftpProfileWithAutoAuth(
    server: WarpgateServerConfig,
    target: WarpgateTarget
  ): Promise<WarpgateSFTPProfile> {
    const config = this.warpgateService.getConfig();
    const authDetails = await this.warpgateService.getFullAuthCredentials(server.id, target.name);

    if (!authDetails) {
      throw new Error(`Cannot get auth credentials for ${target.name}`);
    }

    // If ticket auth is available, use that
    if (authDetails.useTicket) {
      return this.createSftpProfileWithTicket(server, target);
    }

    return {
      id: `warpgate-sftp:${server.id}:${target.name}:autoauth`,
      type: 'sftp',
      name: `${target.name} (SFTP)`,
      group: `Warpgate SFTP/${target.group?.name || server.name}`,
      icon: 'fas fa-folder',
      isBuiltin: true,
      isTemplate: false,
      warpgate: {
        serverId: server.id,
        serverName: server.name,
        targetName: target.name,
      },
      options: {
        host: authDetails.host,
        port: authDetails.port,
        user: authDetails.username,
        password: authDetails.password,
        initialPath: config.defaultSftpPath || '~',
      },
    };
  }

  /**
   * Create a one-click SFTP profile using the best available auth method
   */
  async createOneClickSftpProfile(
    server: WarpgateServerConfig,
    target: WarpgateTarget
  ): Promise<WarpgateSFTPProfile> {
    // First, try to get a ticket for true one-click access
    try {
      const ticketDetails = await this.warpgateService.getOrCreateTicket(server.id, target.name);
      if (ticketDetails && ticketDetails.username.startsWith('ticket-')) {
        return this.createSftpProfileWithTicket(server, target);
      }
    } catch {
      // Ticket creation failed, fall back to auto auth
    }

    // Fall back to automatic password authentication
    return this.createSftpProfileWithAutoAuth(server, target);
  }

  /**
   * Get suggested name
   */
  getSuggestedName(profile: PartialProfile<WarpgateSFTPProfile>): string | null {
    if (profile.warpgate) {
      return `${profile.warpgate.targetName} (SFTP)`;
    }
    return profile.name || null;
  }

  /**
   * Get description
   */
  getDescription(profile: PartialProfile<WarpgateSFTPProfile>): string {
    if (profile.warpgate) {
      return `SFTP via Warpgate: ${profile.warpgate.serverName}`;
    }
    return profile.options?.host || '';
  }

  /**
   * Get tab parameters
   */
  async getNewTabParameters(profile: Profile): Promise<NewTabParameters<any>> {
    return {
      type: 'sftp-tab',
      inputs: {
        profile,
      },
    };
  }

  /**
   * Quick connect not supported
   */
  quickConnect(_query: string): PartialProfile<WarpgateSFTPProfile> | null {
    return null;
  }

  /**
   * Delete profile
   */
  deleteProfile(_profile: WarpgateSFTPProfile): void {
    // Builtin profiles cannot be deleted
  }
}
