import { canonicalJson } from '../context/canonical-json';
import {
  ReplayAnswer,
  ReplayToolCall,
} from '../replay-results/domain/replay-result';

/** The same text, ignoring leading and trailing whitespace. */
export function sameText(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

const callKey = (call: ReplayToolCall) =>
  canonicalJson({ name: call.name, arguments: call.arguments });

/**
 * The same tool calls with the same arguments. Argument key order does not
 * matter, and neither does the order of parallel calls; each call counts as
 * often as it appears. True when neither answer calls a tool.
 */
export function sameToolCalls(
  a: ReplayToolCall[],
  b: ReplayToolCall[],
): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(callKey).sort();
  const right = b.map(callKey).sort();
  return left.every((key, i) => key === right[i]);
}

export type Comparison = {
  exactMatch: boolean;
  toolCallsMatch: boolean;
};

export function compareAnswers(a: ReplayAnswer, b: ReplayAnswer): Comparison {
  const toolCallsMatch = sameToolCalls(a.toolCalls, b.toolCalls);
  return {
    exactMatch: toolCallsMatch && sameText(a.text, b.text),
    toolCallsMatch,
  };
}

/**
 * Whether the GC'd answer counts as agreeing with the original: identical
 * answers always do; otherwise the judge decides, at `passScore` or above.
 * Null when there is no verdict (the judge failed).
 */
export function agreed(
  comparison: Comparison,
  judgeScore: number | null,
  passScore: number,
): boolean | null {
  if (comparison.exactMatch) return true;
  if (judgeScore === null) return null;
  return judgeScore >= passScore;
}

export type Agreement = {
  /** Points with a verdict. */
  judged: number;
  agreed: number;
  /** agreed / judged, or null with no verdicts. */
  rate: number | null;
};

/** The agreement rate over the points that have a verdict. */
export function agreementRate(
  results: { agreed: boolean | null }[],
): Agreement {
  const judged = results.filter((r) => r.agreed !== null);
  const yes = judged.filter((r) => r.agreed).length;
  return {
    judged: judged.length,
    agreed: yes,
    rate: judged.length ? yes / judged.length : null,
  };
}
