/**
 * Helpers for the IDs of profiles created by this plugin
 *
 * Tabby hands profiles to tabs through a config proxy that only exposes known
 * profile fields, so custom metadata is lost. The profile ID survives (including
 * in recovered and duplicated tabs), which makes it the reliable way to find out
 * which Warpgate server and target a tab belongs to.
 */

/** Prefix of every profile ID created by this plugin */
export const WARPGATE_PROFILE_ID_PREFIX = 'warpgate:';

/** Suffixes used by one-click profiles */
export type WarpgateProfileKind = 'ticket' | 'autoauth';

/** Server and target a profile belongs to */
export interface WarpgateProfileTarget {
  serverId: string;
  targetName: string;
  kind?: WarpgateProfileKind;
}

/**
 * Build the ID of a profile for a Warpgate target
 */
export function buildWarpgateProfileId(
  serverId: string,
  targetName: string,
  kind?: WarpgateProfileKind
): string {
  const base = `${WARPGATE_PROFILE_ID_PREFIX}${serverId}:${targetName}`;
  return kind ? `${base}:${kind}` : base;
}

/**
 * Extract the server and target from a profile ID created by this plugin
 * Server IDs never contain ":", target names may
 */
export function parseWarpgateProfileId(id: string | null | undefined): WarpgateProfileTarget | null {
  if (!id || !id.startsWith(WARPGATE_PROFILE_ID_PREFIX)) {
    return null;
  }

  const rest = id.slice(WARPGATE_PROFILE_ID_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) {
    return null;
  }

  const serverId = rest.slice(0, separator);
  let targetName = rest.slice(separator + 1);
  let kind: WarpgateProfileKind | undefined;

  const suffix = targetName.match(/:(ticket|autoauth)$/);
  if (suffix) {
    kind = suffix[1] as WarpgateProfileKind;
    targetName = targetName.slice(0, -suffix[0].length);
  }

  if (!targetName) {
    return null;
  }

  return { serverId, targetName, kind };
}
