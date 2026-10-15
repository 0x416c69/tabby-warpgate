/**
 * Warpgate Snippets Component
 * Snippet library: create, edit and run saved commands
 */

import { Component, ElementRef, EventEmitter, HostListener, Inject, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppService, NotificationsService } from 'tabby-core';

import { WarpgateSnippetsService, snippetPreview } from '../services/snippets.service';
import { WarpgateHostSettingsService, parseTags } from '../services/host-settings.service';
import { WarpgateSshHandler } from '../providers/warpgate-ssh-handler.provider';
import { WarpgateSnippet } from '../models/warpgate.models';
import { WARPGATE_THEME_STYLES } from './shared.styles';
import { isElementActive } from '../utils/dom';

/** Open Warpgate session a snippet can be sent to */
interface OpenSession {
  tab: any;
  label: string;
  detail: string;
}

/** Editable snippet form */
interface SnippetForm {
  id?: string;
  name: string;
  description: string;
  tags: string;
  script: string;
}

@Component({
  selector: 'warpgate-snippets',
  template: `
    <div class="snippets-view">
      <div class="view-toolbar">
        <div class="search">
          <i class="fas fa-search"></i>
          <input class="wg-input" [(ngModel)]="query" placeholder="Search snippets" aria-label="Search snippets" />
        </div>
        <button class="wg-btn wg-btn-primary" (click)="openEditor()">
          <i class="fas fa-plus"></i> New snippet
        </button>
      </div>

      <div class="wg-empty" *ngIf="snippets.length === 0">
        <div class="wg-empty-icon"><i class="fas fa-code"></i></div>
        <h4>Build your command library</h4>
        <p>Save the commands you type every day and run them in any session, on several hosts at once, or automatically when you connect.</p>
        <button class="wg-btn wg-btn-primary" (click)="openEditor()"><i class="fas fa-plus"></i> Create your first snippet</button>
      </div>

      <div class="wg-empty compact" *ngIf="snippets.length > 0 && filtered.length === 0">
        <p>No snippets match “{{ query }}”.</p>
      </div>

      <div class="snippet-grid" *ngIf="filtered.length > 0">
        <article class="snippet-card" *ngFor="let snippet of filtered; trackBy: trackById">
          <header class="snippet-head">
            <div class="snippet-icon"><i class="fas fa-terminal"></i></div>
            <div class="snippet-title">
              <h5>{{ snippet.name }}</h5>
              <p *ngIf="snippet.description">{{ snippet.description }}</p>
            </div>
            <div class="snippet-actions">
              <button class="wg-icon-btn wg-icon-btn-sm" (click)="openEditor(snippet)" title="Edit" aria-label="Edit snippet">
                <i class="fas fa-pen"></i>
              </button>
              <button class="wg-icon-btn wg-icon-btn-sm" (click)="duplicate(snippet)" title="Duplicate" aria-label="Duplicate snippet">
                <i class="far fa-copy"></i>
              </button>
              <button class="wg-icon-btn wg-icon-btn-sm danger" (click)="remove(snippet)" title="Delete" aria-label="Delete snippet">
                <i class="fas fa-trash-alt"></i>
              </button>
            </div>
          </header>

          <pre class="snippet-code"><code>{{ snippet.script }}</code></pre>

          <footer class="snippet-foot">
            <div class="snippet-tags">
              <span class="wg-chip" *ngFor="let tag of snippet.tags">#{{ tag }}</span>
              <span class="lines" *ngIf="lineCount(snippet) > 1">{{ lineCount(snippet) }} lines</span>
            </div>
            <div class="run-wrap">
              <button class="wg-btn wg-btn-sm wg-btn-primary" (click)="toggleRunMenu(snippet, $event)">
                <i class="fas fa-play"></i> Run <i class="fas fa-chevron-down caret"></i>
              </button>
              <div class="wg-menu run-menu" *ngIf="runMenuFor === snippet.id" (click)="$event.stopPropagation()">
                <div class="wg-menu-label">Open sessions</div>
                <button class="wg-menu-item" *ngFor="let session of openSessions" (click)="runInSession(snippet, session)">
                  <i class="fas fa-terminal"></i>
                  <span class="session-label">{{ session.label }}</span>
                  <span class="meta">{{ session.detail }}</span>
                </button>
                <button class="wg-menu-item" disabled *ngIf="openSessions.length === 0">
                  <i class="fas fa-plug"></i> No open Warpgate sessions
                </button>
                <button class="wg-menu-item" *ngIf="openSessions.length > 1" (click)="runInAllSessions(snippet)">
                  <i class="fas fa-layer-group"></i> All open sessions
                  <span class="meta">{{ openSessions.length }}</span>
                </button>
                <div class="wg-menu-divider"></div>
                <button class="wg-menu-item" (click)="chooseHosts(snippet)">
                  <i class="fas fa-network-wired"></i> Connect to hosts and run…
                </button>
              </div>
            </div>
          </footer>
        </article>
      </div>
    </div>

    <ng-container *ngIf="form">
      <div class="wg-drawer-backdrop" (click)="closeEditor()"></div>
      <aside class="wg-drawer" role="dialog" aria-modal="true" aria-label="Snippet editor">
        <header class="wg-drawer-header">
          <div class="editor-icon"><i class="fas fa-code"></i></div>
          <div class="editor-heading">
            <h3 class="wg-drawer-title">{{ form.id ? 'Edit snippet' : 'New snippet' }}</h3>
            <div class="wg-drawer-subtitle">Lines are sent to the shell one after another</div>
          </div>
          <button class="wg-icon-btn" (click)="closeEditor()" title="Close (Esc)" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </header>
        <div class="wg-drawer-body wg-scroll">
          <div class="wg-field">
            <label for="wg-snippet-name">Name</label>
            <input id="wg-snippet-name" class="wg-input" [(ngModel)]="form.name" placeholder="Tail application logs" maxlength="80" />
          </div>
          <div class="wg-field">
            <label for="wg-snippet-script">Script</label>
            <textarea
              id="wg-snippet-script"
              class="wg-textarea wg-code"
              rows="9"
              [(ngModel)]="form.script"
              placeholder="sudo journalctl -u my-app -f"
              spellcheck="false"
            ></textarea>
          </div>
          <div class="wg-field">
            <label for="wg-snippet-description">Description</label>
            <input id="wg-snippet-description" class="wg-input" [(ngModel)]="form.description" placeholder="What does it do? (optional)" />
          </div>
          <div class="wg-field">
            <label for="wg-snippet-tags">Tags</label>
            <input id="wg-snippet-tags" class="wg-input" [(ngModel)]="form.tags" placeholder="logs, debugging" />
          </div>
          <div class="form-error" *ngIf="formError"><i class="fas fa-exclamation-circle"></i> {{ formError }}</div>
        </div>
        <footer class="wg-drawer-footer">
          <button class="wg-btn" (click)="closeEditor()">Cancel</button>
          <button class="wg-btn wg-btn-primary" (click)="saveForm()" [disabled]="!form.name.trim() || !form.script.trim()">
            <i class="fas fa-check"></i> Save snippet
          </button>
        </footer>
      </aside>
    </ng-container>
  `,
  styles: [WARPGATE_THEME_STYLES, `
    :host { display: block; }
    .snippets-view { display: flex; flex-direction: column; gap: 18px; }
    .view-toolbar { display: flex; align-items: center; gap: 12px; }
    .search { position: relative; flex: 1; max-width: 420px; }
    .search i { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--wg-subtle); font-size: 12px; }
    .search .wg-input { padding-left: 34px; }

    .snippet-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
    .snippet-card {
      display: flex; flex-direction: column; gap: 12px; padding: 16px;
      border-radius: var(--wg-radius-lg); border: 1px solid var(--wg-border); background: var(--wg-surface);
      transition: border-color 0.2s var(--wg-ease), box-shadow 0.2s var(--wg-ease), transform 0.2s var(--wg-ease);
      animation: wg-rise 0.3s var(--wg-ease) both;
    }
    .snippet-card:hover { border-color: var(--wg-border-strong); box-shadow: var(--wg-shadow); }
    .snippet-head { display: flex; align-items: flex-start; gap: 12px; }
    .snippet-icon {
      width: 36px; height: 36px; border-radius: 11px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      background: var(--wg-accent-soft); color: var(--wg-accent); font-size: 14px;
    }
    .snippet-title { flex: 1; min-width: 0; }
    .snippet-title h5 { margin: 1px 0 2px; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .snippet-title p { margin: 0; font-size: 12px; color: var(--wg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .snippet-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s var(--wg-ease); }
    .snippet-card:hover .snippet-actions, .snippet-card:focus-within .snippet-actions { opacity: 1; }
    .wg-icon-btn.danger:hover { color: var(--wg-danger); background: color-mix(in srgb, var(--wg-danger) 12%, transparent); }

    .snippet-code {
      position: relative; margin: 0; padding: 12px 14px; max-height: 116px; overflow: hidden;
      border-radius: 12px; border: 1px solid var(--wg-border);
      background: color-mix(in srgb, var(--wg-bg) 70%, #000);
      font-family: var(--wg-mono); font-size: 12px; line-height: 1.6; color: color-mix(in srgb, var(--wg-fg) 88%, var(--wg-accent));
      white-space: pre-wrap; word-break: break-all;
      -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent);
      mask-image: linear-gradient(180deg, #000 70%, transparent);
    }
    .snippet-code code { font: inherit; color: inherit; background: none; padding: 0; }

    .snippet-foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .snippet-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
    .lines { font-size: 11px; color: var(--wg-subtle); }
    .run-wrap { position: relative; flex-shrink: 0; }
    .caret { font-size: 9px; opacity: 0.8; }
    .run-menu { right: 0; top: calc(100% + 6px); width: 300px; }
    .session-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .editor-icon {
      width: 44px; height: 44px; border-radius: 13px; display: flex; align-items: center; justify-content: center;
      background: var(--wg-gradient); color: var(--wg-accent-fg); font-size: 16px; box-shadow: 0 10px 24px -12px var(--wg-accent);
    }
    .editor-heading { flex: 1; min-width: 0; }
    .form-error {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 10px; font-size: 13px;
      color: var(--wg-danger); background: color-mix(in srgb, var(--wg-danger) 10%, transparent);
    }
    .wg-empty.compact { padding: 32px 16px; }
  `],
})
export class WarpgateSnippetsComponent implements OnInit, OnDestroy {
  /** Emitted when the user wants to run a snippet on hosts picked from the host list */
  @Output() runOnHosts = new EventEmitter<WarpgateSnippet>();

