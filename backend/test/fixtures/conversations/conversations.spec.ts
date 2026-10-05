import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import {
  CONVERSATION_IDS,
  CONVERSATIONS_DIR,
  FixtureMessage,
  loadConversation,
} from '../../utils/fixtures';

const toolResults = (messages: FixtureMessage[]) =>
  messages.filter(
    (m): m is Extract<FixtureMessage, { role: 'tool' }> => m.role === 'tool',
  );

const toolCalls = (messages: FixtureMessage[]) =>
  messages.flatMap((m) => (m.role === 'assistant' ? (m.tool_calls ?? []) : []));

describe('Fixture conversations', () => {
  it('should list every JSON file in the fixtures folder', () => {
    const files = fs
      .readdirSync(CONVERSATIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();

    expect(files).toEqual([...CONVERSATION_IDS].sort());
  });

  describe.each(CONVERSATION_IDS)('%s', (id) => {
    const conversation = loadConversation(id);
    const { messages } = conversation;

    it('should match its file name and have a description', () => {
      expect(conversation.id).toBe(id);
      expect(conversation.description.length).toBeGreaterThan(20);
    });

    it('should start with a system prompt followed by the user goal', () => {
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
    });

    it('should use only OpenAI chat roles with string content', () => {
      for (const message of messages) {
        expect(['system', 'user', 'assistant', 'tool']).toContain(message.role);
        if (message.role === 'assistant') {
          expect(
            typeof message.content === 'string' || message.tool_calls?.length,
          ).toBeTruthy();
        } else {
          expect(typeof message.content).toBe('string');
        }
      }
    });

    it('should answer every tool call exactly once, right after the call', () => {
      const calls = toolCalls(messages);
      const ids = calls.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);

      messages.forEach((message, index) => {
        if (message.role !== 'assistant' || !message.tool_calls) return;
        const answers = messages
          .slice(index + 1, index + 1 + message.tool_calls.length)
          .map((m) => (m.role === 'tool' ? m.tool_call_id : undefined));
        expect(answers).toEqual(message.tool_calls.map((c) => c.id));
      });
      expect(toolResults(messages)).toHaveLength(calls.length);
    });

    it('should only call declared tools, with JSON arguments', () => {
      const declared = new Set(
        (conversation.tools ?? []).map((t) => t.function.name),
      );
      for (const call of toolCalls(messages)) {
        expect(declared.has(call.function.name)).toBe(true);
        expect(
          () => JSON.parse(call.function.arguments) as unknown,
        ).not.toThrow();
      }
    });

    it('should contain no real-looking email addresses', () => {
      const emails =
        JSON.stringify(conversation).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ??
        [];
      for (const email of emails) {
        expect(email).toMatch(/@example\.com$/);
      }
    });
  });

  it('should keep the short chat small and tool-free', () => {
    const { messages, tools } = loadConversation('short-chat');
    expect(messages.length).toBeLessThan(10);
    expect(tools).toBeUndefined();
  });

  it('should give the research session 100+ messages with large and repeated tool results', () => {
    const { messages } = loadConversation('research-agent-session');
    const results = toolResults(messages).map((m) => m.content);

    expect(messages.length).toBeGreaterThanOrEqual(100);
    expect(
      results.filter((c) => c.length > 2000).length,
    ).toBeGreaterThanOrEqual(20);
    expect(new Set(results).size).toBeLessThan(results.length);
    const sideEffects = toolCalls(messages).filter((c) =>
      ['save_note', 'send_report'].includes(c.function.name),
    );
    expect(sideEffects.length).toBeGreaterThan(0);
  });

  it('should give the support session several tickets with side-effect calls', () => {
    const { messages } = loadConversation('support-agent-session');
    const tickets = new Set(
      messages
        .filter((m) => m.role === 'user')
        .map((m) => /ticket (T-\d+)/.exec(m.content ?? '')?.[1])
        .filter(Boolean),
    );
    const names = toolCalls(messages).map((c) => c.function.name);

    expect(tickets.size).toBeGreaterThanOrEqual(3);
    expect(names).toContain('issue_refund');
    expect(names.filter((n) => n === 'send_reply')).toHaveLength(tickets.size);
  });
});
