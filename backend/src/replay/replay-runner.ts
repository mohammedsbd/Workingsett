import { usesCachedContent } from '../proxy/proxy-gc.service';
import { ProxyApi } from '../proxy/providers/provider-adapter';
import { RecallResult } from '../recall/recall-format';
import { RECALL_FORMATS } from '../recall/recall-formats';
import { planRecallRound, RecallRound } from '../recall/recall-limit';
import { hasRecallableContent } from '../recall/recallable';
import { TokenUsage } from '../usage-records/domain/token-usage';
import {
  ReplayResult,
  ReplayVariant,
} from '../replay-results/domain/replay-result';
import { extractAnswer } from './answer';
import { ReplayBudget } from './budget';
import { agreed, compareAnswers } from './compare';
import {
  InvalidJudgeResultError,
  judgePrompt,
  parseJudgeResult,
} from './judge';
import { forReplay, rejectsTemperature } from './replay-request';

/** One upstream call's outcome. */
export type ReplayCall = {
  status: number;
  response: unknown;
  usage: TokenUsage | null;
  /** Null when the cost is unknown (no usage reported). */
  costUsd: number | null;
};

/**
 * What a replay needs from the outside world. The dashboard's job and the
 * fixtures CLI each provide one; tests provide a fake.
 */
export interface ReplayPort {
  readonly api: ProxyApi;
  /** Sends one non-streamed request upstream. Throws on network errors. */
  send(body: Record<string, unknown>): Promise<ReplayCall>;
  /** The most one call with this body can cost: its input plus its output limit. */
  maxCallCostUsd(body: Record<string, unknown>): number;
  /** Answers one round of parsim_recall calls with the archived originals. */
  recall(round: RecallRound): Promise<RecallResult[]>;
  /** parsim_recall calls answered per request. */
  readonly recallMax: number;
  /** One judge call; returns its raw text. */
  judge(prompt: string): Promise<{ text: string; costUsd: number | null }>;
  maxJudgeCostUsd(prompt: string): number;
  /** Judge scores at or above this count as agreeing. */
  readonly passScore: number;
}

/** One request point to replay. */
export type ReplayPoint = {
  requestNumber: number;
  /** The request as the client sent it. */
  original: Record<string, unknown>;
  /** The request as the GC made it; null when the GC changed nothing. */
  gc: Record<string, unknown> | null;
  /** The latest turn of the request, as context for the judge. */
  context: string;
};

export type PointOutcome = Omit<ReplayResult, 'id' | 'replayId' | 'createdAt'>;

/**
 * Replays one request point: the original and the GC'd request (the same
 * model, temperature 0 where supported, not streamed), then compares the
 * answers and, unless they are identical, asks the judge. Throws
 * BudgetExceededError, before the call, when a call could pass the budget.
 */
export async function replayPoint(
  port: ReplayPort,
  budget: ReplayBudget,
  point: ReplayPoint,
): Promise<PointOutcome> {
  const original = await runVariant(port, budget, point.original, false);
  const gc = await runVariant(port, budget, point.gc ?? point.original, true);
  const base = {
    requestNumber: point.requestNumber,
    gcChanged: point.gc !== null,
    original,
    gc,
  };
  if (!original.answer || !gc.answer) {
    const failed = !original.answer ? 'original' : 'gc';
    return {
      ...base,
      status: 'failed',
      exactMatch: null,
      toolCallsMatch: null,
      judgeScore: null,
      judgeReason: null,
      judgeCostUsd: 0,
      agreed: null,
      error: `${failed}: ${(failed === 'original' ? original : gc).error ?? 'no answer'}`,
    };
  }

  const comparison = compareAnswers(original.answer, gc.answer);
  let judgeScore: number | null = null;
  let judgeReason: string | null = null;
  let judgeCostUsd = 0;
  if (comparison.exactMatch) {
    judgeScore = 5;
    judgeReason = 'Identical answers.';
  } else {
    const prompt = judgePrompt({
      context: point.context,
      original: original.answer,
      gc: gc.answer,
    });
    const reserve = port.maxJudgeCostUsd(prompt);
    budget.ensure(reserve);
    try {
      const judged = await port.judge(prompt);
      judgeCostUsd = judged.costUsd ?? reserve;
      budget.add(judgeCostUsd);
      const verdict = parseJudgeResult(judged.text);
      judgeScore = verdict.score;
      judgeReason = verdict.reason;
    } catch (error) {
      judgeReason = `The judge failed: ${judgeError(error)}.`;
    }
  }
  return {
    ...base,
    status: 'completed',
    exactMatch: comparison.exactMatch,
    toolCallsMatch: comparison.toolCallsMatch,
    judgeScore,
    judgeReason,
    judgeCostUsd,
    agreed: agreed(comparison, judgeScore, port.passScore),
    error: null,
  };
}

