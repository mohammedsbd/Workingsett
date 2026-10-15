import type { CompressionKeySource } from '../../projects/domain/project';

export const REPLAY_STATUSES = [
  'queued',
  'running',
  'completed',
  'budget_exceeded',
  'failed',
] as const;
/**
 * queued: waiting for the worker. running: replaying request points.
 * completed: every point was replayed (some may have failed).
 * budget_exceeded: stopped because the next call could pass the budget.
 * failed: stopped by an error before finishing (see `error`).
 */
export type ReplayStatus = (typeof REPLAY_STATUSES)[number];

export type FinishedReplayStatus = Extract<
  ReplayStatus,
  'completed' | 'budget_exceeded' | 'failed'
>;

/**
 * One replay of a recorded agent session: for each chosen request point,
 * the request is sent upstream twice, as the client sent it and as the GC
 * made it, and the two answers are compared (see docs/replay.md).
 */
export class Replay {
  id: string;
  projectId: string;
  agentSessionId: string;
  status: ReplayStatus;
  /** The request points to replay, in order. */
  requestNumbers: number[];
  /** Hard limit: no call starts if it could take the spend above this. */
  budgetUsd: number;
  /** The estimate shown before starting. */
  estimatedCostUsd: number;
  /** What the replay has cost so far (both versions and the judge). */
  spentUsd: number;
  judgeKeySource: CompressionKeySource;
  judgeProvider: string;
  judgeModel: string;
  /** Request points finished (replayed or failed). */
  pointsDone: number;
  /** Short reason when failed or stopped (never content). */
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}
