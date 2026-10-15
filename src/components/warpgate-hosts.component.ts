/**
 * Warpgate Hosts Component
 * Main panel: hosts from all connected Warpgate servers, snippets and history
 */

import { Component, OnInit, OnDestroy, Inject, ViewChild, ElementRef, HostListener } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppService, NotificationsService } from 'tabby-core';
import { SettingsTabComponent } from 'tabby-settings';

import { WarpgateService } from '../services/warpgate.service';
import { WarpgateHostSettingsService } from '../services/host-settings.service';
import { WarpgateHistoryService } from '../services/history.service';
import { WarpgateConnectionService, WarpgateMultiOpenLayout } from '../services/connection.service';
import {
  WarpgateTarget,
  WarpgateServerConfig,
  WarpgateConnectionStatus,
  WarpgateHostSettings,
  WarpgatePluginConfig,
  WarpgateSnippet,
  getHostKey,
} from '../models/warpgate.models';
import { getBootstrapColor } from '../models/theme.constants';
import { getTargetColor, getTargetIcon } from '../utils/target-appearance';
import { createLogger } from '../utils/debug-logger';
import { isElementActive } from '../utils/dom';
import { WARPGATE_THEME_STYLES } from './shared.styles';

const log = createLogger('HostsComponent');

/** Sections of the panel */
export type WarpgateHostsView = 'hosts' | 'snippets' | 'history';

/** Host item for display */
export interface HostItem {
  key: string;
  server: WarpgateServerConfig;
  target: WarpgateTarget;
  settings: WarpgateHostSettings;
  displayName: string;
  icon: string;
  color: string;
  online: boolean;
  pinned: boolean;
  lastConnectedAt?: number;
  /** Lowercased text used for searching */
  searchText: string;
}

/** Group of hosts */
interface HostGroup {
  key: string;
  name: string;
  color?: string;
  hosts: HostItem[];
  expanded: boolean;
}

/** Server shown in the sidebar */
interface ServerSummary {
  id: string;
  name: string;
  online: boolean;
  enabled: boolean;
  hostCount: number;
}

/**
 * Format a timestamp relative to now ("just now", "5m ago", "3d ago")
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Score how well a host matches a search query (0 = no match)
 * Name matches rank above matches in other fields; recently used hosts get a boost
 */
export function scoreHost(host: HostItem, query: string, now: number = Date.now()): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return 1;
  }

  const name = host.displayName.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const tagTerm = term.startsWith('#') ? term.slice(1) : null;
    if (tagTerm !== null) {
      if (!(host.settings.tags ?? []).some(tag => tag.toLowerCase().startsWith(tagTerm))) {
        return 0;
      }
      score += 40;
    } else if (name === term) {
      score += 120;
    } else if (name.startsWith(term)) {
      score += 90;
    } else if (name.includes(term)) {
      score += 60;
    } else if (host.searchText.includes(term)) {
      score += 25;
    } else {
      return 0;
    }
  }

  if (host.pinned) {
    score += 15;
  }
  if (host.lastConnectedAt) {
    const ageDays = (now - host.lastConnectedAt) / 86400000;
    score += Math.max(0, 30 - ageDays);
  }
  return score;
}

