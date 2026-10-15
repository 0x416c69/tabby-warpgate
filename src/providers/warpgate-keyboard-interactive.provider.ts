/**
 * Warpgate Keyboard-Interactive Provider
 * Provides automatic OTP and password responses for Warpgate SSH connections
 */

import { Injectable, Inject } from '@angular/core';
import { WarpgateService } from '../services/warpgate.service';
import { WarpgateSSHProfile } from '../services/warpgate-profile.service';
import { parseWarpgateProfileId } from '../utils/profile-id';
import {
  isOtpPrompt as detectOtpPrompt,
  isPasswordPrompt as detectPasswordPrompt,
} from '../utils/prompt-detection';

/**
 * Keyboard-interactive prompt from SSH server
 */
export interface KeyboardInteractivePrompt {
  prompt: string;
  echo: boolean;
}

/**
 * Warpgate Keyboard-Interactive Handler
 * Computes automatic responses to OTP and password prompts during SSH authentication
 */
@Injectable({ providedIn: 'root' })
export class WarpgateKeyboardInteractiveHandler {
  constructor(@Inject(WarpgateService) private warpgateService: WarpgateService) {}

  /**
   * Check if a prompt is asking for OTP/2FA code
   */
  isOtpPrompt(prompt: string): boolean {
    return detectOtpPrompt(prompt);
  }

  /**
   * Check if a prompt is asking for password
   */
  isPasswordPrompt(prompt: string): boolean {
    return detectPasswordPrompt(prompt);
  }

  /**
   * Find the Warpgate server of a profile (metadata or profile ID)
   */
  private getServerId(profile: WarpgateSSHProfile): string | null {
    return profile.warpgate?.serverId ?? parseWarpgateProfileId(profile.id)?.serverId ?? null;
  }

  /**
   * Get automatic response for a keyboard-interactive prompt
   * Returns null if no automatic response is available
   */
  async getResponse(
    profile: WarpgateSSHProfile,
    prompt: KeyboardInteractivePrompt
  ): Promise<string | null> {
    const serverId = this.getServerId(profile);
    if (!serverId) {
      return null;
    }

    // OTP codes are time based and single use, always generate a fresh one
    if (this.isOtpPrompt(prompt.prompt)) {
      return this.warpgateService.generateOtpCode(serverId);
    }

    if (this.isPasswordPrompt(prompt.prompt)) {
      return this.warpgateService.getServer(serverId)?.password || profile.options?.password || null;
    }

    return null;
  }

  /**
   * Process all prompts and return responses
   * Returns array of responses matching the prompts array
   */
  async processPrompts(
    profile: WarpgateSSHProfile,
    prompts: KeyboardInteractivePrompt[]
  ): Promise<(string | null)[]> {
    const responses: (string | null)[] = [];

    for (const prompt of prompts) {
      responses.push(await this.getResponse(profile, prompt));
    }

    return responses;
  }

  /**
   * Check if we can fully auto-respond to all prompts
   * Returns true if all prompts have automatic responses
   */
  async canAutoRespond(
    profile: WarpgateSSHProfile,
    prompts: KeyboardInteractivePrompt[]
  ): Promise<boolean> {
    const responses = await this.processPrompts(profile, prompts);
    return responses.every(r => r !== null);
  }
}
