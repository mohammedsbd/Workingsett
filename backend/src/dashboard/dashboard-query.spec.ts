import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { escapeLike, parseRange, utcDays } from './dashboard-query';

describe('dashboard queries', () => {
  const now = new Date('2026-10-11T15:30:00Z');

  it('should default to the 30 days before now', () => {
    expect(parseRange({}, now)).toEqual({
      from: new Date('2026-09-11T15:30:00Z'),
      to: now,
    });
    expect(parseRange({ to: '2026-01-31T00:00:00Z' }).from).toEqual(
      new Date('2026-01-01T00:00:00Z'),
    );
  });

  it.each([
    [{ from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }],
    [{ from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }],
    [{ from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }],
  ])('should reject %j', (query) => {
    expect(() => parseRange(query, now)).toThrow(BadRequestException);
  });

  it('should list the UTC days a range touches', () => {
    expect(
      utcDays({
        from: new Date('2026-10-01T22:00:00Z'),
        to: new Date('2026-10-04T01:00:00Z'),
      }),
    ).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(
      utcDays({
        from: new Date('2026-10-01T00:00:00Z'),
        to: new Date('2026-10-02T00:00:00Z'),
      }),
    ).toEqual(['2026-10-01']);
  });

  it('should escape LIKE wildcards', () => {
    expect(escapeLike('50%_off' + String.fromCharCode(92))).toBe(
      '50' +
        String.fromCharCode(92) +
        '%' +
        String.fromCharCode(92) +
        '_off' +
        String.fromCharCode(92, 92),
    );
  });
});
