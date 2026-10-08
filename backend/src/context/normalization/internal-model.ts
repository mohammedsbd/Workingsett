import { ProxyApi } from '../../proxy/providers/provider-adapter';

/**
 * Parsim's provider-neutral view of a chat request. The GC engine reads and
 * edits this model; converters turn provider requests into it and back.
 *
 * Every part and message keeps the provider JSON it came from (`raw`).
 * Rebuilding starts from that raw JSON and only writes the fields the model
 * owns, so an unchanged request converts back to an identical one (same
 * keys, same key order, same values), and fields Parsim does not model are
 * never lost.
 */

export type InternalRole = 'system' | 'user' | 'assistant' | 'tool';

/** Images are referenced, not embedded: a URL, or the hash of inline data. */
export type ImageRef =
  | { source: 'url'; url: string }
  | { source: 'data'; mediaType: string | null; sha256: string; bytes: number };

/** How content was written in the provider JSON, so it is rebuilt the same way. */
export type ContentForm = 'string' | 'array' | 'null' | 'absent';

export type TextPart = {
  type: 'text';
  text: string;
  /** Anthropic cache_control marker, if any. Not part of the content hash. */
  cacheControl?: unknown;
  raw: unknown;
};

export type ImagePart = {
  type: 'image';
  image: ImageRef;
  cacheControl?: unknown;
  raw: unknown;
};

export type ToolCallPart = {
  type: 'tool_call';
  id: string;
  name: string;
  /** OpenAI: the arguments JSON string. Anthropic: the input object. */
  input: unknown;
  cacheControl?: unknown;
  raw: unknown;
};

export type ToolResultPart = {
  type: 'tool_result';
  toolCallId: string;
  content: InternalPart[];
  contentForm: ContentForm;
  isError: boolean;
  cacheControl?: unknown;
  raw: unknown;
};

export type ThinkingPart = { type: 'thinking'; text: string; raw: unknown };

/** Anything Parsim does not model (audio, documents, server tools, ...). */
export type OtherPart = { type: 'other'; cacheControl?: unknown; raw: unknown };

export type InternalPart =
  | TextPart
  | ImagePart
  | ToolCallPart
  | ToolResultPart
  | ThinkingPart
  | OtherPart;

export type InternalMessage = {
  role: InternalRole;
  parts: InternalPart[];
  contentForm: ContentForm;
  raw: Record<string, unknown>;
};

export type InternalRequest = {
  api: ProxyApi;
  model: string;
  /** A top-level system prompt (Anthropic). OpenAI system messages stay in `messages`. */
  system: { parts: InternalPart[]; contentForm: ContentForm } | null;
  messages: InternalMessage[];
  /** The whole original body; fields outside the model are kept from here. */
  raw: Record<string, unknown>;
};

/** Converts one client API's request body to the internal model and back. */
export interface MessageConverter {
  readonly api: ProxyApi;
  toInternal(body: Record<string, unknown>): InternalRequest;
  fromInternal(request: InternalRequest): Record<string, unknown>;
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';
