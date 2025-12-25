/**
 * Warpgate SSH Handler Provider
 * Automatically handles keyboard-interactive prompts for Warpgate SSH connections
 * Intercepts password and OTP prompts and auto-fills them from stored credentials
 */

import { Injectable, Inject } from '@angular/core';
import { AppService } from 'tabby-core';
import { WarpgateService } from '../services/warpgate.service';
import { WarpgateSSHProfile } from '../services/warpgate-profile.service';
import { Subscription } from 'rxjs';
import { createLogger } from '../utils/debug-logger';

const log = createLogger('SSHHandler');

/**
 * Warpgate SSH Handler
 * Monitors SSH tabs and auto-responds to keyboard-interactive prompts
 */
@Injectable({ providedIn: 'root' })
export class WarpgateSshHandler {
  private tabSubscriptions = new Map<string, Subscription[]>();
  private warpgateProfileIds = new Set<string>();
  private warpgateProfiles = new Map<string, WarpgateSSHProfile>();
  private handledPrompts = new WeakSet<any>(); // Track prompts we've already handled
  private lastOtpSubmitTime = new Map<string, number>(); // Track last OTP submit time per tab to prevent spam

  constructor(
    @Inject(AppService) private app: AppService,
    @Inject(WarpgateService) private warpgateService: WarpgateService
  ) {
    this.init();
  }

  /**
   * Register a Warpgate profile so we know to attach to tabs using this profile
   * Stores the full profile with metadata for later retrieval
   */
  public registerWarpgateProfile(profile: WarpgateSSHProfile): void {
    this.warpgateProfileIds.add(profile.id);
    this.warpgateProfiles.set(profile.id, profile);
    log.debug(` Registered profile ${profile.id} with metadata:`, {
      hasWarpgate: Boolean(profile.warpgate),
      targetName: profile.warpgate?.targetName,
      serverId: profile.warpgate?.serverId,
      hasOtp: Boolean(profile.warpgate?.otpCode),
    });
  }

  private init(): void {
    log.debug(' Initializing...');
    log.debug(` Current tabs count: ${this.app.tabs?.length || 0}`);

    // Watch for new tabs
    this.app.tabOpened$.subscribe(tab => {
      log.debug(` tabOpened$ fired for: ${tab?.constructor?.name}`);
      this.attachToTab(tab);
    });

    // Attach to existing tabs
    for (const tab of this.app.tabs) {
      this.attachToTab(tab);
    }

    log.debug(' Initialized');
  }

  public attachToTab(tab: any): void {
    if (!tab) return;

    const tabClassName = tab?.constructor?.name || '';
    const tabProfile = tab?.profile;

    // Check if this is a container tab (like SplitTabComponent) that might have SSH children
    const isContainerTab = tabClassName === 'SplitTabComponent' || tabClassName.includes('Container');

    if (isContainerTab) {
      // For container tabs, look for SSH tab children
      log.debug(' Container tab detected, looking for SSH children');

      // Try to find SSH tabs in children
      const children = tab?.getAllTabs?.() || [];
      for (const child of children) {
        this.attachToTab(child);
      }
      return;
    }

    // Basic SSH tab detection
    const isSSHTab = tabClassName === 'SSHTabComponent' ||
                     tabClassName.includes('SSH') ||
                     tabProfile?.type === 'ssh' ||
                     tab?.type === 'ssh';

    // Strong Warpgate detection: check if this profile ID was registered by us
    const isWarpgateProfileId = Boolean(tabProfile?.id && this.warpgateProfileIds.has(tabProfile.id));
    const hasWarpgateMetadata = Boolean(tabProfile?.warpgate);

    const isWarpgateTab = isSSHTab && (isWarpgateProfileId || hasWarpgateMetadata);

    // Safer logging: show only useful fields
    log.debug(' Checking tab:', {
      class: tabClassName,
      isSSHTab,
      profileId: tabProfile?.id,
      isWarpgateProfileId,
      hasWarpgateMetadata,
      isWarpgateTab,
      targetName: tabProfile?.warpgate?.targetName,
    });

    if (!isWarpgateTab) {
      return;
    }

    // Get the stored profile with full metadata (tab's profile may have lost custom fields)
    const storedProfile = this.warpgateProfiles.get(tabProfile.id);
    const profile = storedProfile || (tabProfile as WarpgateSSHProfile);

    log.debug(` Attaching to SSH tab for ${profile.warpgate?.targetName}`, {
      usingStoredProfile: Boolean(storedProfile),
      hasMetadata: Boolean(profile.warpgate),
    });

    const subscriptions: Subscription[] = [];

    // Watch the activeKIPrompt property using a getter/setter intercept
    // This is similar to how WebAuthHandler works
    let currentPrompt = tab.activeKIPrompt;

    // Define a property descriptor to intercept changes to activeKIPrompt
    const originalDescriptor = Object.getOwnPropertyDescriptor(tab, 'activeKIPrompt')
      || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(tab), 'activeKIPrompt');

