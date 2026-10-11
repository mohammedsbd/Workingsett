import { RecallCall } from './recall-format';

export type RecallRound = {
  /** Calls to answer with the archived original. */
  fetch: RecallCall[];
  /** Calls over the limit, answered with a "limit reached" result. */
  refused: RecallCall[];
  /**
   * True when a call was refused: the follow-up then turns tool use off,
   * so the model must answer and the loop ends.
   */
  final: boolean;
};

/**
 * Splits one response's recall calls by the per-request limit. `used` is
 * how many recalls this request already made. Calls within the limit are
 * fetched in order; the rest are refused.
 */
export function planRecallRound(
  calls: RecallCall[],
  used: number,
  max: number,
): RecallRound {
  const allowed = Math.max(0, max - used);
  const fetch = calls.slice(0, allowed);
  const refused = calls.slice(allowed);
  return { fetch, refused, final: refused.length > 0 };
}
