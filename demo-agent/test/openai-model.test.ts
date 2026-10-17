import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../src/config.js';
import {
  OpenAiChatModel,
  TOOL_CALL_RETRY_TEMPERATURE,
} from '../src/llm/openai-model.js';

const config: ProviderConfig = {
  provider: 'groq',
  model: 'groq-model',
  apiKey: 'gsk-test',
  baseUrl: 'https://api.groq.test/openai/v1',
  headers: {},
  maxOutputTokens: 256,
  temperature: 0,
  freeTier: true,
  route: 'direct',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const toolUseFailed = () =>
  json(400, {
    error: {
      message:
        "tool call validation failed: parameters for tool send_reply did not match schema: errors: [missing properties: 'ticket_id']",
      type: 'invalid_request_error',
      code: 'tool_use_failed',
    },
  });

const completion = () =>
  json(200, {
    id: 'c1',
    object: 'chat.completion',
    created: 1,
    model: 'groq-model',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'done' },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  });

const request = {
  messages: [{ role: 'user' as const, content: 'hi' }],
  tools: [],
  sessionId: 's1',
};

describe('OpenAiChatModel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should ask again when the provider rejects a malformed tool call, sampling a little', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(toolUseFailed())
      .mockResolvedValueOnce(completion());
    const turn = await new OpenAiChatModel(config).complete(request);
    expect(turn.text).toBe('done');
    const bodies = spy.mock.calls.map(
      ([, init]) =>
        JSON.parse(String((init as RequestInit).body)) as {
          temperature?: number;
        },
    );
    expect(bodies.map((b) => b.temperature)).toEqual([
      0,
      TOOL_CALL_RETRY_TEMPERATURE,
    ]);
  });

  it('should give up after two retries and pass other errors through at once', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(toolUseFailed()));
    await expect(new OpenAiChatModel(config).complete(request)).rejects.toThrow(
      /tool call validation failed/,
    );
    expect(spy).toHaveBeenCalledTimes(3);

    vi.restoreAllMocks();
    const bad = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(json(401, { error: { message: 'bad key' } })),
      );
    await expect(
      new OpenAiChatModel(config).complete(request),
    ).rejects.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
