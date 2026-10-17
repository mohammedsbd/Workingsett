import { estimateRequestTokens, estimateTokens } from '../llm/context-guard.js';
import type { ToolDefinition } from '../llm/types.js';
import type { Task } from '../tasks/schema.js';
import { rawCost, type Price } from './prices.js';
import type { Arm } from './types.js';

/**
 * The budget guard: an estimate before a run, and a running total during
 * it that stops the run once spending passes --budget.
 *
 * The estimate replays each task's planned steps: every step sends the
 * system prompt, tool definitions and the context so far, then adds a tool
 * result of average size. Truncate and summarize cap the context at the
 * last N turns (summarize also pays for its summaries). Parsim arms are
 * estimated like full context: an upper bound for parsim-on.
 */

export type ArmEstimate = {
  arm: Arm;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type EstimateInput = {
  arms: Arm[];
  runs: number;
  tasks: Task[];
  systemPrompt: string;
  tools: ToolDefinition[];
  /** Average tool result size of this agent, in characters. */
  avgToolResultChars: number;
  truncateTurns: number;
  summaryEvery: number;
  modelPrice: Price;
  internalPrice: Price;
  /** Output tokens assumed per step. */
  outputPerStep?: number;
};

export function estimateArm(arm: Arm, input: EstimateInput): ArmEstimate {
  const outputPerStep = input.outputPerStep ?? 150;
  const base = estimateRequestTokens(
    [{ role: 'system', content: input.systemPrompt }],
    input.tools,
  );
  const perStep = estimateTokens('x'.repeat(input.avgToolResultChars)) + 60;
  const capped = arm === 'truncate' || arm === 'summarize';
  let requests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let internalInput = 0;
  let internalOutput = 0;
  let context = 0;
  let turns = 0;
  let sinceSummary = 0;
  for (const task of input.tasks) {
    context += estimateTokens(task.prompt);
    for (let s = 0; s < task.plannedSteps; s++) {
      const visible = capped
        ? Math.min(context, input.truncateTurns * perStep) +
          (arm === 'summarize' && turns > input.truncateTurns ? 300 : 0)
        : context;
      requests += 1;
      inputTokens += base + visible;
      outputTokens += outputPerStep;
      context += perStep;
      turns += 1;
      if (arm === 'summarize' && turns > input.truncateTurns) {
        sinceSummary += 1;
        if (sinceSummary >= input.summaryEvery) {
          sinceSummary = 0;
          requests += 1;
          internalInput += context - input.truncateTurns * perStep;
          internalOutput += 400;
        }
      }
    }
  }
  const scale = input.runs;
  const usage = (i: number, o: number) => ({
    inputTokens: i,
    outputTokens: o,
    cachedInputTokens: 0,
  });
  return {
    arm,
    requests: requests * scale,
    inputTokens: (inputTokens + internalInput) * scale,
    outputTokens: (outputTokens + internalOutput) * scale,
    costUsd:
      (rawCost(usage(inputTokens, outputTokens), input.modelPrice) +
        rawCost(usage(internalInput, internalOutput), input.internalPrice)) *
      scale,
  };
}

export function estimateBench(input: EstimateInput) {
  const arms = input.arms.map((arm) => estimateArm(arm, input));
  return {
    arms,
    total: arms.reduce(
      (sum, a) => ({
        requests: sum.requests + a.requests,
        inputTokens: sum.inputTokens + a.inputTokens,
        outputTokens: sum.outputTokens + a.outputTokens,
        costUsd: sum.costUsd + a.costUsd,
      }),
      { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    ),
  };
}

export type DailyQuota = { tokens?: number; requests?: number };

/**
 * Whether a free-tier run fits the provider's daily quota, and if not,
 * about how many days it needs (resume each day with --resume).
 */
export function dailyQuotaFit(
  total: { requests: number; inputTokens: number; outputTokens: number },
  quota: DailyQuota,
): { fits: boolean; days: number; limitedBy: 'tokens' | 'requests' | null } {
  const tokenDays = quota.tokens
    ? (total.inputTokens + total.outputTokens) / quota.tokens
    : 0;
  const requestDays = quota.requests ? total.requests / quota.requests : 0;
  const days = Math.max(tokenDays, requestDays);
  if (days <= 1) return { fits: true, days: 1, limitedBy: null };
  return {
    fits: false,
    days: Math.ceil(days),
    limitedBy: tokenDays >= requestDays ? 'tokens' : 'requests',
  };
}

/** Spending so far; `exceeded` gives the stop message once past the budget. */
export class BudgetTracker {
  spentUsd = 0;

  constructor(readonly budgetUsd: number | null) {}

  add(usd: number) {
    this.spentUsd += usd;
  }

  exceeded(): string | null {
    if (this.budgetUsd === null || this.spentUsd <= this.budgetUsd) return null;
    return `Spending reached $${this.spentUsd.toFixed(4)}, past the budget of $${this.budgetUsd.toFixed(2)}. Partial results were written.`;
  }
}
