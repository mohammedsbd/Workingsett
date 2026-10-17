import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import {
  LATE_RECALL_MIN_GAP,
  LATE_RECALL_MIN_SHARE,
  researchTaskFileSchema,
  supportTaskFileSchema,
  type AgentName,
  type ResearchTaskFile,
  type SupportTaskFile,
  type Task,
} from './schema.js';

export class TaskValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`The task file is not valid:\n- ${problems.join('\n- ')}`);
    this.name = 'TaskValidationError';
  }
}

export const TASKS_DIR = path.join(ROOT, 'tasks');

/** The planned first step (1-based) of each task in the run. */
export function plannedStartSteps(tasks: Task[]): Map<string, number> {
  const starts = new Map<string, number>();
  let step = 1;
  for (const task of tasks) {
    starts.set(task.id, step);
    step += task.plannedSteps;
  }
  return starts;
}

/** Problems with ids, order and references shared by both agents. */
function commonProblems(tasks: Task[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) problems.push(`${task.id} appears twice`);
    seen.add(task.id);
  }
  return problems;
}

/** Validates the research run, including the late_recall schedule. */
export function validateResearchTasks(value: unknown): ResearchTaskFile {
  const parsed = researchTaskFileSchema.safeParse(value);
  if (!parsed.success) {
    throw new TaskValidationError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const { tasks } = parsed.data;
  const problems = commonProblems(tasks);
  const starts = plannedStartSteps(tasks);
  const late = tasks.filter((t) => t.type === 'late_recall');
  if (late.length / tasks.length < LATE_RECALL_MIN_SHARE) {
    problems.push(
      `only ${late.length} of ${tasks.length} tasks are late_recall (at least ${Math.round(LATE_RECALL_MIN_SHARE * 100)}% needed)`,
    );
  }
  for (const task of tasks) {
    if (task.type === 'cross_ticket') {
      problems.push(`${task.id}: cross_ticket is for support tickets`);
    }
    if (task.type !== 'late_recall') continue;
    if (!task.source) {
      problems.push(`${task.id}: a late_recall task needs a source`);
      continue;
    }
    const sourceStart = starts.get(task.source.taskId);
    const source = tasks.find((t) => t.id === task.source?.taskId);
    if (sourceStart === undefined || !source) {
      problems.push(`${task.id}: source ${task.source.taskId} does not exist`);
      continue;
    }
    if (task.source.stepOffset >= source.plannedSteps) {
      problems.push(
        `${task.id}: step ${task.source.stepOffset} is outside ${source.id}'s ${source.plannedSteps} planned steps`,
      );
    }
    const factStep = sourceStart + task.source.stepOffset;
    const gap = (starts.get(task.id) ?? 0) - factStep;
    if (gap < LATE_RECALL_MIN_GAP) {
      problems.push(
        `${task.id}: its fact is read at step ${factStep}, only ${gap} steps before the question (at least ${LATE_RECALL_MIN_GAP} needed)`,
      );
    }
  }
  if (problems.length) throw new TaskValidationError(problems);
  return parsed.data;
}

/** Validates the support run: cross_ticket tickets reference earlier tickets. */
export function validateSupportTasks(value: unknown): SupportTaskFile {
  const parsed = supportTaskFileSchema.safeParse(value);
  if (!parsed.success) {
    throw new TaskValidationError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const { tasks } = parsed.data;
  const problems = commonProblems(tasks);
  const position = new Map(tasks.map((t, i) => [t.id, i]));
  for (const [i, task] of tasks.entries()) {
    if (task.type === 'late_recall') {
      problems.push(`${task.id}: late_recall is for research questions`);
    }
    if (task.type !== 'cross_ticket') continue;
    if (!task.references?.length) {
      problems.push(`${task.id}: a cross_ticket task needs references`);
    }
    for (const ref of task.references ?? []) {
      const at = position.get(ref);
      if (at === undefined || at >= i) {
        problems.push(`${task.id}: reference ${ref} is not an earlier ticket`);
      }
    }
  }
  if (problems.length) throw new TaskValidationError(problems);
  return parsed.data;
}

export function taskFile(agent: AgentName): string {
  return path.join(TASKS_DIR, `${agent}.json`);
}

export function loadResearchTasks(file = taskFile('research')) {
  return validateResearchTasks(JSON.parse(readFileSync(file, 'utf8')));
}

export function loadSupportTasks(file = taskFile('support')) {
  return validateSupportTasks(JSON.parse(readFileSync(file, 'utf8')));
}

export function loadTasks(agent: AgentName): Task[] {
  return agent === 'research'
    ? loadResearchTasks().tasks
    : loadSupportTasks().tasks;
}
