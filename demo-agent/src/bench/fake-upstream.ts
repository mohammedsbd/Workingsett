import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SUMMARY_INSTRUCTIONS } from './strategies.js';

/**
 * A scripted model behind an OpenAI-format endpoint (/v1/chat/completions),
 * for dry runs: the whole benchmark pipeline runs, through Parsim or not,
 * with no real model call.
 *
 * It plays a careful agent that only knows what is in the request it gets.
 * So the context strategies matter as they would with a real model: if a
 * fact was cut from the context, the scripted agent cannot use it. When it
 * sees Parsim's archive stubs and the parsim_recall tool, it recalls them.
 */

type Msg = {
  role: string;
  content?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};
type Body = {
  model?: string;
  messages?: Msg[];
  tools?: { function?: { name?: string } }[];
};

type Call = { name: string; args: Record<string, unknown> };
type Reply = { text: string; calls: Call[] };

const ARCHIVE_STUB = /\[parsim archived: [^\]]*?, id (arc_[0-9a-f]{16})\]/g;

const text = (m: Msg) => (typeof m.content === 'string' ? m.content : '');

function lastUserIndex(messages: Msg[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (
      messages[i]?.role === 'user' &&
      !text(messages[i]!).startsWith('[Summary')
    ) {
      return i;
    }
  }
  return -1;
}

/** Everything visible in the request, as one string. */
function visible(messages: Msg[]): string {
  return messages.map(text).join('\n');
}

/**
 * Messages since the task started, without Parsim's recall round trips
 * (Parsim answers parsim_recall itself; the agent's own steps are the rest).
 */
function ownSince(messages: Msg[], at: number) {
  const since = messages.slice(at + 1);
  const recallIds = new Set(
    since.flatMap((m) =>
      (m.tool_calls ?? [])
        .filter((c) => c.function.name === 'parsim_recall')
        .map((c) => c.id),
    ),
  );
  return {
    tools: since.filter(
      (m) => m.role === 'tool' && !recallIds.has(m.tool_call_id ?? ''),
    ),
    steps: since.filter(
      (m) =>
        m.role === 'assistant' &&
        !(
          m.tool_calls?.length &&
          m.tool_calls.every((c) => c.function.name === 'parsim_recall')
        ),
    ),
  };
}

/** The archive id of the first fetch of a site's page, if it was archived. */
function siteStub(messages: Msg[], site: string): string | undefined {
  const slug = site.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const callIds = new Set(
    messages.flatMap((m) =>
      (m.tool_calls ?? [])
        .filter(
          (c) =>
            c.function.name === 'fetch_page' &&
            c.function.arguments.includes(`/sites/${slug}`),
        )
        .map((c) => c.id),
    ),
  );
  for (const m of messages) {
    if (m.role !== 'tool' || !callIds.has(m.tool_call_id ?? '')) continue;
    const id = [...text(m).matchAll(ARCHIVE_STUB)][0]?.[1];
    if (id) return id;
  }
  return undefined;
}

/** Archive stubs present, not yet recalled in this request. */
function unrecalledStubs(messages: Msg[], tools: string[]): string[] {
  if (!tools.includes('parsim_recall')) return [];
  const all = [...visible(messages).matchAll(ARCHIVE_STUB)].map((m) => m[1]!);
  const recalled = new Set(
    messages.flatMap((m) =>
      (m.tool_calls ?? [])
        .filter((c) => c.function.name === 'parsim_recall')
        .map(
          (c) =>
            (JSON.parse(c.function.arguments) as { archive_id: string })
              .archive_id,
        ),
    ),
  );
  return [...new Set(all)].filter((id) => !recalled.has(id));
}

