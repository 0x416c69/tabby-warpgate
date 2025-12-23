/**
 * Centralized Debug Logger for Warpgate Plugin
 * Provides conditional logging based on debugMode config setting
 */

import { ConfigService } from 'tabby-core';

/** Logger context prefix */
const PREFIX = '[Warpgate]';

/** Global config reference - set once during plugin initialization */
let configService: ConfigService | null = null;

/**
 * Initialize the debug logger with the config service
 * Must be called during plugin bootstrap
 */
export function initDebugLogger(config: ConfigService): void {
  configService = config;
}

/**
 * Check if debug mode is enabled
 */
function isDebugEnabled(): boolean {
  return configService?.store?.warpgate?.debugMode === true;
}

/**
 * Log a debug message (only when debugMode is enabled)
 */
export function debugLog(context: string, message: string, ...args: any[]): void {
  if (isDebugEnabled()) {
    console.log(`${PREFIX} [${context}] ${message}`, ...args);
  }
}

/**
 * Log a warning (always logged, but with context)
 */
export function warnLog(context: string, message: string, ...args: any[]): void {
  console.warn(`${PREFIX} [${context}] ${message}`, ...args);
}

/**
 * Log an error (always logged, but with context)
 */
export function errorLog(context: string, message: string, ...args: any[]): void {
  console.error(`${PREFIX} [${context}] ${message}`, ...args);
}

/**
 * Create a logger instance for a specific context
 * Usage: const log = createLogger('MyComponent');
 *        log.debug('message');
 */
export function createLogger(context: string) {
  return {
    debug: (message: string, ...args: any[]) => debugLog(context, message, ...args),
    warn: (message: string, ...args: any[]) => warnLog(context, message, ...args),
    error: (message: string, ...args: any[]) => errorLog(context, message, ...args),
  };
}
