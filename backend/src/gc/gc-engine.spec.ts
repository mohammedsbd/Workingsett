import { describe, expect, it } from '@jest/globals';
import {
  ConversationId,
  loadConversation,
  toAnthropicBody,
  toGeminiBody,
  toOpenAiBody,
} from '../../test/utils/fixtures';
import { canonicalJson, contentHash } from '../context/canonical-json';
import { extractContextItems } from '../context/context-items';
import { AnthropicMessagesConverter } from '../context/normalization/anthropic-messages.converter';
import { GeminiNativeConverter } from '../context/normalization/gemini-native.converter';
import {
  InternalRequest,
  MessageConverter,
} from '../context/normalization/internal-model';
import { OpenAiChatConverter } from '../context/normalization/openai-chat.converter';
import { TokenCounter } from '../context/token-counter';
import { DEFAULT_GC_CONFIG, GcConfig } from './gc-config';
import {
  archiveIdFor,
  archiveStub,
  duplicateStub,
  runGc,
  supersededStub,
} from './gc-engine';
import { GcDecision, GcReason, GcResult, PriorDecision } from './gc-types';

const openAi = new OpenAiChatConverter();
const anthropic = new AnthropicMessagesConverter();
const counter = new TokenCounter();
const countTokens = (text: string, images: number) =>
  counter.count(text, images, { upstream: 'openai', model: 'gpt-4o' }).tokens;

const gemini = new GeminiNativeConverter();

type Format = 'openai' | 'anthropic' | 'gemini';
const FORMATS: Format[] = ['openai', 'anthropic', 'gemini'];
const CONVERTERS: Record<Format, MessageConverter> = {
  openai: openAi,
  anthropic,
  gemini,
};
const converterFor = (format: Format): MessageConverter => CONVERTERS[format];
const FORMAT_OF_API: Record<InternalRequest['api'], Format> = {
  'openai-chat': 'openai',
  'anthropic-messages': 'anthropic',
  'gemini-native': 'gemini',
};

/** The message list of a rebuilt body (Gemini calls it contents). */
const messagesOf = (body: Record<string, unknown>) =>
  (body.messages ?? body.contents) as Record<string, unknown>[];

/** save_note writes to a shared notebook, but matches no default pattern. */
const RESEARCH_SIDE_EFFECTS = ['save_note'];

function body(id: ConversationId, format: Format, messages?: number) {
  const conversation = loadConversation(id);
  if (messages !== undefined) {
    conversation.messages = conversation.messages.slice(0, messages);
  }
  return format === 'openai'
    ? toOpenAiBody(conversation)
    : format === 'anthropic'
      ? toAnthropicBody(conversation)
      : toGeminiBody(conversation);
}

function request(
  id: ConversationId,
  format: Format = 'openai',
  messages?: number,
): InternalRequest {
  return converterFor(format).toInternal(body(id, format, messages));
}

function gc(
  input: InternalRequest,
  config: Partial<GcConfig> = {},
  prior?: PriorDecision[],
): GcResult {
  return runGc({
    request: input,
    config: {
      ...DEFAULT_GC_CONFIG,
      // Every call is a pass unless a test sets a batch size.
      batchTokens: 0,
      sideEffectTools: RESEARCH_SIDE_EFFECTS,
      ...config,
    },
    countTokens,
    prior,
  });
}

const json = (req: InternalRequest) =>
  JSON.stringify(converterFor(FORMAT_OF_API[req.api]).fromInternal(req));

const reasons = (result: GcResult) =>
  new Set(result.decisions.map((d) => d.reason));

/** Tool name of every tool call id in the original request. */
function toolNames(req: InternalRequest): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of req.messages) {
    for (const part of message.parts) {
      if (part.type === 'tool_call') names.set(part.id, part.name);
    }
  }
  return names;
}

/** Tool call ids of the side-effect calls in the research fixture. */
/** Tool call arguments in one comparable form, for either format. */
const args = (input: unknown) =>
  canonicalJson(typeof input === 'string' ? JSON.parse(input) : input);

