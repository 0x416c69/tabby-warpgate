/**
 * Warpgate SSH Handler Provider
 * Prepares Warpgate SSH tabs before every connection attempt (fresh one-time ticket,
 * host settings) and answers keyboard-interactive password and OTP prompts
 */

import { Injectable, Inject } from '@angular/core';
import { AppService } from 'tabby-core';
import { WarpgateService } from '../services/warpgate.service';
import { WarpgateHostSettingsService } from '../services/host-settings.service';
import { WarpgateHistoryService } from '../services/history.service';
import { WarpgateSSHProfile } from '../services/warpgate-profile.service';
import { WarpgateProfileKind, parseWarpgateProfileId } from '../utils/profile-id';
import { isOtpPrompt, isPasswordPrompt } from '../utils/prompt-detection';
import { createLogger } from '../utils/debug-logger';

const log = createLogger('SSHHandler');

/** Do not send the stored password again if it was sent within this time */
const PASSWORD_RETRY_GUARD_MS = 5000;

/** Polling interval when the prompt property cannot be intercepted */
const PROMPT_POLL_INTERVAL_MS = 250;

/** State kept for every Warpgate SSH tab */
interface WarpgateTabState {
  serverId: string;
  targetName: string;
  kind?: WarpgateProfileKind;
  /** Number of connection attempts made by the tab */
  attempts: number;
  /** Scripts to send once after the next connection */
  pendingScripts: string[];
  /** OTP code auto-filled during the current connection attempt */
  lastOtpCode?: string;
  /** When the stored password was auto-filled during the current attempt */
  lastPasswordAt?: number;
}

/** Warpgate server and target of a tab */
export interface WarpgateTabTarget {
  serverId: string;
  targetName: string;
}

/**
 * Warpgate SSH Handler
 * Monitors SSH tabs and auto-responds to keyboard-interactive prompts
 */
@Injectable({ providedIn: 'root' })
export class WarpgateSshHandler {
  /** Per-tab state, released together with the tab */
  private tabStates = new WeakMap<object, WarpgateTabState>();

  /** Split containers that are already watched for new panes */
  private observedContainers = new WeakSet<object>();

  /** Prompts that were already processed */
  private handledPrompts = new WeakSet<object>();

  /** Profiles created by this plugin, by profile ID */
  private registeredProfiles = new Map<string, WarpgateTabTarget>();

  constructor(
    @Inject(AppService) private app: AppService,
    @Inject(WarpgateService) private warpgateService: WarpgateService,
    @Inject(WarpgateHostSettingsService) private hostSettings: WarpgateHostSettingsService,
    @Inject(WarpgateHistoryService) private history: WarpgateHistoryService
  ) {
    this.init();
  }

  /**
   * Register a Warpgate profile so its server and target are known exactly
   * (the profile ID alone is enough in most cases)
   */
  public registerWarpgateProfile(profile: WarpgateSSHProfile): void {
    if (profile.id && profile.warpgate) {
      this.registeredProfiles.set(profile.id, {
        serverId: profile.warpgate.serverId,
        targetName: profile.warpgate.targetName,
      });
    }
  }

  private init(): void {
    // Watch for new tabs
    this.app.tabOpened$.subscribe(tab => {
      this.attachToTab(tab);
    });

    // Attach to existing tabs
    for (const tab of this.app.tabs ?? []) {
      this.attachToTab(tab);
    }
  }

  /**
   * Find the Warpgate server and target of a profile
   */
  resolveTarget(profile: any): (WarpgateTabTarget & { kind?: WarpgateProfileKind }) | null {
    if (!profile) {
      return null;
    }

    const parsed = parseWarpgateProfileId(profile.id);
    const registered = profile.id ? this.registeredProfiles.get(profile.id) : undefined;
    // Raw profile objects carry metadata, Tabby's profile proxies only keep the ID
    const metadata = profile.warpgate?.serverId && profile.warpgate?.targetName
      ? { serverId: profile.warpgate.serverId, targetName: profile.warpgate.targetName }
      : null;

    const target = metadata ?? registered ?? parsed;
    if (!target) {
      return null;
    }
    return { serverId: target.serverId, targetName: target.targetName, kind: parsed?.kind };
  }

