/**
 * Warpgate History Component
 * Timeline of recent connections
 */

import { Component, EventEmitter, Inject, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';

import { WarpgateService } from '../services/warpgate.service';
import { WarpgateHistoryService } from '../services/history.service';
import { WarpgateHostSettingsService } from '../services/host-settings.service';
import { WarpgateHistoryEntry, WarpgateServerConfig, WarpgateTarget } from '../models/warpgate.models';
import { getTargetColor, getTargetIcon } from '../utils/target-appearance';
import { WARPGATE_THEME_STYLES } from './shared.styles';

/** History entry prepared for display */
interface HistoryItem {
  entry: WarpgateHistoryEntry;
  server: WarpgateServerConfig;
  target: WarpgateTarget | null;
  name: string;
  icon: string;
  color: string;
  time: string;
}

/** Entries of one day */
interface HistoryDay {
  label: string;
  items: HistoryItem[];
}

/**
 * Format a time as "14:05"
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Label for the day of a date ("Today", "Yesterday", "Monday, 3 March")
 */
export function formatDayLabel(date: Date, now: Date = new Date()): string {
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (days <= 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

@Component({
  selector: 'warpgate-history',
  template: `
    <div class="history-view">
      <div class="view-toolbar" *ngIf="days.length">
        <span class="summary">{{ total }} host{{ total === 1 ? '' : 's' }} in your history</span>
        <button class="wg-btn wg-btn-ghost" (click)="clear()"><i class="fas fa-eraser"></i> Clear history</button>
      </div>

      <div class="wg-empty" *ngIf="days.length === 0">
        <div class="wg-empty-icon"><i class="fas fa-history"></i></div>
        <h4>No connections yet</h4>
        <p>Hosts you connect to show up here, so you can jump back into them in one click.</p>
      </div>

      <section class="day" *ngFor="let day of days">
        <h6 class="day-label">{{ day.label }}</h6>
        <div class="timeline">
          <div class="history-item" *ngFor="let item of day.items" [class.unavailable]="!item.target">
            <div class="avatar" [style.--wg-host]="item.color"><i [class]="item.icon"></i></div>
            <div class="info">
              <div class="name">{{ item.name }}</div>
              <div class="meta">
                <span>{{ item.server.name }}</span>
                <span class="sep">•</span>
                <span>{{ item.entry.count }} connection{{ item.entry.count === 1 ? '' : 's' }}</span>
                <span class="sep" *ngIf="!item.target">•</span>
                <span class="gone" *ngIf="!item.target">not available</span>
              </div>
            </div>
            <span class="time">{{ item.time }}</span>
            <div class="actions">
              <button
                class="wg-btn wg-btn-sm wg-btn-primary"
                (click)="connect.emit({ server: item.server, target: item.target! })"
                [disabled]="!item.target"
              >
                <i class="fas fa-bolt"></i> Connect
              </button>
              <button class="wg-icon-btn wg-icon-btn-sm" (click)="remove(item)" title="Remove from history" aria-label="Remove from history">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [WARPGATE_THEME_STYLES, `
    :host { display: block; }
    .history-view { display: flex; flex-direction: column; gap: 20px; max-width: 900px; }
    .view-toolbar { display: flex; align-items: center; justify-content: space-between; }
    .summary { font-size: 13px; color: var(--wg-muted); }

    .day-label {
      margin: 0 0 10px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--wg-subtle);
    }
    .timeline { display: flex; flex-direction: column; gap: 6px; }
    .history-item {
      display: flex; align-items: center; gap: 14px; padding: 10px 12px 10px 10px;
      border-radius: 14px; border: 1px solid var(--wg-border); background: var(--wg-surface);
      transition: border-color 0.15s var(--wg-ease), background 0.15s var(--wg-ease);
      animation: wg-rise 0.25s var(--wg-ease) both;
    }
    .history-item:hover { border-color: var(--wg-border-strong); background: var(--wg-surface-2); }
    .history-item.unavailable { opacity: 0.6; }
    .avatar {
      width: 36px; height: 36px; border-radius: 11px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 14px;
      background: linear-gradient(140deg, color-mix(in srgb, var(--wg-host) 88%, #fff), color-mix(in srgb, var(--wg-host) 72%, #000));
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }
    .info { flex: 1; min-width: 0; }
    .name { font-size: 14px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { display: flex; gap: 6px; font-size: 12px; color: var(--wg-subtle); white-space: nowrap; overflow: hidden; }
    .sep { opacity: 0.6; }
    .gone { color: var(--wg-warning); }
    .time { font-family: var(--wg-mono); font-size: 12px; color: var(--wg-muted); }
    .actions { display: flex; align-items: center; gap: 4px; opacity: 0; transition: opacity 0.15s var(--wg-ease); }
    .history-item:hover .actions, .history-item:focus-within .actions { opacity: 1; }
  `],
})
export class WarpgateHistoryComponent implements OnInit, OnDestroy {
  @Output() connect = new EventEmitter<{ server: WarpgateServerConfig; target: WarpgateTarget }>();

  days: HistoryDay[] = [];
  total = 0;

  private subscriptions: Subscription[] = [];

  constructor(
    @Inject(WarpgateService) private warpgate: WarpgateService,
    @Inject(WarpgateHistoryService) private history: WarpgateHistoryService,
    @Inject(WarpgateHostSettingsService) private hostSettings: WarpgateHostSettingsService
  ) {}

  ngOnInit(): void {
    this.load();
    this.subscriptions.push(
      this.history.changes$.subscribe(() => this.load()),
      this.warpgate.targets$.subscribe(() => this.load()),
      this.hostSettings.changes$.subscribe(() => this.load())
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  remove(item: HistoryItem): void {
    this.history.removeEntry(item.entry.serverId, item.entry.targetName);
  }

  clear(): void {
    if (confirm('Clear the whole connection history?')) {
      this.history.clearHistory();
    }
  }

  private load(): void {
    const days: HistoryDay[] = [];
    const entries = this.history.getHistory();

    for (const entry of entries) {
      const server = this.warpgate.getServer(entry.serverId);
      if (!server) {
        continue;
      }
      const target = this.warpgate.getTarget(entry.serverId, entry.targetName) ?? null;
      const settings = this.hostSettings.getSettings(entry.serverId, entry.targetName);
      const date = new Date(entry.lastConnectedAt);
      const fallbackTarget: WarpgateTarget = { name: entry.targetName, description: '', kind: 'Ssh' };

      const item: HistoryItem = {
        entry,
        server,
        target,
        name: settings.alias || entry.targetName,
        icon: getTargetIcon(target ?? fallbackTarget),
        color: settings.color || getTargetColor(target ?? fallbackTarget),
        time: isNaN(date.getTime()) ? '' : formatTime(date),
      };

      const label = isNaN(date.getTime()) ? 'Earlier' : formatDayLabel(date);
      const day = days.find(existing => existing.label === label);
      if (day) {
        day.items.push(item);
      } else {
        days.push({ label, items: [item] });
      }
    }

    this.days = days;
    this.total = entries.length;
  }
}
