/** Instructions, the context excerpt and formatting in a judge prompt. */
export const JUDGE_PROMPT_OVERHEAD_TOKENS = 900;
/** A judge verdict is one short JSON object. */
export const JUDGE_OUTPUT_TOKENS = 150;

/** Token counts of one request point, as recorded. */
export type PointTokens = {
  requestNumber: number;
  originalInputTokens: number;
  /** Equal to originalInputTokens when the GC changed nothing. */
  gcInputTokens: number;
  /** Output tokens the recorded response used (an estimate for both versions). */
  outputTokens: number;
};

/** Cost in USD of a call with these tokens, or null if the model has no price. */
export type PriceFn = (
  inputTokens: number,
  outputTokens: number,
) => number | null;

export type PointEstimate = PointTokens & {
  originalUsd: number;
  gcUsd: number;
  judgeUsd: number;
};

export type ReplayEstimate = {
  points: PointEstimate[];
  totalUsd: number;
};

/** A model in the replay has no price in config/model-prices.json. */
export class UnknownPriceError extends Error {
  constructor(readonly model: string) {
    super(`No price for model ${model}; add it to config/model-prices.json`);
    this.name = 'UnknownPriceError';
  }
}

/** The judge's input tokens for answers of about `outputTokens` each. */
export const judgeInputTokens = (outputTokens: number): number =>
  JUDGE_PROMPT_OVERHEAD_TOKENS + 2 * outputTokens;

/**
 * The expected cost of a replay, shown before it starts: both versions of
 * every point with the recorded output length, and a judge call for every
 * point (identical answers skip the judge, so this is an upper estimate
 * there). parsim_recall follow-ups are not included.
 */
export function estimateReplay(
  points: PointTokens[],
  models: {
    replay: { model: string; price: PriceFn };
    judge: { model: string; price: PriceFn };
  },
): ReplayEstimate {
  const priced = (
    target: { model: string; price: PriceFn },
    input: number,
    output: number,
  ) => {
    const usd = target.price(input, output);
    if (usd === null) throw new UnknownPriceError(target.model);
    return usd;
  };
  const estimates = points.map((point) => ({
    ...point,
    originalUsd: priced(
      models.replay,
      point.originalInputTokens,
      point.outputTokens,
    ),
    gcUsd: priced(models.replay, point.gcInputTokens, point.outputTokens),
    judgeUsd: priced(
      models.judge,
      judgeInputTokens(point.outputTokens),
      JUDGE_OUTPUT_TOKENS,
    ),
  }));
  const total = estimates.reduce(
    (sum, p) => sum + p.originalUsd + p.gcUsd + p.judgeUsd,
    0,
  );
  return { points: estimates, totalUsd: roundUsd(total) };
}

export const roundUsd = (value: number): number =>
  Math.round(value * 1e6) / 1e6;

/**
 * Up to `max` request points, spread evenly over the candidates (which
 * are in request order), always including the last one.
 */
export function spreadPoints(candidates: number[], max: number): number[] {
  if (candidates.length <= max) return [...candidates];
  if (max <= 0) return [];
  if (max === 1) return [candidates[candidates.length - 1]];
  const step = (candidates.length - 1) / (max - 1);
  const picked = new Set<number>();
  for (let i = 0; i < max; i++) {
    picked.add(candidates[Math.round(i * step)]);
  }
  return [...picked].sort((a, b) => a - b);
}
