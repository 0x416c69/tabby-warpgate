/**
 * Warpgate Snippets Service
 * Saved command snippets that can be run in terminal tabs
 */

import { Injectable, Inject, Optional } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { AppService, NotificationsService, SelectorService } from 'tabby-core';

import { WarpgateService } from './warpgate.service';
import { WarpgateHostSettingsService, parseTags } from './host-settings.service';
import { WarpgateSnippet } from '../models/warpgate.models';
import { createLogger } from '../utils/debug-logger';

const log = createLogger('Snippets');

/** Snippet fields that can be edited */
export type WarpgateSnippetDraft = Omit<WarpgateSnippet, 'id'> & { id?: string };

/**
 * Convert a snippet script into terminal input that runs every line
 */
export function snippetToTerminalInput(script: string): string {
  const lines = script.replace(/\r\n/g, '\n').trimEnd().split('\n');
  return lines.join('\r') + '\r';
}

/**
 * First non-empty line of a script, used as a preview
 */
export function snippetPreview(script: string): string {
  return script.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? '';
}

/**
 * Snippets Service
 */
@Injectable({ providedIn: 'root' })
export class WarpgateSnippetsService {
  private changesSubject = new Subject<void>();

  /** Emits whenever snippets change */
  readonly changes$: Observable<void> = this.changesSubject.asObservable();

  constructor(
    @Inject(WarpgateService) private warpgate: WarpgateService,
    @Inject(WarpgateHostSettingsService) private hostSettings: WarpgateHostSettingsService,
    @Inject(AppService) private app: AppService,
    @Optional() @Inject(SelectorService) private selector: SelectorService | null,
    @Optional() @Inject(NotificationsService) private notifications: NotificationsService | null
  ) {}

  /**
   * Get all snippets sorted by name
   */
  getSnippets(): WarpgateSnippet[] {
    const snippets = this.warpgate.getConfig().snippets;
    if (!Array.isArray(snippets)) {
      return [];
    }
    return snippets
      .filter(snippet => snippet && typeof snippet.id === 'string')
      .map(snippet => ({ ...snippet, tags: [...(snippet.tags ?? [])] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get a snippet by ID
   */
  getSnippet(id: string): WarpgateSnippet | undefined {
    return this.getSnippets().find(snippet => snippet.id === id);
  }

  /**
   * Create or update a snippet
   */
  saveSnippet(draft: WarpgateSnippetDraft): WarpgateSnippet {
    const name = draft.name?.trim();
    const script = draft.script?.replace(/\r\n/g, '\n').trimEnd();
    if (!name) {
      throw new Error('Snippet name is required');
    }
    if (!script) {
      throw new Error('Snippet script is required');
    }

    const snippet: WarpgateSnippet = {
      id: draft.id || `snip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      script,
      description: draft.description?.trim() || undefined,
      tags: parseTags(draft.tags),
    };

    const snippets = (this.warpgate.getConfig().snippets ?? []).filter(s => s.id !== snippet.id);
    this.warpgate.saveConfig({ snippets: [...snippets, snippet] });
    this.changesSubject.next();
    return snippet;
  }

  /**
   * Delete a snippet (and stop using it as a startup snippet)
   */
  deleteSnippet(id: string): void {
    const snippets = this.warpgate.getConfig().snippets ?? [];
    this.warpgate.saveConfig({ snippets: snippets.filter(snippet => snippet.id !== id) });
    this.hostSettings.removeSnippetReferences(id);
    this.changesSubject.next();
  }

  /**
   * Find the terminal tab inside a tab (split tabs contain terminal panes)
   */
  resolveTerminalTab(tab: any): any | null {
    if (!tab) {
      return null;
    }
    if (typeof tab.getAllTabs === 'function') {
      const focused = typeof tab.getFocusedTab === 'function' ? tab.getFocusedTab() : null;
      return this.resolveTerminalTab(focused ?? tab.getAllTabs()[0]);
    }
    return typeof tab.sendInput === 'function' ? tab : null;
  }

  /**
   * The terminal pane the user is currently working in
   */
  getActiveTerminalTab(): any | null {
    return this.resolveTerminalTab(this.app.activeTab);
  }

  /**
   * Send a snippet to a terminal tab
   * @returns true when the snippet was sent
   */
  runInTab(tab: any, snippet: WarpgateSnippet): boolean {
    const terminal = this.resolveTerminalTab(tab);
    if (!terminal) {
      return false;
    }
    terminal.sendInput(snippetToTerminalInput(snippet.script));
    log.debug(`Sent snippet "${snippet.name}"`);
    return true;
  }

  /**
   * Send a snippet to several terminal tabs
   * @returns number of tabs the snippet was sent to
   */
  runInTabs(tabs: any[], snippet: WarpgateSnippet): number {
    return tabs.filter(tab => this.runInTab(tab, snippet)).length;
  }

  /**
   * Run a snippet in the active terminal
   */
  runInActiveTab(snippet: WarpgateSnippet): boolean {
    const terminal = this.getActiveTerminalTab();
    if (!terminal) {
      this.notifications?.notice('Open a terminal tab to run the snippet in');
      return false;
    }
    this.runInTab(terminal, snippet);
    return true;
  }

  /**
   * Let the user pick a snippet and run it in the active terminal
   */
  async showRunSnippetPicker(): Promise<void> {
    const snippets = this.getSnippets();
    if (snippets.length === 0) {
      this.notifications?.notice('No snippets yet. Create one in Warpgate Hosts → Snippets.');
      return;
    }

    const terminal = this.getActiveTerminalTab();
    if (!terminal) {
      this.notifications?.notice('Open a terminal tab to run a snippet in');
      return;
    }

    if (!this.selector) {
      return;
    }

    try {
      await this.selector.show('Run snippet', snippets.map(snippet => ({
        name: snippet.name,
        description: snippet.description || snippetPreview(snippet.script),
        icon: 'fas fa-code',
        group: snippet.tags?.length ? snippet.tags.join(', ') : undefined,
        callback: () => {
          this.runInTab(terminal, snippet);
        },
      })));
    } catch {
      // Selector was dismissed
    }
  }
}
