import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { agentTools, systemPrompt } from '../src/agent/agents.js';
import {
  BudgetTracker,
  dailyQuotaFit,
  estimateArm,
  estimateBench,
  type EstimateInput,
} from '../src/bench/budget.js';
import { ScriptedUpstream } from '../src/bench/fake-upstream.js';
import { InvalidVerdictError, parseVerdict } from '../src/bench/judge.js';
import {
  diffSideEffects,
  latencyOverhead,
  mean,
  percentile,
  reduction,
  significance,
  stdev,
} from '../src/bench/metrics.js';
import {
  cacheAdjustedCost,
  DRY_RUN_PRICE,
  netCost,
  priceOf,
  rawCost,
  UnknownPriceError,
} from '../src/bench/prices.js';
import { ProgressStore, type BenchProgress } from '../src/bench/progress.js';
import {
  DEV_RUN_BANNER,
  renderJson,
  renderMarkdown,
  renderSvg,
  reportFiles,
  summarizeArms,
  headline,
} from '../src/bench/report.js';
import { runBench } from '../src/bench/run-bench.js';
import {
  SummarizeStrategy,
  TruncateStrategy,
} from '../src/bench/strategies.js';
import type {
  ArmRunResult,
  BenchConfig,
  BenchResults,
} from '../src/bench/types.js';
import type { ProviderConfig } from '../src/config.js';
import { createModel } from '../src/llm/models.js';
import { RateLimitedError } from '../src/llm/rate-limit.js';
import type {
  ChatMessage,
  ChatModel,
  CompletionRequest,
  ModelTurn,
} from '../src/llm/types.js';
import { loadSupportTasks } from '../src/tasks/load.js';
import {
  SideEffectLog,
  type SideEffectEntry,
} from '../src/tools/side-effect-log.js';

const usage = (
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
) => ({
  inputTokens,
  outputTokens,
  cachedInputTokens,
});
const price = { input: 1, cachedInput: 0.1, output: 2 };

describe('metrics', () => {
  it('should compute mean, sample standard deviation and nearest-rank percentiles', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(stdev([5])).toBe(0);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([], 50)).toBe(0);
    expect(reduction(200, 50)).toBe(0.75);
    expect(reduction(0, 5)).toBe(0);
  });

  it('should only call a difference significant when it is larger than the run-to-run spread', () => {
    expect(significance([0.9], [0.5])).toBe('single run');
    expect(significance([0.8, 0.9, 0.85], [0.82, 0.88, 0.9])).toBe(
      'not significant',
    );
    expect(significance([0.5, 0.52, 0.51], [0.9, 0.91, 0.89])).toBe(
      'significant',
    );
  });

  it('should report latency overhead at p50 and p95 against the full arm', () => {
    expect(latencyOverhead([110, 120, 130, 400], [100, 100, 110, 300])).toEqual(
      {
        p50: 20,
        p95: 100,
      },
    );
  });

  describe('side-effect safety', () => {
    const e = (
      tool: string,
      args: Record<string, unknown>,
      taskId = 'T01',
    ): SideEffectEntry => ({
      tool,
      args,
      step: 1,
      taskId,
    });
    const full = [
      e('update_ticket', { ticket_id: 'T01', status: 'credited' }),
      e('send_reply', {
        ticket_id: 'T01',
        message: 'Your credit is 4.50 EUR.',
      }),
      e('update_ticket', { ticket_id: 'T02', status: 'refunded' }, 'T02'),
      e('save_report', { question_id: 'q01', answer: '70%' }, 'q01'),
    ];

    it('should find nothing when only the reply wording differs', () => {
      const arm = full.map((x) =>
        x.tool === 'send_reply'
          ? e('send_reply', {
              ticket_id: 'T01',
              message: 'We credited 4.50 EUR.',
            })
          : x,
      );
      expect(diffSideEffects(full, arm)).toEqual([]);
      expect(
        diffSideEffects(full, [
          ...full.slice(0, 3),
          e('save_report', { question_id: 'q01', answer: '70 %' }, 'q01'),
        ]),
      ).toEqual([]);
    });

    it('should flag missing, duplicated, changed and extra calls', () => {
      const arm = [
        e('update_ticket', { ticket_id: 'T01', status: 'credited' }),
        e('update_ticket', { ticket_id: 'T01', status: 'credited' }),
        e(
          'update_ticket',
          { ticket_id: 'T02', status: 'investigating' },
          'T02',
        ),
        e('save_report', { question_id: 'q01', answer: '71%' }, 'q01'),
        e('send_reply', { ticket_id: 'T09', message: 'Hi' }, 'T09'),
      ];
      expect(diffSideEffects(full, arm)).toEqual([
        { kind: 'duplicated', tool: 'update_ticket', target: 't01' },
        { kind: 'missing', tool: 'send_reply', target: 't01' },
        {
          kind: 'changed',
          tool: 'update_ticket',
          target: 't02',
          expected: 'refunded',
          actual: 'investigating',
        },
        {
          kind: 'changed',
          tool: 'save_report',
          target: 'q01',
          expected: '70',
          actual: '71',
        },
        { kind: 'extra', tool: 'send_reply', target: 't09' },
      ]);
    });
  });
});

