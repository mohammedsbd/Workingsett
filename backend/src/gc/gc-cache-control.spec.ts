import { describe, expect, it } from '@jest/globals';
import { AnthropicMessagesConverter } from '../context/normalization/anthropic-messages.converter';
import { DEFAULT_GC_CONFIG, GcConfig } from './gc-config';
import { runGc } from './gc-engine';
import { PriorDecision } from './gc-types';

const anthropic = new AnthropicMessagesConverter();
const tokens = (text: string) => Math.ceil(text.length / 4);
const EPHEMERAL = { type: 'ephemeral' };
const big = (label: string) => `${label} `.repeat(800);

const CONFIG: GcConfig = {
  ...DEFAULT_GC_CONFIG,
  minContextTokens: 0,
  batchTokens: 0,
  archiveMinTokens: 100,
  archiveAfterTurns: 2,
  protectedTurns: 2,
};

/**
 * A Claude Code style request: a cached system prompt, old tool results
 * (one with its own breakpoint, one with a breakpoint inside), and the
 * newest user message carrying the moving breakpoint.
 */
function body(extraTurns: number): Record<string, unknown> {
  const turn = (i: number) => [
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: `t${i}`, name: 'read_file', input: { i } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: `t${i}`, content: `ok ${i}` },
      ],
    },
  ];
  const turns = Array.from({ length: extraTurns }, (_, i) =>
    turn(i + 10),
  ).flat();
  const last = turns.length ? turns[turns.length - 1] : null;
  if (last) {
    // The client marks its newest message, as Claude Code does.
    (last.content[0] as Record<string, unknown>).cache_control = EPHEMERAL;
  }
  return {
    model: 'claude-haiku-4-5',
    max_tokens: 100,
    system: [
      {
        type: 'text',
        text: 'You are a coding agent.',
        cache_control: EPHEMERAL,
      },
    ],
    messages: [
      { role: 'user', content: 'Refactor the parser.' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'read_file', input: { f: 'a' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            cache_control: EPHEMERAL,
            content: big('alpha'),
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't2', name: 'read_file', input: { f: 'b' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't2',
            content: [
              { type: 'text', text: big('beta'), cache_control: EPHEMERAL },
            ],
          },
        ],
      },
      ...turns,
    ],
  };
}

const markers = (value: unknown) =>
  (JSON.stringify(value).match(/"cache_control"/g) ?? []).length;

function gc(extraTurns: number, prior: PriorDecision[] = []) {
  const request = anthropic.toInternal(body(extraTurns));
  const result = runGc({ request, config: CONFIG, countTokens: tokens, prior });
  return { result, sent: anthropic.fromInternal(result.request) };
}

describe('GC and Anthropic cache_control markers', () => {
  it('should never add, remove or move a marker to another message', () => {
    const { result, sent } = gc(4);
    expect(result.decisions.map((d) => d.decision)).toEqual([
      'archive',
      'archive',
    ]);
    expect(markers(sent)).toBe(markers(body(4)));
    const messages = sent.messages as { content: unknown }[];
    const original = body(4).messages as { content: unknown }[];
    messages.forEach((message, i) => {
      expect(markers(message)).toBe(markers(original[i]));
    });
  });

  it('should leave the system prompt and the newest message, with their markers, untouched', () => {
    const { sent } = gc(4);
    const original = body(4);
    expect(sent.system).toEqual(original.system);
    const last = (m: Record<string, unknown>) =>
      (m.messages as unknown[])[(m.messages as unknown[]).length - 1];
    expect(last(sent)).toEqual(last(original));
  });

  it('should keep a marker on an archived tool_result block, and put an inner marker on the stub', () => {
    const { result, sent } = gc(4);
    const [first, second] = (
      sent.messages as { content: Record<string, unknown>[] }[]
    )
      .slice(2, 5)
      .filter((_, i) => i !== 1)
      .map((m) => m.content[0]);
    expect(first.cache_control).toEqual(EPHEMERAL);
    expect(first.content).toBe(result.decisions[0].replacement);
    expect(second.cache_control).toBeUndefined();
    expect(second.content).toEqual([
      {
        type: 'text',
        text: result.decisions[1].replacement,
        cache_control: EPHEMERAL,
      },
    ]);
  });

  it('should send marked content byte-identically on every later call', () => {
    const first = gc(4);
    const later = gc(9, first.result.decisions);
    const prefix = (sent: Record<string, unknown>) =>
      JSON.stringify((sent.messages as unknown[]).slice(0, 5));
    expect(prefix(later.sent)).toBe(prefix(first.sent));
    expect(later.result.decisions.slice(0, 2).every((d) => d.sticky)).toBe(
      true,
    );
  });

  it('should not touch content while it is still in the protected turns', () => {
    const { result, sent } = gc(0);
    expect(result.decisions).toEqual([]);
    expect(sent).toEqual(body(0));
  });
});
