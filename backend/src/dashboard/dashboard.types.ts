import { CanonicalContent } from '../context/context-items';
import { GcMode } from '../gc/gc-config';
import { CompressionKeySource } from '../projects/domain/project';

/** Tokens and dollars the GC removed (or would have, in shadow mode). */
export type Savings = { tokensSaved: number; dollarsSaved: number };

export type SavingsSummary = {
  from: string;
  to: string;
  /** The project's current GC mode. */
  mode: GcMode;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  upstreamCalls: number;
  gc: {
    runs: number;
    /** Context tokens the GC looked at, and what was left after it. */
    tokensBefore: number;
    tokensAfter: number;
    /** (tokensBefore - tokensAfter) / tokensBefore, 0 to 1. */
    reduction: number;
    /** Saved by requests forwarded after GC (on mode). */
    applied: Savings;
    /** What shadow mode would have saved (estimates). */
    estimated: Savings;
  };
  /** State blocks: summaries made, tokens they removed, and their cost. */
  compression: { summaries: number; tokensSaved: number; costUsd: number };
  /** Applied dollars saved minus what the summaries cost. */
  netDollarsSaved: number;
  recalls: { count: number; found: number; tokensRestored: number };
  decisionsByReason: {
    duplicate: number;
    superseded: number;
    stale_large: number;
  };
};

export type DailySavings = {
  /** YYYY-MM-DD (UTC). */
  date: string;
  requests: number;
  costUsd: number;
  /** What summaries cost that day (not in costUsd). */
  compressionCostUsd: number;
  tokensBefore: number;
  tokensAfter: number;
  applied: Savings;
  estimated: Savings;
};

export type SessionRow = {
  id: string;
  externalId: string;
  idSource: string;
  provider: string;
  model: string;
  firstSeenAt: string;
  lastSeenAt: string;
  requestCount: number;
  tokensSaved: number;
  decisions: number;
  recalls: number;
};

export type Paged<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
};

export type TimelineRequest = {
  id: string;
  createdAt: string;
  model: string;
  status: number;
  streamed: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  costUsd: number | null;
  upstreamCalls: number;
  gc: {
    mode: string;
    ran: boolean;
    applied: boolean;
    failed: boolean;
    tokensBefore: number | null;
    tokensAfter: number | null;
    decisionCount: number;
    newDecisionCount: number;
  } | null;
};

export type TimelineDecision = {
  position: number;
  toolName: string;
  toolCallId: string | null;
  decision: string;
  reason: string;
  detail: string;
  tokensBefore: number;
  tokensAfter: number;
  /** The stub Parsim sent instead (Parsim's text, not content). */
  replacement: string;
  archiveId: string | null;
  createdAt: string;
  /** The original tool result, only when the project stores content. */
  content?: CanonicalContent | null;
};

export type TimelineCompression = {
  id: string;
  status: string;
  firstTurn: number;
  lastTurn: number;
  tokensBefore: number;
  tokensAfter: number | null;
  /** What the summary cost. */
  costUsd: number | null;
  error: string | null;
  createdAt: string;
  readyAt: string | null;
  /** The state block, only when the project stores content. */
  stateBlock?: string | null;
};

export type SessionDetail = {
  session: Omit<SessionRow, 'tokensSaved' | 'decisions' | 'recalls'>;
  /** Whether content may be shown (the project's storeContent setting). */
  contentAllowed: boolean;
  requests: TimelineRequest[];
  decisions: TimelineDecision[];
  recalls: {
    archiveId: string;
    found: boolean;
    refused: boolean;
    tokensRestored: number;
    createdAt: string;
  }[];
  compressions: TimelineCompression[];
};

export type ThresholdSetting = {
  /** The project's own value, or null to use the default. */
  value: number | null;
  /** The server default (.env). */
  default: number;
};

export type ProjectSettings = {
  gcMode: GcMode;
  storeContent: boolean | null;
  storeContentDefault: boolean;
  thresholds: {
    gcMinContextTokens: ThresholdSetting;
    gcBatchTokens: ThresholdSetting;
    gcProtectedTurns: ThresholdSetting;
    gcArchiveMinTokens: ThresholdSetting;
    gcArchiveAfterTurns: ThresholdSetting;
  };
  sideEffectTools: {
    project: string[];
    server: string[];
    patterns: string[];
  };
  recallMaxPerRequest: number;
  compression: {
    enabled: boolean;
    keySource: CompressionKeySource;
    model: string | null;
    /** COMPRESSION_MIN_TOKENS. */
    minTokens: number;
    /** Whether PARSIM_INTERNAL_MODEL and its key are set. */
    internalModelConfigured: boolean;
  };
};
