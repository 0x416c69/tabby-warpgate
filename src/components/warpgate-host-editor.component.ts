/**
 * Warpgate Host Editor Component
 * Side panel for editing a host's alias, tags, notes, color and SSH options
 */

import { AfterViewInit, Component, ElementRef, EventEmitter, Inject, Input, OnInit, Output, HostListener } from '@angular/core';

import { WarpgateHostSettingsService, describePortForward, normalizePortForward } from '../services/host-settings.service';
import { WarpgateSnippetsService } from '../services/snippets.service';
import {
  WarpgateHostSettings,
  WarpgatePortForward,
  WarpgateServerConfig,
  WarpgateSnippet,
  WarpgateTarget,
} from '../models/warpgate.models';
import { getTargetColor, getTargetIcon } from '../utils/target-appearance';
import { isElementActive } from '../utils/dom';
import { HOST_COLOR_PRESETS, WARPGATE_THEME_STYLES } from './shared.styles';

/** Tri-state option: inherit the server default, force on or force off */
type InheritableFlag = 'inherit' | 'on' | 'off';

@Component({
  selector: 'warpgate-host-editor',
  template: `
    <div class="wg-drawer-backdrop" (click)="cancel()"></div>
    <aside class="wg-drawer" role="dialog" aria-modal="true" [attr.aria-label]="'Edit ' + target.name">
      <header class="wg-drawer-header">
        <div class="editor-avatar" [style.--wg-host]="previewColor">
          <i [class]="icon"></i>
        </div>
        <div class="editor-heading">
          <h3 class="wg-drawer-title">{{ alias.trim() || target.name }}</h3>
          <div class="wg-drawer-subtitle">{{ target.name }} · {{ server.name }}</div>
        </div>
        <button class="wg-icon-btn" (click)="cancel()" title="Close (Esc)" aria-label="Close">
          <i class="fas fa-times"></i>
        </button>
      </header>

      <div class="wg-drawer-body wg-scroll">
        <div class="wg-section-title"><i class="fas fa-id-card"></i> General</div>

        <div class="wg-field">
          <label for="wg-host-alias">Display name</label>
          <input id="wg-host-alias" class="wg-input" [(ngModel)]="alias" [placeholder]="target.name" maxlength="80" />
        </div>

        <div class="wg-field">
          <label>Color</label>
          <div class="swatches">
            <button
              class="swatch auto"
              [class.selected]="!color"
              (click)="color = ''"
              title="Automatic"
              [style.--wg-swatch]="autoColor"
            ><i class="fas fa-magic"></i></button>
            <button
              *ngFor="let preset of colorPresets"
              class="swatch"
              [class.selected]="color === preset"
              [style.--wg-swatch]="preset"
              (click)="color = preset"
              [title]="preset"
            ></button>
            <label class="swatch custom" [class.selected]="isCustomColor()" title="Custom color">
              <i class="fas fa-eye-dropper"></i>
              <input type="color" [ngModel]="color || autoColor" (ngModelChange)="color = $event" />
            </label>
          </div>
        </div>

        <div class="wg-field">
          <label for="wg-host-tags">Tags</label>
          <div class="tag-editor" (click)="tagInput.focus()">
            <span class="wg-chip wg-chip-accent" *ngFor="let tag of tags">
              #{{ tag }}
              <button class="chip-remove" (click)="removeTag(tag); $event.stopPropagation()" [attr.aria-label]="'Remove ' + tag">
                <i class="fas fa-times"></i>
              </button>
            </span>
            <input
              #tagInput
              id="wg-host-tags"
              class="tag-input"
              [(ngModel)]="tagDraft"
              (keydown)="onTagKeyDown($event)"
              (blur)="commitTagDraft()"
              [placeholder]="tags.length ? '' : 'prod, database, eu-west…'"
            />
          </div>
          <div class="tag-suggestions" *ngIf="tagSuggestions.length">
            <button class="wg-chip" *ngFor="let tag of tagSuggestions" (click)="addTag(tag)">+ {{ tag }}</button>
          </div>
        </div>

        <div class="wg-field">
          <label for="wg-host-notes">Notes</label>
          <textarea id="wg-host-notes" class="wg-textarea" rows="3" [(ngModel)]="notes" placeholder="Anything worth remembering about this host"></textarea>
        </div>

        <div class="wg-section-title"><i class="fas fa-terminal"></i> On connect</div>

        <div class="wg-field">
          <label for="wg-host-snippet">Startup snippet</label>
          <select id="wg-host-snippet" class="wg-select" [(ngModel)]="startupSnippetId">
            <option [ngValue]="''">None</option>
            <option *ngFor="let snippet of snippets" [ngValue]="snippet.id">{{ snippet.name }}</option>
          </select>
          <div class="wg-hint" *ngIf="!snippets.length">Create snippets in the Snippets section to run them automatically after connecting.</div>
          <pre class="snippet-preview" *ngIf="selectedSnippet">{{ selectedSnippet.script }}</pre>
        </div>

        <div class="wg-section-title"><i class="fas fa-sliders-h"></i> SSH options</div>

        <div class="option-row">
          <div class="option-text">
            <div class="option-name">Agent forwarding</div>
            <div class="wg-hint">Server default: {{ server.agentForward ? 'on' : 'off' }}</div>
          </div>
          <div class="wg-segmented">
            <button [class.active]="agentForward === 'inherit'" (click)="agentForward = 'inherit'">Default</button>
            <button [class.active]="agentForward === 'on'" (click)="agentForward = 'on'">On</button>
            <button [class.active]="agentForward === 'off'" (click)="agentForward = 'off'">Off</button>
          </div>
        </div>

        <div class="option-row">
          <div class="option-text">
            <div class="option-name">X11 forwarding</div>
            <div class="wg-hint">Server default: {{ server.x11 ? 'on' : 'off' }}</div>
          </div>
          <div class="wg-segmented">
            <button [class.active]="x11 === 'inherit'" (click)="x11 = 'inherit'">Default</button>
            <button [class.active]="x11 === 'on'" (click)="x11 = 'on'">On</button>
            <button [class.active]="x11 === 'off'" (click)="x11 = 'off'">Off</button>
          </div>
        </div>

        <div class="option-row">
          <div class="option-text">
            <div class="option-name">Keepalive interval</div>
            <div class="wg-hint">Seconds, empty uses {{ server.keepaliveInterval !== undefined && server.keepaliveInterval !== null ? (server.keepaliveInterval / 1000) + 's (server default)' : "Tabby's default" }}</div>
          </div>
          <input class="wg-input keepalive-input" type="number" min="0" step="1" [(ngModel)]="keepaliveSeconds" placeholder="—" />
        </div>

        <div class="wg-section-title"><i class="fas fa-random"></i> Port forwarding</div>

        <div class="forward-list" *ngIf="forwards.length">
          <div class="forward-item" *ngFor="let rule of forwards; let i = index">
            <span class="forward-type" [attr.data-type]="rule.type">{{ rule.type === 'Dynamic' ? 'SOCKS' : rule.type }}</span>
            <div class="forward-text">
              <div class="forward-rule">{{ describe(rule) }}</div>
              <div class="wg-hint" *ngIf="rule.description">{{ rule.description }}</div>
            </div>
            <button class="wg-icon-btn wg-icon-btn-sm" (click)="removeForward(i)" title="Remove rule" aria-label="Remove rule">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
        </div>

        <div class="forward-form">
          <div class="wg-segmented forward-types">
            <button [class.active]="draftForward.type === 'Local'" (click)="draftForward.type = 'Local'">Local</button>
            <button [class.active]="draftForward.type === 'Remote'" (click)="draftForward.type = 'Remote'">Remote</button>
            <button [class.active]="draftForward.type === 'Dynamic'" (click)="draftForward.type = 'Dynamic'">Dynamic</button>
          </div>
          <div class="wg-row">
            <input class="wg-input" [(ngModel)]="draftForward.host" placeholder="Bind address (127.0.0.1)" />
            <input class="wg-input port" type="number" min="1" max="65535" [(ngModel)]="draftForward.port" placeholder="Port" />
          </div>
          <div class="wg-row" *ngIf="draftForward.type !== 'Dynamic'">
            <input class="wg-input" [(ngModel)]="draftForward.targetAddress" placeholder="Destination host" />
            <input class="wg-input port" type="number" min="1" max="65535" [(ngModel)]="draftForward.targetPort" placeholder="Port" />
          </div>
          <div class="wg-row">
            <input class="wg-input" [(ngModel)]="draftForward.description" placeholder="Description (optional)" />
            <button class="wg-btn add-rule" (click)="addForward()" [disabled]="!canAddForward()">
              <i class="fas fa-plus"></i> Add rule
            </button>
          </div>
          <div class="wg-hint">
            Forwards start when the session connects. Whether they work depends on the forwarding support of your Warpgate server.
          </div>
        </div>
      </div>

      <footer class="wg-drawer-footer">
        <button class="wg-btn wg-btn-ghost reset" (click)="reset()" [disabled]="!hasCustomization()" title="Remove all customization of this host">
          <i class="fas fa-undo"></i> Reset
        </button>
        <button class="wg-btn" (click)="cancel()">Cancel</button>
        <button class="wg-btn wg-btn-primary" (click)="save()"><i class="fas fa-check"></i> Save</button>
      </footer>
    </aside>
  `,
  styles: [WARPGATE_THEME_STYLES, `
    .editor-avatar {
      width: 44px; height: 44px; border-radius: 13px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; color: #fff; font-size: 17px;
      background: linear-gradient(140deg, color-mix(in srgb, var(--wg-host) 88%, #fff), color-mix(in srgb, var(--wg-host) 72%, #000));
      box-shadow: 0 10px 24px -12px var(--wg-host), inset 0 1px 0 rgba(255, 255, 255, 0.25);
      transition: background 0.2s var(--wg-ease);
    }
    .editor-heading { flex: 1; min-width: 0; }
    .editor-heading .wg-drawer-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .swatches { display: flex; flex-wrap: wrap; gap: 8px; }
    .swatch {
      position: relative; width: 28px; height: 28px; border-radius: 9px; cursor: pointer;
      border: 2px solid transparent; background: var(--wg-swatch);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
      display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px;
      transition: transform 0.15s var(--wg-ease), box-shadow 0.15s var(--wg-ease);
    }
    .swatch:hover { transform: translateY(-2px); }
    .swatch.selected { box-shadow: 0 0 0 2px var(--wg-bg), 0 0 0 4px var(--wg-swatch, var(--wg-accent)); }
    .swatch.custom { background: conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #ec4899, #ef4444); }
    .swatch.custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .swatch.auto { background: var(--wg-swatch); }

    .tag-editor {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 38px; padding: 6px 8px;
      border-radius: 10px; border: 1px solid var(--wg-border); background: var(--wg-surface); cursor: text;
      transition: border-color 0.15s var(--wg-ease), box-shadow 0.15s var(--wg-ease);
    }
    .tag-editor:focus-within { border-color: var(--wg-accent); box-shadow: 0 0 0 3px var(--wg-accent-soft); }
    .tag-input { flex: 1; min-width: 120px; height: 24px; border: 0; outline: none; background: transparent; color: var(--wg-fg); font-size: 13px; }
    .tag-input::placeholder { color: var(--wg-subtle); }
    .chip-remove { border: 0; padding: 0; background: transparent; color: inherit; opacity: 0.7; cursor: pointer; font-size: 9px; }
    .chip-remove:hover { opacity: 1; }
    .tag-suggestions { display: flex; flex-wrap: wrap; gap: 6px; }

    .snippet-preview {
      margin: 4px 0 0; padding: 10px 12px; max-height: 120px; overflow: auto;
      border-radius: 10px; background: var(--wg-surface-2); border: 1px solid var(--wg-border);
      font-family: var(--wg-mono); font-size: 12px; color: var(--wg-muted); white-space: pre-wrap;
    }

    .option-row { display: flex; align-items: center; gap: 16px; padding: 10px 0; border-bottom: 1px dashed var(--wg-border); }
    .option-row:last-of-type { border-bottom: 0; }
    .option-text { flex: 1; min-width: 0; }
    .option-name { font-size: 13px; font-weight: 600; }
    .keepalive-input { width: 96px; flex: 0 0 96px; }

    .forward-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .forward-item {
      display: flex; align-items: center; gap: 12px; padding: 10px 12px;
      border-radius: 12px; border: 1px solid var(--wg-border); background: var(--wg-surface);
    }
    .forward-type {
      flex-shrink: 0; min-width: 62px; text-align: center; padding: 4px 8px; border-radius: 7px;
      font-size: 10.5px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;
      background: var(--wg-accent-soft); color: var(--wg-accent);
    }
    .forward-type[data-type='Remote'] { background: color-mix(in srgb, var(--wg-warning) 16%, transparent); color: var(--wg-warning); }
    .forward-type[data-type='Dynamic'] { background: color-mix(in srgb, var(--wg-success) 16%, transparent); color: var(--wg-success); }
    .forward-text { flex: 1; min-width: 0; }
    .forward-rule { font-family: var(--wg-mono); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .forward-form {
      display: flex; flex-direction: column; gap: 10px; padding: 14px;
      border-radius: 14px; border: 1px dashed var(--wg-border-strong); background: var(--wg-surface);
    }
    .forward-types { align-self: flex-start; }
    .wg-input.port { flex: 0 0 96px; }
    .add-rule { flex: 0 0 auto; }
    .reset { margin-right: auto; }
  `],
})
export class WarpgateHostEditorComponent implements OnInit, AfterViewInit {
  @Input() server!: WarpgateServerConfig;
  @Input() target!: WarpgateTarget;
  @Output() closed = new EventEmitter<boolean>();

