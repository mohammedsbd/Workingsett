import {
  generateParsimKey,
  hashParsimKey,
  hasParsimKeyPrefix,
  isWellFormedParsimKey,
  PARSIM_KEY_PREFIX,
} from './parsim-key';

describe('parsim-key', () => {
  describe('generateParsimKey', () => {
    it('should create a prefixed, well-formed key with 256 bits of randomness', () => {
      const { key } = generateParsimKey();

      expect(key.startsWith(PARSIM_KEY_PREFIX)).toBe(true);
      expect(isWellFormedParsimKey(key)).toBe(true);
      expect(
        Buffer.from(key.slice(PARSIM_KEY_PREFIX.length), 'base64url'),
      ).toHaveLength(32);
    });

    it('should return a short display prefix that is the start of the key', () => {
      const { key, prefix } = generateParsimKey();

      expect(prefix).toHaveLength(12);
      expect(key.startsWith(prefix)).toBe(true);
    });

    it('should return the hash of the key, not the key itself', () => {
      const { key, hash } = generateParsimKey();

      expect(hash).toBe(hashParsimKey(key));
      expect(hash).not.toContain(key);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should never return the same key twice', () => {
      const keys = new Set(
        Array.from({ length: 200 }, () => generateParsimKey().key),
      );
      expect(keys.size).toBe(200);
    });
  });

  describe('hashParsimKey', () => {
    it('should be deterministic, so a presented key can be looked up', () => {
      const { key } = generateParsimKey();
      expect(hashParsimKey(key)).toBe(hashParsimKey(key));
    });

    it('should differ for keys that differ in one character', () => {
      const { key } = generateParsimKey();
      const changed = key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A');
      expect(hashParsimKey(changed)).not.toBe(hashParsimKey(key));
    });
  });

  describe('verification helpers', () => {
    it('should tell Parsim keys apart from provider keys by prefix', () => {
      expect(hasParsimKeyPrefix('psm_anything')).toBe(true);
      expect(hasParsimKeyPrefix('sk-proj-123')).toBe(false);
      expect(hasParsimKeyPrefix('AIzaSyExample')).toBe(false);
    });

    it('should reject malformed keys before any database lookup', () => {
      const { key } = generateParsimKey();

      expect(isWellFormedParsimKey(key)).toBe(true);
      expect(isWellFormedParsimKey(key + 'x')).toBe(false);
      expect(isWellFormedParsimKey(key.slice(0, -1))).toBe(false);
      expect(isWellFormedParsimKey('psm_' + '!'.repeat(43))).toBe(false);
      expect(isWellFormedParsimKey('')).toBe(false);
    });
  });
});