  snippets: WarpgateSnippet[] = [];
  query = '';
  form: SnippetForm | null = null;
  formError = '';
  runMenuFor: string | null = null;
  openSessions: OpenSession[] = [];

  private subscriptions: Subscription[] = [];

  constructor(
    @Inject(WarpgateSnippetsService) private snippetsService: WarpgateSnippetsService,
    @Inject(WarpgateHostSettingsService) private hostSettings: WarpgateHostSettingsService,
    @Inject(WarpgateSshHandler) private sshHandler: WarpgateSshHandler,
    @Inject(AppService) private app: AppService,
    @Inject(NotificationsService) private notifications: NotificationsService,
    @Inject(ElementRef) private element: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    this.load();
    this.subscriptions.push(this.snippetsService.changes$.subscribe(() => this.load()));
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  get filtered(): WarpgateSnippet[] {
    const query = this.query.trim().toLowerCase();
    if (!query) {
      return this.snippets;
    }
    return this.snippets.filter(snippet =>
      snippet.name.toLowerCase().includes(query) ||
      snippet.script.toLowerCase().includes(query) ||
      (snippet.description ?? '').toLowerCase().includes(query) ||
      (snippet.tags ?? []).some(tag => tag.toLowerCase().includes(query))
    );
  }

  trackById(_index: number, snippet: WarpgateSnippet): string {
    return snippet.id;
  }

  lineCount(snippet: WarpgateSnippet): number {
    return snippet.script.split('\n').length;
  }

  @HostListener('document:click')
  closeRunMenu(): void {
    this.runMenuFor = null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!isElementActive(this.element.nativeElement)) {
      return;
    }
    if (this.form) {
      this.closeEditor();
    } else {
      this.runMenuFor = null;
    }
  }

