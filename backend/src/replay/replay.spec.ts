import { archiveStub } from '../gc/gc-engine';
import { RecallResult } from '../recall/recall-format';
import { RecallRound } from '../recall/recall-limit';
import { RECALL_TOOL_NAME } from '../recall/recall-tool';
import { ProxyApi } from '../proxy/providers/provider-adapter';
import { extractAnswer } from './answer';
import { BudgetExceededError, ReplayBudget } from './budget';
import {
  agreed,
  agreementRate,
  compareAnswers,
  sameToolCalls,
} from './compare';
import {
  estimateReplay,
  JUDGE_OUTPUT_TOKENS,
  judgeInputTokens,
  spreadPoints,
  UnknownPriceError,
} from './cost';
import {
  InvalidJudgeResultError,
  judgePrompt,
  parseJudgeResult,
} from './judge';
import {
  forReplay,
  maxOutputTokens,
  rejectsTemperature,
} from './replay-request';
import { ReplayCall, ReplayPort, replayPoint } from './replay-runner';

const openAiReply = (
  content: string | null,
  toolCalls: { name: string; arguments: string }[] = [],
) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content,
        ...(toolCalls.length && {
          tool_calls: toolCalls.map((fn, i) => ({
            id: `call_${i}`,
            type: 'function',
            function: fn,
          })),
        }),
      },
      finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
});

