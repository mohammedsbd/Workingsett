import { CompressionKeySource } from '../projects/domain/project';
import { ReplayStatus } from '../replays/domain/replay';
import { ReplayAnswer } from '../replay-results/domain/replay-result';
import { PointEstimate } from './cost';

/** A recorded request that can be replayed. */
export type ReplayCandidate = {
  requestNumber: number;
  /** Whether the GC changed this request (points worth replaying). */
  gcChanged: boolean;
  model: string;
  createdAt: string;
};

/** What the session page needs before starting a replay. */
export type ReplayOptions = {
  /** Null when the session can be replayed; otherwise why not. */
  blockedReason: string | null;
  candidates: ReplayCandidate[];
  /** The points chosen when none are given. */
  defaultRequestNumbers: number[];
  defaultBudgetUsd: number;
  maxBudgetUsd: number;
  maxPoints: number;
  judge: { keySource: CompressionKeySource; provider: string; model: string };
};

export type ReplayEstimateView = {
  requestNumbers: number[];
  budgetUsd: number;
  /** Replay calls use this model (the recorded one, per point). */
  models: string[];
  judge: { keySource: CompressionKeySource; provider: string; model: string };
  points: PointEstimate[];
  totalUsd: number;
  /** Whether the estimate is above the budget (the replay will stop early). */
  overBudget: boolean;
};

export type ReplaySummary = {
  id: string;
  status: ReplayStatus;
  requestNumbers: number[];
  pointsTotal: number;
  pointsDone: number;
  budgetUsd: number;
  estimatedCostUsd: number;
  spentUsd: number;
  judgeKeySource: CompressionKeySource;
  judgeProvider: string;
  judgeModel: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type VariantView = {
  status: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  temperatureZero: boolean;
  upstreamCalls: number;
  recalls: number;
  error: string | null;
  /** The answer, only when the project stores content. */
  answer?: ReplayAnswer | null;
};

export type ReplayPointView = {
  requestNumber: number;
  status: string;
  gcChanged: boolean;
  exactMatch: boolean | null;
  toolCallsMatch: boolean | null;
  judgeScore: number | null;
  /** Only when the project stores content (it may quote the answers). */
  judgeReason?: string | null;
  judgeCostUsd: number;
  agreed: boolean | null;
  error: string | null;
  original: VariantView | null;
  gc: VariantView | null;
};

export type VersionTotals = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type ReplayReport = {
  replay: ReplaySummary;
  contentAllowed: boolean;
  agreement: {
    /** Points with a verdict. */
    judged: number;
    agreed: number;
    /** agreed / judged, null before any verdict. */
    rate: number | null;
    exactMatches: number;
    toolCallMatches: number;
    failed: number;
  };
  totals: {
    original: VersionTotals;
    gc: VersionTotals;
    judgeCostUsd: number;
  };
  points: ReplayPointView[];
};
