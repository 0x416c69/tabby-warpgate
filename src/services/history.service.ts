/**
 * Warpgate History Service
 * Records connections to Warpgate hosts and provides the recently used hosts
 */

import { Injectable, Inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import { WarpgateService } from './warpgate.service';
import { MAX_HISTORY_ENTRIES, WarpgateHistoryEntry, getHostKey } from '../models/warpgate.models';

/**
 * Connection History Service
 */
@Injectable({ providedIn: 'root' })
export class WarpgateHistoryService {
  private changesSubject = new Subject<void>();

  /** Emits whenever the history changes */
  readonly changes$: Observable<void> = this.changesSubject.asObservable();

  constructor(@Inject(WarpgateService) private warpgate: WarpgateService) {}

  /**
   * Get the connection history, most recent first
   * Entries of servers that no longer exist are left out
   */
  getHistory(): WarpgateHistoryEntry[] {
    const serverIds = new Set(this.warpgate.getServers().map(server => server.id));
    return this.getStoredHistory().filter(entry => serverIds.has(entry.serverId));
  }

  /**
   * Get the most recently used hosts
   */
  getRecent(limit = 8): WarpgateHistoryEntry[] {
    return this.getHistory().slice(0, limit);
  }

  /**
   * Get the history entry of a host
   */
  getEntry(serverId: string, targetName: string): WarpgateHistoryEntry | undefined {
    return this.getStoredHistory().find(entry => entry.serverId === serverId && entry.targetName === targetName);
  }

  /**
   * Map of host key to last connection time (milliseconds since epoch)
   */
  getLastConnectedMap(): Map<string, number> {
    const result = new Map<string, number>();
    for (const entry of this.getStoredHistory()) {
      const time = Date.parse(entry.lastConnectedAt);
      if (!isNaN(time)) {
        result.set(getHostKey(entry.serverId, entry.targetName), time);
      }
    }
    return result;
  }

  /**
   * Record a connection to a host
   */
  recordConnection(serverId: string, targetName: string, when: Date = new Date()): void {
    const history = this.getStoredHistory();
    const existing = history.find(entry => entry.serverId === serverId && entry.targetName === targetName);
    const updated: WarpgateHistoryEntry = {
      serverId,
      targetName,
      lastConnectedAt: when.toISOString(),
      count: (existing?.count ?? 0) + 1,
    };

    const next = [updated, ...history.filter(entry => entry !== existing)].slice(0, MAX_HISTORY_ENTRIES);
    this.warpgate.saveConfig({ history: next });
    this.changesSubject.next();
  }

  /**
   * Remove a host from the history
   */
  removeEntry(serverId: string, targetName: string): void {
    const history = this.getStoredHistory();
    const next = history.filter(entry => !(entry.serverId === serverId && entry.targetName === targetName));
    if (next.length !== history.length) {
      this.warpgate.saveConfig({ history: next });
      this.changesSubject.next();
    }
  }

  /**
   * Remove all entries of a server
   */
  removeServerEntries(serverId: string): void {
    const history = this.getStoredHistory();
    const next = history.filter(entry => entry.serverId !== serverId);
    if (next.length !== history.length) {
      this.warpgate.saveConfig({ history: next });
      this.changesSubject.next();
    }
  }

  /**
   * Clear the whole history
   */
  clearHistory(): void {
    this.warpgate.saveConfig({ history: [] });
    this.changesSubject.next();
  }

  /**
   * Raw stored history (validated)
   */
  private getStoredHistory(): WarpgateHistoryEntry[] {
    const history = this.warpgate.getConfig().history;
    if (!Array.isArray(history)) {
      return [];
    }
    return history.filter(entry =>
      entry && typeof entry.serverId === 'string' && typeof entry.targetName === 'string'
    );
  }
}
