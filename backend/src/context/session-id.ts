import { contentHash } from './canonical-json';
import { ExtractedItem } from './context-items';

/** Request header an agent can send to name its session explicitly. */
export const SESSION_HEADER = 'x-parsim-session-id';

const MAX_HEADER_LENGTH = 200;
const PRINTABLE = /^[\x20-\x7e]+$/;
const DATE_SUFFIX = /-(\d{4}-\d{2}-\d{2}|\d{8})$/;

export type SessionIdentity = {
  externalId: string;
  source: 'header' | 'derived';
};

/**
 * The model without a "models/" prefix or a dated snapshot suffix, so a
 * session keeps its id when a client pins or unpins a snapshot
 * (gpt-4o-2024-08-06 and gpt-4o are the same family).
 */
export function modelFamily(model: string): string {
  return model.replace(/^models\//, '').replace(DATE_SUFFIX, '');
}

/** The header value if it is usable: 1 to 200 printable ASCII characters. */
export function validSessionHeader(value: unknown): string | null {
  const first = Array.isArray(value) ? (value[0] as unknown) : value;
  if (typeof first !== 'string') return null;
  const trimmed = first.trim();
  return trimmed.length > 0 &&
    trimmed.length <= MAX_HEADER_LENGTH &&
    PRINTABLE.test(trimmed)
    ? trimmed
    : null;
}

/**
 * Identifies the agent session of a request.
 *
 * 1. The x-parsim-session-id header, if the client sends one.
 * 2. Otherwise a hash of the upstream, the model family, the system prompt
 *    and the first user message. These stay the same while one agent run
 *    keeps appending to its conversation. See docs/agent-sessions.md for
 *    the limits.
 */
export function resolveSessionId(input: {
  header: unknown;
  upstream: string;
  model: string;
  items: ExtractedItem[];
}): SessionIdentity {
  const header = validSessionHeader(input.header);
  if (header) return { externalId: header, source: 'header' };

  const system = input.items
    .filter((item) => item.kind === 'system')
    .map((item) => item.contentHash);
  const firstUser =
    input.items.find((item) => item.kind === 'user')?.contentHash ?? null;

  const hash = contentHash({
    v: 1,
    upstream: input.upstream,
    family: modelFamily(input.model),
    system,
    firstUser,
  });
  return { externalId: `derived:${hash.slice(0, 32)}`, source: 'derived' };
}