  readonly colorPresets = HOST_COLOR_PRESETS;

  alias = '';
  color = '';
  tags: string[] = [];
  tagDraft = '';
  notes = '';
  startupSnippetId = '';
  agentForward: InheritableFlag = 'inherit';
  x11: InheritableFlag = 'inherit';
  keepaliveSeconds: number | null = null;
  forwards: WarpgatePortForward[] = [];
  draftForward: Partial<WarpgatePortForward> = this.emptyForward();

  snippets: WarpgateSnippet[] = [];
  icon = 'fas fa-server';
  autoColor = '#6366f1';
  private allTags: string[] = [];
  private original: WarpgateHostSettings = {};

  constructor(
    @Inject(WarpgateHostSettingsService) private hostSettings: WarpgateHostSettingsService,
    @Inject(WarpgateSnippetsService) private snippetsService: WarpgateSnippetsService,
    @Inject(ElementRef) private element: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    this.original = this.hostSettings.getSettings(this.server.id, this.target.name);
    this.snippets = this.snippetsService.getSnippets();
    this.allTags = this.hostSettings.getAllTags();
    this.icon = getTargetIcon(this.target);
    this.autoColor = getTargetColor(this.target);

    const settings = this.original;
    this.alias = settings.alias ?? '';
    this.color = settings.color ?? '';
    this.tags = [...(settings.tags ?? [])];
    this.notes = settings.notes ?? '';
    this.startupSnippetId = settings.startupSnippetId && this.snippets.some(s => s.id === settings.startupSnippetId)
      ? settings.startupSnippetId
      : '';
    this.agentForward = this.toFlag(settings.agentForward);
    this.x11 = this.toFlag(settings.x11);
    this.keepaliveSeconds = settings.keepaliveInterval !== undefined ? settings.keepaliveInterval / 1000 : null;
    this.forwards = (settings.forwardedPorts ?? []).map(rule => ({ ...rule }));
  }

