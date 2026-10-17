/**
 * Rate limits of provider APIs (429), shared by Parsim's internal model
 * calls. Free tiers (Groq's in particular) limit requests and tokens per
 * minute and per day:
 *
 * - A per-minute limit passes after a short wait: retry after the time the
 *   provider gives (Retry-After, or "try again in 7.5s" in the error), with
 *   exponential backoff when it gives none.
 * - A per-day limit does not: stop, and say when it can resume.
 */

/** Longest wait between retries before giving up on a per-minute limit. */
export const DEFAULT_MAX_WAIT_MS = 60_000;

export type RateLimitInfo = {
  /** How long the provider asks to wait, in ms, if it says. */
  retryAfterMs: number | null;
  /** The limit is per day (tokens or requests per day). */
  daily: boolean;
};

/** Headers as fetch or the openai SDK expose them. */
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

/** "7m54.24s", "2h1m", "1.5s", "300ms" as ms; null if it is none of these. */
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

/**
 * What a 429 response says about the limit. Reads Retry-After (seconds or
 * an HTTP date), then the "Please try again in ..." text Groq and OpenAI put
 * in the error message. Never returns the message itself.
 */
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
  // The text is more precise than a rounded header; take the longer one.
  if (fromText !== null) {
    retryAfterMs = Math.max(retryAfterMs ?? 0, fromText);
  }
  const daily =
    /\b(tokens|requests) per day\b|\((TPD|RPD)\)|daily (quota|limit)/i.test(
      bodyText,
    );
  return { retryAfterMs, daily };
}

/**
 * A daily quota is used up (or the provider asks to wait longer than makes
 * sense to block on). Not retried: the run stops and can resume later.
 */
export class QuotaExhaustedError extends Error {
  constructor(
    /** When the provider says it can resume, if it says. */
    readonly resumeAt: Date | null,
    readonly daily: boolean,
  ) {
    super(
      `${daily ? 'The daily quota of the model is used up' : 'The model is rate limited for longer than the retry window'}${
        resumeAt ? `; it can resume after ${resumeAt.toISOString()}` : ''
      }.`,
    );
    this.name = 'QuotaExhaustedError';
  }
}

/** A 429 that the caller may retry after `waitMs`. */
export class RateLimitedError extends Error {
  constructor(readonly info: RateLimitInfo) {
    super('upstream returned 429');
    this.name = 'RateLimitedError';
  }
}

export type RetryPolicy = {
  /** Retries after the first try (default 4). */
  maxRetries?: number;
  /** The longest single wait (default 60s); a longer one stops the run. */
  maxWaitMs?: number;
  /** First backoff when the provider gives no time (default 2s, doubling). */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called before each wait (for logs: no content). */
  onRetry?: (attempt: number, waitMs: number) => void;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `call`, retrying RateLimitedError after the wait the provider asks
 * for (or exponential backoff). Throws QuotaExhaustedError for daily limits
 * and for waits longer than `maxWaitMs`, and the last error after
 * `maxRetries`.
 */
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
