/**
 * Warpgate Hosts Component
 * Displays a list of available SSH hosts from all connected Warpgate servers
 * Provides one-click SSH connections
 */

import { Component, OnInit, OnDestroy, Inject, ViewChild, ElementRef, HostListener } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppService, ProfilesService, NotificationsService } from 'tabby-core';

import { WarpgateService } from '../services/warpgate.service';
import { WarpgateProfileProvider } from '../services/warpgate-profile.service';
import {
  WarpgateTarget,
  WarpgateServerConfig,
  WarpgateConnectionStatus,
  WarpgatePluginConfig,
} from '../models/warpgate.models';
import { getBootstrapColor } from '../models/theme.constants';
import { createLogger } from '../utils/debug-logger';

const log = createLogger('HostsComponent');

/** Host item for display */
interface HostItem {
  server: WarpgateServerConfig;
  target: WarpgateTarget;
  isConnecting: boolean;
  lastConnected?: Date;
}

/** Get appropriate icon for target based on name/description/group */
function getTargetIcon(target: WarpgateTarget): string {
  const name = (target.name + ' ' + (target.description || '') + ' ' + (target.group?.name || '')).toLowerCase();

  // Database servers
  if (name.includes('mysql') || name.includes('mariadb')) return 'fas fa-database';
  if (name.includes('postgres') || name.includes('pgsql')) return 'fas fa-database';
  if (name.includes('mongo') || name.includes('redis') || name.includes('elastic')) return 'fas fa-database';
  if (name.includes('database') || name.includes('db')) return 'fas fa-database';

  // Web servers
  if (name.includes('web') || name.includes('nginx') || name.includes('apache')) return 'fas fa-globe';
  if (name.includes('http') || name.includes('frontend') || name.includes('backend')) return 'fas fa-globe';

  // File/Storage servers
  if (name.includes('file') || name.includes('storage') || name.includes('nas')) return 'fas fa-folder-open';
  if (name.includes('backup') || name.includes('archive')) return 'fas fa-archive';
  if (name.includes('ftp') || name.includes('sftp')) return 'fas fa-folder';

  // Development/CI
  if (name.includes('git') || name.includes('gitlab') || name.includes('github')) return 'fab fa-git-alt';
  if (name.includes('jenkins') || name.includes('ci') || name.includes('build')) return 'fas fa-cogs';
  if (name.includes('docker') || name.includes('container') || name.includes('k8s') || name.includes('kubernetes')) return 'fab fa-docker';
  if (name.includes('dev') || name.includes('test') || name.includes('staging')) return 'fas fa-code';

  // Infrastructure
  if (name.includes('gateway') || name.includes('proxy') || name.includes('vpn')) return 'fas fa-shield-alt';
  if (name.includes('firewall') || name.includes('security')) return 'fas fa-lock';
  if (name.includes('dns') || name.includes('mail') || name.includes('smtp')) return 'fas fa-envelope';
  if (name.includes('monitor') || name.includes('logging') || name.includes('metrics')) return 'fas fa-chart-line';

  // Cloud/VMs
  if (name.includes('vm') || name.includes('virtual') || name.includes('cloud')) return 'fas fa-cloud';
  if (name.includes('aws') || name.includes('azure') || name.includes('gcp')) return 'fas fa-cloud';

  // Production/Staging
  if (name.includes('prod') || name.includes('production') || name.includes('live')) return 'fas fa-rocket';

  // Default server icon
  return 'fas fa-server';
}

/** Get icon color based on target type */
function getTargetIconColor(target: WarpgateTarget): string {
  const name = (target.name + ' ' + (target.description || '')).toLowerCase();

  if (name.includes('prod') || name.includes('production') || name.includes('live')) return '#dc3545'; // red
  if (name.includes('dev') || name.includes('development')) return '#28a745'; // green
  if (name.includes('test') || name.includes('staging') || name.includes('uat')) return '#ffc107'; // yellow
  if (name.includes('database') || name.includes('db') || name.includes('mysql') || name.includes('postgres')) return '#6f42c1'; // purple

  // Use group color if available
  if (target.group?.color) {
    return getBootstrapColor(target.group.color) || '#0d6efd';
  }

  return '#0d6efd'; // default blue
}

/** Group of hosts */
interface HostGroup {
  name: string;
  color?: string;
  hosts: HostItem[];
  expanded: boolean;
}

