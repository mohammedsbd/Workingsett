import type { StretchMessage } from '../compressions/domain/compression';

/** What the summarizer returns, as JSON. */
export type StateSummary = {
  goal: string;
  decisions: string[];
  facts: string[];
  openItems: string[];
};

export const STATE_BLOCK_START = '[parsim state block';
export const STATE_BLOCK_END = '[end of parsim state block]';

const MAX_ITEMS = 30;
const MAX_ITEM_CHARS = 600;

export class InvalidSummaryError extends Error {
  constructor(reason: string) {
    super(`The summary is not valid: ${reason}`);
    this.name = 'InvalidSummaryError';
  }
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const clip = (text: string) =>
  text.length > MAX_ITEM_CHARS
    ? `${text.slice(0, MAX_ITEM_CHARS - 3)}...`
    : text;

function list(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new InvalidSummaryError(`${field} is not a list`);
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => clip(flat(item)))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

/**
 * Parses the summarizer's JSON (tolerating a ```json fence around it) into
 * a summary with trimmed, bounded fields.
 */
export function parseSummary(text: string): StateSummary {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let value: unknown;
  try {
    value = JSON.parse(unfenced);
  } catch {
    throw new InvalidSummaryError('not JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidSummaryError('not a JSON object');
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.goal !== 'string' || !flat(raw.goal)) {
    throw new InvalidSummaryError('goal is missing');
  }
  return {
    goal: clip(flat(raw.goal)),
    decisions: list(raw.decisions, 'decisions'),
    facts: list(raw.facts, 'facts'),
    openItems: list(raw.openItems ?? raw.open_items, 'openItems'),
  };
}

const bullets = (items: string[]) =>
  items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';

/**
 * "turn 3: arc_a, arc_b" lines, one per turn, in order. Repeated content
 * (the same id) is listed only where it first appears.
 */
function originalLines(messages: StretchMessage[]): string {
  const byTurn = new Map<number, string[]>();
  const seen = new Set<string>();
  for (const message of messages) {
    if (seen.has(message.archiveId)) continue;
    seen.add(message.archiveId);
    const ids = byTurn.get(message.turn) ?? [];
    ids.push(message.archiveId);
    byTurn.set(message.turn, ids);
  }
  return [...byTurn.entries()]
    .map(([turn, ids]) => `- turn ${turn}: ${ids.join(', ')}`)
    .join('\n');
}

/**
 * The state block that replaces a stretch. Plain text with a fixed layout;
 * once stored it is sent byte for byte on every later request.
 */
export function renderStateBlock(input: {
  summary: StateSummary;
  firstTurn: number;
  lastTurn: number;
  actions: string[];
  messages: StretchMessage[];
}): string {
  const { summary } = input;
  return [
    `${STATE_BLOCK_START}: turns ${input.firstTurn} to ${input.lastTurn} were compressed. Call parsim_recall with an id from Originals to see an original message.]`,
    `Goal: ${summary.goal}`,
    'Decisions made:',
    bullets(summary.decisions),
    'Facts learned:',
    bullets(summary.facts),
    'Open items:',
    bullets(summary.openItems),
    'Actions taken (their calls and results follow this block, unchanged):',
    bullets(input.actions),
    'Originals:',
    originalLines(input.messages),
    STATE_BLOCK_END,
  ].join('\n');
}

/** The user-side message that follows a block without kept actions. */
export function continueNote(firstTurn: number, lastTurn: number): string {
  return `[parsim] Turns ${firstTurn} to ${lastTurn} are summarized in the state block above. Continue the task.`;
}