describe('costs', () => {
  it('should price raw, cache-adjusted and net cost', () => {
    const agent = usage(1_000_000, 100_000, 400_000);
    expect(rawCost(agent, price)).toBeCloseTo(1 + 0.2, 10);
    // 600k uncached at $1 + 400k cached at $0.10 + output.
    expect(cacheAdjustedCost(agent, price)).toBeCloseTo(0.6 + 0.04 + 0.2, 10);
    expect(
      netCost({
        agentUsage: agent,
        parsimUsage: null,
        internalUsage: usage(200_000, 50_000),
        compressionCostUsd: 0.01,
        modelPrice: price,
        internalPrice: { input: 0.5, output: 1 },
      }),
    ).toBeCloseTo(1.2 + 0.1 + 0.05 + 0.01, 10);
  });

  it("should count Parsim's recall follow-ups the agent never saw in net cost", () => {
    const agent = usage(100_000, 1000);
    const parsim = usage(130_000, 1500);
    const base = {
      internalUsage: usage(0, 0),
      compressionCostUsd: 0,
      modelPrice: price,
      internalPrice: price,
    };
    expect(
      netCost({ ...base, agentUsage: agent, parsimUsage: parsim }),
    ).toBeCloseTo(rawCost(parsim, price), 10);
    expect(
      netCost({ ...base, agentUsage: parsim, parsimUsage: agent }),
    ).toBeCloseTo(rawCost(parsim, price), 10);
  });

  it('should refuse a model without a price', () => {
    expect(() => priceOf({}, 'mystery-model')).toThrow(UnknownPriceError);
  });
});

describe('baseline strategies', () => {
  const turn = (i: number): ChatMessage[] => [
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: `c${i}`, name: 'lookup_order', arguments: {} }],
    },
    {
      role: 'tool',
      toolCallId: `c${i}`,
      name: 'lookup_order',
      content: `result ${i}`,
    },
  ];
  const history: ChatMessage[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'first goal' },
    ...Array.from({ length: 10 }, (_, i) => turn(i)).flat(),
  ];

  it('should keep the system prompt, the first goal and the last N turns when truncating', async () => {
    const kept = await new TruncateStrategy(3).build(history);
    expect(kept.slice(0, 2)).toEqual(history.slice(0, 2));
    expect(kept.slice(2)).toEqual(history.slice(-6));
    // Every tool result still follows its call.
    expect(kept[2]).toMatchObject({ role: 'assistant' });
    expect(await new TruncateStrategy(20).build(history)).toEqual(history);
  });

  it('should summarize the older turns, reuse the summary, and refresh it every M turns', async () => {
    const requests: CompletionRequest[] = [];
    const model: ChatModel = {
      provider: 'groq',
      model: 'summarizer',
      complete: (request) => {
        requests.push(request);
        return Promise.resolve({
          text: `summary ${requests.length}`,
          toolCalls: [],
          usage: usage(500, 50),
        });
      },
    };
    const strategy = new SummarizeStrategy(3, 2, model, 's1');
    const first = await strategy.build(history);
    expect(first.slice(0, 2)).toEqual(history.slice(0, 2));
    expect(first[2]).toEqual({
      role: 'user',
      content: '[Summary of the earlier conversation]\nsummary 1',
    });
    expect(first.slice(3)).toEqual(history.slice(-6));
    expect(requests[0]!.messages[1]!.content).toContain('result 0');
    expect(requests[0]!.messages[1]!.content).not.toContain('result 9');

    // One more turn: reused. Two more: refreshed.
    await strategy.build([...history, ...turn(10)]);
    expect(requests).toHaveLength(1);
    const refreshed = await strategy.build([
      ...history,
      ...turn(10),
      ...turn(11),
    ]);
    expect(requests).toHaveLength(2);
    expect(refreshed[2]!.content).toContain('summary 2');
    expect(strategy.usage).toEqual(usage(1000, 100));
    expect(strategy.summaryCalls).toBe(2);
  });
});

