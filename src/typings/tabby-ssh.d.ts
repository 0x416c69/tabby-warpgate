/**
 * Type declarations for tabby-ssh
 */

declare module 'tabby-ssh' {
  import { ConnectableProfile } from 'tabby-core';

  export interface SSHProfileOptions {
    host: string;
    port: number;
    user: string;
    auth?: null|'password'|'publicKey'|'agent'|'keyboardInteractive';
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
    input?: any;
  }

  export interface SSHProfile extends ConnectableProfile {
    type: 'ssh';
    options: SSHProfileOptions;
  }
}