  /**
   * Start handling a tab if it is a Warpgate SSH tab
   * Split containers are searched for SSH panes, including panes added later
   */
  public attachToTab(tab: any): void {
    if (!tab) {
      return;
    }

    if (typeof tab.getAllTabs === 'function') {
      for (const child of tab.getAllTabs()) {
        this.attachToTab(child);
      }
      if (!this.observedContainers.has(tab) && typeof tab.tabAdded$?.subscribe === 'function') {
        this.observedContainers.add(tab);
        tab.tabAdded$.subscribe((child: any) => this.attachToTab(child));
      }
      return;
    }

    if (this.tabStates.has(tab) || tab.profile?.type !== 'ssh') {
      return;
    }

    const target = this.resolveTarget(tab.profile);
    if (!target) {
      return;
    }

    const state: WarpgateTabState = {
      serverId: target.serverId,
      targetName: target.targetName,
      kind: target.kind,
      attempts: 0,
      pendingScripts: [],
    };
    this.tabStates.set(tab, state);

    log.debug(`Attached to SSH tab for ${target.targetName}`);
    this.installSessionPreparation(tab, state);
    this.installPromptInterceptor(tab, state);
  }

  /**
   * Check whether a tab is handled as a Warpgate tab
   */
  public isWarpgateTab(tab: any): boolean {
    return !!tab && this.tabStates.has(tab);
  }

  /**
   * Get the server and target of a Warpgate tab
   */
  public getTabTarget(tab: any): WarpgateTabTarget | null {
    const state = tab ? this.tabStates.get(tab) : undefined;
    return state ? { serverId: state.serverId, targetName: state.targetName } : null;
  }

  /**
   * Get all open Warpgate SSH tabs (panes inside split tabs included)
   */
  public getOpenWarpgateTabs(): any[] {
    const result: any[] = [];
    const visit = (tab: any) => {
      if (!tab) {
        return;
      }
      if (typeof tab.getAllTabs === 'function') {
        tab.getAllTabs().forEach(visit);
      } else if (this.tabStates.has(tab)) {
        result.push(tab);
      }
    };
    (this.app.tabs ?? []).forEach(visit);
    return result;
  }

  /**
   * Send scripts to the shell once the tab's next connection is established
   */
  public queueScripts(tab: any, scripts: string[]): void {
    this.attachToTab(tab);
    const state = this.tabStates.get(tab);
    if (state) {
      state.pendingScripts.push(...scripts.filter(script => script.trim()));
    }
  }

