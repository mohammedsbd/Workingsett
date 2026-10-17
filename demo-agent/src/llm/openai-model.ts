import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { ProviderConfig } from '../config.js';
import { rateLimitInfo, RateLimitedError } from './rate-limit.js';
import type {
  ChatMessage,
  ChatModel,
  CompletionRequest,
  ModelTurn,
  ProviderName,
} from './types.js';

/** A request above the per-minute token limit (Groq answers 413). Never retried. */
export class RequestTooLargeError extends Error {
  constructor() {
    super(
      'The provider refused the request as too large for its per-minute token limit (413). Use a smaller context, or a provider with higher limits.',
    );
    this.name = 'RequestTooLargeError';
  }
}

/** Retries of a turn whose tool call the provider rejected as malformed. */
export const TOOL_CALL_RETRIES = 2;
/**
 * Temperature for those retries: at temperature 0 a model tends to repeat
 * the same malformed call, so a retry samples a little.
 */
export const TOOL_CALL_RETRY_TEMPERATURE = 0.3;

/**
 * Groq validates tool calls against their schema and answers 400
 * (tool_use_failed) when the model produced a malformed one. That is the
 * model's own mistake, not a bad request: asking again usually fixes it.
 */
export function isToolCallValidationError(error: unknown): boolean {
  return (
    error instanceof OpenAI.APIError &&
    error.status === 400 &&
    (error.code === 'tool_use_failed' ||
      /tool call validation failed/i.test(error.message))
  );
}

function toOpenAi(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message): ChatCompletionMessageParam => {
    switch (message.role) {
      case 'system':
      case 'user':
        return { role: message.role, content: message.content };
      case 'tool':
        return {
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      case 'assistant':
        return {
          role: 'assistant',
          content: message.content || null,
          ...(message.toolCalls.length && {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            })),
          }),
        };
    }
  });
}

function parseArguments(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text || '{}');
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** OpenAI, and OpenAI-compatible providers such as Groq, through the openai SDK. */
export class OpenAiChatModel implements ChatModel {
  readonly provider: ProviderName;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(private readonly config: ProviderConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      defaultHeaders: config.headers,
      maxRetries: 0,
      timeout: 180_000,
    });
  }

  async complete(request: CompletionRequest): Promise<ModelTurn> {
    const tools: ChatCompletionTool[] = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    try {
      const create = (temperature: number | null) =>
        this.client.chat.completions.create(
          {
            model: this.model,
            messages: toOpenAi(request.messages),
            ...(tools.length && { tools }),
            max_completion_tokens: this.config.maxOutputTokens,
            ...(temperature !== null && { temperature }),
          },
          { headers: { 'x-parsim-session-id': request.sessionId } },
        );
      let completion;
      for (let attempt = 0; ; attempt++) {
        try {
          completion = await create(
            attempt === 0
              ? this.config.temperature
              : TOOL_CALL_RETRY_TEMPERATURE,
          );
          break;
        } catch (error) {
          if (
            !isToolCallValidationError(error) ||
            attempt >= TOOL_CALL_RETRIES
          ) {
            throw error;
          }
        }
      }
      const message = completion.choices[0]?.message;
      return {
        text: message?.content ?? '',
        toolCalls: (message?.tool_calls ?? [])
          .filter((call) => call.type === 'function')
          .map((call) => ({
            id: call.id,
            name: call.function.name,
            arguments: parseArguments(call.function.arguments),
          })),
        usage: completion.usage
          ? {
              inputTokens: completion.usage.prompt_tokens,
              outputTokens: completion.usage.completion_tokens,
              cachedInputTokens:
                completion.usage.prompt_tokens_details?.cached_tokens ?? 0,
            }
          : null,
      };
    } catch (error) {
      if (error instanceof OpenAI.APIError && error.status === 429) {
        throw new RateLimitedError(rateLimitInfo(error.headers, error.message));
      }
      if (error instanceof OpenAI.APIError && error.status === 413) {
        throw new RequestTooLargeError();
      }
      throw error;
    }
  }
}