  toggleRunMenu(snippet: WarpgateSnippet, event: MouseEvent): void {
    event.stopPropagation();
    if (this.runMenuFor === snippet.id) {
      this.runMenuFor = null;
      return;
    }
    this.openSessions = this.sshHandler.getOpenWarpgateTabs().map(tab => {
      const target = this.sshHandler.getTabTarget(tab);
      const label = target ? this.hostSettings.getDisplayName(target.serverId, target.targetName) : tab.title;
      const connected = !!tab.session?.open;
      return { tab, label, detail: connected ? 'connected' : 'not connected' };
    });
    this.runMenuFor = snippet.id;
  }

  runInSession(snippet: WarpgateSnippet, session: OpenSession): void {
    this.runMenuFor = null;
    if (this.snippetsService.runInTab(session.tab, snippet)) {
      this.app.selectTab(this.app.getParentTab(session.tab) ?? session.tab);
    }
  }

  runInAllSessions(snippet: WarpgateSnippet): void {
    this.runMenuFor = null;
    const count = this.snippetsService.runInTabs(this.openSessions.map(session => session.tab), snippet);
    this.notifications.info(`Sent “${snippet.name}” to ${count} session${count === 1 ? '' : 's'}`);
  }

  chooseHosts(snippet: WarpgateSnippet): void {
    this.runMenuFor = null;
    this.runOnHosts.emit(snippet);
  }

