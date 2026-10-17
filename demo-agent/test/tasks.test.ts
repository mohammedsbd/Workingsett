import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildResearchTasks } from '../src/tasks/build-research.js';
import { buildSupportTasks } from '../src/tasks/build-support.js';
import {
  loadResearchTasks,
  loadSupportTasks,
  plannedStartSteps,
  taskFile,
  TaskValidationError,
  validateResearchTasks,
  validateSupportTasks,
} from '../src/tasks/load.js';
import {
  LATE_RECALL_MIN_GAP,
  type ResearchTaskFile,
  type SupportTaskFile,
} from '../src/tasks/schema.js';
import { ResearchWorld } from '../src/world/research-world.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function problems(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof TaskValidationError) return error.problems;
    throw error;
  }
  return [];
}

describe('tasks', () => {
  const research = loadResearchTasks();
  const support = loadSupportTasks();

  it('should load and validate the committed task files', () => {
    expect(research.tasks).toHaveLength(24);
    expect(support.tasks).toHaveLength(20);
  });

  it('should match the builders, so the expected answers come from the worlds', () => {
    expect(JSON.parse(readFileSync(taskFile('research'), 'utf8'))).toEqual(
      buildResearchTasks(),
    );
    expect(JSON.parse(readFileSync(taskFile('support'), 'utf8'))).toEqual(
      buildSupportTasks(),
    );
  });

  it('should run the research agent over 100+ planned steps', () => {
    const steps = research.tasks.reduce((sum, t) => sum + t.plannedSteps, 0);
    expect(steps).toBeGreaterThanOrEqual(100);
  });

  it('should make at least 30% of research tasks late_recall', () => {
    const late = research.tasks.filter((t) => t.type === 'late_recall');
    expect(late.length / research.tasks.length).toBeGreaterThanOrEqual(0.3);
  });

  it('should schedule every late_recall source fact at least 60 steps before its question', () => {
    const starts = plannedStartSteps(research.tasks);
    const late = research.tasks.filter((t) => t.type === 'late_recall');
    for (const task of late) {
      const factStep =
        starts.get(task.source!.taskId)! + task.source!.stepOffset;
      expect(starts.get(task.id)! - factStep).toBeGreaterThanOrEqual(
        LATE_RECALL_MIN_GAP,
      );
    }
  });

  it('should ask late_recall questions about figures that changed since', () => {
    const world = new ResearchWorld();
    for (const task of research.tasks.filter((t) => t.type === 'late_recall')) {
      const subject = world.subject(Number(task.source!.taskId.slice(1)));
      expect(task.expected.answer).toBe(String(subject.capacityMwh));
      expect(task.expected.wrongAnswer).toBe(
        String(subject.revisedCapacityMwh),
      );
      expect(task.expected.answer).not.toBe(task.expected.wrongAnswer);
    }
  });

  it('should have cross_ticket support tickets that reference earlier tickets', () => {
    const cross = support.tasks.filter((t) => t.type === 'cross_ticket');
    expect(cross.length).toBeGreaterThanOrEqual(3);
    for (const task of cross) {
      expect(task.references?.length).toBeGreaterThan(0);
    }
  });

  describe('validation', () => {
    it('should refuse a late_recall fact closer than 60 steps', () => {
      const file = clone(research) as ResearchTaskFile;
      const q17 = file.tasks.find((t) => t.id === 'q17')!;
      q17.source = { taskId: 'q15', stepOffset: 1 };
      expect(problems(() => validateResearchTasks(file))).toEqual([
        expect.stringMatching(
          /q17: its fact is read at step \d+, only \d+ steps/,
        ),
      ]);
    });

    it('should refuse a late_recall task without a source, or with a missing one', () => {
      const file = clone(research) as ResearchTaskFile;
      delete file.tasks.find((t) => t.id === 'q18')!.source;
      file.tasks.find((t) => t.id === 'q19')!.source = {
        taskId: 'q99',
        stepOffset: 0,
      };
      expect(problems(() => validateResearchTasks(file))).toEqual([
        'q18: a late_recall task needs a source',
        'q19: source q99 does not exist',
      ]);
    });

    it('should refuse too few late_recall tasks', () => {
      const file = clone(research) as ResearchTaskFile;
      file.tasks = file.tasks.filter((t) => t.id !== 'q24' && t.id !== 'q23');
      expect(problems(() => validateResearchTasks(file))).toEqual([
        expect.stringMatching(/only 6 of 22 tasks are late_recall/),
      ]);
    });

    it('should refuse malformed tasks and duplicate ids', () => {
      const file = clone(research) as ResearchTaskFile;
      file.tasks[1]!.id = 'q01';
      expect(problems(() => validateResearchTasks(file))).toContain(
        'q01 appears twice',
      );
      const bad = clone(research) as unknown as {
        tasks: Record<string, unknown>[];
      };
      bad.tasks[0]!.plannedSteps = 0;
      expect(problems(() => validateResearchTasks(bad))[0]).toMatch(
        /tasks\.0\.plannedSteps/,
      );
    });

    it('should refuse a cross_ticket that references a later ticket', () => {
      const file = clone(support) as SupportTaskFile;
      file.tasks.find((t) => t.id === 'T09')!.references = ['T15'];
      expect(problems(() => validateSupportTasks(file))).toEqual([
        'T09: reference T15 is not an earlier ticket',
      ]);
    });
  });
});
