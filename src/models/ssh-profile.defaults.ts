/**
 * SSH Profile Default Configurations
 * Centralized default values for SSH profiles to eliminate duplication
 */

/**
 * Default SSH algorithms configuration
 * Empty arrays allow all algorithms except blacklisted ones
 */
export const DEFAULT_SSH_ALGORITHMS = {
  hmac: [],
  kex: [],
  cipher: [],
  serverHostKey: [],
};

/**
 * Default SSH connection options
 * Standard timeouts and connection parameters
 */
export const DEFAULT_SSH_OPTIONS = {
  keepaliveInterval: 30,
  keepaliveCountMax: 3,
  readyTimeout: 20000,
  x11: false,
  skipBanner: false,
  jumpHost: '',
  agentForward: false,
  socksProxyHost: '',
  socksProxyPort: 0,
  httpProxyHost: '',
  httpProxyPort: 0,
  scripts: [],
  forwardedPorts: [],
};

/**
 * Create a deep copy of default SSH algorithms
 * Prevents mutation of the shared defaults
 */
export function getDefaultSshAlgorithms() {
  return {
    hmac: [...DEFAULT_SSH_ALGORITHMS.hmac],
    kex: [...DEFAULT_SSH_ALGORITHMS.kex],
    cipher: [...DEFAULT_SSH_ALGORITHMS.cipher],
    serverHostKey: [...DEFAULT_SSH_ALGORITHMS.serverHostKey],
  };
}

/**
 * Create a deep copy of default SSH options
 * Prevents mutation of the shared defaults
 */
export function getDefaultSshOptions(): typeof DEFAULT_SSH_OPTIONS {
  return {
    ...DEFAULT_SSH_OPTIONS,
    scripts: [...DEFAULT_SSH_OPTIONS.scripts],
    forwardedPorts: [...DEFAULT_SSH_OPTIONS.forwardedPorts],
  };
}
