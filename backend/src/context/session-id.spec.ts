import { extractContextItems } from './context-items';
import { OpenAiChatConverter } from './normalization/openai-chat.converter';
import {
  modelFamily,
  resolveSessionId,
  validSessionHeader,
} from './session-id';

const converter = new OpenAiChatConverter();
const items = (messages: unknown[]) =>
  extractContextItems(converter.toInternal({ messages }));

const base = [
  { role: 'system', content: 'You are a research agent.' },
  { role: 'user', content: 'Research grid storage.' },
];

const derive = (
  messages: unknown[],
  opts: { upstream?: string; model?: string; header?: unknown } = {},
) =>
  resolveSessionId({
    header: opts.header,
    upstream: opts.upstream ?? 'openai',
    model: opts.model ?? 'gpt-4o',
    items: items(messages),
  });

describe('agent session id', () => {
  it('should use the x-parsim-session-id header when present', () => {
    expect(derive(base, { header: '  run-42  ' })).toEqual({
      externalId: 'run-42',
      source: 'header',
    });
  });

  it('should ignore unusable header values', () => {
    expect(validSessionHeader('')).toBeNull();
    expect(validSessionHeader('x'.repeat(201))).toBeNull();
    expect(validSessionHeader('bad\nvalue')).toBeNull();
    expect(validSessionHeader(['first', 'second'])).toBe('first');
    expect(derive(base, { header: '' }).source).toBe('derived');
  });

  it('should stay the same while the conversation grows', () => {
    const later = [
      ...base,
      { role: 'assistant', content: 'Searching.' },
      { role: 'user', content: 'Continue.' },
    ];

    expect(derive(later)).toEqual(derive(base));
    expect(derive(base).externalId).toMatch(/^derived:[0-9a-f]{32}$/);
  });

  it('should change with the system prompt, the first user message, the upstream or the model family', () => {
    const id = derive(base).externalId;

    expect(
      derive([{ role: 'system', content: 'Other' }, base[1]]).externalId,
    ).not.toBe(id);
    expect(
      derive([base[0], { role: 'user', content: 'Other task' }]).externalId,
    ).not.toBe(id);
    expect(derive(base, { upstream: 'gemini' }).externalId).not.toBe(id);
    expect(derive(base, { model: 'gpt-4o-mini' }).externalId).not.toBe(id);
  });

  it('should keep the id across dated snapshots of the same model', () => {
    expect(derive(base, { model: 'gpt-4o-2024-08-06' })).toEqual(derive(base));
  });

  it('should strip prefixes and snapshot dates to get the model family', () => {
    expect(modelFamily('gpt-4o-2024-08-06')).toBe('gpt-4o');
    expect(modelFamily('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(modelFamily('models/gemini-3.8-flash')).toBe('gemini-3.8-flash');
    expect(modelFamily('gpt-5-mini')).toBe('gpt-5-mini');
  });
});
