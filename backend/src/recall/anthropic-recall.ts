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

type Block = Record<string, unknown>;

function turnOf(blocks: Block[]): AssistantTurn {
  const isToolUse = (b: Block) => b.type === 'tool_use';
  const isRecall = (b: Block) => isToolUse(b) && b.name === RECALL_TOOL_NAME;
  const recall = blocks.filter(isRecall);
  return {
    recallCalls: recall.map((b) => ({
      id: typeof b.id === 'string' ? b.id : '',
      archiveId: archiveIdFrom(b.input),
    })),
    clientToolCalls: blocks.filter(isToolUse).length - recall.length,
    // Text and thinking stay (thinking must be sent back with its signature).
    followUpMessage: {
      role: 'assistant',
      content: blocks.filter((b) => !isToolUse(b) || isRecall(b)),
    },
  };
}

/** Rebuilds content blocks from stream events; holds tool_use and later. */
class AnthropicStreamWatcher implements StreamWatcher {
  forwardedBlocks = 0;
  private holding = false;
  private readonly blocks: Block[] = [];
  private readonly json: string[] = [];

  push(event: StreamEvent): boolean {
    const data = isObject(event.data) ? event.data : null;
    const index = typeof data?.index === 'number' ? data.index : -1;
    if (data?.type === 'content_block_start' && isObject(data.content_block)) {
      const block = { ...data.content_block };
      if (block.type === 'tool_use') {
        this.holding = true;
        this.json[index] = '';
      }
      this.blocks[index] = block;
      if (!this.holding) this.forwardedBlocks += 1;
    } else if (data?.type === 'content_block_delta' && isObject(data.delta)) {
      this.applyDelta(index, data.delta);
    }
    return !this.holding;
  }

  turn(): AssistantTurn {
    const blocks = this.blocks.map((block, index) => {
      if (block.type !== 'tool_use') return block;
      let input: unknown = block.input ?? {};
      try {
        if (this.json[index]) input = JSON.parse(this.json[index]);
      } catch {
        input = {};
      }
      return { ...block, input };
    });
    return turnOf(blocks.filter(Boolean));
  }

  private applyDelta(index: number, delta: Record<string, unknown>): void {
    const block = this.blocks[index];
    if (!block) return;
    const append = (key: string, value: unknown) => {
      if (typeof value === 'string') {
        block[key] = (typeof block[key] === 'string' ? block[key] : '') + value;
      }
    };
    switch (delta.type) {
      case 'text_delta':
        append('text', delta.text);
        break;
      case 'thinking_delta':
        append('thinking', delta.thinking);
        break;
      case 'signature_delta':
        append('signature', delta.signature);
        break;
      case 'input_json_delta':
        if (typeof delta.partial_json === 'string') {
          this.json[index] = (this.json[index] ?? '') + delta.partial_json;
        }
        break;
    }
  }
}

function withRecallTool(tools: unknown): unknown[] {
  return [
    ...(Array.isArray(tools) ? tools : []),
    {
      name: RECALL_TOOL_NAME,
      description: RECALL_TOOL_DESCRIPTION,
      input_schema: RECALL_TOOL_SCHEMA,
    },
  ];
}

function withSystemLine(system: unknown): unknown {
  if (Array.isArray(system)) {
    return [...system, { type: 'text', text: RECALL_SYSTEM_LINE }];
  }
  if (typeof system === 'string' && system) {
    return `${system}\n\n${RECALL_SYSTEM_LINE}`;
  }
  return RECALL_SYSTEM_LINE;
}

/**
 * Anthropic Messages. The tool is appended to `tools` and the line to the
 * system prompt (a new text block after the client's blocks, so their
 * cache_control breakpoints stay where they are).
 */
export const anthropicRecall: RecallFormat = {
  inject(body) {
    return {
      ...body,
      system: withSystemLine(body.system),
      tools: withRecallTool(body.tools),
    };
  },

  turnFromResponse(response) {
    if (!isObject(response) || !Array.isArray(response.content)) return null;
    return turnOf(response.content.filter(isObject));
  },

  newStreamWatcher: () => new AnthropicStreamWatcher(),

  newSplicer({ blockOffset }: SpliceContext): StreamSplicer {
    return (event) => {
      const data = isObject(event.data) ? event.data : null;
      // The client already has a message_start from the first response.
      if (data?.type === 'message_start') return null;
      if (data && typeof data.index === 'number' && blockOffset) {
        return withData(event, { ...data, index: data.index + blockOffset });
      }
      return event.raw;
    };
  },

  followUp(body, turn: AssistantTurn, results: RecallResult[], final) {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    return {
      ...body,
      messages: [
        ...messages,
        turn.followUpMessage,
        {
          role: 'user',
          content: results.map((r) => ({
            type: 'tool_result',
            tool_use_id: r.call.id,
            content: r.text,
          })),
        },
      ],
      ...(final && { tool_choice: { type: 'none' } }),
    };
  },
};
