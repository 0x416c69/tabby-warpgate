/**
 * Warpgate OS Detection Service
 * Finds out which operating system a host runs, using the SSH connection of an open tab
 */

import { Injectable, Inject } from '@angular/core';

import { WarpgateService } from './warpgate.service';
import { WarpgateHostSettingsService } from './host-settings.service';
import { WarpgateHostOs, getHostKey } from '../models/warpgate.models';
import {
  OS_DETECTION_COMMAND,
  WINDOWS_DETECTION_COMMAND,
  canRunRemoteCommands,
  parseOsDetectionOutput,
  runRemoteCommand,
} from '../utils/os-detection';
import { createLogger } from '../utils/debug-logger';

const log = createLogger('OsDetection');

/** Detect again after this time, in case a host was upgraded or reinstalled */
export const OS_REDETECT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Give up on a detection command after this time */
const COMMAND_TIMEOUT_MS = 10000;

/**
 * OS Detection Service
 */
@Injectable({ providedIn: 'root' })
export class WarpgateOsDetectionService {
  /** Hosts with a detection in progress */
  private inProgress = new Set<string>();

  constructor(
    @Inject(WarpgateService) private warpgate: WarpgateService,
    @Inject(WarpgateHostSettingsService) private hostSettings: WarpgateHostSettingsService
  ) {}

  /**
   * Whether OS detection is enabled in the settings
   */
  isEnabled(): boolean {
    return this.warpgate.getConfig().detectOs !== false;
  }

  /**
   * Whether the OS of a host should be detected now
   */
  needsDetection(serverId: string, targetName: string, now = Date.now()): boolean {
    if (!this.isEnabled() || this.inProgress.has(getHostKey(serverId, targetName))) {
      return false;
    }
    const known = this.hostSettings.getDetectedOs(serverId, targetName);
    return !known || now - known.detectedAt > OS_REDETECT_INTERVAL_MS;
  }

  /**
   * Detect the OS of a host over the connection of an open SSH session
   * Runs read-only commands on a separate channel, nothing is typed into the shell
   * @param sshSession Tabby's SSH session of a connected tab
   * @returns the detected OS, or null when it was not needed or not possible
   */
  async detectOverSession(serverId: string, targetName: string, sshSession: any): Promise<WarpgateHostOs | null> {
    const client = sshSession?.ssh;
    if (!this.needsDetection(serverId, targetName) || !canRunRemoteCommands(client)) {
      return null;
    }

    const key = getHostKey(serverId, targetName);
    this.inProgress.add(key);
    try {
      let parsed = parseOsDetectionOutput(await runRemoteCommand(client, OS_DETECTION_COMMAND, COMMAND_TIMEOUT_MS));
      if (!parsed) {
        parsed = parseOsDetectionOutput(await runRemoteCommand(client, WINDOWS_DETECTION_COMMAND, COMMAND_TIMEOUT_MS));
      }
      if (!parsed) {
        log.debug(`Could not identify the operating system of ${targetName}`);
        return null;
      }

      const os: WarpgateHostOs = { ...parsed, detectedAt: Date.now() };
      this.hostSettings.setDetectedOs(serverId, targetName, os);
      log.debug(`${targetName} runs ${os.name}`);
      return os;
    } catch (error) {
      log.debug(`OS detection failed for ${targetName}:`, error);
      return null;
    } finally {
      this.inProgress.delete(key);
    }
  }
}
