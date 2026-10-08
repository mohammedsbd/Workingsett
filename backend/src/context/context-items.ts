import { contentHash } from './canonical-json';
import {
  InternalPart,
  InternalRequest,
  InternalRole,
} from './normalization/internal-model';

export const CONTEXT_ITEM_KINDS = [
  'system',
  'user',
  'assistant',
  'tool_call',
  'tool_result',
] as const;
export type ContextItemKind = (typeof CONTEXT_ITEM_KINDS)[number];

/** Provider-neutral content of one context item, as hashed and stored. */
export type CanonicalPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: unknown }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; isError: boolean; content: CanonicalPart[] }
  | { type: 'thinking'; text: string }
  | { type: 'other'; value: unknown };

export type CanonicalContent = {
  kind: ContextItemKind;
  parts: CanonicalPart[];
};

export type ExtractedItem = {
  /** 0-based position in the conversation. Stable while the prefix is unchanged. */
  position: number;
  role: InternalRole;
  kind: ContextItemKind;
  toolCallId: string | null;
  content: CanonicalContent;
  contentHash: string;
  /** Text used to count tokens (images are counted separately). */
  tokenText: string;
  imageCount: number;
};

function withoutCacheControl(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.cache_control;
  return copy;
}

/**
 * The hashed form of a part. Leaves out what does not change the content:
 * cache_control markers (clients move them between turns) and tool call ids
 * (so identical tool output is stored once).
 */
export function canonicalPart(part: InternalPart): CanonicalPart {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image':
      return { type: 'image', image: part.image };
    case 'tool_call':
      return { type: 'tool_call', name: part.name, input: part.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        isError: part.isError,
        content: part.content.map(canonicalPart),
      };
    case 'thinking':
      return { type: 'thinking', text: part.text };
    case 'other':
      return { type: 'other', value: withoutCacheControl(part.raw) };
  }
}

function tokenText(parts: CanonicalPart[]): { text: string; images: number } {
  let text = '';
  let images = 0;
  for (const part of parts) {
    switch (part.type) {
      case 'text':
      case 'thinking':
        text += part.text + '\n';
        break;
      case 'image':
        images += 1;
        break;
      case 'tool_call':
        text +=
          part.name +
          '\n' +
          (typeof part.input === 'string'
            ? part.input
            : JSON.stringify(part.input ?? null)) +
          '\n';
        break;
      case 'tool_result': {
        const inner = tokenText(part.content);
        text += inner.text;
        images += inner.images;
        break;
      }
      case 'other':
        text += JSON.stringify(part.value ?? null) + '\n';
        break;
    }
  }
  return { text, images };
}

/**
 * Splits a request into context items, in conversation order: the system
 * prompt, then for each message its plain content (one item) with every
 * tool call and tool result as an item of its own.
 */
export function extractContextItems(request: InternalRequest): ExtractedItem[] {
  const items: Omit<ExtractedItem, 'position'>[] = [];

  const push = (
    role: InternalRole,
    kind: ContextItemKind,
    parts: InternalPart[],
    toolCallId: string | null = null,
  ) => {
    const canonical = parts.map(canonicalPart);
    const content: CanonicalContent = { kind, parts: canonical };
    const { text, images } = tokenText(canonical);
    items.push({
      role,
      kind,
      toolCallId,
      content,
      contentHash: contentHash(content),
      tokenText: text,
      imageCount: images,
    });
  };

  if (request.system?.parts.length) {
    push('system', 'system', request.system.parts);
  }

  for (const message of request.messages) {
    let group: InternalPart[] = [];
    const flush = () => {
      if (!group.length) return;
      const kind: ContextItemKind =
        message.role === 'tool' ? 'tool_result' : message.role;
      push(message.role, kind, group);
      group = [];
    };
    for (const part of message.parts) {
      if (part.type === 'tool_call') {
        flush();
        push(message.role, 'tool_call', [part], part.id || null);
      } else if (part.type === 'tool_result') {
        flush();
        push(message.role, 'tool_result', [part], part.toolCallId || null);
      } else {
        group.push(part);
      }
    }
    flush();
  }

  return items.map((item, position) => ({ ...item, position }));
}