function supportTurn(messages: Msg[], tools: string[]): Reply {
  const at = lastUserIndex(messages);
  const ticketText = text(messages[at]!);
  const ticket = /Ticket (T\d{2})/.exec(ticketText)?.[1] ?? 'T00';
  const customer = /from ([^:]+):/.exec(ticketText)?.[1]?.trim() ?? '';
  const tools_ = ownSince(messages, at).tools;
  let orderId = /O-\d{4}/.exec(ticketText)?.[0];
  if (!orderId) {
    // "the order from my first ticket": only findable if still in context
    // (an earlier ticket, or an order record of this customer).
    const all = visible(messages);
    orderId =
      new RegExp(`Ticket T\\d{2} from ${customer}:[^\\n]*?(O-\\d{4})`).exec(
        all,
      )?.[1] ??
      new RegExp(`Order (O-\\d{4})\\nCustomer: ${customer}`).exec(all)?.[1];
  }
  if (tools_.length === 0) {
    if (!orderId) {
      const stubs = unrecalledStubs(messages, tools);
      if (stubs.length) {
        return {
          text: '',
          calls: [{ name: 'parsim_recall', args: { archive_id: stubs[0] } }],
        };
      }
    }
    return {
      text: '',
      calls: [
        { name: 'lookup_order', args: { order_id: orderId ?? 'unknown' } },
      ],
    };
  }
  const record = text(tools_[0]!);
  const status = /Status: (\w+)/.exec(record)?.[1] ?? 'unknown';
  const total = Number(/Order total: ([\d.]+)/.exec(record)?.[1] ?? 0);
  const tracking = /Tracking number: (\S+)/.exec(record)?.[1] ?? '';
  const policy: Record<string, [string, string]> = {
    delayed: ['credited', `a credit of ${(total * 0.1).toFixed(2)} EUR`],
    damaged: ['replacement_sent', `a replacement for ${orderId}`],
    lost: ['refunded', `a refund of ${total.toFixed(2)} EUR`],
    delivered: [
      'investigating',
      `an investigation; tracking number ${tracking}`,
    ],
  };
  const [newStatus, offer] = policy[status] ?? [
    'investigating',
    'an investigation',
  ];
  if (tools_.length === 1) {
    return {
      text: '',
      calls: [
        {
          name: 'update_ticket',
          args: { ticket_id: ticket, status: newStatus },
        },
      ],
    };
  }
  if (tools_.length === 2) {
    // Honour details this customer gave, if they are still in context.
    const mine = visible(
      messages.filter((m) => m.role === 'user' && text(m).includes(customer)),
    );
    const details = [
      /gift card (GC-[\w-]+)/.exec(mine)?.[1],
      /phone number (\+[\d ]+\d)/.exec(mine)?.[1],
      /note "([^"]+)"/.exec(mine)?.[1],
    ].filter(Boolean);
    return {
      text: '',
      calls: [
        {
          name: 'send_reply',
          args: {
            ticket_id: ticket,
            message: `Hello ${customer}, we have arranged ${offer}.${details.length ? ` Noted: ${details.join(', ')}.` : ''}`,
          },
        },
      ],
    };
  }
  return { text: `Handled ${ticket}: ${newStatus}.`, calls: [] };
}

