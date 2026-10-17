import type { ContextStrategy } from '../agent/context-strategy.js';
import type { ChatMessage, ChatModel, Usage } from '../llm/types.js';

/**
 * The two naive baselines Parsim is compared against, as client-side
 * context strategies. Both use the same N (and summarize the same M), from
 * config.
 *
 * A turn starts at an assistant message and includes the tool results and
 * user messages after it, as in Parsim's GC. Cutting only at turn starts
 * keeps every tool call with its result.
 */

/** Index of the first message of each turn (each assistant message). */
export function turnStarts(history: readonly ChatMessage[]): number[] {
  return history.flatMap((m, i) => (m.role === 'assistant' ? [i] : []));
}

/** The start of the last `n` turns, or null if there are no more than `n`. */
function tailStart(history: readonly ChatMessage[], n: number): number | null {
  const starts = turnStarts(history);
  return starts.length > n ? starts[starts.length - n]! : null;
}

/** The system prompt and the first user message (the run's first goal). */
function head(history: readonly ChatMessage[]): {
  messages: ChatMessage[];
  end: number;
} {
  const firstUser = history.findIndex((m) => m.role === 'user');
  const end = firstUser >= 0 ? firstUser + 1 : Math.min(1, history.length);
  return { messages: history.slice(0, end), end };
}

/**
 * Naive truncation: keeps the system prompt, the first user goal and the
 * last N turns; everything in between is dropped.
 */
export class TruncateStrategy implements ContextStrategy {
  readonly name = 'truncate';

  constructor(readonly turns: number) {}

  build(history: readonly ChatMessage[]): Promise<ChatMessage[]> {
    const tail = tailStart(history, this.turns);
    const { messages, end } = head(history);
    if (tail === null || tail <= end) return Promise.resolve([...history]);
    return Promise.resolve([...messages, ...history.slice(tail)]);
  }
}

export const SUMMARY_INSTRUCTIONS =
  'Summarize the conversation below for an assistant that will continue it without seeing it. Keep every fact that may matter later: names, numbers, ids, amounts, dates and details customers gave. Be brief and factual. Reply with the summary only.';

/** Renders messages as plain text for the summarizer. */
export function transcript(messages: readonly ChatMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === 'tool') return `Tool result (${m.name}):\n${m.content}`;
      if (m.role === 'assistant') {
        const calls = m.toolCalls
          .map((c) => `[calls ${c.name} ${JSON.stringify(c.arguments)}]`)
          .join('\n');
        return `Assistant:\n${[m.content, calls].filter(Boolean).join('\n')}`;
      }
      return `${m.role === 'system' ? 'System' : 'User'}:\n${m.content}`;
    })
    .join('\n\n');
}

/**
 * Naive summarization: keeps the system prompt, the first user goal, one
 * summary of everything older than the last N turns, and those turns. The
 * summary is made by the internal model and refreshed once M more turns
 * have aged out of the tail since the last one; between refreshes the same
 * summary is reused.
 */
export class SummarizeStrategy implements ContextStrategy {
  readonly name = 'summarize';
  /** Usage of the summary calls (part of the arm's net cost). */
  readonly usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  };
  summaryCalls = 0;
  private summary: { text: string; coveredTurns: number } | null = null;

  constructor(
    readonly turns: number,
    readonly refreshEvery: number,
    private readonly model: ChatModel,
    private readonly sessionId: string,
  ) {}

  async build(history: readonly ChatMessage[]): Promise<ChatMessage[]> {
    const tail = tailStart(history, this.turns);
    const { messages, end } = head(history);
    if (tail === null || tail <= end) return [...history];
    const aged = turnStarts(history).filter((s) => s < tail).length;
    if (
      !this.summary ||
      aged - this.summary.coveredTurns >= this.refreshEvery
    ) {
      await this.summarize(history.slice(end, tail), aged);
    }
    return [
      ...messages,
      {
        role: 'user',
        content: `[Summary of the earlier conversation]\n${this.summary!.text}`,
      },
      ...history.slice(tail),
    ];
  }

  private async summarize(older: readonly ChatMessage[], aged: number) {
    const turn = await this.model.complete({
      messages: [
        { role: 'system', content: SUMMARY_INSTRUCTIONS },
        { role: 'user', content: transcript(older) },
      ],
      tools: [],
      sessionId: `${this.sessionId}-summary`,
    });
    this.summaryCalls += 1;
    if (turn.usage) {
      this.usage.inputTokens += turn.usage.inputTokens;
      this.usage.outputTokens += turn.usage.outputTokens;
      this.usage.cachedInputTokens += turn.usage.cachedInputTokens;
    }
    this.summary = {
      text: turn.text.trim() || '(no summary)',
      coveredTurns: aged,
    };
  }
}