  ngAfterViewInit(): void {
    // Move focus into the panel so typing and Escape go to the editor
    setTimeout(() => {
      this.element.nativeElement.querySelector<HTMLInputElement>('#wg-host-alias')?.focus();
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (isElementActive(this.element.nativeElement)) {
      this.cancel();
    }
  }

  get previewColor(): string {
    return this.color || this.autoColor;
  }

  get selectedSnippet(): WarpgateSnippet | undefined {
    return this.snippets.find(snippet => snippet.id === this.startupSnippetId);
  }

  get tagSuggestions(): string[] {
    const draft = this.tagDraft.trim().toLowerCase();
    const used = new Set(this.tags.map(tag => tag.toLowerCase()));
    return this.allTags
      .filter(tag => !used.has(tag.toLowerCase()) && (!draft || tag.toLowerCase().includes(draft)))
      .slice(0, 8);
  }

  isCustomColor(): boolean {
    return !!this.color && !this.colorPresets.includes(this.color);
  }

  describe(rule: WarpgatePortForward): string {
    return describePortForward(rule);
  }

  onTagKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ' || event.key === 'Tab') {
      if (this.tagDraft.trim()) {
        event.preventDefault();
        this.commitTagDraft();
      }
    } else if (event.key === 'Backspace' && !this.tagDraft && this.tags.length) {
      this.tags = this.tags.slice(0, -1);
    }
  }