function researchTurn(messages: Msg[], tools: string[]): Reply {
  const at = lastUserIndex(messages);
  const question = text(messages[at]!);
  const id = /Question (q\d{2})/.exec(question)?.[1] ?? 'q00';
  const site = /"([^"]+)"/.exec(question)?.[1] ?? '';
  const own = ownSince(messages, at);
  const results = own.tools.map(text);
  const done = own.steps.length;
  const save = (answer: string): Reply => ({
    text: '',
    calls: [{ name: 'save_report', args: { question_id: id, answer } }],
  });
  if (/first read it/.test(question)) {
    // Late recall: the figure from the first reading, if still in context.
    const first = new RegExp(
      `# ${site}\\s+Site profile, revision 1\\.[\\s\\S]*?Storage capacity: (\\d+) MWh`,
    ).exec(visible(messages));
    if (done === 0 && first) return save(`${first[1]} MWh`);
    if (done === 0) {
      // Like a real model: recall the stub that answered this site's
      // page fetch (the call's URL is still in the conversation).
      const stub = siteStub(messages, site);
      const pending = unrecalledStubs(messages, tools);
      if (stub && pending.includes(stub)) {
        return {
          text: '',
          calls: [{ name: 'parsim_recall', args: { archive_id: stub } }],
        };
      }
      return save('unknown');
    }
    return { text: `Saved the answer to ${id}.`, calls: [] };
  }
  const urls = results.flatMap((r) =>
    [...r.matchAll(/https:\/\/\S+/g)].map((m) => m[0]),
  );
  const page = results.join('\n');
  const steps: (() => Reply)[] = [
    () => ({
      text: '',
      calls: [{ name: 'web_search', args: { query: site } }],
    }),
    () => ({
      text: '',
      calls: [{ name: 'fetch_page', args: { url: urls[0] ?? '' } }],
    }),
    () => ({
      text: '',
      calls: [{ name: 'fetch_page', args: { url: urls[1] ?? '' } }],
    }),
    () => ({
      text: '',
      calls: [
        {
          name: 'take_note',
          args: { note: `${site}: read site and news pages` },
        },
      ],
    }),
    () => {
      const answer = /efficiency/.test(question)
        ? /Round-trip efficiency: (\d+)%/.exec(page)?.[1]?.concat('%')
        : /commissioned/.test(question)
          ? /Commissioned: (\d{4})/.exec(page)?.[1]
          : /operates/.test(question)
            ? /operated by ([^.]+)\./.exec(page)?.[1]
            : /supplies/.test(question)
              ? /supplied by ([^.]+)\./.exec(page)?.[1]
              : /The site is in ([^.]+)\./.exec(page)?.[1];
      return save(answer ?? 'unknown');
    },
    () => ({ text: `Saved the answer to ${id}.`, calls: [] }),
  ];
  return steps[Math.min(done, steps.length - 1)]!();
}

function summaryTurn(messages: Msg[]): Reply {
  // A summary that keeps some facts and loses others, like a real one.
  const source = visible(messages);
  const keep = [
    ...source.matchAll(/(Ticket T\d{2} from [^:]+: [^\n]{0,120})/g),
    ...source.matchAll(/(Order total: [\d.]+ EUR|Status: \w+)/g),
    ...source.matchAll(/(# [A-Z][a-z]+ [A-Z][a-z]+\n)/g),
  ].map((m) => m[1]!.trim());
  return {
    text: keep.slice(0, 40).join('\n') || 'Nothing to keep.',
    calls: [],
  };
}

export function scriptedReply(body: Body): Reply {
  const messages = body.messages ?? [];
  const tools = (body.tools ?? []).map((t) => t.function?.name ?? '');
  if (text(messages[0] ?? { role: 'system' }) === SUMMARY_INSTRUCTIONS) {
    return summaryTurn(messages);
  }
  if (/You are grading/.test(text(messages[0] ?? { role: 'system' }))) {
    return { text: '{"passed": true, "reason": "scripted judge"}', calls: [] };
  }
  return tools.includes('lookup_order')
    ? supportTurn(messages, tools)
    : researchTurn(messages, tools);
}

let callCounter = 0;

function completion(body: Body, reply: Reply) {
  const promptChars = JSON.stringify(body.messages ?? []).length;
  return {
    id: `chatcmpl-scripted-${++callCounter}`,
    object: 'chat.completion',
    created: 1_700_000_000,
    model: body.model ?? 'scripted-agent',
    choices: [
      {
        index: 0,
        finish_reason: reply.calls.length ? 'tool_calls' : 'stop',
        message: {
          role: 'assistant',
          content: reply.text || null,
          ...(reply.calls.length && {
            tool_calls: reply.calls.map((c) => ({
              id: `call_${++callCounter}`,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            })),
          }),
        },
      },
    ],
    usage: {
      prompt_tokens: Math.ceil(promptChars / 4),
      completion_tokens: 20 + reply.calls.length * 10,
      total_tokens: Math.ceil(promptChars / 4) + 20 + reply.calls.length * 10,
    },
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export class ScriptedUpstream {
  private server?: Server;
  requests = 0;

  /** Starts on `port` (0 = any free port). */
  async start(port = 0): Promise<string> {
    this.server = createServer((req, res) => {
      void (async () => {
        const raw = await readBody(req);
        if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'not found' } }));
          return;
        }
        this.requests += 1;
        const body = JSON.parse(raw || '{}') as Body;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(completion(body, scriptedReply(body))));
      })();
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(port, '127.0.0.1', () => resolve()),
    );
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
