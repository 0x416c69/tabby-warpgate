/**
 * Warpgate Settings Component
 * Settings tab for configuring Warpgate servers and plugin options
 */

import { Component, OnInit, OnDestroy, Inject, Optional } from '@angular/core';
import { Subscription } from 'rxjs';
import { PlatformService } from 'tabby-core';

import { WarpgateService } from '../services/warpgate.service';
import { WarpgateHostSettingsService } from '../services/host-settings.service';
import { WarpgateHistoryService } from '../services/history.service';
import {
  WarpgateServerConfig,
  WarpgatePluginConfig,
  WarpgateConnectionStatus,
} from '../models/warpgate.models';
import { generateTOTP, isValidTOTPSecret } from '../utils/totp';
import { WARPGATE_THEME_STYLES } from './shared.styles';

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
  isSaving: boolean;
  testResult: { success: boolean; message: string } | null;
  /** OTP-related state */
  needsOtp: boolean;
  otpCode: string;
  otpSecret: string;
  /** SSH defaults for all hosts of the server */
  agentForward: boolean;
  x11: boolean;
  keepaliveSeconds: number | null;
}

/** Result of an OTP action shown on a server card */
interface OtpNotice {
  serverId: string;
  success: boolean;
  message: string;
  secret?: string;
}

/** Auto-refresh choices */
const REFRESH_INTERVALS = [
  { value: 0, label: 'Disabled' },
  { value: 30000, label: 'Every 30 seconds' },
  { value: 60000, label: 'Every minute' },
  { value: 300000, label: 'Every 5 minutes' },
  { value: 600000, label: 'Every 10 minutes' },
];

