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

/** An Anthropic Messages request body for a fixture conversation. */
export function toAnthropicBody(
  conversation: FixtureConversation,
): Record<string, unknown> {
  const [system, ...rest] = conversation.messages;
  const messages: { role: 'user' | 'assistant'; content: unknown[] }[] = [];
  for (const message of rest) {
    if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: [
          ...(message.content ? [{ type: 'text', text: message.content }] : []),
          ...(message.tool_calls ?? []).map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.function.name,
            input: JSON.parse(call.function.arguments) as unknown,
          })),
        ],
      });
      continue;
    }
    const block =
      message.role === 'tool'
        ? {
            type: 'tool_result',
            tool_use_id: message.tool_call_id,
            content: message.content,
          }
        : { type: 'text', text: message.content };
    const last = messages[messages.length - 1];
    // Tool results of one assistant turn go back in a single user message.
    if (message.role === 'tool' && last?.role === 'user') {
      last.content.push(block);
    } else {
      messages.push({ role: 'user', content: [block] });
    }
  }
  return {
    model: conversation.model,
    max_tokens: 1024,
    system: system.content,
    tools: (conversation.tools ?? []).map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    })),
    messages,
  };
}

/** An OpenAI chat completions request body for a fixture conversation. */
export function toOpenAiBody(
  conversation: FixtureConversation,
): Record<string, unknown> {
  return {
    model: conversation.model,
    ...(conversation.tools ? { tools: conversation.tools } : {}),
    messages: conversation.messages,
  };
}

/**
 * A Gemini native request body for a fixture conversation. Function calls
 * carry no ids, as most Gemini clients send them: responses are paired
 * with calls by name and order.
 */
export function toGeminiBody(
  conversation: FixtureConversation,
): Record<string, unknown> {
  const [system, ...rest] = conversation.messages;
  const names = new Map<string, string>();
  const contents: { role: 'user' | 'model'; parts: unknown[] }[] = [];
  for (const message of rest) {
    if (message.role === 'assistant') {
      contents.push({
        role: 'model',
        parts: [
          ...(message.content ? [{ text: message.content }] : []),
          ...(message.tool_calls ?? []).map((call) => {
            names.set(call.id, call.function.name);
            return {
              functionCall: {
                name: call.function.name,
                args: JSON.parse(call.function.arguments) as unknown,
              },
            };
          }),
        ],
      });
      continue;
    }
    const part =
      message.role === 'tool'
        ? {
            functionResponse: {
              name: names.get(message.tool_call_id) ?? '',
              response: { output: message.content },
            },
          }
        : { text: message.content };
    const last = contents[contents.length - 1];
    // Function responses of one model turn go back in a single user turn.
    if (message.role === 'tool' && last?.role === 'user') {
      last.parts.push(part);
    } else {
      contents.push({ role: 'user', parts: [part] });
    }
  }
  return {
    systemInstruction: { parts: [{ text: system.content }] },
    contents,
    ...(conversation.tools && {
      tools: [
        {
          functionDeclarations: conversation.tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
          })),
        },
      ],
    }),
  };
}
