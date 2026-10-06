import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import OpenAI from 'openai';
import {
  createProjectWithKey,
  waitForUsageRecords,
} from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

/**
 * Real calls through the proxy with the official openai SDK. Opt-in only:
 * `npm run test:live` (sets LIVE_TESTS=true). Each provider is skipped when
 * its key or model is not configured in .env.test. The prompts are tiny and
 * contain no real data; a full run costs well under one cent.
 */
const live = process.env.LIVE_TESTS === 'true';

const providers = [
  {
    upstream: 'gemini' as const,
    key: process.env.GEMINI_API_KEY,
    model: process.env.PARSIM_INTERNAL_MODEL,
  },
  {
    upstream: 'openai' as const,
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_LIVE_TEST_MODEL,
  },
];

describe('Live proxy calls', () => {
  let t: TestApp;
  let baseURL: string;

  beforeAll(async () => {
    if (!live) return;
    // Real upstreams: make sure no fake base URL leaks in from the env.
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: '',
      PROXY_GEMINI_BASE_URL: '',
    });
    baseURL = `${await t.listen()}/v1`;
  });

  beforeEach(async () => {
    if (live) await t.reset();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe.each(providers)('$upstream', ({ upstream, key, model }) => {
    const run = live && key && model ? it : it.skip;

    const client = async () => {
      const fx = await createProjectWithKey(t, { upstream, providerKey: key });
      return {
        fx,
        openai: new OpenAI({ apiKey: fx.parsimKey, baseURL, maxRetries: 3 }),
      };
    };

    run('should answer a non-streamed request and record usage', async () => {
      const { fx, openai } = await client();

      const completion = await openai.chat.completions.create({
        model: model!,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      });

      expect(completion.choices[0].message.content?.trim()).toBeTruthy();
      expect(completion.usage?.prompt_tokens).toBeGreaterThan(0);
      const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(record).toMatchObject({ status: 200, streamed: false, upstream });
      expect(record.inputTokens).toBeGreaterThan(0);
      expect(record.outputTokens).toBeGreaterThan(0);
    });

    run(
      'should stream a response and record usage the client did not ask for',
      async () => {
        const { fx, openai } = await client();

        const stream = await openai.chat.completions.create({
          model: model!,
          stream: true,
          messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
        });
        let text = '';
        let sawUsage = false;
        for await (const chunk of stream) {
          text += chunk.choices[0]?.delta?.content ?? '';
          if (chunk.usage) sawUsage = true;
        }

        expect(text).toMatch(/1.*2.*3.*4.*5/s);
        expect(sawUsage).toBe(false);
        const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
        expect(record).toMatchObject({ status: 200, streamed: true });
        expect(record.inputTokens).toBeGreaterThan(0);
        expect(record.outputTokens).toBeGreaterThan(0);
      },
    );
  });
});