@Component({
  selector: 'warpgate-hosts',
  template: `
    <div class="warpgate-hosts" (keydown)="onKeyDown($event)">
      <!-- Quick Search Modal -->
      <div class="quick-search-overlay" *ngIf="showQuickSearch" (click)="closeQuickSearch()">
        <div class="quick-search-modal" (click)="$event.stopPropagation()">
          <div class="quick-search-header">
            <i class="fas fa-search"></i>
            <input
              #quickSearchInput
              type="text"
              class="quick-search-input"
              placeholder="Search hosts... (Esc to close)"
              [(ngModel)]="quickSearchQuery"
              (ngModelChange)="filterQuickSearch()"
              (keydown)="onQuickSearchKeyDown($event)"
            />
            <span class="quick-search-hint">Ctrl+K</span>
          </div>
          <div class="quick-search-results">
            <div
              class="quick-search-item"
              *ngFor="let host of quickSearchResults; let i = index"
              [class.selected]="i === quickSearchSelectedIndex"
              [class.pinned]="isHostPinned(host)"
              (click)="connectFromQuickSearch(host)"
              (mouseenter)="quickSearchSelectedIndex = i"
            >
              <div class="quick-item-icon" [style.backgroundColor]="getIconColor(host.target)">
                <i [class]="getIcon(host.target)"></i>
              </div>
              <div class="quick-item-info">
                <div class="quick-item-name">
                  <i class="fas fa-star pinned-indicator" *ngIf="isHostPinned(host)"></i>
                  {{ host.target.name }}
                </div>
                <div class="quick-item-meta">{{ host.server.name }}<span *ngIf="host.target.description"> · {{ host.target.description }}</span></div>
              </div>
              <div class="quick-item-status" [class.online]="isServerConnected(host.server.id)"></div>
            </div>
            <div class="quick-search-empty" *ngIf="quickSearchResults.length === 0">
              <i class="fas fa-search"></i>
              <span>No hosts found</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Header -->
      <div class="hosts-header">
        <div class="header-title">
          <div class="header-icon">
            <i class="fas fa-network-wired"></i>
          </div>
          <div class="header-text">
            <span class="title">Warpgate</span>
            <span class="subtitle" *ngIf="totalHosts > 0">{{ totalHosts }} hosts available</span>
            <span class="subtitle" *ngIf="totalHosts === 0 && hasServers">No hosts</span>
          </div>
        </div>
        <div class="header-actions">
          <button
            class="btn btn-sm btn-icon"
            (click)="openQuickSearch()"
            title="Quick Search (Ctrl+K)"
          >
            <i class="fas fa-search"></i>
          </button>
          <button
            class="btn btn-sm btn-icon"
            [class.active]="config.viewMode === 'compact'"
            (click)="toggleViewMode()"
            [title]="config.viewMode === 'grid' ? 'Switch to compact view' : 'Switch to grid view'"
          >
            <i class="fas" [class.fa-th-large]="config.viewMode === 'compact'" [class.fa-list]="config.viewMode === 'grid'"></i>
          </button>
          <button
            class="btn btn-sm btn-icon refresh-btn"
            [class.refreshing]="isRefreshing"
            [class.success]="refreshSuccess"
            (click)="refresh()"
            [disabled]="isRefreshing"
            title="Refresh all hosts"
          >
            <i class="fas" [class.fa-sync-alt]="!refreshSuccess" [class.fa-check]="refreshSuccess" [class.fa-spin]="isRefreshing"></i>
          </button>
        </div>
      </div>

      <!-- Connection Status Banner -->
      <div
        class="connection-banner"
        *ngIf="disconnectedServers.length > 0"
      >
        <div class="banner-content">
          <i class="fas fa-exclamation-circle"></i>
          <span>{{ disconnectedServers.length }} server{{ disconnectedServers.length > 1 ? 's' : '' }} offline</span>
        </div>
        <button class="btn btn-sm btn-link" (click)="reconnectAll()">
          <i class="fas fa-plug"></i> Reconnect
        </button>
      </div>

      <!-- Loading Indicator -->
      <div class="loading-state" *ngIf="isLoading && groups.length === 0">
        <div class="loading-spinner">
          <i class="fas fa-circle-notch fa-spin"></i>
        </div>
        <p>Connecting to servers...</p>
      </div>

      <!-- No Servers -->
      <div class="empty-state" *ngIf="!hasServers">
        <div class="empty-icon">
          <i class="fas fa-plug"></i>
        </div>
        <h4>No Servers</h4>
        <p>Add a Warpgate server to get started</p>
        <small>Settings → Warpgate</small>
      </div>

      <!-- No Results -->
      <div class="empty-state" *ngIf="hasServers && groups.length === 0 && !isLoading">
        <div class="empty-icon">
          <i class="fas fa-search"></i>
        </div>
        <h4 *ngIf="searchQuery">No Results</h4>
        <h4 *ngIf="!searchQuery">No Hosts</h4>
        <p *ngIf="searchQuery">No hosts match "{{ searchQuery }}"</p>
        <p *ngIf="!searchQuery">Check your server connections</p>
      </div>

      <!-- Host Groups -->
      <div class="host-groups" *ngIf="groups.length > 0" [class.compact-mode]="config.viewMode === 'compact'">
        <div class="host-group" *ngFor="let group of groups">
          <!-- Group Header -->
          <div
            class="group-header"
            (click)="toggleGroup(group)"
          >
            <div class="group-color-dot" [style.backgroundColor]="group.color || 'var(--bs-primary)'"></div>
            <i
              class="fas fa-chevron-right expand-icon"
              [class.expanded]="group.expanded"
            ></i>
            <span class="group-name">{{ group.name }}</span>
            <span class="group-count">{{ group.hosts.length }}</span>
          </div>

          <!-- Grid View -->
          <div class="group-hosts-grid" [class.expanded]="group.expanded" *ngIf="config.viewMode === 'grid'">
            <div
              class="host-card"
              *ngFor="let host of group.hosts"
              [class.connecting]="host.isConnecting"
              [class.pinned]="isHostPinned(host)"
              (click)="connectSsh(host)"
            >
              <!-- Status indicator -->
              <div class="host-status" [class.online]="isServerConnected(host.server.id)"></div>

              <!-- Pin button -->
              <button
                class="pin-btn"
                [class.pinned]="isHostPinned(host)"
                (click)="togglePin(host); $event.stopPropagation()"
                [title]="isHostPinned(host) ? 'Unpin host' : 'Pin to top'"
              >
                <i class="fas fa-star"></i>
              </button>

              <!-- Card Header with Icon and Actions -->
              <div class="card-header">
                <div class="host-icon" [style.backgroundColor]="getIconColor(host.target)">
                  <i [class]="getIcon(host.target)"></i>
                </div>
                <button
                  class="connect-btn"
                  (click)="connectSsh(host); $event.stopPropagation()"
                  [disabled]="host.isConnecting"
                  title="Connect via SSH"
                >
                  <i class="fas" [class.fa-terminal]="!host.isConnecting" [class.fa-spinner]="host.isConnecting" [class.fa-spin]="host.isConnecting"></i>
                </button>
              </div>

              <!-- Card Body -->
              <div class="card-body">
                <div class="host-name">{{ host.target.name }}</div>
                <div class="host-server">
                  <i class="fas fa-server"></i> {{ host.server.name }}
                </div>
                <div class="host-description" *ngIf="host.target.description">
                  {{ host.target.description }}
                </div>
                <div class="host-group-tag" *ngIf="host.target.group && !config.groupByServer">
                  <span class="group-tag" [style.backgroundColor]="getGroupTagColor(host.target.group.color)">
                    {{ host.target.group.name }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Compact View -->
          <div class="group-hosts-compact" [class.expanded]="group.expanded" *ngIf="config.viewMode === 'compact'">
            <div
              class="host-row"
              *ngFor="let host of group.hosts"
              [class.connecting]="host.isConnecting"
              [class.pinned]="isHostPinned(host)"
              (click)="connectSsh(host)"
            >
              <div class="row-status" [class.online]="isServerConnected(host.server.id)"></div>
              <div class="row-icon" [style.backgroundColor]="getIconColor(host.target)">
                <i [class]="getIcon(host.target)"></i>
              </div>
              <div class="row-info">
                <span class="row-name">{{ host.target.name }}</span>
                <span class="row-server">{{ host.server.name }}</span>
              </div>
              <button
                class="row-pin-btn"
                [class.pinned]="isHostPinned(host)"
                (click)="togglePin(host); $event.stopPropagation()"
                [title]="isHostPinned(host) ? 'Unpin' : 'Pin'"
              >
                <i class="fas fa-star"></i>
              </button>
              <button
                class="row-connect-btn"
                (click)="connectSsh(host); $event.stopPropagation()"
                [disabled]="host.isConnecting"
              >
                <i class="fas" [class.fa-terminal]="!host.isConnecting" [class.fa-spinner]="host.isConnecting" [class.fa-spin]="host.isConnecting"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .warpgate-hosts {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 16px 20px;
      background: var(--bs-body-bg, #1a1a2e);
    }

    /* Header */
    .hosts-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 16px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--bs-border-color, rgba(255,255,255,0.1));
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .header-icon {
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 12px;
      font-size: 1.2rem;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.35);
    }

    .header-text {
      display: flex;
      flex-direction: column;
    }

    .header-text .title {
      font-weight: 700;
      font-size: 1.25rem;
      color: var(--bs-body-color);
      letter-spacing: -0.02em;
    }

    .header-text .subtitle {
      font-size: 0.8rem;
      color: var(--bs-secondary-color, #6c757d);
      margin-top: 2px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .search-wrapper {
      position: relative;
    }

    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--bs-secondary-color, #6c757d);
      font-size: 0.85rem;
    }

    .search-input {
      width: 180px;
      padding: 8px 12px 8px 36px !important;
      border-radius: 10px;
      border: 1px solid var(--bs-border-color, rgba(255,255,255,0.15));
      background: var(--bs-tertiary-bg, rgba(255,255,255,0.05));
      transition: all 0.25s ease;
      font-size: 0.9rem;
    }

    .search-input:focus {
      width: 220px;
      background: var(--bs-body-bg, #1a1a2e);
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
      border-color: #667eea;
    }

    .btn-icon {
      width: 36px;
      height: 36px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      border: 1px solid var(--bs-border-color, rgba(255,255,255,0.15));
      background: var(--bs-tertiary-bg, rgba(255,255,255,0.05));
      color: var(--bs-body-color);
      transition: all 0.25s ease;
    }

    .btn-icon:hover:not(:disabled) {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-color: transparent;
      color: white;
      transform: scale(1.05);
    }

    /* Refresh Button States */
    .refresh-btn.refreshing {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-color: transparent;
      color: white;
      pointer-events: none;
    }

    .refresh-btn.success {
      background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
      border-color: transparent;
      color: white;
      animation: successPulse 0.5s ease;
    }

    @keyframes successPulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.15); }
      100% { transform: scale(1); }
    }

    /* Connection Banner */
    .connection-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
      border-radius: 12px;
      margin-bottom: 16px;
      color: white;
      font-size: 0.9rem;
      box-shadow: 0 4px 15px rgba(255, 107, 107, 0.3);
    }

    .banner-content {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .connection-banner .btn-link {
      color: white;
      text-decoration: none;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 8px;
      background: rgba(255,255,255,0.2);
      transition: all 0.2s;
    }

    .connection-banner .btn-link:hover {
      background: rgba(255,255,255,0.35);
    }

    /* Empty/Loading States */
    .empty-state, .loading-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 50px 20px;
    }

    .empty-icon, .loading-spinner {
      width: 90px;
      height: 90px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bs-tertiary-bg, rgba(255,255,255,0.05));
      border-radius: 50%;
      margin-bottom: 20px;
      font-size: 2.2rem;
      color: var(--bs-secondary-color, #6c757d);
    }

    .loading-spinner {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      box-shadow: 0 8px 25px rgba(102, 126, 234, 0.35);
    }

    .empty-state h4, .loading-state h4 {
      margin: 0 0 10px 0;
      font-weight: 600;
      font-size: 1.1rem;
      color: var(--bs-body-color);
    }

    .empty-state p, .loading-state p {
      margin: 0;
      color: var(--bs-secondary-color, #6c757d);
      font-size: 0.95rem;
    }

    .empty-state small {
      margin-top: 12px;
      color: var(--bs-secondary-color, #6c757d);
      font-size: 0.85rem;
      opacity: 0.7;
    }

    /* Host Groups */
    .host-groups {
      flex: 1;
      overflow-y: auto;
      padding-right: 6px;
    }

    .host-group {
      margin-bottom: 20px;
    }

    .group-header {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      background: var(--bs-tertiary-bg, rgba(255,255,255,0.05));
      border-radius: 12px;
      cursor: pointer;
      user-select: none;
      transition: all 0.25s ease;
      position: relative;
      gap: 10px;
    }

    .group-color-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .group-header:hover {
      background: var(--bs-secondary-bg, rgba(255,255,255,0.08));
    }

    .expand-icon {
      transition: transform 0.25s ease;
      font-size: 0.75rem;
      color: var(--bs-secondary-color, #6c757d);
    }

    .expand-icon.expanded {
      transform: rotate(90deg);
    }

    .group-name {
      flex: 1;
      font-weight: 600;
      font-size: 0.95rem;
    }

    .group-count {
      background: var(--bs-secondary-bg, rgba(255,255,255,0.1));
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--bs-secondary-color, #6c757d);
    }

    /* Host Cards Grid - Termius Style */
    .group-hosts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
      max-height: 0;
      overflow: hidden;
      transition: all 0.3s ease;
      margin-top: 0;
      padding: 0;
    }

    .group-hosts-grid.expanded {
      max-height: 5000px;
      margin-top: 12px;
      padding: 4px;
    }

    .host-card {
      display: flex;
      flex-direction: column;
      padding: 16px;
      background: var(--bs-tertiary-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--bs-border-color, rgba(255,255,255,0.08));
      border-radius: 14px;
      cursor: pointer;
      transition: all 0.25s ease;
      position: relative;
      min-height: 140px;
    }

    .host-card:hover {
      border-color: #667eea;
      background: var(--bs-secondary-bg, rgba(102, 126, 234, 0.08));
      box-shadow: 0 8px 25px rgba(102, 126, 234, 0.2);
      transform: translateY(-4px);
    }

    .host-card.connecting {
      opacity: 0.5;
      pointer-events: none;
    }

    /* Status Indicator - top left corner */
    .host-status {
      position: absolute;
      top: 12px;
      left: 12px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #dc3545;
      box-shadow: 0 0 0 2px var(--bs-body-bg, #1a1a2e);
      z-index: 2;
    }

    .host-status.online {
      background: #28a745;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 2px var(--bs-body-bg, #1a1a2e), 0 0 0 4px rgba(40, 167, 69, 0.3); }
      50% { box-shadow: 0 0 0 2px var(--bs-body-bg, #1a1a2e), 0 0 0 7px rgba(40, 167, 69, 0); }
    }

    /* Card Header */
    .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 12px;
      padding-right: 76px; /* Space for pin + connect buttons */
    }

    /* Host Icon */
    .host-icon {
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bs-primary);
      color: white;
      border-radius: 12px;
      font-size: 1.1rem;
      flex-shrink: 0;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    /* Connect Button - top right corner */
    .connect-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.25s ease;
      opacity: 0;
      z-index: 3;
    }

    .host-card:hover .connect-btn {
      opacity: 1;
    }

    .connect-btn:hover:not(:disabled) {
      transform: scale(1.1);
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.5);
    }

    .connect-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Card Body */
    .card-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .host-name {
      font-weight: 600;
      font-size: 1rem;
      color: var(--bs-body-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 6px;
      letter-spacing: -0.01em;
    }

    .host-server {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      color: var(--bs-secondary-color, #6c757d);
      margin-bottom: 4px;
    }

    .host-server i {
      font-size: 0.7rem;
      opacity: 0.7;
    }

    .host-description {
      font-size: 0.8rem;
      color: var(--bs-secondary-color, #6c757d);
      opacity: 0.8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: auto;
    }

    /* Group Tag */
    .host-group-tag {
      margin-top: 8px;
    }

    .group-tag {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 0.7rem;
      font-weight: 600;
      color: white;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }

    /* Scrollbar styling */
    .host-groups::-webkit-scrollbar {
      width: 6px;
    }

    .host-groups::-webkit-scrollbar-track {
      background: transparent;
    }

    .host-groups::-webkit-scrollbar-thumb {
      background: var(--bs-secondary-bg, rgba(255,255,255,0.1));
      border-radius: 3px;
    }

    .host-groups::-webkit-scrollbar-thumb:hover {
      background: var(--bs-secondary-color, rgba(255,255,255,0.2));
    }

    /* Responsive grid */
    @media (min-width: 1200px) {
      .group-hosts-grid {
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      }
    }

    @media (max-width: 600px) {
      .group-hosts-grid {
        grid-template-columns: 1fr;
      }
    }

    /* Pin Button - next to connect button */
    .pin-btn {
      position: absolute;
      top: 12px;
      right: 44px; /* 12px + 28px (connect btn) + 4px gap */
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--bs-secondary-color, #6c757d);
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s ease;
      opacity: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 3;
    }

    .host-card:hover .pin-btn {
      opacity: 0.6;
    }

    .pin-btn:hover {
      opacity: 1 !important;
      color: #ffc107;
      background: rgba(255, 193, 7, 0.15);
    }

    .pin-btn.pinned {
      opacity: 1;
      color: #ffc107;
    }

    .host-card.pinned {
      border-color: rgba(255, 193, 7, 0.3);
    }

    .host-card.pinned::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #ffc107, #ff9800);
      border-radius: 14px 14px 0 0;
    }

    /* View Mode Toggle Active State */
    .btn-icon.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-color: transparent;
      color: white;
    }

    /* Compact View Styles */
    .group-hosts-compact {
      max-height: 0;
      overflow: hidden;
      transition: all 0.3s ease;
      margin-top: 0;
    }

    .group-hosts-compact.expanded {
      max-height: 5000px;
      margin-top: 8px;
    }

    .host-row {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      margin-bottom: 4px;
      background: var(--bs-tertiary-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--bs-border-color, rgba(255,255,255,0.08));
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s ease;
      gap: 12px;
    }

    .host-row:hover {
      border-color: #667eea;
      background: var(--bs-secondary-bg, rgba(102, 126, 234, 0.08));
    }

    .host-row.connecting {
      opacity: 0.5;
      pointer-events: none;
    }

    .host-row.pinned {
      border-left: 3px solid #ffc107;
    }

    .row-status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #dc3545;
      flex-shrink: 0;
    }

    .row-status.online {
      background: #28a745;
    }

    .row-icon {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bs-primary);
      color: white;
      border-radius: 8px;
      font-size: 0.85rem;
      flex-shrink: 0;
    }

    .row-info {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .row-name {
      font-weight: 600;
      font-size: 0.9rem;
      color: var(--bs-body-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .row-server {
      font-size: 0.8rem;
      color: var(--bs-secondary-color, #6c757d);
      white-space: nowrap;
    }

    .row-pin-btn {
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--bs-secondary-color, #6c757d);
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.2s ease;
      opacity: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .host-row:hover .row-pin-btn {
      opacity: 0.6;
    }

    .row-pin-btn:hover {
      opacity: 1 !important;
      color: #ffc107;
    }

    .row-pin-btn.pinned {
      opacity: 1;
      color: #ffc107;
    }

    .row-connect-btn {
      width: 32px;
      height: 32px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
    }

    .host-row:hover .row-connect-btn {
      opacity: 1;
    }

    .row-connect-btn:hover:not(:disabled) {
      transform: scale(1.05);
    }

    .row-connect-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Quick Search Modal */
    .quick-search-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 15vh;
      z-index: 10000;
      backdrop-filter: blur(4px);
    }

    .quick-search-modal {
      width: 100%;
      max-width: 550px;
      background: var(--bs-body-bg, #1a1a2e);
      border: 1px solid var(--bs-border-color, rgba(255,255,255,0.15));
      border-radius: 16px;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }

    .quick-search-header {
      display: flex;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--bs-border-color, rgba(255,255,255,0.1));
      gap: 14px;
    }

    .quick-search-header i {
      color: var(--bs-secondary-color, #6c757d);
      font-size: 1rem;
    }

    .quick-search-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      font-size: 1.1rem;
      color: var(--bs-body-color);
    }

    .quick-search-input::placeholder {
      color: var(--bs-secondary-color, #6c757d);
    }

    .quick-search-hint {
      font-size: 0.75rem;
      color: var(--bs-secondary-color, #6c757d);
      background: var(--bs-tertiary-bg, rgba(255,255,255,0.05));
      padding: 4px 8px;
      border-radius: 6px;
    }

    .quick-search-results {
      max-height: 400px;
      overflow-y: auto;
    }

    .quick-search-item {
      display: flex;
      align-items: center;
      padding: 12px 20px;
      gap: 14px;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .quick-search-item:hover,
    .quick-search-item.selected {
      background: var(--bs-tertiary-bg, rgba(255,255,255,0.05));
    }

    .quick-search-item.selected {
      background: rgba(102, 126, 234, 0.15);
    }

    .quick-item-icon {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bs-primary);
      color: white;
      border-radius: 10px;
      font-size: 0.9rem;
      flex-shrink: 0;
    }

    .quick-item-info {
      flex: 1;
      min-width: 0;
    }

    .quick-item-name {
      font-weight: 600;
      font-size: 0.95rem;
      color: var(--bs-body-color);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .pinned-indicator {
      color: #ffc107;
      font-size: 0.7rem;
    }

    .quick-item-meta {
      font-size: 0.8rem;
      color: var(--bs-secondary-color, #6c757d);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .quick-item-status {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #dc3545;
      flex-shrink: 0;
    }

    .quick-item-status.online {
      background: #28a745;
    }

    .quick-search-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      color: var(--bs-secondary-color, #6c757d);
      gap: 10px;
    }

    .quick-search-empty i {
      font-size: 2rem;
      opacity: 0.5;
    }

    .quick-search-results::-webkit-scrollbar {
      width: 6px;
    }

    .quick-search-results::-webkit-scrollbar-track {
      background: transparent;
    }

    .quick-search-results::-webkit-scrollbar-thumb {
      background: var(--bs-secondary-bg, rgba(255,255,255,0.1));
      border-radius: 3px;
    }
  `],
})
export class WarpgateHostsComponent implements OnInit, OnDestroy {
  @ViewChild('quickSearchInput') quickSearchInput!: ElementRef<HTMLInputElement>;

