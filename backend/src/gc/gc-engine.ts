import { canonicalJson } from '../context/canonical-json';
import { ExtractedItem, extractContextItems } from '../context/context-items';
import {
  InternalMessage,
  InternalPart,
  InternalRequest,
  ToolResultPart,
} from '../context/normalization/internal-model';
import { GcConfig, hasSideEffects } from './gc-config';
import {
  GcAction,
  GcDecision,
  GcInput,
  GcReason,
  GcResult,
  PriorDecision,
} from './gc-types';

/** Length of the content hash prefix in an archive id (64 bits). */
const ARCHIVE_ID_HASH_CHARS = 16;

/**
 * The id an archived tool result is stored and recalled under. Derived from
 * its content, so the same content always gets the same id.
 */
export function archiveIdFor(contentHash: string): string {
  return `arc_${contentHash.slice(0, ARCHIVE_ID_HASH_CHARS)}`;
}

export function archiveStub(
  toolName: string,
  tokens: number,
  archiveId: string,
): string {
  return `[parsim archived: ${toolName} result, ${tokens} tokens, id ${archiveId}]`;
}

export function duplicateStub(toolName: string): string {
  return `[parsim dropped: ${toolName} result, duplicate of a later tool result]`;
}

export function supersededStub(toolName: string): string {
  return `[parsim dropped: ${toolName} result, superseded by a later ${toolName} call with the same arguments]`;
}

/** Same tool call id and content: the same item in every later request. */
export function itemKeyOf(item: ExtractedItem): string {
  return item.toolCallId
    ? `call:${item.toolCallId}:${item.contentHash}`
    : `pos:${item.position}:${item.contentHash}`;
}

type CallInfo = {
  item: ExtractedItem;
  name: string;
  /** Tool name plus canonical arguments: equal for repeated calls. */
  signature: string;
};

type ResultInfo = {
  item: ExtractedItem;
  part: ToolResultPart;
  call: CallInfo | null;
  tokens: number;
  /** 1 for the newest turn, 2 for the one before, and so on. */
  age: number;
};

type Rewrite = Omit<GcDecision, 'tokensBefore' | 'tokensAfter' | 'original'>;

/**
 * Runs one GC pass over a request. Pure and deterministic: the same input
 * gives the same output, and the input is never modified.
 *
 * Only tool results are ever rewritten, and only their content: the tool
 * result stays in place with its tool call id, so every tool call keeps its
 * answer and the request stays valid for the provider. Rewrites from
 * earlier requests (`prior`) are applied again byte for byte, so a prefix
 * that was sent once is sent the same way again. New rewrites are made
 * only when the context is above `minContextTokens`.
 *
 * Never touched: the system prompt, the first user message, the last
 * `protectedTurns` turns, and tools with side effects (call and result).
 * A turn starts at each assistant message; what comes before the first one
 * is not part of any turn and is protected as the conversation's goal.
 */
export function runGc(input: GcInput): GcResult {
  const { request, config, countTokens } = input;
  const items = extractContextItems(request);
  const tokens = new Map<ExtractedItem, number>();
  let tokensBefore = 0;
  for (const item of items) {
    const count = countTokens(item.tokenText, item.imageCount);
    tokens.set(item, count);
    tokensBefore += count;
  }

  const turns = turnOfMessage(request.messages);
  const totalTurns = turns.length ? Math.max(...turns) : 0;
  const firstUser = request.messages.findIndex((m) => m.role === 'user');

  const calls = new Map<string, CallInfo>();
  const callsInOrder: CallInfo[] = [];
  const results: ResultInfo[] = [];
  for (const item of items) {
    const part = partOf(request, item);
    if (part?.type === 'tool_call') {
      const call: CallInfo = {
        item,
        name: part.name,
        signature: `${part.name}\u0000${canonicalArguments(part.input)}`,
      };
      callsInOrder.push(call);
      if (part.id && !calls.has(part.id)) calls.set(part.id, call);
    }
  }
  for (const item of items) {
    const part = partOf(request, item);
    if (part?.type !== 'tool_result' || item.messageIndex === null) continue;
    results.push({
      item,
      part,
      call: (part.toolCallId && calls.get(part.toolCallId)) || null,
      tokens: tokens.get(item)!,
      age: turns[item.messageIndex]
        ? totalTurns - turns[item.messageIndex] + 1
        : 0,
    });
  }

  const protectedResult = (result: ResultInfo): boolean =>
    result.item.messageIndex === firstUser ||
    result.age === 0 ||
    result.age <= config.protectedTurns ||
    // An unanswered id means we cannot tell which tool made it: keep it.
    result.call === null ||
    hasSideEffects(result.call.name, config);

  const ran = tokensBefore > config.minContextTokens;
  const prior = new Map<string, PriorDecision>();
  for (const decision of input.prior ?? []) {
    if (!prior.has(decision.itemKey)) prior.set(decision.itemKey, decision);
  }
  const latestWithHash = latestPositionByHash(results);
  const answered = answeredCalls(results);

  const decisions: GcDecision[] = [];
  for (const result of results) {
    if (protectedResult(result)) continue;
    const key = itemKeyOf(result.item);
    const earlier = prior.get(key);
    const rewrite: Rewrite | null = earlier
      ? { ...fromPrior(earlier, result), sticky: true }
      : ran
        ? decide(result, config, latestWithHash, callsInOrder, answered)
        : null;
    if (!rewrite) continue;
    const tokensAfter = countTokens(rewrite.replacement, 0);
    // A stub must save tokens; sticky rewrites are kept whatever they cost.
    if (!rewrite.sticky && tokensAfter >= result.tokens) continue;
    decisions.push({
      ...rewrite,
      tokensBefore: result.tokens,
      tokensAfter,
      original: result.item.content,
    });
  }

  if (!decisions.length) {
    return { request, decisions, ran, tokensBefore, tokensAfter: tokensBefore };
  }
  const saved = decisions.reduce(
    (sum, d) => sum + d.tokensBefore - d.tokensAfter,
    0,
  );
  return {
    request: rewriteRequest(request, results, decisions),
    decisions,
    ran,
    tokensBefore,
    tokensAfter: tokensBefore - saved,
  };
}

