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
 * A daily quota stops the run cleanly: the result says where it stopped and
 * when it can resume. Content is never logged.
 */

export type TaskOutcome = {
  taskId: string;
  startStep: number;
  endStep: number;
  /** The model's final answer to the task, if it gave one. */
  finalText: string | null;
  /** The task hit maxStepsPerTask. */
  stepLimitHit: boolean;
};

export type RunStop =
  | { reason: 'completed' }
  | {
      reason: 'quota';
      message: string;
      resumeAt: string | null;
      taskId: string;
    }
  | { reason: 'error'; message: string; name: string; taskId: string };

export type RunResult = {
  sessionId: string;
  steps: number;
  usage: Usage;
  toolCalls: number;
  tasks: TaskOutcome[];
  stop: RunStop;
  wallTimeMs: number;
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
  /** Progress, without content (for the CLI). */
  onStep?: (info: {
    step: number;
    taskId: string;
    toolCalls: string[];
  }) => void;
};

export function newSessionId(agentName: string): string {
  return `demo-${agentName}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

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
  const sessionId = options.sessionId ?? newSessionId(options.agentName);
  const maxSteps = options.maxStepsPerTask ?? 15;
  const tools = new Map(options.tools.map((t) => [t.definition.name, t]));
  const definitions = options.tools.map((t) => t.definition);
  const history: ChatMessage[] = [
    { role: 'system', content: options.systemPrompt },
  ];
  const usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  };
  const outcomes: TaskOutcome[] = [];
  let step = 0;
  let toolCalls = 0;
  let stop: RunStop = { reason: 'completed' };

  outer: for (const [i, task] of options.tasks.entries()) {
    history.push({ role: 'user', content: task.prompt });
    const outcome: TaskOutcome = {
      taskId: task.id,
      startStep: step + 1,
      endStep: step,
      finalText: null,
      stepLimitHit: false,
    };
    outcomes.push(outcome);
    for (let taskStep = 0; ; taskStep++) {
      if (taskStep >= maxSteps) {
        outcome.stepLimitHit = true;
        break;
      }
      step += 1;
      outcome.endStep = step;
      let turn;
      try {
        turn = await options.model.complete({
          messages: await options.strategy.build(history),
          tools: definitions,
          sessionId,
        });
      } catch (error) {
        step -= 1;
        outcome.endStep = step;
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
        break outer;
      }
      if (turn.usage) {
        usage.inputTokens += turn.usage.inputTokens;
        usage.outputTokens += turn.usage.outputTokens;
        usage.cachedInputTokens += turn.usage.cachedInputTokens;
      }
      history.push({
        role: 'assistant',
        content: turn.text,
        toolCalls: turn.toolCalls,
        ...(turn.raw && { raw: turn.raw }),
      });
      options.onStep?.({
        step,
        taskId: task.id,
        toolCalls: turn.toolCalls.map((c) => c.name),
      });
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
  }

  return {
    sessionId,
    steps: step,
    usage,
    toolCalls,
    tasks: outcomes,
    stop,
    wallTimeMs: Date.now() - started,
  };
}
