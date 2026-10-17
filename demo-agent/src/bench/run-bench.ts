import {
  FullContext,
  type ContextStrategy,
} from '../agent/context-strategy.js';
import { newSessionId, runAgent, type RunResult } from '../agent/runner.js';
import type {
  ChatModel,
  CompletionRequest,
  ModelTurn,
  Usage,
} from '../llm/types.js';
import { checkTask } from '../tasks/check.js';
import type { Task } from '../tasks/schema.js';
import { SideEffectLog } from '../tools/side-effect-log.js';
import type { Tool } from '../tools/types.js';
import type { BudgetTracker } from './budget.js';
import { judgeTask } from './judge.js';
import type { ParsimClient, SessionView } from './parsim-client.js';
import { cacheAdjustedCost, netCost, rawCost, type Price } from './prices.js';
import { unitFor, type BenchProgress, type ProgressStore } from './progress.js';
import { SummarizeStrategy, TruncateStrategy } from './strategies.js';
import {
  PARSIM_ARMS,
  type Arm,
  type ArmRunResult,
  type BenchResults,
  type TaskResult,
} from './types.js';

/**
 * Runs the benchmark: every arm, every run, over the same tasks, with tools
 * replaying recordings. After every task the unit's state is saved, so
 * --resume continues where a quota (or the budget) stopped it.
 */

export type BenchDeps = {
  tasks: Task[];
  systemPrompt: string;
  agentName: string;
  /** Fresh tools for an arm run, writing side effects to `log`. */
  tools: (log: SideEffectLog) => Tool[];
  /** The agent's model for an arm (through Parsim with `parsimKey`). */
  model: (arm: Arm, parsimKey?: string) => ChatModel;
  /** Parsim's internal model: summaries of the summarize arm, and the judge. */
  internalModel: ChatModel;
  modelPrice: Price;
  internalPrice: Price;
  parsim: ParsimClient | null;
  progress: BenchProgress;
  store: ProgressStore;
  budget: BudgetTracker;
  judge: boolean;
  maxStepsPerTask: number;
  log: (line: string) => void;
};

const zero = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
});

function addUsage(target: Usage, usage: Usage | null) {
  if (!usage) return;
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cachedInputTokens += usage.cachedInputTokens;
}

/** Adds the cost of every call to the budget. */
class MeteredModel implements ChatModel {
  readonly provider;
  readonly model;

  constructor(
    private readonly inner: ChatModel,
    private readonly price: Price,
    private readonly budget: BudgetTracker,
  ) {
    this.provider = inner.provider;
    this.model = inner.model;
  }

  async complete(request: CompletionRequest): Promise<ModelTurn> {
    const turn = await this.inner.complete(request);
    if (turn.usage) this.budget.add(rawCost(turn.usage, this.price));
    return turn;
  }
}

/** Facts a task needs: what a recalled original should contain to help. */
export function neededFacts(task: Task): string[] {
  return 'replyMustInclude' in task.expected
    ? task.expected.replyMustInclude
    : [task.expected.answer];
}

/** Recalls during each task, and how many brought back a needed fact. */
export function recallsByTask(
  view: SessionView | null,
  run: RunResult,
  tasks: Task[],
): Map<string, { recalls: number; hits: number | null }> {
  const out = new Map<string, { recalls: number; hits: number | null }>();
  for (const outcome of run.tasks) {
    const task = tasks.find((t) => t.id === outcome.taskId)!;
    const from = Date.parse(outcome.startedAt);
    const to = Date.parse(outcome.endedAt) + 1000;
    const recalls = (view?.recalls ?? []).filter((r) => {
      const at = Date.parse(r.createdAt);
      return at >= from && at <= to;
    });
    let hits: number | null = 0;
    for (const recall of recalls) {
      const original = view?.archived.get(recall.archiveId);
      if (original === undefined) {
        hits = null;
        break;
      }
      if (recall.found && neededFacts(task).some((f) => original.includes(f))) {
        hits += 1;
      }
    }
    out.set(outcome.taskId, { recalls: recalls.length, hits });
  }
  return out;
}

