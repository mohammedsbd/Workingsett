import type { StepRecord, RunStop } from '../agent/runner.js';
import type { Usage } from '../llm/types.js';
import type { AgentName } from '../tasks/schema.js';
import type { SideEffectEntry } from '../tools/side-effect-log.js';

/** The five benchmark arms. */
export const ARMS = [
  'full',
  'truncate',
  'summarize',
  'parsim-shadow',
  'parsim-on',
] as const;
export type Arm = (typeof ARMS)[number];

export const PARSIM_ARMS: readonly Arm[] = ['parsim-shadow', 'parsim-on'];

/** One task of one arm in one run. */
export type TaskResult = {
  taskId: string;
  type: string;
  passed: boolean;
  reason: string;
  /** The LLM judge's verdict, with --judge. */
  judge: { passed: boolean; reason: string } | null;
  usage: Usage;
  steps: number;
  recalls: number;
  /** Recalls whose original held a fact the task needed (null: unknown). */
  recallHits: number | null;
};

/** Parsim's own view of a run (parsim arms), from its dashboard API. */
export type ParsimRunStats = {
  /** What Parsim recorded upstream, including recall follow-up calls. */
  usage: Usage;
  upstreamCalls: number;
  recalls: number;
  /** Cost of compression summaries Parsim ran for this session (USD). */
  compressionCostUsd: number;
  gcTokensSaved: number;
};

/** One arm in one run (one conversation over the tasks). */
export type ArmRunResult = {
  arm: Arm;
  run: number;
  sessionId: string;
  stop: RunStop;
  tasks: TaskResult[];
  usage: Usage;
  /** Internal model calls of the arm itself (the summarize baseline). */
  internalUsage: Usage;
  internalCalls: number;
  parsim: ParsimRunStats | null;
  stepRecords: StepRecord[];
  sideEffects: SideEffectEntry[];
  wallTimeMs: number;
  costs: { rawUsd: number; netUsd: number; cacheAdjustedUsd: number };
};

export type BenchConfig = {
  agent: AgentName;
  provider: string;
  model: string;
  internalModel: string;
  runs: number;
  arms: Arm[];
  /** How many of the agent's tasks were run (from the start). */
  taskCount: number;
  truncateTurns: number;
  summaryEvery: number;
  dryRun: boolean;
  freeTier: boolean;
  judge: boolean;
  command: string;
  parsimVersion: string;
  gitCommit: string;
  startedAt: string;
  prices: {
    model: { input: number; cachedInput?: number; output: number };
    internal: { input: number; cachedInput?: number; output: number };
    note: string;
  };
};

export type BenchResults = {
  config: BenchConfig;
  results: ArmRunResult[];
  finishedAt: string | null;
};
