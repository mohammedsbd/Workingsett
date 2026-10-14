import { describe, expect, it } from '@jest/globals';
import {
  ConversationId,
  FixtureConversation,
  loadConversation,
  toAnthropicBody,
  toGeminiBody,
  toOpenAiBody,
} from '../../test/utils/fixtures';
import { buildLongSession } from '../../test/utils/long-session';
import { contentHash } from '../context/canonical-json';
import { extractContextItems } from '../context/context-items';
import { AnthropicMessagesConverter } from '../context/normalization/anthropic-messages.converter';
import { GeminiNativeConverter } from '../context/normalization/gemini-native.converter';
import {
  InternalRequest,
  MessageConverter,
} from '../context/normalization/internal-model';
import { OpenAiChatConverter } from '../context/normalization/openai-chat.converter';
import { DEFAULT_GC_CONFIG, hasSideEffects } from '../gc/gc-config';
import { archiveIdFor, runGc } from '../gc/gc-engine';
import { applyCompressions, ReadyCompression } from './apply';
import {
  continueNote,
  InvalidSummaryError,
  parseSummary,
  renderStateBlock,
  STATE_BLOCK_START,
} from './state-block';
import {
  findStretch,
  stretchInput,
  tokensInRange,
  turnsOf,
  worthCompressing,
} from './stretch';
import { SUMMARY_INSTRUCTIONS, summaryPrompt } from './summary-prompt';

type Format = 'openai' | 'anthropic' | 'gemini';
const FORMATS: Format[] = ['openai', 'anthropic', 'gemini'];
const CONVERTERS: Record<Format, MessageConverter> = {
  openai: new OpenAiChatConverter(),
  anthropic: new AnthropicMessagesConverter(),
  gemini: new GeminiNativeConverter(),
};
const BODY = {
  openai: toOpenAiBody,
  anthropic: toAnthropicBody,
  gemini: toGeminiBody,
};

const GC_CONFIG = { ...DEFAULT_GC_CONFIG, sideEffectTools: ['save_note'] };
const isSideEffect = (name: string) => hasSideEffects(name, GC_CONFIG);
const tokens = (text: string) => Math.ceil(text.length / 4);
const STRETCH = { minTokens: 6000, protectedTurns: 6 };
const tokensOfItem = (item: { tokenText: string; imageCount: number }) =>
  tokens(item.tokenText) + item.imageCount * 85;

function request(
  format: Format,
  conversation: ConversationId | FixtureConversation,
): InternalRequest {
  const c =
    typeof conversation === 'string'
      ? loadConversation(conversation)
      : conversation;
  return CONVERTERS[format].toInternal(BODY[format](c));
}

function stretchOf(req: InternalRequest, after = 0, config = STRETCH) {
  const items = extractContextItems(req);
  return findStretch(
    req,
    items,
    tokensInRange(items, tokensOfItem),
    after,
    config,
  );
}

const SUMMARY = {
  goal: 'Write a two-page report on grid battery storage.',
  decisions: ['Use research.example.com articles as the main sources.'],
  facts: ['Battery recycling measured 17.0 units in revision 2.'],
  openItems: ['Check the remaining subtopics.'],
};

/** A ready compression for the first stretch of a request. */
function compressionFor(req: InternalRequest): ReadyCompression {
  const stretch = stretchOf(req)!;
  const input = stretchInput(req, stretch, isSideEffect);
  return {
    startIndex: stretch.startIndex,
    endIndex: stretch.endIndex,
    stretchKey: stretch.key,
    firstTurn: stretch.firstTurn,
    lastTurn: stretch.lastTurn,
    stateBlock: renderStateBlock({
      summary: SUMMARY,
      firstTurn: stretch.firstTurn,
      lastTurn: stretch.lastTurn,
      actions: input.actions,
      messages: input.messages,
    }),
  };
}

const messagesOf = (format: Format, req: InternalRequest) => {
  const body = CONVERTERS[format].fromInternal(req);
  return (body.messages ?? body.contents) as Record<string, unknown>[];
};