describe('budget guard', () => {
  const tasks = loadSupportTasks().tasks.slice(0, 10);
  const input: EstimateInput = {
    arms: ['full', 'truncate', 'summarize', 'parsim-shadow', 'parsim-on'],
    runs: 1,
    tasks,
    systemPrompt: systemPrompt('support'),
    tools: agentTools('support', 'replay', new SideEffectLog()).map(
      (t) => t.definition,
    ),
    avgToolResultChars: 800,
    truncateTurns: 6,
    summaryEvery: 6,
    modelPrice: price,
    internalPrice: price,
  };

  it('should estimate less for the capped baselines than for full context, and scale with runs', () => {
    const full = estimateArm('full', input);
    const truncate = estimateArm('truncate', input);
    const summarize = estimateArm('summarize', input);
    expect(full.requests).toBe(40);
    expect(truncate.inputTokens).toBeLessThan(full.inputTokens);
    expect(summarize.requests).toBeGreaterThan(truncate.requests);
    expect(estimateArm('parsim-on', input).inputTokens).toBe(full.inputTokens);
    expect(estimateArm('full', { ...input, runs: 3 }).inputTokens).toBe(
      full.inputTokens * 3,
    );
    const bench = estimateBench(input);
    expect(bench.total.costUsd).toBeCloseTo(
      bench.arms.reduce((s, a) => s + a.costUsd, 0),
      10,
    );
  });

  it('should tell whether a free-tier run fits the daily quota', () => {
    const total = { requests: 400, inputTokens: 500_000, outputTokens: 20_000 };
    expect(dailyQuotaFit(total, { tokens: 200_000, requests: 1000 })).toEqual({
      fits: false,
      days: 3,
      limitedBy: 'tokens',
    });
    expect(dailyQuotaFit(total, { requests: 300 })).toEqual({
      fits: false,
      days: 2,
      limitedBy: 'requests',
    });
    expect(dailyQuotaFit(total, { tokens: 1_000_000 })).toEqual({
      fits: true,
      days: 1,
      limitedBy: null,
    });
  });

  it('should say when spending passes the budget', () => {
    const tracker = new BudgetTracker(0.01);
    tracker.add(0.005);
    expect(tracker.exceeded()).toBeNull();
    tracker.add(0.006);
    expect(tracker.exceeded()).toMatch(/past the budget of \$0\.01/);
    expect(new BudgetTracker(null).exceeded()).toBeNull();
  });
});

describe('judge', () => {
  it('should parse the verdict, with or without a code fence', () => {
    expect(parseVerdict('{"passed": true, "reason": "ok"}')).toEqual({
      passed: true,
      reason: 'ok',
    });
    expect(parseVerdict('```json\n{"passed": false}\n```')).toEqual({
      passed: false,
      reason: '',
    });
    expect(() => parseVerdict('yes')).toThrow(InvalidVerdictError);
    expect(() => parseVerdict('{"passed": "yes"}')).toThrow(
      InvalidVerdictError,
    );
  });
});

