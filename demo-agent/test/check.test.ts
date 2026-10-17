import { describe, expect, it } from 'vitest';
import { checkTask, mentions } from '../src/tasks/check.js';
import { loadResearchTasks, loadSupportTasks } from '../src/tasks/load.js';
import type { SideEffectEntry } from '../src/tools/side-effect-log.js';

const entry = (
  tool: string,
  args: Record<string, unknown>,
  taskId: string,
): SideEffectEntry => ({ tool, args, step: 1, taskId });

describe('task checks', () => {
  const research = loadResearchTasks().tasks;
  const support = loadSupportTasks().tasks;

  it('should match whole values only', () => {
    expect(mentions('It stored 412 MWh', '412')).toBe(true);
    expect(mentions('It stored 4120 MWh', '412')).toBe(false);
    expect(mentions('Credit of 1,234.50 EUR', '1234.50')).toBe(true);
    expect(mentions('GIFT CARD gc-4471-xy', 'GC-4471-XY')).toBe(true);
  });

  it('should pass a late_recall answer with the figure first read, and fail the revised one', () => {
    const q17 = research.find((t) => t.id === 'q17')!;
    const save = (answer: string) => [
      entry('save_report', { question_id: 'q17', answer }, 'q17'),
    ];
    expect(checkTask(q17, save(`${q17.expected.answer} MWh`)).passed).toBe(
      true,
    );
    expect(
      checkTask(q17, save(`${q17.expected.wrongAnswer} MWh`)),
    ).toMatchObject({
      passed: false,
      reason: 'saved the revised figure instead of the one first read',
    });
    expect(checkTask(q17, []).reason).toBe('no answer saved');
  });

  it('should check a ticket by its status and the details in the reply', () => {
    const t09 = support.find((t) => t.id === 'T09')!;
    const [amount, giftCard] = t09.expected.replyMustInclude;
    const update = entry(
      'update_ticket',
      { ticket_id: 'T09', status: 'refunded' },
      'T09',
    );
    expect(
      checkTask(t09, [
        update,
        entry(
          'send_reply',
          {
            ticket_id: 'T09',
            message: `Refunded ${amount} EUR to ${giftCard}.`,
          },
          'T09',
        ),
      ]).passed,
    ).toBe(true);
    expect(
      checkTask(t09, [
        update,
        entry(
          'send_reply',
          { ticket_id: 'T09', message: `Refunded ${amount} EUR.` },
          'T09',
        ),
      ]).reason,
    ).toBe('reply is missing 1 required detail(s)');
    expect(
      checkTask(t09, [
        entry('update_ticket', { ticket_id: 'T09', status: 'credited' }, 'T09'),
      ]).reason,
    ).toBe('status credited, expected refunded');
  });
});
