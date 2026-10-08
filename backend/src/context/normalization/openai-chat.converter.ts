import { imageRefFromUrl } from './image-ref';
import {
  asString,
  ContentForm,
  InternalMessage,
  InternalPart,
  InternalRequest,
  InternalRole,
  isObject,
  MessageConverter,
  ToolCallPart,
  ToolResultPart,
} from './internal-model';

const ROLES: Record<string, InternalRole> = {
  system: 'system',
  developer: 'system',
  user: 'user',
  assistant: 'assistant',
  tool: 'tool',
};

function contentForm(content: unknown, hasKey: boolean): ContentForm {
  if (!hasKey) return 'absent';
  if (content === null) return 'null';
  return typeof content === 'string' ? 'string' : 'array';
}

function contentParts(content: unknown): InternalPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content, raw: content }];
  }
  if (!Array.isArray(content)) return [];
  return content.map((part: unknown): InternalPart => {
    if (isObject(part) && part.type === 'text') {
      return { type: 'text', text: asString(part.text), raw: part };
    }
    if (isObject(part) && part.type === 'image_url') {
      const imageUrl = part.image_url;
      const url = isObject(imageUrl)
        ? asString(imageUrl.url)
        : asString(imageUrl);
      return { type: 'image', image: imageRefFromUrl(url), raw: part };
    }
    return { type: 'other', raw: part };
  });
}

function rebuildContentPart(part: InternalPart): unknown {
  if (part.type === 'text') {
    return isObject(part.raw)
      ? { ...part.raw, text: part.text }
      : { type: 'text', text: part.text };
  }
  return part.raw;
}

function rebuildContent(parts: InternalPart[], form: ContentForm): unknown {
  if (form === 'string' && parts.length === 1 && parts[0].type === 'text') {
    return parts[0].text;
  }
  if ((form === 'null' || form === 'absent') && parts.length === 0) {
    return form === 'null' ? null : undefined;
  }
  return parts.map(rebuildContentPart);
}

function rebuildToolCall(part: ToolCallPart): unknown {
  const raw = isObject(part.raw) ? part.raw : { type: 'function' };
  const fn = isObject(raw.function) ? raw.function : {};
  return {
    ...raw,
    id: part.id,
    function: { ...fn, name: part.name, arguments: part.input },
  };
}

/**
 * OpenAI chat completions format (also used for Gemini's OpenAI-compatible
 * endpoint). System and developer messages are messages with role system;
 * assistant tool_calls become tool_call parts; a tool message becomes one
 * tool_result part.
 */
export class OpenAiChatConverter implements MessageConverter {
  readonly api = 'openai-chat' as const;

  toInternal(body: Record<string, unknown>): InternalRequest {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    return {
      api: this.api,
      model: asString(body.model),
      system: null,
      messages: messages.filter(isObject).map((m) => this.message(m)),
      raw: body,
    };
  }

  fromInternal(request: InternalRequest): Record<string, unknown> {
    const body: Record<string, unknown> = { ...request.raw };
    if ('messages' in request.raw || request.messages.length) {
      body.messages = request.messages.map((m) => this.rebuildMessage(m));
    }
    return body;
  }

  private message(raw: Record<string, unknown>): InternalMessage {
    const role = ROLES[asString(raw.role)] ?? 'user';
    const form = contentForm(raw.content, 'content' in raw);
    const content = contentParts(raw.content);

    if (role === 'tool') {
      const result: ToolResultPart = {
        type: 'tool_result',
        toolCallId: asString(raw.tool_call_id),
        content,
        contentForm: form,
        isError: false,
        raw,
      };
      return { role, parts: [result], contentForm: form, raw };
    }

    const toolCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
    const calls = toolCalls.map((call: unknown): ToolCallPart => {
      const c = isObject(call) ? call : {};
      const fn = isObject(c.function) ? c.function : {};
      return {
        type: 'tool_call',
        id: asString(c.id),
        name: asString(fn.name),
        input: fn.arguments,
        raw: call,
      };
    });
    return { role, parts: [...content, ...calls], contentForm: form, raw };
  }

  private rebuildMessage(message: InternalMessage): Record<string, unknown> {
    const out: Record<string, unknown> = { ...message.raw };

    if (message.role === 'tool') {
      const result = message.parts.find(
        (p): p is ToolResultPart => p.type === 'tool_result',
      );
      if (result) {
        setContent(out, rebuildContent(result.content, result.contentForm));
        out.tool_call_id = result.toolCallId;
      }
      return out;
    }

    const content = message.parts.filter((p) => p.type !== 'tool_call');
    const calls = message.parts.filter(
      (p): p is ToolCallPart => p.type === 'tool_call',
    );
    setContent(out, rebuildContent(content, message.contentForm));
    if (calls.length || 'tool_calls' in message.raw) {
      out.tool_calls = calls.map(rebuildToolCall);
    }
    return out;
  }
}

function setContent(out: Record<string, unknown>, content: unknown): void {
  if (content === undefined) delete out.content;
  else out.content = content;
}
