import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentTools, systemPrompt } from '../src/agent/agents.js';
import {
  FullContext,
  type ContextStrategy,
} from '../src/agent/context-strategy.js';
import { runAgent } from '../src/agent/runner.js';
import { ContextTooLargeError } from '../src/llm/context-guard.js';
import { GuardedModel } from '../src/llm/models.js';
import { RateLimitedError } from '../src/llm/rate-limit.js';
import type {
  ChatMessage,
  ChatModel,
  CompletionRequest,
  ModelTurn,
} from '../src/llm/types.js';
import { checkTask } from '../src/tasks/check.js';
import { loadSupportTasks } from '../src/tasks/load.js';
import {
  parseSideEffectLog,
  SideEffectLog,
} from '../src/tools/side-effect-log.js';
import { SupportWorld } from '../src/world/support-world.js';

/** A model that answers from a script, recording what it was sent. */
class ScriptedModel implements ChatModel {
  readonly provider = 'groq' as const;
  readonly model = 'scripted';
  readonly requests: CompletionRequest[] = [];

  constructor(
    private readonly script: (
      request: CompletionRequest,
      call: number,
    ) => ModelTurn | Error,
  ) {}

  complete(request: CompletionRequest): Promise<ModelTurn> {
    this.requests.push(request);
    const turn = this.script(request, this.requests.length);
    return turn instanceof Error ? Promise.reject(turn) : Promise.resolve(turn);
  }
}

const usage = { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 };
const call = (name: string, args: Record<string, unknown>, id: string) => ({
  id,
  name,
  arguments: args,
});

