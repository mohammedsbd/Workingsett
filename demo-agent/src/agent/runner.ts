import { randomUUID } from 'node:crypto';
import { QuotaExhaustedError } from '../llm/rate-limit.js';
import type { ChatMessage, ChatModel, ToolCall, Usage } from '../llm/types.js';
import type { Task } from '../tasks/schema.js';
import type { Tool } from '../tools/types.js';
import type { ContextStrategy } from './context-strategy.js';

/**
 * The agent loop. One run works through tasks in order, in one
 * conversation, so later tasks depend on what earlier ones read:
 *
 * 1. The task's prompt is added as a user message.
 * 2. Each step is one model call (with the history the context strategy
 *    builds). Tool calls are run and their results added; the task ends
 *    when the model answers without tool calls.
 * 3. A task may take at most `maxStepsPerTask` steps.
 *
 * After every task the run's state is handed to `onTaskDone`, so a run
 * stopped by a quota can resume from there (`resumeFrom`) without
 * repeating finished tasks. A daily quota, or `shouldStop` (the budget),
 * stops the run cleanly. Content is never logged.
 */

export type TaskOutcome = {
  taskId: string;
  startStep: number;
  endStep: number;
  startedAt: string;
  endedAt: string;
  /** The model's final answer to the task, if it gave one. */
  finalText: string | null;
  /** The task hit maxStepsPerTask. */
  stepLimitHit: boolean;
};

export type StepRecord = {
  step: number;
  taskId: string;
  usage: Usage | null;
  latencyMs: number;
  startedAt: string;
  toolCalls: string[];
};

export type RunStop =
  | { reason: 'completed' }
  | {
      reason: 'quota';
      message: string;
      resumeAt: string | null;
      taskId: string;
    }
  | { reason: 'budget'; message: string; taskId: string }
  | { reason: 'error'; message: string; name: string; taskId: string };

/** Everything needed to continue a run after its last finished task. */
export type RunCheckpoint = {
  sessionId: string;
  history: ChatMessage[];
  /** Index of the next task to run. */
  nextTaskIndex: number;
  steps: number;
  toolCalls: number;
  usage: Usage;
  tasks: TaskOutcome[];
  stepRecords: StepRecord[];
  wallTimeMs: number;
};

export type RunResult = Omit<RunCheckpoint, 'history' | 'nextTaskIndex'> & {
  stop: RunStop;
};

export type RunOptions = {
  agentName: string;
  systemPrompt: string;
  tasks: Task[];
  tools: Tool[];
  model: ChatModel;
  strategy: ContextStrategy;
  /** Defaults to a new unique id: every task run is its own Parsim session. */
  sessionId?: string;
  maxStepsPerTask?: number;
  /** Continue a stopped run from its last checkpoint. */
  resumeFrom?: RunCheckpoint;
  /** Called after every finished task (save it to resume later). */
  onTaskDone?: (checkpoint: RunCheckpoint) => Promise<void> | void;
  /** Checked before every step: a message stops the run (budget). */
  shouldStop?: () => string | null;
  /** Progress, without content (for the CLI). */
  onStep?: (record: StepRecord) => void;
};

