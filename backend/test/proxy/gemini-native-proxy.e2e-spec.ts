import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { GoogleGenAI } from '@google/genai';
import request from 'supertest';
import { ProxyService } from '../../src/proxy/proxy.service';
import {
  defaultResponse,
  FAKE_REPLY_TEXT,
  FAKE_USAGE,
  FakeUpstream,
  parseSse,
} from '../utils/fake-upstream';
import { loadConversation, toGeminiBody } from '../utils/fixtures';
import {
  createProjectWithKey,
  dumpAllTables,
  ProxyFixture,
  waitForUsageRecords,
} from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

const GOOGLE_KEY = 'AIza-test-0123456789abcdef';
const MODEL = 'gemini-3.8-flash';
const PROMPT = 'Summarize the open support tickets.';
const GENERATE = `/v1beta/models/${MODEL}:generateContent`;
const STREAM = `/v1beta/models/${MODEL}:streamGenerateContent`;

/** A Gemini request with every pass-through field, formatted unusually. */
function geminiBody(fields: Record<string, unknown> = {}): string {
  const body = {
    systemInstruction: { parts: [{ text: 'You are a support agent.' }] },
    contents: [
      { role: 'user', parts: [{ text: PROMPT }] },
      {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'list_tickets', args: { status: 'open' } },
            thoughtSignature: 'c2lnbmF0dXJl',
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'list_tickets',
              response: { output: [{ id: 'T-1', subject: 'Late order' }] },
            },
          },
        ],
      },
    ],
    tools: [
      {
        functionDeclarations: [
          {
            name: 'list_tickets',
            description: 'List support tickets.',
            parameters: {
              type: 'object',
              properties: { status: { type: 'string' } },
            },
          },
        ],
      },
    ],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: {
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 128 },
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
    cachedContent: 'cachedContents/abc123',
    ...fields,
  };
  return JSON.stringify(body, null, 2).replace(/": /g, '" :   ') + '\n';
}

