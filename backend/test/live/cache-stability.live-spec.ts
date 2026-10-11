import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { ProxyService } from '../../src/proxy/proxy.service';
import {
  loadConversation,
  toAnthropicBody,
  toGeminiBody,
} from '../utils/fixtures';
import { sessionRequests } from '../utils/long-session';
import { createProjectWithKey, UsageRow } from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

/**
 * A short real session sent twice, once with the GC off and once with it
 * on, comparing the cached input tokens the provider reports. Each run
 * gets its own first system line, so the second run cannot reuse the
 * first one's cache. Opt-in only (`npm run test:live`). The Gemini run
 * needs GEMINI_API_KEY and PARSIM_INTERNAL_MODEL (about $0.15 per run on
 * gemini-3.8-flash); the Anthropic run also needs ANTHROPIC_API_KEY and
 * ANTHROPIC_LIVE_TEST_MODEL and is skipped without them.
 */
const live = process.env.LIVE_TESTS === 'true';
const gemini = {
  key: process.env.GEMINI_API_KEY,
  model: process.env.PARSIM_INTERNAL_MODEL,
};
const anthropic = {
  key: process.env.ANTHROPIC_API_KEY,
  model: process.env.ANTHROPIC_LIVE_TEST_MODEL,
};

/** Six requests of the research session, growing from ~12k to ~28k tokens. */
const CUTS = (() => {
  const all = sessionRequests(loadConversation('research-agent-session'));
  return [50, 62, 74, 86, 100, 117].map(
    (target) => all.find((cut) => cut >= target) ?? all[all.length - 1],
  );
})();

/**
 * Gemini 3 models require a thought signature on every function call in
 * the history. The fixture's calls were not made by the model, so they get
 * the placeholder Google documents for that case.
 */
function withThoughtSignatures(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const contents = body.contents as { parts: Record<string, unknown>[] }[];
  return {
    ...body,
    contents: contents.map((content) => ({
      ...content,
      parts: content.parts.map((part) =>
        part.functionCall
          ? { ...part, thoughtSignature: 'skip_thought_signature_validator' }
          : part,
      ),
    })),
  };
}

type Totals = { requests: number; input: number; cached: number };

describe('Live prompt caching with the GC off and on', () => {
  let t: TestApp;

  beforeAll(async () => {
    if (!live) return;
    t = await createTestApp({
      PROXY_GEMINI_NATIVE_BASE_URL: '',
      PROXY_ANTHROPIC_BASE_URL: '',
      GC_SIDE_EFFECT_TOOLS: 'save_note',
    });
  });

  afterAll(async () => {
    await t?.close();
  });

  async function session(
    upstream: 'gemini' | 'anthropic',
    gcMode: 'off' | 'on',
    key: string,
    model: string,
  ): Promise<Totals> {
    const fx = await createProjectWithKey(t, { upstream, providerKey: key });
    await request(t.server)
      .patch(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ gcMode })
      .expect(200);
    const runId = `Run ${gcMode} ${Date.now()}.`;

    for (const cut of CUTS) {
      const c = loadConversation('research-agent-session');
      c.messages = c.messages.slice(0, cut);
      c.messages[0] = {
        role: 'system',
        content: `${runId} ${c.messages[0].content}`,
      };
      const body =
        upstream === 'gemini'
          ? {
              ...withThoughtSignatures(toGeminiBody(c)),
              generationConfig: { maxOutputTokens: 64 },
            }
          : {
              ...toAnthropicBody(c),
              model,
              max_tokens: 64,
              // Cache the system prompt and the conversation so far.
              system: [
                {
                  type: 'text',
                  text: c.messages[0].content,
                  cache_control: { type: 'ephemeral' },
                },
              ],
            };
      if (upstream === 'anthropic') {
        const messages = (
          body as unknown as {
            messages: { content: Record<string, unknown>[] }[];
          }
        ).messages;
        const last = messages[messages.length - 1].content;
        last[last.length - 1].cache_control = { type: 'ephemeral' };
      }
      const path =
        upstream === 'gemini'
          ? `/v1beta/models/${model}:generateContent`
          : '/v1/messages';
      // Gemini answers 503 when it is overloaded: retry with backoff.
      let res: request.Response | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        res = await request(t.server)
          .post(path)
          .set('content-type', 'application/json')
          .set('x-parsim-key', fx.parsimKey)
          .set('x-parsim-session-id', runId)
          .set('anthropic-version', '2023-06-01')
          .send(JSON.stringify(body));
        if (res.status !== 503 && res.status !== 429) break;
        await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
      }
      if (res!.status !== 200)
        console.log(res!.status, res!.text.slice(0, 600));
      expect(res!.status).toBe(200);
      await t.app.get(ProxyService).whenIdle();
    }

    const rows: UsageRow[] = await t.dataSource.query(
      'SELECT * FROM usage_record WHERE "projectId" = $1 AND status = 200 ORDER BY "createdAt"',
      [fx.project.id],
    );
    return {
      requests: rows.length,
      input: rows.reduce((sum, r) => sum + r.inputTokens, 0),
      cached: rows.reduce((sum, r) => sum + (r.cachedInputTokens ?? 0), 0),
    };
  }

  const report = (name: string, off: Totals, on: Totals) => {
    const line = (label: string, x: Totals) =>
      `${label}: requests=${x.requests} input=${x.input} cached=${x.cached} uncached=${x.input - x.cached} hitRate=${((100 * x.cached) / Math.max(1, x.input)).toFixed(1)}%`;
    console.log(`${name}\n  ${line('GC off', off)}\n  ${line('GC on ', on)}`);
  };

  const runGemini = live && gemini.key && gemini.model ? it : it.skip;
  runGemini(
    'should compare cached tokens on Gemini',
    async () => {
      const off = await session('gemini', 'off', gemini.key!, gemini.model!);
      const on = await session('gemini', 'on', gemini.key!, gemini.model!);
      report(`Gemini ${gemini.model}`, off, on);

      expect(off.requests).toBe(CUTS.length);
      expect(on.requests).toBe(CUTS.length);
      expect(on.input).toBeLessThan(off.input);
    },
    600_000,
  );

  const runAnthropic = live && anthropic.key && anthropic.model ? it : it.skip;
  runAnthropic(
    'should compare cached tokens on Anthropic with cache_control',
    async () => {
      const off = await session(
        'anthropic',
        'off',
        anthropic.key!,
        anthropic.model!,
      );
      const on = await session(
        'anthropic',
        'on',
        anthropic.key!,
        anthropic.model!,
      );
      report(`Anthropic ${anthropic.model}`, off, on);

      expect(on.input).toBeLessThan(off.input);
    },
    600_000,
  );
});
