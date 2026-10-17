import type { SideEffectEntry } from '../tools/side-effect-log.js';
import type { ResearchTask, SupportTask, Task } from './schema.js';

/**
 * Exact checks of a task's outcome against its expected answer, from the
 * side-effect log. (The benchmark in step 16b adds the LLM judge, with the
 * task's checklist, on top.)
 */

export type TaskCheck = { taskId: string; passed: boolean; reason: string };

/** Lower case, no thousands separators, single spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

const argOf = (entry: SideEffectEntry, name: string) => {
  const value = entry.args[name];
  return typeof value === 'string' ? value : JSON.stringify(value ?? '');
};

/** Whether `text` mentions `expected` as a whole value (so "41" is not found in "412"). */
export function mentions(text: string, expected: string): boolean {
  const haystack = normalize(text);
  const needle = normalize(expected);
  const at = haystack.indexOf(needle);
  if (at < 0) return false;
  const isDigit = (c: string | undefined) => !!c && /\d/.test(c);
  const before = haystack[at - 1];
  const after = haystack[at + needle.length];
  return !(
    (isDigit(needle[0]) && isDigit(before)) ||
    (isDigit(needle[needle.length - 1]) && isDigit(after))
  );
}

function checkResearch(task: ResearchTask, log: SideEffectEntry[]): TaskCheck {
  const saved = log.filter(
    (e) =>
      e.tool === 'save_report' &&
      normalize(argOf(e, 'question_id')) === task.id,
  );
  const last = saved[saved.length - 1];
  if (!last) {
    return { taskId: task.id, passed: false, reason: 'no answer saved' };
  }
  const answer = argOf(last, 'answer');
  if (
    task.expected.wrongAnswer &&
    mentions(answer, task.expected.wrongAnswer)
  ) {
    return {
      taskId: task.id,
      passed: false,
      reason: 'saved the revised figure instead of the one first read',
    };
  }
  return mentions(answer, task.expected.answer)
    ? { taskId: task.id, passed: true, reason: 'answer matches' }
    : { taskId: task.id, passed: false, reason: 'answer does not match' };
}

function checkSupport(task: SupportTask, log: SideEffectEntry[]): TaskCheck {
  const forTicket = log.filter(
    (e) => normalize(argOf(e, 'ticket_id')) === normalize(task.id),
  );
  const update = forTicket.filter((e) => e.tool === 'update_ticket').at(-1);
  if (!update || argOf(update, 'status') !== task.expected.status) {
    return {
      taskId: task.id,
      passed: false,
      reason: update
        ? `status ${argOf(update, 'status')}, expected ${task.expected.status}`
        : 'ticket not updated',
    };
  }
  const replies = forTicket
    .filter((e) => e.tool === 'send_reply')
    .map((e) => argOf(e, 'message'))
    .join('\n');
  if (!replies) {
    return { taskId: task.id, passed: false, reason: 'no reply sent' };
  }
  const missing = task.expected.replyMustInclude.filter(
    (fact) => !mentions(replies, fact),
  );
  return missing.length
    ? {
        taskId: task.id,
        passed: false,
        reason: `reply is missing ${missing.length} required detail(s)`,
      }
    : { taskId: task.id, passed: true, reason: 'status and reply match' };
}

export function checkTask(task: Task, log: SideEffectEntry[]): TaskCheck {
  return 'source' in task || task.id.startsWith('q')
    ? checkResearch(task as ResearchTask, log)
    : checkSupport(task as SupportTask, log);
}