describe('runBench', () => {
  const fake = new ScriptedUpstream();
  let fakeUrl = '';
  let dir: string;
  const tasks = loadSupportTasks().tasks.slice(0, 4);

  beforeAll(async () => {
    fakeUrl = await fake.start();
  });
  afterAll(async () => {
    await fake.stop();
  });
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'parsim-bench-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const modelConfig = (): ProviderConfig => ({
    provider: 'openai',
    model: 'scripted-agent',
    apiKey: 'dry-run',
    baseUrl: `${fakeUrl}/v1`,
    headers: {},
    maxOutputTokens: 256,
    temperature: 0,
    freeTier: false,
    route: 'direct',
  });

  const config = (overrides: Partial<BenchConfig> = {}): BenchConfig => ({
    agent: 'support',
    provider: 'dry-run',
    model: 'scripted-agent',
    internalModel: 'scripted-agent',
    runs: 1,
    arms: ['full', 'truncate'],
    taskCount: tasks.length,
    truncateTurns: 6,
    summaryEvery: 6,
    dryRun: true,
    freeTier: false,
    judge: false,
    command: 'npm run bench -- --dry-run',
    parsimVersion: 'backend 1.2.0',
    gitCommit: 'abc1234',
    startedAt: '2026-10-17T12:00:00.000Z',
    prices: { model: DRY_RUN_PRICE, internal: DRY_RUN_PRICE, note: 'test' },
    ...overrides,
  });

  const deps = (
    progress: BenchProgress,
    model: (arm: string) => ChatModel,
    budget = new BudgetTracker(null),
  ) => ({
    tasks,
    systemPrompt: systemPrompt('support'),
    agentName: 'support',
    tools: (log: Parameters<typeof agentTools>[2]) =>
      agentTools('support', 'replay', log),
    model,
    internalModel: createModel(modelConfig()),
    modelPrice: DRY_RUN_PRICE,
    internalPrice: DRY_RUN_PRICE,
    parsim: null,
    progress,
    store: new ProgressStore(dir),
    budget,
    judge: false,
    maxStepsPerTask: 10,
    log: () => undefined,
  });

  const newProgress = (
    overrides: Partial<BenchConfig> = {},
  ): BenchProgress => ({
    id: 'test',
    config: config(overrides),
    parsimKeys: {},
    parsimProjects: {},
    units: [],
  });

  it('should run every arm and score the tasks', async () => {
    const progress = newProgress();
    const { results, complete } = await runBench(
      deps(progress, () => createModel(modelConfig())),
    );
    expect(complete).toBe(true);
    expect(
      results.results.map((r) => [
        r.arm,
        r.tasks.length,
        r.tasks.every((t) => t.passed),
      ]),
    ).toEqual([
      ['full', 4, true],
      ['truncate', 4, true],
    ]);
    expect(results.results[0]!.costs.rawUsd).toBeGreaterThan(
      results.results[1]!.costs.rawUsd,
    );
  });

  it('should stop cleanly when spending passes the budget, keeping finished tasks', async () => {
    const progress = newProgress({ arms: ['full'] });
    const { results, complete } = await runBench(
      deps(
        progress,
        () => createModel(modelConfig()),
        new BudgetTracker(0.002),
      ),
    );
    expect(complete).toBe(false);
    expect(results.results).toEqual([]);
    const unit = progress.units[0]!;
    expect(unit.status).toBe('partial');
    expect(unit.checkpoint!.nextTaskIndex).toBeGreaterThan(0);
    expect(unit.checkpoint!.nextTaskIndex).toBeLessThan(tasks.length);
    expect(await new ProgressStore(dir).load('test')).toMatchObject({
      units: [{ status: 'partial' }],
    });
  });

  it('should resume a stopped run without repeating finished tasks', async () => {
    const progress = newProgress({ arms: ['full'] });
    const real = createModel(modelConfig());
    const seen: CompletionRequest[] = [];
    let calls = 0;
    // A daily quota after two tickets (8 calls).
    const quotaAfterTwo: ChatModel = {
      provider: 'openai',
      model: 'scripted-agent',
      complete: (request): Promise<ModelTurn> => {
        calls += 1;
        if (calls > 8) {
          return Promise.reject(
            new RateLimitedError({ retryAfterMs: 3_600_000, daily: true }),
          );
        }
        return real.complete(request);
      },
    };
    const first = await runBench(deps(progress, () => quotaAfterTwo));
    expect(first.complete).toBe(false);
    expect(progress.units[0]!.checkpoint!.nextTaskIndex).toBe(2);
    expect(progress.units[0]!.sideEffects.map((e) => e.taskId)).toEqual([
      'T01',
      'T01',
      'T02',
      'T02',
    ]);

    const resumed = await runBench(
      deps(progress, () => ({
        provider: 'openai',
        model: 'scripted-agent',
        complete: (request: CompletionRequest) => {
          seen.push(request);
          return real.complete(request);
        },
      })),
    );
    expect(resumed.complete).toBe(true);
    // Only T03 and T04 were run again: 2 tickets x 4 steps.
    expect(seen).toHaveLength(8);
    const result = resumed.results.results[0]!;
    expect(result.tasks.map((t) => [t.taskId, t.passed])).toEqual([
      ['T01', true],
      ['T02', true],
      ['T03', true],
      ['T04', true],
    ]);
    expect(
      result.sideEffects.filter((e) => e.tool === 'update_ticket'),
    ).toHaveLength(4);
  });
});