@Component({
  selector: 'warpgate-settings',
  template: `
    <div class="warpgate-settings">
      <header class="page-head">
        <div class="brand-mark"><i class="fas fa-network-wired"></i></div>
        <div>
          <h3>Warpgate</h3>
          <p>Connect to Warpgate SSH gateways and open any target with one click.</p>
        </div>
      </header>

      <!-- Servers -->
      <section class="panel">
        <div class="panel-head">
          <div>
            <h4>Servers</h4>
            <p>{{ servers.length }} configured</p>
          </div>
          <button class="wg-btn wg-btn-primary" (click)="showAddServerForm()" [disabled]="form.isEditing">
            <i class="fas fa-plus"></i> Add server
          </button>
        </div>

        <!-- Server Form -->
        <div class="server-form" *ngIf="form.isEditing">
          <h5>{{ form.editingServerId ? 'Edit server' : 'Add server' }}</h5>

          <div class="wg-row">
            <div class="wg-field">
              <label for="wg-server-name">Name</label>
              <input id="wg-server-name" class="wg-input" [(ngModel)]="form.name" placeholder="Production gateway" />
            </div>
            <div class="wg-field">
              <label for="wg-server-url">URL</label>
              <input id="wg-server-url" class="wg-input" [(ngModel)]="form.url" placeholder="https://warpgate.example.com" />
            </div>
          </div>

          <div class="wg-row">
            <div class="wg-field">
              <label for="wg-server-user">Username</label>
              <input id="wg-server-user" class="wg-input" [(ngModel)]="form.username" placeholder="your-username" autocomplete="username" />
            </div>
            <div class="wg-field">
              <label for="wg-server-password">Password</label>
              <input id="wg-server-password" type="password" class="wg-input" [(ngModel)]="form.password" placeholder="••••••••" autocomplete="current-password" />
            </div>
          </div>

          <div class="wg-field">
            <label for="wg-server-otp-secret">OTP secret <span class="optional">optional</span></label>
            <input
              id="wg-server-otp-secret"
              type="password"
              class="wg-input"
              [(ngModel)]="form.otpSecret"
              placeholder="Base32 TOTP secret, e.g. JBSWY3DPEHPK3PXP"
              autocomplete="off"
            />
            <div class="wg-hint">
              Lets the plugin answer two-factor prompts automatically. Use the secret from your authenticator setup,
              or use “Set up OTP” on a connected server to create one.
            </div>
            <div class="field-error" *ngIf="form.otpSecret.trim() && !isOtpSecretValid()">
              <i class="fas fa-exclamation-circle"></i> This is not a valid Base32 secret
            </div>
          </div>

          <div class="otp-section" *ngIf="form.needsOtp">
            <i class="fas fa-key"></i>
            <div class="wg-field">
              <label for="wg-server-otp-code">One-time code</label>
              <input
                id="wg-server-otp-code"
                class="wg-input otp-input"
                [(ngModel)]="form.otpCode"
                placeholder="000000"
                maxlength="6"
                inputmode="numeric"
                autocomplete="one-time-code"
                (keyup.enter)="testConnection()"
              />
              <div class="wg-hint">This server requires two-factor authentication. Enter the current code and test again.</div>
            </div>
          </div>

          <div class="form-section-title">SSH defaults for this server's hosts</div>
          <div class="toggles">
            <label class="wg-switch">
              <input type="checkbox" [(ngModel)]="form.agentForward" />
              <span class="track"></span> Agent forwarding
            </label>
            <label class="wg-switch">
              <input type="checkbox" [(ngModel)]="form.x11" />
              <span class="track"></span> X11 forwarding
            </label>
            <div class="keepalive">
              <label for="wg-server-keepalive">Keepalive</label>
              <input id="wg-server-keepalive" class="wg-input" type="number" min="0" [(ngModel)]="form.keepaliveSeconds" placeholder="default" />
              <span>sec</span>
            </div>
          </div>

          <div class="toggles">
            <label class="wg-switch">
              <input type="checkbox" [(ngModel)]="form.trustSelfSigned" />
              <span class="track"></span> Trust self-signed certificates
            </label>
            <label class="wg-switch">
              <input type="checkbox" [(ngModel)]="form.enabled" />
              <span class="track"></span> Enabled
            </label>
          </div>

          <div class="result" *ngIf="form.testResult" [class.success]="form.testResult.success">
            <i class="fas" [class.fa-check-circle]="form.testResult.success" [class.fa-times-circle]="!form.testResult.success"></i>
            {{ form.testResult.message }}
          </div>

          <div class="form-actions">
            <button class="wg-btn" (click)="testConnection()" [disabled]="form.isTesting || !isFormValid()">
              <i class="fas" [class.fa-plug]="!form.isTesting" [class.fa-circle-notch]="form.isTesting" [class.spin]="form.isTesting"></i>
              {{ form.isTesting ? 'Testing…' : 'Test connection' }}
            </button>
            <span class="spacer"></span>
            <button class="wg-btn wg-btn-ghost" (click)="cancelEdit()">Cancel</button>
            <button class="wg-btn wg-btn-primary" (click)="saveServer()" [disabled]="!isFormValid() || form.isSaving">
              <i class="fas fa-check"></i>
              {{ form.editingServerId ? 'Save changes' : 'Add server' }}
            </button>
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
            <div class="server-avatar" [class.active]="isServerConnected(server.id)">
              <i class="fas fa-server"></i>
            </div>

            <div class="server-info">
              <div class="server-name">
                {{ server.name }}
                <span class="status-pill" [class.online]="isServerConnected(server.id)" [class.paused]="!server.enabled">
                  {{ !server.enabled ? 'Disabled' : (isServerConnected(server.id) ? 'Connected' : 'Offline') }}
                </span>
              </div>
              <div class="server-meta">
                <span><i class="fas fa-link"></i> {{ server.url }}</span>
                <span><i class="fas fa-user"></i> {{ server.username }}</span>
                <span *ngIf="getServerTargetCount(server.id) > 0"><i class="fas fa-desktop"></i> {{ getServerTargetCount(server.id) }} hosts</span>
                <span *ngIf="hasOtpSecret(server)" class="otp-on"><i class="fas fa-shield-alt"></i> Auto OTP</span>
              </div>
              <div class="server-error" *ngIf="getServerError(server.id)">
                <i class="fas fa-exclamation-triangle"></i> {{ getServerError(server.id) }}
              </div>
              <div class="otp-notice" *ngIf="otpNotice?.serverId === server.id" [class.success]="otpNotice!.success">
                <div>{{ otpNotice!.message }}</div>
                <div class="secret" *ngIf="otpNotice!.secret">
                  <code>{{ otpNotice!.secret }}</code>
                  <button class="wg-btn wg-btn-sm" (click)="copySecret(otpNotice!.secret!)"><i class="far fa-copy"></i> Copy</button>
                </div>
              </div>
            </div>

            <div class="server-actions">
              <button
                class="wg-btn wg-btn-sm"
                *ngIf="isServerConnected(server.id) && !hasOtpSecret(server)"
                (click)="setupOtp(server)"
                [disabled]="otpBusy === server.id"
                title="Create an OTP credential on Warpgate and store its secret for automatic two-factor login"
              >
                <i class="fas fa-shield-alt"></i> Set up OTP
              </button>
              <button
                class="wg-btn wg-btn-sm wg-btn-danger"
                *ngIf="isServerConnected(server.id) && hasOtpSecret(server)"
                (click)="disableOtp(server)"
                [disabled]="otpBusy === server.id"
                title="Remove OTP from your Warpgate account and forget the stored secret"
              >
                <i class="fas fa-shield-alt"></i> Disable OTP
              </button>
              <button class="wg-icon-btn" (click)="refreshServer(server.id)" [disabled]="!server.enabled || isLoading" title="Reconnect and refresh" aria-label="Reconnect and refresh">
                <i class="fas fa-sync-alt"></i>
              </button>
              <button class="wg-icon-btn" (click)="editServer(server)" [disabled]="form.isEditing" title="Edit" aria-label="Edit server">
                <i class="fas fa-pen"></i>
              </button>
              <label class="wg-switch" [title]="server.enabled ? 'Disable server' : 'Enable server'">
                <input type="checkbox" [ngModel]="server.enabled" (ngModelChange)="toggleServer(server)" [disabled]="form.isEditing" />
                <span class="track"></span>
              </label>
              <button class="wg-icon-btn danger" (click)="deleteServer(server)" [disabled]="form.isEditing" title="Delete" aria-label="Delete server">
                <i class="fas fa-trash-alt"></i>
              </button>
            </div>
          </div>

          <div class="wg-empty" *ngIf="servers.length === 0 && !form.isEditing">
            <div class="wg-empty-icon"><i class="fas fa-plug"></i></div>
            <h4>No servers yet</h4>
            <p>Add your Warpgate server to see all of your SSH targets in the Warpgate Hosts tab.</p>
          </div>
        </div>
      </section>

      <!-- Plugin Settings -->
      <section class="panel">
        <div class="panel-head">
          <div>
            <h4>Preferences</h4>
            <p>How hosts are listed and how connections authenticate</p>
          </div>
        </div>

        <div class="prefs">
          <div class="wg-field">
            <label for="wg-pref-refresh">Auto-refresh</label>
            <select id="wg-pref-refresh" class="wg-select" [(ngModel)]="config.autoRefreshInterval" (ngModelChange)="savePluginConfig()">
              <option *ngFor="let option of refreshIntervals" [ngValue]="option.value">{{ option.label }}</option>
            </select>
          </div>

          <div class="wg-field">
            <label for="wg-pref-sort">Sort hosts by</label>
            <select id="wg-pref-sort" class="wg-select" [(ngModel)]="config.sortBy" (ngModelChange)="savePluginConfig()">
              <option value="name">Name</option>
              <option value="recent">Recently used</option>
              <option value="server">Server</option>
              <option value="group">Group</option>
              <option value="kind">Type</option>
            </select>
          </div>

          <div class="wg-field wide">
            <label for="wg-pref-auth">Authentication</label>
            <select id="wg-pref-auth" class="wg-select" [(ngModel)]="config.authMethod" (ngModelChange)="savePluginConfig()">
              <option value="auto">Automatic: one-time tickets, password as fallback</option>
              <option value="ticket">Tickets only</option>
              <option value="password">Password only (keyboard-interactive + OTP)</option>
            </select>
            <div class="wg-hint">
              Tickets give passwordless one-click logins but require ticket permissions (admin) on Warpgate.
              A fresh ticket is created for every connection, including reconnects.
            </div>
          </div>
        </div>

        <div class="toggles prefs-toggles">
          <label class="wg-switch">
            <input type="checkbox" [(ngModel)]="config.groupByServer" (ngModelChange)="savePluginConfig()" />
            <span class="track"></span> Group hosts by server
          </label>
          <label class="wg-switch">
            <input type="checkbox" [(ngModel)]="config.showOfflineServers" (ngModelChange)="savePluginConfig()" />
            <span class="track"></span> Show hosts of offline servers
          </label>
          <label class="wg-switch" title="Runs uname and reads /etc/os-release on a separate channel after connecting">
            <input type="checkbox" [(ngModel)]="config.detectOs" (ngModelChange)="savePluginConfig()" />
            <span class="track"></span> Detect the operating system of hosts (OS icons)
          </label>
          <label class="wg-switch">
            <input type="checkbox" [(ngModel)]="config.debugMode" (ngModelChange)="savePluginConfig()" />
            <span class="track"></span> Debug logging (developer console)
          </label>
        </div>

        <div class="shortcuts">
          <div class="shortcut"><span class="wg-kbd">{{ modKey }}Shift+K</span> Quick connect from anywhere</div>
          <div class="shortcut"><span class="wg-kbd">{{ modKey }}Shift+J</span> Run a snippet in the current terminal</div>
          <div class="shortcut"><span class="wg-kbd">{{ modKey }}Shift+H</span> Open the Warpgate hosts tab</div>
          <div class="wg-hint">Change them in Settings → Hotkeys.</div>
        </div>
      </section>

      <div class="global-actions">
        <button class="wg-btn" (click)="refreshAll()" [disabled]="isLoading || servers.length === 0">
          <i class="fas fa-sync" [class.spin]="isLoading"></i> Refresh all hosts
        </button>
        <button class="wg-btn" (click)="reconnectAll()" [disabled]="isLoading || servers.length === 0">
          <i class="fas fa-plug"></i> Reconnect all
        </button>
      </div>
    </div>
  `,
  styles: [WARPGATE_THEME_STYLES, `
    .warpgate-settings { max-width: 860px; padding: 8px 4px 32px; font-size: 13px; }
    .page-head { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; }
    .page-head h3 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
    .page-head p { margin: 2px 0 0; color: var(--wg-muted); }
    .brand-mark {
      width: 46px; height: 46px; border-radius: 14px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      background: var(--wg-gradient); color: var(--wg-accent-fg); font-size: 18px;
      box-shadow: 0 12px 30px -12px var(--wg-accent), inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }

    .panel { padding: 20px; margin-bottom: 18px; border-radius: 18px; border: 1px solid var(--wg-border); background: var(--wg-surface); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
    .panel-head h4 { margin: 0; font-size: 15px; font-weight: 750; }
    .panel-head p { margin: 2px 0 0; font-size: 12px; color: var(--wg-subtle); }

    .server-form {
      padding: 18px; margin-bottom: 16px; border-radius: 16px;
      border: 1px solid var(--wg-accent-ring); background: var(--wg-bg);
      box-shadow: 0 0 0 4px var(--wg-accent-softer);
      animation: wg-rise 0.25s var(--wg-ease);
    }
    .server-form h5 { margin: 0 0 16px; font-size: 14px; font-weight: 750; }
    .optional { text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--wg-subtle); margin-left: 6px; }
    .field-error { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--wg-danger); }
    .form-section-title { margin: 6px 0 10px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--wg-subtle); }
    .toggles { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 26px; margin-bottom: 14px; }
    .keepalive { display: flex; align-items: center; gap: 8px; color: var(--wg-muted); }
    .keepalive label { font-size: 13px; color: var(--wg-fg); }
    .keepalive .wg-input { width: 90px; height: 32px; }

    .otp-section {
      display: flex; gap: 14px; padding: 14px; margin-bottom: 14px; border-radius: 12px;
      background: var(--wg-accent-softer); border: 1px solid var(--wg-accent-ring);
    }
    .otp-section > i { color: var(--wg-accent); margin-top: 26px; }
    .otp-section .wg-field { flex: 1; margin: 0; }
    .otp-input { max-width: 180px; font-family: var(--wg-mono); font-size: 18px; letter-spacing: 0.4em; text-align: center; height: 42px; }

    .result {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px; margin-bottom: 14px; border-radius: 10px;
      color: var(--wg-danger); background: color-mix(in srgb, var(--wg-danger) 10%, transparent);
    }
    .result.success { color: var(--wg-success); background: color-mix(in srgb, var(--wg-success) 11%, transparent); }
    .form-actions { display: flex; align-items: center; gap: 10px; padding-top: 14px; border-top: 1px solid var(--wg-border); }
    .spacer { flex: 1; }
    .spin { animation: wg-spin 0.9s linear infinite; }

    .server-list { display: flex; flex-direction: column; gap: 10px; }
    .server-card {
      display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 14px;
      border: 1px solid var(--wg-border); background: var(--wg-bg);
      transition: border-color 0.2s var(--wg-ease), box-shadow 0.2s var(--wg-ease);
    }
    .server-card:hover { border-color: var(--wg-border-strong); box-shadow: var(--wg-shadow); }
    .server-card.disabled { opacity: 0.6; }
    .server-avatar {
      width: 42px; height: 42px; border-radius: 13px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      background: var(--wg-surface-3); color: var(--wg-muted); font-size: 16px; transition: all 0.2s var(--wg-ease);
    }
    .server-avatar.active { background: linear-gradient(140deg, #34d399, #059669); color: #fff; box-shadow: 0 10px 22px -12px #10b981; }
    .server-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .server-name { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 750; }
    .status-pill {
      height: 20px; padding: 0 8px; border-radius: 999px; display: inline-flex; align-items: center;
      font-size: 10.5px; font-weight: 700; color: var(--wg-danger); background: color-mix(in srgb, var(--wg-danger) 13%, transparent);
    }
    .status-pill.online { color: var(--wg-success); background: color-mix(in srgb, var(--wg-success) 14%, transparent); }
    .status-pill.paused { color: var(--wg-muted); background: var(--wg-surface-3); }
    .server-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--wg-subtle); }
    .server-meta i { font-size: 10px; margin-right: 3px; }
    .server-meta .otp-on { color: var(--wg-accent); }
    .server-error { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--wg-danger); }
    .otp-notice {
      display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding: 10px 12px; border-radius: 10px; font-size: 12px;
      color: var(--wg-danger); background: color-mix(in srgb, var(--wg-danger) 10%, transparent);
    }
    .otp-notice.success { color: var(--wg-fg); background: var(--wg-accent-softer); border: 1px solid var(--wg-accent-ring); }
    .secret { display: flex; align-items: center; gap: 8px; }
    .secret code { font-family: var(--wg-mono); font-size: 12.5px; padding: 4px 8px; border-radius: 6px; background: var(--wg-surface-2); color: var(--wg-fg); letter-spacing: 0.06em; }
    .server-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .server-actions .wg-switch { margin: 0 6px; }
    .wg-icon-btn.danger:hover:not(:disabled) { color: var(--wg-danger); background: color-mix(in srgb, var(--wg-danger) 12%, transparent); }

    .prefs { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
    .prefs .wide { grid-column: 1 / -1; }
    .prefs-toggles { flex-direction: column; align-items: flex-start; gap: 12px; margin: 6px 0 18px; }
    .shortcuts { display: flex; flex-direction: column; gap: 8px; padding-top: 14px; border-top: 1px solid var(--wg-border); }
    .shortcut { display: flex; align-items: center; gap: 10px; color: var(--wg-muted); }
    .shortcut .wg-kbd { min-width: 96px; justify-content: center; }
    .global-actions { display: flex; gap: 10px; }
  `],
})
export class WarpgateSettingsComponent implements OnInit, OnDestroy {
  servers: WarpgateServerConfig[] = [];
  config: WarpgatePluginConfig;
  connectionStatus: Map<string, WarpgateConnectionStatus> = new Map();
  isLoading = false;
  otpBusy: string | null = null;
  otpNotice: OtpNotice | null = null;
  readonly refreshIntervals = REFRESH_INTERVALS;
  readonly modKey = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';

