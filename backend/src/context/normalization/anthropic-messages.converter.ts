import { dataImageRef } from './image-ref';
import {
  asString,
  ContentForm,
  ImageRef,
  InternalMessage,
  InternalPart,
  InternalRequest,
  isObject,
  MessageConverter,
} from './internal-model';

function contentForm(content: unknown, hasKey: boolean): ContentForm {
  if (!hasKey) return 'absent';
  if (content === null) return 'null';
  return typeof content === 'string' ? 'string' : 'array';
}

function imageRef(source: unknown): ImageRef {
  const s = isObject(source) ? source : {};
  if (s.type === 'url') return { source: 'url', url: asString(s.url) };
  const mediaType = typeof s.media_type === 'string' ? s.media_type : null;
  return dataImageRef(mediaType, asString(s.data));
}

function cacheControlOf(block: Record<string, unknown>): unknown {
  return block.cache_control;
}

function blocks(content: unknown): InternalPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content, raw: content }];
  }
  if (!Array.isArray(content)) return [];
  return content.map((block: unknown): InternalPart => {
    if (!isObject(block)) return { type: 'other', raw: block };
    const cacheControl = cacheControlOf(block);
    switch (block.type) {
      case 'text':
        return {
          type: 'text',
          text: asString(block.text),
          cacheControl,
          raw: block,
        };
      case 'image':
        return {
          type: 'image',
          image: imageRef(block.source),
          cacheControl,
          raw: block,
        };
      case 'tool_use':
        return {
          type: 'tool_call',
          id: asString(block.id),
          name: asString(block.name),
          input: block.input,
          cacheControl,
          raw: block,
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          toolCallId: asString(block.tool_use_id),
          content: blocks(block.content),
          contentForm: contentForm(block.content, 'content' in block),
          isError: block.is_error === true,
          cacheControl,
          raw: block,
        };
      case 'thinking':
        return { type: 'thinking', text: asString(block.thinking), raw: block };
      default:
        // documents, redacted thinking, server tool blocks and anything new
        return { type: 'other', cacheControl, raw: block };
    }
  });
}

/** Writes cache_control back from the part, keeping its position if it existed. */
function withCacheControl(
  block: Record<string, unknown>,
  cacheControl: unknown,
): Record<string, unknown> {
  if (cacheControl === undefined) {
    delete block.cache_control;
  } else {
    block.cache_control = cacheControl;
  }
  return block;
}

function rebuildBlock(part: InternalPart): unknown {
  switch (part.type) {
    case 'text':
      if (!isObject(part.raw)) {
        return withCacheControl(
          { type: 'text', text: part.text },
          part.cacheControl,
        );
      }
      return withCacheControl(
        { ...part.raw, text: part.text },
        part.cacheControl,
      );
    case 'tool_call':
      return withCacheControl(
        {
          ...(isObject(part.raw) ? part.raw : { type: 'tool_use' }),
          id: part.id,
          name: part.name,
          input: part.input,
        },
        part.cacheControl,
      );
    case 'tool_result': {
      const out: Record<string, unknown> = {
        ...(isObject(part.raw) ? part.raw : { type: 'tool_result' }),
        tool_use_id: part.toolCallId,
      };
      const content = rebuildContent(part.content, part.contentForm);
      if (content === undefined) delete out.content;
      else out.content = content;
      if (part.isError || 'is_error' in out) out.is_error = part.isError;
      return withCacheControl(out, part.cacheControl);
    }
    case 'thinking':
      return isObject(part.raw)
        ? { ...part.raw, thinking: part.text }
        : part.raw;
    case 'image':
    case 'other':
      return isObject(part.raw)
        ? withCacheControl({ ...part.raw }, part.cacheControl)
        : part.raw;
  }
}

function rebuildContent(parts: InternalPart[], form: ContentForm): unknown {
  if (
    form === 'string' &&
    parts.length === 1 &&
    parts[0].type === 'text' &&
    parts[0].cacheControl === undefined
  ) {
    return parts[0].text;
  }
  if ((form === 'null' || form === 'absent') && parts.length === 0) {
    return form === 'null' ? null : undefined;
  }
  return parts.map(rebuildBlock);
}

/**
 * Anthropic Messages format. The top-level system prompt becomes
 * `system`; tool_use and tool_result blocks become tool_call and
 * tool_result parts; cache_control markers are kept on each part.
 */
export class AnthropicMessagesConverter implements MessageConverter {
  readonly api = 'anthropic-messages' as const;

  toInternal(body: Record<string, unknown>): InternalRequest {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    return {
      api: this.api,
      model: asString(body.model),
      system:
        'system' in body
          ? {
              parts: blocks(body.system),
              contentForm: contentForm(body.system, true),
            }
          : null,
      messages: messages.filter(isObject).map(
        (raw): InternalMessage => ({
          role: raw.role === 'assistant' ? 'assistant' : 'user',
          parts: blocks(raw.content),
          contentForm: contentForm(raw.content, 'content' in raw),
          raw,
        }),
      ),
      raw: body,
    };
  }

  fromInternal(request: InternalRequest): Record<string, unknown> {
    const body: Record<string, unknown> = { ...request.raw };
    if (request.system) {
      const system = rebuildContent(
        request.system.parts,
        request.system.contentForm,
      );
      if (system === undefined) delete body.system;
      else body.system = system;
    } else {
      delete body.system;
    }
    if ('messages' in request.raw || request.messages.length) {
      body.messages = request.messages.map((m) => {
        const out: Record<string, unknown> = { ...m.raw };
        const content = rebuildContent(m.parts, m.contentForm);
        if (content === undefined) delete out.content;
        else out.content = content;
        return out;
      });
    }
    return body;
  }
}