/** Handles a support ticket correctly under the policy, in 4 steps. */
function supportScript(world: SupportWorld) {
  return (request: CompletionRequest): ModelTurn => {
    const messages = request.messages;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')!;
    const ticket = /Ticket (T\d{2})/.exec(lastUser.content)![1]!;
    const orderId = /O-\d{4}/.exec(lastUser.content)?.[0] ?? 'O-2004';
    const order = world.order(orderId)!;
    const sinceUser = messages.slice(messages.lastIndexOf(lastUser) + 1);
    const done = sinceUser.filter((m) => m.role === 'tool').length;
    const status = {
      delayed: 'credited',
      damaged: 'replacement_sent',
      lost: 'refunded',
      delivered: 'investigating',
    }[order.status];
    const facts = {
      delayed: (order.total * 0.1).toFixed(2),
      damaged: order.id,
      lost: order.total.toFixed(2),
      delivered: order.trackingNumber,
    }[order.status];
    const steps: ModelTurn[] = [
      {
        text: '',
        toolCalls: [call('lookup_order', { order_id: orderId }, `${ticket}-1`)],
        usage,
      },
      {
        text: '',
        toolCalls: [
          call('update_ticket', { ticket_id: ticket, status }, `${ticket}-2`),
        ],
        usage,
      },
      {
        text: '',
        toolCalls: [
          call(
            'send_reply',
            { ticket_id: ticket, message: `Done: ${facts}` },
            `${ticket}-3`,
          ),
        ],
        usage,
      },
      { text: `Handled ${ticket}.`, toolCalls: [], usage },
    ];
    return steps[done]!;
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'parsim-run-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runAgent', () => {
  const tasks = loadSupportTasks().tasks.slice(0, 3);

  it('should work through tasks in order in one conversation, logging side effects with steps', async () => {
    const log = new SideEffectLog(path.join(dir, 'side-effects.jsonl'));
    const model = new ScriptedModel(supportScript(new SupportWorld()));
    const result = await runAgent({
      agentName: 'support',
      systemPrompt: systemPrompt('support'),
      tasks,
      tools: agentTools('support', 'replay', log),
      model,
      strategy: new FullContext(),
    });

    expect(result.stop).toEqual({ reason: 'completed' });
    expect(result.steps).toBe(12);
    expect(result.toolCalls).toBe(9);
    expect(result.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 120,
      cachedInputTokens: 0,
    });
    expect(result.tasks.map((t) => [t.taskId, t.startStep, t.endStep])).toEqual(
      [
        ['T01', 1, 4],
        ['T02', 5, 8],
        ['T03', 9, 12],
      ],
    );
    // One conversation: the last request still holds the first ticket.
    const last = model.requests.at(-1)!.messages;
    expect(last[0]).toMatchObject({ role: 'system' });
    expect(
      last.some((m) => m.role === 'user' && m.content.includes('T01')),
    ).toBe(true);
    // Every request of the run carries the same session id.
    expect(new Set(model.requests.map((r) => r.sessionId))).toEqual(
      new Set([result.sessionId]),
    );

    expect(log.entries.map((e) => [e.tool, e.taskId, e.step])).toEqual([
      ['update_ticket', 'T01', 2],
      ['send_reply', 'T01', 3],
      ['update_ticket', 'T02', 6],
      ['send_reply', 'T02', 7],
      ['update_ticket', 'T03', 10],
      ['send_reply', 'T03', 11],
    ]);
    const file = parseSideEffectLog(
      await readFile(path.join(dir, 'side-effects.jsonl'), 'utf8'),
    );
    expect(file).toEqual(log.entries);
    // T03 asks for a refund to a gift card the scripted reply leaves out.
    expect(tasks.map((t) => checkTask(t, log.entries).passed)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('should give every run its own session id', async () => {
    const run = () =>
      runAgent({
        agentName: 'support',
        systemPrompt: 's',
        tasks: tasks.slice(0, 1),
        tools: [],
        model: new ScriptedModel(() => ({ text: 'ok', toolCalls: [], usage })),
        strategy: new FullContext(),
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.sessionId).toMatch(/^demo-support-/);
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('should build every request through the context strategy', async () => {
    const seen: number[] = [];
    // Keeps the system prompt and the current task only.
    const strategy: ContextStrategy = {
      name: 'current-task',
      build: (history: readonly ChatMessage[]) => {
        seen.push(history.length);
        const lastUser = history.findLastIndex((m) => m.role === 'user');
        return Promise.resolve([history[0]!, ...history.slice(lastUser)]);
      },
    };
    const model = new ScriptedModel(supportScript(new SupportWorld()));
    await runAgent({
      agentName: 'support',
      systemPrompt: 's',
      tasks: tasks.slice(0, 2),
      tools: agentTools('support', 'replay', new SideEffectLog()),
      model,
      strategy,
    });
    expect(seen).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    const secondTask = model.requests.slice(4);
    expect(
      secondTask.every(
        (r) =>
          r.messages.length <= 8 &&
          !r.messages.some((m) => m.content.includes('T01')),
      ),
    ).toBe(true);
  });

  it('should stop a task at the step limit', async () => {
    const model = new ScriptedModel((_, n) => ({
      text: '',
      toolCalls: [call('lookup_order', { order_id: 'O-2001' }, `c${n}`)],
      usage,
    }));
    const result = await runAgent({
      agentName: 'support',
      systemPrompt: 's',
      tasks: tasks.slice(0, 2),
      tools: agentTools('support', 'replay', new SideEffectLog()),
      model,
      strategy: new FullContext(),
      maxStepsPerTask: 3,
    });
    expect(result.tasks.map((t) => t.stepLimitHit)).toEqual([true, true]);
    expect(result.steps).toBe(6);
  });

  it('should retry a per-minute 429 after Retry-After, then continue', async () => {
    const waits: number[] = [];
    let failed = false;
    const inner = new ScriptedModel(() => {
      if (!failed) {
        failed = true;
        return new RateLimitedError({ retryAfterMs: 1500, daily: false });
      }
      return { text: 'ok', toolCalls: [], usage };
    });
    const model = new GuardedModel(
      inner,
      { maxOutputTokens: 100 },
      {
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    );
    const result = await runAgent({
      agentName: 'support',
      systemPrompt: 's',
      tasks: tasks.slice(0, 1),
      tools: [],
      model,
      strategy: new FullContext(),
    });
    expect(result.stop).toEqual({ reason: 'completed' });
    expect(waits).toEqual([1500]);
    expect(inner.requests).toHaveLength(2);
  });

  it('should stop the run cleanly on a daily quota, keeping what was done and when it can resume', async () => {
    const log = new SideEffectLog();
    const world = new SupportWorld();
    const script = supportScript(world);
    const inner = new ScriptedModel((request, n) =>
      n <= 4
        ? script(request)
        : new RateLimitedError({ retryAfterMs: 3_600_000, daily: true }),
    );
    const model = new GuardedModel(inner, { maxOutputTokens: 100 });
    const result = await runAgent({
      agentName: 'support',
      systemPrompt: 's',
      tasks,
      tools: agentTools('support', 'replay', log),
      model,
      strategy: new FullContext(),
    });
    expect(result.stop).toMatchObject({
      reason: 'quota',
      taskId: 'T02',
      message: expect.stringMatching(/daily quota.*can resume after/),
    });
    expect(
      Date.parse((result.stop as { resumeAt: string }).resumeAt),
    ).toBeGreaterThan(Date.now() + 3_000_000);
    expect(result.steps).toBe(4);
    expect(log.entries).toHaveLength(2);
  });

  it('should stop before a request larger than the context window, without sending it', async () => {
    const inner = new ScriptedModel(() => ({
      text: 'ok',
      toolCalls: [],
      usage,
    }));
    const model = new GuardedModel(inner, {
      contextTokens: 300,
      maxOutputTokens: 100,
    });
    const result = await runAgent({
      agentName: 'support',
      systemPrompt: 'x'.repeat(2000),
      tasks: tasks.slice(0, 1),
      tools: [],
      model,
      strategy: new FullContext(),
    });
    expect(result.stop).toMatchObject({
      reason: 'error',
      name: 'ContextTooLargeError',
    });
    expect(inner.requests).toHaveLength(0);
    expect(new ContextTooLargeError(1, 2, 'x').message).toMatch(/too large/);
  });
});
