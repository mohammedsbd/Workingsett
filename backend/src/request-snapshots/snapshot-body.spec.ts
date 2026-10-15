import {
  loadConversation,
  toAnthropicBody,
  toGeminiBody,
  toOpenAiBody,
} from '../../test/utils/fixtures';
import { ProxyApi } from '../proxy/providers/provider-adapter';
import { joinBody, partHash, splitBody } from './snapshot-body';

describe('snapshot bodies', () => {
  const conversation = loadConversation('support-agent-session');
  const cases: [ProxyApi, Record<string, unknown>][] = [
    ['openai-chat', { ...toOpenAiBody(conversation), temperature: 0.3 }],
    ['anthropic-messages', toAnthropicBody(conversation)],
    ['gemini-native', toGeminiBody(conversation)],
  ];

  it.each(cases)('should rebuild a %s body byte for byte', (api, body) => {
    const split = splitBody(api, body);
    const rebuilt = joinBody(api, split.envelope, split.messages);
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(body));
  });

  it('should keep the message list in its place in the envelope', () => {
    const body = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [],
    };
    const split = splitBody('openai-chat', body);
    expect(split.envelope).toBe('{"model":"gpt-4o","messages":[],"tools":[]}');
    expect(split.messages).toEqual(['{"role":"user","content":"Hi"}']);
  });

  it('should give the shared prefix of two requests the same hashes', () => {
    const first = toOpenAiBody(conversation);
    const messages = first.messages as unknown[];
    const second = {
      ...first,
      messages: [...messages, { role: 'user', content: 'More' }],
    };
    const a = splitBody('openai-chat', first);
    const b = splitBody('openai-chat', second);
    expect(partHash(a.envelope)).toBe(partHash(b.envelope));
    expect(b.messages.slice(0, a.messages.length).map(partHash)).toEqual(
      a.messages.map(partHash),
    );
  });

  it('should keep a body without a message list whole', () => {
    const body = { model: 'gpt-4o', prompt: 'Hi' };
    const split = splitBody('openai-chat', body);
    expect(split.messages).toEqual([]);
    expect(joinBody('openai-chat', split.envelope, [])).toEqual(body);
  });
});
