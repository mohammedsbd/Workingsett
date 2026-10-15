import { ReplayAnswer } from '../replay-results/domain/replay-result';

/** Scores run from 1 (different) to 5 (equivalent). */
export const JUDGE_MIN_SCORE = 1;
export const JUDGE_MAX_SCORE = 5;
const MAX_REASON_CHARS = 300;
/** Each answer and the context are cut to this many characters. */
const MAX_ANSWER_CHARS = 8000;
const MAX_CONTEXT_CHARS = 2000;

export const JUDGE_INSTRUCTIONS = `You compare two answers an AI agent gave to the same request. Answer A was produced with the full conversation; answer B with a shortened copy of it. Decide whether B is as good as A for the agent's task: the same decision, the same tool calls with equivalent arguments, and no missing or wrong facts. Wording does not matter.

Reply with JSON only: {"score": <1-5>, "reason": "<one short sentence>"}
5: equivalent. 4: minor differences that do not change the outcome. 3: noticeably different but still acceptable. 2: a different decision or a missing fact. 1: wrong or unrelated.`;

/** The judge's verdict. */
export type JudgeResult = { score: number; reason: string };

/** The judge's answer could not be read. */
export class InvalidJudgeResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJudgeResultError';
  }
}

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n[cut]` : text;

function renderAnswer(answer: ReplayAnswer): string {
  const calls = answer.toolCalls.map(
    (call) => `- ${call.name}(${JSON.stringify(call.arguments)})`,
  );
  return cut(
    [
      answer.text.trim() || '(no text)',
      ...(calls.length ? ['Tool calls:', ...calls] : []),
    ].join('\n'),
    MAX_ANSWER_CHARS,
  );
}

/** The judge's prompt: the latest turn of the request, then both answers. */
export function judgePrompt(input: {
  context: string;
  original: ReplayAnswer;
  gc: ReplayAnswer;
}): string {
  return [
    'Latest turn of the conversation:',
    cut(input.context.trim() || '(none)', MAX_CONTEXT_CHARS),
    '',
    'Answer A:',
    renderAnswer(input.original),
    '',
    'Answer B:',
    renderAnswer(input.gc),
  ].join('\n');
}

/**
 * Reads the judge's JSON, tolerating code fences and text around it. The
 * score must be a whole number from 1 to 5; the reason is cut to 300
 * characters.
 */
export function parseJudgeResult(text: string): JudgeResult {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new InvalidJudgeResultError('the judge returned no JSON object');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new InvalidJudgeResultError('the judge returned invalid JSON');
  }
  const { score, reason } = (parsed ?? {}) as Record<string, unknown>;
  const value = typeof score === 'string' ? Number(score) : score;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < JUDGE_MIN_SCORE ||
    value > JUDGE_MAX_SCORE
  ) {
    throw new InvalidJudgeResultError(
      'the judge returned no score from 1 to 5',
    );
  }
  const why = typeof reason === 'string' ? reason.trim() : '';
  return {
    score: value,
    reason:
      why.length > MAX_REASON_CHARS
        ? `${why.slice(0, MAX_REASON_CHARS - 3)}...`
        : why,
  };
}
