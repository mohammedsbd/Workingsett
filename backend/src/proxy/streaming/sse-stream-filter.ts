import { StringDecoder } from 'node:string_decoder';
import { TokenUsage } from '../../usage-records/domain/token-usage';

/**
 * Returns the usage after one parsed event, given the usage seen so far;
 * the adapter decides how (Anthropic spreads usage over several events).
 */
export type StreamUsageReader = (
  event: unknown,
  previous: TokenUsage | null,
) => TokenUsage | null;

const EVENT_SEPARATOR = /\r\n\r\n|\n\n|\r\r/;

/**
 * Passes an upstream SSE stream through to the client while reading token
 * usage from it.
 *
 * - Normal mode: bytes are forwarded exactly as they arrive. Events are only
 *   parsed on the side to find usage.
 * - Usage-injected mode (Parsim added stream_options.include_usage): each
 *   complete event is forwarded as soon as it is complete. Usage-only chunks
 *   (OpenAI's final `choices: []` chunk) are dropped, and a `usage` field on
 *   other chunks (Gemini puts it on every chunk, OpenAI sends `usage: null`)
 *   is removed, so the client sees what it would have seen without Parsim.
 *
 * Only the current incomplete event is ever held back, never the whole stream.
 */
export class SseStreamFilter {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private lastUsage: TokenUsage | null = null;

  constructor(
    private readonly readUsage: StreamUsageReader,
    private readonly usageInjected: boolean,
  ) {}

  /** The most recent usage seen in the stream. */
  get usage(): TokenUsage | null {
    return this.lastUsage;
  }

  /** Feeds upstream bytes; returns the bytes to send to the client now. */
  push(chunk: Buffer): Buffer {
    this.pending += this.decoder.write(chunk);
    const events = this.takeCompleteEvents();

    if (!this.usageInjected) {
      events.forEach(({ body }) => this.inspect(body));
      return chunk;
    }
    return Buffer.from(
      events
        .map(({ body, separator }) => this.filter(body, separator))
        .join(''),
      'utf8',
    );
  }

  /** Call at the end of the stream; returns any remaining bytes to send. */
  flush(): Buffer {
    this.pending += this.decoder.end();
    const rest = this.pending;
    this.pending = '';
    if (!rest) return Buffer.alloc(0);

    if (!this.usageInjected) {
      this.inspect(rest);
      return Buffer.alloc(0); // already forwarded byte for byte
    }
    return Buffer.from(this.filter(rest, ''), 'utf8');
  }

  private takeCompleteEvents(): { body: string; separator: string }[] {
    const events: { body: string; separator: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = EVENT_SEPARATOR.exec(this.pending))) {
      events.push({
        body: this.pending.slice(0, match.index),
        separator: match[0],
      });
      this.pending = this.pending.slice(match.index + match[0].length);
    }
    return events;
  }

  /** Records usage from an event and returns its parsed data, if JSON. */
  private inspect(event: string): Record<string, unknown> | null {
    const data = eventData(event);
    if (data === null || data === '[DONE]') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    this.lastUsage = this.readUsage(parsed, this.lastUsage) ?? this.lastUsage;
    return parsed as Record<string, unknown>;
  }

  private filter(event: string, separator: string): string {
    const parsed = this.inspect(event);
    if (!parsed || !('usage' in parsed)) return event + separator;

    const choices = parsed.choices;
    if (Array.isArray(choices) && choices.length === 0) {
      return ''; // usage-only chunk the client did not ask for
    }
    const withoutUsage = { ...parsed };
    delete withoutUsage.usage;
    const otherLines = event
      .split(/\r\n|\n|\r/)
      .filter((line) => line && !line.startsWith('data:'));
    return (
      [...otherLines, `data: ${JSON.stringify(withoutUsage)}`].join('\n') +
      separator
    );
  }
}

/** Joins the `data:` lines of one SSE event, or null if it has none. */
export function eventData(event: string): string | null {
  const lines = event
    .split(/\r\n|\n|\r/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  return lines.length ? lines.join('\n') : null;
}
