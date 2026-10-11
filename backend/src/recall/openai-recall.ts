import {
  AssistantTurn,
  isObject,
  RecallFormat,
  RecallResult,
  SpliceContext,
  StreamEvent,
  StreamSplicer,
  StreamWatcher,
  withData,
} from './recall-format';
import {
  archiveIdFrom,
  RECALL_SYSTEM_LINE,
  RECALL_TOOL_DESCRIPTION,
  RECALL_TOOL_NAME,
  RECALL_TOOL_SCHEMA,
} from './recall-tool';

type ToolCall = { id: string; name: string; arguments: string };

const SYSTEM_ROLES = new Set(['system', 'developer']);

function turnOf(content: unknown, calls: ToolCall[]): AssistantTurn {
  const recall = calls.filter((c) => c.name === RECALL_TOOL_NAME);
  return {
    recallCalls: recall.map((c) => ({
      id: c.id,
      archiveId: archiveIdFrom(c.arguments),
    })),
    clientToolCalls: calls.length - recall.length,
    followUpMessage: {
      role: 'assistant',
      content: typeof content === 'string' && content ? content : null,
      tool_calls: recall.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      })),
    },
  };
}

/** Holds back tool call chunks and everything after them. */
class OpenAiStreamWatcher implements StreamWatcher {
  readonly forwardedBlocks = 0;
  private holding = false;
  private content = '';
  private readonly calls: ToolCall[] = [];

  push(event: StreamEvent): boolean {
    const choice = isObject(event.data)
      ? (event.data.choices as unknown[] | undefined)?.[0]
      : undefined;
    const delta = isObject(choice) ? choice.delta : undefined;
    if (isObject(delta)) {
      if (typeof delta.content === 'string') this.content += delta.content;
      if (Array.isArray(delta.tool_calls)) {
        this.holding = true;
        for (const part of delta.tool_calls) this.addCallDelta(part);
      }
    }
    return !this.holding;
  }

  turn(): AssistantTurn {
    return turnOf(this.content, this.calls.filter(Boolean));
  }

  private addCallDelta(part: unknown): void {
    if (!isObject(part)) return;
    const index = typeof part.index === 'number' ? part.index : 0;
    const call = (this.calls[index] ??= { id: '', name: '', arguments: '' });
    if (typeof part.id === 'string') call.id = part.id;
    const fn = isObject(part.function) ? part.function : {};
    if (typeof fn.name === 'string') call.name += fn.name;
    if (typeof fn.arguments === 'string') call.arguments += fn.arguments;
  }
}

/**
 * OpenAI chat completions (also Gemini's OpenAI-compatible endpoint).
 * The tool is appended to `tools`; the system line is a system message
 * right after the client's leading system messages.
 */
export const openAiRecall: RecallFormat = {
  inject(body) {
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const messages = Array.isArray(body.messages) ? [...body.messages] : [];
    let at = 0;
    while (
      at < messages.length &&
      isObject(messages[at]) &&
      SYSTEM_ROLES.has((messages[at] as { role?: unknown }).role as string)
    ) {
      at += 1;
    }
    messages.splice(at, 0, { role: 'system', content: RECALL_SYSTEM_LINE });
    return {
      ...body,
      messages,
      tools: [
        ...tools,
        {
          type: 'function',
          function: {
            name: RECALL_TOOL_NAME,
            description: RECALL_TOOL_DESCRIPTION,
            parameters: RECALL_TOOL_SCHEMA,
          },
        },
      ],
    };
  },

  turnFromResponse(response) {
    const choice = isObject(response)
      ? (response.choices as unknown[] | undefined)?.[0]
      : undefined;
    const message = isObject(choice) ? choice.message : undefined;
    if (!isObject(message)) return null;
    const calls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .filter(isObject)
      .map((c): ToolCall => {
        const fn = isObject(c.function) ? c.function : {};
        return {
          id: typeof c.id === 'string' ? c.id : '',
          name: typeof fn.name === 'string' ? fn.name : '',
          arguments: typeof fn.arguments === 'string' ? fn.arguments : '',
        };
      });
    return turnOf(message.content, calls);
  },

  newStreamWatcher: () => new OpenAiStreamWatcher(),

  newSplicer({ responseId }: SpliceContext): StreamSplicer {
    // Follow-up chunks keep the first response's id, so the client sees one completion.
    return (event) =>
      isObject(event.data) && responseId && event.data.id !== responseId
        ? withData(event, { ...event.data, id: responseId })
        : event.raw;
  },

  followUp(body, turn: AssistantTurn, results: RecallResult[], final) {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    return {
      ...body,
      messages: [
        ...messages,
        turn.followUpMessage,
        ...results.map((r) => ({
          role: 'tool',
          tool_call_id: r.call.id,
          content: r.text,
        })),
      ],
      ...(final && { tool_choice: 'none' }),
    };
  },
};