  /**
   * Wrap the tab's session initialization so every connection attempt
   * (first connect, reconnect, duplicated and restored tabs) starts with usable credentials
   */
  private installSessionPreparation(tab: any, state: WarpgateTabState): void {
    const original = tab.initializeSession;
    if (typeof original !== 'function') {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    tab.initializeSession = async function (this: any, ...args: unknown[]) {
      try {
        await self.prepareConnection(tab, state);
      } catch (error) {
        log.error('Failed to prepare Warpgate connection:', error);
      }
      return original.apply(this, args);
    };
  }

  /**
   * Update the tab's profile before a connection attempt
   */
  async prepareConnection(tab: any, state: WarpgateTabState): Promise<void> {
    const options = tab.profile?.options;
    if (!options) {
      return;
    }

    state.attempts++;
    state.lastOtpCode = undefined;
    state.lastPasswordAt = undefined;

    const server = this.warpgateService.getServer(state.serverId);
    if (!server) {
      log.debug(`Server ${state.serverId} no longer exists, leaving profile unchanged`);
      return;
    }

    // One-time tickets can only be used once: get new credentials unless this
    // tab holds a ticket that was created for it and has not been used yet
    const user = String(options.user ?? '');
    const hasFreshTicket = this.warpgateService.claimUnusedTicket(user);
    const isFreshPasswordProfile = state.attempts === 1 && state.kind === 'autoauth';

    if (!hasFreshTicket && !isFreshPasswordProfile) {
      const credentials = await this.warpgateService.getConnectionCredentials(state.serverId, state.targetName);
      if (credentials) {
        options.host = credentials.host;
        options.port = credentials.port;
        options.user = credentials.username;
        options.auth = credentials.auth;
        options.password = credentials.password;
        log.debug(`Using ${credentials.useTicket ? 'a fresh ticket' : 'password authentication'} for ${state.targetName}`);
      }
    }

    // Agent forwarding, X11, keepalive, port forwards and startup snippet
    this.hostSettings.applyToProfileOptions(options, server, state.targetName);
    if (state.pendingScripts.length > 0) {
      const extra = state.pendingScripts.map(send => ({ expect: '', send }));
      options.scripts = [...(options.scripts ?? []), ...extra];
      state.pendingScripts = [];
    }

    if (state.attempts === 1) {
      this.history.recordConnection(state.serverId, state.targetName);
    }
  }

  /**
   * Watch the tab's activeKIPrompt property to answer prompts as soon as they appear
   */
  private installPromptInterceptor(tab: any, state: WarpgateTabState): void {
    const descriptor = Object.getOwnPropertyDescriptor(tab, 'activeKIPrompt')
      || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(tab), 'activeKIPrompt');

    if (descriptor && descriptor.configurable === false) {
      this.pollPrompts(tab, state);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    let value = descriptor && 'value' in descriptor ? descriptor.value : tab.activeKIPrompt;

    try {
      Object.defineProperty(tab, 'activeKIPrompt', {
        get() {
          return descriptor?.get ? descriptor.get.call(this) : value;
        },
        set(prompt: any) {
          if (descriptor?.set) {
            descriptor.set.call(this, prompt);
          } else {
            value = prompt;
          }
          if (prompt) {
            self.handleKIPrompt(state, prompt, tab);
          }
        },
        configurable: true,
        enumerable: true,
      });
    } catch (error) {
      log.debug('Could not intercept activeKIPrompt, falling back to polling', error);
      this.pollPrompts(tab, state);
    }
  }

  /**
   * Fallback: poll the tab for new prompts until it is closed
   */
  private pollPrompts(tab: any, state: WarpgateTabState): void {
    let current: any = null;
    const timer = setInterval(() => {
      const prompt = tab.activeKIPrompt;
      if (prompt && prompt !== current) {
        current = prompt;
        this.handleKIPrompt(state, prompt, tab);
      }
    }, PROMPT_POLL_INTERVAL_MS);

    if (tab.destroyed$?.subscribe) {
      tab.destroyed$.subscribe(() => clearInterval(timer));
    }
  }

  /**
   * Answer a keyboard-interactive request
   * Every prompt of the request is answered on its own; the request is only submitted
   * automatically when all prompts could be answered
   */
  async handleKIPrompt(state: WarpgateTabState, prompt: any, tab?: any): Promise<void> {
    if (!prompt || this.handledPrompts.has(prompt)) {
      return;
    }
    this.handledPrompts.add(prompt);

    const prompts: Array<{ prompt?: string }> = Array.isArray(prompt.prompts) ? prompt.prompts : [];
    if (prompts.length === 0 || typeof prompt.respond !== 'function') {
      return;
    }

    if (!Array.isArray(prompt.responses)) {
      prompt.responses = prompts.map(() => '');
    }

    // A single prompt is often described by the request name ("Two-factor authentication")
    const context = `${prompt.name ?? ''} ${prompt.instruction ?? ''}`;

    let answered = 0;
    for (let i = 0; i < prompts.length; i++) {
      const text = prompts[i]?.prompt ?? '';
      const response = await this.getAutoResponse(state, prompts.length === 1 ? `${context} ${text}` : text);
      if (response !== null) {
        prompt.responses[i] = response;
        answered++;
      }
    }

    if (answered === prompts.length) {
      log.debug(`Answering keyboard-interactive request for ${state.targetName}`);
      try {
        prompt.respond();
      } catch (error) {
        log.error('Error answering keyboard-interactive prompt:', error);
        return;
      }
      // Close the prompt panel like Tabby does after a manual answer
      if (tab && tab.activeKIPrompt === prompt) {
        tab.activeKIPrompt = null;
        tab.frontend?.focus?.();
      }
    } else {
      log.debug('Keyboard-interactive request needs manual input');
    }
  }

  /**
   * Get the automatic answer for a prompt, or null if the user has to answer it
   */
  private async getAutoResponse(state: WarpgateTabState, text: string): Promise<string | null> {
    if (isOtpPrompt(text)) {
      const code = await this.warpgateService.generateOtpCode(state.serverId);
      // The same code was already rejected in this attempt, sending it again cannot work
      if (!code || code === state.lastOtpCode) {
        return null;
      }
      state.lastOtpCode = code;
      return code;
    }

    if (isPasswordPrompt(text)) {
      const password = this.warpgateService.getServer(state.serverId)?.password;
      const now = Date.now();
      if (!password || (state.lastPasswordAt && now - state.lastPasswordAt < PASSWORD_RETRY_GUARD_MS)) {
        return null;
      }
      state.lastPasswordAt = now;
      return password;
    }

    return null;
  }
}