  openEditor(snippet?: WarpgateSnippet): void {
    this.formError = '';
    this.form = snippet
      ? {
        id: snippet.id,
        name: snippet.name,
        description: snippet.description ?? '',
        tags: (snippet.tags ?? []).join(', '),
        script: snippet.script,
      }
      : { name: '', description: '', tags: '', script: '' };

    // Move focus into the editor so typing and Escape go to it
    setTimeout(() => {
      this.element.nativeElement.querySelector<HTMLInputElement>('#wg-snippet-name')?.focus();
    });
  }

  closeEditor(): void {
    this.form = null;
    this.formError = '';
  }

  saveForm(): void {
    if (!this.form) {
      return;
    }
    try {
      this.snippetsService.saveSnippet({
        id: this.form.id,
        name: this.form.name,
        description: this.form.description,
        tags: parseTags(this.form.tags),
        script: this.form.script,
      });
      this.closeEditor();
    } catch (error) {
      this.formError = error instanceof Error ? error.message : 'Could not save snippet';
    }
  }

  duplicate(snippet: WarpgateSnippet): void {
    this.snippetsService.saveSnippet({
      name: `${snippet.name} (copy)`,
      description: snippet.description,
      tags: snippet.tags,
      script: snippet.script,
    });
  }

  remove(snippet: WarpgateSnippet): void {
    if (confirm(`Delete the snippet “${snippet.name}”?`)) {
      this.snippetsService.deleteSnippet(snippet.id);
    }
  }

  preview(snippet: WarpgateSnippet): string {
    return snippetPreview(snippet.script);
  }

  private load(): void {
    this.snippets = this.snippetsService.getSnippets();
  }
}