  commitTagDraft(): void {
    for (const tag of this.tagDraft.split(/[,\s]+/)) {
      this.addTag(tag);
    }
    this.tagDraft = '';
  }

  addTag(value: string): void {
    const tag = value.trim().replace(/^#/, '');
    if (tag && !this.tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) {
      this.tags = [...this.tags, tag];
    }
  }

  removeTag(tag: string): void {
    this.tags = this.tags.filter(existing => existing !== tag);
  }

  canAddForward(): boolean {
    return normalizePortForward(this.draftForward) !== null;
  }

  addForward(): void {
    const rule = normalizePortForward(this.draftForward);
    if (rule) {
      this.forwards = [...this.forwards, rule];
      this.draftForward = this.emptyForward(this.draftForward.type);
    }
  }

  removeForward(index: number): void {
    this.forwards = this.forwards.filter((_, i) => i !== index);
  }

  hasCustomization(): boolean {
    return Object.keys(this.original).length > 0;
  }

  reset(): void {
    this.hostSettings.updateSettings(this.server.id, this.target.name, {});
    this.closed.emit(true);
  }

  save(): void {
    this.commitTagDraft();
    this.hostSettings.updateSettings(this.server.id, this.target.name, this.collect());
    this.closed.emit(true);
  }

  cancel(): void {
    this.closed.emit(false);
  }

  private collect(): WarpgateHostSettings {
    const settings: WarpgateHostSettings = {
      alias: this.alias,
      color: this.color,
      tags: this.tags,
      notes: this.notes,
      startupSnippetId: this.startupSnippetId || undefined,
      forwardedPorts: this.forwards,
      agentForward: this.fromFlag(this.agentForward),
      x11: this.fromFlag(this.x11),
    };
    if (this.keepaliveSeconds !== null && this.keepaliveSeconds !== undefined && `${this.keepaliveSeconds}` !== '') {
      settings.keepaliveInterval = Math.max(0, Number(this.keepaliveSeconds)) * 1000;
    }
    return settings;
  }

  private toFlag(value: boolean | undefined): InheritableFlag {
    return value === undefined ? 'inherit' : value ? 'on' : 'off';
  }

  private fromFlag(flag: InheritableFlag): boolean | undefined {
    return flag === 'inherit' ? undefined : flag === 'on';
  }

  private emptyForward(type: WarpgatePortForward['type'] = 'Local'): Partial<WarpgatePortForward> {
    return { type, host: '127.0.0.1', port: undefined, targetAddress: '', targetPort: undefined, description: '' };
  }
}
