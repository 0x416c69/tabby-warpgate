/**
 * Keyboard-interactive prompt classification
 * Shared by the SSH handler and the keyboard-interactive helper
 */

const OTP_PATTERNS = [
  /one-?time/i,
  /\botp\b/i,
  /2fa/i,
  /two-?factor/i,
  /factor\s*authentication/i,
  /verification\s*code/i,
  /authenticator/i,
  /totp/i,
  /token/i,
  /security\s*code/i,
];

/**
 * Check if a prompt is asking for an OTP/2FA code
 */
export function isOtpPrompt(prompt: string): boolean {
  return OTP_PATTERNS.some(pattern => pattern.test(prompt));
}

/**
 * Check if a prompt is asking for a password
 * OTP prompts often contain the word "password" too ("One-time password"),
 * so they are never treated as password prompts
 */
export function isPasswordPrompt(prompt: string): boolean {
  return /password/i.test(prompt) && !isOtpPrompt(prompt);
}