describe('report', () => {
  const taskResult = (taskId: string, type: string, passed: boolean) => ({
    taskId,
    type,
    passed,
    reason: passed ? 'match' : 'no match',
    judge: null,
    usage: usage(1000, 50),
    steps: 4,
    recalls: 0,
    recallHits: 0,
  });
  const arm = (
    name: ArmRunResult['arm'],
    passed: boolean[],
    cost: number,
    latency: number,
    sideEffects: SideEffectEntry[] = [],
  ): ArmRunResult => ({
    arm: name,
    run: 1,
    sessionId: `s-${name}`,
    stop: { reason: 'completed' },
    tasks: passed.map((p, i) =>
      taskResult(`T0${i + 1}`, i === 2 ? 'cross_ticket' : 'normal', p),
    ),
    usage: usage(Math.round(cost * 1_000_000), 600, 100),
    internalUsage: usage(0, 0),
    internalCalls: 0,
    parsim: null,
    stepRecords: [
      {
        step: 1,
        taskId: 'T01',
        usage: null,
        latencyMs: latency,
        startedAt: '2026-10-17T12:00:00.000Z',
        toolCalls: [],
      },
      {
        step: 2,
        taskId: 'T01',
        usage: null,
        latencyMs: latency * 2,
        startedAt: '2026-10-17T12:00:01.000Z',
        toolCalls: [],
      },
    ],
    sideEffects,
    wallTimeMs: 12_000,
    costs: { rawUsd: cost, netUsd: cost * 1.1, cacheAdjustedUsd: cost * 0.9 },
  });
  const status = (ticket: string, value: string): SideEffectEntry => ({
    tool: 'update_ticket',
    args: { ticket_id: ticket, status: value },
    step: 2,
    taskId: ticket,
  });
  const bench = (freeTier: boolean): BenchResults => ({
    config: {
      agent: 'support',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      internalModel: 'openai/gpt-oss-120b',
      runs: 1,
      arms: ['full', 'truncate', 'summarize', 'parsim-shadow', 'parsim-on'],
      taskCount: 3,
      truncateTurns: 6,
      summaryEvery: 6,
      dryRun: false,
      freeTier,
      judge: false,
      command:
        'npm run bench -- --agent support --runs 1 --provider groq --tasks 3',
      parsimVersion: 'backend 1.2.0',
      gitCommit: 'abc1234',
      startedAt: '2026-10-17T12:00:00.000Z',
      prices: {
        model: { input: 0.15, cachedInput: 0.075, output: 0.6 },
        internal: { input: 0.15, cachedInput: 0.075, output: 0.6 },
        note: 'Free tier: the run cost nothing; costs are at the list price, so arms can be compared.',
      },
    },
    results: [
      arm('full', [true, true, true], 0.04, 400, [
        status('T01', 'credited'),
        status('T02', 'refunded'),
      ]),
      arm('truncate', [true, true, false], 0.015, 380, [
        status('T01', 'credited'),
      ]),
      arm('summarize', [true, true, false], 0.02, 390, [
        status('T01', 'credited'),
        status('T02', 'refunded'),
      ]),
      arm('parsim-shadow', [true, true, true], 0.04, 420, [
        status('T01', 'credited'),
        status('T02', 'refunded'),
      ]),
      arm('parsim-on', [true, true, true], 0.025, 430, [
        status('T01', 'credited'),
        status('T02', 'investigating'),
      ]),
    ],
    finishedAt: '2026-10-17T12:30:00.000Z',
  });

  it('should write the headline in the agreed form', () => {
    expect(headline(summarizeArms(bench(true)))).toBe(
      'Parsim on: 37.5% lower net cost, success 100.0% vs 100.0% for full context. Truncation: 62.5% lower net cost, success 66.7%.',
    );
  });

  it('should render the markdown, JSON and chart from a fixed result set', async () => {
    const results = bench(true);
    const summaries = summarizeArms(results);
    const files = reportFiles(results);
    expect(files.markdown).toBe(
      '2026-10-17-support-groq-openai-gpt-oss-120b.md',
    );
    await expect(renderMarkdown(results, summaries, files)).toMatchFileSnapshot(
      '__snapshots__/report.md',
    );
    await expect(renderJson(results, summaries)).toMatchFileSnapshot(
      '__snapshots__/report.json',
    );
    await expect(renderSvg(summaries)).toMatchFileSnapshot(
      '__snapshots__/report.svg',
    );
  });

  it('should mark free-tier runs as development runs, and only those', () => {
    const md = (freeTier: boolean) => {
      const results = bench(freeTier);
      return renderMarkdown(
        results,
        summarizeArms(results),
        reportFiles(results),
      );
    };
    expect(md(true)).toContain(DEV_RUN_BANNER);
    expect(md(true)).toContain('Development run, not for publishing');
    expect(md(false)).not.toContain('Development run');
  });

  it('should list side-effect differences against the full arm', () => {
    const summaries = summarizeArms(bench(true));
    expect(summaries.find((s) => s.arm === 'truncate')!.sideEffects).toEqual({
      missing: 1,
      duplicated: 0,
      changed: 0,
      extra: 0,
    });
    expect(summaries.find((s) => s.arm === 'parsim-on')!.issues).toEqual([
      {
        kind: 'changed',
        tool: 'update_ticket',
        target: 't02',
        expected: 'refunded',
        actual: 'investigating',
        run: 1,
      },
    ]);
  });
});
