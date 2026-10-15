import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MAX_OUTPUT_TOKENS as JUDGE_MAX_OUTPUT_TOKENS,
  summarize,
  SummarizerTarget,
} from '../../compression/summarizer';
import {
  CanonicalContent,
  extractContextItems,
} from '../../context/context-items';
import { OpenAiChatConverter } from '../../context/normalization/openai-chat.converter';
import { TokenCounter } from '../../context/token-counter';
import { GcConfig } from '../../gc/gc-config';
import { runGc } from '../../gc/gc-engine';
import { PriorDecision } from '../../gc/gc-types';
import { Upstream } from '../../proxy/providers/provider-adapter';
import {
  readOpenAiUsage,
  toTokenUsage,
} from '../../proxy/providers/openai-format';
import { archivedText, recallNotFound } from '../../recall/recall-tool';
import {
  calculateCostUsd,
  ModelPriceTable,
} from '../../usage-records/pricing/model-pricing';
import { TokenUsage } from '../../usage-records/domain/token-usage';
import { BudgetExceededError, ReplayBudget } from '../budget';
import { agreementRate } from '../compare';
import {
  estimateReplay,
  PriceFn,
  ReplayEstimate,
  roundUsd,
  spreadPoints,
} from '../cost';
import { JUDGE_INSTRUCTIONS } from '../judge';
import { maxOutputTokens } from '../replay-request';
import {
  PointOutcome,
  ReplayPoint,
  ReplayPort,
  replayPoint,
} from '../replay-runner';

/**
 * Replay of the fixture conversations in test/fixtures/conversations,
 * without a database: each fixture is played as a session (one request per
 * assistant turn) through the GC engine, and the request points the GC
 * changed are replayed against a real model. Used by
 * `npm run replay:fixtures` and the replay live test.
 */

export const FIXTURES_DIR = path.resolve(
  __dirname,
  '../../../test/fixtures/conversations',
);

/** A fixture conversation: an OpenAI chat request body with an id. */
export type Fixture = {
  id: string;
  model: string;
  tools?: unknown[];
  messages: Record<string, unknown>[];
};

export function listFixtures(dir = FIXTURES_DIR): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort();
}

export function loadFixture(id: string, dir = FIXTURES_DIR): Fixture {
  return JSON.parse(
    readFileSync(path.join(dir, `${id}.json`), 'utf8'),
  ) as Fixture;
}

/** One fixture request point, as recorded and as the GC made it. */
export type FixturePoint = ReplayPoint & {
  fixture: string;
  /** Archived originals the GC'd request points at, by archive id. */
  archive: Map<string, CanonicalContent>;
};

/**
 * Plays a fixture as a session: request N holds the messages before the
 * N-th assistant turn, and the GC runs on each in order with the decisions
 * of the earlier ones, as the proxy does. Returns up to `max` points the GC
 * changed, spread over the session, with `model` as the request model.
 */
export function fixturePoints(
  fixture: Fixture,
  options: {
    model: string;
    gc: GcConfig;
    count: (text: string, images: number) => number;
    max: number;
  },
): FixturePoint[] {
  const converter = new OpenAiChatConverter();
  const prior: PriorDecision[] = [];
  const archive = new Map<string, CanonicalContent>();
  let processedPosition = 0;
  const changed: FixturePoint[] = [];
  let requestNumber = 0;
  fixture.messages.forEach((message, index) => {
    if (message.role !== 'assistant' || index === 0) return;
    requestNumber += 1;
    const original: Record<string, unknown> = {
      model: options.model,
      ...(fixture.tools && { tools: fixture.tools }),
      messages: fixture.messages.slice(0, index),
    };
    const result = runGc({
      request: converter.toInternal(original),
      config: options.gc,
      countTokens: options.count,
      prior,
      processedPosition,
    });
    for (const decision of result.decisions) {
      if (decision.archiveId)
        archive.set(decision.archiveId, decision.original);
      if (!decision.sticky) prior.push(decision);
    }
    if (result.ran) processedPosition = result.processedPosition;
    if (!result.decisions.length) return;
    const items = extractContextItems(converter.toInternal(original));
    const last = [...items]
      .reverse()
      .find((item) => item.kind === 'user' || item.kind === 'tool_result');
    changed.push({
      fixture: fixture.id,
      requestNumber,
      original,
      gc: converter.fromInternal(result.request),
      context: last?.tokenText ?? '',
      archive: new Map(archive),
    });
  });
  const picked = new Set(
    spreadPoints(
      changed.map((p) => p.requestNumber),
      options.max,
    ),
  );
  return changed.filter((p) => picked.has(p.requestNumber));
}

