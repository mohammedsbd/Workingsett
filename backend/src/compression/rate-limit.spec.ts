import { describe, expect, it } from '@jest/globals';
import {
  parseDuration,
  QuotaExhaustedError,
  rateLimitInfo,
  RateLimitedError,
  withRateLimitRetry,
} from './rate-limit';

const NOW = Date.parse('2026-10-17T12:00:00Z');

describe('rate limits', () => {
  it.each([
    ['7m54.24s', 474_240],
    ['1.5s', 1500],
    ['2h1m', 7_260_000],
    ['300ms', 300],
    ['soon', null],
    ['5s later', null],
  ])('should parse the duration %s', (text, ms) => {
    expect(parseDuration(text)).toBe(ms);
  });

  it('should read Retry-After in seconds or as an HTTP date', () => {
    expect(rateLimitInfo({ 'retry-after': '3' }, '', NOW)).toEqual({
      retryAfterMs: 3000,
      daily: false,
    });
    const headers = new Headers({
      'retry-after': new Date(NOW + 90_000).toUTCString(),
    });
    expect(rateLimitInfo(headers, '', NOW).retryAfterMs).toBe(90_000);
    expect(rateLimitInfo(undefined, '', NOW)).toEqual({
      retryAfterMs: null,
      daily: false,
    });
  });

  it('should prefer the more precise wait in the error text', () => {
    const text =
      'Rate limit reached on tokens per minute (TPM). Please try again in 7.66s.';
    expect(rateLimitInfo({ 'retry-after': '8' }, text, NOW).retryAfterMs).toBe(
      8000,
    );
    expect(rateLimitInfo({}, text, NOW).retryAfterMs).toBe(7660);
  });

  it.each([
    ['Limit reached on tokens per day (TPD): Limit 200000', true],
    ['Limit reached on requests per day (RPD)', true],
    ['You exceeded your daily quota', true],
    ['Limit reached on tokens per minute (TPM)', false],
  ])('should tell a daily limit from %s', (text, daily) => {
    expect(rateLimitInfo({}, text, NOW).daily).toBe(daily);
  });

  describe('withRateLimitRetry', () => {
    const limited = (retryAfterMs: number | null, daily = false) =>
      new RateLimitedError({ retryAfterMs, daily });

    it('should retry after the asked wait, with backoff when none is given', async () => {
      const waits: number[] = [];
      const errors = [limited(1500), limited(null), limited(null)];
      let calls = 0;
      const result = await withRateLimitRetry(
        () => {
          calls += 1;
          const error = errors.shift();
          return error ? Promise.reject(error) : Promise.resolve('ok');
        },
        {
          baseDelayMs: 100,
          sleep: (ms) => {
            waits.push(ms);
            return Promise.resolve();
          },
        },
      );
      expect(result).toBe('ok');
      expect(calls).toBe(4);
      // Attempt 0 waits what was asked; then 100 * 2^1 and 100 * 2^2.
      expect(waits).toEqual([1500, 200, 400]);
    });

    it('should stop with a resume time on a daily limit, without waiting', async () => {
      let slept = false;
      const error = await withRateLimitRetry(
        () => Promise.reject(limited(600_000, true)),
        {
          now: () => NOW,
          sleep: () => {
            slept = true;
            return Promise.resolve();
          },
        },
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(QuotaExhaustedError);
      expect((error as QuotaExhaustedError).daily).toBe(true);
      expect((error as QuotaExhaustedError).resumeAt).toEqual(
        new Date(NOW + 600_000),
      );
      expect((error as Error).message).toContain('2026-10-17T12:10:00.000Z');
      expect(slept).toBe(false);
    });

    it('should stop when the asked wait is longer than the retry window', async () => {
      const error = await withRateLimitRetry(
        () => Promise.reject(limited(5 * 60_000)),
        { maxWaitMs: 60_000, now: () => NOW },
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(QuotaExhaustedError);
      expect((error as QuotaExhaustedError).daily).toBe(false);
    });

    it('should rethrow other errors at once and the last 429 after the retries', async () => {
      const other = new Error('boom');
      await expect(
        withRateLimitRetry(() => Promise.reject(other)),
      ).rejects.toBe(other);

      let calls = 0;
      await expect(
        withRateLimitRetry(
          () => {
            calls += 1;
            return Promise.reject(limited(10));
          },
          { maxRetries: 2, sleep: () => Promise.resolve() },
        ),
      ).rejects.toBeInstanceOf(RateLimitedError);
      expect(calls).toBe(3);
    });
  });
});