describe('replay', () => {
  describe('answers', () => {
    it('should read text and tool calls from an OpenAI response', () => {
      const answer = extractAnswer(
        'openai-chat',
        openAiReply('Searching.', [
          { name: 'web_search', arguments: '{"q":"grid batteries"}' },
          { name: RECALL_TOOL_NAME, arguments: '{"archive_id":"arc_1"}' },
          { name: 'broken', arguments: '{not json' },
        ]),
      );
      expect(answer).toEqual({
        text: 'Searching.',
        toolCalls: [
          { name: 'web_search', arguments: { q: 'grid batteries' } },
          { name: 'broken', arguments: '{not json' },
        ],
      });
    });

    it('should read text and tool calls from an Anthropic response', () => {
      const answer = extractAnswer('anthropic-messages', {
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'Let me ' },
          { type: 'text', text: 'check.' },
          { type: 'tool_use', id: 't1', name: 'lookup', input: { id: 7 } },
        ],
      });
      expect(answer).toEqual({
        text: 'Let me check.',
        toolCalls: [{ name: 'lookup', arguments: { id: 7 } }],
      });
    });

    it('should read text and function calls from a Gemini response, without thoughts', () => {
      const answer = extractAnswer('gemini-native', {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'thinking...', thought: true },
                { text: 'Done.' },
                { functionCall: { name: 'save_note', args: { text: 'x' } } },
              ],
            },
          },
        ],
      });
      expect(answer).toEqual({
        text: 'Done.',
        toolCalls: [{ name: 'save_note', arguments: { text: 'x' } }],
      });
    });

    it('should give an empty answer for an unexpected body', () => {
      expect(extractAnswer('openai-chat', 'nope')).toEqual({
        text: '',
        toolCalls: [],
      });
    });
  });

  describe('comparison', () => {
    const call = (name: string, args: unknown) => ({ name, arguments: args });

    it('should treat tool calls as equal regardless of key and call order', () => {
      expect(
        sameToolCalls(
          [call('a', { x: 1, y: [1, 2] }), call('b', {})],
          [call('b', {}), call('a', { y: [1, 2], x: 1 })],
        ),
      ).toBe(true);
    });

    it('should tell apart different arguments, names and counts', () => {
      expect(sameToolCalls([call('a', { x: 1 })], [call('a', { x: 2 })])).toBe(
        false,
      );
      expect(sameToolCalls([call('a', {})], [call('b', {})])).toBe(false);
      expect(
        sameToolCalls([call('a', {}), call('a', {})], [call('a', {})]),
      ).toBe(false);
      expect(sameToolCalls([], [])).toBe(true);
    });

    it('should match exactly only with the same text and the same tool calls', () => {
      const a = { text: ' Hello. \n', toolCalls: [call('a', { x: 1 })] };
      expect(
        compareAnswers(a, { text: 'Hello.', toolCalls: [call('a', { x: 1 })] }),
      ).toEqual({ exactMatch: true, toolCallsMatch: true });
      expect(
        compareAnswers(a, { text: 'Hi.', toolCalls: [call('a', { x: 1 })] }),
      ).toEqual({ exactMatch: false, toolCallsMatch: true });
      expect(compareAnswers(a, { text: 'Hello.', toolCalls: [] })).toEqual({
        exactMatch: false,
        toolCallsMatch: false,
      });
    });

    it('should count identical answers as agreeing and leave the rest to the judge', () => {
      const exact = { exactMatch: true, toolCallsMatch: true };
      const differ = { exactMatch: false, toolCallsMatch: true };
      expect(agreed(exact, null, 4)).toBe(true);
      expect(agreed(differ, 4, 4)).toBe(true);
      expect(agreed(differ, 3, 4)).toBe(false);
      expect(agreed(differ, null, 4)).toBeNull();
    });

    it('should compute the agreement rate over points with a verdict', () => {
      expect(
        agreementRate([
          { agreed: true },
          { agreed: false },
          { agreed: true },
          { agreed: null },
        ]),
      ).toEqual({ judged: 3, agreed: 2, rate: 2 / 3 });
      expect(agreementRate([])).toEqual({ judged: 0, agreed: 0, rate: null });
    });
  });

  describe('judge results', () => {
    it.each([
      ['{"score": 4, "reason": "Same decision."}', 4, 'Same decision.'],
      ['```json\n{"score": 5, "reason": "Equal."}\n```', 5, 'Equal.'],
      [
        'Verdict: {"score": "2", "reason": " Missing a fact. "} done',
        2,
        'Missing a fact.',
      ],
      ['{"score": 1}', 1, ''],
    ])('should read %j', (text, score, reason) => {
      expect(parseJudgeResult(text)).toEqual({ score, reason });
    });

    it.each([
      ['no json here'],
      ['{"score": 4'],
      ['{"score": 0, "reason": "x"}'],
      ['{"score": 6}'],
      ['{"score": 3.5}'],
      ['{"reason": "no score"}'],
    ])('should reject %j', (text) => {
      expect(() => parseJudgeResult(text)).toThrow(InvalidJudgeResultError);
    });

    it('should cut a long reason', () => {
      const { reason } = parseJudgeResult(
        JSON.stringify({ score: 3, reason: 'x'.repeat(1000) }),
      );
      expect(reason).toHaveLength(300);
      expect(reason.endsWith('...')).toBe(true);
    });

    it('should show both answers and their tool calls to the judge', () => {
      const prompt = judgePrompt({
        context: 'Find the price.',
        original: { text: 'A text', toolCalls: [] },
        gc: { text: '', toolCalls: [{ name: 'search', arguments: { q: 1 } }] },
      });
      expect(prompt).toContain('Find the price.');
      expect(prompt).toContain('Answer A:\nA text');
      expect(prompt).toContain(
        'Answer B:\n(no text)\nTool calls:\n- search({"q":1})',
      );
    });
  });

  describe('budget', () => {
    it('should refuse a call that could pass the limit and allow one that fits exactly', () => {
      const budget = new ReplayBudget(0.3);
      budget.ensure(0.1);
      budget.add(0.1);
      budget.add(0.1);
      expect(() => budget.ensure(0.1)).not.toThrow();
      expect(() => budget.ensure(0.11)).toThrow(BudgetExceededError);
      expect(budget.spentUsd).toBeCloseTo(0.2);
    });

    it('should start from what was already spent', () => {
      const budget = new ReplayBudget(1, 0.95);
      expect(() => budget.ensure(0.1)).toThrow(BudgetExceededError);
    });
  });

  describe('cost estimate', () => {
    const per = (inPrice: number, outPrice: number) => (i: number, o: number) =>
      (i * inPrice + o * outPrice) / 1e6;

    it('should price both versions and a judge call per point', () => {
      const estimate = estimateReplay(
        [
          {
            requestNumber: 3,
            originalInputTokens: 10_000,
            gcInputTokens: 4_000,
            outputTokens: 200,
          },
          {
            requestNumber: 7,
            originalInputTokens: 20_000,
            gcInputTokens: 5_000,
            outputTokens: 100,
          },
        ],
        {
          replay: { model: 'm', price: per(2, 10) },
          judge: { model: 'j', price: per(1, 4) },
        },
      );
      const [first] = estimate.points;
      expect(first.originalUsd).toBeCloseTo((10_000 * 2 + 200 * 10) / 1e6);
      expect(first.gcUsd).toBeCloseTo((4_000 * 2 + 200 * 10) / 1e6);
      expect(first.judgeUsd).toBeCloseTo(
        (judgeInputTokens(200) * 1 + JUDGE_OUTPUT_TOKENS * 4) / 1e6,
      );
      const sum = estimate.points.reduce(
        (s, p) => s + p.originalUsd + p.gcUsd + p.judgeUsd,
        0,
      );
      expect(estimate.totalUsd).toBeCloseTo(sum, 6);
    });

    it('should refuse a model without a price', () => {
      expect(() =>
        estimateReplay(
          [
            {
              requestNumber: 1,
              originalInputTokens: 1,
              gcInputTokens: 1,
              outputTokens: 1,
            },
          ],
          {
            replay: { model: 'unknown-model', price: () => null },
            judge: { model: 'j', price: per(1, 1) },
          },
        ),
      ).toThrow(UnknownPriceError);
    });

    it('should spread points evenly and keep the last one', () => {
      expect(spreadPoints([1, 2, 3], 5)).toEqual([1, 2, 3]);
      expect(spreadPoints([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([
        1, 4, 7, 10,
      ]);
      expect(spreadPoints([4, 9, 12], 1)).toEqual([12]);
      expect(spreadPoints([4, 9], 0)).toEqual([]);
    });
  });

  describe('replay requests', () => {
    it('should turn streaming off and set temperature 0 (OpenAI)', () => {
      const body = {
        model: 'gpt-4o',
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.7,
        messages: [],
      };
      const prepared = forReplay('openai-chat', body, true);
      expect(prepared).toEqual({
        body: { model: 'gpt-4o', temperature: 0, messages: [] },
        temperatureZero: true,
      });
      expect(body.temperature).toBe(0.7);
      expect(forReplay('openai-chat', body, false).body.temperature).toBe(0.7);
    });

    it('should set the temperature in generationConfig for Gemini', () => {
      const prepared = forReplay(
        'gemini-native',
        { contents: [], generationConfig: { maxOutputTokens: 50 } },
        true,
      );
      expect(prepared.body.generationConfig).toEqual({
        maxOutputTokens: 50,
        temperature: 0,
      });
    });

    it('should keep the temperature with Anthropic extended thinking', () => {
      const prepared = forReplay(
        'anthropic-messages',
        {
          stream: true,
          thinking: { type: 'enabled', budget_tokens: 1024 },
          messages: [],
        },
        true,
      );
      expect(prepared.temperatureZero).toBe(false);
      expect(prepared.body).not.toHaveProperty('temperature');
      expect(prepared.body).not.toHaveProperty('stream');
    });

    it('should read the output limit per API', () => {
      expect(
        maxOutputTokens('openai-chat', {
          max_completion_tokens: 30,
          max_tokens: 9,
        }),
      ).toBe(30);
      expect(maxOutputTokens('openai-chat', { max_tokens: 9 })).toBe(9);
      expect(maxOutputTokens('anthropic-messages', { max_tokens: 1024 })).toBe(
        1024,
      );
      expect(
        maxOutputTokens('gemini-native', {
          generationConfig: { maxOutputTokens: 77 },
        }),
      ).toBe(77);
      expect(maxOutputTokens('openai-chat', {})).toBeNull();
    });

    it('should spot a rejected temperature', () => {
      const error = { error: { message: "Unsupported value: 'temperature'" } };
      expect(rejectsTemperature(400, error)).toBe(true);
      expect(rejectsTemperature(400, { error: { message: 'bad' } })).toBe(
        false,
      );
      expect(rejectsTemperature(500, error)).toBe(false);
    });
  });

  describe('replaying a point', () => {
    /** A fake upstream and judge: answers in order, records what was sent. */
    class FakePort implements ReplayPort {
      readonly api: ProxyApi = 'openai-chat';
      readonly recallMax = 3;
      readonly passScore = 4;
      readonly sent: Record<string, unknown>[] = [];
      readonly prompts: string[] = [];
      readonly rounds: RecallRound[] = [];
      constructor(
        private readonly replies: ReplayCall[],
        private readonly verdicts: string[] = [],
        readonly callCost = 0.01,
      ) {}
      send(body: Record<string, unknown>): Promise<ReplayCall> {
        this.sent.push(body);
        const reply = this.replies.shift();
        if (!reply) throw new Error('no reply queued');
        return Promise.resolve(reply);
      }
      maxCallCostUsd(): number {
        return this.callCost;
      }
      recall(round: RecallRound): Promise<RecallResult[]> {
        this.rounds.push(round);
        return Promise.resolve(
          round.fetch.map((call) => ({ call, text: 'the archived original' })),
        );
      }
      judge(prompt: string) {
        this.prompts.push(prompt);
        return Promise.resolve({
          text: this.verdicts.shift() ?? '',
          costUsd: 0.001,
        });
      }
      maxJudgeCostUsd(): number {
        return 0.002;
      }
    }

    const ok = (response: unknown, costUsd = 0.005): ReplayCall => ({
      status: 200,
      response,
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
      },
      costUsd,
    });

    const original = {
      model: 'gpt-4o',
      stream: true,
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Price of X?' },
      ],
    };
    const archiveId = 'arc_0123456789abcdef';
    const gc = {
      ...original,
      messages: [
        ...original.messages,
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'search', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'c1',
          content: archiveStub('search', 900, archiveId),
        },
      ],
    };
    const point = (gcBody: Record<string, unknown> | null) => ({
      requestNumber: 4,
      original,
      gc: gcBody,
      context: 'Price of X?',
    });

    it('should match identical answers without asking the judge', async () => {
      const port = new FakePort([
        ok(openAiReply('$5.')),
        ok(openAiReply('$5.')),
      ]);
      const budget = new ReplayBudget(1);
      const result = await replayPoint(port, budget, point(null));
      expect(result).toMatchObject({
        status: 'completed',
        gcChanged: false,
        exactMatch: true,
        toolCallsMatch: true,
        judgeScore: 5,
        agreed: true,
        judgeCostUsd: 0,
      });
      expect(port.prompts).toEqual([]);
      expect(port.sent.map((b) => [b.temperature, b.stream])).toEqual([
        [0, undefined],
        [0, undefined],
      ]);
      expect(result.original).toMatchObject({
        inputTokens: 100,
        outputTokens: 10,
        costUsd: 0.005,
        temperatureZero: true,
        upstreamCalls: 1,
      });
      expect(budget.spentUsd).toBeCloseTo(0.01);
    });

    it('should ask the judge when the answers differ', async () => {
      const port = new FakePort(
        [ok(openAiReply('$5.')), ok(openAiReply('It costs $5.'))],
        ['{"score": 5, "reason": "Same price."}'],
      );
      const result = await replayPoint(port, new ReplayBudget(1), point(null));
      expect(result).toMatchObject({
        exactMatch: false,
        toolCallsMatch: true,
        judgeScore: 5,
        judgeReason: 'Same price.',
        judgeCostUsd: 0.001,
        agreed: true,
      });
      expect(port.prompts[0]).toContain('It costs $5.');
    });

    it('should not agree when the judge scores below the pass mark, and keep a failed judge unjudged', async () => {
      const low = new FakePort(
        [ok(openAiReply('$5.')), ok(openAiReply('$9.'))],
        ['{"score": 2, "reason": "Different price."}'],
      );
      expect(
        await replayPoint(low, new ReplayBudget(1), point(null)),
      ).toMatchObject({ judgeScore: 2, agreed: false });

      const broken = new FakePort(
        [ok(openAiReply('$5.')), ok(openAiReply('$9.'))],
        ['not json'],
      );
      expect(
        await replayPoint(broken, new ReplayBudget(1), point(null)),
      ).toMatchObject({
        judgeScore: null,
        agreed: null,
        judgeReason: 'The judge failed: the judge returned no JSON object.',
      });
    });

    it('should answer parsim_recall calls in the GC version only', async () => {
      const recallCall = openAiReply(null, [
        {
          name: RECALL_TOOL_NAME,
          arguments: JSON.stringify({ archive_id: archiveId }),
        },
      ]);
      const port = new FakePort([
        ok(openAiReply('$5.')),
        ok(recallCall),
        ok(openAiReply('$5.')),
      ]);
      const result = await replayPoint(port, new ReplayBudget(1), point(gc));
      expect(result).toMatchObject({ gcChanged: true, exactMatch: true });
      expect(result.gc).toMatchObject({
        upstreamCalls: 2,
        recalls: 1,
        inputTokens: 200,
      });
      expect(port.rounds[0].fetch).toEqual([{ id: 'call_0', archiveId }]);
      // The original is sent without the recall tool, the GC'd one with it.
      expect(port.sent[0]).not.toHaveProperty('tools');
      expect(JSON.stringify(port.sent[1].tools)).toContain(RECALL_TOOL_NAME);
      expect(JSON.stringify(port.sent[2])).toContain('the archived original');
    });

    it('should resend without temperature when the model rejects it', async () => {
      const rejected: ReplayCall = {
        status: 400,
        response: { error: { message: 'temperature is not supported' } },
        usage: null,
        costUsd: null,
      };
      const port = new FakePort([
        rejected,
        ok(openAiReply('$5.')),
        rejected,
        ok(openAiReply('$5.')),
      ]);
      const result = await replayPoint(port, new ReplayBudget(1), point(null));
      expect(result.status).toBe('completed');
      expect(result.original).toMatchObject({
        temperatureZero: false,
        upstreamCalls: 2,
      });
      expect(port.sent[1]).not.toHaveProperty('temperature');
    });

    it('should record a failed upstream call without comparing', async () => {
      const port = new FakePort([
        ok(openAiReply('$5.')),
        {
          status: 500,
          response: { error: 'boom' },
          usage: null,
          costUsd: null,
        },
      ]);
      const result = await replayPoint(port, new ReplayBudget(1), point(null));
      expect(result).toMatchObject({
        status: 'failed',
        exactMatch: null,
        agreed: null,
        error: 'gc: upstream returned 500',
      });
      // An unknown cost counts as the call's maximum.
      expect(result.gc!.costUsd).toBe(0.01);
    });

    it('should stop before a call that could pass the budget', async () => {
      const port = new FakePort(
        [ok(openAiReply('$5.')), ok(openAiReply('$5.'))],
        [],
        0.01,
      );
      const budget = new ReplayBudget(0.014);
      await expect(replayPoint(port, budget, point(null))).rejects.toThrow(
        BudgetExceededError,
      );
      expect(port.sent).toHaveLength(1);
      expect(budget.spentUsd).toBeCloseTo(0.005);
    });
  });
});
