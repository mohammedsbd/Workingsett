import { normalizeOrderId, type SupportWorld } from '../world/support-world.js';
import {
  recordedTool,
  type RecordingStore,
  type ToolMode,
} from './recorder.js';
import type { SideEffectLog } from './side-effect-log.js';
import { stringArg, type Tool } from './types.js';

/**
 * The support agent's tools:
 * - lookup_order: recorded (no side effects)
 * - update_ticket and send_reply: side effects, logged only. Nothing is
 *   ever updated or sent.
 */

export function supportTools(
  world: SupportWorld,
  store: RecordingStore,
  mode: ToolMode,
  log: SideEffectLog,
): Tool[] {
  const lookupOrder = recordedTool(
    {
      definition: {
        name: 'lookup_order',
        description:
          'Look up an order by id (for example O-2003): status, items, total and shipping history.',
        parameters: {
          type: 'object',
          properties: { order_id: { type: 'string' } },
          required: ['order_id'],
        },
      },
      // Unknown ids all map to one "not found" recording.
      canonical: (args) => {
        const orderId = normalizeOrderId(stringArg(args, 'order_id'));
        return { orderId: world.order(orderId) ? orderId : null };
      },
      source: (canonical) => {
        const { orderId } = canonical as { orderId: string | null };
        return Promise.resolve(
          orderId ? world.orderRecord(orderId) : 'No order found with that id.',
        );
      },
    },
    store,
    mode,
  );

  const sideEffect = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    reply: string,
  ): Tool => ({
    definition: {
      name,
      description,
      parameters: { type: 'object', properties, required },
    },
    sideEffect: true,
    async run(args, context) {
      await log.record({
        tool: name,
        args,
        step: context.step,
        taskId: context.taskId,
      });
      return reply;
    },
  });

  return [
    lookupOrder,
    sideEffect(
      'update_ticket',
      "Set a ticket's status and add an internal note.",
      {
        ticket_id: { type: 'string', description: 'For example T03.' },
        status: {
          type: 'string',
          enum: ['credited', 'replacement_sent', 'refunded', 'investigating'],
        },
        note: { type: 'string' },
      },
      ['ticket_id', 'status'],
      'Ticket updated.',
    ),
    sideEffect(
      'send_reply',
      'Send a reply to the customer of a ticket.',
      {
        ticket_id: { type: 'string' },
        message: { type: 'string' },
      },
      ['ticket_id', 'message'],
      'Reply sent.',
    ),
  ];
}
