import {
  canonicalJson,
  contentHash,
  sha256Hex,
} from '../context/canonical-json';
import {
  CanonicalContent,
  canonicalPart,
  ExtractedItem,
} from '../context/context-items';
import {
  InternalMessage,
  InternalRequest,
} from '../context/normalization/internal-model';
import type {
  CompressionInput,
  StretchMessage,
} from '../compressions/domain/compression';
import { archiveIdFor } from '../gc/gc-engine';
import { archivedText } from '../recall/recall-tool';
import { renderStateBlock } from './state-block';

/**
 * Finished stretches: the part of a conversation that can be summarized
 * into a state block. Heuristics, kept simple on purpose:
 *
 * - Whole turns only. A turn starts at each assistant message and includes
 *   the tool results and user messages after it.
 * - Never the start (the system prompt and the first user goal come before
 *   the first turn) or the protected tail (the last N turns).
 * - From the end of the session's previous compression up to the protected
 *   tail, so stretches never overlap and each one follows the last.
 * - No open tool calls: every call in the stretch has its result in it.
 * - No system or developer messages inside it (they mark a change the
 *   client made on purpose).
 * - At least `minTokens` tokens as sent (after GC), so a summary is worth
 *   its cost. `worthCompressing` then checks the block would at least halve
 *   the stretch, since the GC may already have shrunk it to stubs.
 */

export type StretchConfig = {
  minTokens: number;
  protectedTurns: number;
};

export type Stretch = {
  startIndex: number;
  endIndex: number;
  firstTurn: number;
  lastTurn: number;
  tokens: number;
  key: string;
};

/** Turn number of each message: 0 before the first assistant message. */
export function turnsOf(messages: InternalMessage[]): number[] {
  let turn = 0;
  return messages.map((message) => {
    if (message.role === 'assistant') turn += 1;
    return turn;
  });
}

/**
 * Identifies a stretch across requests: its message range and the content
 * hashes of its items. A later request with different content there gets
 * a different key, so a stored state block is never applied to it.
 */
export function stretchKey(
  items: ExtractedItem[],
  startIndex: number,
  endIndex: number,
): string {
  const hashes = items
    .filter(
      (item) =>
        item.messageIndex !== null &&
        item.messageIndex >= startIndex &&
        item.messageIndex < endIndex,
    )
    .map((item) => item.contentHash);
  return sha256Hex(canonicalJson({ startIndex, endIndex, hashes }));
}

/** Sums item tokens over a message range [startIndex, endIndex). */
export function tokensInRange(
  items: ExtractedItem[],
  tokensOf: (item: ExtractedItem) => number,
): (startIndex: number, endIndex: number) => number {
  return (startIndex, endIndex) =>
    items
      .filter(
        (item) =>
          item.messageIndex !== null &&
          item.messageIndex >= startIndex &&
          item.messageIndex < endIndex,
      )
      .reduce((sum, item) => sum + tokensOf(item), 0);
}

/**
 * The next finished stretch after message index `after` (the end of the
 * previous compression, or 0), or null if there is none yet. `items` are
 * the request's own (for the key); `tokensIn` measures a range as it is
 * sent, which can be the GC'd request with the same message indices.
 */
export function findStretch(
  request: InternalRequest,
  items: ExtractedItem[],
  tokensIn: (startIndex: number, endIndex: number) => number,
  after: number,
  config: StretchConfig,
): Stretch | null {
  const { messages } = request;
  const turns = turnsOf(messages);
  const total = turns.length ? Math.max(...turns) : 0;
  const tailStart = total - config.protectedTurns + 1;
  if (tailStart <= 1) return null;

  const endIndex = turns.findIndex((turn) => turn >= tailStart);
  const startIndex = messages.findIndex(
    (message, index) => index >= after && message.role === 'assistant',
  );
  if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
    return null;
  }

  const calls = new Set<string>();
  const results = new Set<string>();
  for (let i = startIndex; i < endIndex; i++) {
    if (messages[i].role === 'system') return null;
    for (const part of messages[i].parts) {
      if (part.type === 'tool_call') calls.add(part.id);
      if (part.type === 'tool_result') results.add(part.toolCallId);
    }
  }
  const closed =
    [...calls].every((id) => results.has(id)) &&
    [...results].every((id) => calls.has(id));
  if (!closed) return null;

  const tokens = tokensIn(startIndex, endIndex);
  if (tokens < config.minTokens) return null;

  return {
    startIndex,
    endIndex,
    firstTurn: turns[startIndex],
    lastTurn: turns[endIndex - 1],
    tokens,
    key: stretchKey(items, startIndex, endIndex),
  };
}

