import {
  ApiError,
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type Part,
} from '@google/genai';
import type { ProviderConfig } from '../config.js';
import { rateLimitInfo, RateLimitedError } from './rate-limit.js';
import type {
  ChatMessage,
  ChatModel,
  CompletionRequest,
  ModelTurn,
  ToolCall,
} from './types.js';

/**
 * Gemini through the official @google/genai SDK (native generateContent).
 * Model turns are sent back with their original parts, so function calls
 * keep the thought signatures Gemini 3 requires.
 */
export function toGeminiContents(messages: ChatMessage[]): {
  system: string | undefined;
  contents: Content[];
} {
  let system: string | undefined;
  const contents: Content[] = [];
  const push = (role: 'user' | 'model', parts: Part[]) => {
    const last = contents[contents.length - 1];
    // Gemini wants alternating turns: merge consecutive user-side parts.
    if (last && last.role === role && role === 'user') {
      last.parts = [...(last.parts ?? []), ...parts];
    } else {
      contents.push({ role, parts });
    }
  };
  for (const message of messages) {
    if (message.role === 'system') {
      system = system ? `${system}\n\n${message.content}` : message.content;
    } else if (message.role === 'user') {
      push('user', [{ text: message.content }]);
    } else if (message.role === 'tool') {
      push('user', [
        {
          functionResponse: {
            id: message.toolCallId,
            name: message.name,
            response: { output: message.content },
          },
        },
      ]);
    } else if (message.raw?.provider === 'gemini') {
      push('model', message.raw.content as Part[]);
    } else {
      push('model', [
        ...(message.content ? [{ text: message.content }] : []),
        ...message.toolCalls.map(
          (call): Part => ({
            functionCall: {
              id: call.id,
              name: call.name,
              args: call.arguments,
            },
          }),
        ),
      ]);
    }
  }
  return { system, contents };
}

export function fromGeminiResponse(
  response: GenerateContentResponse,
  callIdPrefix: string,
): ModelTurn {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const toolCalls: ToolCall[] = [];
  let text = '';
  parts.forEach((part, i) => {
    if (part.functionCall?.name) {
      toolCalls.push({
        id: part.functionCall.id ?? `${callIdPrefix}_${i}`,
        name: part.functionCall.name,
        arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
      });
    } else if (part.text && !part.thought) {
      text += part.text;
    }
  });
  // Keep the ids we gave id-less calls, so tool results match them.
  const raw = parts.map((part, i) =>
    part.functionCall && !part.functionCall.id
      ? {
          ...part,
          functionCall: { ...part.functionCall, id: `${callIdPrefix}_${i}` },
        }
      : part,
  );
  const usage = response.usageMetadata;
  return {
    text,
    toolCalls,
    usage: usage
      ? {
          inputTokens:
            (usage.promptTokenCount ?? 0) +
            (usage.toolUsePromptTokenCount ?? 0),
          outputTokens:
            (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
          cachedInputTokens: usage.cachedContentTokenCount ?? 0,
        }
      : null,
    raw: { provider: 'gemini', content: raw },
  };
}

export class GeminiChatModel implements ChatModel {
  readonly provider = 'gemini' as const;
  readonly model: string;
  private readonly client: GoogleGenAI;
  private calls = 0;

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model;
    this.client = new GoogleGenAI({
      apiKey: config.apiKey,
      httpOptions: {
        ...(config.baseUrl && { baseUrl: config.baseUrl }),
        headers: config.headers,
        timeout: 180_000,
      },
    });
  }

  async complete(request: CompletionRequest): Promise<ModelTurn> {
    const { system, contents } = toGeminiContents(request.messages);
    this.calls += 1;
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config: {
          ...(system && { systemInstruction: system }),
          ...(request.tools.length && {
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parametersJsonSchema: tool.parameters,
                })),
              },
            ],
          }),
          maxOutputTokens: this.config.maxOutputTokens,
          ...(this.config.temperature !== null && {
            temperature: this.config.temperature,
          }),
          httpOptions: {
            headers: {
              ...this.config.headers,
              'x-parsim-session-id': request.sessionId,
            },
          },
        },
      });
      return fromGeminiResponse(response, `call_${this.calls}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        throw new RateLimitedError(rateLimitInfo(undefined, error.message));
      }
      throw error;
    }
  }
}