  groups: HostGroup[] = [];
  searchQuery = '';
  isLoading = false;
  isRefreshing = false;
  refreshSuccess = false;
  totalHosts = 0;
  hasServers = false;
  disconnectedServers: WarpgateServerConfig[] = [];
  config: WarpgatePluginConfig;

  // Quick search state
  showQuickSearch = false;
  quickSearchQuery = '';
  quickSearchResults: HostItem[] = [];
  quickSearchSelectedIndex = 0;

  private allHosts: HostItem[] = [];
  private subscriptions: Subscription[] = [];

  constructor(
    @Inject(WarpgateService) private warpgateService: WarpgateService,
    @Inject(WarpgateProfileProvider) private profileProvider: WarpgateProfileProvider,
    @Inject(AppService) private app: AppService,
    @Inject(ProfilesService) private profiles: ProfilesService,
    @Inject(NotificationsService) private notifications: NotificationsService
  ) {
    this.config = this.warpgateService.getConfig();
  }

  ngOnInit(): void {
    this.hasServers = this.warpgateService.getServers().length > 0;

    // Subscribe to targets
    this.subscriptions.push(
      this.warpgateService.targets$.subscribe(() => {
        this.loadHosts();
      })
    );

    // Subscribe to status
    this.subscriptions.push(
      this.warpgateService.status$.subscribe(status => {
        this.updateDisconnectedServers(status);
      })
    );

    // Subscribe to loading
    this.subscriptions.push(
      this.warpgateService.loading$.subscribe(loading => {
        this.isLoading = loading;
      })
    );

    // Ensure servers are connected before initial load
    // This will trigger the targets$ subscription which calls loadHosts()
    this.connectServersAndLoad();
  }

