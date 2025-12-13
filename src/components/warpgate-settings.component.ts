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
            class="server-item card mb-2"
            *ngFor="let server of servers"
            [class.disabled]="!server.enabled"
          >
            <div class="card-body d-flex align-items-center">
              <div class="server-status me-3">
                <i
                  class="fas fa-circle"
                  [class.text-success]="isServerConnected(server.id)"
                  [class.text-danger]="!isServerConnected(server.id) && server.enabled"
                  [class.text-muted]="!server.enabled"
                ></i>
              </div>

              <div class="server-info flex-grow-1">
                <div class="server-name fw-bold">{{ server.name }}</div>
                <div class="server-url text-muted small">{{ server.url }}</div>
                <div class="server-user text-muted small">
                  <i class="fas fa-user"></i> {{ server.username }}
                </div>
                <div
                  class="server-targets text-muted small"
                  *ngIf="getServerTargetCount(server.id) > 0"
                >
                  <i class="fas fa-server"></i>
                  {{ getServerTargetCount(server.id) }} targets available
                </div>
                <div
                  class="server-error text-danger small"
                  *ngIf="getServerError(server.id)"
                >
                  <i class="fas fa-exclamation-triangle"></i>
                  {{ getServerError(server.id) }}
                </div>
              </div>

              <div class="server-actions">
                <button
                  class="btn btn-sm btn-outline-primary me-1"
                  (click)="refreshServer(server.id)"
                  [disabled]="!server.enabled || isLoading"
                  title="Refresh targets"
                >
                  <i class="fas fa-sync"></i>
                </button>
                <button
                  class="btn btn-sm btn-outline-secondary me-1"
                  (click)="editServer(server)"
                  [disabled]="form.isEditing"
                  title="Edit server"
                >
                  <i class="fas fa-edit"></i>
                </button>
                <button
                  class="btn btn-sm"
                  [class.btn-outline-success]="!server.enabled"
                  [class.btn-outline-warning]="server.enabled"
                  (click)="toggleServer(server)"
                  [disabled]="form.isEditing"
                  [title]="server.enabled ? 'Disable server' : 'Enable server'"
                >
                  <i class="fas" [class.fa-toggle-on]="server.enabled" [class.fa-toggle-off]="!server.enabled"></i>
                </button>
                <button
                  class="btn btn-sm btn-outline-danger ms-1"
                  (click)="deleteServer(server)"
                  [disabled]="form.isEditing"
                  title="Delete server"
                >
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </div>
          </div>

          <div class="text-muted text-center py-4" *ngIf="servers.length === 0">
            <i class="fas fa-server fa-2x mb-2"></i>
            <p>No Warpgate servers configured.</p>
            <p>Click "Add Server" to get started.</p>
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
          <label>Default SFTP Path</label>
          <input
            type="text"
            class="form-control"
            [(ngModel)]="config.defaultSftpPath"
            (ngModelChange)="savePluginConfig()"
            placeholder="~"
          />
          <small class="form-text text-muted">
            Initial directory path when opening SFTP sessions
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

    .server-form {
      background: var(--bs-tertiary-bg, #f8f9fa);
    }

    .form-group {
      margin-bottom: 15px;
    }

    .form-actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
    }

    .server-item {
      transition: opacity 0.2s;
    }

    .server-item.disabled {
      opacity: 0.6;
    }

    .server-status i {
      font-size: 12px;
    }

    .server-actions {
      display: flex;
      gap: 2px;
    }

    .server-actions .btn {
      padding: 0.25rem 0.5rem;
    }

    .plugin-settings .form-group {
      max-width: 400px;
    }

    .global-actions {
      border-top: 1px solid var(--bs-border-color, #dee2e6);
      padding-top: 20px;
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
    this.warpgateService.saveConfig(this.config);
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
