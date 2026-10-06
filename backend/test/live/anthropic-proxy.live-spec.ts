import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import Anthropic from '@anthropic-ai/sdk';
import {
  createProjectWithKey,
  waitForUsageRecords,
} from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

/**
 * A real call through the proxy with the official @anthropic-ai/sdk, the way
 * a tool configured with only ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY would
 * make it: the Parsim key is the SDK's apiKey and the real Anthropic key is
 * stored on the project. Opt-in only (`npm run test:live`), and skipped
 * without ANTHROPIC_API_KEY and ANTHROPIC_LIVE_TEST_MODEL in .env.test.
 */
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_LIVE_TEST_MODEL;
const enabled = process.env.LIVE_TESTS === 'true' && !!anthropicKey && !!model;
const run = enabled ? it : it.skip;

describe('Live Anthropic proxy calls', () => {
  let t: TestApp;
  let baseURL: string;

  beforeAll(async () => {
    if (!enabled) return;
    t = await createTestApp({ PROXY_ANTHROPIC_BASE_URL: '' });
    baseURL = await t.listen();
  });

  beforeEach(async () => {
    if (enabled) await t.reset();
  });

  afterAll(async () => {
    await t?.close();
  });

  run('should answer through the proxy and record usage', async () => {
    const fx = await createProjectWithKey(t, {
      upstream: 'anthropic',
      providerKey: anthropicKey,
    });
    const client = new Anthropic({
      apiKey: fx.parsimKey,
      baseURL,
      maxRetries: 3,
    });

    const message = await client.messages.create({
      model: model!,
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    });

    expect(message.content[0].type).toBe('text');
    expect(message.usage.input_tokens).toBeGreaterThan(0);
    const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
    expect(record).toMatchObject({ upstream: 'anthropic', status: 200 });
    expect(record.inputTokens).toBeGreaterThan(0);
    expect(record.outputTokens).toBeGreaterThan(0);
  });

  run('should stream through the proxy and record usage', async () => {
    const fx = await createProjectWithKey(t, {
      upstream: 'anthropic',
      providerKey: anthropicKey,
    });
    const client = new Anthropic({
      apiKey: fx.parsimKey,
      baseURL,
      maxRetries: 3,
    });

    const stream = client.messages.stream({
      model: model!,
      max_tokens: 40,
      messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
    });
    const final = await stream.finalMessage();

    expect(final.content.length).toBeGreaterThan(0);
    const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
    expect(record).toMatchObject({ streamed: true, status: 200 });
    expect(record.outputTokens).toBe(final.usage.output_tokens);
  });
});
