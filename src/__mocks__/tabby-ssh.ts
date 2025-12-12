/**
 * Mock for tabby-ssh module
 * Used in unit tests
 */

export interface SSHProfile {
  id: string;
  type: 'ssh';
  name: string;
  group?: string;
  icon?: string;
  color?: string;
  isBuiltin?: boolean;
  isTemplate?: boolean;
  options: SSHProfileOptions;
}

export interface SSHProfileOptions {
  host: string;
  port: number;
  user: string;
  auth?: string;
  password?: string;
  privateKeys?: string[];
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
  readyTimeout?: number;
  x11?: boolean;
  skipBanner?: boolean;
  jumpHost?: string;
  agentForward?: boolean;
  socksProxyHost?: string;
  socksProxyPort?: number;
  httpProxyHost?: string;
  httpProxyPort?: number;
  scripts?: any[];
  forwardedPorts?: any[];
  algorithms?: {
    hmac?: string[];
    kex?: string[];
    cipher?: string[];
    serverHostKey?: string[];
  };
}
