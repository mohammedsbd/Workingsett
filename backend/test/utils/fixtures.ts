import fs from 'node:fs';
import path from 'node:path';

/** OpenAI chat format, as stored in test/fixtures/conversations. */
export type FixtureToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type FixtureMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: FixtureToolCall[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export type FixtureTool = {
  type: 'function';
  function: { name: string; description: string; parameters: object };
};

export type FixtureConversation = {
  id: string;
  description: string;
  model: string;
  tools?: FixtureTool[];
  messages: FixtureMessage[];
};

export const CONVERSATIONS_DIR = path.join(
  __dirname,
  '..',
  'fixtures',
  'conversations',
);

export const CONVERSATION_IDS = [
  'short-chat',
  'research-agent-session',
  'support-agent-session',
] as const;

export type ConversationId = (typeof CONVERSATION_IDS)[number];

/** Loads a fixture conversation. Returns a fresh copy on every call. */
export function loadConversation(id: ConversationId): FixtureConversation {
  const file = path.join(CONVERSATIONS_DIR, `${id}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as FixtureConversation;
}
