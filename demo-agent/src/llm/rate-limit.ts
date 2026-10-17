/**
 * Rate limits (429). Free tiers (Groq's in particular) limit requests and
 * tokens per minute and per day:
 *
 * - A per-minute limit passes after a short wait: retry after the time the
 *   provider gives (Retry-After, or "try again in 7.5s" in the error), with
 *   exponential backoff when it gives none.
 * - A per-day limit does not: stop the run cleanly and say when it can
 *   resume (QuotaExhaustedError).
 *
 * The same rules as Parsim's backend (backend/src/compression/rate-limit.ts).
 */

export const DEFAULT_MAX_WAIT_MS = 60_000;

export type RateLimitInfo = {
  retryAfterMs: number | null;
  daily: boolean;
};

export type HeaderSource =
  | Headers
  | Record<string, string | string[] | undefined>
  | undefined;

function header(headers: HeaderSource, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const value = (headers as Record<string, string | string[] | undefined>)[
    name
  ];
  return Array.isArray(value) ? value[0] : value;
}

/** "7m54.24s", "2h1m", "1.5s", "300ms" as ms; null otherwise. */
export function parseDuration(text: string): number | null {
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)];
  if (!parts.length || parts.map((p) => p[0]).join('') !== text.trim()) {
    return null;
  }
  const unit = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 } as const;
  return Math.round(
    parts.reduce(
      (sum, [, n, u]) => sum + Number(n) * unit[u as keyof typeof unit],
      0,
    ),
  );
}

/** What a 429 says about the limit: how long to wait, and whether it is daily. */
export function rateLimitInfo(
  headers: HeaderSource,
  bodyText: string,
  now = Date.now(),
): RateLimitInfo {
  let retryAfterMs: number | null = null;
  const retryAfter = header(headers, 'retry-after')?.trim();
  if (retryAfter) {
    if (/^\d+(\.\d+)?$/.test(retryAfter)) {
      retryAfterMs = Math.round(Number(retryAfter) * 1000);
    } else {
      const date = Date.parse(retryAfter);
      if (!Number.isNaN(date)) retryAfterMs = Math.max(0, date - now);
    }
  }
  const inText = /try again in ([0-9hms.]+)/i.exec(bodyText)?.[1];
  const fromText = inText ? parseDuration(inText.replace(/\.$/, '')) : null;
  if (fromText !== null) {
    retryAfterMs = Math.max(retryAfterMs ?? 0, fromText);
  }
  const daily =
    /\b(tokens|requests) per day\b|\((TPD|RPD)\)|daily (quota|limit)/i.test(
      bodyText,
    );
  return { retryAfterMs, daily };
}

/** A 429 the caller may retry. */
export class RateLimitedError extends Error {
  constructor(readonly info: RateLimitInfo) {
    super('The provider returned 429 (rate limited)');
    this.name = 'RateLimitedError';
  }
}

/** A daily quota is used up, or the wait is too long: stop and resume later. */
export class QuotaExhaustedError extends Error {
  constructor(
    readonly resumeAt: Date | null,
    readonly daily: boolean,
  ) {
    super(
      `${daily ? 'The daily quota of the model is used up' : 'The model is rate limited for longer than the retry window'}. ${
        resumeAt
          ? `The run can resume after ${resumeAt.toISOString()}.`
          : 'Try again later.'
      }`,
    );
    this.name = 'QuotaExhaustedError';
  }
}

export type RetryPolicy = {
  maxRetries?: number;
  maxWaitMs?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRetry?: (attempt: number, waitMs: number) => void;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `call`, retrying per-minute 429s; throws QuotaExhaustedError on daily limits. */
export async function withRateLimitRetry<T>(
  call: () => Promise<T>,
  policy: RetryPolicy = {},
): Promise<T> {
  const maxRetries = policy.maxRetries ?? 4;
  const maxWaitMs = policy.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const baseDelayMs = policy.baseDelayMs ?? 2000;
  const sleep = policy.sleep ?? defaultSleep;
  const now = policy.now ?? Date.now;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof RateLimitedError)) throw error;
      const { retryAfterMs, daily } = error.info;
      const waitMs = retryAfterMs ?? baseDelayMs * 2 ** attempt;
      if (daily || waitMs > maxWaitMs) {
        throw new QuotaExhaustedError(
          retryAfterMs !== null ? new Date(now() + retryAfterMs) : null,
          daily,
        );
      }
      if (attempt >= maxRetries) throw error;
      policy.onRetry?.(attempt + 1, waitMs);
      await sleep(waitMs);
    }
  }
}
