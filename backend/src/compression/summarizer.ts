import OpenAI from 'openai';
import { Upstream } from '../proxy/providers/provider-adapter';
import { anthropicResponseUsage } from '../proxy/providers/anthropic-format';
import { geminiResponseUsage } from '../proxy/providers/gemini-format';
import {
  readOpenAiUsage,
  toTokenUsage,
} from '../proxy/providers/openai-format';
import { TokenUsage } from '../usage-records/domain/token-usage';
import {
  QuotaExhaustedError,
  rateLimitInfo,
  RateLimitedError,
  RetryPolicy,
  withRateLimitRetry,
} from './rate-limit';

/** Where a summary is computed, and who pays for it. */
export type SummarizerTarget = {
  provider: Upstream;
  model: string;
  /**
   * Provider host: the OpenAI base (path /v1/chat/completions), the Gemini
   * native host (path /v1beta/models/...), the Anthropic base (/v1/messages)
   * or, for openai-compatible providers, the full API base (for Groq
   * https://api.groq.com/openai/v1, path /chat/completions).
   */
  baseUrl: string;
  apiKey: string;
  /**
   * The model's context window in tokens, when known (required for
   * openai-compatible providers such as Groq). A prompt estimated larger
   * than it fails before any call is made.
   */
  contextTokens?: number;
};

export type SummarizerResult = { text: string; usage: TokenUsage | null };

/**
 * A summary call that failed. `retryable` is true for errors that may pass
 * on a later try (network, timeouts, 429 and 5xx). The message never holds
 * prompt content or keys.
 */
export class SummarizerError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SummarizerError';
  }
}

/** The prompt is larger than the model's context window. Never retried. */
export class ContextTooLargeError extends SummarizerError {
  constructor(
    readonly estimatedTokens: number,
    readonly contextTokens: number,
  ) {
    super(
      `the prompt (about ${estimatedTokens} tokens with the output limit) is larger than the model's context window (${contextTokens} tokens)`,
      false,
    );
    this.name = 'ContextTooLargeError';
  }
}

/** A daily quota is used up, or the provider asks for too long a wait. */
export class SummarizerQuotaError extends SummarizerError {
  constructor(readonly quota: QuotaExhaustedError) {
    super(quota.message, false);
    this.name = 'SummarizerQuotaError';
  }

  get resumeAt(): Date | null {
    return this.quota.resumeAt;
  }
}

/**
 * A conservative token estimate (about 3 characters per token, below the
 * usual 4), so the context guard trips before the provider would reject.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** The output limit of a summary (or replay judge) call. */
export const MAX_OUTPUT_TOKENS = 4096;

type Call = { url: string; headers: Record<string, string>; body: unknown };

