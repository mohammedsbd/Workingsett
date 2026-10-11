import { CanonicalContent, CanonicalPart } from '../context/context-items';

/** The tool Parsim adds to requests that contain archive stubs. */
export const RECALL_TOOL_NAME = 'parsim_recall';

export const RECALL_TOOL_DESCRIPTION =
  'Fetch the full content of an archived tool result by its archive id, shown in a [parsim archived: ...] stub.';

/** JSON schema of the tool input. */
export const RECALL_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    archive_id: {
      type: 'string',
      description:
        'The archive id from the stub, for example arc_0123456789abcdef.',
    },
  },
  required: ['archive_id'],
} as const;

/**
 * The line added to the system prompt. A constant, so the prompt prefix is
 * byte-identical on every call and provider caching keeps working.
 */
export const RECALL_SYSTEM_LINE =
  'Some earlier tool results were archived to save space and replaced by stubs like [parsim archived: <tool> result, <n> tokens, id <archive id>]. If you need one, call parsim_recall with its archive id to get the full result.';

export const recallNotFound = (archiveId: string): string =>
  archiveId
    ? `Archive id ${archiveId} was not found. Continue without it.`
    : 'No archive id was given. Call parsim_recall with the id from a [parsim archived: ...] stub.';

export const RECALL_LIMIT_REACHED =
  'The recall limit for this request was reached. Answer with the information you have.';

/** Reads the archive id from a tool call's input (object or JSON string). */
export function archiveIdFrom(input: unknown): string {
  let value = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return '';
    }
  }
  if (typeof value !== 'object' || value === null) return '';
  const id = (value as Record<string, unknown>).archive_id;
  return typeof id === 'string' ? id.trim() : '';
}

/**
 * The text of an archived tool result, as given back to the model. Text is
 * kept as is, structured values (Gemini function responses, unknown blocks)
 * become JSON, and images become a short placeholder.
 */
export function archivedText(content: CanonicalContent): string {
  return content.parts.map(partText).join('');
}

function partText(part: CanonicalPart): string {
  switch (part.type) {
    case 'text':
    case 'thinking':
      return part.text;
    case 'image':
      return '[image]';
    case 'tool_call':
      return JSON.stringify(part.input ?? null);
    case 'tool_result':
      return part.content.map(partText).join('');
    case 'other':
      return typeof part.value === 'string'
        ? part.value
        : JSON.stringify(part.value ?? null);
  }
}
