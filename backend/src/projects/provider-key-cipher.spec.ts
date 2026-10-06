import { randomBytes } from 'node:crypto';
import { ProviderKeyCipher } from './provider-key-cipher';

describe('ProviderKeyCipher', () => {
  const cipher = new ProviderKeyCipher(randomBytes(32).toString('base64'));

  it('should round-trip a provider key', () => {
    const stored = cipher.encrypt('sk-proj-secret-123');
    expect(cipher.decrypt(stored)).toBe('sk-proj-secret-123');
  });

  it('should never store the key in readable form', () => {
    const stored = cipher.encrypt('sk-proj-secret-123');

    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain('sk-proj-secret-123');
    expect(
      Buffer.from(stored.slice(3), 'base64').toString('latin1'),
    ).not.toContain('secret');
  });

  it('should use a fresh IV, so equal keys encrypt differently', () => {
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('should detect tampering', () => {
    const stored = cipher.encrypt('sk-proj-secret-123');
    const bytes = Buffer.from(stored.slice(3), 'base64');
    bytes[bytes.length - 1] ^= 1;

    expect(() => cipher.decrypt(`v1:${bytes.toString('base64')}`)).toThrow();
  });

  it('should not decrypt with a different encryption key', () => {
    const other = new ProviderKeyCipher(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(cipher.encrypt('x'))).toThrow();
  });

  it('should require a 32-byte encryption key', () => {
    expect(() => new ProviderKeyCipher(undefined)).toThrow(
      'PARSIM_ENCRYPTION_KEY is not set',
    );
    expect(
      () => new ProviderKeyCipher(randomBytes(16).toString('base64')),
    ).toThrow('must be 32 bytes');
  });

  it('should reject unknown formats', () => {
    expect(() => cipher.decrypt('plain-text-key')).toThrow(
      'Unsupported encrypted provider key format',
    );
  });
});
