import { ProxyApi } from '../proxy/providers/provider-adapter';
import {
  ReplayAnswer,
  ReplayToolCall,
} from '../replay-results/domain/replay-result';
import { RECALL_TOOL_NAME } from '../recall/recall-tool';

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/** OpenAI sends arguments as a JSON string; anything unparsable stays text. */
function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * The text and tool calls of a non-streamed response, per client API.
 * Thinking is left out (it is not part of the answer) and so are
 * parsim_recall calls, which Parsim answers itself.
 */
export function extractAnswer(api: ProxyApi, response: unknown): ReplayAnswer {
  const body = asObject(response);
  let text = '';
  let toolCalls: ReplayToolCall[] = [];
  if (api === 'openai-chat') {
    const message = asObject(asObject(asArray(body.choices)[0]).message);
    text = typeof message.content === 'string' ? message.content : '';
    toolCalls = asArray(message.tool_calls).map((call) => {
      const fn = asObject(asObject(call).function);
      return {
        name: typeof fn.name === 'string' ? fn.name : '',
        arguments: parseArguments(fn.arguments),
      };
    });
  } else if (api === 'anthropic-messages') {
    for (const block of asArray(body.content).map(asObject)) {
      if (block.type === 'text' && typeof block.text === 'string') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          name: typeof block.name === 'string' ? block.name : '',
          arguments: block.input ?? {},
        });
      }
    }
  } else {
    const candidate = asObject(asArray(body.candidates)[0]);
    for (const part of asArray(asObject(candidate.content).parts).map(
      asObject,
    )) {
      if (part.thought === true) continue;
      if (typeof part.text === 'string') text += part.text;
      if (part.functionCall) {
        const call = asObject(part.functionCall);
        toolCalls.push({
          name: typeof call.name === 'string' ? call.name : '',
          arguments: call.args ?? {},
        });
      }
    }
  }
  return {
    text,
    toolCalls: toolCalls.filter((call) => call.name !== RECALL_TOOL_NAME),
  };
}