async function runUnit(
  deps: BenchDeps,
  arm: Arm,
  run: number,
): Promise<ArmRunResult | null> {
  const { progress } = deps;
  const unit = unitFor(progress, arm, run);
  const log = new SideEffectLog();
  log.entries.push(...unit.sideEffects);
  const sessionId =
    unit.checkpoint?.sessionId ?? newSessionId(`${deps.agentName}-${arm}`);
  const internal = new MeteredModel(
    deps.internalModel,
    deps.internalPrice,
    deps.budget,
  );
  let summarize: SummarizeStrategy | null = null;
  let strategy: ContextStrategy = new FullContext();
  const settings = progress.config;
  if (arm === 'truncate')
    strategy = new TruncateStrategy(settings.truncateTurns);
  if (arm === 'summarize') {
    summarize = new SummarizeStrategy(
      settings.truncateTurns,
      settings.summaryEvery,
      internal,
      sessionId,
    );
    strategy = summarize;
  }
  const isParsim = PARSIM_ARMS.includes(arm);
  const key = isParsim ? progress.parsimKeys[arm] : undefined;
  if (isParsim && !key) throw new Error(`No Parsim key for the ${arm} arm`);
  const model = new MeteredModel(
    deps.model(arm, key),
    deps.modelPrice,
    deps.budget,
  );
  const internalSoFar = { ...unit.internal };

  deps.log(
    `${arm} run ${run}: ${unit.checkpoint ? `resuming at task ${unit.checkpoint.nextTaskIndex + 1}` : 'starting'}`,
  );
  const result = await runAgent({
    agentName: deps.agentName,
    systemPrompt: deps.systemPrompt,
    tasks: deps.tasks,
    tools: deps.tools(log),
    model,
    strategy,
    sessionId,
    maxStepsPerTask: deps.maxStepsPerTask,
    resumeFrom: unit.checkpoint ?? undefined,
    shouldStop: () => deps.budget.exceeded(),
    onTaskDone: async (checkpoint) => {
      const done = new Set(checkpoint.tasks.map((t) => t.taskId));
      unit.checkpoint = checkpoint;
      unit.sideEffects = log.entries.filter((e) => done.has(e.taskId));
      if (summarize) {
        unit.internal = {
          inputTokens: internalSoFar.inputTokens + summarize.usage.inputTokens,
          outputTokens:
            internalSoFar.outputTokens + summarize.usage.outputTokens,
          cachedInputTokens:
            internalSoFar.cachedInputTokens + summarize.usage.cachedInputTokens,
          calls: internalSoFar.calls + summarize.summaryCalls,
        };
      }
      await deps.store.save(progress);
      deps.log(
        `  ${arm} run ${run}: ${checkpoint.tasks.at(-1)?.taskId} done (step ${checkpoint.steps})`,
      );
    },
  });

  if (result.stop.reason !== 'completed') {
    await deps.store.save(progress);
    deps.log(
      `${arm} run ${run} stopped at ${'taskId' in result.stop ? result.stop.taskId : '?'}: ${'message' in result.stop ? result.stop.message : ''}`,
    );
    return null;
  }

  // Parsim's own record of the session: recalls and what it sent upstream.
  const projectId = isParsim ? progress.parsimProjects[arm] : undefined;
  const view =
    deps.parsim && projectId
      ? await deps.parsim.session(projectId, result.sessionId)
      : null;
  const recalls = recallsByTask(view, result, deps.tasks);

  const tasks: TaskResult[] = [];
  for (const outcome of result.tasks) {
    const task = deps.tasks.find((t) => t.id === outcome.taskId)!;
    const check = checkTask(task, log.entries);
    const usage = zero();
    for (const record of result.stepRecords.filter(
      (r) => r.taskId === task.id,
    )) {
      addUsage(usage, record.usage);
    }
    let judge: TaskResult['judge'] = null;
    if (deps.judge) {
      const judged = await judgeTask(
        internal,
        task,
        log.forTask(task.id),
        outcome.finalText,
        `${sessionId}-judge`,
      );
      judge = judged.verdict;
    }
    const recall = recalls.get(task.id) ?? { recalls: 0, hits: 0 };
    tasks.push({
      taskId: task.id,
      type: task.type,
      passed: check.passed,
      reason: check.reason,
      judge,
      usage,
      steps: outcome.endStep - outcome.startStep + 1,
      recalls: recall.recalls,
      recallHits: recall.hits,
    });
  }

  const internalUsage: Usage = {
    inputTokens: unit.internal.inputTokens,
    outputTokens: unit.internal.outputTokens,
    cachedInputTokens: unit.internal.cachedInputTokens,
  };
  const raw = rawCost(result.usage, deps.modelPrice);
  const armResult: ArmRunResult = {
    arm,
    run,
    sessionId: result.sessionId,
    stop: result.stop,
    tasks,
    usage: result.usage,
    internalUsage,
    internalCalls: unit.internal.calls,
    parsim: view?.stats ?? null,
    stepRecords: result.stepRecords,
    sideEffects: log.entries,
    wallTimeMs: result.wallTimeMs,
    costs: {
      rawUsd: raw,
      cacheAdjustedUsd: cacheAdjustedCost(result.usage, deps.modelPrice),
      netUsd: netCost({
        agentUsage: result.usage,
        parsimUsage: view?.stats.usage ?? null,
        internalUsage,
        compressionCostUsd: view?.stats.compressionCostUsd ?? 0,
        modelPrice: deps.modelPrice,
        internalPrice: deps.internalPrice,
      }),
    },
  };
  unit.status = 'done';
  unit.result = armResult;
  await deps.store.save(progress);
  return armResult;
}

/** Runs what is left of the bench. `complete` is false if it stopped early. */
export async function runBench(
  deps: BenchDeps,
): Promise<{ results: BenchResults; complete: boolean }> {
  const { progress } = deps;
  let complete = true;
  outer: for (let run = 1; run <= progress.config.runs; run++) {
    for (const arm of progress.config.arms) {
      const unit = unitFor(progress, arm, run);
      if (unit.status === 'done') continue;
      const result = await runUnit(deps, arm, run);
      if (!result) {
        complete = false;
        break outer;
      }
    }
  }
  const results = progress.units
    .filter((u) => u.status === 'done' && u.result)
    .map((u) => u.result!)
    .sort(
      (a, b) =>
        a.run - b.run ||
        progress.config.arms.indexOf(a.arm) -
          progress.config.arms.indexOf(b.arm),
    );
  return {
    results: {
      config: progress.config,
      results,
      finishedAt: complete ? new Date().toISOString() : null,
    },
    complete,
  };
}
