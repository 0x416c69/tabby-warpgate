/**
 * Warpgate Settings Component
 * Settings tab for configuring Warpgate servers and plugin options
 */

import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { Subscription } from 'rxjs';

import { WarpgateService } from '../services/warpgate.service';
import {
  WarpgateServerConfig,
  WarpgatePluginConfig,
  WarpgateConnectionStatus,
} from '../models/warpgate.models';

/** Form state for adding/editing servers */
interface ServerFormState {
  isEditing: boolean;
  editingServerId: string | null;
  name: string;
  url: string;
  username: string;
  password: string;
  trustSelfSigned: boolean;
  enabled: boolean;
  isTesting: boolean;
  testResult: { success: boolean; message: string } | null;
  /** OTP-related state */
  needsOtp: boolean;
  otpCode: string;
  otpSecret: string;
}

@Component({
  selector: 'warpgate-settings',
  template: `
    <div class="warpgate-settings">
      <h3>Warpgate Integration</h3>
      <p class="text-muted">
        Connect to Warpgate SSH gateway servers to access your SSH hosts with one click.
      </p>

      <!-- Server List -->
      <div class="servers-section">
        <div class="section-header">
          <h4>Servers</h4>
          <button
            class="btn btn-primary btn-sm"
            (click)="showAddServerForm()"
            [disabled]="form.isEditing"
          >
            <i class="fas fa-plus"></i> Add Server
          </button>
        </div>

        <!-- Server Form -->
        <div class="server-form card mb-3" *ngIf="form.isEditing">
          <div class="card-body">
            <h5 class="card-title">
              {{ form.editingServerId ? 'Edit Server' : 'Add Server' }}
            </h5>

            <div class="form-group">
              <label>Server Name</label>
              <input
                type="text"
                class="form-control"
                [(ngModel)]="form.name"
                placeholder="My Warpgate Server"
              />
            </div>

            <div class="form-group">
              <label>Server URL</label>
              <input
                type="text"
                class="form-control"
                [(ngModel)]="form.url"
                placeholder="https://warpgate.example.com"
              />
              <small class="form-text text-muted">
                HTTPS URL of your Warpgate server (e.g., https://warpgate.example.com)
              </small>
            </div>

            <div class="form-group">
              <label>Username</label>
              <input
                type="text"
                class="form-control"
                [(ngModel)]="form.username"
                placeholder="your-username"
              />
            </div>

            <div class="form-group">
              <label>Password</label>
              <input
                type="password"
                class="form-control"
                [(ngModel)]="form.password"
                placeholder="••••••••"
              />
            </div>

            <div class="form-check mb-3">
              <input
                type="checkbox"
                class="form-check-input"
                id="trustSelfSigned"
                [(ngModel)]="form.trustSelfSigned"
              />
              <label class="form-check-label" for="trustSelfSigned">
                Trust self-signed certificates
              </label>
            </div>

            <div class="form-check mb-3">
              <input
                type="checkbox"
                class="form-check-input"
                id="enabled"
                [(ngModel)]="form.enabled"
              />
              <label class="form-check-label" for="enabled">
                Enable this server
              </label>
            </div>

            <!-- OTP Section -->
            <div class="otp-section" *ngIf="form.needsOtp">
              <div class="alert alert-info">
                <i class="fas fa-key"></i>
                This server requires OTP (Two-Factor Authentication).
                Enter your current OTP code to continue.
              </div>
              <div class="form-group">
                <label>OTP Code</label>
                <input
                  type="text"
                  class="form-control"
                  [(ngModel)]="form.otpCode"
                  placeholder="Enter 6-digit OTP code"
                  maxlength="6"
                  pattern="[0-9]*"
                  autocomplete="one-time-code"
                />
              </div>
            </div>

            <!-- OTP Secret for Auto-Login (optional) -->
            <div class="form-group">
              <label>OTP Secret (optional)</label>
              <input
                type="password"
                class="form-control"
                [(ngModel)]="form.otpSecret"
                placeholder="Base32 TOTP secret for auto-login"
              />
              <small class="form-text text-muted">
                If your server requires OTP, enter your TOTP secret here for automatic code generation.
                This is the secret key from your authenticator app setup (e.g., JBSWY3DPEHPK3PXP).
              </small>
            </div>

            <!-- Test Result -->
            <div
              class="alert"
              [class.alert-success]="form.testResult?.success"
              [class.alert-danger]="form.testResult && !form.testResult.success"
              *ngIf="form.testResult"
            >
              <i
                class="fas"
                [class.fa-check]="form.testResult.success"
                [class.fa-times]="!form.testResult.success"
              ></i>
              {{ form.testResult.message }}
            </div>

            <div class="form-actions">
              <button
                class="btn btn-secondary"
                (click)="testConnection()"
                [disabled]="form.isTesting || !isFormValid()"
              >
                <i class="fas" [class.fa-sync]="form.isTesting" [class.fa-spin]="form.isTesting" [class.fa-plug]="!form.isTesting"></i>
                {{ form.isTesting ? 'Testing...' : 'Test Connection' }}
              </button>
              <button
                class="btn btn-primary"
                (click)="saveServer()"
                [disabled]="!isFormValid()"
              >
                <i class="fas fa-save"></i>
                {{ form.editingServerId ? 'Update' : 'Add' }} Server
              </button>
              <button class="btn btn-outline-secondary" (click)="cancelEdit()">
                Cancel
              </button>
            </div>
          </div>
        </div>

        <!-- Server List -->
        <div class="server-list">
          <div
            class="server-card"
            *ngFor="let server of servers"
            [class.disabled]="!server.enabled"
            [class.connected]="isServerConnected(server.id)"
          >
            <!-- Status indicator -->
            <div class="server-status-dot"
                 [class.online]="isServerConnected(server.id)"
                 [class.offline]="!isServerConnected(server.id) && server.enabled"
                 [class.paused]="!server.enabled">
            </div>

            <!-- Server avatar -->
            <div class="server-avatar" [class.active]="isServerConnected(server.id)">
              <i class="fas fa-server"></i>
            </div>

            <!-- Server info -->
            <div class="server-info">
              <div class="server-name">{{ server.name }}</div>
              <div class="server-url-row">
                <i class="fas fa-link"></i>
                <span>{{ server.url }}</span>
              </div>
              <div class="server-stats">
                <span class="stat connected" *ngIf="isServerConnected(server.id)">
                  <i class="fas fa-check-circle"></i> Connected
                </span>
                <span class="stat disconnected" *ngIf="!isServerConnected(server.id) && server.enabled">
                  <i class="fas fa-times-circle"></i> Offline
                </span>
                <span class="stat disabled" *ngIf="!server.enabled">
                  <i class="fas fa-pause-circle"></i> Disabled
                </span>
                <span class="stat targets" *ngIf="getServerTargetCount(server.id) > 0">
                  <i class="fas fa-desktop"></i> {{ getServerTargetCount(server.id) }} targets
                </span>
                <span class="stat user">
                  <i class="fas fa-user"></i> {{ server.username }}
                </span>
              </div>
              <div class="server-error" *ngIf="getServerError(server.id)">
                <i class="fas fa-exclamation-triangle"></i>
                {{ getServerError(server.id) }}
              </div>
            </div>

            <!-- Actions -->
            <div class="server-actions">
              <button
                class="action-btn refresh"
                (click)="refreshServer(server.id)"
                [disabled]="!server.enabled || isLoading"
                title="Refresh targets"
              >
                <i class="fas fa-sync-alt"></i>
              </button>
              <button
                class="action-btn edit"
                (click)="editServer(server)"
                [disabled]="form.isEditing"
                title="Edit server"
              >
                <i class="fas fa-pen"></i>
              </button>
              <button
                class="action-btn toggle"
                [class.enabled]="server.enabled"
                (click)="toggleServer(server)"
                [disabled]="form.isEditing"
                [title]="server.enabled ? 'Disable server' : 'Enable server'"
              >
                <i class="fas" [class.fa-toggle-on]="server.enabled" [class.fa-toggle-off]="!server.enabled"></i>
              </button>
              <button
                class="action-btn delete"
                (click)="deleteServer(server)"
                [disabled]="form.isEditing"
                title="Delete server"
              >
                <i class="fas fa-trash-alt"></i>
              </button>
            </div>
          </div>

          <!-- Empty state -->
          <div class="empty-state" *ngIf="servers.length === 0">
            <div class="empty-icon">
              <i class="fas fa-plug"></i>
            </div>
            <h4>No Servers</h4>
            <p>Add your first Warpgate server to get started</p>
          </div>
        </div>
      </div>

      <!-- Plugin Settings -->
      <div class="plugin-settings mt-4">
        <h4>Plugin Settings</h4>

        <div class="form-group">
          <label>Auto-refresh Interval</label>
          <select class="form-control" [(ngModel)]="config.autoRefreshInterval" (ngModelChange)="savePluginConfig()">
            <option [value]="0">Disabled</option>
            <option [value]="30000">30 seconds</option>
            <option [value]="60000">1 minute</option>
            <option [value]="300000">5 minutes</option>
            <option [value]="600000">10 minutes</option>
          </select>
          <small class="form-text text-muted">
            Automatically refresh target list from all connected servers
          </small>
        </div>

        <div class="form-check mb-3">
          <input
            type="checkbox"
            class="form-check-input"
            id="showOfflineServers"
            [(ngModel)]="config.showOfflineServers"
            (ngModelChange)="savePluginConfig()"
          />
          <label class="form-check-label" for="showOfflineServers">
            Show offline servers in host list
          </label>
        </div>

        <div class="form-check mb-3">
          <input
            type="checkbox"
            class="form-check-input"
            id="groupByServer"
            [(ngModel)]="config.groupByServer"
            (ngModelChange)="savePluginConfig()"
          />
          <label class="form-check-label" for="groupByServer">
            Group hosts by server
          </label>
        </div>

        <div class="form-group">
          <label>Sort hosts by</label>
          <select class="form-control" [(ngModel)]="config.sortBy" (ngModelChange)="savePluginConfig()">
            <option value="name">Name</option>
            <option value="server">Server</option>
            <option value="kind">Type</option>
            <option value="group">Group</option>
          </select>
        </div>

        <div class="form-group">
          <label>Authentication Method</label>
          <select class="form-control" [(ngModel)]="config.authMethod" (ngModelChange)="savePluginConfig()">
            <option value="auto">Auto (prefer tickets, fallback to password)</option>
            <option value="ticket">Tickets only (one-time use tokens)</option>
            <option value="password">Password only (keyboard-interactive)</option>
          </select>
          <small class="form-text text-muted">
            <strong>Auto:</strong> Tries to create a one-time ticket first, falls back to password if ticket creation fails.<br>
            <strong>Tickets:</strong> Uses Warpgate tickets for authentication. Requires admin access to create tickets.<br>
            <strong>Password:</strong> Uses keyboard-interactive authentication with password (and OTP if required by server).
          </small>
        </div>

        <div class="form-check mb-3">
          <input
            type="checkbox"
            class="form-check-input"
            id="debugMode"
            [(ngModel)]="config.debugMode"
            (ngModelChange)="savePluginConfig()"
          />
          <label class="form-check-label" for="debugMode">
            Enable debug logging
          </label>
          <small class="form-text text-muted d-block">
            Log detailed debug messages to the developer console (useful for troubleshooting)
          </small>
        </div>
      </div>

      <!-- Actions -->
      <div class="global-actions mt-4">
        <button
          class="btn btn-outline-primary me-2"
          (click)="refreshAll()"
          [disabled]="isLoading || servers.length === 0"
        >
          <i class="fas fa-sync" [class.fa-spin]="isLoading"></i>
          Refresh All Targets
        </button>
        <button
          class="btn btn-outline-secondary me-2"
          (click)="reconnectAll()"
          [disabled]="isLoading || servers.length === 0"
        >
          <i class="fas fa-plug"></i>
          Reconnect All
        </button>
      </div>
    </div>
  `,
  styles: [`
    .warpgate-settings {
      padding: 20px;
      max-width: 800px;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }

    .section-header h4 {
      margin: 0;
      font-weight: 600;
    }

    .server-form {
      background: var(--bs-tertiary-bg, #f8f9fa);
      border-radius: 12px;
      border: 1px solid var(--bs-border-color, #dee2e6);
    }

    .server-form .card-body {
      padding: 20px;
    }

    .server-form .card-title {
      font-weight: 600;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--bs-border-color, #dee2e6);
    }

    .form-group {
      margin-bottom: 15px;
    }

    .form-group label {
      font-weight: 500;
      margin-bottom: 6px;
      display: block;
    }

    .form-actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      padding-top: 15px;
      border-top: 1px solid var(--bs-border-color, #dee2e6);
    }

    /* Server List */
    .server-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Server Card */
    .server-card {
      display: flex;
      align-items: center;
      padding: 16px;
      background: var(--bs-body-bg, #fff);
      border: 1px solid var(--bs-border-color, #dee2e6);
      border-radius: 12px;
      position: relative;
      transition: all 0.2s ease;
    }

    .server-card:hover {
      border-color: #667eea;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
      transform: translateY(-2px);
    }

    .server-card.disabled {
      opacity: 0.6;
      background: var(--bs-tertiary-bg, #f8f9fa);
    }

    .server-card.connected {
      border-left: 3px solid #28a745;
    }

    /* Status Dot */
    .server-status-dot {
      position: absolute;
      top: 16px;
      left: 16px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #6c757d;
      box-shadow: 0 0 0 2px var(--bs-body-bg, #fff);
    }

    .server-status-dot.online {
      background: #28a745;
      animation: pulse 2s infinite;
    }

    .server-status-dot.offline {
      background: #dc3545;
    }

    .server-status-dot.paused {
      background: #6c757d;
    }

    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 2px var(--bs-body-bg, #fff), 0 0 0 4px rgba(40, 167, 69, 0.3); }
      50% { box-shadow: 0 0 0 2px var(--bs-body-bg, #fff), 0 0 0 6px rgba(40, 167, 69, 0); }
    }

    /* Server Avatar */
    .server-avatar {
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 12px;
      margin-left: 12px;
      margin-right: 16px;
      font-size: 1.2rem;
      flex-shrink: 0;
      transition: all 0.2s;
    }

    .server-avatar.active {
      background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
      box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
    }

    /* Server Info */
    .server-info {
      flex: 1;
      min-width: 0;
    }

    .server-name {
      font-weight: 600;
      font-size: 1rem;
      color: var(--bs-body-color);
      margin-bottom: 4px;
    }

    .server-url-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: var(--bs-secondary-color, #6c757d);
      margin-bottom: 8px;
    }

    .server-url-row i {
      font-size: 0.7rem;
      opacity: 0.7;
    }

    .server-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .server-stats .stat {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.8rem;
      padding: 3px 8px;
      border-radius: 6px;
      background: var(--bs-tertiary-bg, #f8f9fa);
    }

    .server-stats .stat i {
      font-size: 0.7rem;
    }

    .server-stats .stat.connected {
      background: rgba(40, 167, 69, 0.15);
      color: #28a745;
    }

    .server-stats .stat.disconnected {
      background: rgba(220, 53, 69, 0.15);
      color: #dc3545;
    }

    .server-stats .stat.disabled {
      background: rgba(108, 117, 125, 0.15);
      color: #6c757d;
    }

    .server-stats .stat.targets {
      background: rgba(13, 110, 253, 0.15);
      color: #0d6efd;
    }

    .server-stats .stat.user {
      color: var(--bs-secondary-color, #6c757d);
    }

    .server-error {
      margin-top: 8px;
      padding: 6px 10px;
      background: rgba(220, 53, 69, 0.1);
      border-radius: 6px;
      font-size: 0.8rem;
      color: #dc3545;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Server Actions */
    .server-actions {
      display: flex;
      gap: 6px;
      margin-left: 16px;
    }

    .action-btn {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--bs-border-color, #dee2e6);
      border-radius: 8px;
      background: var(--bs-body-bg, #fff);
      color: var(--bs-secondary-color, #6c757d);
      cursor: pointer;
      transition: all 0.2s;
    }

    .action-btn:hover:not(:disabled) {
      border-color: var(--bs-primary);
      color: var(--bs-primary);
      background: rgba(13, 110, 253, 0.1);
    }

    .action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .action-btn.refresh:hover:not(:disabled) {
      border-color: #0d6efd;
      color: #0d6efd;
      background: rgba(13, 110, 253, 0.1);
    }

    .action-btn.edit:hover:not(:disabled) {
      border-color: #ffc107;
      color: #ffc107;
      background: rgba(255, 193, 7, 0.1);
    }

    .action-btn.toggle {
      font-size: 1.1rem;
    }

    .action-btn.toggle.enabled {
      color: #28a745;
    }

    .action-btn.toggle:hover:not(:disabled) {
      border-color: #28a745;
      background: rgba(40, 167, 69, 0.1);
    }

    .action-btn.delete:hover:not(:disabled) {
      border-color: #dc3545;
      color: #dc3545;
      background: rgba(220, 53, 69, 0.1);
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      background: var(--bs-tertiary-bg, #f8f9fa);
      border-radius: 12px;
      border: 2px dashed var(--bs-border-color, #dee2e6);
    }

    .empty-icon {
      width: 64px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 50%;
      margin: 0 auto 16px;
      font-size: 1.5rem;
    }

    .empty-state h4 {
      margin: 0 0 8px 0;
      font-weight: 600;
      color: var(--bs-body-color);
    }

    .empty-state p {
      margin: 0;
      color: var(--bs-secondary-color, #6c757d);
    }

    /* Plugin Settings */
    .plugin-settings {
      padding: 20px;
      background: var(--bs-tertiary-bg, #f8f9fa);
      border-radius: 12px;
    }

    .plugin-settings h4 {
      margin: 0 0 20px 0;
      font-weight: 600;
    }

    .plugin-settings .form-group {
      max-width: 400px;
    }

    /* Global Actions */
    .global-actions {
      border-top: 1px solid var(--bs-border-color, #dee2e6);
      padding-top: 20px;
    }

    /* OTP Section */
    .otp-section {
      margin: 20px 0;
      padding: 16px;
      background: rgba(13, 110, 253, 0.1);
      border-radius: 10px;
      border: 1px solid rgba(13, 110, 253, 0.2);
    }

    .otp-section .alert {
      margin-bottom: 12px;
    }
  `],
})
export class WarpgateSettingsComponent implements OnInit, OnDestroy {
  servers: WarpgateServerConfig[] = [];
  config: WarpgatePluginConfig;
  connectionStatus: Map<string, WarpgateConnectionStatus> = new Map();
  isLoading = false;