/** Where fixture requests go: an OpenAI-format chat completions endpoint. */
export type FixtureTarget = {
  provider: Extract<Upstream, 'openai' | 'gemini'>;
  /** The full chat completions URL. */
  url: string;
  apiKey: string;
  model: string;
};

export type FixtureReplayOptions = {
  target: FixtureTarget;
  judge: SummarizerTarget;
  prices: ModelPriceTable;
  passScore: number;
  recallMax: number;
  outputReserveTokens: number;
  timeoutMs?: number;
};

const usageOf = (input: number, output: number): TokenUsage => ({
  inputTokens: input,
  outputTokens: output,
  cachedInputTokens: null,
  cacheWriteInputTokens: null,
});

function priceFn(table: ModelPriceTable, model: string): PriceFn | null {
  if (calculateCostUsd(table, model, usageOf(0, 0)) === null) return null;
  return (input, output) =>
    calculateCostUsd(table, model, usageOf(input, output));
}

/**
 * Replays fixture points against a real model, as the dashboard's job
 * does but without a database: recall is answered from the GC's own
 * archive. Nothing is stored.
 */
export class FixtureReplayer {
  private readonly tokens = new TokenCounter();

  constructor(private readonly options: FixtureReplayOptions) {}

  private count(text: string, upstream: Upstream, model: string): number {
    return this.tokens.count(text, 0, { upstream, model }).tokens;
  }

  /** Context tokens of a request body plus its tool definitions. */
  inputTokens(body: Record<string, unknown>): number {
    const { provider, model } = this.options.target;
    const items = extractContextItems(
      new OpenAiChatConverter().toInternal(body),
    );
    const tools = body.tools ? JSON.stringify(body.tools) : '';
    return (
      items.reduce(
        (sum, item) =>
          sum +
          this.tokens.count(item.tokenText, item.imageCount, {
            upstream: provider,
            model,
          }).tokens,
        0,
      ) + (tools ? this.count(tools, provider, model) : 0)
    );
  }

  /** The cost estimate, with the default output length for every answer. */
  estimate(points: FixturePoint[], outputTokens: number): ReplayEstimate {
    const { target, judge, prices } = this.options;
    return estimateReplay(
      points.map((p) => ({
        requestNumber: p.requestNumber,
        model: target.model,
        originalInputTokens: this.inputTokens(p.original),
        gcInputTokens: this.inputTokens(p.gc ?? p.original),
        outputTokens,
      })),
      {
        replay: (model) => priceFn(prices, model),
        judge: { model: judge.model, price: priceFn(prices, judge.model) },
      },
    );
  }