function call(target: SummarizerTarget, system: string, prompt: string): Call {
  const { provider, model, baseUrl, apiKey } = target;
  if (provider === 'gemini') {
    return {
      url: `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'x-goog-api-key': apiKey },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      },
    };
  }
  if (provider === 'anthropic') {
    return {
      url: `${baseUrl}/v1/messages`,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: prompt }],
      },
    };
  }
  // Some OpenAI models only accept the default temperature, so none is set.
  return {
    url: `${baseUrl}/v1/chat/completions`,
    headers: { authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    },
  };
}

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/** The response text and usage, per provider. */
function read(provider: Upstream, body: unknown): SummarizerResult {
  if (provider === 'gemini') {
    const candidate = asObject(asArray(asObject(body).candidates)[0]);
    const text = asArray(asObject(candidate.content).parts)
      .map(asObject)
      .filter((part) => part.thought !== true && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('');
    return { text, usage: geminiResponseUsage(body) };
  }
  if (provider === 'anthropic') {
    const text = asArray(asObject(body).content)
      .map(asObject)
      .filter(
        (block) => block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text as string)
      .join('');
    return { text, usage: anthropicResponseUsage(body) };
  }
  const message = asObject(
    asObject(asArray(asObject(body).choices)[0]).message,
  );
  return {
    text: typeof message.content === 'string' ? message.content : '',
    usage: toTokenUsage(readOpenAiUsage(body)),
  };
}

export type SummarizeOptions = {
  timeoutMs?: number;
  /** Retries of 429 responses (per-minute limits); see rate-limit.ts. */
  retry?: RetryPolicy;
};

/** Fails before any call when the prompt cannot fit the context window. */
export function checkContext(
  target: SummarizerTarget,
  system: string,
  prompt: string,
): void {
  if (!target.contextTokens) return;
  const estimated =
    estimateTokens(system) + estimateTokens(prompt) + MAX_OUTPUT_TOKENS;
  if (estimated > target.contextTokens) {
    throw new ContextTooLargeError(estimated, target.contextTokens);
  }
}

/**
 * One call to an OpenAI-compatible provider (Groq and others) with the
 * official openai SDK. The SDK's own retries are off: 429s go through
 * withRateLimitRetry like every other provider.
 */
async function callOpenAiCompatible(
  target: SummarizerTarget,
  system: string,
  prompt: string,
  timeoutMs: number,
): Promise<SummarizerResult> {
  const client = new OpenAI({
    apiKey: target.apiKey,
    baseURL: target.baseUrl,
    maxRetries: 0,
    timeout: timeoutMs,
  });
  try {
    const completion = await client.chat.completions.create({
      model: target.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: 'json_object' },
    });
    return read('openai', completion);
  } catch (error) {
    if (error instanceof OpenAI.APIConnectionError) {
      throw new SummarizerError(`request failed (${error.name})`, true);
    }
    if (error instanceof OpenAI.APIError && error.status === 429) {
      throw new RateLimitedError(rateLimitInfo(error.headers, error.message));
    }
    if (error instanceof OpenAI.APIError && error.status !== undefined) {
      throw new SummarizerError(
        `upstream returned ${error.status}`,
        error.status >= 500,
      );
    }
    throw error;
  }
}

/** One call over fetch to the Gemini, OpenAI or Anthropic API. */
async function callNative(
  target: SummarizerTarget,
  system: string,
  prompt: string,
  timeoutMs: number,
): Promise<SummarizerResult> {
  const { url, headers, body } = call(target, system, prompt);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    throw new SummarizerError(`request failed (${name})`, true);
  }
  if (response.status === 429) {
    // Read only to find the wait and the kind of limit; never logged.
    const text = (await response.text().catch(() => '')).slice(0, 4000);
    throw new RateLimitedError(rateLimitInfo(response.headers, text));
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SummarizerError(
      `upstream returned ${response.status}`,
      response.status >= 500,
    );
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new SummarizerError('upstream returned invalid JSON', true);
  }
  return read(target.provider, json);
}

/**
 * One summary call to a provider: a system instruction and one user
 * message, not streamed, JSON output requested. Checks the context window
 * first, retries per-minute rate limits, and stops on a daily quota
 * (SummarizerQuotaError, with when it can resume).
 */
export async function summarize(
  target: SummarizerTarget,
  system: string,
  prompt: string,
  options: SummarizeOptions = {},
): Promise<SummarizerResult> {
  checkContext(target, system, prompt);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const once = () =>
    target.provider === 'openai-compatible'
      ? callOpenAiCompatible(target, system, prompt, timeoutMs)
      : callNative(target, system, prompt, timeoutMs);
  let result: SummarizerResult;
  try {
    result = await withRateLimitRetry(once, options.retry);
  } catch (error) {
    if (error instanceof QuotaExhaustedError) {
      throw new SummarizerQuotaError(error);
    }
    if (error instanceof RateLimitedError) {
      throw new SummarizerError('upstream returned 429', true);
    }
    throw error;
  }
  if (!result.text.trim()) {
    throw new SummarizerError('upstream returned no text', true);
  }
  return result;
}
