import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Encrypts customer provider keys at rest with AES-256-GCM. The stored form is
 * "v1:" + base64(iv | auth tag | ciphertext). GCM also detects tampering.
 */
export class ProviderKeyCipher {
  private readonly key: Buffer;

  /** @param base64Key PARSIM_ENCRYPTION_KEY: 32 random bytes, base64. */
  constructor(base64Key: string | undefined) {
    if (!base64Key) {
      throw new Error(
        'PARSIM_ENCRYPTION_KEY is not set, so provider keys cannot be stored. See .env.example.',
      );
    }
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) {
      throw new Error('PARSIM_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    return `${VERSION}:${payload.toString('base64')}`;
  }

  decrypt(stored: string): string {
    const [version, data] = stored.split(':', 2);
    if (version !== VERSION || !data) {
      throw new Error('Unsupported encrypted provider key format');
    }
    const payload = Buffer.from(data, 'base64');
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