    if (originalDescriptor) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      let internalValue = tab.activeKIPrompt;

      Object.defineProperty(tab, 'activeKIPrompt', {
        get() {
          return internalValue;
        },
        set(value: any) {
          internalValue = value;
          log.debug(' activeKIPrompt changed:', value);

          // Call original setter FIRST if it exists
          // This ensures Tabby's internal state is updated before we respond
          if (originalDescriptor.set) {
            originalDescriptor.set.call(this, value);
          }

          if (value) {
            // Handle the prompt - let Tabby's built-in handler take care of password prompts
            // We only need to handle OTP prompts
            self.handleKIPrompt(tab, profile, value);
          }
        },
        configurable: true,
        enumerable: true,
      });

      log.debug(` Installed activeKIPrompt interceptor for ${profile.warpgate?.targetName}`);
    } else {
      log.debug(' Could not find activeKIPrompt descriptor, falling back to polling');

      // Fallback: poll for changes to activeKIPrompt
      const pollInterval = setInterval(() => {
        const newPrompt = tab.activeKIPrompt;
        if (newPrompt && newPrompt !== currentPrompt) {
          currentPrompt = newPrompt;
          log.debug(' activeKIPrompt detected via polling:', newPrompt);
          this.handleKIPrompt(tab, profile, newPrompt);
        }
      }, 100);

      // Stop polling after 60 seconds
      setTimeout(() => clearInterval(pollInterval), 60000);
      subscriptions.push({ unsubscribe: () => clearInterval(pollInterval) } as any);
    }

    // Store subscriptions for cleanup
    this.tabSubscriptions.set(tab.id, subscriptions);

    // Clean up when tab closes
    if (tab.destroyed$) {
      tab.destroyed$.subscribe(() => {
        this.detachFromTab(tab);
      });
    }
  }

  private detachFromTab(tab: any): void {
    const subs = this.tabSubscriptions.get(tab.id);
    if (subs) {
      subs.forEach(s => s.unsubscribe());
      this.tabSubscriptions.delete(tab.id);
    }

    // Clean up spam protection tracking
    if (tab?.id) {
      this.lastOtpSubmitTime.delete(tab.id);
    }
  }

  private async handleKIPrompt(
    tab: any,
    profile: WarpgateSSHProfile,
    prompt: any
  ): Promise<void> {
    log.debug(` handleKIPrompt called, prompt object ID: ${prompt?.__promptId || 'unknown'}`);

    // Check if we've already handled this exact prompt object
    if (this.handledPrompts.has(prompt)) {
      log.debug(' Skipping already-handled prompt (WeakSet check)');
      return;
    }

    // CRITICAL: Prevent OTP spam by checking if we submitted OTP recently for this tab
    // If we submitted OTP less than 2 seconds ago, ignore this prompt (it's probably a loop/retry)
    const tabId = tab?.id || 'unknown';
    const now = Date.now();
    const lastSubmit = this.lastOtpSubmitTime.get(tabId) || 0;
    const timeSinceLastSubmit = now - lastSubmit;

    if (timeSinceLastSubmit < 2000) {
      log.debug(` SPAM PROTECTION: Ignoring prompt, last OTP submit was ${timeSinceLastSubmit}ms ago`);
      return;
    }

    // Mark this prompt as handled
    this.handledPrompts.add(prompt);
    log.debug(' Marked prompt as handled in WeakSet');

    // The KI prompt structure can vary - it may have:
    // - prompt.name: The name/title of the prompt (e.g., "Two-factor authentication")
    // - prompt.prompt: The actual prompt text
    // - prompt.prompts: Array of prompts (each with .prompt text)
    // - prompt.instruction: Instructions text

    // Get all possible text from the prompt
    const promptName = prompt?.name || '';
    const promptText = prompt?.prompt || '';
    const instruction = prompt?.instruction || '';

    // If there are multiple prompts, get the first one
    let firstPromptText = '';
    if (prompt?.prompts && Array.isArray(prompt.prompts) && prompt.prompts.length > 0) {
      firstPromptText = prompt.prompts[0]?.prompt || '';
    }

    // Combine all text for matching
    const allText = `${promptName} ${promptText} ${instruction} ${firstPromptText}`.toLowerCase();

    log.debug(' KI Prompt received:', {
      name: promptName,
      prompt: promptText,
      instruction: instruction,
      firstPrompt: firstPromptText,
      combinedText: allText,
    });

    // IMPORTANT: Check OTP prompts FIRST before password prompts
    // because OTP prompts often contain the word "password" (e.g., "One-time password")
    // which would incorrectly match the password pattern

    // Handle OTP prompts (includes "Two-factor authentication")
    if (this.isOtpPrompt(allText)) {
      const otpCode = await this.getOtpCode(profile);
      if (otpCode) {
        log.debug(' Auto-filling OTP code');

        // Record the time we submitted OTP for spam protection
        const tabId = tab?.id || 'unknown';
        this.lastOtpSubmitTime.set(tabId, Date.now());

        this.submitKIResponse(tab, profile, prompt, otpCode);
        return;
      } else {
        log.debug(' OTP prompt detected but no OTP code available');
      }
    }

    // Handle password prompts (only if not an OTP prompt)
    if (this.isPasswordPrompt(allText)) {
      const password = profile.warpgate?.password;
      if (password) {
        log.debug(' Auto-filling password');
        log.debug(` Password length: ${password.length}`);

        // Record the time we submitted password (for spam protection on password too)
        const tabId = tab?.id || 'unknown';
        this.lastOtpSubmitTime.set(tabId, Date.now());

        this.submitKIResponse(tab, profile, prompt, password);
        return;
      } else {
        log.debug(' Password prompt detected but no password available');
      }
    }

    log.debug(' No auto-response for prompt, user must enter manually');
    log.debug(` Prompt text was: ${allText.substring(0, 100)}...`);
  }

  private isPasswordPrompt(prompt: string): boolean {
    return /password/i.test(prompt);
  }

  private isOtpPrompt(prompt: string): boolean {
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
      /factor\s*authentication/i,  // Matches "Two-factor authentication"
    ];
    return otpPatterns.some(pattern => pattern.test(prompt));
  }

  private async getOtpCode(profile: WarpgateSSHProfile): Promise<string | null> {
    // IMPORTANT: Always generate a FRESH OTP code for SSH keyboard-interactive auth
    // Do NOT use the cached otpCode from profile as it may be expired or already used
    // TOTP codes are time-based and can only be used once

    const timestamp = new Date().toISOString();
    log.debug(` getOtpCode called at ${timestamp} for ${profile.warpgate?.targetName}`);
    log.debug(` Checking profile.warpgate?.otpCode: ${profile.warpgate?.otpCode ? 'EXISTS (should be undefined!)' : 'undefined (good)'}`);

    // Generate a fresh OTP code
    if (profile.warpgate?.serverId) {
      log.debug(` Calling warpgateService.generateOtpCode for server ${profile.warpgate.serverId}`);
      const freshCode = await this.warpgateService.generateOtpCode(profile.warpgate.serverId);
      if (freshCode) {
        log.debug(` Generated fresh OTP code: ${freshCode} at ${timestamp}`);
        log.debug(` Code length: ${freshCode.length}, type: ${typeof freshCode}`);
        return freshCode;
      }
    }

    log.debug(' Failed to generate OTP code - no serverId available');
    return null;
  }

  private submitKIResponse(tab: any, profile: WarpgateSSHProfile, prompt: any, response: string): void {
    log.debug(` Submitting KI response for ${profile.warpgate?.targetName}`);
    log.debug(` Response value (first 6 chars): ${response.substring(0, 6)}...`);
    log.debug(` Response length: ${response.length}`);

    // Based on Tabby source code research (tabby-ssh/src/session/ssh.ts):
    // KeyboardInteractivePrompt.respond() takes NO arguments
    // Instead, we populate the responses array, then call respond()
    if (prompt?.respond) {
      log.debug(' Using prompt.respond()');
      log.debug(` prompt.name: ${prompt.name}`);
      log.debug(` prompt.instruction: ${prompt.instruction}`);
      log.debug(' prompt.prompts:', prompt.prompts);
      log.debug(` prompt.prompts length: ${prompt.prompts?.length || 0}`);
      log.debug(` prompt.responses type: ${Array.isArray(prompt.responses) ? 'array' : typeof prompt.responses}`);
      log.debug(` prompt.responses length before: ${prompt.responses?.length || 0}`);
      log.debug(' prompt.responses current values:', prompt.responses);

      // IMPORTANT: Based on Tabby's KeyboardInteractivePrompt implementation:
      // 1. The responses array is pre-initialized with empty strings (one per prompt)
      // 2. We need to populate the correct index
      // 3. Then call respond() with NO arguments
      if (prompt.responses && Array.isArray(prompt.responses)) {
        // Find the first empty response slot, or default to index 0
        let responseIndex = 0;
        for (let i = 0; i < prompt.responses.length; i++) {
          if (prompt.responses[i] === '' || prompt.responses[i] === undefined) {
            responseIndex = i;
            break;
          }
        }

        prompt.responses[responseIndex] = response;
        log.debug(` Set prompt.responses[${responseIndex}] = "${response}"`);
        log.debug(' prompt.responses after update:', JSON.stringify(prompt.responses));
        log.debug(' prompt.responses[0] value:', prompt.responses[0]);
        log.debug(' prompt.responses[0] type:', typeof prompt.responses[0]);
        log.debug(' prompt.responses[0] length:', prompt.responses[0]?.length);
      } else {
        log.warn('prompt.responses is not an array, attempting to create it');
        prompt.responses = [response];
      }

      log.debug(' Calling prompt.respond() with NO arguments');

      try {
        prompt.respond();
        log.debug(' prompt.respond() called successfully');
      } catch (error) {
        log.error(' Error calling prompt.respond():', error);
      }
      return;
    }

    // The session may have the active prompt with respond
    if (tab.session?.activeKIPrompt?.respond) {
      log.debug(' Using tab.session.activeKIPrompt.respond()');
      if (tab.session.activeKIPrompt.responses && Array.isArray(tab.session.activeKIPrompt.responses)) {
        tab.session.activeKIPrompt.responses[0] = response;
        log.debug(' Set tab.session.activeKIPrompt.responses[0]');
      } else {
        tab.session.activeKIPrompt.responses = [response];
      }
      tab.session.activeKIPrompt.respond();
      return;
    }

    // Try respondToKI method on session
    if (tab.session?.respondToKI) {
      log.debug(' Using tab.session.respondToKI()');
      // respondToKI may still expect an array argument - this is a different method
      tab.session.respondToKI([response]);
      return;
    }

    // Fallback: write directly to terminal (less reliable)
    if (tab.session?.write) {
      log.debug(' Fallback: writing to terminal');
      tab.session.write(response + '\r');
      return;
    }

    log.warn('Could not find method to submit KI response');
  }
}
