/**
 * SFTP Profile Factory
 * Centralized SFTP profile creation to eliminate duplication across components
 */

import { WarpgateServerConfig, WarpgateTarget } from '../models/warpgate.models';
import type { WarpgateSFTPProfile } from '../services/warpgate-profile.service';

export interface SftpProfileOptions {
  host: string;
  port: number;
  user: string;
  password?: string;
  initialPath?: string;
}

export interface SftpProfileMetadata {
  serverId: string;
  serverName: string;
  targetName: string;
  groupName?: string;
  useTicket?: boolean;
}

/**
 * Create an SFTP profile with given connection details
 *
 * @param metadata Server and target metadata
 * @param options SFTP connection options
 * @returns Configured SFTP profile
 */
export function createSftpProfile(
  metadata: SftpProfileMetadata,
  options: SftpProfileOptions
): WarpgateSFTPProfile {
  const { serverId, serverName, targetName, groupName, useTicket } = metadata;
  const idSuffix = useTicket ? ':ticket' : '';

  return {
    id: `warpgate-sftp:${serverId}:${targetName}${idSuffix}`,
    type: 'sftp',
    name: `${targetName} (SFTP)`,
    group: `Warpgate SFTP/${groupName || serverName}`,
    icon: 'fas fa-folder',
    isBuiltin: true,
    isTemplate: false,
    warpgate: {
      serverId,
      serverName,
      targetName,
    },
    options: {
      host: options.host,
      port: options.port,
      user: options.user,
      password: options.password,
      initialPath: options.initialPath || '~',
    },
  };
}

/**
 * Create SFTP profile metadata from server and target
 *
 * @param server Warpgate server configuration
 * @param target Warpgate target
 * @param useTicket Whether this profile uses ticket authentication
 * @returns Profile metadata object
 */
export function createSftpProfileMetadata(
  server: WarpgateServerConfig,
  target: WarpgateTarget,
  useTicket = false
): SftpProfileMetadata {
  return {
    serverId: server.id,
    serverName: server.name,
    targetName: target.name,
    groupName: target.group?.name,
    useTicket,
  };
}
