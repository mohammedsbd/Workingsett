import {
  createServer,
  IncomingHttpHeaders,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * In-process fake of the upstream LLM providers, for tests. It never calls a
 * real provider. Supported routes:
 *
 * - POST /v1/chat/completions                       OpenAI format
 * - POST /v1beta/openai/chat/completions            Gemini's OpenAI-compatible endpoint
 * - POST /v1/messages                               Anthropic Messages API
 * - POST /v1/messages/count_tokens                  Anthropic token counting
 * - POST /v1beta/models/{model}:generateContent       Gemini native
 * - POST /v1beta/models/{model}:streamGenerateContent Gemini native, streamed
 *
 * Responses are canned JSON, or canned SSE streams when streaming is requested
 * (`"stream": true` for OpenAI/Anthropic, `:streamGenerateContent` for Gemini).
 * Every request is recorded so tests can assert on what Parsim forwarded.
 */

export type UpstreamFormat =
  | 'openai'
  | 'gemini-openai'
  | 'anthropic'
  | 'anthropic-count-tokens'
  | 'gemini';

export type RecordedRequest = {
  format: UpstreamFormat;
  method: string;
  path: string;
  /** Gemini model taken from the URL; OpenAI/Anthropic carry it in the body. */
  model?: string;
  query: Record<string, string>;
  headers: IncomingHttpHeaders;
  rawBody: string;
  /** Parsed JSON body, or undefined if the body was not valid JSON. */
  body: unknown;
  streamed: boolean;
};

export type CannedResponse =
  /** A JSON response with the given status (default 200). */
  | {
      kind: 'json';
      status?: number;
      body: unknown;
      headers?: Record<string, string>;
      /** Wait this long before sending headers, to test timeouts. */
      delayMs?: number;
    }
  /** An SSE stream. Each event is written as `event:` (if set) plus `data:`. */
  | {
      kind: 'sse';
      status?: number;
      events: { event?: string; data: unknown }[];
      headers?: Record<string, string>;
      /** Pause before each event, to test that streams are not buffered. */
      delayMs?: number;
    };

type Route = {
  format: UpstreamFormat;
  match: RegExp;
  stream: (path: string, body: unknown) => boolean;
};

const ROUTES: Route[] = [
  {
    format: 'openai',
    match: /^\/v1\/chat\/completions$/,
    stream: (_path, body) => isStreamRequested(body),
  },
  {
    format: 'gemini-openai',
    match: /^\/v1beta\/openai\/chat\/completions$/,
    stream: (_path, body) => isStreamRequested(body),
  },
  {
    format: 'anthropic',
    match: /^\/v1\/messages$/,
    stream: (_path, body) => isStreamRequested(body),
  },
  {
    format: 'anthropic-count-tokens',
    match: /^\/v1\/messages\/count_tokens$/,
    stream: () => false,
  },
  {
    format: 'gemini',
    match:
      /^\/v1beta\/models\/([^/:]+):(generateContent|streamGenerateContent)$/,
    stream: (path) => path.endsWith(':streamGenerateContent'),
  },
];

export class FakeUpstream {
  readonly requests: RecordedRequest[] = [];
  /** Responses whose connection the client closed before they finished. */
  closedEarly = 0;
  private readonly queued: CannedResponse[] = [];
  private server?: Server;
  private port = 0;

  /** Starts a fake upstream on a random free port. */
  static async start(): Promise<FakeUpstream> {
    const fake = new FakeUpstream();
    await fake.listen();
    return fake;
  }

  /** Base URL, for example `http://127.0.0.1:53211`. */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** The most recent request, or throws if none was received. */
  get lastRequest(): RecordedRequest {
    const last = this.requests[this.requests.length - 1];
    if (!last)
      throw new Error('The fake upstream has not received any request');
    return last;
  }

  /** Overrides the response for the next request (any route). Queued in order. */
  respondNext(response: CannedResponse): void {
    this.queued.push(response);
  }

  /** Makes the next request fail with this status and JSON body. */
  failNext(status: number, body: unknown): void {
    this.respondNext({ kind: 'json', status, body });
  }

  /** Forgets recorded requests and queued responses. */
  reset(): void {
    this.requests.length = 0;
    this.queued.length = 0;
    this.closedEarly = 0;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private listen(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    return new Promise((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', this.baseUrl);
    const route = ROUTES.find((r) => r.match.test(url.pathname));

    if (req.method !== 'POST' || !route) {
      writeJson(res, 404, {
        error: { message: `No fake route for ${req.method} ${url.pathname}` },
      });
      return;
    }

    res.on('close', () => {
      if (!res.writableFinished) this.closedEarly += 1;
    });

    const rawBody = await readBody(req);
    const body = parseJson(rawBody);
    const streamed = route.stream(url.pathname, body);
    const model =
      route.format === 'gemini'
        ? route.match.exec(url.pathname)?.[1]
        : undefined;

    this.requests.push({
      format: route.format,
      method: req.method,
      path: url.pathname,
      model,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      rawBody,
      body,
      streamed,
    });

    const response =
      this.queued.shift() ??
      defaultResponse(route.format, streamed, body, model);
    if (response.kind === 'json') {
      if (response.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, response.delayMs));
        if (res.destroyed) return;
      }
      writeJson(res, response.status ?? 200, response.body, response.headers);
    } else {
      await writeSse(res, response);
    }
  }
}

function isStreamRequested(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { stream?: unknown }).stream === true
  );
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJson(raw: string): unknown {
  try {
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function writeSse(
  res: ServerResponse,
  response: Extract<CannedResponse, { kind: 'sse' }>,
): Promise<void> {
  res.writeHead(response.status ?? 200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    ...response.headers,
  });
  for (const { event, data } of response.events) {
    if (response.delayMs) {
      res.flushHeaders();
      await new Promise((resolve) => setTimeout(resolve, response.delayMs));
    }
    if (res.destroyed) return;
    if (event) res.write(`event: ${event}\n`);
    res.write(
      `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
    );
  }
  res.end();
}

/** The reply text every canned response carries, so tests can assert on it. */
export const FAKE_REPLY_TEXT = 'Hello from the fake upstream.';

/** Token usage reported by every canned response. */
export const FAKE_USAGE = { input: 42, output: 7 } as const;

/**
 * Hidden thinking tokens in canned Gemini OpenAI-compatible responses. Like
 * the real endpoint, they count in total_tokens but not completion_tokens.
 */
export const FAKE_GEMINI_THINKING_TOKENS = 20;

/**
 * Prompt cache tokens in canned Anthropic responses. Like the real API they
 * are reported separately from input_tokens.
 */
export const FAKE_ANTHROPIC_CACHE = { read: 30, write: 10 } as const;

function wantsStreamUsage(body: unknown): boolean {
  const options =
    typeof body === 'object' && body !== null
      ? (body as { stream_options?: { include_usage?: unknown } })
          .stream_options
      : undefined;
  return options?.include_usage === true;
}

function requestedModel(body: unknown, fallback: string): string {
  const model =
    typeof body === 'object' && body !== null
      ? (body as { model?: unknown }).model
      : undefined;
  return typeof model === 'string' ? model : fallback;
}

/** Canned success responses per format, streamed or not. */
export function defaultResponse(
  format: UpstreamFormat,
  streamed: boolean,
  body?: unknown,
  geminiModel?: string,
): CannedResponse {
  const [first, second] = [
    FAKE_REPLY_TEXT.slice(0, 11),
    FAKE_REPLY_TEXT.slice(11),
  ];

  if (format === 'openai') {
    const model = requestedModel(body, 'fake-model');
    const base = { id: 'chatcmpl-fake', created: 1700000000, model };
    const usage = {
      prompt_tokens: FAKE_USAGE.input,
      completion_tokens: FAKE_USAGE.output,
      total_tokens: FAKE_USAGE.input + FAKE_USAGE.output,
    };
    if (!streamed) {
      return {
        kind: 'json',
        body: {
          ...base,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: FAKE_REPLY_TEXT },
              finish_reason: 'stop',
            },
          ],
          usage,
        },
      };
    }
    // Like OpenAI: with include_usage every chunk has "usage": null and a
    // final usage-only chunk follows; without it there is no usage at all.
    const includeUsage = wantsStreamUsage(body);
    const chunk = (delta: object, finish: string | null) => ({
      ...base,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(includeUsage ? { usage: null } : {}),
    });
    return {
      kind: 'sse',
      events: [
        { data: chunk({ role: 'assistant', content: '' }, null) },
        { data: chunk({ content: first }, null) },
        { data: chunk({ content: second }, null) },
        { data: chunk({}, 'stop') },
        ...(includeUsage
          ? [
              {
                data: {
                  ...base,
                  object: 'chat.completion.chunk',
                  choices: [],
                  usage,
                },
              },
            ]
          : []),
        { data: '[DONE]' },
      ],
    };
  }

  if (format === 'gemini-openai') {
    // Mirrors what Gemini's OpenAI-compatible endpoint returned on
    // 2026-10-06: thinking tokens only in total_tokens, and with
    // include_usage the usage object on every chunk (no usage-only chunk).
    const model = requestedModel(body, 'fake-model');
    const base = { id: 'gemini-fake', created: 1700000000, model };
    const usage = {
      completion_tokens: FAKE_USAGE.output,
      prompt_tokens: FAKE_USAGE.input,
      total_tokens:
        FAKE_USAGE.input + FAKE_USAGE.output + FAKE_GEMINI_THINKING_TOKENS,
    };
    const signature = { google: { thought_signature: 'fake-signature' } };
    if (!streamed) {
      return {
        kind: 'json',
        body: {
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              message: {
                content: FAKE_REPLY_TEXT,
                extra_content: signature,
                role: 'assistant',
              },
            },
          ],
          ...base,
          object: 'chat.completion',
          usage,
        },
      };
    }
    const includeUsage = wantsStreamUsage(body);
    const chunk = (delta: object, finish?: string) => ({
      choices: [
        { delta, ...(finish ? { finish_reason: finish } : {}), index: 0 },
      ],
      ...base,
      object: 'chat.completion.chunk',
      ...(includeUsage ? { usage } : {}),
    });
    return {
      kind: 'sse',
      events: [
        { data: chunk({ content: first, role: 'assistant' }) },
        { data: chunk({ content: second, role: 'assistant' }) },
        {
          data: chunk({ extra_content: signature, role: 'assistant' }, 'stop'),
        },
        { data: '[DONE]' },
      ],
    };
  }

  if (format === 'anthropic-count-tokens') {
    return { kind: 'json', body: { input_tokens: FAKE_USAGE.input } };
  }

  if (format === 'anthropic') {
    const model = requestedModel(body, 'fake-model');
    if (!streamed) {
      return {
        kind: 'json',
        body: {
          id: 'msg_fake',
          type: 'message',
          role: 'assistant',
          model,
          content: [{ type: 'text', text: FAKE_REPLY_TEXT }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: FAKE_USAGE.input,
            output_tokens: FAKE_USAGE.output,
            cache_read_input_tokens: FAKE_ANTHROPIC_CACHE.read,
            cache_creation_input_tokens: FAKE_ANTHROPIC_CACHE.write,
          },
        },
      };
    }
    return {
      kind: 'sse',
      events: [
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: {
              id: 'msg_fake',
              type: 'message',
              role: 'assistant',
              model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: {
                input_tokens: FAKE_USAGE.input,
                output_tokens: 1,
                cache_read_input_tokens: FAKE_ANTHROPIC_CACHE.read,
                cache_creation_input_tokens: FAKE_ANTHROPIC_CACHE.write,
              },
            },
          },
        },
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: first },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: second },
          },
        },
        {
          event: 'content_block_stop',
          data: { type: 'content_block_stop', index: 0 },
        },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: FAKE_USAGE.output },
          },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ],
    };
  }

  const usageMetadata = {
    promptTokenCount: FAKE_USAGE.input,
    candidatesTokenCount: FAKE_USAGE.output,
    totalTokenCount: FAKE_USAGE.input + FAKE_USAGE.output,
  };
  const candidate = (text: string, finishReason?: string) => ({
    content: { role: 'model', parts: [{ text }] },
    index: 0,
    ...(finishReason ? { finishReason } : {}),
  });
  const modelVersion = geminiModel ?? 'fake-model';
  if (!streamed) {
    return {
      kind: 'json',
      body: {
        candidates: [candidate(FAKE_REPLY_TEXT, 'STOP')],
        usageMetadata,
        modelVersion,
      },
    };
  }
  return {
    kind: 'sse',
    events: [
      { data: { candidates: [candidate(first)], modelVersion } },
      {
        data: {
          candidates: [candidate(second, 'STOP')],
          usageMetadata,
          modelVersion,
        },
      },
    ],
  };
}

/** Parses an SSE body into its events, for assertions in tests. */
export function parseSse(raw: string): { event?: string; data: string }[] {
  return raw
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      let event: string | undefined;
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      return { event, data: data.join('\n') };
    });
}