/**
 * Sends one version of the request, answering parsim_recall calls the way
 * the proxy does (only the GC'd version can carry archive stubs). If the
 * model rejects temperature 0, the request is sent again without it.
 */
async function runVariant(
  port: ReplayPort,
  budget: ReplayBudget,
  recorded: Record<string, unknown>,
  canRecall: boolean,
): Promise<ReplayVariant> {
  const format = RECALL_FORMATS[port.api];
  const withRecall =
    canRecall &&
    port.recallMax > 0 &&
    !usesCachedContent(recorded) &&
    hasRecallableContent(JSON.stringify(recorded));
  const prepare = (temperatureZero: boolean) => {
    const prepared = forReplay(port.api, recorded, temperatureZero);
    return {
      body: withRecall ? format.inject(prepared.body) : prepared.body,
      temperatureZero: prepared.temperatureZero,
    };
  };

  let { body, temperatureZero } = prepare(true);
  const variant: ReplayVariant = {
    answer: null,
    status: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    temperatureZero,
    upstreamCalls: 0,
    recalls: 0,
    error: null,
  };
  let used = 0;
  let final = false;
  for (;;) {
    const reserve = port.maxCallCostUsd(body);
    budget.ensure(reserve);
    let call: ReplayCall;
    try {
      call = await port.send(body);
    } catch (error) {
      variant.error = `request failed (${(error as Error)?.name ?? 'Error'})`;
      return variant;
    }
    variant.upstreamCalls += 1;
    variant.status = call.status;
    variant.inputTokens += call.usage?.inputTokens ?? 0;
    variant.outputTokens += call.usage?.outputTokens ?? 0;
    const cost = call.costUsd ?? reserve;
    variant.costUsd += cost;
    budget.add(cost);

    if (
      variant.upstreamCalls === 1 &&
      temperatureZero &&
      rejectsTemperature(call.status, call.response)
    ) {
      ({ body, temperatureZero } = prepare(false));
      variant.temperatureZero = false;
      continue;
    }
    if (call.status < 200 || call.status >= 300) {
      variant.error = `upstream returned ${call.status}`;
      return variant;
    }
    const turn =
      withRecall && !final ? format.turnFromResponse(call.response) : null;
    if (turn?.recallCalls.length) {
      const round = planRecallRound(turn.recallCalls, used, port.recallMax);
      const results = await port.recall(round);
      used += round.fetch.length;
      variant.recalls += round.fetch.length;
      final = round.final;
      body = format.followUp(body, turn, results, final);
      continue;
    }
    variant.answer = extractAnswer(port.api, call.response);
    return variant;
  }
}

/**
 * A judge failure, without content: the message of Parsim's own errors
 * (which never hold content), otherwise only the error's class name.
 */
function judgeError(error: unknown): string {
  if (
    error instanceof InvalidJudgeResultError ||
    (error instanceof Error && error.name === 'SummarizerError')
  ) {
    return error.message;
  }
  return (error as Error)?.name ?? 'Error';
}
