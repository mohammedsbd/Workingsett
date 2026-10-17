/** Response shapes of the Parsim backend's dashboard API. */

export type GcMode = 'off' | 'shadow' | 'on';

export type Project = {
  id: string;
  name: string;
  upstream: 'openai' | 'gemini' | 'anthropic' | 'openai-compatible';
  /** Base URL of an openai-compatible upstream (for example Groq); null otherwise. */
  upstreamBaseUrl: string | null;
  gcMode: GcMode;
  storeContent: boolean | null;
  hasProviderKey: boolean;
  gcMinContextTokens: number | null;
  gcBatchTokens: number | null;
  gcProtectedTurns: number | null;
  gcArchiveMinTokens: number | null;
  gcArchiveAfterTurns: number | null;
  gcSideEffectTools: string[];
  compressionEnabled: boolean;
  compressionKeySource: CompressionKeySource;
  compressionModel: string | null;
  replayJudgeKeySource: CompressionKeySource;
  replayJudgeModel: string | null;
  createdAt: string;
};

export type CompressionKeySource = 'parsim' | 'project';

export type Savings = { tokensSaved: number; dollarsSaved: number };

export type SavingsSummary = {
  from: string;
  to: string;
  mode: GcMode;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  upstreamCalls: number;
  gc: {
    runs: number;
    tokensBefore: number;
    tokensAfter: number;
    reduction: number;
    applied: Savings;
    estimated: Savings;
  };
  /** State blocks: summaries made, tokens they removed, and their cost. */
  compression: { summaries: number; tokensSaved: number; costUsd: number };
  /** Applied dollars saved minus what the summaries cost. */
  netDollarsSaved: number;
  recalls: { count: number; found: number; tokensRestored: number };
  decisionsByReason: { duplicate: number; superseded: number; stale_large: number };
};

export type DailySavings = {
  date: string;
  requests: number;
  costUsd: number;
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

export type Paged<T> = { data: T[]; total: number; page: number; limit: number };

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

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: unknown }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; isError: boolean; content: ContentPart[] }
  | { type: 'thinking'; text: string }
  | { type: 'other'; value: unknown };

export type TimelineDecision = {
  position: number;
  toolName: string;
  toolCallId: string | null;
  decision: 'drop' | 'archive';
  reason: 'duplicate' | 'superseded' | 'stale_large';
  detail: string;
  tokensBefore: number;
  tokensAfter: number;
  replacement: string;
  archiveId: string | null;
  createdAt: string;
  content?: { kind: string; parts: ContentPart[] } | null;
};

export type TimelineCompression = {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  firstTurn: number;
  lastTurn: number;
  tokensBefore: number;
  tokensAfter: number | null;
  costUsd: number | null;
  error: string | null;
  createdAt: string;
  readyAt: string | null;
  /** Only when the project stores content. */
  stateBlock?: string | null;
};

export type SessionDetail = {
  session: Omit<SessionRow, 'tokensSaved' | 'decisions' | 'recalls'>;
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

export type ThresholdKey =
  | 'gcMinContextTokens'
  | 'gcBatchTokens'
  | 'gcProtectedTurns'
  | 'gcArchiveMinTokens'
  | 'gcArchiveAfterTurns';

export type ProjectSettings = {
  gcMode: GcMode;
  storeContent: boolean | null;
  storeContentDefault: boolean;
  thresholds: Record<ThresholdKey, { value: number | null; default: number }>;
  sideEffectTools: { project: string[]; server: string[]; patterns: string[] };
  recallMaxPerRequest: number;
  compression: {
    enabled: boolean;
    keySource: CompressionKeySource;
    model: string | null;
    minTokens: number;
    internalModelConfigured: boolean;
  };
  replay: {
    judgeKeySource: CompressionKeySource;
    judgeModel: string | null;
    /** The judge model on Parsim's key. */
    internalJudgeModel: string;
    internalModelConfigured: boolean;
    defaultBudgetUsd: number;
    maxBudgetUsd: number;
  };
};

export type ApiKey = {
  id: string;
  projectId: string;
  name: string | null;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/** Returned once, when a key is created. */
export type CreatedApiKey = ApiKey & { key: string };

export type ReplayStatus = 'queued' | 'running' | 'completed' | 'budget_exceeded' | 'failed';

export type ReplayJudge = { keySource: CompressionKeySource; provider: string; model: string };

export type ReplayCandidate = {
  requestNumber: number;
  gcChanged: boolean;
  model: string;
  createdAt: string;
};

export type ReplayOptions = {
  /** Null when the session can be replayed; otherwise why not. */
  blockedReason: string | null;
  candidates: ReplayCandidate[];
  defaultRequestNumbers: number[];
  defaultBudgetUsd: number;
  maxBudgetUsd: number;
  maxPoints: number;
  judge: ReplayJudge;
};

export type ReplayPointEstimate = {
  requestNumber: number;
  model: string;
  originalInputTokens: number;
  gcInputTokens: number;
  outputTokens: number;
  originalUsd: number;
  gcUsd: number;
  judgeUsd: number;
};

export type ReplayEstimate = {
  requestNumbers: number[];
  budgetUsd: number;
  models: string[];
  judge: ReplayJudge;
  points: ReplayPointEstimate[];
  totalUsd: number;
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

export type ReplayAnswer = {
  text: string;
  toolCalls: { name: string; arguments: unknown }[];
};

export type ReplayVariant = {
  status: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  temperatureZero: boolean;
  upstreamCalls: number;
  recalls: number;
  error: string | null;
  /** Only when the project stores content. */
  answer?: ReplayAnswer | null;
};

export type ReplayPoint = {
  requestNumber: number;
  status: 'completed' | 'failed';
  gcChanged: boolean;
  exactMatch: boolean | null;
  toolCallsMatch: boolean | null;
  judgeScore: number | null;
  judgeReason?: string | null;
  judgeCostUsd: number;
  agreed: boolean | null;
  error: string | null;
  original: ReplayVariant | null;
  gc: ReplayVariant | null;
};

export type ReplayTotals = { inputTokens: number; outputTokens: number; costUsd: number };

export type ReplayReport = {
  replay: ReplaySummary;
  contentAllowed: boolean;
  agreement: {
    judged: number;
    agreed: number;
    rate: number | null;
    exactMatches: number;
    toolCallMatches: number;
    failed: number;
  };
  totals: { original: ReplayTotals; gc: ReplayTotals; judgeCostUsd: number };
  points: ReplayPoint[];
};
