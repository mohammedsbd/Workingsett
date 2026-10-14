/** Response shapes of the Parsim backend's dashboard API. */

export type GcMode = 'off' | 'shadow' | 'on';

export type Project = {
  id: string;
  name: string;
  upstream: 'openai' | 'gemini' | 'anthropic';
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
