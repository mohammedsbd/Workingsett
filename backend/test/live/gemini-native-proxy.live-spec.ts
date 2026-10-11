import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { GoogleGenAI } from '@google/genai';
import {
  createProjectWithKey,
  waitForUsageRecords,
} from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

/**
 * A real Gemini native call through the proxy with the official
 * @google/genai SDK, configured only with a base URL and an API key: the
 * Parsim key is the SDK's apiKey and the real Google key is stored on the
 * project. Opt-in only (`npm run test:live`), and skipped without
 * GEMINI_API_KEY and PARSIM_INTERNAL_MODEL in .env.test. The prompts are
 * tiny, a fraction of a cent per run.
 */
const geminiKey = process.env.GEMINI_API_KEY;
const model = process.env.PARSIM_INTERNAL_MODEL;
const enabled = process.env.LIVE_TESTS === 'true' && !!geminiKey && !!model;
const run = enabled ? it : it.skip;

describe('Live Gemini native proxy calls', () => {
  let t: TestApp;
  let baseUrl: string;

  beforeAll(async () => {
    if (!enabled) return;
    t = await createTestApp({ PROXY_GEMINI_NATIVE_BASE_URL: '' });
    baseUrl = await t.listen();
  });

  beforeEach(async () => {
    if (enabled) await t.reset();
  });

  afterAll(async () => {
    await t?.close();
  });

  const client = async () => {
    const fx = await createProjectWithKey(t, {
      upstream: 'gemini',
      providerKey: geminiKey,
    });
    const ai = new GoogleGenAI({
      apiKey: fx.parsimKey,
      httpOptions: { baseUrl },
    });
    return { fx, ai };
  };

  run('should answer through the proxy and record usage', async () => {
    const { fx, ai } = await client();

    const response = await ai.models.generateContent({
      model: model!,
      contents: 'Reply with the single word: ok',
    });

    expect(response.text?.toLowerCase()).toContain('ok');
    const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
    expect(record).toMatchObject({
      upstream: 'gemini',
      model,
      status: 200,
      streamed: false,
    });
    expect(record.inputTokens).toBeGreaterThan(0);
    expect(record.outputTokens).toBeGreaterThan(0);
  });

  run('should stream through the proxy and record usage', async () => {
    const { fx, ai } = await client();

    const stream = await ai.models.generateContentStream({
      model: model!,
      contents: 'Count from 1 to 5, separated by spaces.',
    });
    let text = '';
    for await (const chunk of stream) text += chunk.text ?? '';

    expect(text).toContain('3');
    const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
    expect(record).toMatchObject({ upstream: 'gemini', streamed: true });
    expect(record.inputTokens).toBeGreaterThan(0);
    expect(record.outputTokens).toBeGreaterThan(0);
  });
});
