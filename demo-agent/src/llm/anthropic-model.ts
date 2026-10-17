import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type { ProviderConfig } from '../config.js';
import { rateLimitInfo, RateLimitedError } from './rate-limit.js';
import type {
  ChatMessage,
  ChatModel,
  CompletionRequest,
  ModelTurn,
} from './types.js';

/** Anthropic through the official @anthropic-ai/sdk (Messages API). */
export function toAnthropic(messages: ChatMessage[]): {
  system: string | undefined;
  messages: MessageParam[];
} {
  let system: string | undefined;
  const out: MessageParam[] = [];
  const pushUser = (blocks: ContentBlockParam[]) => {
    const last = out[out.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) {
      last.content = [...last.content, ...blocks];
    } else {
      out.push({ role: 'user', content: blocks });
    }
  };
  for (const message of messages) {
    if (message.role === 'system') {
      system = system ? `${system}\n\n${message.content}` : message.content;
    } else if (message.role === 'user') {
      pushUser([{ type: 'text', text: message.content }]);
    } else if (message.role === 'tool') {
      const block: ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      pushUser([block]);
    } else if (message.raw?.provider === 'anthropic') {
      out.push({
        role: 'assistant',
        content: message.raw.content as ContentBlockParam[],
      });
    } else {
      out.push({
        role: 'assistant',
        content: [
          ...(message.content
            ? [{ type: 'text' as const, text: message.content }]
            : []),
          ...message.toolCalls.map((call) => ({
            type: 'tool_use' as const,
            id: call.id,
            name: call.name,
            input: call.arguments,
          })),
        ],
      });
    }
  }
  return { system, messages: out };
}

export class AnthropicChatModel implements ChatModel {
  readonly provider = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      defaultHeaders: config.headers,
      maxRetries: 0,
      timeout: 180_000,
    });
  }

  async complete(request: CompletionRequest): Promise<ModelTurn> {
    const { system, messages } = toAnthropic(request.messages);
    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.config.maxOutputTokens,
          messages,
          ...(system && { system }),
          ...(request.tools.length && {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters as Anthropic.Tool['input_schema'],
            })),
          }),
          ...(this.config.temperature !== null && {
            temperature: this.config.temperature,
          }),
        },
        { headers: { 'x-parsim-session-id': request.sessionId } },
      );
      let text = '';
      const toolCalls: ModelTurn['toolCalls'] = [];
      for (const block of response.content) {
        if (block.type === 'text') text += block.text;
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }
      const usage = response.usage;
      return {
        text,
        toolCalls,
        usage: {
          inputTokens:
            usage.input_tokens +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens,
          cachedInputTokens: usage.cache_read_input_tokens ?? 0,
        },
        raw: { provider: 'anthropic', content: response.content },
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError && error.status === 429) {
        throw new RateLimitedError(rateLimitInfo(error.headers, error.message));
      }
      throw error;
    }
  }
}
