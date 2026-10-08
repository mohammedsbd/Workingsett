import { createHash } from 'node:crypto';

/**
 * Serializes a JSON value with object keys sorted (recursively) and no
 * whitespace, so the same content always gives the same string no matter
 * how a client ordered its keys. Arrays keep their order. Properties whose
 * value is undefined are left out, as JSON.stringify does.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) sorted[key] = sortKeys(child);
  }
  return sorted;
}

export function sha256Hex(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/** SHA-256 of the canonical JSON form. */
export function contentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
