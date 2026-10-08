import { canonicalJson, contentHash } from './canonical-json';

describe('canonicalJson', () => {
  it('should not depend on key order, at any depth', () => {
    const a = { b: 1, a: { y: [1, { q: 1, p: 2 }], x: 'x' } };
    const b = { a: { x: 'x', y: [1, { p: 2, q: 1 }] }, b: 1 };

    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('should sort keys and drop whitespace', () => {
    expect(canonicalJson({ b: 2, a: [3, 1] })).toBe('{"a":[3,1],"b":2}');
  });

  it('should keep array order, because it changes the meaning', () => {
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
  });

  it('should drop undefined properties like JSON.stringify', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('should tell different values apart', () => {
    expect(contentHash({ a: '1' })).not.toBe(contentHash({ a: 1 }));
    expect(contentHash({ a: null })).not.toBe(contentHash({}));
    expect(contentHash('héllo 👋')).not.toBe(contentHash('hello'));
  });

  it('should return a 64 character sha256 hex digest', () => {
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