function decide(
  result: ResultInfo,
  config: GcConfig,
  latestWithHash: Map<string, number>,
  callsInOrder: CallInfo[],
  answered: Map<string, ResultInfo>,
): Rewrite | null {
  const { item, call } = result;
  const toolName = call!.name;
  const base = {
    itemKey: itemKeyOf(item),
    position: item.position,
    toolCallId: item.toolCallId,
    toolName,
    contentHash: item.contentHash,
    sticky: false,
  };
  const make = (
    decision: GcAction,
    reason: GcReason,
    detail: string,
    replacement: string,
    archiveId: string | null = null,
  ): Rewrite => ({
    ...base,
    decision,
    reason,
    detail,
    replacement,
    archiveId,
  });

  const latest = latestWithHash.get(item.contentHash)!;
  if (latest > item.position) {
    return make(
      'drop',
      'duplicate',
      `same content as the tool result at position ${latest}`,
      duplicateStub(toolName),
    );
  }

  const newer = callsInOrder.find((other) => {
    if (other.item.position <= call!.item.position) return false;
    if (other.signature !== call!.signature) return false;
    // Only a later call that got a good answer replaces this one.
    const answer = other.item.toolCallId
      ? answered.get(other.item.toolCallId)
      : undefined;
    return answer !== undefined && !answer.part.isError;
  });
  if (newer) {
    return make(
      'drop',
      'superseded',
      `same tool and arguments called again at position ${newer.item.position}`,
      supersededStub(toolName),
    );
  }

  if (
    result.tokens > config.archiveMinTokens &&
    result.age > config.archiveAfterTurns
  ) {
    const archiveId = archiveIdFor(item.contentHash);
    return make(
      'archive',
      'stale_large',
      `${result.tokens} tokens, ${result.age - 1} turns old`,
      archiveStub(toolName, result.tokens, archiveId),
      archiveId,
    );
  }
  return null;
}

function fromPrior(prior: PriorDecision, result: ResultInfo): Rewrite {
  return {
    itemKey: prior.itemKey,
    position: result.item.position,
    toolCallId: result.item.toolCallId,
    toolName: result.call!.name,
    contentHash: result.item.contentHash,
    decision: prior.decision,
    reason: prior.reason,
    detail: prior.detail,
    replacement: prior.replacement,
    archiveId: prior.archiveId,
    sticky: true,
  };
}

/** Turn number of each message: 0 before the first assistant message. */
function turnOfMessage(messages: InternalMessage[]): number[] {
  let turn = 0;
  return messages.map((message) => {
    if (message.role === 'assistant') turn += 1;
    return turn;
  });
}

function partOf(
  request: InternalRequest,
  item: ExtractedItem,
): InternalPart | undefined {
  if (item.messageIndex === null || item.partIndex === null) return undefined;
  return request.messages[item.messageIndex].parts[item.partIndex];
}

/** OpenAI sends arguments as a JSON string; key order must not matter. */
function canonicalArguments(input: unknown): string {
  if (typeof input === 'string') {
    try {
      return canonicalJson(JSON.parse(input));
    } catch {
      return JSON.stringify(input);
    }
  }
  return canonicalJson(input ?? null);
}

function latestPositionByHash(results: ResultInfo[]): Map<string, number> {
  const latest = new Map<string, number>();
  for (const { item } of results) {
    latest.set(
      item.contentHash,
      Math.max(latest.get(item.contentHash) ?? -1, item.position),
    );
  }
  return latest;
}

function answeredCalls(results: ResultInfo[]): Map<string, ResultInfo> {
  const answered = new Map<string, ResultInfo>();
  for (const result of results) {
    const id = result.part.toolCallId;
    if (id) answered.set(id, result);
  }
  return answered;
}

/** Copies the request, replacing the content of each rewritten tool result. */
function rewriteRequest(
  request: InternalRequest,
  results: ResultInfo[],
  decisions: GcDecision[],
): InternalRequest {
  const byPosition = new Map(decisions.map((d) => [d.position, d]));
  const messages = [...request.messages];
  for (const { item, part } of results) {
    const decision = byPosition.get(item.position);
    if (!decision) continue;
    const m = item.messageIndex!;
    const parts = [...messages[m].parts];
    parts[item.partIndex!] = replaceContent(part, decision.replacement);
    messages[m] = { ...messages[m], parts };
  }
  return { ...request, messages };
}

/**
 * The tool result with its content replaced by a stub. Keeps the tool call
 * id, error flag and the result's own cache_control. If a block inside the
 * content carried a cache breakpoint, the stub carries it instead, so the
 * client's caching layout is not lost.
 */
function replaceContent(part: ToolResultPart, stub: string): ToolResultPart {
  const breakpoint = [...part.content]
    .reverse()
    .find((p) => 'cacheControl' in p && p.cacheControl !== undefined);
  if (breakpoint && 'cacheControl' in breakpoint) {
    return {
      ...part,
      contentForm: 'array',
      content: [
        {
          type: 'text',
          text: stub,
          cacheControl: breakpoint.cacheControl,
          raw: { type: 'text', text: stub },
        },
      ],
    };
  }
  return {
    ...part,
    contentForm: 'string',
    content: [{ type: 'text', text: stub, raw: stub }],
  };
}
