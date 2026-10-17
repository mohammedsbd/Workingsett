import { SupportWorld, type Order } from '../world/support-world.js';
import type { SupportTask, SupportTaskFile } from './schema.js';

/**
 * The support run: 20 tickets in one conversation, handled under the policy
 * in the agent's system prompt. 16 are normal; 4 are cross_ticket: they
 * need a detail the same customer gave only in an earlier ticket's text (a
 * gift card, a phone number, a gift note, an order id).
 */

export const TICKET_STEPS = 4;

const STATUS_FOR = {
  delayed: 'credited',
  damaged: 'replacement_sent',
  lost: 'refunded',
  delivered: 'investigating',
} as const;

const COMPLAINT = {
  delayed: 'has not arrived and the promised delivery date has passed.',
  damaged: 'arrived with the box crushed and one item broken.',
  lost: 'never arrived and the tracking has not moved for days.',
  delivered: 'shows as delivered, but I never received it.',
} as const;

const tid = (n: number) => `T${String(n).padStart(2, '0')}`;
const eur = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

/** What the reply must contain under the policy, for an order. */
function policyFacts(order: Order): string[] {
  switch (order.status) {
    case 'delayed':
      return [eur(order.total * 0.1)];
    case 'damaged':
      return [order.id];
    case 'lost':
      return [eur(order.total)];
    case 'delivered':
      return [order.trackingNumber];
  }
}

function policyChecklist(order: Order, ticket: string): string {
  switch (order.status) {
    case 'delayed':
      return `${ticket} is set to credited and the reply offers a 10% credit of ${eur(order.total * 0.1)} EUR for ${order.id}.`;
    case 'damaged':
      return `${ticket} is set to replacement_sent and the reply confirms a replacement for ${order.id}.`;
    case 'lost':
      return `${ticket} is set to refunded and the reply confirms a full refund of ${eur(order.total)} EUR for ${order.id}.`;
    case 'delivered':
      return `${ticket} is set to investigating and the reply gives the tracking number ${order.trackingNumber}.`;
  }
}

/** Extra details some customers give, which a later ticket depends on. */
const GIFT_CARD = 'GC-4471-XY';
const PHONE = '+47 400 12 345';
const GIFT_NOTE = 'Happy 40th, Sam';

type Plan =
  | {
      kind: 'normal';
      order: number;
      /** A detail the customer gives, which the reply must honour. */
      extra?: { text: string; mustInclude: string; checklist: string };
    }
  | {
      kind: 'cross';
      order: number;
      references: string;
      text: (o: Order) => string;
      mustInclude: string[];
      checklist: string;
    };

export function buildSupportTasks(world = new SupportWorld()): SupportTaskFile {
  const order = (n: number) => {
    const found = world.orders[n - 1];
    if (!found) throw new Error(`No order ${n}`);
    return found;
  };
  const plans: Plan[] = [
    { kind: 'normal', order: 1 },
    { kind: 'normal', order: 2 },
    {
      kind: 'normal',
      order: 3,
      extra: {
        text: `If you refund anything, please put it on my store gift card ${GIFT_CARD}.`,
        mustInclude: GIFT_CARD,
        checklist: `The reply sends the refund to the gift card ${GIFT_CARD}.`,
      },
    },
    { kind: 'normal', order: 4 },
    {
      kind: 'normal',
      order: 5,
      extra: {
        text: `I am moving, so please give the courier my new phone number ${PHONE}.`,
        mustInclude: PHONE,
        checklist: `The reply confirms the courier gets the phone number ${PHONE}.`,
      },
    },
    {
      kind: 'normal',
      order: 6,
      extra: {
        text: `It was a birthday present: please gift-wrap any replacement with the note "${GIFT_NOTE}".`,
        mustInclude: GIFT_NOTE,
        checklist: `The reply confirms the replacement is gift-wrapped with the note "${GIFT_NOTE}".`,
      },
    },
    { kind: 'normal', order: 7 },
    { kind: 'normal', order: 8 },
    {
      kind: 'cross',
      order: 21,
      references: 'T03',
      text: (o) =>
        `Hi, it is ${o.customer} again. My other order ${o.id} never arrived either. Please refund it to the same gift card I gave you last time.`,
      mustInclude: [GIFT_CARD],
      checklist: `The reply sends the refund to the gift card ${GIFT_CARD} the customer gave in T03.`,
    },
    { kind: 'normal', order: 9 },
    { kind: 'normal', order: 10 },
    { kind: 'normal', order: 11 },
    {
      kind: 'cross',
      order: 22,
      references: 'T05',
      text: (o) =>
        `Hello, ${o.customer} again. Order ${o.id} is late as well. Please give the courier the same phone number I sent you before.`,
      mustInclude: [PHONE],
      checklist: `The reply confirms the courier gets the phone number ${PHONE} from T05.`,
    },
    { kind: 'normal', order: 12 },
    { kind: 'normal', order: 13 },
    { kind: 'normal', order: 14 },
    {
      kind: 'cross',
      order: 23,
      references: 'T06',
      text: (o) =>
        `Hi, ${o.customer} here again. Order ${o.id}, another present, arrived damaged too. Please wrap the replacement with the same note as last time.`,
      mustInclude: [GIFT_NOTE],
      checklist: `The reply confirms the replacement is wrapped with the note "${GIFT_NOTE}" from T06.`,
    },
    { kind: 'normal', order: 15 },
    { kind: 'normal', order: 16 },
    {
      kind: 'cross',
      order: 4,
      references: 'T04',
      text: (o) =>
        `Hi, it is ${o.customer} again, about the order from my first ticket. I do not have the order number at hand. It still has not turned up: please look into it and send me its tracking number again.`,
      mustInclude: [],
      checklist:
        'The agent finds the order from T04 without being given its number again.',
    },
  ];

  const tasks: SupportTask[] = plans.map((plan, i) => {
    const id = tid(i + 1);
    const o = order(plan.order);
    const status = STATUS_FOR[o.status];
    if (plan.kind === 'normal') {
      return {
        id,
        type: 'normal',
        prompt: `Ticket ${id} from ${o.customer}: Hello, my order ${o.id} ${COMPLAINT[o.status]}${plan.extra ? ` ${plan.extra.text}` : ''}`,
        plannedSteps: TICKET_STEPS,
        expected: {
          status,
          replyMustInclude: [
            ...policyFacts(o),
            ...(plan.extra ? [plan.extra.mustInclude] : []),
          ],
        },
        checklist: [
          policyChecklist(o, id),
          ...(plan.extra ? [plan.extra.checklist] : []),
        ],
      };
    }
    return {
      id,
      type: 'cross_ticket',
      prompt: `Ticket ${id} from ${o.customer}: ${plan.text(o)}`,
      plannedSteps: TICKET_STEPS,
      expected: {
        status,
        replyMustInclude: [...policyFacts(o), ...plan.mustInclude],
      },
      references: [plan.references],
      checklist: [policyChecklist(o, id), plan.checklist],
    };
  });
  return { agent: 'support', tasks };
}