  private port(point: FixturePoint): ReplayPort {
    const { target, judge, prices } = this.options;
    const price = (model: string) => {
      const fn = priceFn(prices, model);
      return (input: number, output: number) =>
        fn?.(input, output) ?? Number.POSITIVE_INFINITY;
    };
    const replayPrice = price(target.model);
    const judgePrice = price(judge.model);
    return {
      api: 'openai-chat',
      recallMax: this.options.recallMax,
      passScore: this.options.passScore,
      send: async (body) => {
        const response = await fetch(target.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${target.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 300_000),
        });
        const text = await response.text();
        let json: unknown;
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          json = undefined;
        }
        // Gemini leaves thinking tokens out of completion_tokens.
        const usage = response.ok
          ? toTokenUsage(readOpenAiUsage(json), target.provider === 'gemini')
          : null;
        return {
          status: response.status,
          response: json,
          usage,
          costUsd: response.ok
            ? usage && calculateCostUsd(prices, target.model, usage)
            : 0,
        };
      },
      maxCallCostUsd: (body) =>
        replayPrice(
          this.inputTokens(body),
          maxOutputTokens('openai-chat', body) ??
            this.options.outputReserveTokens,
        ),
      recall: (round) =>
        Promise.resolve(
          round.fetch.map((call) => {
            const original = point.archive.get(call.archiveId);
            return {
              call,
              text: original
                ? archivedText(original)
                : recallNotFound(call.archiveId),
            };
          }),
        ),
      judge: async (prompt) => {
        const result = await summarize(judge, JUDGE_INSTRUCTIONS, prompt);
        return {
          text: result.text,
          costUsd:
            result.usage && calculateCostUsd(prices, judge.model, result.usage),
        };
      },
      maxJudgeCostUsd: (prompt) =>
        judgePrice(
          this.count(
            `${JUDGE_INSTRUCTIONS}\n${prompt}`,
            judge.provider,
            judge.model,
          ),
          JUDGE_MAX_OUTPUT_TOKENS,
        ),
    };
  }

  /**
   * Replays the points in order within the budget. Stops before a call
   * that could pass it; the points done so far are returned.
   */
  async run(
    points: FixturePoint[],
    budgetUsd: number,
    onPoint?: (point: FixturePoint, outcome: PointOutcome) => void,
  ): Promise<FixtureReplayReport> {
    const budget = new ReplayBudget(budgetUsd);
    const outcomes: (PointOutcome & { fixture: string })[] = [];
    let stopped: string | null = null;
    for (const point of points) {
      try {
        const outcome = await replayPoint(this.port(point), budget, point);
        outcomes.push({ fixture: point.fixture, ...outcome });
        onPoint?.(point, outcome);
      } catch (error) {
        if (!(error instanceof BudgetExceededError)) throw error;
        stopped = error.message;
        break;
      }
    }
    return fixtureReport(outcomes, budget.spentUsd, stopped);
  }
}

export type FixtureReplayReport = {
  points: (PointOutcome & { fixture: string })[];
  agreement: ReturnType<typeof agreementRate> & { exactMatches: number };
  original: { inputTokens: number; outputTokens: number; costUsd: number };
  gc: { inputTokens: number; outputTokens: number; costUsd: number };
  judgeCostUsd: number;
  spentUsd: number;
  /** Why the replay stopped early (the budget), or null. */
  stopped: string | null;
};

function fixtureReport(
  points: (PointOutcome & { fixture: string })[],
  spentUsd: number,
  stopped: string | null,
): FixtureReplayReport {
  const sum = (pick: (p: PointOutcome) => PointOutcome['gc']) => {
    const total = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    for (const point of points) {
      const variant = pick(point);
      if (!variant) continue;
      total.inputTokens += variant.inputTokens;
      total.outputTokens += variant.outputTokens;
      total.costUsd += variant.costUsd;
    }
    return { ...total, costUsd: roundUsd(total.costUsd) };
  };
  const completed = points.filter((p) => p.status === 'completed');
  return {
    points,
    agreement: {
      ...agreementRate(completed),
      exactMatches: completed.filter((p) => p.exactMatch).length,
    },
    original: sum((p) => p.original),
    gc: sum((p) => p.gc),
    judgeCostUsd: roundUsd(points.reduce((s, p) => s + p.judgeCostUsd, 0)),
    spentUsd: roundUsd(spentUsd),
    stopped,
  };
}