  form: ServerFormState = this.createEmptyForm();

  private subscriptions: Subscription[] = [];

  constructor(
    @Inject(WarpgateService) private warpgateService: WarpgateService,
    @Inject(WarpgateHostSettingsService) private hostSettings: WarpgateHostSettingsService,
    @Inject(WarpgateHistoryService) private history: WarpgateHistoryService,
    @Optional() @Inject(PlatformService) private platform: PlatformService | null
  ) {
    this.config = this.warpgateService.getConfig();
  }

  ngOnInit(): void {
    this.loadServers();

    this.subscriptions.push(
      this.warpgateService.status$.subscribe(status => {
        this.connectionStatus = status;
      }),
      this.warpgateService.loading$.subscribe(loading => {
        this.isLoading = loading;
      }),
      this.warpgateService.events$.subscribe(event => {
        if (event?.type === 'server-updated' || event?.type === 'server-added' || event?.type === 'server-removed') {
          this.loadServers();
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  loadServers(): void {
    this.servers = [...this.warpgateService.getServers()];
  }

  showAddServerForm(): void {
    this.form = { ...this.createEmptyForm(), isEditing: true };
  }

  editServer(server: WarpgateServerConfig): void {
    this.form = {
      ...this.createEmptyForm(),
      isEditing: true,
      editingServerId: server.id,
      name: server.name,
      url: server.url,
      username: server.username,
      password: server.password || '',
      trustSelfSigned: server.trustSelfSigned || false,
      enabled: server.enabled,
      otpSecret: server.otpSecret || '',
      agentForward: !!server.agentForward,
      x11: !!server.x11,
      keepaliveSeconds: server.keepaliveInterval !== undefined && server.keepaliveInterval !== null
        ? server.keepaliveInterval / 1000
        : null,
    };
  }

  cancelEdit(): void {
    this.resetForm();
  }

  resetForm(): void {
    this.form = this.createEmptyForm();
  }

  isFormValid(): boolean {
    return !!(
      this.form.name.trim() &&
      this.form.url.trim() &&
      this.form.username.trim() &&
      this.form.password.trim() &&
      (!this.form.otpSecret.trim() || this.isOtpSecretValid())
    );
  }

  isOtpSecretValid(): boolean {
    return isValidTOTPSecret(this.form.otpSecret.trim());
  }

  async testConnection(): Promise<void> {
    if (!this.isFormValid() || this.form.isTesting) return;

    this.form.isTesting = true;
    this.form.testResult = null;

    try {
      // If OTP is needed and we have a code, submit it for the pending login
      if (this.form.needsOtp && this.form.otpCode.trim()) {
        const result = await this.warpgateService.testServerConnectionWithOtp(
          this.form.url.trim(),
          this.form.username.trim(),
          this.form.otpCode.trim()
        );

        if (result.success) {
          this.form.needsOtp = false;
          this.form.otpCode = '';
          this.form.testResult = { success: true, message: 'Connection successful!' };
        } else {
          this.form.testResult = { success: false, message: `OTP verification failed: ${result.error}` };
        }
        return;
      }

      // Generate OTP from secret if available
      let otpCode: string | undefined;
      if (this.form.otpSecret.trim() && this.isOtpSecretValid()) {
        try {
          otpCode = await generateTOTP(this.form.otpSecret.trim());
        } catch {
          // Ignore OTP generation errors, will prompt manually
        }
      }

      const result = await this.warpgateService.testServerConnectionFull(
        this.form.url.trim(),
        this.form.username.trim(),
        this.form.password,
        this.form.trustSelfSigned,
        otpCode
      );

      if (result.needsOtp) {
        this.form.needsOtp = true;
        this.form.testResult = {
          success: false,
          message: 'Two-factor authentication required. Enter your one-time code above.',
        };
      } else if (result.success) {
        this.form.needsOtp = false;
        this.form.testResult = { success: true, message: 'Connection successful!' };
      } else {
        this.form.testResult = { success: false, message: `Connection failed: ${result.error}` };
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
    if (!this.isFormValid() || this.form.isSaving) return;

    const keepalive = this.form.keepaliveSeconds;
    const serverData: Partial<WarpgateServerConfig> = {
      name: this.form.name.trim(),
      url: this.form.url.trim(),
      username: this.form.username.trim(),
      password: this.form.password,
      trustSelfSigned: this.form.trustSelfSigned,
      enabled: this.form.enabled,
      otpSecret: this.form.otpSecret.trim() || undefined,
      agentForward: this.form.agentForward || undefined,
      x11: this.form.x11 || undefined,
      keepaliveInterval: keepalive !== null && keepalive !== undefined && `${keepalive}` !== ''
        ? Math.max(0, Number(keepalive)) * 1000
        : undefined,
    };

    this.form.isSaving = true;
    try {
      if (this.form.editingServerId) {
        await this.warpgateService.updateServer(this.form.editingServerId, serverData);
      } else {
        await this.warpgateService.addServer(serverData as Omit<WarpgateServerConfig, 'id'>);
      }
      this.loadServers();
      this.resetForm();
    } catch (error) {
      this.form.testResult = {
        success: false,
        message: `Could not save server: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    } finally {
      this.form.isSaving = false;
    }
  }

  async deleteServer(server: WarpgateServerConfig): Promise<void> {
    if (confirm(`Are you sure you want to delete "${server.name}"?`)) {
      this.warpgateService.removeServer(server.id);
      this.hostSettings.removeServerSettings(server.id);
      this.history.removeServerEntries(server.id);
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

  async setupOtp(server: WarpgateServerConfig): Promise<void> {
    if (!confirm(
      `Enable two-factor authentication for "${server.username}" on ${server.name}?\n\n` +
      'A new OTP secret is registered with Warpgate and stored in Tabby for automatic login. ' +
      'Add the secret shown afterwards to your authenticator app so you can still log in to the Warpgate web UI.'
    )) {
      return;
    }

    this.otpBusy = server.id;
    try {
      const result = await this.warpgateService.autoSetupOtp(server.id);
      this.otpNotice = result.success
        ? {
          serverId: server.id,
          success: true,
          message: 'OTP is set up. Add this secret to your authenticator app:',
          secret: result.secret,
        }
        : { serverId: server.id, success: false, message: result.error || 'Failed to set up OTP' };
      this.loadServers();
    } finally {
      this.otpBusy = null;
    }
  }

  async disableOtp(server: WarpgateServerConfig): Promise<void> {
    if (!confirm(`Remove two-factor authentication from "${server.username}" on ${server.name}?`)) {
      return;
    }

    this.otpBusy = server.id;
    try {
      const result = await this.warpgateService.disableOtp(server.id);
      this.otpNotice = {
        serverId: server.id,
        success: result.success,
        message: result.success ? 'OTP has been removed from your Warpgate account.' : (result.error || 'Failed to disable OTP'),
      };
      this.loadServers();
    } finally {
      this.otpBusy = null;
    }
  }

  copySecret(secret: string): void {
    this.platform?.setClipboard({ text: secret });
  }

  hasOtpSecret(server: WarpgateServerConfig): boolean {
    return !!server.otpSecret && isValidTOTPSecret(server.otpSecret);
  }

  savePluginConfig(): void {
    // Only save the plugin settings, NOT the servers array
    // Servers are managed separately via addServer/updateServer/removeServer
    this.warpgateService.saveConfig({
      autoRefreshInterval: Number(this.config.autoRefreshInterval) || 0,
      showOfflineServers: this.config.showOfflineServers,
      groupByServer: this.config.groupByServer,
      sortBy: this.config.sortBy,
      authMethod: this.config.authMethod,
      debugMode: this.config.debugMode,
      detectOs: this.config.detectOs !== false,
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

  private createEmptyForm(): ServerFormState {
    return {
      isEditing: false,
      editingServerId: null,
      name: '',
      url: '',
      username: '',
      password: '',
      trustSelfSigned: false,
      enabled: true,
      isTesting: false,
      isSaving: false,
      testResult: null,
      needsOtp: false,
      otpCode: '',
      otpSecret: '',
      agentForward: false,
      x11: false,
      keepaliveSeconds: null,
    };
  }
}
