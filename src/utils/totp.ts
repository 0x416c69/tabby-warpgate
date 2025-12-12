/**
 * TOTP (Time-based One-Time Password) Generator
 * RFC 6238 compliant implementation for automatic OTP generation
 */

/**
 * Base32 character set (RFC 4648)
 */
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode a Base32 encoded string to a byte array
 * @param encoded Base32 encoded string
 * @returns Decoded byte array
 */
export function base32Decode(encoded: string): Uint8Array {
  // Remove padding and convert to uppercase
  const cleanedInput = encoded.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');

  if (cleanedInput.length === 0) {
    return new Uint8Array(0);
  }

  // Calculate output length
  const outputLength = Math.floor((cleanedInput.length * 5) / 8);
  const result = new Uint8Array(outputLength);

  let buffer = 0;
  let bitsLeft = 0;
  let outputIndex = 0;

  for (let i = 0; i < cleanedInput.length; i++) {
    const char = cleanedInput[i];
    const value = BASE32_CHARS.indexOf(char);

    if (value === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    buffer = (buffer << 5) | value;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      result[outputIndex++] = (buffer >> bitsLeft) & 0xff;
    }
  }

  return result;
}

/**
 * Encode a byte array to Base32 string
 * @param data Byte array to encode
 * @returns Base32 encoded string
 */
export function base32Encode(data: Uint8Array): string {
  if (data.length === 0) {
    return '';
  }

  let result = '';
  let buffer = 0;
  let bitsLeft = 0;

  for (let i = 0; i < data.length; i++) {
    buffer = (buffer << 8) | data[i];
    bitsLeft += 8;

    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      result += BASE32_CHARS[(buffer >> bitsLeft) & 0x1f];
    }
  }

  // Handle remaining bits
  if (bitsLeft > 0) {
    result += BASE32_CHARS[(buffer << (5 - bitsLeft)) & 0x1f];
  }

  return result;
}

/**
 * HMAC-SHA1 implementation
 * @param key Secret key
 * @param message Message to authenticate
 * @returns HMAC-SHA1 hash
 */
async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  // Check if running in Node.js environment
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    return hmacSha1Node(key, message);
  }

  // Browser/Web Crypto API
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
  return new Uint8Array(signature);
}

/**
 * Node.js HMAC-SHA1 implementation
 */
function hmacSha1Node(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha1', Buffer.from(key));
    hmac.update(Buffer.from(message));
    const result = hmac.digest();
    resolve(new Uint8Array(result));
  });
}

/**
 * Convert a number to a big-endian 8-byte array
 * @param num Number to convert
 * @returns 8-byte Uint8Array
 */
function numberToBytes(num: number): Uint8Array {
  const bytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    bytes[i] = num & 0xff;
    num = Math.floor(num / 256);
  }
  return bytes;
}

/**
 * Dynamic truncation as per RFC 4226
 * @param hmacResult HMAC result
 * @returns Truncated 4-byte integer
 */
function dynamicTruncate(hmacResult: Uint8Array): number {
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const binary =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);
  return binary;
}

/**
 * Generate a TOTP code
 * @param secret Base32-encoded secret key
 * @param options TOTP options
 * @returns 6-digit OTP code as string
 */
export async function generateTOTP(
  secret: string,
  options: {
    /** Time step in seconds (default: 30) */
    period?: number;
    /** Number of digits in OTP (default: 6) */
    digits?: number;
    /** Unix timestamp to use (default: current time) */
    timestamp?: number;
  } = {}
): Promise<string> {
  const { period = 30, digits = 6, timestamp = Date.now() } = options;

  // Decode the secret
  const key = base32Decode(secret);

  // Calculate the counter (time steps since epoch)
  const counter = Math.floor(timestamp / 1000 / period);
  const counterBytes = numberToBytes(counter);

  // Generate HMAC-SHA1
  const hmacResult = await hmacSha1(key, counterBytes);

  // Dynamic truncation
  const truncated = dynamicTruncate(hmacResult);

  // Generate OTP
  const otp = truncated % Math.pow(10, digits);

  // Pad with leading zeros
  return otp.toString().padStart(digits, '0');
}

/**
 * Get the remaining seconds until the current TOTP expires
 * @param period Time step in seconds (default: 30)
 * @returns Seconds remaining
 */
export function getTOTPRemainingSeconds(period = 30): number {
  return period - (Math.floor(Date.now() / 1000) % period);
}

/**
 * Validate a TOTP secret format
 * @param secret Base32-encoded secret
 * @returns True if valid
 */
export function isValidTOTPSecret(secret: string): boolean {
  if (!secret || typeof secret !== 'string') {
    return false;
  }

  // Clean and validate
  const cleaned = secret.replace(/\s/g, '').toUpperCase().replace(/=+$/, '');

  if (cleaned.length < 16) {
    // Minimum 80 bits (16 base32 chars)
    return false;
  }

  // Check all characters are valid Base32
  for (const char of cleaned) {
    if (BASE32_CHARS.indexOf(char) === -1) {
      return false;
    }
  }

  return true;
}

/**
 * Generate a random TOTP secret
 * @param length Number of bytes (default: 20 for 160 bits)
 * @returns Base32-encoded secret
 */
export function generateTOTPSecret(length = 20): string {
  let randomBytes: Uint8Array;

  // Check environment for crypto
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    randomBytes = new Uint8Array(length);
    window.crypto.getRandomValues(randomBytes);
  } else {
    // Node.js environment
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('crypto');
    randomBytes = new Uint8Array(crypto.randomBytes(length));
  }

  return base32Encode(randomBytes);
}
