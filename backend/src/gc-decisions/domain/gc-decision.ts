import { GcAction, GcReason } from '../../gc/gc-types';

/**
 * A rewrite of one tool result in an agent session, stored the first time
 * it is made. Later requests of the session reapply it byte for byte, so
 * rows are only ever added (never changed or removed).
 */
export class GcDecision {
  id: string;
  /** The run that first made the decision. */
  gcRunId: string;
  agentSessionId: string;
  /** Tool call id and content hash (or position and hash) of the item. */
  itemKey: string;
  position: number;
  toolCallId: string | null;
  toolName: string;
  contentHash: string;
  decision: GcAction;
  reason: GcReason;
  /** Why, without any content. */
  detail: string;
  tokensBefore: number;
  tokensAfter: number;
  /** The stub that replaces the tool result's content. */
  replacement: string;
  archiveId: string | null;
  createdAt: Date;
}
