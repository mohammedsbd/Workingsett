import { describe, expect, it } from '@jest/globals';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseSummary,
  renderStateBlock,
} from '../../src/compression/state-block';
import {
  findStretch,
  stretchInput,
  tokensInRange,
} from '../../src/compression/stretch';
import { summarize } from '../../src/compression/summarizer';
import {
  SUMMARY_INSTRUCTIONS,
  summaryPrompt,
} from '../../src/compression/summary-prompt';
import { extractContextItems } from '../../src/context/context-items';
import { OpenAiChatConverter } from '../../src/context/normalization/openai-chat.converter';
import { TokenCounter } from '../../src/context/token-counter';
import { DEFAULT_GC_CONFIG, hasSideEffects } from '../../src/gc/gc-config';
import { loadConversation, toOpenAiBody } from '../utils/fixtures';

/**
 * One real summary of the research fixture's first finished stretch by
 * Parsim's internal model (GEMINI_API_KEY and PARSIM_INTERNAL_MODEL in
 * .env.test). Opt-in only (`npm run test:live`). The fixture is synthetic,
 * so nothing real goes through the key. One call of about 10k input
 * tokens, well under a cent. The result is written to a temp file to be
 * checked by hand; the example in docs/compression.md comes from it.
 */
const key = process.env.GEMINI_API_KEY;
const model = process.env.PARSIM_INTERNAL_MODEL;
const enabled =
  process.env.LIVE_TESTS === 'true' &&
  process.env.PARSIM_INTERNAL_PROVIDER !== 'openai' &&
  process.env.PARSIM_INTERNAL_PROVIDER !== 'anthropic' &&
  !!key &&
  !!model;
const run = enabled ? it : it.skip;

describe('Live compression summary', () => {
  run(
    'should summarize a fixture stretch into a valid state block',
    async () => {
      const request = new OpenAiChatConverter().toInternal(
        toOpenAiBody(loadConversation('research-agent-session')),
      );
      const tokens = new TokenCounter();
      const target = { upstream: 'gemini' as const, model: model! };
      const items = extractContextItems(request);
      const stretch = findStretch(
        request,
        items,
        tokensInRange(
          items,
          (item) =>
            tokens.count(item.tokenText, item.imageCount, target).tokens,
        ),
        0,
        { minTokens: 6000, protectedTurns: DEFAULT_GC_CONFIG.protectedTurns },
      )!;
      const config = { ...DEFAULT_GC_CONFIG, sideEffectTools: ['save_note'] };
      const input = stretchInput(request, stretch, (name) =>
        hasSideEffects(name, config),
      );

      const result = await summarize(
        {
          provider: 'gemini',
          model: model!,
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: key!,
        },
        SUMMARY_INSTRUCTIONS,
        summaryPrompt(input),
      );
      const summary = parseSummary(result.text);
      const block = renderStateBlock({
        summary,
        firstTurn: stretch.firstTurn,
        lastTurn: stretch.lastTurn,
        actions: input.actions,
        messages: input.messages,
      });
      const blockTokens = tokens.count(block, 0, target).tokens;

      const file = path.join(tmpdir(), 'parsim-compression-example.json');
      writeFileSync(
        file,
        JSON.stringify(
          {
            model,
            turns: [stretch.firstTurn, stretch.lastTurn],
            stretchTokens: stretch.tokens,
            blockTokens,
            usage: result.usage,
            summary,
            stateBlock: block,
          },
          null,
          2,
        ),
      );
      console.log(`Compression example written to ${file}`);

      expect(summary.goal.length).toBeGreaterThan(10);
      expect(summary.facts.length).toBeGreaterThan(0);
      expect(result.usage?.inputTokens).toBeGreaterThan(1000);
      expect(blockTokens).toBeLessThan(stretch.tokens / 4);
    },
  );
});