describe('Proxy: Gemini native API (/v1beta/models)', () => {
  let t: TestApp;
  let upstream: FakeUpstream;
  let fx: ProxyFixture;

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    t = await createTestApp({ PROXY_GEMINI_NATIVE_BASE_URL: upstream.baseUrl });
  });

  beforeEach(async () => {
    await t.reset();
    upstream.reset();
    fx = await createProjectWithKey(t, { upstream: 'gemini' });
  });

  afterAll(async () => {
    await Promise.all([t?.close(), upstream?.stop()]);
  });

  const post = (path: string) =>
    request(t.server).post(path).set('content-type', 'application/json');

  const idle = () => t.app.get(ProxyService).whenIdle();

  describe('non-streamed requests', () => {
    it('should forward the body byte for byte and return the response unchanged', async () => {
      const body = geminiBody();
      const canned = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: { name: 'list_tickets', args: { status: 'x' } },
                  thoughtSignature: 'b3RoZXI=',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 7 },
        modelVersion: MODEL,
      };
      upstream.respondNext({ kind: 'json', body: canned });

      const res = await post(GENERATE)
        .set('x-parsim-key', fx.parsimKey)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(body)
        .expect(200);

      expect(res.body).toEqual(canned);
      const sent = upstream.lastRequest;
      expect(sent.format).toBe('gemini');
      expect(sent.path).toBe(GENERATE);
      expect(sent.query).toEqual({});
      expect(sent.rawBody).toBe(body);
      expect(sent.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
      expect(sent.headers['x-parsim-key']).toBeUndefined();
      expect(sent.streamed).toBe(false);
    });

    it('should record usage with the model from the URL', async () => {
      await post(GENERATE)
        .set('x-parsim-key', fx.parsimKey)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(geminiBody())
        .expect(200);

      const [row] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(row).toMatchObject({
        upstream: 'gemini',
        model: MODEL,
        inputTokens: FAKE_USAGE.input,
        outputTokens: FAKE_USAGE.output,
        status: 200,
        streamed: false,
      });
      expect(row.costUsd).not.toBeNull();
    });

    it('should count thinking tokens as output and report cached tokens', async () => {
      upstream.respondNext({
        kind: 'json',
        body: {
          candidates: [],
          usageMetadata: {
            promptTokenCount: 1000,
            cachedContentTokenCount: 600,
            candidatesTokenCount: 10,
            thoughtsTokenCount: 30,
          },
        },
      });

      await post(GENERATE)
        .set('x-parsim-key', fx.parsimKey)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(geminiBody())
        .expect(200);

      const [row] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(row).toMatchObject({
        inputTokens: 1000,
        cachedInputTokens: 600,
        outputTokens: 40,
      });
    });

    it('should store the session and its function call items', async () => {
      await post(GENERATE)
        .set('x-parsim-key', fx.parsimKey)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(geminiBody())
        .expect(200);
      await idle();

      const [session] = (await t.dataSource.query(
        'SELECT * FROM agent_session',
      )) as { id: string; provider: string; model: string }[];
      expect(session).toMatchObject({ provider: 'gemini', model: MODEL });
      const items = (await t.dataSource.query(
        'SELECT kind, "toolCallId" FROM context_item WHERE "agentSessionId" = $1 ORDER BY position',
        [session.id],
      )) as { kind: string; toolCallId: string | null }[];
      expect(items.map((i) => i.kind)).toEqual([
        'system',
        'user',
        'tool_call',
        'tool_result',
      ]);
      // The response is paired with the call by name.
      expect(items[3].toolCallId).toBe(items[2].toolCallId);
    });

    it('should not be served under the /api prefix', async () => {
      await post(`/api${GENERATE}`)
        .set('x-parsim-key', fx.parsimKey)
        .send(geminiBody())
        .expect(404);
      expect(upstream.requests).toHaveLength(0);
    });

    it('should answer an unknown method with a Google-format 404', async () => {
      const res = await post(`/v1beta/models/${MODEL}:embedContent`)
        .set('x-parsim-key', fx.parsimKey)
        .send(geminiBody())
        .expect(404);
      expect(res.body).toMatchObject({
        error: { code: 404, status: 'NOT_FOUND' },
      });
      expect(upstream.requests).toHaveLength(0);
    });
  });

  describe('streamed requests', () => {
    it('should pass every SSE chunk through unchanged and keep alt=sse', async () => {
      const res = await post(`${STREAM}?alt=sse`)
        .set('x-parsim-key', fx.parsimKey)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(geminiBody())
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      const canned = defaultResponse('gemini', true, undefined, MODEL);
      expect(canned.kind).toBe('sse');
      const events = parseSse(res.text).map((e) => JSON.parse(e.data));
      expect(events).toEqual(
        canned.kind === 'sse' ? canned.events.map((e) => e.data) : [],
      );
      expect(JSON.stringify(events)).toContain(FAKE_REPLY_TEXT.slice(0, 11));
      expect(upstream.lastRequest).toMatchObject({
        path: STREAM,
        query: { alt: 'sse' },
        streamed: true,
      });

      const [row] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(row).toMatchObject({
        model: MODEL,
        inputTokens: FAKE_USAGE.input,
        outputTokens: FAKE_USAGE.output,
        streamed: true,
      });
    });

    it('should pass streamed function calls through unchanged', async () => {
      const chunk = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'list_tickets', args: {} } }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
      };
      upstream.respondNext({ kind: 'sse', events: [{ data: chunk }] });

      const res = await post(`${STREAM}?alt=sse`)
        .set('x-parsim-key', fx.parsimKey)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(geminiBody())
        .expect(200);

      expect(parseSse(res.text).map((e) => JSON.parse(e.data))).toEqual([
        chunk,
      ]);
    });

    it('should relay a JSON-array stream (no alt=sse) and read its usage', async () => {
      const chunks = [
        { candidates: [], usageMetadata: { promptTokenCount: 9 } },
        {
          candidates: [],
          usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 },
        },
      ];
      upstream.respondNext({ kind: 'json', body: chunks });

      const res = await post(STREAM)
        .set('x-parsim-key', fx.parsimKey)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(geminiBody())
        .expect(200);

      expect(res.body).toEqual(chunks);
      const [row] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(row).toMatchObject({ inputTokens: 9, outputTokens: 4 });
    });
  });

  describe('countTokens', () => {
    it('should pass the request and response through without recording usage', async () => {
      const body = geminiBody();
      const res = await post(`/v1beta/models/${MODEL}:countTokens`)
        .set('x-parsim-key', fx.parsimKey)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(body)
        .expect(200);

      expect(res.body).toEqual({ totalTokens: FAKE_USAGE.input });
      expect(upstream.lastRequest).toMatchObject({
        format: 'gemini-count-tokens',
        rawBody: body,
      });
      await idle();
      expect(
        await t.dataSource.query('SELECT * FROM usage_record'),
      ).toHaveLength(0);
    });
  });

  describe('keys', () => {
    it('should accept the Parsim key as x-goog-api-key and use the stored Google key', async () => {
      const stored = await createProjectWithKey(t, {
        upstream: 'gemini',
        providerKey: GOOGLE_KEY,
      });

      await post(GENERATE)
        .set('x-goog-api-key', stored.parsimKey)
        .send(geminiBody())
        .expect(200);

      expect(upstream.lastRequest.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
    });

    it('should accept the Parsim key as the key parameter', async () => {
      const stored = await createProjectWithKey(t, {
        upstream: 'gemini',
        providerKey: GOOGLE_KEY,
      });

      await post(`${STREAM}?alt=sse&key=${stored.parsimKey}`)
        .send(geminiBody())
        .expect(200);

      expect(upstream.lastRequest.query).toEqual({ alt: 'sse' });
      expect(upstream.lastRequest.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
    });

    it('should move a Google key from the key parameter to the header', async () => {
      await post(`${GENERATE}?key=${GOOGLE_KEY}`)
        .set('x-parsim-key', fx.parsimKey)
        .send(geminiBody())
        .expect(200);

      expect(upstream.lastRequest.query).toEqual({});
      expect(upstream.lastRequest.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
    });

    it('should reject a missing Parsim key in Google format', async () => {
      const res = await post(GENERATE)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(geminiBody())
        .expect(401);
      expect(res.body).toEqual({
        error: {
          code: 401,
          message: expect.stringContaining('x-goog-api-key') as unknown,
          status: 'UNAUTHENTICATED',
        },
      });
      expect(upstream.requests).toHaveLength(0);
    });

    it('should reject a missing Google key in Google format', async () => {
      const res = await post(GENERATE)
        .set('x-parsim-key', fx.parsimKey)
        .send(geminiBody())
        .expect(401);
      expect(res.body).toMatchObject({
        error: { code: 401, status: 'UNAUTHENTICATED' },
      });
    });

    it('should never store or log the Google key or the content', async () => {
      await post(`${STREAM}?alt=sse&key=${GOOGLE_KEY}`)
        .set('x-parsim-key', fx.parsimKey)
        .send(geminiBody())
        .expect(200);
      await post(GENERATE)
        .set('x-parsim-key', fx.parsimKey)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(geminiBody())
        .expect(200);
      await idle();

      const tables = await dumpAllTables(t.dataSource, ['context_content']);
      expect(tables).not.toContain(GOOGLE_KEY);
      expect(tables).not.toContain(fx.parsimKey);
      expect(tables).not.toContain(PROMPT);
      expect(t.logs.text).toContain('gemini.streamGenerateContent');
      expect(t.logs.text).not.toContain(GOOGLE_KEY);
      expect(t.logs.text).not.toContain(fx.parsimKey);
      expect(t.logs.text).not.toContain(PROMPT);
    });
  });

  describe('upstream errors', () => {
    it.each([400, 403, 429, 500, 503])(
      'should pass a %i error through with the same status and body',
      async (status) => {
        const error = {
          error: { code: status, message: 'Upstream said no.', status: 'X' },
        };
        upstream.respondNext({ kind: 'json', status, body: error });

        const res = await post(GENERATE)
          .set('x-parsim-key', fx.parsimKey)
          .set('x-goog-api-key', GOOGLE_KEY)
          .send(geminiBody())
          .expect(status);

        expect(res.body).toEqual(error);
        const [row] = await waitForUsageRecords(t.dataSource, fx.project.id);
        expect(row).toMatchObject({ status, inputTokens: 0, outputTokens: 0 });
      },
    );
  });

  describe('projects with another upstream', () => {
    it('should refuse Gemini native calls for an OpenAI project, in Google format', async () => {
      const openai = await createProjectWithKey(t, { upstream: 'openai' });
      const res = await post(GENERATE)
        .set('x-parsim-key', openai.parsimKey)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(geminiBody())
        .expect(400);
      expect(res.body).toMatchObject({
        error: { code: 400, status: 'INVALID_ARGUMENT' },
      });
      expect(upstream.requests).toHaveLength(0);
    });
  });

  describe('with the GC on', () => {
    it('should forward a smaller request with valid function responses', async () => {
      await request(t.server)
        .patch(`/api/v1/projects/${fx.project.id}`)
        .auth(fx.adminToken, { type: 'bearer' })
        .send({ gcMode: 'on' })
        .expect(200);
      const body = JSON.stringify(
        toGeminiBody(loadConversation('research-agent-session')),
      );

      await post(GENERATE)
        .set('x-parsim-key', fx.parsimKey)
        .set('x-goog-api-key', GOOGLE_KEY)
        .send(body)
        .expect(200);
      await idle();

      const sent = upstream.lastRequest;
      expect(sent.rawBody.length).toBeLessThan(body.length / 2);
      type Content = { role: string; parts: Record<string, unknown>[] };
      const before = (JSON.parse(body) as { contents: Content[] }).contents;
      const after = (sent.body as { contents: Content[] }).contents;
      expect(after).toHaveLength(before.length);
      const names = (contents: Content[]) =>
        contents.flatMap((c) =>
          c.parts.map(
            (p) =>
              (p.functionCall as { name: string } | undefined)?.name ??
              (p.functionResponse as { name: string } | undefined)?.name ??
              'text',
          ),
        );
      // Same calls and responses in the same places; only responses shrank.
      expect(names(after)).toEqual(names(before));
      expect(sent.rawBody).toContain('[parsim ');
      const [run] = (await t.dataSource.query('SELECT * FROM gc_run')) as {
        applied: boolean;
      }[];
      expect(run.applied).toBe(true);
    });
  });

  describe('with the official @google/genai SDK', () => {
    let ai: GoogleGenAI;

    beforeEach(async () => {
      const stored = await createProjectWithKey(t, {
        upstream: 'gemini',
        providerKey: GOOGLE_KEY,
      });
      ai = new GoogleGenAI({
        apiKey: stored.parsimKey,
        httpOptions: { baseUrl: await t.listen() },
      });
    });

    it('should generate content', async () => {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: PROMPT,
      });

      expect(response.text).toBe(FAKE_REPLY_TEXT);
      expect(upstream.lastRequest.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
    });

    it('should stream content', async () => {
      const stream = await ai.models.generateContentStream({
        model: MODEL,
        contents: PROMPT,
      });
      let text = '';
      for await (const chunk of stream) text += chunk.text ?? '';

      expect(text).toBe(FAKE_REPLY_TEXT);
      expect(upstream.lastRequest.query).toEqual({ alt: 'sse' });
    });

    it('should count tokens', async () => {
      const result = await ai.models.countTokens({
        model: MODEL,
        contents: PROMPT,
      });
      expect(result.totalTokens).toBe(FAKE_USAGE.input);
    });
  });
});
