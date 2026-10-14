import { extractContextItems } from '../context/context-items';
import {
  InternalMessage,
  InternalPart,
  InternalRequest,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from '../context/normalization/internal-model';
import { ProxyApi } from '../proxy/providers/provider-adapter';
import { continueNote } from './state-block';
import { stretchKey } from './stretch';

/** A ready compression, as stored. */
export type ReadyCompression = {
  startIndex: number;
  endIndex: number;
  stretchKey: string;
  firstTurn: number;
  lastTurn: number;
  stateBlock: string;
};

function textPart(api: ProxyApi, text: string): TextPart {
  const raw =
    api === 'openai-chat'
      ? text
      : api === 'anthropic-messages'
        ? { type: 'text', text }
        : { text };
  return { type: 'text', text, raw };
}

function message(
  api: ProxyApi,
  role: 'assistant' | 'user',
  parts: InternalPart[],
): InternalMessage {
  const providerRole =
    api === 'gemini-native' && role === 'assistant' ? 'model' : role;
  const single = parts.length === 1 && parts[0].type === 'text';
  return {
    role,
    parts,
    contentForm: api === 'openai-chat' && single ? 'string' : 'array',
    raw: { role: providerRole },
  };
}

/**
 * The messages that replace a stretch: an assistant message with the state
 * block and every side-effect call of the stretch (the parts unchanged),
 * then their results unchanged (OpenAI tool messages as they were, one user
 * message of results otherwise). Without side effects, a short user note
 * follows instead. Either way the roles still alternate, as Anthropic and
 * Gemini require, and the bytes are the same on every request.
 */
function replacement(
  api: ProxyApi,
  stretch: InternalMessage[],
  compression: ReadyCompression,
  isSideEffect: (toolName: string) => boolean,
): InternalMessage[] {
  const calls: ToolCallPart[] = [];
  for (const m of stretch) {
    for (const part of m.parts) {
      if (part.type === 'tool_call' && isSideEffect(part.name))
        calls.push(part);
    }
  }
  const ids = new Set(calls.map((call) => call.id));
  const head = message(api, 'assistant', [
    textPart(api, compression.stateBlock),
    ...calls,
  ]);
  if (!calls.length) {
    return [
      head,
      message(api, 'user', [
        textPart(
          api,
          continueNote(compression.firstTurn, compression.lastTurn),
        ),
      ]),
    ];
  }
  if (api === 'openai-chat') {
    const toolMessages = stretch.filter(
      (m) =>
        m.role === 'tool' &&
        m.parts.some((p) => p.type === 'tool_result' && ids.has(p.toolCallId)),
    );
    return [head, ...toolMessages];
  }
  const results: ToolResultPart[] = [];
  for (const m of stretch) {
    for (const part of m.parts) {
      if (part.type === 'tool_result' && ids.has(part.toolCallId)) {
        results.push(part);
      }
    }
  }
  return [head, message(api, 'user', results)];
}

/**
 * Replaces each stored stretch that is still present, unchanged, in the
 * client's request (checked against `original`, the request as received)
 * by its state block. `request` is the request to forward (after GC), with
 * the same messages in the same places. Pure.
 */
export function applyCompressions(input: {
  original: InternalRequest;
  request: InternalRequest;
  compressions: ReadyCompression[];
  isSideEffect: (toolName: string) => boolean;
}): { request: InternalRequest; applied: number } {
  const { original, request } = input;
  if (!input.compressions.length) return { request, applied: 0 };
  const items = extractContextItems(original);
  const valid = input.compressions
    .filter(
      (c) =>
        c.endIndex <= original.messages.length &&
        c.endIndex <= request.messages.length &&
        stretchKey(items, c.startIndex, c.endIndex) === c.stretchKey,
    )
    .sort((a, b) => b.startIndex - a.startIndex);

  const messages = [...request.messages];
  let applied = 0;
  let lowestStart = Infinity;
  for (const compression of valid) {
    // Never apply two overlapping blocks.
    if (compression.endIndex > lowestStart) continue;
    const stretch = messages.slice(
      compression.startIndex,
      compression.endIndex,
    );
    messages.splice(
      compression.startIndex,
      compression.endIndex - compression.startIndex,
      ...replacement(request.api, stretch, compression, input.isSideEffect),
    );
    lowestStart = compression.startIndex;
    applied += 1;
  }
  return applied
    ? { request: { ...request, messages }, applied }
    : { request, applied };
}
