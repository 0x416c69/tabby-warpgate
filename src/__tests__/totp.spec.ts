/**
 * Tests for TOTP (Time-based One-Time Password) utility
 */

import {
  base32Decode,
  base32Encode,
  generateTOTP,
  getTOTPRemainingSeconds,
  isValidTOTPSecret,
  generateTOTPSecret,
} from '../utils/totp';

describe('TOTP Utilities', () => {
  describe('base32Decode', () => {
    it('should decode a valid Base32 string', () => {
      // "JBSWY3DPEHPK3PXP" decodes to "Hello!" + null bytes
      const decoded = base32Decode('JBSWY3DPEHPK3PXP');
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect(decoded.length).toBe(10);
    });

    it('should handle empty string', () => {
      const decoded = base32Decode('');
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect(decoded.length).toBe(0);
    });

    it('should ignore padding characters', () => {
      const withPadding = base32Decode('JBSWY3DPEHPK3PXP====');
      const withoutPadding = base32Decode('JBSWY3DPEHPK3PXP');
      expect(withPadding).toEqual(withoutPadding);
    });

    it('should handle lowercase input', () => {
      const upper = base32Decode('JBSWY3DPEHPK3PXP');
      const lower = base32Decode('jbswy3dpehpk3pxp');
      expect(upper).toEqual(lower);
    });

    it('should throw on invalid characters', () => {
      expect(() => base32Decode('INVALID!@#')).toThrow('Invalid Base32 character');
    });

    it('should handle whitespace', () => {
      const withSpaces = base32Decode('JBSW Y3DP EHPK 3PXP');
      const withoutSpaces = base32Decode('JBSWY3DPEHPK3PXP');
      expect(withSpaces).toEqual(withoutSpaces);
    });
  });

  describe('base32Encode', () => {
    it('should encode bytes to Base32', () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const encoded = base32Encode(bytes);
      expect(encoded).toBe('JBSWY3DP');
    });

    it('should handle empty input', () => {
      const encoded = base32Encode(new Uint8Array(0));
      expect(encoded).toBe('');
    });

    it('should produce output that can be decoded back', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const encoded = base32Encode(original);
      const decoded = base32Decode(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe('generateTOTP', () => {
    // Test vector from RFC 6238
    const testSecret = 'GEZDGNBVGY3TQOJQ'; // Base32 of "12345678901234567890"

    it('should generate a 6-digit code', async () => {
      const code = await generateTOTP(testSecret);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('should generate consistent codes for the same time', async () => {
      const timestamp = 1234567890000; // Fixed timestamp
      const code1 = await generateTOTP(testSecret, { timestamp });
      const code2 = await generateTOTP(testSecret, { timestamp });
      expect(code1).toBe(code2);
    });

    it('should generate different codes for different time periods', async () => {
      const timestamp1 = 1234567890000;
      const timestamp2 = 1234567890000 + 30000; // 30 seconds later
      const code1 = await generateTOTP(testSecret, { timestamp: timestamp1 });
      const code2 = await generateTOTP(testSecret, { timestamp: timestamp2 });
      expect(code1).not.toBe(code2);
    });

    it('should respect custom period', async () => {
      const timestamp = 1234567890000;
      const code60s = await generateTOTP(testSecret, { timestamp, period: 60 });
      const code30s = await generateTOTP(testSecret, { timestamp, period: 30 });
      // Different periods should potentially produce different codes
      expect(code60s).toMatch(/^\d{6}$/);
      expect(code30s).toMatch(/^\d{6}$/);
    });

    it('should generate codes with custom digit length', async () => {
      const timestamp = 1234567890000;
      const code8 = await generateTOTP(testSecret, { timestamp, digits: 8 });
      expect(code8).toMatch(/^\d{8}$/);
    });

    it('should pad codes with leading zeros', async () => {
      // Use a secret and timestamp that produces a code starting with zeros
      // This is probabilistic but we're testing the padding logic
      const code = await generateTOTP(testSecret, { timestamp: 0 });
      expect(code.length).toBe(6);
    });
  });

  describe('getTOTPRemainingSeconds', () => {
    it('should return a value between 1 and 30 for default period', () => {
      const remaining = getTOTPRemainingSeconds();
      expect(remaining).toBeGreaterThanOrEqual(1);
      expect(remaining).toBeLessThanOrEqual(30);
    });

    it('should return a value between 1 and 60 for 60-second period', () => {
      const remaining = getTOTPRemainingSeconds(60);
      expect(remaining).toBeGreaterThanOrEqual(1);
      expect(remaining).toBeLessThanOrEqual(60);
    });
  });

  describe('isValidTOTPSecret', () => {
    it('should accept valid Base32 secrets', () => {
      expect(isValidTOTPSecret('JBSWY3DPEHPK3PXP')).toBe(true);
      expect(isValidTOTPSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')).toBe(true);
    });

    it('should reject empty strings', () => {
      expect(isValidTOTPSecret('')).toBe(false);
    });

    it('should reject null/undefined', () => {
      expect(isValidTOTPSecret(null as any)).toBe(false);
      expect(isValidTOTPSecret(undefined as any)).toBe(false);
    });

    it('should reject secrets that are too short', () => {
      expect(isValidTOTPSecret('SHORT')).toBe(false);
      expect(isValidTOTPSecret('ABCDEFGH')).toBe(false);
    });

    it('should reject invalid characters', () => {
      expect(isValidTOTPSecret('INVALID!@#$%^&*()')).toBe(false);
      expect(isValidTOTPSecret('JBSWY3DPEHPK3PX!')).toBe(false);
    });

    it('should accept secrets with whitespace', () => {
      expect(isValidTOTPSecret('JBSW Y3DP EHPK 3PXP')).toBe(true);
    });

    it('should accept lowercase secrets', () => {
      expect(isValidTOTPSecret('jbswy3dpehpk3pxp')).toBe(true);
    });
  });

  describe('generateTOTPSecret', () => {
    it('should generate a valid Base32 secret', () => {
      const secret = generateTOTPSecret();
      expect(isValidTOTPSecret(secret)).toBe(true);
    });

    it('should generate secrets of default length', () => {
      const secret = generateTOTPSecret();
      // 20 bytes = 160 bits, which is 32 Base32 characters
      expect(secret.length).toBe(32);
    });

    it('should generate secrets of custom length', () => {
      const secret = generateTOTPSecret(10);
      // 10 bytes = 80 bits, which is 16 Base32 characters
      expect(secret.length).toBe(16);
    });

    it('should generate unique secrets', () => {
      const secret1 = generateTOTPSecret();
      const secret2 = generateTOTPSecret();
      expect(secret1).not.toBe(secret2);
    });

    it('should generate secrets that can be used for TOTP', async () => {
      const secret = generateTOTPSecret();
      const code = await generateTOTP(secret);
      expect(code).toMatch(/^\d{6}$/);
    });
  });

  describe('RFC 6238 Test Vectors', () => {
    // These test vectors are from RFC 6238 Appendix B
    // Using SHA1 algorithm with 30-second step
    const sha1Secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // Base32 of "12345678901234567890"

    it('should generate correct code for T = 59 (1970-01-01 00:00:59)', async () => {
      const code = await generateTOTP(sha1Secret, { timestamp: 59000 });
      expect(code).toBe('287082');
    });

    it('should generate correct code for T = 1111111109', async () => {
      const code = await generateTOTP(sha1Secret, { timestamp: 1111111109000 });
      expect(code).toBe('081804');
    });

    it('should generate correct code for T = 1111111111', async () => {
      const code = await generateTOTP(sha1Secret, { timestamp: 1111111111000 });
      expect(code).toBe('050471');
    });

    it('should generate correct code for T = 1234567890', async () => {
      const code = await generateTOTP(sha1Secret, { timestamp: 1234567890000 });
      expect(code).toBe('005924');
    });

    it('should generate correct code for T = 2000000000', async () => {
      const code = await generateTOTP(sha1Secret, { timestamp: 2000000000000 });
      expect(code).toBe('279037');
    });
  });
});
