import {
  REVISED_SUBJECTS,
  ResearchWorld,
  type ResearchSubject,
} from '../world/research-world.js';
import type { ResearchTask, ResearchTaskFile } from './schema.js';

/**
 * The research run: 24 questions in one conversation.
 *
 * - q01 to q16 (normal): research one site each (search, read its site page
 *   and news page, take a note, save the answer). Six planned steps each.
 * - q17 to q24 (late_recall): the storage capacity the site page of q01 to
 *   q08 reported when the agent first read it. Those pages are revised
 *   from q17 on, so re-reading them gives a different figure. Two planned
 *   steps each (save the answer, reply).
 *
 * 112 planned steps; 8 of 24 questions (33%) are late_recall, each at
 * least 60 steps after the page it depends on was read.
 */

export const NORMAL_STEPS = 6;
export const LATE_STEPS = 2;
/** The site page is read on the second step of a normal question. */
export const SITE_PAGE_STEP = 1;

const qid = (n: number) => `q${String(n).padStart(2, '0')}`;

type Attribute = {
  ask: string;
  /** What is asked for, for the checklist ("the round-trip efficiency"). */
  label: string;
  answer: (s: ResearchSubject) => string;
};

const ATTRIBUTES: Record<string, Attribute> = {
  efficiency: {
    ask: 'What is its round-trip efficiency?',
    label: 'the round-trip efficiency',
    answer: (s) => `${s.efficiencyPercent}%`,
  },
  year: {
    ask: 'In which year was it commissioned?',
    label: 'the year it was commissioned',
    answer: (s) => String(s.commissionedYear),
  },
  operator: {
    ask: 'Which company operates it?',
    label: 'the operator',
    answer: (s) => s.operator,
  },
  supplier: {
    ask: 'Which company supplies its cells?',
    label: 'the cell supplier',
    answer: (s) => s.supplier,
  },
  region: {
    ask: 'In which region is it?',
    label: 'the region',
    answer: (s) => s.region,
  },
};

/** Site-page facts for the sites asked about again later, so their site page is read. */
const ATTRIBUTE_PLAN = [
  'efficiency',
  'year',
  'efficiency',
  'year',
  'efficiency',
  'year',
  'efficiency',
  'year',
  'operator',
  'supplier',
  'region',
  'efficiency',
  'year',
  'operator',
  'supplier',
  'region',
] as const;

export function buildResearchTasks(
  world = new ResearchWorld(),
): ResearchTaskFile {
  const tasks: ResearchTask[] = [];
  ATTRIBUTE_PLAN.forEach((key, i) => {
    const subject = world.subject(i + 1);
    const attribute = ATTRIBUTES[key]!;
    const id = qid(i + 1);
    tasks.push({
      id,
      type: 'normal',
      prompt: `Question ${id}: research the energy storage site "${subject.name}". ${attribute.ask} Read both its site profile and its news page, take a note of the key figures, then save your answer with save_report (question_id "${id}").`,
      plannedSteps: NORMAL_STEPS,
      expected: { answer: attribute.answer(subject) },
      checklist: [
        `The answer saved for ${id} gives ${attribute.label} of ${subject.name} as ${attribute.answer(subject)}.`,
      ],
    });
  });
  for (let j = 1; j <= REVISED_SUBJECTS; j++) {
    const subject = world.subject(j);
    const id = qid(ATTRIBUTE_PLAN.length + j);
    const source = qid(j);
    tasks.push({
      id,
      type: 'late_recall',
      prompt: `Question ${id}: back in question ${source} you researched "${subject.name}". Its site profile has been revised since you read it. What storage capacity, in MWh, did the site profile report when you first read it? Answer from what you read then, not from the revised page, and save it with save_report (question_id "${id}").`,
      plannedSteps: LATE_STEPS,
      expected: {
        answer: `${subject.capacityMwh}`,
        wrongAnswer: `${subject.revisedCapacityMwh}`,
      },
      source: { taskId: source, stepOffset: SITE_PAGE_STEP },
      checklist: [
        `The answer saved for ${id} is ${subject.capacityMwh} MWh, the capacity first read in ${source}.`,
        `It is not ${subject.revisedCapacityMwh} MWh, the figure on the revised page.`,
      ],
    });
  }
  return { agent: 'research', tasks };
}
