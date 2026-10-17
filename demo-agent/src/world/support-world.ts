import { Random } from './random.js';

/**
 * The support agent's synthetic shop: orders with verbose shipping
 * histories, all invented and generated from a fixed seed.
 */

export const SUPPORT_SEED = 2207;

export const ORDER_STATUSES = [
  'delayed',
  'damaged',
  'lost',
  'delivered',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Order = {
  id: string;
  customer: string;
  items: { name: string; quantity: number; price: number }[];
  total: number;
  status: OrderStatus;
  trackingNumber: string;
  promisedDate: string;
  events: string[];
};

const CUSTOMERS = [
  'Ada Lindqvist',
  'Bram Okafor',
  'Celine Marsh',
  'Dario Venn',
  'Elif Kaya',
  'Farid Haddad',
  'Greta Sollie',
  'Hiro Tanabe',
  'Ines Pereira',
  'Jonas Brekke',
  'Kemi Adeyemi',
  'Lior Ben-Ami',
  'Mira Castell',
  'Nils Aaberg',
] as const;
const PRODUCTS = [
  ['Trail lantern', 34.5],
  ['Insulated flask', 22],
  ['Merino base layer', 58],
  ['Folding stool', 41.25],
  ['Dry bag, 20 l', 19.9],
  ['Camp stove', 89],
  ['Headlamp', 27.75],
  ['Sleeping mat', 64.4],
  ['Rain shell', 129],
  ['Water filter', 45.6],
] as const;
const HUBS = ['RIX-2', 'OSL-1', 'HAM-4', 'GDN-3', 'ARN-1'] as const;

/** Statuses of orders 1 to 24, chosen so every policy appears several times. */
const STATUS_PLAN: OrderStatus[] = [
  'delayed',
  'damaged',
  'lost',
  'delivered',
  'delayed',
  'damaged',
  'delivered',
  'lost',
  'delayed',
  'damaged',
  'delayed',
  'delivered',
  'lost',
  'damaged',
  'delayed',
  'delivered',
  'damaged',
  'lost',
  'delayed',
  'delivered',
  // Orders 21 to 23 belong to returning customers (cross-ticket cases).
  'lost',
  'delayed',
  'damaged',
  'delivered',
];

/** Orders 21 to 23 (0-based 20 to 22) are placed by the customers of orders 3, 5 and 6. */
const RETURNING_CUSTOMER: Record<number, number> = { 20: 2, 21: 4, 22: 5 };

const money = (value: number) => Math.round(value * 100) / 100;

export function buildOrders(seed = SUPPORT_SEED): Order[] {
  const random = new Random(seed);
  return STATUS_PLAN.map((status, i) => {
    const items = random
      .sample(PRODUCTS, random.int(2, 4))
      .map(([name, price]) => ({
        name,
        quantity: random.int(1, 3),
        price,
      }));
    const total = money(
      items.reduce((sum, item) => sum + item.quantity * item.price, 0),
    );
    const day = random.int(1, 20);
    const events: string[] = [];
    const hubs = random.sample(HUBS, 3);
    for (let e = 0; e < random.int(8, 12); e++) {
      const hub = hubs[e % hubs.length] ?? 'RIX-2';
      events.push(
        `2026-09-${String(day + Math.floor(e / 2)).padStart(2, '0')} ${String(6 + e).padStart(2, '0')}:${String(random.int(0, 59)).padStart(2, '0')} ${hub}: ${random.pick(
          [
            'Parcel scanned at sorting hub',
            'Departed facility',
            'Arrived at facility',
            'Customs data received',
            'Loaded onto linehaul vehicle',
            'Sorted for regional delivery',
            'Address label verified',
            'Weight check completed',
          ] as const,
        )}`,
      );
    }
    const final: Record<OrderStatus, string> = {
      delayed: 'Delivery postponed: carrier backlog, new date not confirmed',
      damaged: 'Delivered; customer reported the parcel damaged on arrival',
      lost: 'Carrier declared the parcel lost in transit',
      delivered: 'Delivered to the front door, signed by driver',
    };
    events.push(`2026-09-28 18:02 ${hubs[0] ?? 'RIX-2'}: ${final[status]}`);
    return {
      id: `O-${2001 + i}`,
      customer:
        CUSTOMERS[(RETURNING_CUSTOMER[i] ?? i) % CUSTOMERS.length] ??
        'Ada Lindqvist',
      items,
      total,
      status,
      trackingNumber: `TRK${random.int(100000, 999999)}${String.fromCharCode(65 + (i % 26))}`,
      promisedDate: `2026-09-${String(day + 3).padStart(2, '0')}`,
      events,
    };
  });
}

export class SupportWorld {
  readonly orders: Order[];

  constructor(seed = SUPPORT_SEED) {
    this.orders = buildOrders(seed);
  }

  order(id: string): Order | null {
    return this.orders.find((o) => o.id === normalizeOrderId(id)) ?? null;
  }

  /** What lookup_order returns: a verbose record, like a real order system. */
  orderRecord(id: string): string {
    const order = this.order(id);
    if (!order) return `No order found with id ${normalizeOrderId(id)}.`;
    return [
      `Order ${order.id}`,
      `Customer: ${order.customer}`,
      `Status: ${order.status}`,
      `Promised delivery: ${order.promisedDate}`,
      `Tracking number: ${order.trackingNumber}`,
      'Items:',
      ...order.items.map(
        (item) =>
          `- ${item.quantity} x ${item.name} at ${item.price.toFixed(2)} EUR`,
      ),
      `Order total: ${order.total.toFixed(2)} EUR`,
      'Shipping history:',
      ...order.events.map((event) => `- ${event}`),
    ].join('\n');
  }
}

/** "o-2003 " and "O2003" both mean O-2003: the canonical form for recordings. */
export function normalizeOrderId(id: string): string {
  const digits = /(\d{3,})/.exec(id)?.[1];
  return digits ? `O-${digits}` : id.trim().toUpperCase();
}