@Component({
  selector: 'warpgate-hosts',
  template: `
    <div class="wg-app">
      <!-- Sidebar -->
      <nav class="sidebar wg-scroll" aria-label="Warpgate navigation">
        <div class="brand">
          <div class="brand-mark"><i class="fas fa-network-wired"></i></div>
          <div class="brand-text">
            <span class="brand-name">Warpgate</span>
            <span class="brand-sub">
              <span class="wg-dot" [class.online]="onlineServerCount > 0" [class.offline]="onlineServerCount === 0 && enabledServerCount > 0"></span>
              {{ onlineServerCount }}/{{ enabledServerCount }} servers online
            </span>
          </div>
        </div>

        <div class="nav-group">
          <button class="nav-item" [class.active]="view === 'hosts'" (click)="setView('hosts')">
            <i class="fas fa-server"></i><span class="label">Hosts</span><span class="count">{{ allHosts.length }}</span>
          </button>
          <button class="nav-item" [class.active]="view === 'snippets'" (click)="setView('snippets')">
            <i class="fas fa-code"></i><span class="label">Snippets</span><span class="count">{{ snippetCount }}</span>
          </button>
          <button class="nav-item" [class.active]="view === 'history'" (click)="setView('history')">
            <i class="fas fa-history"></i><span class="label">History</span>
          </button>
        </div>

        <div class="nav-group" *ngIf="serverSummaries.length > 0">
          <div class="nav-label">Servers</div>
          <button
            class="nav-item"
            *ngFor="let server of serverSummaries"
            [class.active]="serverFilter === server.id"
            [class.disabled]="!server.enabled"
            (click)="toggleServerFilter(server.id)"
            [title]="server.enabled ? (server.online ? 'Online' : 'Offline') : 'Disabled'"
          >
            <span class="wg-dot" [class.online]="server.online" [class.offline]="server.enabled && !server.online"></span>
            <span class="label">{{ server.name }}</span>
            <span class="count">{{ server.hostCount }}</span>
          </button>
        </div>

        <div class="nav-group" *ngIf="tagSummaries.length > 0">
          <div class="nav-label">Tags</div>
          <button
            class="nav-item"
            *ngFor="let tag of tagSummaries"
            [class.active]="tagFilter === tag.name"
            (click)="toggleTagFilter(tag.name)"
          >
            <span class="hash">#</span><span class="label">{{ tag.name }}</span><span class="count">{{ tag.count }}</span>
          </button>
        </div>

        <div class="sidebar-footer">
          <button class="nav-item" (click)="openQuickConnect()" title="Connect to any host from anywhere in Tabby">
            <i class="fas fa-bolt"></i><span class="label">Quick connect</span><span class="wg-kbd">{{ modKey }}⇧K</span>
          </button>
          <button class="nav-item" (click)="openSettings()">
            <i class="fas fa-cog"></i><span class="label">Servers & settings</span>
          </button>
        </div>
      </nav>

      <!-- Main area -->
      <main class="main">
        <header class="topbar">
          <div class="titles">
            <h2>{{ viewTitle }}</h2>
            <p>{{ viewSubtitle }}</p>
          </div>

          <div class="search" *ngIf="view === 'hosts' && hasServers">
            <i class="fas fa-search"></i>
            <input
              #searchInput
              class="wg-input"
              [(ngModel)]="searchQuery"
              (ngModelChange)="filterHosts()"
              (keydown)="onSearchKeyDown($event)"
              placeholder="Search hosts, #tags, notes…"
              aria-label="Search hosts"
            />
            <button class="clear" *ngIf="searchQuery" (click)="clearSearch()" aria-label="Clear search"><i class="fas fa-times-circle"></i></button>
            <span class="wg-kbd" *ngIf="!searchQuery">{{ modKey }}K</span>
          </div>

          <div class="top-actions" *ngIf="view === 'hosts' && hasServers">
            <button
              class="wg-icon-btn"
              [class.active]="selectionMode"
              (click)="toggleSelectionMode()"
              title="Select several hosts"
              aria-label="Select several hosts"
            >
              <i class="far fa-check-square"></i>
            </button>
            <div class="wg-segmented" role="group" aria-label="Layout">
              <button [class.active]="config.viewMode !== 'compact'" (click)="setViewMode('grid')" title="Cards"><i class="fas fa-th-large"></i></button>
              <button [class.active]="config.viewMode === 'compact'" (click)="setViewMode('compact')" title="List"><i class="fas fa-list"></i></button>
            </div>
            <button
              class="wg-icon-btn"
              [class.refreshing]="isRefreshing"
              [class.success]="refreshSuccess"
              (click)="refresh()"
              [disabled]="isRefreshing"
              title="Refresh hosts"
              aria-label="Refresh hosts"
            >
              <i class="fas" [class.fa-sync-alt]="!refreshSuccess" [class.fa-check]="refreshSuccess"></i>
            </button>
          </div>
        </header>

        <div class="banner" *ngIf="view === 'hosts' && disconnectedServers.length > 0">
          <i class="fas fa-plug"></i>
          <span>
            <strong>{{ disconnectedServers.length }} server{{ disconnectedServers.length > 1 ? 's' : '' }} offline</strong>
            <span class="banner-detail">{{ disconnectedServerNames }}</span>
          </span>
          <button class="wg-btn wg-btn-sm" (click)="reconnectAll()"><i class="fas fa-redo"></i> Reconnect</button>
        </div>

        <div class="content wg-scroll" [class.with-action-bar]="selectionMode">
          <ng-container *ngIf="view === 'hosts'">
            <!-- No servers -->
            <div class="wg-empty hero" *ngIf="!hasServers">
              <div class="wg-empty-icon"><i class="fas fa-plug"></i></div>
              <h4>Connect your first Warpgate</h4>
              <p>Add a Warpgate server and every SSH target you can access appears here, ready to open with one click.</p>
              <button class="wg-btn wg-btn-primary" (click)="openSettings()"><i class="fas fa-plus"></i> Add a server</button>
            </div>

            <!-- Loading -->
            <div class="skeleton-grid" *ngIf="hasServers && isLoading && allHosts.length === 0">
              <div class="skeleton" *ngFor="let i of [1, 2, 3, 4, 5, 6]"></div>
            </div>

            <!-- Recent hosts -->
            <section class="recent" *ngIf="recentHosts.length > 0 && !isFiltering">
              <div class="section-head">
                <h3><i class="fas fa-history"></i> Jump back in</h3>
              </div>
              <div class="recent-row">
                <button
                  class="recent-card"
                  *ngFor="let host of recentHosts"
                  [style.--wg-host]="host.color"
                  (click)="onHostClick(host, $event)"
                  [title]="'Connect to ' + host.displayName"
                >
                  <span class="avatar sm"><i [class]="host.icon"></i></span>
                  <span class="recent-text">
                    <span class="recent-name">{{ host.displayName }}</span>
                    <span class="recent-meta">{{ relativeTime(host.lastConnectedAt) }} · {{ host.server.name }}</span>
                  </span>
                  <i class="fas fa-arrow-right go"></i>
                </button>
              </div>
            </section>

            <!-- Active filters -->
            <div class="filters" *ngIf="isFiltering && hasServers">
              <span class="filter-label">Showing {{ visibleCount }} of {{ allHosts.length }}</span>
              <button class="wg-chip active" *ngIf="serverFilter" (click)="serverFilter = null; filterHosts()">
                <i class="fas fa-server"></i> {{ serverName(serverFilter) }} <i class="fas fa-times"></i>
              </button>
              <button class="wg-chip active" *ngIf="tagFilter" (click)="tagFilter = null; filterHosts()">
                #{{ tagFilter }} <i class="fas fa-times"></i>
              </button>
              <button class="wg-btn wg-btn-ghost wg-btn-sm" (click)="clearFilters()">Clear filters</button>
            </div>

            <!-- No results -->
            <div class="wg-empty" *ngIf="hasServers && !isLoading && groups.length === 0">
              <div class="wg-empty-icon"><i class="fas" [class.fa-search]="isFiltering" [class.fa-ghost]="!isFiltering"></i></div>
              <h4>{{ isFiltering ? 'No matching hosts' : 'No hosts yet' }}</h4>
              <p *ngIf="isFiltering">Try another search or clear the filters.</p>
              <p *ngIf="!isFiltering">Your Warpgate servers did not return any SSH targets. Check your roles in Warpgate or reconnect.</p>
            </div>

            <!-- Host groups -->
            <section class="group" *ngFor="let group of groups; trackBy: trackByKey">
              <header class="group-head">
                <button class="group-toggle" (click)="toggleGroup(group)" [attr.aria-expanded]="group.expanded">
                  <i class="fas fa-chevron-right chevron" [class.open]="group.expanded"></i>
                  <span class="group-dot" [style.background]="group.color || 'var(--wg-accent)'"></span>
                  <span class="group-name">{{ group.name }}</span>
                  <span class="group-count">{{ group.hosts.length }}</span>
                </button>
                <div class="group-actions">
                  <button class="wg-btn wg-btn-ghost wg-btn-sm" *ngIf="selectionMode" (click)="selectGroup(group)">
                    <i class="fas fa-check-double"></i> Select group
                  </button>
                </div>
              </header>

              <div class="host-grid" *ngIf="group.expanded && config.viewMode !== 'compact'">
                <article
                  class="host-card"
                  *ngFor="let host of group.hosts; trackBy: trackByKey"
                  [style.--wg-host]="host.color"
                  [class.pinned]="host.pinned"
                  [class.selected]="isSelected(host)"
                  [class.connecting]="isConnecting(host)"
                  [class.offline]="!host.online"
                  tabindex="0"
                  role="button"
                  [attr.aria-label]="(selectionMode ? 'Select ' : 'Connect to ') + host.displayName"
                  (click)="onHostClick(host, $event)"
                  (keydown.enter)="onHostClick(host, $event)"
                >
                  <div class="card-top">
                    <div class="avatar">
                      <i [class]="host.icon"></i>
                      <span class="avatar-status" [class.online]="host.online"></span>
                    </div>
                    <div class="card-title">
                      <div class="host-name" [title]="host.displayName">
                        {{ host.displayName }}<i class="fas fa-star pin-badge" *ngIf="host.pinned" aria-label="Pinned"></i>
                      </div>
                      <div class="host-sub">
                        <span *ngIf="host.settings.alias" class="mono">{{ host.target.name }}</span>
                        <span *ngIf="host.settings.alias" class="sep">·</span>
                        <span>{{ host.server.name }}</span>
                      </div>
                    </div>
                    <div class="card-tools" *ngIf="!selectionMode">
                      <button
                        class="tool pin"
                        [class.on]="host.pinned"
                        (click)="togglePin(host); $event.stopPropagation()"
                        [title]="host.pinned ? 'Unpin' : 'Pin to top'"
                        [attr.aria-label]="host.pinned ? 'Unpin host' : 'Pin host'"
                      ><i class="fas fa-star"></i></button>
                      <button
                        class="tool"
                        (click)="editHost(host); $event.stopPropagation()"
                        title="Edit host settings"
                        aria-label="Edit host settings"
                      ><i class="fas fa-sliders-h"></i></button>
                    </div>
                    <div class="select-box" *ngIf="selectionMode" aria-hidden="true"><i class="fas fa-check"></i></div>
                  </div>

                  <p class="host-desc" *ngIf="host.target.description || host.settings.notes" [title]="host.settings.notes || ''">
                    {{ host.target.description || host.settings.notes }}
                  </p>

                  <div class="card-bottom">
                    <div class="card-tags">
                      <span class="wg-chip tag" *ngFor="let tag of (host.settings.tags || []).slice(0, 3)">#{{ tag }}</span>
                      <span class="more" *ngIf="(host.settings.tags || []).length > 3">+{{ (host.settings.tags || []).length - 3 }}</span>
                    </div>
                    <div class="card-meta">
                      <i class="fas fa-random" *ngIf="host.settings.forwardedPorts?.length" [title]="host.settings.forwardedPorts!.length + ' port forward(s)'"></i>
                      <i class="fas fa-play-circle" *ngIf="host.settings.startupSnippetId" title="Runs a startup snippet"></i>
                      <i class="fas fa-sticky-note" *ngIf="host.settings.notes" [title]="host.settings.notes"></i>
                      <span class="last" *ngIf="host.lastConnectedAt">{{ relativeTime(host.lastConnectedAt) }}</span>
                    </div>
                  </div>

                  <div class="connect-strip" *ngIf="!selectionMode">
                    <i class="fas" [class.fa-bolt]="!isConnecting(host)" [class.fa-circle-notch]="isConnecting(host)" [class.spin]="isConnecting(host)"></i>
                    {{ isConnecting(host) ? 'Connecting…' : 'Connect' }}
                  </div>
                </article>
              </div>

              <div class="host-list" *ngIf="group.expanded && config.viewMode === 'compact'">
                <div
                  class="host-row"
                  *ngFor="let host of group.hosts; trackBy: trackByKey"
                  [style.--wg-host]="host.color"
                  [class.pinned]="host.pinned"
                  [class.selected]="isSelected(host)"
                  [class.connecting]="isConnecting(host)"
                  tabindex="0"
                  role="button"
                  [attr.aria-label]="(selectionMode ? 'Select ' : 'Connect to ') + host.displayName"
                  (click)="onHostClick(host, $event)"
                  (keydown.enter)="onHostClick(host, $event)"
                >
                  <div class="select-box" *ngIf="selectionMode" aria-hidden="true"><i class="fas fa-check"></i></div>
                  <span class="avatar sm"><i [class]="host.icon"></i></span>
                  <div class="row-main">
                    <span class="host-name">{{ host.displayName }}</span>
                    <span class="host-sub">
                      <span *ngIf="host.settings.alias" class="mono">{{ host.target.name }} ·</span>
                      {{ host.target.description || host.server.name }}
                    </span>
                  </div>
                  <div class="row-tags">
                    <span class="wg-chip tag" *ngFor="let tag of (host.settings.tags || []).slice(0, 2)">#{{ tag }}</span>
                  </div>
                  <span class="row-server"><span class="wg-dot" [class.online]="host.online" [class.offline]="!host.online"></span>{{ host.server.name }}</span>
                  <span class="last">{{ host.lastConnectedAt ? relativeTime(host.lastConnectedAt) : '' }}</span>
                  <div class="row-tools" *ngIf="!selectionMode">
                    <button class="tool pin" [class.on]="host.pinned" (click)="togglePin(host); $event.stopPropagation()" [title]="host.pinned ? 'Unpin' : 'Pin to top'"><i class="fas fa-star"></i></button>
                    <button class="tool" (click)="editHost(host); $event.stopPropagation()" title="Edit host settings"><i class="fas fa-sliders-h"></i></button>
                    <button class="tool connect" (click)="connectHost(host.server, host.target); $event.stopPropagation()" title="Connect">
                      <i class="fas" [class.fa-bolt]="!isConnecting(host)" [class.fa-circle-notch]="isConnecting(host)" [class.spin]="isConnecting(host)"></i>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </ng-container>

          <warpgate-snippets *ngIf="view === 'snippets'" (runOnHosts)="startSnippetRun($event)"></warpgate-snippets>
          <warpgate-history *ngIf="view === 'history'" (connect)="connectHost($event.server, $event.target)"></warpgate-history>
        </div>

        <!-- Selection action bar -->
        <div class="action-bar" *ngIf="selectionMode && view === 'hosts'">
          <div class="selection-info">
            <span class="count-badge">{{ selectedKeys.size }}</span>
            <span class="selection-text">
              <strong>{{ selectedKeys.size === 1 ? 'host' : 'hosts' }} selected</strong>
              <span *ngIf="pendingSnippet" class="pending"><i class="fas fa-play"></i> {{ pendingSnippet.name }}</span>
            </span>
          </div>
          <div class="wg-segmented" role="group" aria-label="Open as">
            <button [class.active]="multiLayout === 'tabs'" (click)="multiLayout = 'tabs'" title="One tab per host"><i class="far fa-window-restore"></i> Tabs</button>
            <button [class.active]="multiLayout === 'split'" (click)="multiLayout = 'split'" title="All hosts side by side in one tab"><i class="fas fa-border-all"></i> Split</button>
          </div>
          <button class="wg-btn wg-btn-ghost" (click)="selectAllVisible()">Select all</button>
          <button class="wg-btn wg-btn-ghost" (click)="exitSelectionMode()">Cancel</button>
          <button class="wg-btn wg-btn-primary" (click)="openSelected()" [disabled]="selectedKeys.size === 0 || openingSelection">
            <i class="fas" [class.fa-bolt]="!pendingSnippet" [class.fa-play]="pendingSnippet"></i>
            {{ pendingSnippet ? 'Connect & run' : 'Open ' + (selectedKeys.size || '') }}
          </button>
        </div>
      </main>

      <!-- Command palette -->
      <div class="palette-backdrop" *ngIf="showQuickSearch" (click)="closeQuickSearch()">
        <div class="palette" (click)="$event.stopPropagation()" role="dialog" aria-label="Quick search">
          <div class="palette-input">
            <i class="fas fa-search"></i>
            <input
              #quickSearchInput
              type="text"
              [(ngModel)]="quickSearchQuery"
              (ngModelChange)="filterQuickSearch()"
              (keydown)="onQuickSearchKeyDown($event)"
              placeholder="Jump to a host…"
              aria-label="Jump to a host"
            />
            <span class="wg-kbd">esc</span>
          </div>
          <div class="palette-results wg-scroll">
            <div
              class="palette-item"
              *ngFor="let host of quickSearchResults; let i = index"
              [class.selected]="i === quickSearchSelectedIndex"
              [style.--wg-host]="host.color"
              (click)="connectFromQuickSearch(host)"
              (mouseenter)="quickSearchSelectedIndex = i"
            >
              <span class="avatar sm"><i [class]="host.icon"></i></span>
              <div class="palette-text">
                <div class="palette-name">
                  <i class="fas fa-star pinned" *ngIf="host.pinned"></i>
                  {{ host.displayName }}
                </div>
                <div class="palette-meta">
                  {{ host.server.name }}<span *ngIf="host.target.description"> · {{ host.target.description }}</span>
                  <span class="palette-tag" *ngFor="let tag of (host.settings.tags || []).slice(0, 3)">#{{ tag }}</span>
                </div>
              </div>
              <span class="palette-right">{{ host.lastConnectedAt ? relativeTime(host.lastConnectedAt) : '' }}</span>
              <i class="fas fa-level-down-alt fa-rotate-90 enter-hint"></i>
            </div>
            <div class="palette-empty" *ngIf="quickSearchResults.length === 0">
              <i class="fas fa-search"></i> No hosts match “{{ quickSearchQuery }}”
            </div>
          </div>
          <div class="palette-footer">
            <span><span class="wg-kbd">↑</span><span class="wg-kbd">↓</span> navigate</span>
            <span><span class="wg-kbd">↵</span> connect</span>
            <span><span class="wg-kbd">#</span> filter by tag</span>
          </div>
        </div>
      </div>

      <warpgate-host-editor
        *ngIf="editingHost"
        [server]="editingHost.server"
        [target]="editingHost.target"
        (closed)="editingHost = null"
      ></warpgate-host-editor>
    </div>
  `,
  styles: [WARPGATE_THEME_STYLES, `
    :host { display: block; height: 100%; }
    .wg-app {
      display: flex; height: 100%; min-height: 0; overflow: hidden;
      background:
        radial-gradient(900px 420px at 100% -10%, color-mix(in srgb, var(--wg-accent) 9%, transparent), transparent 70%),
        radial-gradient(700px 380px at -10% 110%, color-mix(in srgb, var(--wg-accent-2) 7%, transparent), transparent 70%),
        var(--wg-bg);
      font-size: 13px;
    }

    /* Sidebar */
    .sidebar {
      width: 236px; flex-shrink: 0; display: flex; flex-direction: column; gap: 18px; padding: 18px 12px;
      border-right: 1px solid var(--wg-border);
      background: color-mix(in srgb, var(--wg-surface) 70%, transparent);
    }
    .brand { display: flex; align-items: center; gap: 12px; padding: 2px 6px 6px; }
    .brand-mark {
      width: 40px; height: 40px; border-radius: 13px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      background: var(--wg-gradient); color: var(--wg-accent-fg); font-size: 16px;
      box-shadow: 0 10px 28px -10px var(--wg-accent), inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }
    .brand-text { display: flex; flex-direction: column; min-width: 0; }
    .brand-name { font-size: 16px; font-weight: 800; letter-spacing: -0.02em; }
    .brand-sub { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--wg-subtle); }
    .brand-sub .wg-dot { width: 6px; height: 6px; box-shadow: none; }

    .nav-group { display: flex; flex-direction: column; gap: 2px; }
    .nav-label { padding: 0 10px 6px; font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--wg-subtle); }
    .nav-item {
      display: flex; align-items: center; gap: 10px; width: 100%; height: 34px; padding: 0 10px;
      border: 0; border-radius: 9px; background: transparent; color: var(--wg-muted);
      font-size: 13px; font-weight: 600; text-align: left; cursor: pointer;
      transition: background 0.15s var(--wg-ease), color 0.15s var(--wg-ease);
    }
    .nav-item i { width: 16px; text-align: center; font-size: 13px; }
    .nav-item .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nav-item .count { font-size: 11px; font-weight: 700; color: var(--wg-subtle); font-variant-numeric: tabular-nums; }
    .nav-item .hash { width: 16px; text-align: center; color: var(--wg-accent); font-weight: 800; }
    .nav-item:hover { background: var(--wg-surface-2); color: var(--wg-fg); }
    .nav-item.active { background: var(--wg-accent-soft); color: var(--wg-fg); }
    .nav-item.active i, .nav-item.active .count { color: var(--wg-accent); }
    .nav-item.disabled { opacity: 0.5; }
    .nav-item .wg-dot { margin: 0 4px; width: 7px; height: 7px; }
    .sidebar-footer { margin-top: auto; display: flex; flex-direction: column; gap: 2px; padding-top: 12px; border-top: 1px solid var(--wg-border); }

    /* Main */
    .main { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .topbar { display: flex; align-items: center; gap: 16px; padding: 18px 24px 14px; }
    .titles { flex-shrink: 0; min-width: 0; }
    .titles h2 { margin: 0; font-size: 21px; font-weight: 800; letter-spacing: -0.025em; }
    .titles p { margin: 2px 0 0; font-size: 12px; color: var(--wg-subtle); }
    .search { position: relative; flex: 1; max-width: 520px; margin-left: auto; }
    .search > i { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: var(--wg-subtle); font-size: 12px; pointer-events: none; }
    .search .wg-input { height: 38px; padding-left: 36px; padding-right: 64px; border-radius: 12px; background: var(--wg-surface); }
    .search .wg-kbd, .search .clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); }
    .search .clear { border: 0; background: transparent; color: var(--wg-subtle); cursor: pointer; font-size: 14px; }
    .search .clear:hover { color: var(--wg-fg); }
    .top-actions { display: flex; align-items: center; gap: 8px; }
    .top-actions .wg-segmented button { width: 32px; padding: 0; }
    .wg-icon-btn.refreshing i { animation: wg-spin 0.9s linear infinite; }
    .wg-icon-btn.success { color: var(--wg-success); }

    .banner {
      display: flex; align-items: center; gap: 12px; margin: 0 24px 10px; padding: 10px 12px 10px 14px;
      border-radius: 12px; border: 1px solid color-mix(in srgb, var(--wg-danger) 35%, transparent);
      background: color-mix(in srgb, var(--wg-danger) 9%, transparent);
      color: var(--wg-fg); font-size: 13px;
    }
    .banner > i { color: var(--wg-danger); }
    .banner > span { flex: 1; min-width: 0; display: flex; gap: 8px; white-space: nowrap; overflow: hidden; }
    .banner-detail { color: var(--wg-muted); overflow: hidden; text-overflow: ellipsis; }

    .content { flex: 1; min-height: 0; padding: 4px 24px 32px; }
    .content.with-action-bar { padding-bottom: 96px; }

    .section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .section-head h3 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--wg-subtle); }
    .section-head h3 i { color: var(--wg-accent); }

    /* Recent */
    .recent { margin: 6px 0 22px; }
    .recent-row {
      display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 6px; margin: -2px -2px 0;
      scrollbar-width: none;
      -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 48px), transparent);
      mask-image: linear-gradient(90deg, #000 calc(100% - 48px), transparent);
    }
    .recent-row::-webkit-scrollbar { display: none; }
    .recent-card {
      flex: 1 0 210px; max-width: 280px;
      display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px 12px;
      border-radius: 14px; border: 1px solid var(--wg-border); color: var(--wg-fg); text-align: left; cursor: pointer;
      background: linear-gradient(120deg, color-mix(in srgb, var(--wg-host) 10%, var(--wg-surface)), var(--wg-surface) 65%);
      transition: transform 0.2s var(--wg-ease), border-color 0.2s var(--wg-ease), box-shadow 0.2s var(--wg-ease);
      animation: wg-rise 0.3s var(--wg-ease) both;
    }
    .recent-card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--wg-host) 50%, transparent); box-shadow: 0 12px 28px -18px var(--wg-host); }
    .recent-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .recent-name { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .recent-meta { font-size: 11.5px; color: var(--wg-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .recent-card .go { font-size: 11px; color: var(--wg-subtle); opacity: 0; transform: translateX(-4px); transition: all 0.2s var(--wg-ease); }
    .recent-card:hover .go { opacity: 1; transform: none; color: var(--wg-host); }

    /* Filters */
    .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 2px 0 16px; }
    .filter-label { font-size: 12px; color: var(--wg-subtle); margin-right: 4px; }
    .filters .wg-chip { height: 26px; padding: 0 11px; }

    /* Groups */
    .group { margin-bottom: 22px; }
    .group-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .group-toggle {
      display: inline-flex; align-items: center; gap: 10px; padding: 4px 8px 4px 2px; border: 0; background: transparent;
      color: var(--wg-fg); cursor: pointer; border-radius: 8px;
    }
    .group-toggle:hover .group-name { color: var(--wg-fg); }
    .chevron { font-size: 10px; color: var(--wg-subtle); transition: transform 0.2s var(--wg-ease); }
    .chevron.open { transform: rotate(90deg); }
    .group-dot { width: 8px; height: 8px; border-radius: 3px; }
    .group-name { font-size: 13px; font-weight: 750; color: var(--wg-muted); letter-spacing: -0.005em; }
    .group-count {
      min-width: 22px; height: 20px; padding: 0 7px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
      background: var(--wg-surface-2); color: var(--wg-subtle); font-size: 11px; font-weight: 700;
    }

    /* Avatar */
    .avatar {
      position: relative; width: 42px; height: 42px; border-radius: 13px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; color: #fff; font-size: 16px;
      background: linear-gradient(140deg, color-mix(in srgb, var(--wg-host) 88%, #fff), color-mix(in srgb, var(--wg-host) 70%, #000));
      box-shadow: 0 8px 20px -12px var(--wg-host), inset 0 1px 0 rgba(255, 255, 255, 0.28);
    }
    .avatar.sm { width: 30px; height: 30px; border-radius: 9px; font-size: 12px; }
    .avatar-status {
      position: absolute; right: -3px; bottom: -3px; width: 12px; height: 12px; border-radius: 50%;
      background: var(--wg-subtle); border: 2.5px solid var(--wg-bg);
    }
    .avatar-status.online { background: var(--wg-success); }

    /* Host cards */
    .host-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(258px, 1fr)); gap: 12px; }
    .host-card {
      position: relative; display: flex; flex-direction: column; gap: 10px; min-height: 132px; padding: 14px 14px 12px;
      border-radius: var(--wg-radius-lg); border: 1px solid var(--wg-border); overflow: hidden; cursor: pointer; outline: none;
      background:
        radial-gradient(140% 90% at 0% 0%, color-mix(in srgb, var(--wg-host) 13%, transparent), transparent 55%),
        var(--wg-surface);
      transition: transform 0.22s var(--wg-ease), border-color 0.22s var(--wg-ease), box-shadow 0.22s var(--wg-ease);
      animation: wg-rise 0.32s var(--wg-ease) both;
    }
    .host-card:hover, .host-card:focus-visible {
      transform: translateY(-3px);
      border-color: color-mix(in srgb, var(--wg-host) 55%, var(--wg-border));
      box-shadow: 0 18px 40px -24px var(--wg-host), var(--wg-shadow);
    }
    .host-card:focus-visible { box-shadow: 0 0 0 3px var(--wg-accent-ring); }
    .host-card.pinned::after {
      content: ''; position: absolute; left: 14px; right: 14px; top: 0; height: 2px; border-radius: 0 0 2px 2px;
      background: linear-gradient(90deg, var(--wg-star), color-mix(in srgb, var(--wg-star) 30%, transparent));
    }
    .host-card.offline { opacity: 0.72; }
    .host-card.connecting { pointer-events: none; }
    .host-card.selected { border-color: var(--wg-accent); box-shadow: 0 0 0 1px var(--wg-accent), 0 18px 40px -26px var(--wg-accent); }

    .card-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .card-title { flex: 1; min-width: 0; }
    .host-name { font-size: 14.5px; font-weight: 750; letter-spacing: -0.012em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .host-sub { display: flex; gap: 5px; font-size: 12px; color: var(--wg-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .host-sub .sep { opacity: 0.6; }
    .mono { font-family: var(--wg-mono); font-size: 11.5px; }

    .card-tools, .row-tools { display: flex; gap: 2px; }
    .card-tools {
      position: absolute; top: 10px; right: 10px; z-index: 2; padding: 3px; border-radius: 11px;
      background: color-mix(in srgb, var(--wg-bg) 78%, transparent); backdrop-filter: blur(8px);
      border: 1px solid var(--wg-border); box-shadow: var(--wg-shadow-sm);
      opacity: 0; transform: translateY(-3px); transition: opacity 0.18s var(--wg-ease), transform 0.18s var(--wg-ease);
    }
    .host-card:hover .card-tools, .host-card:focus-within .card-tools { opacity: 1; transform: none; }
    .card-tools .tool { opacity: 1; }
    .pin-badge { margin-left: 6px; font-size: 10px; color: var(--wg-star); vertical-align: 2px; }
    .tool {
      width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--wg-subtle);
      display: inline-flex; align-items: center; justify-content: center; font-size: 12px; cursor: pointer;
      opacity: 0; transition: opacity 0.15s var(--wg-ease), background 0.15s var(--wg-ease), color 0.15s var(--wg-ease);
    }
    .tool:hover { background: var(--wg-surface-3); color: var(--wg-fg); }
    .tool.pin:hover, .tool.pin.on { color: var(--wg-star); }
    .tool.pin.on { opacity: 1; }
    .host-card:hover .tool, .host-card:focus-within .tool, .host-row:hover .tool, .host-row:focus-within .tool { opacity: 1; }

    .select-box {
      width: 22px; height: 22px; border-radius: 7px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      border: 2px solid var(--wg-border-strong); color: transparent; font-size: 11px; transition: all 0.15s var(--wg-ease);
    }
    .selected .select-box { background: var(--wg-accent); border-color: var(--wg-accent); color: var(--wg-accent-fg); }

    .host-desc {
      margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--wg-muted);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .card-bottom { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; }
    .card-tags { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; }
    .wg-chip.tag { background: color-mix(in srgb, var(--wg-host) 12%, transparent); border-color: transparent; color: color-mix(in srgb, var(--wg-host) 70%, var(--wg-fg)); }
    .more { font-size: 11px; color: var(--wg-subtle); }
    .card-meta { display: flex; align-items: center; gap: 9px; flex-shrink: 0; color: var(--wg-subtle); font-size: 11px; }
    .card-meta i { font-size: 11px; }
    .last { font-size: 11px; color: var(--wg-subtle); font-variant-numeric: tabular-nums; white-space: nowrap; }

    .connect-strip {
      position: absolute; left: 0; right: 0; bottom: 0; height: 34px; display: flex; align-items: center; justify-content: center; gap: 8px;
      background: linear-gradient(90deg, color-mix(in srgb, var(--wg-host) 92%, #000), color-mix(in srgb, var(--wg-host) 70%, var(--wg-accent-2)));
      color: #fff; font-size: 12.5px; font-weight: 700; letter-spacing: 0.01em;
      transform: translateY(100%); transition: transform 0.22s var(--wg-ease);
    }
    .host-card:hover .connect-strip, .host-card:focus-visible .connect-strip, .host-card.connecting .connect-strip { transform: none; }
    .spin { animation: wg-spin 0.9s linear infinite; }

    /* Host rows */
    .host-list { display: flex; flex-direction: column; gap: 4px; }
    .host-row {
      display: flex; align-items: center; gap: 12px; height: 50px; padding: 0 10px 0 12px;
      border-radius: 12px; border: 1px solid transparent; cursor: pointer; outline: none;
      transition: background 0.15s var(--wg-ease), border-color 0.15s var(--wg-ease);
    }
    .host-row:hover, .host-row:focus-visible { background: var(--wg-surface-2); border-color: var(--wg-border); }
    .host-row.selected { background: var(--wg-accent-softer); border-color: var(--wg-accent-ring); }
    .row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .row-main .host-name { font-size: 13.5px; }
    .row-tags { display: flex; gap: 5px; }
    .row-server { display: flex; align-items: center; gap: 7px; width: 150px; font-size: 12px; color: var(--wg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row-server .wg-dot { width: 7px; height: 7px; box-shadow: none; }
    .host-row .last { width: 64px; text-align: right; }
    .tool.connect { opacity: 1; color: var(--wg-host); }
    .tool.connect:hover { background: color-mix(in srgb, var(--wg-host) 18%, transparent); color: var(--wg-host); }

    /* Skeleton */
    .skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(258px, 1fr)); gap: 12px; margin-top: 8px; }
    .skeleton {
      height: 132px; border-radius: var(--wg-radius-lg); border: 1px solid var(--wg-border);
      background: linear-gradient(100deg, var(--wg-surface) 30%, var(--wg-surface-2) 50%, var(--wg-surface) 70%);
      background-size: 300% 100%; animation: wg-shimmer 1.4s ease-in-out infinite;
    }
    @keyframes wg-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }

    .wg-empty.hero { padding-top: 12vh; }

    /* Action bar */
    .action-bar {
      position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 20;
      display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; max-width: calc(100% - 32px);
      border-radius: 16px; border: 1px solid var(--wg-border-strong);
      background: color-mix(in srgb, var(--wg-bg) 88%, transparent); backdrop-filter: blur(14px);
      box-shadow: var(--wg-shadow-lg); animation: wg-rise 0.25s var(--wg-ease);
    }
    .selection-info { display: flex; align-items: center; gap: 10px; margin-right: 6px; min-width: 0; }
    .count-badge {
      min-width: 28px; height: 28px; padding: 0 8px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center;
      background: var(--wg-gradient); color: var(--wg-accent-fg); font-weight: 800; font-variant-numeric: tabular-nums;
    }
    .selection-text { display: flex; flex-direction: column; line-height: 1.25; white-space: nowrap; }
    .selection-text .pending { font-size: 11.5px; color: var(--wg-accent); overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
    .action-bar .wg-segmented button { display: inline-flex; align-items: center; gap: 6px; }

    /* Command palette */
    .palette-backdrop {
      position: fixed; inset: 0; z-index: 1060; display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh;
      background: color-mix(in srgb, #000 50%, transparent); backdrop-filter: blur(4px); animation: wg-fade-in 0.15s var(--wg-ease);
    }
    .palette {
      width: min(620px, calc(100vw - 32px)); border-radius: 18px; overflow: hidden;
      border: 1px solid var(--wg-border-strong); background: var(--wg-bg); box-shadow: var(--wg-shadow-lg);
      animation: wg-pop-in 0.18s var(--wg-ease);
    }
    .palette-input { display: flex; align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--wg-border); }
    .palette-input i { color: var(--wg-accent); }
    .palette-input input { flex: 1; border: 0; outline: none; background: transparent; color: var(--wg-fg); font-size: 16px; }
    .palette-input input::placeholder { color: var(--wg-subtle); }
    .palette-results { max-height: 380px; padding: 6px; }
    .palette-item { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 11px; cursor: pointer; }
    .palette-item.selected { background: var(--wg-accent-soft); }
    .palette-text { flex: 1; min-width: 0; }
    .palette-name { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 700; }
    .palette-name .pinned { color: var(--wg-star); font-size: 10px; }
    .palette-meta { font-size: 12px; color: var(--wg-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .palette-tag { margin-left: 6px; color: var(--wg-accent); }
    .palette-right { font-size: 11px; color: var(--wg-subtle); }
    .enter-hint { color: var(--wg-subtle); font-size: 11px; opacity: 0; }
    .palette-item.selected .enter-hint { opacity: 1; }
    .palette-empty { padding: 28px; text-align: center; color: var(--wg-subtle); }
    .palette-footer { display: flex; gap: 18px; padding: 10px 18px; border-top: 1px solid var(--wg-border); background: var(--wg-surface); font-size: 11.5px; color: var(--wg-subtle); }
    .palette-footer .wg-kbd { margin-right: 4px; }

    @media (max-width: 900px) {
      .sidebar { width: 64px; padding: 14px 8px; }
      .brand-text, .nav-item .label, .nav-item .count, .nav-label, .nav-item .wg-kbd { display: none; }
      .nav-item { justify-content: center; padding: 0; }
      .row-server, .row-tags { display: none; }
      .titles p { display: none; }
    }
  `],
})
export class WarpgateHostsComponent implements OnInit, OnDestroy {
  @ViewChild('quickSearchInput') quickSearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  view: WarpgateHostsView = 'hosts';
  groups: HostGroup[] = [];
  allHosts: HostItem[] = [];
  recentHosts: HostItem[] = [];
  serverSummaries: ServerSummary[] = [];
  tagSummaries: Array<{ name: string; count: number }> = [];
  searchQuery = '';
  serverFilter: string | null = null;
  tagFilter: string | null = null;
  visibleCount = 0;
  isLoading = false;
  isRefreshing = false;
  refreshSuccess = false;
  hasServers = false;
  snippetCount = 0;
  disconnectedServers: WarpgateServerConfig[] = [];
  config: WarpgatePluginConfig;
  editingHost: HostItem | null = null;
  readonly modKey = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';

