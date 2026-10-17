import { z } from 'zod';

/**
 * Tasks of the demo agents. A run works through an agent's tasks in order,
 * in one conversation; each task has a known expected answer (checked
 * exactly from the side-effect log) and a checklist for an LLM judge.
 *
 * Types:
 * - normal: answerable from what the agent reads for this task
 * - late_recall: the answer is a fact from a tool result at least
 *   LATE_RECALL_MIN_GAP steps earlier (that page has since changed, so only
 *   memory has it)
 * - cross_ticket: needs details from an earlier ticket of the same run
 */

export const TASK_TYPES = ['normal', 'late_recall', 'cross_ticket'] as const;
export const AGENTS = ['research', 'support'] as const;
export type AgentName = (typeof AGENTS)[number];

/** The least distance, in planned steps, between a late_recall fact and its question. */
export const LATE_RECALL_MIN_GAP = 60;
/** The least share of research tasks that are late_recall. */
export const LATE_RECALL_MIN_SHARE = 0.3;

const taskBase = {
  id: z.string().regex(/^[a-z]\d{2}$|^T\d{2}$/),
  type: z.enum(TASK_TYPES),
  /** The user message that starts the task. */
  prompt: z.string().min(20),
  /** Model calls the task should take; used to schedule late_recall facts. */
  plannedSteps: z.number().int().min(1).max(20),
  /** For an LLM judge: statements a correct run makes true. */
  checklist: z.array(z.string().min(5)).min(1),
};

export const researchTaskSchema = z.object({
  ...taskBase,
  id: z.string().regex(/^q\d{2}$/),
  expected: z.object({
    /** The saved answer must contain this (case and spacing ignored). */
    answer: z.string().min(1),
    /** A saved answer containing this is wrong (the revised figure). */
    wrongAnswer: z.string().min(1).optional(),
  }),
  /** For late_recall: where the fact was read. */
  source: z
    .object({
      taskId: z.string().regex(/^q\d{2}$/),
      /** Planned step within that task that reads the fact (0-based). */
      stepOffset: z.number().int().min(0),
    })
    .optional(),
});

export const UPDATE_STATUSES = [
  'credited',
  'replacement_sent',
  'refunded',
  'investigating',
] as const;

export const supportTaskSchema = z.object({
  ...taskBase,
  id: z.string().regex(/^T\d{2}$/),
  expected: z.object({
    status: z.enum(UPDATE_STATUSES),
    /** The reply must contain each of these. */
    replyMustInclude: z.array(z.string().min(1)).min(1),
  }),
  /** For cross_ticket: the earlier tickets it depends on. */
  references: z.array(z.string().regex(/^T\d{2}$/)).optional(),
});

export type ResearchTask = z.infer<typeof researchTaskSchema>;
export type SupportTask = z.infer<typeof supportTaskSchema>;
export type Task = ResearchTask | SupportTask;

export const researchTaskFileSchema = z.object({
  agent: z.literal('research'),
  tasks: z.array(researchTaskSchema).min(1),
});

export const supportTaskFileSchema = z.object({
  agent: z.literal('support'),
  tasks: z.array(supportTaskSchema).min(1),
});

export type ResearchTaskFile = z.infer<typeof researchTaskFileSchema>;
export type SupportTaskFile = z.infer<typeof supportTaskFileSchema>;