describe('compression', () => {
  describe('stretch detection', () => {
    it('should find the research session stretch: whole turns before the protected tail', () => {
      const req = request('openai', 'research-agent-session');
      const stretch = stretchOf(req)!;
      const turns = turnsOf(req.messages);

      expect(stretch).not.toBeNull();
      expect(req.messages[stretch.startIndex].role).toBe('assistant');
      expect(req.messages[stretch.endIndex].role).toBe('assistant');
      expect(stretch.firstTurn).toBe(1);
      // The tail keeps exactly the last six turns.
      expect(Math.max(...turns) - turns[stretch.endIndex] + 1).toBe(6);
      expect(stretch.tokens).toBeGreaterThanOrEqual(6000);
      // Never the system prompt or the goal.
      expect(stretch.startIndex).toBeGreaterThan(1);
    });

    it.each<[ConversationId, number, boolean]>([
      ['short-chat', 6000, false],
      ['support-agent-session', 6000, false],
      ['support-agent-session', 500, true],
      ['research-agent-session', 1_000_000, false],
    ])('%s with a %i token minimum: stretch=%s', (id, minTokens, found) => {
      const stretch = stretchOf(request('openai', id), 0, {
        ...STRETCH,
        minTokens,
      });
      expect(stretch !== null).toBe(found);
    });

    it('should start the next stretch after the previous one, and only once it is big enough', () => {
      const long = buildLongSession(40);
      const first = stretchOf(request('openai', long))!;
      const again = stretchOf(request('openai', long), first.endIndex);
      expect(again).toBeNull();

      const longer = buildLongSession(60);
      const next = stretchOf(request('openai', longer), first.endIndex)!;
      expect(next.startIndex).toBe(first.endIndex);
      expect(next.firstTurn).toBe(first.lastTurn + 1);
    });

    it('should not compress across an open tool call or a system message', () => {
      const req = request('openai', 'research-agent-session');
      const stretch = stretchOf(req)!;
      const toolIndex = req.messages.findIndex(
        (m, i) => i > stretch.startIndex && m.role === 'tool',
      );
      const withoutResult = {
        ...req,
        messages: req.messages.filter((_, i) => i !== toolIndex),
      };
      expect(stretchOf(withoutResult)).toBeNull();

      const withSystem = {
        ...req,
        messages: [
          ...req.messages.slice(0, stretch.startIndex + 2),
          { ...req.messages[0] },
          ...req.messages.slice(stretch.startIndex + 2),
        ],
      };
      expect(stretchOf(withSystem)).toBeNull();
    });

    it('should give the same stretch the same key, and changed content another', () => {
      const a = stretchOf(request('openai', 'research-agent-session'))!;
      const b = stretchOf(request('openai', 'research-agent-session'))!;
      expect(b.key).toBe(a.key);

      const changed = loadConversation('research-agent-session');
      const tool = changed.messages.findIndex((m) => m.role === 'tool');
      changed.messages[tool] = {
        ...changed.messages[tool],
        content: 'changed',
      } as (typeof changed.messages)[number];
      expect(stretchOf(request('openai', changed))!.key).not.toBe(a.key);
    });

    it('should only compress when the block would at least halve the stretch as sent', () => {
      const worth = (req: InternalRequest, sent: InternalRequest) => {
        const sentItems = extractContextItems(sent);
        const stretch = findStretch(
          req,
          extractContextItems(req),
          tokensInRange(sentItems, tokensOfItem),
          0,
          STRETCH,
        );
        return (
          stretch &&
          worthCompressing({
            sent,
            sentItems,
            stretch,
            stretchInput: stretchInput(req, stretch, isSideEffect),
            isSideEffect,
            count: tokens,
            tokensOf: tokensOfItem,
          })
        );
      };
      const research = request('openai', 'research-agent-session');
      expect(worth(research, research)?.worth).toBe(true);

      // After GC, a long session's stretch is mostly stubs and kept
      // save_note calls: a block would not halve it.
      const long = request('openai', buildLongSession(200));
      const gc = runGc({
        request: long,
        config: GC_CONFIG,
        countTokens: tokens,
      }).request;
      const check = worth(long, gc)!;
      expect(check.worth).toBe(false);
      expect(worth(long, long)?.worth).toBe(true);
    });

    it('should list every original with its archive id and the side-effect actions', () => {
      const req = request('openai', 'research-agent-session');
      const stretch = stretchOf(req)!;
      const input = stretchInput(req, stretch, isSideEffect);

      expect(input.goal).toContain('battery technology');
      expect(input.messages).toHaveLength(
        stretch.endIndex - stretch.startIndex,
      );
      for (const message of input.messages) {
        expect(message.archiveId).toBe(
          archiveIdFor(contentHash(message.content)),
        );
      }
      expect(input.actions.length).toBeGreaterThan(0);
      expect(
        input.actions.every((line) => /^save_note\(|^send_report\(/.test(line)),
      ).toBe(true);
      expect(input.actions[0]).toMatch(/ -> \{"ok":true/);
      expect(input.actions.every((line) => line.length < 400)).toBe(true);
    });
  });

  describe('state block', () => {
    it('should parse the summary, with or without a code fence', () => {
      const json = JSON.stringify({ ...SUMMARY, extra: 1 });
      expect(parseSummary(json)).toEqual(SUMMARY);
      expect(parseSummary('```json\n' + json + '\n```')).toEqual(SUMMARY);
      expect(
        parseSummary(
          JSON.stringify({
            goal: ' g ',
            open_items: ['  x\n y '],
            facts: [1, 'f'],
          }),
        ),
      ).toEqual({ goal: 'g', decisions: [], facts: ['f'], openItems: ['x y'] });
    });

    it.each([
      ['not JSON', 'not json'],
      ['an array', '[]'],
      ['a missing goal', '{"facts":[]}'],
      ['facts that are not a list', '{"goal":"g","facts":"x"}'],
    ])('should reject %s', (_, text) => {
      expect(() => parseSummary(text)).toThrow(InvalidSummaryError);
    });

    it('should bound long summaries', () => {
      const summary = parseSummary(
        JSON.stringify({
          goal: 'g',
          facts: Array.from({ length: 50 }, () => 'x'.repeat(1000)),
        }),
      );
      expect(summary.facts).toHaveLength(30);
      expect(summary.facts[0]).toHaveLength(600);
    });

    it('should render the documented layout', () => {
      const block = renderStateBlock({
        summary: SUMMARY,
        firstTurn: 1,
        lastTurn: 3,
        actions: ['save_note({"title":"t"}) -> {"ok":true}'],
        messages: [
          {
            index: 2,
            turn: 1,
            role: 'assistant',
            content: { kind: 'assistant', parts: [] },
            archiveId: 'arc_aaaaaaaaaaaaaaaa',
          },
          {
            index: 3,
            turn: 1,
            role: 'tool',
            content: { kind: 'tool_result', parts: [] },
            archiveId: 'arc_bbbbbbbbbbbbbbbb',
          },
          {
            index: 4,
            turn: 3,
            role: 'assistant',
            content: { kind: 'assistant', parts: [] },
            archiveId: 'arc_cccccccccccccccc',
          },
        ],
      });
      expect(block).toBe(
        [
          '[parsim state block: turns 1 to 3 were compressed. Call parsim_recall with an id from Originals to see an original message.]',
          'Goal: Write a two-page report on grid battery storage.',
          'Decisions made:',
          '- Use research.example.com articles as the main sources.',
          'Facts learned:',
          '- Battery recycling measured 17.0 units in revision 2.',
          'Open items:',
          '- Check the remaining subtopics.',
          'Actions taken (their calls and results follow this block, unchanged):',
          '- save_note({"title":"t"}) -> {"ok":true}',
          'Originals:',
          '- turn 1: arc_aaaaaaaaaaaaaaaa, arc_bbbbbbbbbbbbbbbb',
          '- turn 3: arc_cccccccccccccccc',
          '[end of parsim state block]',
        ].join('\n'),
      );
    });

    it('should write "none" for empty sections', () => {
      const block = renderStateBlock({
        summary: { goal: 'g', decisions: [], facts: [], openItems: [] },
        firstTurn: 1,
        lastTurn: 1,
        actions: [],
        messages: [],
      });
      expect(block.match(/^- none$/gm)).toHaveLength(4);
    });

    it('should build a summary prompt with the goal and the transcript', () => {
      const req = request('openai', 'research-agent-session');
      const input = stretchInput(req, stretchOf(req)!, isSideEffect);
      const prompt = summaryPrompt(input);
      expect(prompt).toContain(input.goal);
      expect(prompt).toContain('--- Turn 1, Agent:');
      expect(prompt).toContain('[calls web_search with');
      expect(prompt).toContain('Tool result:');
      expect(SUMMARY_INSTRUCTIONS).toContain('"openItems"');
    });
  });

  describe.each(FORMATS)('applying a state block (%s)', (format) => {
    const original = request(format, 'research-agent-session');
    const compression = compressionFor(original);
    const { request: out, applied } = applyCompressions({
      original,
      request: original,
      compressions: [compression],
      isSideEffect,
    });
    const before = messagesOf(format, original);
    const after = messagesOf(format, out);
    const removed = compression.endIndex - compression.startIndex;
    const replacementLength = after.length - (before.length - removed);

    it('should replace the stretch with the block and keep everything around it', () => {
      expect(applied).toBe(1);
      expect(JSON.stringify(after.slice(0, compression.startIndex))).toBe(
        JSON.stringify(before.slice(0, compression.startIndex)),
      );
      expect(
        JSON.stringify(after.slice(compression.startIndex + replacementLength)),
      ).toBe(JSON.stringify(before.slice(compression.endIndex)));
      expect(JSON.stringify(after[compression.startIndex])).toContain(
        STATE_BLOCK_START,
      );
      expect(
        JSON.stringify(CONVERTERS[format].fromInternal(out)).length,
      ).toBeLessThan(
        JSON.stringify(CONVERTERS[format].fromInternal(original)).length / 2,
      );
    });

    it('should never change or removes the system prompt or the first user goal', () => {
      const body = CONVERTERS[format].fromInternal(out);
      const originalBody = CONVERTERS[format].fromInternal(original);
      expect(body.system).toEqual(originalBody.system);
      expect(body.systemInstruction).toEqual(originalBody.systemInstruction);
      const goal = original.messages.findIndex((m) => m.role === 'user');
      expect(compression.startIndex).toBeGreaterThan(goal);
      expect(after.slice(0, goal + 1)).toEqual(before.slice(0, goal + 1));
    });

    it('should never drop a side-effect tool call or its result: they stay unchanged', () => {
      const sideEffectParts = original.messages
        .slice(compression.startIndex, compression.endIndex)
        .flatMap((m) => m.parts)
        .filter((p) => p.type === 'tool_call' && isSideEffect(p.name));
      const ids = new Set(
        sideEffectParts.map((p) => (p.type === 'tool_call' ? p.id : '')),
      );
      const resultParts = original.messages
        .slice(compression.startIndex, compression.endIndex)
        .flatMap((m) => m.parts)
        .filter((p) => p.type === 'tool_result' && ids.has(p.toolCallId));
      expect(sideEffectParts.length).toBeGreaterThan(0);
      const outParts = out.messages.flatMap((m) => m.parts);
      for (const part of [...sideEffectParts, ...resultParts]) {
        expect(outParts).toContain(part);
      }
      // ...and the rebuilt request still carries their exact JSON.
      const outJson = JSON.stringify(after);
      for (const part of sideEffectParts) {
        expect(outJson).toContain(
          JSON.stringify(part.raw as Record<string, unknown>),
        );
      }
    });

    it('should keep every tool call paired with its tool result', () => {
      const head = out.messages[compression.startIndex];
      const calls = head.parts.filter((p) => p.type === 'tool_call');
      const next = out.messages.slice(
        compression.startIndex + 1,
        compression.startIndex + replacementLength,
      );
      const answered = next
        .flatMap((m) => m.parts)
        .filter((p) => p.type === 'tool_result')
        .map((p) => (p.type === 'tool_result' ? p.toolCallId : ''));
      expect(answered).toEqual(
        calls.map((c) => (c.type === 'tool_call' ? c.id : '')),
      );
      // The block is an assistant turn followed by the user side.
      expect(head.role).toBe('assistant');
      expect(out.messages[compression.startIndex - 1].role).not.toBe(
        'assistant',
      );
      expect(
        out.messages[compression.startIndex + replacementLength].role,
      ).toBe('assistant');
    });

    it('should send the same bytes every time (stable prefix)', () => {
      const again = applyCompressions({
        original: request(format, 'research-agent-session'),
        request: request(format, 'research-agent-session'),
        compressions: [compression],
        isSideEffect,
      }).request;
      expect(JSON.stringify(CONVERTERS[format].fromInternal(again))).toBe(
        JSON.stringify(CONVERTERS[format].fromInternal(out)),
      );
    });

    it('should work on top of the GC, with the same messages in the same places', () => {
      const gc = runGc({
        request: original,
        config: { ...GC_CONFIG, minContextTokens: 0, batchTokens: 0 },
        countTokens: (text) => tokens(text),
      }).request;
      const result = applyCompressions({
        original,
        request: gc,
        compressions: [compression],
        isSideEffect,
      });
      expect(result.applied).toBe(1);
      // The tail keeps its GC rewrites.
      expect(JSON.stringify(messagesOf(format, result.request).slice(-5))).toBe(
        JSON.stringify(messagesOf(format, gc).slice(-5)),
      );
    });
  });

  describe('applying edge cases', () => {
    const original = request('anthropic', 'research-agent-session');
    const compression = compressionFor(original);

    it('should skip a block whose stretch changed or is no longer there', () => {
      const shorter = {
        ...original,
        messages: original.messages.slice(0, compression.endIndex - 1),
      };
      expect(
        applyCompressions({
          original: shorter,
          request: shorter,
          compressions: [compression],
          isSideEffect,
        }).applied,
      ).toBe(0);
      expect(
        applyCompressions({
          original,
          request: original,
          compressions: [{ ...compression, stretchKey: 'x'.repeat(64) }],
          isSideEffect,
        }),
      ).toEqual({ request: original, applied: 0 });
    });

    it('should add a continue note when the stretch has no side effects', () => {
      const out = applyCompressions({
        original,
        request: original,
        compressions: [compression],
        isSideEffect: () => false,
      }).request;
      const [head, note] = out.messages.slice(
        compression.startIndex,
        compression.startIndex + 2,
      );
      expect(head.parts).toHaveLength(1);
      expect(note.role).toBe('user');
      expect(note.parts[0]).toMatchObject({
        type: 'text',
        text: continueNote(compression.firstTurn, compression.lastTurn),
      });
    });

    it('should apply several stretches and never two overlapping ones', () => {
      const long = request('openai', buildLongSession(60));
      const first = stretchOf(long, 0, { ...STRETCH, protectedTurns: 30 })!;
      const second = stretchOf(long, first.endIndex)!;
      const toReady = (s: typeof first): ReadyCompression => ({
        startIndex: s.startIndex,
        endIndex: s.endIndex,
        stretchKey: s.key,
        firstTurn: s.firstTurn,
        lastTurn: s.lastTurn,
        stateBlock: `${STATE_BLOCK_START} ${s.firstTurn}]`,
      });
      const both = applyCompressions({
        original: long,
        request: long,
        compressions: [toReady(first), toReady(second)],
        isSideEffect,
      });
      expect(both.applied).toBe(2);
      const overlapping = stretchOf(long, 0)!;
      expect(
        applyCompressions({
          original: long,
          request: long,
          compressions: [toReady(first), toReady(overlapping)],
          isSideEffect,
        }).applied,
      ).toBe(1);
    });
  });
});