  // Selection
  selectionMode = false;
  selectedKeys = new Set<string>();
  multiLayout: WarpgateMultiOpenLayout = 'tabs';
  pendingSnippet: WarpgateSnippet | null = null;
  openingSelection = false;

  // Quick search state
  showQuickSearch = false;
  quickSearchQuery = '';
  quickSearchResults: HostItem[] = [];
  quickSearchSelectedIndex = 0;

  private connectingKeys = new Set<string>();
  private collapsedGroups = new Set<string>();
  private connectionStatus = new Map<string, WarpgateConnectionStatus>();
  private subscriptions: Subscription[] = [];

  constructor(
    @Inject(WarpgateService) private warpgateService: WarpgateService,
    @Inject(WarpgateHostSettingsService) private hostSettings: WarpgateHostSettingsService,
    @Inject(WarpgateHistoryService) private history: WarpgateHistoryService,
    @Inject(WarpgateConnectionService) private connection: WarpgateConnectionService,
    @Inject(AppService) private app: AppService,
    @Inject(NotificationsService) private notifications: NotificationsService,
    @Inject(ElementRef) private element: ElementRef<HTMLElement>
  ) {
    this.config = this.warpgateService.getConfig();
  }

  ngOnInit(): void {
    this.subscriptions.push(
      this.warpgateService.targets$.subscribe(() => this.loadHosts()),
      this.warpgateService.status$.subscribe(status => {
        this.connectionStatus = status;
        this.loadHosts();
      }),
      this.warpgateService.loading$.subscribe(loading => {
        this.isLoading = loading;
      }),
      this.warpgateService.events$.subscribe(event => {
        if (event && ['server-added', 'server-removed', 'server-updated'].includes(event.type)) {
          this.loadHosts();
        }
      }),
      this.hostSettings.changes$.subscribe(() => this.loadHosts()),
      this.history.changes$.subscribe(() => this.loadHosts())
    );

    // Connect servers that are not connected yet (e.g. right after startup)
    this.connectServersAndLoad();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  /**
   * Connect to all enabled servers and load hosts
   */
  private async connectServersAndLoad(): Promise<void> {
    const servers = this.warpgateService.getServers().filter(s => s.enabled);
    await Promise.all(
      servers.map(async server => {
        if (!this.warpgateService.isConnected(server.id)) {
          try {
            await this.warpgateService.connect(server.id);
          } catch {
            // Connection errors are handled by the service
          }
        }
      })
    );
    this.loadHosts();
  }

  // ==================== Data ====================

  /**
   * Build host items from the service state
   */
  loadHosts(): void {
    this.config = this.warpgateService.getConfig();
    const servers = this.warpgateService.getServers();
    this.hasServers = servers.length > 0;
    this.snippetCount = (this.config.snippets ?? []).length;

    const pinned = new Set(this.config.pinnedHosts ?? []);
    const lastConnected = this.history.getLastConnectedMap();
    const showOffline = this.config.showOfflineServers !== false;

    this.allHosts = this.warpgateService.getAllTargets()
      .filter(({ server }) => showOffline || this.isServerConnected(server.id))
      .map(({ server, target }) => this.createHostItem(server, target, pinned, lastConnected));

    const hostCounts = new Map<string, number>();
    for (const host of this.allHosts) {
      hostCounts.set(host.server.id, (hostCounts.get(host.server.id) ?? 0) + 1);
    }
    this.serverSummaries = servers.map(server => ({
      id: server.id,
      name: server.name,
      enabled: server.enabled,
      online: this.isServerConnected(server.id),
      hostCount: hostCounts.get(server.id) ?? 0,
    }));
    if (this.serverFilter && !servers.some(server => server.id === this.serverFilter)) {
      this.serverFilter = null;
    }

    const tagCounts = new Map<string, { name: string; count: number }>();
    for (const host of this.allHosts) {
      for (const tag of host.settings.tags ?? []) {
        const entry = tagCounts.get(tag.toLowerCase()) ?? { name: tag, count: 0 };
        entry.count++;
        tagCounts.set(tag.toLowerCase(), entry);
      }
    }
    this.tagSummaries = Array.from(tagCounts.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (this.tagFilter && !tagCounts.has(this.tagFilter.toLowerCase())) {
      this.tagFilter = null;
    }

    const hostsByKey = new Map(this.allHosts.map(host => [host.key, host]));
    this.recentHosts = this.history.getRecent(12)
      .map(entry => hostsByKey.get(getHostKey(entry.serverId, entry.targetName)))
      .filter((host): host is HostItem => !!host)
      .slice(0, 6);

    // Forget selections of hosts that disappeared
    for (const key of Array.from(this.selectedKeys)) {
      if (!hostsByKey.has(key)) {
        this.selectedKeys.delete(key);
      }
    }

    this.updateDisconnectedServers();
    this.filterHosts();
    if (this.showQuickSearch) {
      this.filterQuickSearch(false);
    }
  }

  private createHostItem(
    server: WarpgateServerConfig,
    target: WarpgateTarget,
    pinned: Set<string>,
    lastConnected: Map<string, number>
  ): HostItem {
    const key = getHostKey(server.id, target.name);
    const settings = this.hostSettings.getSettings(server.id, target.name);
    const displayName = settings.alias || target.name;
    return {
      key,
      server,
      target,
      settings,
      displayName,
      icon: getTargetIcon(target),
      color: settings.color || getTargetColor(target),
      online: this.isServerConnected(server.id),
      pinned: pinned.has(key),
      lastConnectedAt: lastConnected.get(key),
      searchText: [
        displayName,
        target.name,
        target.description,
        server.name,
        target.group?.name,
        settings.notes,
        ...(settings.tags ?? []),
      ].filter(Boolean).join(' ').toLowerCase(),
    };
  }

  get isFiltering(): boolean {
    return !!(this.searchQuery.trim() || this.serverFilter || this.tagFilter);
  }

  get onlineServerCount(): number {
    return this.serverSummaries.filter(server => server.enabled && server.online).length;
  }

  get enabledServerCount(): number {
    return this.serverSummaries.filter(server => server.enabled).length;
  }

  get disconnectedServerNames(): string {
    return this.disconnectedServers.map(server => server.name).join(', ');
  }

  get viewTitle(): string {
    return { hosts: 'Hosts', snippets: 'Snippets', history: 'History' }[this.view];
  }

  get viewSubtitle(): string {
    if (this.view === 'snippets') {
      return 'Reusable commands for any session';
    }
    if (this.view === 'history') {
      return 'Your recent connections';
    }
    if (!this.hasServers) {
      return 'No servers configured';
    }
    return `${this.allHosts.length} host${this.allHosts.length === 1 ? '' : 's'} across ${this.enabledServerCount} server${this.enabledServerCount === 1 ? '' : 's'}`;
  }

  /**
   * Filter, sort and group hosts
   */
  filterHosts(): void {
    const query = this.searchQuery.trim();
    let hosts = this.allHosts;

    if (this.serverFilter) {
      hosts = hosts.filter(host => host.server.id === this.serverFilter);
    }
    if (this.tagFilter) {
      const tag = this.tagFilter.toLowerCase();
      hosts = hosts.filter(host => (host.settings.tags ?? []).some(t => t.toLowerCase() === tag));
    }

    if (query) {
      const now = Date.now();
      const scored = hosts
        .map(host => ({ host, score: scoreHost(host, query, now) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.host.displayName.localeCompare(b.host.displayName));
      this.visibleCount = scored.length;
      this.groups = scored.length
        ? [{ key: '__results__', name: 'Best matches', hosts: scored.map(entry => entry.host), expanded: true }]
        : [];
      return;
    }

    hosts = this.sortHosts(hosts);
    this.visibleCount = hosts.length;
    this.groups = this.groupHosts(hosts);
  }

  /**
   * Sort hosts based on configuration (pinned hosts first)
   */
  private sortHosts(hosts: HostItem[]): HostItem[] {
    return [...hosts].sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }

      switch (this.config.sortBy) {
        case 'server':
          return a.server.name.localeCompare(b.server.name) || a.displayName.localeCompare(b.displayName);
        case 'kind':
          return a.target.kind.localeCompare(b.target.kind) || a.displayName.localeCompare(b.displayName);
        case 'group':
          return (a.target.group?.name || '').localeCompare(b.target.group?.name || '') || a.displayName.localeCompare(b.displayName);
        case 'recent':
          return (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0) || a.displayName.localeCompare(b.displayName);
        case 'name':
        default:
          return a.displayName.localeCompare(b.displayName);
      }
    });
  }

  /**
   * Group hosts based on configuration
   */
  private groupHosts(hosts: HostItem[]): HostGroup[] {
    const groupMap = new Map<string, HostGroup>();
    const pinnedHosts = hosts.filter(host => host.pinned);
    const others = hosts.filter(host => !host.pinned);

    if (pinnedHosts.length > 0) {
      groupMap.set('__pinned__', {
        key: '__pinned__',
        name: 'Pinned',
        color: 'var(--wg-star)',
        hosts: pinnedHosts,
        expanded: !this.collapsedGroups.has('__pinned__'),
      });
    }

    for (const host of others) {
      let groupKey: string;
      let groupName: string;
      let groupColor: string | undefined;

      if (this.config.groupByServer) {
        if (host.target.group) {
          groupKey = `${host.server.id}:${host.target.group.name}`;
          groupName = `${host.server.name} / ${host.target.group.name}`;
          groupColor = getBootstrapColor(host.target.group.color);
        } else {
          groupKey = host.server.id;
          groupName = host.server.name;
        }
      } else if (host.target.group) {
        groupKey = `group:${host.target.group.name}`;
        groupName = host.target.group.name;
        groupColor = getBootstrapColor(host.target.group.color);
      } else {
        groupKey = '__ungrouped__';
        groupName = 'Ungrouped';
      }

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          key: groupKey,
          name: groupName,
          color: groupColor,
          hosts: [],
          expanded: !this.collapsedGroups.has(groupKey),
        });
      }
      groupMap.get(groupKey)!.hosts.push(host);
    }

    return Array.from(groupMap.values()).sort((a, b) => {
      if (a.key === '__pinned__') return -1;
      if (b.key === '__pinned__') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  trackByKey(_index: number, item: { key: string }): string {
    return item.key;
  }

  /**
   * Toggle group expansion (remembered across refreshes)
   */
  toggleGroup(group: HostGroup): void {
    group.expanded = !group.expanded;
    if (group.expanded) {
      this.collapsedGroups.delete(group.key);
    } else {
      this.collapsedGroups.add(group.key);
    }
  }

  // ==================== Navigation & filters ====================

  setView(view: WarpgateHostsView): void {
    this.view = view;
    if (view !== 'hosts') {
      this.closeQuickSearch();
    }
  }

  toggleServerFilter(serverId: string): void {
    this.view = 'hosts';
    this.serverFilter = this.serverFilter === serverId ? null : serverId;
    this.filterHosts();
  }

  toggleTagFilter(tag: string): void {
    this.view = 'hosts';
    this.tagFilter = this.tagFilter === tag ? null : tag;
    this.filterHosts();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.filterHosts();
    this.searchInput?.nativeElement.focus();
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.serverFilter = null;
    this.tagFilter = null;
    this.filterHosts();
  }

  serverName(serverId: string): string {
    return this.warpgateService.getServer(serverId)?.name ?? serverId;
  }

  onSearchKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.searchQuery) {
        event.preventDefault();
        this.clearSearch();
      }
    } else if (event.key === 'Enter') {
      const first = this.groups[0]?.hosts[0];
      if (first) {
        event.preventDefault();
        this.onHostClick(first, event);
      }
    }
  }

  // ==================== Connections ====================

  isConnecting(host: HostItem): boolean {
    return this.connectingKeys.has(host.key);
  }

  /**
   * Click on a host: connect, or toggle selection in selection mode
   * Ctrl/Cmd-click starts selecting several hosts
   */
  onHostClick(host: HostItem, event?: Event): void {
    const mouse = event as MouseEvent | undefined;
    if (!this.selectionMode && mouse && (mouse.ctrlKey || mouse.metaKey)) {
      this.selectionMode = true;
    }
    if (this.selectionMode) {
      this.toggleSelected(host);
      return;
    }
    this.connectHost(host.server, host.target);
  }

  /**
   * Connect to host via SSH
   */
  async connectHost(server: WarpgateServerConfig, target: WarpgateTarget): Promise<void> {
    const key = getHostKey(server.id, target.name);
    if (this.connectingKeys.has(key)) {
      log.debug(`Ignoring duplicate connect for ${target.name}`);
      return;
    }

    this.connectingKeys.add(key);
    try {
      await this.connection.openHost(server, target);
    } finally {
      this.connectingKeys.delete(key);
    }
  }

  /**
   * Refresh all hosts with visual feedback
   */
  async refresh(): Promise<void> {
    if (this.isRefreshing) return;

    this.isRefreshing = true;
    this.refreshSuccess = false;

    try {
      await this.warpgateService.refreshAllTargets();
      this.refreshSuccess = true;
      setTimeout(() => {
        this.refreshSuccess = false;
      }, 1500);
    } catch (error) {
      log.error('Refresh failed:', error);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Reconnect all servers
   */
  async reconnectAll(): Promise<void> {
    await this.warpgateService.connectAll();
  }

  openQuickConnect(): void {
    this.connection.showQuickConnect();
  }

  openSettings(): void {
    this.app.openNewTabRaw({
      type: SettingsTabComponent,
      inputs: { activeTab: 'warpgate' },
    });
  }

  /**
   * Update disconnected servers list
   */
  private updateDisconnectedServers(): void {
    this.disconnectedServers = this.warpgateService.getServers().filter(
      s => s.enabled && this.connectionStatus.has(s.id) && !this.connectionStatus.get(s.id)?.connected
    );
  }

  /**
   * Check if server is connected
   */
  isServerConnected(serverId: string): boolean {
    return this.warpgateService.isConnected(serverId);
  }

  relativeTime(timestamp?: number): string {
    return timestamp ? formatRelativeTime(timestamp) : '';
  }

  // ==================== Host settings ====================

  editHost(host: HostItem): void {
    this.closeQuickSearch();
    this.editingHost = host;
  }

  // ==================== Selection ====================

  toggleSelectionMode(): void {
    if (this.selectionMode) {
      this.exitSelectionMode();
    } else {
      this.selectionMode = true;
    }
  }

  exitSelectionMode(): void {
    this.selectionMode = false;
    this.selectedKeys.clear();
    this.pendingSnippet = null;
  }

  isSelected(host: HostItem): boolean {
    return this.selectedKeys.has(host.key);
  }

  toggleSelected(host: HostItem): void {
    if (this.selectedKeys.has(host.key)) {
      this.selectedKeys.delete(host.key);
    } else {
      this.selectedKeys.add(host.key);
    }
  }

  selectGroup(group: HostGroup): void {
    const allSelected = group.hosts.every(host => this.selectedKeys.has(host.key));
    for (const host of group.hosts) {
      if (allSelected) {
        this.selectedKeys.delete(host.key);
      } else {
        this.selectedKeys.add(host.key);
      }
    }
  }

  selectAllVisible(): void {
    for (const group of this.groups) {
      for (const host of group.hosts) {
        this.selectedKeys.add(host.key);
      }
    }
  }

  /**
   * Run a snippet on hosts picked from the list
   */
  startSnippetRun(snippet: WarpgateSnippet): void {
    this.view = 'hosts';
    this.selectionMode = true;
    this.pendingSnippet = snippet;
  }

  /**
   * Open sessions to all selected hosts
   */
  async openSelected(): Promise<void> {
    const hosts = this.allHosts.filter(host => this.selectedKeys.has(host.key));
    if (hosts.length === 0 || this.openingSelection) {
      return;
    }

    this.openingSelection = true;
    const snippet = this.pendingSnippet;
    try {
      const opened = await this.connection.openHosts(
        hosts.map(host => ({ server: host.server, target: host.target })),
        this.multiLayout,
        snippet ? { scripts: [snippet.script] } : {}
      );
      if (snippet && opened > 0) {
        this.notifications.info(`Running “${snippet.name}” on ${opened} host${opened === 1 ? '' : 's'}`);
      }
      this.exitSelectionMode();
    } finally {
      this.openingSelection = false;
    }
  }

  // ==================== Quick Search ====================

  /**
   * Ctrl+K / Cmd+K opens the in-panel quick search when this panel is visible and focused
   */
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'k') {
      return;
    }
    if (!isElementActive(this.element.nativeElement)) {
      return;
    }
    event.preventDefault();
    this.view = 'hosts';
    this.openQuickSearch();
  }

  /**
   * Open quick search modal
   */
  openQuickSearch(): void {
    this.showQuickSearch = true;
    this.quickSearchQuery = '';
    this.filterQuickSearch();

    // Focus input after view updates
    setTimeout(() => {
      this.quickSearchInput?.nativeElement?.focus();
    }, 50);
  }

  /**
   * Close quick search modal
   */
  closeQuickSearch(): void {
    this.showQuickSearch = false;
    this.quickSearchQuery = '';
    this.quickSearchResults = [];
    this.quickSearchSelectedIndex = 0;
  }

  /**
   * Filter hosts for quick search (pinned and recent hosts rank first)
   */
  filterQuickSearch(resetSelection = true): void {
    const now = Date.now();
    const query = this.quickSearchQuery.trim();

    const ranked = this.allHosts
      .map(host => {
        let score = scoreHost(host, query, now);
        if (!query) {
          // Without a query: pinned first, then most recently used, then alphabetical
          score = (host.pinned ? 1e15 : 0) + (host.lastConnectedAt ?? 0);
        }
        return { host, score };
      })
      .filter(entry => entry.score > 0 || !query)
      .sort((a, b) => b.score - a.score || a.host.displayName.localeCompare(b.host.displayName));

    this.quickSearchResults = ranked.slice(0, 30).map(entry => entry.host);
    if (resetSelection || this.quickSearchSelectedIndex >= this.quickSearchResults.length) {
      this.quickSearchSelectedIndex = 0;
    }
  }

  /**
   * Handle keyboard navigation in quick search
   */
  onQuickSearchKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (this.quickSearchSelectedIndex < this.quickSearchResults.length - 1) {
          this.quickSearchSelectedIndex++;
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (this.quickSearchSelectedIndex > 0) {
          this.quickSearchSelectedIndex--;
        }
        break;

      case 'Enter':
        event.preventDefault();
        if (this.quickSearchResults.length > 0) {
          this.connectFromQuickSearch(this.quickSearchResults[this.quickSearchSelectedIndex]);
        }
        break;

      case 'Escape':
        event.preventDefault();
        this.closeQuickSearch();
        break;
    }
  }

  /**
   * Connect to host from quick search
   */
  connectFromQuickSearch(host: HostItem): void {
    this.closeQuickSearch();
    this.connectHost(host.server, host.target);
  }

  // ==================== View Mode ====================

  setViewMode(mode: 'grid' | 'compact'): void {
    this.config.viewMode = mode;
    this.warpgateService.saveConfig({ viewMode: mode });
  }

  /**
   * Toggle between grid and compact view modes
   */
  toggleViewMode(): void {
    this.setViewMode(this.config.viewMode === 'grid' ? 'compact' : 'grid');
  }

  // ==================== Pin/Favorites ====================

  /**
   * Toggle pin status for a host
   */
  togglePin(host: HostItem): void {
    const pinnedHosts = [...(this.config.pinnedHosts ?? [])];
    const index = pinnedHosts.indexOf(host.key);

    if (index !== -1) {
      pinnedHosts.splice(index, 1);
    } else {
      pinnedHosts.push(host.key);
    }

    this.warpgateService.saveConfig({ pinnedHosts });
    this.loadHosts();
  }
}