export function newSessionId(agentName: string): string {
  return `demo-${agentName}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
});

async function runTool(
  call: ToolCall,
  tools: Map<string, Tool>,
  context: { taskId: string; taskIndex: number; step: number },
): Promise<string> {
  const tool = tools.get(call.name);
  if (!tool) return `Error: there is no tool named ${call.name}.`;
  return tool.run(call.arguments, context);
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const resumed = options.resumeFrom;
  const sessionId =
    resumed?.sessionId ?? options.sessionId ?? newSessionId(options.agentName);
  const maxSteps = options.maxStepsPerTask ?? 15;
  const tools = new Map(options.tools.map((t) => [t.definition.name, t]));
  const definitions = options.tools.map((t) => t.definition);
  const history: ChatMessage[] = resumed
    ? [...resumed.history]
    : [{ role: 'system', content: options.systemPrompt }];
  const usage: Usage = resumed ? { ...resumed.usage } : emptyUsage();
  const outcomes: TaskOutcome[] = resumed ? [...resumed.tasks] : [];
  const stepRecords: StepRecord[] = resumed ? [...resumed.stepRecords] : [];
  const priorWallTime = resumed?.wallTimeMs ?? 0;
  let step = resumed?.steps ?? 0;
  let toolCalls = resumed?.toolCalls ?? 0;
  let stop: RunStop = { reason: 'completed' };
  const elapsed = () => priorWallTime + (Date.now() - started);

  const firstTask = resumed?.nextTaskIndex ?? 0;
  outer: for (let i = firstTask; i < options.tasks.length; i++) {
    const task = options.tasks[i]!;
    // Restored if the task is cut short, so a resume redoes it from its start.
    const atTaskStart = {
      step,
      toolCalls,
      history: history.length,
      records: stepRecords.length,
    };
    const rollBack = () => {
      step = atTaskStart.step;
      toolCalls = atTaskStart.toolCalls;
      history.length = atTaskStart.history;
      stepRecords.length = atTaskStart.records;
      outcomes.pop();
    };
    history.push({ role: 'user', content: task.prompt });
    const outcome: TaskOutcome = {
      taskId: task.id,
      startStep: step + 1,
      endStep: step,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      finalText: null,
      stepLimitHit: false,
    };
    outcomes.push(outcome);
    for (let taskStep = 0; ; taskStep++) {
      if (taskStep >= maxSteps) {
        outcome.stepLimitHit = true;
        break;
      }
      const stopMessage = options.shouldStop?.();
      if (stopMessage) {
        stop = { reason: 'budget', message: stopMessage, taskId: task.id };
        rollBack();
        break outer;
      }
      step += 1;
      const stepStarted = Date.now();
      let turn;
      try {
        turn = await options.model.complete({
          messages: await options.strategy.build(history),
          tools: definitions,
          sessionId,
        });
      } catch (error) {
        stop =
          error instanceof QuotaExhaustedError
            ? {
                reason: 'quota',
                message: error.message,
                resumeAt: error.resumeAt?.toISOString() ?? null,
                taskId: task.id,
              }
            : {
                reason: 'error',
                message: (error as Error).message,
                name: (error as Error).name,
                taskId: task.id,
              };
        // Tokens already spent stay in `usage`; the task itself is redone.
        rollBack();
        break outer;
      }
      if (turn.usage) {
        usage.inputTokens += turn.usage.inputTokens;
        usage.outputTokens += turn.usage.outputTokens;
        usage.cachedInputTokens += turn.usage.cachedInputTokens;
      }
      const record: StepRecord = {
        step,
        taskId: task.id,
        usage: turn.usage,
        latencyMs: Date.now() - stepStarted,
        startedAt: new Date(stepStarted).toISOString(),
        toolCalls: turn.toolCalls.map((c) => c.name),
      };
      stepRecords.push(record);
      outcome.endStep = step;
      outcome.endedAt = new Date().toISOString();
      history.push({
        role: 'assistant',
        content: turn.text,
        toolCalls: turn.toolCalls,
        ...(turn.raw && { raw: turn.raw }),
      });
      options.onStep?.(record);
      if (!turn.toolCalls.length) {
        outcome.finalText = turn.text;
        break;
      }
      for (const call of turn.toolCalls) {
        toolCalls += 1;
        const content = await runTool(call, tools, {
          taskId: task.id,
          taskIndex: i + 1,
          step,
        });
        history.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content,
        });
      }
    }
    await options.onTaskDone?.({
      sessionId,
      history: [...history],
      nextTaskIndex: i + 1,
      steps: step,
      toolCalls,
      usage: { ...usage },
      tasks: [...outcomes],
      stepRecords: [...stepRecords],
      wallTimeMs: elapsed(),
    });
  }

  return {
    sessionId,
    steps: step,
    usage,
    toolCalls,
    tasks: outcomes,
    stepRecords,
    stop,
    wallTimeMs: elapsed(),
  };
}
