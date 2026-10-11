import { describe, expect, it } from '@jest/globals';
import {
  ConversationId,
  FixtureConversation,
  loadConversation,
  toAnthropicBody,
  toGeminiBody,
  toOpenAiBody,
} from '../../test/utils/fixtures';
import {
  buildLongSession,
  sessionRequests,
} from '../../test/utils/long-session';
import { replayPrefixCache } from '../../test/utils/prefix-cache';
import { AnthropicMessagesConverter } from '../context/normalization/anthropic-messages.converter';
import { GeminiNativeConverter } from '../context/normalization/gemini-native.converter';
import {
  InternalRequest,
  MessageConverter,
} from '../context/normalization/internal-model';
import { OpenAiChatConverter } from '../context/normalization/openai-chat.converter';
import { TokenCounter } from '../context/token-counter';
import { DEFAULT_GC_CONFIG, GcConfig } from './gc-config';
import { runGc } from './gc-engine';
import { GcResult, PriorDecision } from './gc-types';

type Format = 'openai' | 'anthropic' | 'gemini';
const CONVERTERS: Record<Format, MessageConverter> = {
  openai: new OpenAiChatConverter(),
  anthropic: new AnthropicMessagesConverter(),
  gemini: new GeminiNativeConverter(),
};
const BODY: Record<
  Format,
  (c: FixtureConversation) => Record<string, unknown>
> = {
  openai: toOpenAiBody,
  anthropic: toAnthropicBody,
  gemini: toGeminiBody,
};

/** Fast and deterministic, for replaying hundreds of requests. */
const approxTokens = (text: string, images = 0) =>
  Math.ceil(text.length / 4) + images * 85;

const CONFIG: GcConfig = {
  ...DEFAULT_GC_CONFIG,
  sideEffectTools: ['save_note'],
  archiveMinTokens: 500,
};

const messagesOf = (format: Format, request: InternalRequest) => {
  const body = CONVERTERS[format].fromInternal(request);
  return (body.messages ?? body.contents) as unknown[];
};

type Step = { result: GcResult; messages: string[] };

/**
 * Replays a session the way the proxy does: every request carries the
 * decisions stored so far and the processed position of the last pass.
 */
function replay(
  format: Format,
  conversation: FixtureConversation,
  config: GcConfig = CONFIG,
  gcOn = true,
): Step[] {
  let prior: PriorDecision[] = [];
  let processedPosition = 0;
  return sessionRequests(conversation).map((cut) => {
    const request = CONVERTERS[format].toInternal(
      BODY[format]({
        ...conversation,
        messages: conversation.messages.slice(0, cut),
      }),
    );
    const result = gcOn
      ? runGc({
          request,
          config,
          countTokens: approxTokens,
          prior,
          processedPosition,
        })
      : null;
    if (result) {
      prior = [...prior, ...result.decisions.filter((d) => !d.sticky)];
      processedPosition = result.processedPosition;
    }
    return {
      result: result!,
      messages: messagesOf(format, result?.request ?? request).map((m) =>
        JSON.stringify(m),
      ),
    };
  });
}

