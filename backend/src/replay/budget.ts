/** The next call could take the replay above its budget. */
export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly limitUsd: number,
  ) {
    super(
      `the next call could pass the budget ($${spentUsd.toFixed(4)} of $${limitUsd.toFixed(2)} spent)`,
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * A replay's hard spending limit. Before every upstream call, `ensure` is
 * given the most that call can cost (its input plus the output it may
 * produce); the call only starts if that still fits. Actual costs are
 * added after each call.
 */
export class ReplayBudget {
  private spent: number;

  constructor(
    readonly limitUsd: number,
    spentUsd = 0,
  ) {
    this.spent = spentUsd;
  }

  get spentUsd(): number {
    return this.spent;
  }

  /** Throws BudgetExceededError if a call costing up to `maxUsd` could pass the limit. */
  ensure(maxUsd: number): void {
    // A tiny tolerance so float sums never refuse a call that fits exactly.
    if (this.spent + maxUsd > this.limitUsd + 1e-9) {
      throw new BudgetExceededError(this.spent, this.limitUsd);
    }
  }

  add(usd: number): void {
    this.spent += Math.max(0, usd);
  }
}
