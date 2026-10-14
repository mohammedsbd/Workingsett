import type { CompressionInput } from '../compressions/domain/compression';
import { archivedText } from '../recall/recall-tool';

/** Longest single message given to the summarizer, in characters. */
const MESSAGE_CHARS = 12_000;

export const SUMMARY_INSTRUCTIONS = [
  "You compress a finished part of an AI agent's conversation into a state block the agent will read instead of those messages.",
  'Return only a JSON object with these keys:',
  '- "goal": one sentence, the overall goal the agent is working toward.',
  '- "decisions": choices the agent made in this part, with their reasons.',
  '- "facts": facts it learned that may matter later. Keep names, numbers, dates, URLs, ids and conclusions exactly.',
  '- "openItems": what is still open or was planned next.',
  'Use short, specific sentences. Do not invent anything that is not in the messages. Do not describe the side-effect actions; they are listed separately.',
].join('\n');

function roleLabel(role: string): string {
  return role === 'assistant'
    ? 'Agent'
    : role === 'tool'
      ? 'Tool result'
      : 'User';
}

/** The user message for the summarizer: the goal, then the transcript. */
export function summaryPrompt(input: CompressionInput): string {
  const transcript = input.messages
    .map((message) => {
      const text = archivedText(message.content);
      const toolCalls = message.content.parts
        .filter((part) => part.type === 'tool_call')
        .map((part) =>
          part.type === 'tool_call'
            ? `[calls ${part.name} with ${typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {})}]`
            : '',
        );
      const body =
        message.role === 'assistant' && toolCalls.length
          ? [
              message.content.parts.some((p) => p.type === 'text')
                ? textOnly(message.content.parts)
                : '',
              ...toolCalls,
            ]
              .filter(Boolean)
              .join('\n')
          : text;
      const clipped =
        body.length > MESSAGE_CHARS
          ? `${body.slice(0, MESSAGE_CHARS)} [...]`
          : body;
      return `--- Turn ${message.turn}, ${roleLabel(message.role)}:\n${clipped}`;
    })
    .join('\n');
  return [
    `The agent's goal, from the first user message:\n${input.goal}`,
    `The messages to compress:\n${transcript}`,
    'Return the JSON object now.',
  ].join('\n\n');
}

function textOnly(
  parts: CompressionInput['messages'][number]['content']['parts'],
): string {
  return parts
    .map((part) =>
      part.type === 'text' || part.type === 'thinking' ? part.text : '',
    )
    .filter(Boolean)
    .join('\n');
}
