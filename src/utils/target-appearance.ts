/**
 * Icons and colors for Warpgate targets
 */

import { WarpgateTarget } from '../models/warpgate.models';
import { getBootstrapColor } from '../models/theme.constants';

/** Keyword rules for picking a target icon, first match wins */
const ICON_RULES: Array<{ keywords: string[]; icon: string }> = [
  { keywords: ['mysql', 'mariadb', 'postgres', 'pgsql', 'mongo', 'redis', 'elastic', 'database', 'db'], icon: 'fas fa-database' },
  { keywords: ['web', 'nginx', 'apache', 'http', 'frontend', 'backend'], icon: 'fas fa-globe' },
  { keywords: ['file', 'storage', 'nas'], icon: 'fas fa-folder-open' },
  { keywords: ['backup', 'archive'], icon: 'fas fa-archive' },
  { keywords: ['ftp', 'sftp'], icon: 'fas fa-folder' },
  { keywords: ['git', 'gitlab', 'github'], icon: 'fab fa-git-alt' },
  { keywords: ['jenkins', 'ci', 'build'], icon: 'fas fa-cogs' },
  { keywords: ['docker', 'container', 'k8s', 'kubernetes'], icon: 'fab fa-docker' },
  { keywords: ['dev', 'test', 'staging'], icon: 'fas fa-code' },
  { keywords: ['gateway', 'proxy', 'vpn'], icon: 'fas fa-shield-alt' },
  { keywords: ['firewall', 'security'], icon: 'fas fa-lock' },
  { keywords: ['dns', 'mail', 'smtp'], icon: 'fas fa-envelope' },
  { keywords: ['monitor', 'logging', 'metrics'], icon: 'fas fa-chart-line' },
  { keywords: ['vm', 'virtual', 'cloud', 'aws', 'azure', 'gcp'], icon: 'fas fa-cloud' },
  { keywords: ['prod', 'production', 'live'], icon: 'fas fa-rocket' },
];

/**
 * Split text into lowercase words so keywords match whole words only
 * ("db" matches "prod-db-01" but not "feedback")
 */
function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

/**
 * Get an icon for a target based on its name, description and group
 */
export function getTargetIcon(target: WarpgateTarget): string {
  const terms = words(`${target.name} ${target.description || ''} ${target.group?.name || ''}`);
  for (const rule of ICON_RULES) {
    if (rule.keywords.some(keyword => terms.has(keyword))) {
      return rule.icon;
    }
  }
  return 'fas fa-server';
}

/**
 * Get an accent color for a target (environment keywords first, then group color)
 */
export function getTargetColor(target: WarpgateTarget): string {
  const terms = words(`${target.name} ${target.description || ''}`);
  const has = (...keywords: string[]) => keywords.some(keyword => terms.has(keyword));

  if (has('prod', 'production', 'live')) return '#ef4444';
  if (has('dev', 'development')) return '#22c55e';
  if (has('test', 'staging', 'uat')) return '#f59e0b';
  if (has('database', 'db', 'mysql', 'postgres')) return '#8b5cf6';

  if (target.group?.color) {
    return getBootstrapColor(target.group.color) || '#6366f1';
  }

  return '#6366f1';
}
