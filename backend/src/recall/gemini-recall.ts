import {
  AssistantTurn,
  isObject,
  RecallFormat,
  RecallResult,
  StreamEvent,
  StreamSplicer,
  StreamWatcher,
} from './recall-format';
import {
  archiveIdFrom,
  RECALL_SYSTEM_LINE,
  RECALL_TOOL_DESCRIPTION,
  RECALL_TOOL_NAME,
  RECALL_TOOL_SCHEMA,
} from './recall-tool';

type Part = Record<string, unknown>;

const call = (part: Part) =>
  isObject(part.functionCall) ? part.functionCall : null;

function turnOf(parts: Part[]): AssistantTurn {
  const isRecall = (p: Part) => call(p)?.name === RECALL_TOOL_NAME;
  const recall = parts.filter(isRecall);
  return {
    recallCalls: recall.map((p) => ({
      id: typeof call(p)?.id === 'string' ? (call(p)!.id as string) : '',
      archiveId: archiveIdFrom(call(p)?.args),
    })),
    clientToolCalls: parts.filter((p) => call(p) && !isRecall(p)).length,
    followUpMessage: {
      role: 'model',
      parts: parts.filter((p) => !call(p) || isRecall(p)),
    },
  };
}

function partsOf(response: unknown): Part[] | null {
  const candidate = isObject(response)
    ? (response.candidates as unknown[] | undefined)?.[0]
    : undefined;
  const content = isObject(candidate) ? candidate.content : undefined;
  return isObject(content) && Array.isArray(content.parts)
    ? content.parts.filter(isObject)
    : null;
}

/** Gemini sends whole parts per chunk; holds from the first functionCall. */
class GeminiStreamWatcher implements StreamWatcher {
  readonly forwardedBlocks = 0;
  private holding = false;
  private readonly parts: Part[] = [];

  push(event: StreamEvent): boolean {
    const parts = partsOf(event.data) ?? [];
    if (parts.some(call)) this.holding = true;
    this.parts.push(...parts);
    return !this.holding;
  }

  turn(): AssistantTurn {
    return turnOf(this.parts);
  }
}

const DECLARATION = {
  name: RECALL_TOOL_NAME,
  description: RECALL_TOOL_DESCRIPTION,
  parameters: RECALL_TOOL_SCHEMA,
};

/**
 * Adds parsim_recall to the first tool with functionDeclarations, or as a
 * new tool. Gemini rejects some mixes of several tool objects, so an
 * existing declarations list is extended rather than a second one added.
 */
function withRecallTool(tools: unknown): unknown[] {
  const list = Array.isArray(tools) ? [...tools] : [];
  const index = list.findIndex(
    (t) => isObject(t) && Array.isArray(t.functionDeclarations),
  );
  if (index === -1) return [...list, { functionDeclarations: [DECLARATION] }];
  const tool = list[index] as Record<string, unknown>;
  list[index] = {
    ...tool,
    functionDeclarations: [
      ...(tool.functionDeclarations as unknown[]),
      DECLARATION,
    ],
  };
  return list;
}

/**
 * Gemini native. The declaration joins the client's functionDeclarations
 * and the line is appended to systemInstruction's parts.
 */
export const geminiRecall: RecallFormat = {
  inject(body) {
    const instruction = isObject(body.systemInstruction)
      ? body.systemInstruction
      : null;
    const parts = Array.isArray(instruction?.parts) ? instruction.parts : [];
    return {
      ...body,
      systemInstruction: {
        ...(instruction ?? {}),
        parts: [...parts, { text: RECALL_SYSTEM_LINE }],
      },
      tools: withRecallTool(body.tools),
    };
  },

  turnFromResponse(response) {
    const parts = partsOf(response);
    return parts ? turnOf(parts) : null;
  },

  newStreamWatcher: () => new GeminiStreamWatcher(),

  // Gemini chunks carry no ids or indexes: follow-up chunks pass as they are.
  newSplicer: (): StreamSplicer => (event) => event.raw,

  followUp(body, turn: AssistantTurn, results: RecallResult[], final) {
    const contents = Array.isArray(body.contents) ? body.contents : [];
    const toolConfig = isObject(body.toolConfig) ? body.toolConfig : {};
    return {
      ...body,
      contents: [
        ...contents,
        turn.followUpMessage,
        {
          role: 'user',
          parts: results.map((r) => ({
            functionResponse: {
              ...(r.call.id && { id: r.call.id }),
              name: RECALL_TOOL_NAME,
              response: { output: r.text },
            },
          })),
        },
      ],
      ...(final && {
        toolConfig: {
          ...toolConfig,
          functionCallingConfig: { mode: 'NONE' },
        },
      }),
    };
  },
};
