/** One tool call of an answer, with its arguments parsed from JSON. */
export type ReplayToolCall = { name: string; arguments: unknown };

/** What a model answered, reduced to what replay compares. */
export type ReplayAnswer = {
  text: string;
  toolCalls: ReplayToolCall[];
};

/** One version of a request point (original or GC'd), as replayed. */
export type ReplayVariant = {
  /** Null when the call failed. */
  answer: ReplayAnswer | null;
  /** Upstream status of the last call. */
  status: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Whether temperature 0 was sent (some models reject it). */
  temperatureZero: boolean;
  /** Upstream calls, including parsim_recall follow-ups. */
  upstreamCalls: number;
  /** parsim_recall calls Parsim answered. */
  recalls: number;
  /** Short reason when the call failed (never content). */
  error: string | null;
};

export const REPLAY_RESULT_STATUSES = ['completed', 'failed'] as const;
export type ReplayResultStatus = (typeof REPLAY_RESULT_STATUSES)[number];

/** The comparison of one request point's two answers. */
export class ReplayResult {
  id: string;
  replayId: string;
  requestNumber: number;
  status: ReplayResultStatus;
  /** Whether the GC had changed this request (false: both sent the same context). */
  gcChanged: boolean;
  original: ReplayVariant | null;
  gc: ReplayVariant | null;
  /** Same text and same tool calls. */
  exactMatch: boolean | null;
  /** Same tool calls with the same arguments (true when neither has any). */
  toolCallsMatch: boolean | null;
  /** 1 (different) to 5 (equivalent); null when not judged. */
  judgeScore: number | null;
  judgeReason: string | null;
  judgeCostUsd: number;
  /** The verdict counted in the agreement rate. */
  agreed: boolean | null;
  /** Short reason when failed (never content). */
  error: string | null;
  createdAt: Date;
}
