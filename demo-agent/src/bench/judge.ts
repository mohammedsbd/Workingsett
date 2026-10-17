import type { ChatModel, Usage } from '../llm/types.js';
import type { Task } from '../tasks/schema.js';
import type { SideEffectEntry } from '../tools/side-effect-log.js';

/**
 * The LLM judge (--judge): Parsim's internal model grades a task against its
 * checklist, from the agent's actions and final answer. Exact checks stay
 * the primary measure of success; the judge is reported next to them.
 */

export const JUDGE_INSTRUCTIONS =
  'You are grading an AI agent. You get a checklist and what the agent did. Every checklist item must be true for a pass. Reply with JSON only: {"passed": true or false, "reason": "one short sentence"}.';

export type JudgeVerdict = { passed: boolean; reason: string };

export class InvalidVerdictError extends Error {
  constructor() {
    super('The judge did not answer with {"passed": ..., "reason": ...}');
    this.name = 'InvalidVerdictError';
  }
}

/** Parses the judge's JSON (tolerating a ```json fence). */
export function parseVerdict(text: string): JudgeVerdict {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let value: unknown;
  try {
    value = JSON.parse(unfenced);
  } catch {
    throw new InvalidVerdictError();
  }
  const raw = value as { passed?: unknown; reason?: unknown };
  if (typeof raw?.passed !== 'boolean') throw new InvalidVerdictError();
  return {
    passed: raw.passed,
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 300) : '',
  };
}

export function judgePrompt(
  task: Task,
  actions: SideEffectEntry[],
  finalText: string | null,
): string {
  return [
    `Task ${task.id}:\n${task.prompt}`,
    `Checklist:\n${task.checklist.map((c) => `- ${c}`).join('\n')}`,
    `Actions the agent took:\n${
      actions.length
        ? actions.map((a) => `- ${a.tool} ${JSON.stringify(a.args)}`).join('\n')
        : '- none'
    }`,
    `The agent's final answer:\n${finalText ?? '(none)'}`,
  ].join('\n\n');
}

export async function judgeTask(
  model: ChatModel,
  task: Task,
  actions: SideEffectEntry[],
  finalText: string | null,
  sessionId: string,
): Promise<{ verdict: JudgeVerdict; usage: Usage | null }> {
  const turn = await model.complete({
    messages: [
      { role: 'system', content: JUDGE_INSTRUCTIONS },
      { role: 'user', content: judgePrompt(task, actions, finalText) },
    ],
    tools: [],
    sessionId,
  });
  return { verdict: parseVerdict(turn.text), usage: turn.usage };
}
