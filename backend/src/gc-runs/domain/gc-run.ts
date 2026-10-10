import { GcMode } from '../../gc/gc-config';

/**
 * One GC evaluation of a proxied request, in shadow or on mode. In shadow
 * mode the original request was forwarded and tokensBefore - tokensAfter is
 * what the GC would have saved; in on mode it is what it saved.
 */
export class GcRun {
  id: string;
  projectId: string;
  /** Null when the agent session could not be stored. */
  agentSessionId: string | null;
  /** The usage record of the same request, when it was saved. */
  usageRecordId: string | null;
  mode: Exclude<GcMode, 'off'>;
  /** Whether the context was above the threshold, so new decisions could be made. */
  ran: boolean;
  /** Whether the GC'd request was forwarded (on mode, with at least one rewrite). */
  applied: boolean;
  /** Whether the GC failed; the original request was forwarded. */
  failed: boolean;
  /** Error class name when failed. Never a message, which could hold content. */
  error: string | null;
  tokensBefore: number | null;
  tokensAfter: number | null;
  /** Rewrites applied, sticky and new. */
  decisionCount: number;
  /** Rewrites first made by this request. */
  newDecisionCount: number;
  durationMs: number;
  createdAt: Date;
}
