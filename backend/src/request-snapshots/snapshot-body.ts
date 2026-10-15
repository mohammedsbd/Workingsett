import { sha256Hex } from '../context/canonical-json';
import type { ProxyApi } from '../proxy/providers/provider-adapter';

/** The field of each client API that holds the conversation. */
export const MESSAGE_LIST_KEY: Record<ProxyApi, string> = {
  'openai-chat': 'messages',
  'anthropic-messages': 'messages',
  'gemini-native': 'contents',
};

/** A request body as JSON texts: the envelope and each message. */
export type SplitBody = { envelope: string; messages: string[] };

/**
 * Splits a request body into its envelope (every field, with the message
 * list emptied but kept in place, so key order survives) and its messages,
 * each as JSON text exactly as the client wrote it. A session's requests
 * repeat their messages and usually their envelope, so storing these by
 * hash stores each once.
 */
export function splitBody(
  api: ProxyApi,
  body: Record<string, unknown>,
): SplitBody {
  const key = MESSAGE_LIST_KEY[api];
  const list = body[key];
  if (!Array.isArray(list)) {
    return { envelope: JSON.stringify(body), messages: [] };
  }
  return {
    envelope: JSON.stringify({ ...body, [key]: [] }),
    messages: list.map((message) => JSON.stringify(message)),
  };
}

/** The request body again, from an envelope and its messages. */
export function joinBody(
  api: ProxyApi,
  envelope: string,
  messages: string[],
): Record<string, unknown> {
  const body = JSON.parse(envelope) as Record<string, unknown>;
  const key = MESSAGE_LIST_KEY[api];
  if (!Array.isArray(body[key])) return body;
  body[key] = messages.map((message) => JSON.parse(message) as unknown);
  return body;
}

/** The address of one stored part. */
export const partHash = (json: string): string => sha256Hex(json);