  /**
   * Connect to all enabled servers and load hosts
   */
  private async connectServersAndLoad(): Promise<void> {
    const servers = this.warpgateService.getServers().filter(s => s.enabled);

    // Connect to any servers that aren't connected yet
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

    // Load hosts after ensuring connections
    // This is redundant with the targets$ subscription but ensures initial load
    this.loadHosts();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  /**
   * Load all hosts from Warpgate service
   */
  loadHosts(): void {
    const allTargets = this.warpgateService.getAllTargets();

    this.allHosts = allTargets.map(({ server, target }) => ({
      server,
      target,
      isConnecting: false,
    }));

    this.totalHosts = this.allHosts.length;
    this.filterHosts();
  }

  /**
   * Filter and group hosts
   */
  filterHosts(): void {
    let filteredHosts = this.allHosts;

    // Apply search filter
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filteredHosts = filteredHosts.filter(host =>
        host.target.name.toLowerCase().includes(query) ||
        host.target.description?.toLowerCase().includes(query) ||
        host.server.name.toLowerCase().includes(query) ||
        host.target.group?.name.toLowerCase().includes(query)
      );
    }

    // Sort hosts
    filteredHosts = this.sortHosts(filteredHosts);

    // Group hosts
    this.groups = this.groupHosts(filteredHosts);
  }