const ACTION_TEXT_CHARS = 160;

const clip = (text: string, max = ACTION_TEXT_CHARS) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
};

function messageContent(message: InternalMessage): CanonicalContent {
  return {
    kind:
      message.role === 'assistant'
        ? 'assistant'
        : message.role === 'tool'
          ? 'tool_result'
          : 'user',
    parts: message.parts.map(canonicalPart),
  };
}

/**
 * What the summary job needs: the goal for context, each original message
 * with the archive id it is stored under, and one compact line per
 * side-effect call (those calls and results stay in the request as well).
 */
export function stretchInput(
  request: InternalRequest,
  stretch: Pick<Stretch, 'startIndex' | 'endIndex'>,
  isSideEffect: (toolName: string) => boolean,
): CompressionInput {
  const { messages } = request;
  const turns = turnsOf(messages);
  const goal = messages.find((m) => m.role === 'user');

  const stretchMessages: StretchMessage[] = [];
  const results = new Map<string, string>();
  for (let i = stretch.startIndex; i < stretch.endIndex; i++) {
    const message = messages[i];
    const content = messageContent(message);
    stretchMessages.push({
      index: i,
      turn: turns[i],
      role: message.role === 'system' ? 'user' : message.role,
      content,
      archiveId: archiveIdFor(contentHash(content)),
    });
    for (const part of message.parts) {
      if (part.type === 'tool_result') {
        results.set(
          part.toolCallId,
          archivedText({ kind: 'tool_result', parts: [canonicalPart(part)] }),
        );
      }
    }
  }

  const actions: string[] = [];
  for (let i = stretch.startIndex; i < stretch.endIndex; i++) {
    for (const part of messages[i].parts) {
      if (part.type !== 'tool_call' || !isSideEffect(part.name)) continue;
      const args =
        typeof part.input === 'string'
          ? part.input
          : JSON.stringify(part.input ?? {});
      actions.push(
        `${part.name}(${clip(args)}) -> ${clip(results.get(part.id) ?? '(no result)')}`,
      );
    }
  }

  return {
    goal: goal
      ? clip(archivedText(messageContent(goal)), 2000)
      : '(no goal message)',
    messages: stretchMessages,
    actions,
  };
}

/** Tokens a summary's goal, decisions, facts and open items may take. */
export const SUMMARY_ALLOWANCE_TOKENS = 600;

/**
 * Whether a stretch is worth a summary: the state block (with its action
 * lines, original ids and a summary allowance) plus the side-effect calls
 * and results kept next to it must take at most half of what the stretch
 * costs as sent. Decided once, before any summary is paid for.
 */
export function worthCompressing(input: {
  /** The request as sent (after GC), same message indices. */
  sent: InternalRequest;
  sentItems: ExtractedItem[];
  stretch: Stretch;
  stretchInput: CompressionInput;
  isSideEffect: (toolName: string) => boolean;
  count: (text: string) => number;
  tokensOf: (item: ExtractedItem) => number;
}): { worth: boolean; estimate: number } {
  const { stretch, sent } = input;
  const ids = new Set<string>();
  for (let i = stretch.startIndex; i < stretch.endIndex; i++) {
    for (const part of sent.messages[i]?.parts ?? []) {
      if (part.type === 'tool_call' && input.isSideEffect(part.name)) {
        ids.add(part.id);
      }
    }
  }
  const kept = input.sentItems
    .filter(
      (item) =>
        item.messageIndex !== null &&
        item.messageIndex >= stretch.startIndex &&
        item.messageIndex < stretch.endIndex &&
        item.toolCallId !== null &&
        ids.has(item.toolCallId),
    )
    .reduce((sum, item) => sum + input.tokensOf(item), 0);
  const block = input.count(
    renderStateBlock({
      summary: { goal: '', decisions: [], facts: [], openItems: [] },
      firstTurn: stretch.firstTurn,
      lastTurn: stretch.lastTurn,
      actions: input.stretchInput.actions,
      messages: input.stretchInput.messages,
    }),
  );
  const estimate = kept + block + SUMMARY_ALLOWANCE_TOKENS;
  return { worth: estimate * 2 <= stretch.tokens, estimate };
}
