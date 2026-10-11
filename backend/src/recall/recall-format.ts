/** One parsim_recall call the model made. */
export type RecallCall = {
  /** The tool call id ("" when the format has none, as in Gemini). */
  id: string;
  archiveId: string;
};

/** The model's turn in one upstream response, as Parsim needs it. */
export type AssistantTurn = {
  recallCalls: RecallCall[];
  /** Tool calls for the client's own tools. */
  clientToolCalls: number;
  /**
   * The assistant message to send back in the follow-up request, already
   * reduced to its text, thinking and parsim_recall calls.
   */
  followUpMessage: Record<string, unknown>;
};

/** The answer to one recall call. */
export type RecallResult = { call: RecallCall; text: string };

/** One parsed SSE event from upstream. */
export type StreamEvent = {
  /** The event exactly as received, including its trailing separator. */
  raw: string;
  /** The `event:` name, if any (Anthropic). */
  name: string | null;
  /** Parsed JSON data, "[DONE]", or null when the event has no JSON data. */
  data: Record<string, unknown> | '[DONE]' | null;
};

/**
 * Watches one streamed response. It decides, event by event, whether the
 * event can go to the client now or must be held because a tool call has
 * started (it may be parsim_recall), and builds the assistant turn.
 */
export interface StreamWatcher {
  /** True to forward the event now, false to hold it. */
  push(event: StreamEvent): boolean;
  /** The assistant turn, once the stream has ended. */
  turn(): AssistantTurn;
  /** Content blocks already forwarded to the client (Anthropic indexes). */
  readonly forwardedBlocks: number;
}

/**
 * Rewrites events of a follow-up stream so the client sees one continuous
 * response. Returns the event text to send, or null to drop it.
 */
export type StreamSplicer = (event: StreamEvent) => string | null;

/** The parsim_recall handling for one client API format. */
export interface RecallFormat {
  /** Adds the parsim_recall tool and the system line to a request body. */
  inject(body: Record<string, unknown>): Record<string, unknown>;
  /** The assistant turn of a non-streamed response, or null if it has none. */
  turnFromResponse(response: unknown): AssistantTurn | null;
  newStreamWatcher(): StreamWatcher;
  /**
   * A splicer for the follow-up stream, given the first response's id
   * information and how many content blocks the client already received.
   */
  newSplicer(context: SpliceContext): StreamSplicer;
  /**
   * The follow-up request: the previous request plus the assistant turn
   * and one tool result per recall call. `final` turns tool use off, so
   * the model has to answer.
   */
  followUp(
    body: Record<string, unknown>,
    turn: AssistantTurn,
    results: RecallResult[],
    final: boolean,
  ): Record<string, unknown>;
}

export type SpliceContext = {
  /** The id of the first streamed response (OpenAI chunk id). */
  responseId: string | null;
  /** Content blocks the client has already received (Anthropic). */
  blockOffset: number;
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Replaces the data line of an SSE event, keeping its other lines. */
export function withData(event: StreamEvent, data: unknown): string {
  const separator = /(\r\n\r\n|\n\n|\r\r)$/.exec(event.raw)?.[1] ?? '\n\n';
  const others = event.raw
    .slice(0, event.raw.length - separator.length)
    .split(/\r\n|\n|\r/)
    .filter((line) => line && !line.startsWith('data:'));
  return [...others, `data: ${JSON.stringify(data)}`].join('\n') + separator;
}