const SIDE_EFFECT_TOOLS = new Set([
  'save_note',
  'send_report',
  'issue_refund',
  'send_reply',
]);

/** 1 for the newest turn, as the engine counts them. */
function ageOfMessage(req: InternalRequest): number[] {
  let turn = 0;
  const turns = req.messages.map((m) =>
    m.role === 'assistant' ? ++turn : turn,
  );
  return turns.map((t) => (t ? turn - t + 1 : 0));
}

/** Index of the first message of the last n turns. */
function protectedFrom(req: InternalRequest, n: number): number {
  const ages = ageOfMessage(req);
  const index = ages.findIndex((age) => age > 0 && age <= n);
  return index === -1 ? req.messages.length : index;
}

describe('runGc', () => {
  describe('rules over the fixture conversations', () => {
    const NO_ARCHIVE = { minContextTokens: 0, archiveMinTokens: Infinity };
    type Row = {
      rule: string;
      id: ConversationId;
      config: Partial<GcConfig>;
      expected: GcReason[];
      check: (decision: GcDecision, req: InternalRequest) => void;
    };

    const items = (req: InternalRequest) => extractContextItems(req);
    const rows: Row[] = [
      {
        rule: 'drops a tool result whose exact content appears again later',
        id: 'research-agent-session',
        config: NO_ARCHIVE,
        expected: ['duplicate', 'superseded'],
        check: (decision, req) => {
          if (decision.reason !== 'duplicate') return;
          const later = items(req).filter(
            (i) =>
              i.kind === 'tool_result' &&
              i.contentHash === decision.contentHash &&
              i.position > decision.position,
          );
          expect(later.length).toBeGreaterThan(0);
          expect(decision.decision).toBe('drop');
          expect(decision.replacement).toBe(duplicateStub(decision.toolName));
        },
      },
      {
        rule: 'drops a tool result superseded by a later identical call',
        id: 'research-agent-session',
        config: NO_ARCHIVE,
        expected: ['duplicate', 'superseded'],
        check: (decision, req) => {
          if (decision.reason !== 'superseded') return;
          const call = items(req).find(
            (i) =>
              i.kind === 'tool_call' && i.toolCallId === decision.toolCallId,
          )!;
          const [first] = call.content.parts;
          const repeats = items(req).filter((i) => {
            if (i.kind !== 'tool_call' || i.position <= call.position) {
              return false;
            }
            const [part] = i.content.parts;
            return (
              part.type === 'tool_call' &&
              first.type === 'tool_call' &&
              part.name === first.name &&
              args(part.input) === args(first.input)
            );
          });
          expect(repeats.length).toBeGreaterThan(0);
          expect(decision.decision).toBe('drop');
          expect(decision.replacement).toBe(supersededStub(decision.toolName));
        },
      },
      {
        rule: 'archives large tool results more than K turns old',
        id: 'research-agent-session',
        config: { minContextTokens: 0, archiveMinTokens: 500 },
        expected: ['duplicate', 'superseded', 'stale_large'],
        check: (decision, req) => {
          if (decision.reason !== 'stale_large') return;
          expect(decision.decision).toBe('archive');
          expect(decision.tokensBefore).toBeGreaterThan(500);
          expect(decision.archiveId).toBe(archiveIdFor(decision.contentHash));
          expect(decision.replacement).toBe(
            archiveStub(
              decision.toolName,
              decision.tokensBefore,
              decision.archiveId!,
            ),
          );
          const item = items(req).find(
            (i) => i.position === decision.position,
          )!;
          expect(ageOfMessage(req)[item.messageIndex!]).toBeGreaterThan(6);
        },
      },
      {
        rule: 'archives in the support session once results are large enough',
        id: 'support-agent-session',
        config: {
          minContextTokens: 0,
          archiveMinTokens: 100,
          archiveAfterTurns: 2,
          protectedTurns: 2,
        },
        expected: ['duplicate', 'stale_large'],
        check: (decision) => {
          // search_kb returns the same policy article for every ticket.
          expect(decision.toolName).toBe(
            decision.reason === 'duplicate' ? 'search_kb' : decision.toolName,
          );
          expect(decision.decision).toBe(
            decision.reason === 'stale_large' ? 'archive' : 'drop',
          );
          expect(SIDE_EFFECT_TOOLS.has(decision.toolName)).toBe(false);
        },
      },
      {
        rule: 'leaves a conversation without tools alone',
        id: 'short-chat',
        config: { minContextTokens: 0, archiveMinTokens: 0 },
        expected: [],
        check: () => undefined,
      },
    ];

    describe.each(FORMATS)('%s format', (format) => {
      it.each(rows)('$rule ($id)', ({ id, config, expected, check }) => {
        const req = request(id, format);
        const result = gc(req, config);

        expect([...reasons(result)].sort()).toEqual([...expected].sort());
        for (const decision of result.decisions) {
          expect(decision.sticky).toBe(false);
          expect(decision.tokensAfter).toBeLessThan(decision.tokensBefore);
          check(decision, req);
        }
        expect(result.tokensAfter).toBe(
          result.tokensBefore -
            result.decisions.reduce(
              (sum, d) => sum + d.tokensBefore - d.tokensAfter,
              0,
            ),
        );
      });
    });

    it('should apply the rules in order: duplicate, then superseded, then archive', () => {
      const result = gc(request('research-agent-session'), {
        minContextTokens: 0,
        archiveMinTokens: 0,
      });
      const byHash = new Map<string, GcDecision[]>();
      for (const d of result.decisions) {
        byHash.set(d.contentHash, [...(byHash.get(d.contentHash) ?? []), d]);
      }
      // Of identical results, only the newest can be archived; the others are duplicates.
      for (const group of byHash.values()) {
        expect(group.slice(0, -1).every((d) => d.reason === 'duplicate')).toBe(
          true,
        );
      }
    });
  });

  describe('GC invariants', () => {
    const AGGRESSIVE = {
      minContextTokens: 0,
      archiveMinTokens: 0,
      archiveAfterTurns: 1,
      protectedTurns: 1,
    };

    describe.each(FORMATS)('%s format', (format) => {
      const ids: ConversationId[] = [
        'research-agent-session',
        'support-agent-session',
      ];

      it.each(ids)('never changes or removes the system prompt (%s)', (id) => {
        const req = request(id, format);
        const out = gc(req, AGGRESSIVE).request;
        expect(out.system).toEqual(req.system);
        const before = converterFor(format).fromInternal(req);
        const after = converterFor(format).fromInternal(out);
        expect(after.system).toEqual(before.system);
        expect(after.systemInstruction).toEqual(before.systemInstruction);
        const systems = (b: Record<string, unknown>) =>
          messagesOf(b).filter((m) => m.role === 'system');
        expect(systems(after)).toEqual(systems(before));
      });

      it.each(ids)('never changes the first user goal (%s)', (id) => {
        const req = request(id, format);
        const out = gc(req, AGGRESSIVE).request;
        const first = req.messages.findIndex((m) => m.role === 'user');
        expect(out.messages[first]).toBe(req.messages[first]);
      });

      it.each([1, 3, 6, 10])(
        'never changes the last N turns (N=%i)',
        (protectedTurns) => {
          const req = request('research-agent-session', format);
          const result = gc(req, { ...AGGRESSIVE, protectedTurns });
          expect(result.decisions.length).toBeGreaterThan(0);
          const from = protectedFrom(req, protectedTurns);
          expect(result.request.messages.slice(from)).toEqual(
            req.messages.slice(from),
          );
          const before = converterFor(format).fromInternal(req);
          const after = converterFor(format).fromInternal(result.request);
          expect(JSON.stringify(messagesOf(after).slice(from))).toBe(
            JSON.stringify(messagesOf(before).slice(from)),
          );
        },
      );

      it.each(ids)(
        'never drops or archives a side-effect tool call or its result (%s)',
        (id) => {
          const req = request(id, format);
          const names = toolNames(req);
          const result = gc(req, AGGRESSIVE);
          expect(result.decisions.length).toBeGreaterThan(0);
          for (const decision of result.decisions) {
            expect(SIDE_EFFECT_TOOLS.has(decision.toolName)).toBe(false);
          }
          // Every side-effect call and result is byte-identical after GC.
          req.messages.forEach((message, m) => {
            message.parts.forEach((part, p) => {
              const id =
                part.type === 'tool_call'
                  ? part.id
                  : part.type === 'tool_result'
                    ? part.toolCallId
                    : null;
              if (id && SIDE_EFFECT_TOOLS.has(names.get(id) ?? '')) {
                expect(result.request.messages[m].parts[p]).toBe(part);
              }
            });
          });
        },
      );

      it.each(ids)("never changes the model's responses (%s)", (id) => {
        const req = request(id, format);
        const out = gc(req, AGGRESSIVE).request;
        req.messages.forEach((message, m) => {
          if (message.role === 'assistant') {
            expect(out.messages[m]).toBe(message);
          }
        });
      });

      it.each(ids)('keeps archived content recallable (%s)', (id) => {
        const req = request(id, format);
        const result = gc(req, AGGRESSIVE);
        const archived = result.decisions.filter(
          (d) => d.decision === 'archive',
        );
        expect(archived.length).toBeGreaterThan(0);
        const byPosition = new Map(
          extractContextItems(req).map((i) => [i.position, i]),
        );
        for (const decision of archived) {
          expect(decision.archiveId).toBe(archiveIdFor(decision.contentHash));
          expect(decision.replacement).toContain(`id ${decision.archiveId}]`);
          // The original travels with the decision, unchanged, to be stored.
          expect(decision.original).toEqual(
            byPosition.get(decision.position)!.content,
          );
          expect(contentHash(decision.original)).toBe(decision.contentHash);
        }
      });

      it.each(ids)('produces deterministic output (%s)', (id) => {
        const a = gc(request(id, format), AGGRESSIVE);
        const b = gc(request(id, format), AGGRESSIVE);
        expect(json(b.request)).toBe(json(a.request));
        expect(JSON.stringify(b.decisions)).toBe(JSON.stringify(a.decisions));
      });

      it.each(ids)(
        'keeps every tool call paired with its tool result (%s)',
        (id) => {
          const req = request(id, format);
          const out = converterFor(format).fromInternal(
            gc(req, AGGRESSIVE).request,
          );
          expect(pairing(format, out)).toEqual(
            pairing(format, converterFor(format).fromInternal(req)),
          );
          expectValidPairs(format, out);
        },
      );
    });
  });

  describe('sticky rewrites and prefix stability', () => {
    const CONFIG = { minContextTokens: 0, archiveMinTokens: 500 };

    /** Runs the GC as the proxy does over a growing session, carrying decisions. */
    function replay(format: Format, cuts: number[]) {
      let prior: PriorDecision[] = [];
      return cuts.map((cut) => {
        const result = gc(
          request('research-agent-session', format, cut),
          CONFIG,
          prior,
        );
        prior = [...prior, ...result.decisions.filter((d) => !d.sticky)];
        return result;
      });
    }

    const assistantCuts = () => {
      const { messages } = loadConversation('research-agent-session');
      const cuts: number[] = [];
      messages.forEach((m, i) => {
        // Cut right before each assistant message, as an agent sends them.
        if (m.role === 'assistant' && i > 2) cuts.push(i);
      });
      return [...cuts, messages.length];
    };

    it.each(FORMATS)(
      'only adds decisions, never changes or undoes one (%s)',
      (format) => {
        const runs = replay(format, assistantCuts());
        for (let i = 1; i < runs.length; i++) {
          const current = new Map(runs[i].decisions.map((d) => [d.itemKey, d]));
          for (const before of runs[i - 1].decisions) {
            const now = current.get(before.itemKey);
            expect(now).toBeDefined();
            expect(now!.sticky).toBe(true);
            const pick = (d: GcDecision) => [
              d.decision,
              d.reason,
              d.detail,
              d.replacement,
              d.archiveId,
              d.position,
            ];
            expect(pick(now!)).toEqual(pick(before));
          }
        }
        expect(runs[runs.length - 1].decisions.length).toBeGreaterThan(0);
      },
    );

    it.each(FORMATS)(
      'sends rewritten items byte-identical on every later request (%s)',
      (format) => {
        const runs = replay(format, assistantCuts());
        for (let i = 1; i < runs.length; i++) {
          const before = messagesOf(
            converterFor(format).fromInternal(runs[i - 1].request),
          );
          const after = messagesOf(
            converterFor(format).fromInternal(runs[i].request),
          );
          const rewritten = new Set(
            runs[i - 1].decisions.map(
              (d) =>
                extractContextItems(runs[i - 1].request).find(
                  (item) => item.position === d.position,
                )!.messageIndex!,
            ),
          );
          for (const m of rewritten) {
            expect(JSON.stringify(after[m])).toBe(JSON.stringify(before[m]));
          }
        }
      },
    );

    it.each(FORMATS)(
      'keeps the processed prefix byte-identical when appended messages add no decision (%s)',
      (format) => {
        const cut = 80;
        const first = gc(
          request('research-agent-session', format, cut),
          CONFIG,
        );
        // Two more messages: too new to be touched, and no duplicates of older ones.
        const second = gc(
          request('research-agent-session', format, cut + 2),
          CONFIG,
          first.decisions,
        );
        const newOnes = second.decisions.filter((d) => !d.sticky);
        const prefix = (r: GcResult) =>
          JSON.stringify(
            messagesOf(converterFor(format).fromInternal(r.request)).slice(
              0,
              first.request.messages.length,
            ),
          );
        if (newOnes.length === 0) {
          expect(prefix(second)).toBe(prefix(first));
        } else {
          // New decisions only touch items the first run left alone.
          const old = new Set(first.decisions.map((d) => d.itemKey));
          expect(newOnes.every((d) => !old.has(d.itemKey))).toBe(true);
        }
      },
    );

    it('should reapply prior decisions below the threshold but make no new ones', () => {
      const req = request('research-agent-session');
      const first = gc(req, CONFIG);
      const priorOne = first.decisions.slice(0, 1);
      const second = gc(
        req,
        { ...CONFIG, minContextTokens: Infinity },
        priorOne,
      );
      expect(second.ran).toBe(false);
      expect(second.decisions).toHaveLength(1);
      expect(second.decisions[0]).toMatchObject({
        itemKey: priorOne[0].itemKey,
        replacement: priorOne[0].replacement,
        sticky: true,
      });
    });

    it('should reapply a prior rewrite exactly, even if the rules would now pick another', () => {
      const req = request('research-agent-session');
      const target = gc(req, CONFIG).decisions[0];
      const prior: PriorDecision = {
        itemKey: target.itemKey,
        decision: 'archive',
        reason: 'stale_large',
        detail: 'from an earlier request',
        replacement: '[parsim archived: x result, 1 tokens, id arc_0000]',
        archiveId: 'arc_0000',
      };
      const result = gc(req, CONFIG, [prior]);
      const again = result.decisions.find((d) => d.itemKey === target.itemKey)!;
      expect(again).toMatchObject({ ...prior, sticky: true });
    });

    it('should not reapply a prior rewrite to an item that is now protected', () => {
      const req = request('research-agent-session');
      const target = gc(req, CONFIG).decisions.find(
        (d) => d.toolName === 'fetch_page',
      )!;
      const result = gc(
        req,
        {
          ...CONFIG,
          sideEffectTools: ['fetch_page', ...RESEARCH_SIDE_EFFECTS],
        },
        [target],
      );
      expect(result.decisions.some((d) => d.toolName === 'fetch_page')).toBe(
        false,
      );
    });
  });

  describe('edge cases', () => {
    const anthropicRequest = (messages: unknown[]) =>
      anthropic.toInternal({ model: 'm', max_tokens: 10, messages });
    const big = 'lorem ipsum dolor sit amet '.repeat(200);
    const turnsOfChatter = (n: number) =>
      Array.from({ length: n }, (_, i) => [
        { role: 'assistant', content: [{ type: 'text', text: `step ${i}` }] },
        { role: 'user', content: [{ type: 'text', text: `ok ${i}` }] },
      ]).flat();
    const EAGER = {
      minContextTokens: 0,
      archiveMinTokens: 100,
      archiveAfterTurns: 2,
      protectedTurns: 2,
    };

    it('should run no new rules at or below the token threshold', () => {
      const req = request('support-agent-session');
      const result = gc(req, { minContextTokens: 1_000_000 });
      expect(result).toMatchObject({ ran: false, decisions: [] });
      expect(result.request).toBe(req);
      expect(result.tokensAfter).toBe(result.tokensBefore);
    });

    it('should not modify its input', () => {
      const req = request('research-agent-session');
      const snapshot = JSON.stringify(req);
      gc(req, { minContextTokens: 0, archiveMinTokens: 0, protectedTurns: 1 });
      expect(JSON.stringify(req)).toBe(snapshot);
    });

    it('should move a cache breakpoint inside the content onto the stub', () => {
      const req = anthropicRequest([
        { role: 'user', content: 'goal' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 't1', name: 'read_doc', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              cache_control: { type: 'ephemeral' },
              content: [
                {
                  type: 'text',
                  text: big,
                  cache_control: { type: 'ephemeral' },
                },
              ],
            },
          ],
        },
        ...turnsOfChatter(4),
      ]);
      const result = gc(req, EAGER);
      expect(result.decisions).toHaveLength(1);
      const out = anthropic.fromInternal(result.request) as {
        messages: { content: Record<string, unknown>[] }[];
      };
      const block = out.messages[2].content[0];
      expect(block.cache_control).toEqual({ type: 'ephemeral' });
      expect(block.content).toEqual([
        {
          type: 'text',
          text: result.decisions[0].replacement,
          cache_control: { type: 'ephemeral' },
        },
      ]);
    });

    it('should keep a tool result whose call is missing', () => {
      const req = anthropicRequest([
        { role: 'user', content: 'goal' },
        { role: 'assistant', content: [{ type: 'text', text: 'thinking' }] },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'gone', content: big }],
        },
        ...turnsOfChatter(4),
      ]);
      expect(gc(req, EAGER).decisions).toEqual([]);
    });

    it('should not treat a call as superseded when the later call failed', () => {
      const call = (id: string) => ({
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: 'read_doc', input: { a: 1 } }],
      });
      const result = (id: string, content: string, isError = false) => ({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: id, content, is_error: isError },
        ],
      });
      const req = anthropicRequest([
        { role: 'user', content: 'goal' },
        call('t1'),
        result('t1', big),
        call('t2'),
        result('t2', 'timeout', true),
        ...turnsOfChatter(4),
      ]);
      const out = gc(req, { ...EAGER, archiveMinTokens: Infinity });
      expect(out.decisions).toEqual([]);
    });

    it('should treat repeated calls as the same when only the key order differs', () => {
      const req = openAi.toInternal({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'goal' },
          ...[
            ['c1', '{"a":1,"b":2}', big],
            ['c2', '{"b":2,"a":1}', big + ' v2'],
          ].flatMap(([id, args, content]) => [
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id,
                  type: 'function',
                  function: { name: 'read', arguments: args },
                },
              ],
            },
            { role: 'tool', tool_call_id: id, content },
          ]),
          ...turnsOfChatter(4).map((m) => ({
            role: m.role,
            content: (m.content[0] as { text: string }).text,
          })),
        ],
      });
      const out = gc(req, { ...EAGER, archiveMinTokens: Infinity });
      expect(out.decisions.map((d) => [d.toolCallId, d.reason])).toEqual([
        ['c1', 'superseded'],
      ]);
    });

    it('should skip a rewrite whose stub would cost more tokens than the original', () => {
      const req = openAi.toInternal({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'goal' },
          ...['c1', 'c2'].flatMap((id) => [
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id,
                  type: 'function',
                  function: { name: 'ping', arguments: '{}' },
                },
              ],
            },
            { role: 'tool', tool_call_id: id, content: 'ok' },
          ]),
          ...Array.from({ length: 4 }, () => ({
            role: 'assistant',
            content: 'x',
          })),
        ],
      });
      expect(gc(req, EAGER).decisions).toEqual([]);
    });

    it('should use tool call ids as item keys and keep results without an id', () => {
      const req = openAi.toInternal({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'goal' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'read', arguments: 'not json' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'c1', content: big },
          ...Array.from({ length: 4 }, () => ({
            role: 'assistant',
            content: 'x',
          })),
        ],
      });
      const [decision] = gc(req, EAGER).decisions;
      expect(decision.itemKey).toBe(`call:c1:${decision.contentHash}`);

      const noId = openAi.toInternal({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'goal' },
          { role: 'tool', tool_call_id: '', content: big },
        ],
      });
      expect(gc(noId, EAGER).decisions).toEqual([]);
    });
  });
});

