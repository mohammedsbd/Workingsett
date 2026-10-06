import { createHash, randomBytes } from 'node:crypto';

/** Every Parsim API key starts with this, so it can be told apart from provider keys. */
export const PARSIM_KEY_PREFIX = 'psm_';

/** Characters of the key shown in lists so users can tell keys apart. */
const DISPLAY_PREFIX_LENGTH = 12;

const KEY_PATTERN = /^psm_[A-Za-z0-9_-]{43}$/;

export type GeneratedParsimKey = {
  /** The full key. Shown once at creation and never stored. */
  key: string;
  /** Short, non-secret start of the key for display. */
  prefix: string;
  /** SHA-256 hex of the key, the only thing stored. */
  hash: string;
};

/**
 * Creates a new key: the prefix plus 32 random bytes (256 bits) in base64url.
 * With that much entropy a plain SHA-256 is safe to store and lets us look
 * the key up by its hash; a slow password hash is not needed.
 */
export function generateParsimKey(): GeneratedParsimKey {
  const key = PARSIM_KEY_PREFIX + randomBytes(32).toString('base64url');
  return {
    key,
    prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
    hash: hashParsimKey(key),
  };
}

export function hashParsimKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** True when the token has the Parsim prefix (it may still be malformed). */
export function hasParsimKeyPrefix(token: string): boolean {
  return token.startsWith(PARSIM_KEY_PREFIX);
}

/** True when the token has exactly the shape of a generated key. */
export function isWellFormedParsimKey(token: string): boolean {
  return KEY_PATTERN.test(token);
}