describe('GC batching and prefix stability', () => {
  const session = buildLongSession(200);

  it('should build a 200-request session', () => {
    expect(sessionRequests(session)).toHaveLength(200);
  });

  describe.each<Format>(['openai', 'anthropic', 'gemini'])(
    '%s format, 200 requests',
    (format) => {
      const steps = replay(format, session);
      const passes = steps.filter((s) => s.result.ran).length;

      it('should run passes only in batches', () => {
        expect(passes).toBeGreaterThan(1);
        expect(passes).toBeLessThan(steps.length / 3);
      });

      it('should change the prefix only at batch points', () => {
        for (let i = 1; i < steps.length; i++) {
          if (steps[i].result.ran) continue;
          const before = steps[i - 1].messages;
          expect(steps[i].messages.slice(0, before.length)).toEqual(before);
        }
      });

      it('should never change a processed (rewritten) message', () => {
        const firstSeen = new Map<number, string>();
        steps.forEach((step) => {
          const rewritten = new Set(
            step.result.decisions.map((d) => d.itemKey),
          );
          step.messages.forEach((message, index) => {
            if (!message.includes('[parsim ')) return;
            const seen = firstSeen.get(index);
            if (seen === undefined) firstSeen.set(index, message);
            else expect(message).toBe(seen);
          });
          expect(rewritten.size).toBe(step.result.decisions.length);
        });
        expect(firstSeen.size).toBeGreaterThan(50);
      });

      it('should only add decisions, at batch points', () => {
        for (let i = 1; i < steps.length; i++) {
          const before = steps[i - 1].result.decisions.map((d) => d.itemKey);
          const now = steps[i].result.decisions;
          const keys = new Set(now.map((d) => d.itemKey));
          for (const key of before) expect(keys.has(key)).toBe(true);
          const fresh = now.filter((d) => !d.sticky);
          if (!steps[i].result.ran) expect(fresh).toEqual([]);
        }
      });
    },
  );

  describe('pass rules', () => {
    const request = CONVERTERS.openai.toInternal(
      toOpenAiBody(loadConversation('research-agent-session')),
    );
    const run = (processedPosition: number, config: Partial<GcConfig> = {}) =>
      runGc({
        request,
        config: { ...CONFIG, ...config },
        countTokens: approxTokens,
        processedPosition,
      });

    it('should run a pass on the first request over the threshold', () => {
      const result = run(0);
      expect(result.ran).toBe(true);
      expect(result.unprocessedTokens).toBe(result.tokensBefore);
      expect(result.processedPosition).toBeGreaterThan(100);
    });

    it('should not run again until enough new context arrives', () => {
      const first = run(0);
      const again = run(first.processedPosition);
      expect(again).toMatchObject({
        ran: false,
        unprocessedTokens: 0,
        processedPosition: first.processedPosition,
        decisions: [],
      });
    });

    it('should run when the new part is over the batch size', () => {
      const almostAll = run(0).processedPosition - 20;
      const result = run(almostAll, { batchTokens: 100 });
      expect(result.ran).toBe(true);
      expect(run(almostAll, { batchTokens: 1_000_000 }).ran).toBe(false);
    });

    it('should start over when the client trimmed its history', () => {
      const result = run(10_000);
      expect(result.ran).toBe(true);
      expect(result.unprocessedTokens).toBe(result.tokensBefore);
    });

    it('should neither archive nor reapply archives when archiving is not allowed', () => {
      const normal = run(0);
      const archives = normal.decisions.filter((d) => d.decision === 'archive');
      expect(archives.length).toBeGreaterThan(0);

      const noArchive = runGc({
        request,
        config: CONFIG,
        countTokens: approxTokens,
        prior: normal.decisions,
        allowArchive: false,
      });
      expect(
        noArchive.decisions.filter((d) => d.decision === 'archive'),
      ).toEqual([]);
      // Drops still apply, exactly as before.
      expect(noArchive.decisions.map((d) => d.itemKey)).toEqual(
        normal.decisions
          .filter((d) => d.decision === 'drop')
          .map((d) => d.itemKey),
      );
    });
  });

  describe('simulated prompt cache, GC off and on', () => {
    const counter = new TokenCounter();
    const count = (text: string) =>
      counter.count(text, 0, { upstream: 'openai', model: 'gpt-4o' }).tokens;
    const sessions: [
      ConversationId | 'long-research-session',
      FixtureConversation,
    ][] = [
      ['research-agent-session', loadConversation('research-agent-session')],
      ['support-agent-session', loadConversation('support-agent-session')],
      ['long-research-session', buildLongSession(60)],
    ];

    /** Input tokens billed when cached tokens cost `discount` of the price. */
    const billed = (
      r: ReturnType<typeof replayPrefixCache>,
      discount: number,
    ) => r.inputTokens - r.cachedTokens + discount * r.cachedTokens;

    it.each(sessions)(
      'should bill fewer input tokens with the GC on, even with a 90%% cache discount (%s)',
      (_, conversation) => {
        const toMessages = (steps: Step[]) =>
          steps.map((s) => s.messages.map((m) => JSON.parse(m) as unknown));
        const off = replayPrefixCache(
          toMessages(replay('openai', conversation, CONFIG, false)),
          count,
        );
        const onSteps = replay('openai', conversation);
        const on = replayPrefixCache(toMessages(onSteps), count);
        const passes = onSteps.filter((s) => s.result.ran).length;

        expect(on.inputTokens).toBeLessThanOrEqual(off.inputTokens);
        expect(billed(on, 0.1)).toBeLessThanOrEqual(billed(off, 0.1));
        // Every request outside a pass reuses its whole previous request.
        expect(on.fullPrefixHits).toBeGreaterThanOrEqual(
          on.requests - 1 - passes,
        );
        if (passes === 0) expect(on).toEqual(off);
      },
    );
  });
});