  form: ServerFormState = {
    isEditing: false,
    editingServerId: null,
    name: '',
    url: '',
    username: '',
    password: '',
    trustSelfSigned: false,
    enabled: true,
    isTesting: false,
    testResult: null,
    needsOtp: false,
    otpCode: '',
    otpSecret: '',
  };

  private subscriptions: Subscription[] = [];

  constructor(@Inject(WarpgateService) private warpgateService: WarpgateService) {
    this.config = this.warpgateService.getConfig();
  }

  ngOnInit(): void {
    this.loadServers();

    // Subscribe to status updates
    this.subscriptions.push(
      this.warpgateService.status$.subscribe(status => {
        this.connectionStatus = status;
      })
    );

    this.subscriptions.push(
      this.warpgateService.loading$.subscribe(loading => {
        this.isLoading = loading;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  loadServers(): void {
    this.servers = this.warpgateService.getServers();
  }

  showAddServerForm(): void {
    this.resetForm();
    this.form.isEditing = true;
  }

  editServer(server: WarpgateServerConfig): void {
    this.form = {
      isEditing: true,
      editingServerId: server.id,
      name: server.name,
      url: server.url,
      username: server.username,
      password: server.password || '',
      trustSelfSigned: server.trustSelfSigned || false,
      enabled: server.enabled,
      isTesting: false,
      testResult: null,
      needsOtp: false,
      otpCode: '',
      otpSecret: server.otpSecret || '',
    };
  }

  cancelEdit(): void {
    this.resetForm();
  }

  resetForm(): void {
    this.form = {
      isEditing: false,
      editingServerId: null,
      name: '',
      url: '',
      username: '',
      password: '',
      trustSelfSigned: false,
      enabled: true,
      isTesting: false,
      testResult: null,
      needsOtp: false,
      otpCode: '',
      otpSecret: '',
    };
  }

  isFormValid(): boolean {
    return !!(
      this.form.name.trim() &&
      this.form.url.trim() &&
      this.form.username.trim() &&
      this.form.password.trim()
    );
  }

  async testConnection(): Promise<void> {
    if (!this.isFormValid()) return;

    this.form.isTesting = true;
    this.form.testResult = null;

    try {
      // If OTP is needed and we have a code, submit it
      if (this.form.needsOtp && this.form.otpCode) {
        const result = await this.warpgateService.testServerConnectionWithOtp(
          this.form.url,
          this.form.otpCode,
          this.form.trustSelfSigned
        );

        if (result.success) {
          this.form.needsOtp = false;
          this.form.otpCode = '';
          this.form.testResult = {
            success: true,
            message: 'Connection successful!',
          };
        } else {
          this.form.testResult = {
            success: false,
            message: `OTP verification failed: ${result.error}`,
          };
        }
        return;
      }

      // Generate OTP from secret if available
      let otpCode: string | undefined;
      if (this.form.otpSecret) {
        try {
          const { generateTOTP } = await import('../utils/totp');
          otpCode = await generateTOTP(this.form.otpSecret);
        } catch {
          // Ignore OTP generation errors, will prompt manually
        }
      }

      const result = await this.warpgateService.testServerConnectionFull(
        this.form.url,
        this.form.username,
        this.form.password,
        this.form.trustSelfSigned,
        otpCode
      );

      if (result.needsOtp) {
        this.form.needsOtp = true;
        this.form.testResult = {
          success: false,
          message: 'Server requires OTP. Please enter your 6-digit code above.',
        };
      } else if (result.success) {
        this.form.needsOtp = false;
        this.form.testResult = {
          success: true,
          message: 'Connection successful!',
        };
      } else {
        this.form.testResult = {
          success: false,
          message: `Connection failed: ${result.error}`,
        };
      }
    } catch (error) {
      this.form.testResult = {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    } finally {
      this.form.isTesting = false;
    }
  }

  async saveServer(): Promise<void> {
    if (!this.isFormValid()) return;

    const serverData: Partial<WarpgateServerConfig> = {
      name: this.form.name.trim(),
      url: this.form.url.trim(),
      username: this.form.username.trim(),
      password: this.form.password,
      trustSelfSigned: this.form.trustSelfSigned,
      enabled: this.form.enabled,
      otpSecret: this.form.otpSecret.trim() || undefined,
    };

    if (this.form.editingServerId) {
      await this.warpgateService.updateServer(this.form.editingServerId, serverData);
    } else {
      await this.warpgateService.addServer(serverData as Omit<WarpgateServerConfig, 'id'>);
    }

    this.loadServers();
    this.resetForm();
  }

  async deleteServer(server: WarpgateServerConfig): Promise<void> {
    if (confirm(`Are you sure you want to delete "${server.name}"?`)) {
      this.warpgateService.removeServer(server.id);
      this.loadServers();
    }
  }

  async toggleServer(server: WarpgateServerConfig): Promise<void> {
    await this.warpgateService.updateServer(server.id, { enabled: !server.enabled });
    this.loadServers();
  }

  async refreshServer(serverId: string): Promise<void> {
    if (!this.warpgateService.isConnected(serverId)) {
      await this.warpgateService.connect(serverId);
    } else {
      await this.warpgateService.refreshTargets(serverId);
    }
  }

  async refreshAll(): Promise<void> {
    await this.warpgateService.refreshAllTargets();
  }

  async reconnectAll(): Promise<void> {
    await this.warpgateService.connectAll();
  }

  savePluginConfig(): void {
    // Only save the plugin settings, NOT the servers array
    // Servers are managed separately via addServer/updateServer/removeServer
    // Passing the full config object would overwrite servers with stale data
    this.warpgateService.saveConfig({
      autoRefreshInterval: this.config.autoRefreshInterval,
      showOfflineServers: this.config.showOfflineServers,
      groupByServer: this.config.groupByServer,
      sortBy: this.config.sortBy,
      authMethod: this.config.authMethod,
      debugMode: this.config.debugMode,
    });
  }

  isServerConnected(serverId: string): boolean {
    return this.connectionStatus.get(serverId)?.connected || false;
  }

  getServerTargetCount(serverId: string): number {
    return this.connectionStatus.get(serverId)?.targets.length || 0;
  }

  getServerError(serverId: string): string | undefined {
    const status = this.connectionStatus.get(serverId);
    return status?.connected ? undefined : status?.lastError;
  }
}
