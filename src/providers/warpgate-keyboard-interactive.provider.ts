/**
 * Warpgate Keyboard-Interactive Provider
 * Provides automatic OTP responses for Warpgate SSH connections
 */

import { Injectable, Inject } from '@angular/core';
import { WarpgateService } from '../services/warpgate.service';
import { WarpgateSSHProfile } from '../services/warpgate-profile.service';

/**
 * Keyboard-interactive prompt from SSH server
 */
export interface KeyboardInteractivePrompt {
  prompt: string;
  echo: boolean;
}

/**
 * Warpgate Keyboard-Interactive Handler
 * Automatically responds to OTP prompts during SSH authentication
 */
@Injectable({ providedIn: 'root' })
export class WarpgateKeyboardInteractiveHandler {
  constructor(@Inject(WarpgateService) private warpgateService: WarpgateService) {}

  /**
   * Check if a prompt is asking for OTP/2FA code
   */
  isOtpPrompt(prompt: string): boolean {
    const otpPatterns = [
      /one-?time/i,
      /otp/i,
      /2fa/i,
      /two-?factor/i,
      /verification\s*code/i,
      /authenticator/i,
      /totp/i,
      /token/i,
      /security\s*code/i,
    ];

    return otpPatterns.some(pattern => pattern.test(prompt));
  }

  /**
   * Check if a prompt is asking for password
   */
  isPasswordPrompt(prompt: string): boolean {
    return /password/i.test(prompt);
  }

  /**
   * Get automatic response for a keyboard-interactive prompt
   * Returns null if no automatic response is available
   */
  async getResponse(
    profile: WarpgateSSHProfile,
    prompt: KeyboardInteractivePrompt
  ): Promise<string | null> {
    // Check if this is a Warpgate profile with OTP configured
    if (!profile.warpgate) {
      return null;
    }

    const { serverId, otpCode } = profile.warpgate;

    // Handle OTP prompts
    if (this.isOtpPrompt(prompt.prompt)) {
      // If we have a pre-generated OTP code, use it
      if (otpCode) {
        return otpCode;
      }

      // Try to generate a fresh OTP code
      const freshCode = await this.warpgateService.generateOtpCode(serverId);
      if (freshCode) {
        return freshCode;
      }
    }

    // Handle password prompts - use stored password from profile
    if (this.isPasswordPrompt(prompt.prompt) && profile.options.password) {
      return profile.options.password;
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
      const response = await this.getResponse(profile, prompt);
      responses.push(response);
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
