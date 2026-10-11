import { StringDecoder } from 'node:string_decoder';
import { eventData } from '../proxy/streaming/sse-stream-filter';
import { StreamEvent } from './recall-format';

const EVENT_END = /\r\n\r\n|\n\n|\r\r/;

/** Splits an SSE byte stream into complete, parsed events. */
export class SseEventSplitter {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';

  /** Feeds bytes; returns the events completed by them. */
  push(chunk: Buffer): StreamEvent[] {
    this.pending += this.decoder.write(chunk);
    const events: StreamEvent[] = [];
    let match: RegExpExecArray | null;
    while ((match = EVENT_END.exec(this.pending))) {
      const end = match.index + match[0].length;
      events.push(parseEvent(this.pending.slice(0, end)));
      this.pending = this.pending.slice(end);
    }
    return events;
  }

  /** The last event, if the stream ended without a blank line. */
  flush(): StreamEvent[] {
    this.pending += this.decoder.end();
    const rest = this.pending;
    this.pending = '';
    return rest.trim() ? [parseEvent(rest)] : [];
  }
}

export function parseEvent(raw: string): StreamEvent {
  const name = /^event:\s*(.*)$/m.exec(raw)?.[1]?.trim() || null;
  const text = eventData(raw.replace(/(\r\n|\n|\r)+$/, ''));
  let data: StreamEvent['data'] = null;
  if (text === '[DONE]') data = '[DONE]';
  else if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      data = null;
    }
  }
  return { raw, name, data };
}
