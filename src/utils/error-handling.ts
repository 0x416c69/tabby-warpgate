/**
 * Error Handling Utilities
 * Centralized error message formatting and handling
 */

/**
 * Extract error message from any error type
 * Handles Error objects, strings, and unknown types safely
 *
 * @param error Any error value (Error object, string, unknown)
 * @returns Human-readable error message
 */
export function getErrorMessage(error: any): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'Unknown error';
}

/**
 * Format error message for user notifications
 * Combines action context with error details
 *
 * @param action The action that failed (e.g., "Failed to connect")
 * @param error The error that occurred
 * @returns Formatted error message
 */
export function formatErrorNotification(action: string, error: any): string {
  const message = getErrorMessage(error);
  return `${action}: ${message}`;
}

/**
 * Log error to console with context
 * Useful for debugging while also showing user-friendly messages
 *
 * @param context Context string (e.g., component or function name)
 * @param error The error that occurred
 */
export function logError(context: string, error: any): void {
  console.error(`[${context}]`, error);
}