type Pairing = { calls: string[]; results: string[] };

/** Function call and response names of a Gemini content, in order. */
function geminiNames(content: Record<string, unknown>, key: string): string[] {
  return ((content.parts as Record<string, unknown>[] | undefined) ?? [])
    .map((p) => (p[key] as { name?: string } | undefined)?.name)
    .filter((name): name is string => name !== undefined);
}

function pairing(format: Format, body: Record<string, unknown>): Pairing {
  const messages = messagesOf(body);
  const calls: string[] = [];
  const results: string[] = [];
  for (const m of messages) {
    if (format === 'gemini') {
      calls.push(...geminiNames(m, 'functionCall'));
      results.push(...geminiNames(m, 'functionResponse'));
    } else if (format === 'openai') {
      for (const c of (m.tool_calls as { id: string }[] | undefined) ?? []) {
        calls.push(c.id);
      }
      if (m.role === 'tool') results.push(m.tool_call_id as string);
    } else if (Array.isArray(m.content)) {
      for (const b of m.content as Record<string, unknown>[]) {
        if (b.type === 'tool_use') calls.push(b.id as string);
        if (b.type === 'tool_result') results.push(b.tool_use_id as string);
      }
    }
  }
  return { calls, results };
}

/** Each call is answered exactly once, in the next message(s), in order. */
function expectValidPairs(format: Format, body: Record<string, unknown>) {
  const messages = messagesOf(body);
  messages.forEach((m, i) => {
    if (format === 'gemini') {
      const calls = geminiNames(m, 'functionCall');
      if (!calls.length) return;
      const next = messages[i + 1];
      expect(next.role).toBe('user');
      expect(geminiNames(next, 'functionResponse')).toEqual(calls);
      // Every response is still a JSON object, as Gemini requires.
      for (const part of next.parts as Record<string, unknown>[]) {
        const response = part.functionResponse as
          | { response: unknown }
          | undefined;
        if (response) expect(typeof response.response).toBe('object');
      }
    } else if (format === 'openai') {
      const calls = (m.tool_calls as { id: string }[] | undefined) ?? [];
      const answers = messages
        .slice(i + 1, i + 1 + calls.length)
        .map((r) => (r.role === 'tool' ? r.tool_call_id : undefined));
      expect(answers).toEqual(calls.map((c) => c.id));
      if (m.role === 'tool') expect(typeof m.content).toBe('string');
    } else if (m.role === 'assistant' && Array.isArray(m.content)) {
      const uses = (m.content as Record<string, unknown>[])
        .filter((b) => b.type === 'tool_use')
        .map((b) => b.id);
      if (!uses.length) return;
      const next = messages[i + 1];
      const answered = (next.content as Record<string, unknown>[])
        .filter((b) => b.type === 'tool_result')
        .map((b) => b.tool_use_id);
      expect(next.role).toBe('user');
      expect(answered).toEqual(uses);
    }
  });
}