  /**
   * Sort hosts based on configuration (pinned hosts first)
   */
  private sortHosts(hosts: HostItem[]): HostItem[] {
    return [...hosts].sort((a, b) => {
      // Pinned hosts always come first
      const aPinned = this.isHostPinned(a);
      const bPinned = this.isHostPinned(b);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;

      // Then sort by configured criteria
      switch (this.config.sortBy) {
        case 'server':
          return a.server.name.localeCompare(b.server.name);
        case 'kind':
          return a.target.kind.localeCompare(b.target.kind);
        case 'group':
          return (a.target.group?.name || '').localeCompare(b.target.group?.name || '');
        case 'name':
        default:
          return a.target.name.localeCompare(b.target.name);
      }
    });
  }

  /**
   * Group hosts based on configuration
   */
  private groupHosts(hosts: HostItem[]): HostGroup[] {
    const groupMap = new Map<string, HostGroup>();

    for (const host of hosts) {
      let groupKey: string;
      let groupName: string;
      let groupColor: string | undefined;

      if (this.config.groupByServer) {
        // Group by server, then by target group
        if (host.target.group) {
          groupKey = `${host.server.id}:${host.target.group.name}`;
          groupName = `${host.server.name} / ${host.target.group.name}`;
          groupColor = getBootstrapColor(host.target.group.color);
        } else {
          groupKey = host.server.id;
          groupName = host.server.name;
        }
      } else {
        // Group by target group only
        if (host.target.group) {
          groupKey = host.target.group.name;
          groupName = host.target.group.name;
          groupColor = getBootstrapColor(host.target.group.color);
        } else {
          groupKey = '__ungrouped__';
          groupName = 'Ungrouped';
        }
      }

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          name: groupName,
          color: groupColor,
          hosts: [],
          expanded: true,
        });
      }

      groupMap.get(groupKey)!.hosts.push(host);
    }

    return Array.from(groupMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /**
   * Toggle group expansion
   */
  toggleGroup(group: HostGroup): void {
    group.expanded = !group.expanded;
  }

  /**
   * Connect to host via SSH
   */
  async connectSsh(host: HostItem): Promise<void> {
    // Prevent double-click / double connection attempts
    if (host.isConnecting) {
      log.debug(` Ignoring duplicate connectSsh call for ${host.target.name}`);
      return;
    }

    log.debug(` connectSsh called for ${host.target.name}`);
    host.isConnecting = true;

    try {
      // Create profile with ticket authentication (one-click access)
      const profile = await this.profileProvider.createOneClickProfile(host.server, host.target);
      log.debug(` Profile created, auth method: ${profile.options.auth}, username: ${profile.options.user}`);

      // Open SSH tab
      await this.profiles.openNewTabForProfile(profile);

      this.notifications.info(`Connecting to ${host.target.name}...`);
    } catch (error) {
      log.error(' Failed to connect:', error);
      this.notifications.error(
        `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      host.isConnecting = false;
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
      // Show success state briefly
      this.refreshSuccess = true;
      setTimeout(() => {
        this.refreshSuccess = false;
      }, 1500);
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

  /**
   * Update disconnected servers list
   */
  private updateDisconnectedServers(status: Map<string, WarpgateConnectionStatus>): void {
    const servers = this.warpgateService.getServers();
    this.disconnectedServers = servers.filter(
      s => s.enabled && !status.get(s.id)?.connected
    );
  }

  /**
   * Get icon for target based on name/description
   */
  getIcon(target: WarpgateTarget): string {
    return getTargetIcon(target);
  }

  /**
   * Get icon color for target
   */
  getIconColor(target: WarpgateTarget): string {
    return getTargetIconColor(target);
  }

  /**
   * Get group tag background color (with alpha for subtle appearance)
   */
  getGroupTagColor(color?: string): string {
    const baseColor = getBootstrapColor(color) || '#667eea';
    return baseColor;
  }

  /**
   * Check if server is connected
   */
  isServerConnected(serverId: string): boolean {
    return this.warpgateService.isConnected(serverId);
  }

  // ==================== Quick Search ====================

  /**
   * Handle global keyboard events
   */
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Ctrl+K or Cmd+K to open quick search
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      this.openQuickSearch();
    }
  }

  /**
   * Open quick search modal
   */
  openQuickSearch(): void {
    this.showQuickSearch = true;
    this.quickSearchQuery = '';
    this.quickSearchSelectedIndex = 0;
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
   * Filter hosts for quick search
   */
  filterQuickSearch(): void {
    let results = [...this.allHosts];

    // Filter by query
    if (this.quickSearchQuery.trim()) {
      const query = this.quickSearchQuery.toLowerCase();
      results = results.filter(host =>
        host.target.name.toLowerCase().includes(query) ||
        host.target.description?.toLowerCase().includes(query) ||
        host.server.name.toLowerCase().includes(query) ||
        host.target.group?.name.toLowerCase().includes(query)
      );
    }

    // Sort: pinned first, then alphabetically
    results.sort((a, b) => {
      const aPinned = this.isHostPinned(a);
      const bPinned = this.isHostPinned(b);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return a.target.name.localeCompare(b.target.name);
    });

    this.quickSearchResults = results.slice(0, 20); // Limit to 20 results
    this.quickSearchSelectedIndex = 0;
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
    this.connectSsh(host);
  }

  // ==================== View Mode ====================

  /**
   * Toggle between grid and compact view modes
   */
  toggleViewMode(): void {
    this.config.viewMode = this.config.viewMode === 'grid' ? 'compact' : 'grid';
    this.warpgateService.saveConfig({ viewMode: this.config.viewMode });
  }

  // ==================== Pin/Favorites ====================

  /**
   * Get unique key for a host (serverId:targetName)
   */
  getHostKey(host: HostItem): string {
    return `${host.server.id}:${host.target.name}`;
  }

  /**
   * Check if a host is pinned
   */
  isHostPinned(host: HostItem): boolean {
    const key = this.getHostKey(host);
    return this.config.pinnedHosts.includes(key);
  }

  /**
   * Toggle pin status for a host
   */
  togglePin(host: HostItem): void {
    const key = this.getHostKey(host);
    const pinnedHosts = [...this.config.pinnedHosts];

    if (pinnedHosts.includes(key)) {
      // Unpin
      const index = pinnedHosts.indexOf(key);
      pinnedHosts.splice(index, 1);
    } else {
      // Pin
      pinnedHosts.push(key);
    }

    this.config.pinnedHosts = pinnedHosts;
    this.warpgateService.saveConfig({ pinnedHosts });

    // Re-filter to update sort order
    this.filterHosts();
  }
}
