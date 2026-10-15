import { Upstream } from '../proxy/providers/provider-adapter';
import { anthropicResponseUsage } from '../proxy/providers/anthropic-format';
import { geminiResponseUsage } from '../proxy/providers/gemini-format';
import {
  readOpenAiUsage,
  toTokenUsage,
} from '../proxy/providers/openai-format';
import { TokenUsage } from '../usage-records/domain/token-usage';

/** Where a summary is computed, and who pays for it. */
export type SummarizerTarget = {
  provider: Upstream;
  model: string;
  /**
   * Provider host: the OpenAI base (path /v1/chat/completions), the Gemini
   * native host (path /v1beta/models/...) or the Anthropic base (/v1/messages).
   */
  baseUrl: string;
  apiKey: string;
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

/**
 * One summary call to a provider: a system instruction and one user
 * message, not streamed, JSON output requested.
 */
export async function summarize(
  target: SummarizerTarget,
  system: string,
  prompt: string,
  timeoutMs = 120_000,
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
  if (!response.ok) {
    await response.body?.cancel();
    throw new SummarizerError(
      `upstream returned ${response.status}`,
      response.status === 429 || response.status >= 500,
    );
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new SummarizerError('upstream returned invalid JSON', true);
  }
  const result = read(target.provider, json);
  if (!result.text.trim()) {
    throw new SummarizerError('upstream returned no text', true);
  }
  return result;
}
