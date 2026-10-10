import { CanonicalContent } from '../context/context-items';
import { InternalRequest } from '../context/normalization/internal-model';
import { GcConfig } from './gc-config';

export const GC_ACTIONS = ['drop', 'archive'] as const;
export type GcAction = (typeof GC_ACTIONS)[number];

export const GC_REASONS = ['duplicate', 'superseded', 'stale_large'] as const;
/**
 * duplicate: the same tool output appears again later.
 * superseded: the same tool was called again later with the same arguments.
 * stale_large: a large tool result more than K turns old.
 */
export type GcReason = (typeof GC_REASONS)[number];

/** One rewritten tool result. Kept items get no decision. */
export type GcDecision = {
  /**
   * Identifies the item across requests of a session: the tool call id and
   * content hash, or the position and content hash if there is no id.
   */
  itemKey: string;
  /** Context item position, as in context_item. */
  position: number;
  toolCallId: string | null;
  toolName: string;
  /** Hash of the original tool result (context_item.contentHash). */
  contentHash: string;
  decision: GcAction;
  reason: GcReason;
  /** Why, without any content (for example which later item it duplicates). */
  detail: string;
  tokensBefore: number;
  tokensAfter: number;
  /** The text that replaces the tool result's content. */
  replacement: string;
  /** For archive decisions: the id the original is stored under. */
  archiveId: string | null;
  /** True when the decision was made by an earlier request and reapplied. */
  sticky: boolean;
  /** The original tool result, so archived content can be stored. */
  original: CanonicalContent;
};

/** What a later request needs to rewrite an item exactly the same way. */
export type PriorDecision = Pick<
  GcDecision,
  'itemKey' | 'decision' | 'reason' | 'detail' | 'replacement' | 'archiveId'
>;

export type GcInput = {
  request: InternalRequest;
  config: GcConfig;
  /** Token count of a text plus a number of images. Must be deterministic. */
  countTokens: (text: string, images: number) => number;
  /** Decisions stored for this session by earlier requests. */
  prior?: readonly PriorDecision[];
};

export type GcResult = {
  /** The request to forward. The input request when nothing changed. */
  request: InternalRequest;
  /** Every rewrite applied, sticky and new, in conversation order. */
  decisions: GcDecision[];
  /** Whether the context was above the threshold, so new decisions could be made. */
  ran: boolean;
  tokensBefore: number;
  tokensAfter: number;
};
