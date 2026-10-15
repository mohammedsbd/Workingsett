export type ReplayConfig = {
  /** Run the replay worker in this process. */
  worker: boolean;
  /** How often the worker looks for new replays, in seconds. */
  pollSeconds: number;
  /** Budget of a replay when none is given, in USD. */
  defaultBudgetUsd: number;
  /** The largest budget a replay may be given, in USD. */
  maxBudgetUsd: number;
  /** Request points replayed when none are chosen. */
  defaultPoints: number;
  /** The most request points one replay may have. */
  maxPoints: number;
  /** The judge's model with Parsim's key. Empty: PARSIM_INTERNAL_MODEL. */
  judgeModel: string;
  /** Judge scores at or above this count as agreeing (1 to 5). */
  passScore: number;
  /**
   * Output tokens reserved for a call whose request sets no output limit,
   * when checking the budget before the call.
   */
  outputReserveTokens: number;
  /** Output tokens assumed in the estimate when the recorded response has none. */
  defaultOutputTokens: number;
};
